// @ts-check
/**
 * リロード状態機械
 *   IDLE → RELOADING(mag | single) → 完了 / キャンセル
 *   ・タクティカル（残弾あり）は空リロードより速い
 *   ・1 発ずつ装填する武器は射撃で中断できる
 *   ・持ち替え・死亡・退出で安全にキャンセル
 */
import { system, GameMode } from "@minecraft/server";
import { ammoItemId, DATA } from "../config/constants.js";
import { W as WS } from "./settings.js";
import { countItem, takeUpTo, giveItem } from "./inventory.js";
import { heldSlot, writeProps, PROP } from "./weaponState.js";
import { playNear } from "../fx/effects.js";
import { safe } from "../util/log.js";
import { t } from "../util/i18n.js";

/** @param {import("@minecraft/server").Player} player */
function infinite(player) {
  const gm = safe("gm", () => player.getGameMode());
  return gm === GameMode.Creative && WS().creativeInfinite;
}

/** 使用する弾薬アイテム @param {any} st @param {string} ammoType */
export function ammoItemFor(st, ammoType) {
  if (st.ammoFamily === "none") return undefined;
  return ammoItemId(st.ammoFamily, ammoType);
}

/** 予備弾数（発数換算）@param {import("@minecraft/server").Player} player @param {any} st @param {string} ammoType */
export function reserveRounds(player, st, ammoType) {
  if (st.ammoFamily === "none") return Infinity;
  if (infinite(player)) return Infinity;
  const id = ammoItemFor(st, ammoType);
  if (!id) return 0;
  return countItem(player, id) * st.ammoPerItem;
}

/** リロードのスタイル（アニメーション名用） @param {any} st */
function style(st) {
  if (st.ammoFamily === "cell") return "cell";
  if ((st.model.type === "double" || st.model.type === "launcher") && !st.single) return "break";
  if (st.bolt) return "bolt";
  return "mag";
}

/**
 * リロード開始
 * @param {import("@minecraft/server").Player} player @param {import("./state.js").PlayerState} s
 * @param {boolean} [manual]
 * @returns {boolean}
 */
export function startReload(player, s, manual = false) {
  const st = s.stats;
  if (!st || !s.weaponId || s.reload) return false;
  if (st.ammoFamily === "none") return false;
  if (s.jammed) {
    s.jammed = false;
    playNear(player.dimension, player.location, "arsenal.mech.jam", { range: 12, pitch: 1.3 });
    playNear(player.dimension, player.location, "arsenal.mech.bolt_back", { range: 12 });
    system.runTimeout(() => playNear(player.dimension, player.location, "arsenal.mech.bolt_forward", { range: 12 }), 6);
    s.shotTimer = Math.max(s.shotTimer, 10);
    s.hudDirty = true;
    return true;
  }
  if (s.ammo >= st.mag) {
    if (manual) status(s, t("arsenal.ui.mag_full"));
    return false;
  }
  if (reserveRounds(player, st, s.ammoType) <= 0) {
    if (manual) status(s, t("arsenal.ui.no_ammo"));
    return false;
  }
  const now = system.currentTick;
  const tactical = s.ammo > 0;
  s.burstLeft = 0;
  s.charge = 0;
  if (st.single) {
    s.reload = { type: "single", weaponId: s.weaponId, slot: s.slot, start: now, end: 0, tactical, next: now + st.single.start, finishing: false, cancelRequested: false, cues: [] };
    anim(player, `animation.arsenal.reload.shell_${st.single.per}`);
  } else {
    const ticks = tactical ? st.reloadTac : st.reloadEmpty;
    s.reload = { type: "mag", weaponId: s.weaponId, slot: s.slot, start: now, end: now + ticks, tactical, next: 0, finishing: false, cancelRequested: false, cues: [] };
    const baseTicks = tactical ? baseReloadTicks(st, "tac") : baseReloadTicks(st, "empty");
    anim(player, `animation.arsenal.reload.${style(st)}_${baseTicks}`);
  }
  s.hudDirty = true;
  return true;
}

/** 生成済みアニメーション名に合わせるため、アタッチメント補正前の tick を使う @param {any} st @param {"tac"|"empty"} kind */
function baseReloadTicks(st, kind) {
  const w = /** @type {any} */ (DATA.WEAPONS)[st.id];
  if (w) return w.reload[kind];
  return kind === "tac" ? st.reloadTac : st.reloadEmpty;
}

/** @param {import("@minecraft/server").Player} player @param {string} name */
function anim(player, name) {
  safe("reload.anim", () => player.playAnimation(name, { controller: "arsenal_reload", blendOutTime: 0.15 }));
}

/** @param {import("./state.js").PlayerState} s @param {import("@minecraft/server").RawMessage} msg */
export function status(s, msg) {
  s.statusMsg = msg;
  s.statusMsgUntil = system.currentTick + 30;
  s.hudDirty = true;
}

/**
 * キャンセル
 * @param {import("@minecraft/server").Player} player @param {import("./state.js").PlayerState} s
 */
export function cancelReload(player, s) {
  if (!s.reload) return;
  s.reload = null;
  s.hudDirty = true;
  safe("reload.cancelAnim", () => player.playAnimation("animation.arsenal.none", { controller: "arsenal_reload", blendOutTime: 0.1 }));
}

/**
 * 装填（インベントリから弾を取り出してマガジンへ）
 * @param {import("@minecraft/server").Player} player @param {import("./state.js").PlayerState} s @param {number} want 発数
 */
function load(player, s, want) {
  const st = s.stats;
  if (want <= 0) return 0;
  if (infinite(player)) return want;
  const id = ammoItemFor(st, s.ammoType);
  if (!id) return 0;
  const per = st.ammoPerItem;
  const items = Math.ceil(want / per);
  const got = takeUpTo(player, id, items);
  return Math.min(want, got * per);
}

/**
 * 毎 tick の進行
 * @param {import("@minecraft/server").Player} player @param {import("./state.js").PlayerState} s
 */
export function tickReload(player, s) {
  const r = s.reload;
  if (!r) return;
  const st = s.stats;
  const now = system.currentTick;
  if (r.weaponId !== s.weaponId || r.slot !== s.slot) {
    cancelReload(player, s);
    return;
  }
  const dim = player.dimension;
  const loc = player.location;
  if (r.type === "mag") {
    const dur = r.end - r.start;
    const f = (now - r.start) / Math.max(1, dur);
    const st2 = style(st);
    /** @type {[number, string][]} */
    const cues = st2 === "cell" ? [[0.1, "cell_out"], [0.55, "cell_in"]] :
      st2 === "break" ? [[0.1, "break_open"], [0.6, "shell_insert"], [0.85, "break_close"]] :
      st.model.type === "revolver" ? [[0.08, "break_open"], [0.4, "revolver_spin"], [0.85, "break_close"]] :
      st.cat === "lmg" ? [[0.1, "mag_out"], [0.4, "belt"], [0.7, "mag_in"]] :
      st.cat === "launcher" ? [[0.1, "break_open"], [0.55, "heavy_load"], [0.85, "break_close"]] :
      [[0.12, "mag_out"], [0.55, "mag_in"]];
    if (!r.tactical && st2 !== "cell" && st2 !== "break" && st.model.type !== "revolver") cues.push([0.82, st.bolt ? "bolt_forward" : "bolt_back"]);
    cues.forEach(([at, snd], i) => {
      if (f >= at && !r.cues.includes(i)) {
        r.cues.push(i);
        playNear(dim, loc, `arsenal.mech.${snd}`, { range: 16, volume: 0.9 });
      }
    });
    if (now >= r.end) {
      const need = st.mag - s.ammo;
      const got = load(player, s, need);
      s.ammo += got;
      s.reload = null;
      s.hudDirty = true;
      const slot = heldSlot(player);
      if (slot) writeProps(slot, { [PROP.ammo]: s.ammo });
    }
    return;
  }
  // 1 発ずつ
  if (r.finishing) {
    if (now >= r.end) {
      s.reload = null;
      s.hudDirty = true;
    }
    return;
  }
  if (now >= r.next) {
    const reserve = reserveRounds(player, st, s.ammoType);
    if (s.ammo >= st.mag || reserve <= 0 || r.cancelRequested) {
      r.finishing = true;
      r.end = now + st.single.end;
      if (st.pump) {
        playNear(dim, loc, "arsenal.mech.pump", { range: 16 });
        safe("pumpAnim", () => player.playAnimation("animation.arsenal.pump", { controller: "arsenal_reload", blendOutTime: 0.1 }));
      }
      return;
    }
    const got = load(player, s, 1);
    if (got > 0) {
      s.ammo += got;
      playNear(dim, loc, st.cat === "launcher" ? "arsenal.mech.heavy_load" : "arsenal.mech.shell_insert", { range: 16 });
      anim(player, `animation.arsenal.reload.shell_${baseSinglePer(st)}`);
      const slot = heldSlot(player);
      if (slot) writeProps(slot, { [PROP.ammo]: s.ammo });
      s.hudDirty = true;
    }
    r.next = now + st.single.per;
  }
}

/** @param {any} st */
function baseSinglePer(st) {
  const w = /** @type {any} */ (DATA.WEAPONS)[st.id];
  return w && w.single ? w.single.per : st.single.per;
}

/**
 * 弾種の切り替え：装填中の弾を返却してから新しい弾種で再装填する
 * @param {import("@minecraft/server").Player} player @param {import("./state.js").PlayerState} s @param {string} newType
 */
export function switchAmmoType(player, s, newType) {
  const st = s.stats;
  if (!st || s.ammoType === newType) return;
  cancelReload(player, s);
  if (s.ammo > 0 && !infinite(player)) {
    const id = ammoItemFor(st, s.ammoType);
    if (id) {
      const items = Math.floor(s.ammo / st.ammoPerItem);
      if (items > 0) giveItem(player, id, items);
    }
  }
  s.ammo = 0;
  s.ammoType = newType;
  const slot = heldSlot(player);
  if (slot) writeProps(slot, { [PROP.ammo]: 0, [PROP.at]: newType });
  s.hudDirty = true;
}

/** @param {import("@minecraft/server").Player} player */
export function isInfinite(player) {
  return infinite(player);
}
