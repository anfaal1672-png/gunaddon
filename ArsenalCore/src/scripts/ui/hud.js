// @ts-check
/**
 * HUD（アクションバー／サブタイトル）
 *   [VX-9]  12 / 48  ▮ SEMI  耐久 ████░  ＋ヒットマーカー・リロード・過熱・充電・ロックオン
 */
import { system } from "@minecraft/server";
import { P } from "../core/settings.js";
import { HUD_GLYPH as G, modeKey, DATA } from "../config/constants.js";
import { renderHud2 } from "./hud2.js";
import { reserveRounds } from "../core/reload.js";
import { durabilityRatio } from "../core/fireController.js";
import { itemName } from "../util/i18n.js";
import { safe } from "../util/log.js";

/** @param {number} ratio @param {number} n @param {string} on @param {string} off */
function bar(ratio, n, on = "█", off = "░") {
  const k = Math.max(0, Math.min(n, Math.round(ratio * n)));
  return on.repeat(k) + off.repeat(n - k);
}

/** @param {string} mode */
function modeGlyph(mode) {
  if (mode === "auto") return G.auto;
  if (mode.startsWith("burst")) return G.burst;
  if (mode === "ub") return G.ub;
  if (mode === "charge") return G.charge;
  return G.semi;
}

/** @param {any} st */
function ammoGlyph(st) {
  switch (st.ammoFamily) {
    case "shell": return G.shell;
    case "cell": return G.cell;
    case "gl40": return G.grenade;
    case "rocket": return G.rocket;
    case "none": return G.hook;
    default: return G.bullet;
  }
}

/**
 * スコープ表示の印。画面には出ない書式コードの並びで、リソースパックの HUD（ui/hud_screen.json）が
 * タイトルの文字列にこれが含まれているかを見てスコープやレティクルを重ねる（印だけのタイトルは枠ごと隠れる）。
 * 末尾の数字：1 = 2 倍、2 = 4 倍、3 = 8 倍、4 = サーマル、5 = ドットサイト、6 = ホロサイト
 */
export const SCOPE_MARK = "§a§r§s§n";
const OPTIC_CODE = /** @type {Record<string,string>} */ (DATA.OPTIC_OVERLAY);
/** 倍率スコープ（覗くと銃を下ろして全画面のスコープを出す） */
export const SCOPED_OPTICS = new Set(/** @type {string[]} */ (DATA.SCOPED));

/**
 * 実効の光学（キャンテッドアイアン・可変倍率を反映）
 * @param {import("../core/state.js").PlayerState} s @param {any} st
 */
export function effectiveOptic(s, st) {
  if (s.cantedOn) return "iron";
  if (st.variable) return s.variableHigh ? "scope4" : "reddot";
  return st.optic;
}

/** スコープ表示の番号（なしは ""） @param {import("../core/state.js").PlayerState} s */
export function scopeCode(s) {
  const st = s.stats;
  if (!st || !s.ads) return "";
  const optic = effectiveOptic(s, st);
  const code = OPTIC_CODE[optic];
  if (!code) return "";
  if (SCOPED_OPTICS.has(optic) ? s.adsLevel < 0.999 : s.adsLevel < 0.5) return "";
  return code;
}

/** @param {import("../core/state.js").PlayerState} s */
export function scopeMark(s) {
  const code = scopeCode(s);
  return code ? SCOPE_MARK + "§" + code : "";
}

/** スコープ表示を消すときに送る印（接頭辞は同じなので、タイトルの枠は出ない） */
export const SCOPE_OFF = SCOPE_MARK + "§0";

/**
 * スコープ表示を消す（武器を持ち替えた・設定を変えたとき）
 * @param {import("@minecraft/server").Player} player @param {import("../core/state.js").PlayerState} s
 */
export function resetScopeMark(player, s) {
  if (!s.lastMark) return;
  s.lastMark = "";
  if (P(player).hudStyle === "hud2") {
    s.hudDirty = true;
    return;
  }
  safe("hud.resetMark", () => player.onScreenDisplay.setTitle(SCOPE_OFF, { fadeInDuration: 0, stayDuration: 1, fadeOutDuration: 0 }));
}

/**
 * スコープの印をタイトルの文字列に載せる（HUD がタイトル表示のときは HUD 側で載せる）
 * @param {import("@minecraft/server").Player} player @param {import("../core/state.js").PlayerState} s @param {string} mark
 */
function syncMark(player, s, mark) {
  const now = system.currentTick;
  if (mark && (mark !== s.lastMark || now - s.markTick >= 20)) {
    s.markTick = now;
    safe("hud.mark", () => player.onScreenDisplay.setTitle(mark, { fadeInDuration: 0, stayDuration: 60, fadeOutDuration: 0 }));
  } else if (!mark && s.lastMark) {
    safe("hud.unmark", () => player.onScreenDisplay.setTitle(SCOPE_OFF, { fadeInDuration: 0, stayDuration: 1, fadeOutDuration: 0 }));
  }
  s.lastMark = mark;
}

/**
 * @param {import("@minecraft/server").Player} player @param {import("../core/state.js").PlayerState} s
 * @param {boolean} force
 */
export function renderWeaponHud(player, s, force) {
  const now = system.currentTick;
  const prefs = P(player);
  if (prefs.hudStyle === "hud2" && prefs.hudMode !== "off") {
    const hadStatus = s.statusMsg && s.statusMsgUntil > now && s.statusShownAt !== s.statusMsgUntil;
    renderHud2(player, s, force);
    if (hadStatus && s.statusMsg) {
      s.statusShownAt = s.statusMsgUntil;
      const msg = s.statusMsg;
      safe("hud2.status", () => player.onScreenDisplay.setActionBar(msg));
    }
    return;
  }
  const mark = scopeMark(s);
  const viaHud = prefs.hudPos === "title" && prefs.hudMode !== "off";
  if (!viaHud) syncMark(player, s, mark);
  else if (mark !== s.lastMark) {
    s.hudDirty = true;
    force = true;
  }
  if (prefs.hudMode === "off") return;
  if (!force && !s.hudDirty && now - s.hudTick < 10) return;
  if (!s.hudDirty && now - s.hudTick < 4 && !force) return;
  s.hudTick = now;
  s.hudDirty = false;
  const st = s.stats;
  if (!st || !s.weaponId) return;
  if (viaHud) s.lastMark = mark;
  /** @type {import("@minecraft/server").RawMessage[]} */
  const rt = [];
  const compact = prefs.hudMode === "compact";
  // ヒットマーカー
  if (prefs.hitmarkers && s.hit && now - s.hit.tick <= 10) {
    const g = s.hit.kind === "kill" ? G.kill : s.hit.kind === "head" ? G.hitHead : G.hit;
    const col = s.hit.kind === "kill" ? "§c" : s.hit.kind === "head" ? "§6" : "§f";
    rt.push({ text: `${col}${g}` });
    if (prefs.damageNumbers && s.hit.dmg > 0) rt.push({ text: ` ${col}${s.hit.dmg.toFixed(1)}` });
    rt.push({ text: "  " });
  }
  if (!compact) {
    rt.push({ text: "§7[§f" }, itemName(s.weaponId), { text: "§7]  " });
  }
  // 弾数
  if (st.ammoFamily === "none") {
    const ready = s.cooldownUntil <= now;
    rt.push({ text: `${ammoGlyph(st)} ${ready ? "§a" : "§7"}` }, { translate: ready ? "arsenal.ui.ready" : "arsenal.ui.cooldown" });
  } else {
    const reserve = reserveRounds(player, st, s.ammoType);
    const low = s.ammo <= Math.ceil(st.mag * 0.25);
    const ac = s.ammo === 0 ? "§c" : low ? "§e" : "§f";
    const rs = reserve === Infinity ? "∞" : String(reserve);
    rt.push({ text: `${ammoGlyph(st)} ${ac}§l${s.ammo}§r§7 / ${rs}` });
    if (s.ammoType !== "std" && s.ammoType !== "buck") rt.push({ text: " §d" }, { translate: `arsenal.variant.${s.ammoType}` });
  }
  // モード
  rt.push({ text: `  §7${modeGlyph(s.mode)} §f` }, { translate: modeKey(s.mode) });
  if (s.mode === "ub") rt.push({ text: ` §e${s.ub}` });
  // 状態
  if (s.reload) {
    const r = s.reload;
    const ratio = r.type === "mag" ? (now - r.start) / Math.max(1, r.end - r.start) : s.ammo / st.mag;
    rt.push({ text: `  §b${G.reload} ${bar(ratio, 8, "▮", "▯")} ` }, { translate: "arsenal.ui.reloading" });
  } else if (s.jammed) {
    rt.push({ text: `  §c${G.jam} ` }, { translate: "arsenal.ui.jammed_hint" });
  } else if (st.heat) {
    const hc = s.overheatUntil > now ? "§c" : s.heat > 70 ? "§6" : "§7";
    rt.push({ text: `  ${hc}${G.heat} ${bar(s.heat / 100, 8, "▮", "▯")}` });
  }
  if (s.mode === "charge" && s.charge > 0) {
    const ratio = s.charge / Math.max(1, st.charge);
    rt.push({ text: `  §b${G.charge} ${bar(ratio, 10, "▮", "▯")} ${Math.round(ratio * 100)}%` });
  }
  if (st.lockTicks > 0 && s.ads) {
    const locked = s.lockTicks >= st.lockTicks;
    rt.push({ text: `  ${locked ? "§c" : "§e"}${G.lock} ` }, { translate: locked ? "arsenal.ui.locked" : "arsenal.ui.locking" });
  }
  if (st.spinup > 0 && s.holding && s.spin < st.spinup) {
    rt.push({ text: `  §7${bar(s.spin / st.spinup, 6, "▮", "▯")}` });
  }
  if (s.breathUntil > now && s.ads) rt.push({ text: "  §b" }, { translate: "arsenal.ui.breath" });
  // 耐久
  if (!compact) {
    const ratio = durabilityRatio(player, s);
    const dc = ratio > 0.5 ? "§a" : ratio > 0.25 ? "§e" : "§c";
    rt.push({ text: `  §7${G.wrench} ${dc}${bar(ratio, 5)}` });
  }
  if (s.statusMsg && s.statusMsgUntil > now) {
    rt.push({ text: "  §e" }, s.statusMsg);
  }
  if (s.tapFiring) rt.push({ text: "  §c●" });
  show(player, prefs.hudPos, { rawtext: rt }, mark);
}

/**
 * @param {import("@minecraft/server").Player} player @param {string} pos @param {import("@minecraft/server").RawMessage} msg @param {string} [mark]
 */
export function show(player, pos, msg, mark = "") {
  safe("hud.show", () => {
    if (pos === "title") {
      player.onScreenDisplay.setTitle(mark || " ", { subtitle: msg, fadeInDuration: 0, stayDuration: 12, fadeOutDuration: 2 });
    } else {
      player.onScreenDisplay.setActionBar(msg);
    }
  });
}

/**
 * 投擲物を持っているときの HUD
 * @param {import("@minecraft/server").Player} player @param {import("../core/state.js").PlayerState} s @param {string} tid @param {number} count
 */
export function renderThrowHud(player, s, tid, count) {
  const now = system.currentTick;
  if (now - s.hudTick < 8 && !s.hudDirty) return;
  s.hudTick = now;
  s.hudDirty = false;
  const prefs = P(player);
  if (prefs.hudMode === "off") return;
  /** @type {import("@minecraft/server").RawMessage[]} */
  const rt = [{ text: `§7${G.grenade} §f` }, itemName(tid), { text: ` §7x${count}` }];
  if (s.throwing) {
    const held = now - s.throwing.start;
    rt.push({ text: `  §e${bar(Math.min(1, held / 60), 8, "▮", "▯")}` });
  } else if (prefs.trajectory) {
    rt.push({ text: "  §8" }, { translate: "arsenal.ui.throw_hint" });
  }
  show(player, prefs.hudPos, { rawtext: rt });
}
