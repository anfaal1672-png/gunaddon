// @ts-check
/**
 * 兵科とパーク（3.0）
 *   ・兵科：パッシブの補正 ＋ 戦術デバイスで使うアビリティ（クールダウン付き）
 *   ・パーク：3 枠（ティア 1〜3）。階級で解放
 *   補正はすべて mods(player) にまとめ、移動・リロード・覗き込み・反動・被ダメージなどの各所が掛け算で読む
 *   （data/classes.js の MOD_KEYS。既定は 1）
 * 選んだ兵科とパークはプロフィール（progression.js）に保存する。アビリティの残り時間は保存しない
 */
import { world, system, Player } from "@minecraft/server";
import { DATA, ammoItemId } from "../config/constants.js";
import { S } from "../core/state.js";
import { on } from "../core/events.js";
import { addLethalGuard, markEntity } from "../core/damage.js";
import { silhouette } from "../core/pathlock.js";
import { giveItem } from "../core/inventory.js";
import { emit, playNear, playTo } from "../fx/effects.js";
import { announce } from "../ui/hud2.js";
import { profile, rankOf, markProfileDirty } from "./progression.js";
import { t, raw } from "../util/i18n.js";
import { safe } from "../util/log.js";

const CLASSES = /** @type {Record<string, any>} */ (DATA.CLASSES);
const PERKS = /** @type {Record<string, any>} */ (DATA.PERKS);
const KEYS = /** @type {string[]} */ (DATA.MOD_KEYS);

/** @typedef {Record<string, number>} Mods */

/** 補正の作り置き（兵科・パーク・使用中のアビリティが変わったら作り直す） @type {Map<string, {key:string, m:Mods}>} */
const cache = new Map();

/** 回復フィールド @type {{dim:import("@minecraft/server").Dimension, pos:import("../util/math.js").Vec3, ownerId:string, until:number, radius:number}[]} */
const fields = [];

/** 偵察兵のパルススキャン：プレイヤー ID → マークした相手と期限 @type {Map<string, {ids:string[], until:number}>} */
const pulses = new Map();

/** @param {Player} p */
export function classOf(p) {
  const c = profile(p).cls;
  return CLASSES[c] ? c : DATA.DEFAULT_CLASS;
}

/** @param {Player} p @returns {(string|null)[]} */
export function perksOf(p) {
  const perks = profile(p).perks ?? [null, null, null];
  const r = rankOf(p);
  // 階級が足りないパーク（データの変更などで解放ラインが上がった）は効かない
  return [0, 1, 2].map((i) => {
    const id = perks[i];
    const d = id ? PERKS[id] : null;
    return d && d.tier === i + 1 && r >= d.rank ? id : null;
  });
}

/** @param {Player} p @param {string} id */
export function hasPerk(p, id) {
  return perksOf(p).includes(id);
}

/**
 * 補正（掛け算。既定 1）
 * @param {Player} p @returns {Mods}
 */
export function mods(p) {
  const s = S(p);
  const now = system.currentTick;
  const cls = classOf(p);
  const perks = perksOf(p);
  const active = s.abilityUntil > now ? s.abilityId : "";
  const key = `${cls}|${perks.join(",")}|${active}`;
  const c = cache.get(p.id);
  if (c && c.key === key) return c.m;
  /** @type {Mods} */
  const m = {};
  for (const k of KEYS) m[k] = 1;
  const apply = (/** @type {Record<string, number>|undefined} */ src) => {
    if (src) for (const [k, v] of Object.entries(src)) m[k] = (m[k] ?? 1) * v;
  };
  const cd = CLASSES[cls];
  apply(cd.mods);
  for (const id of perks) if (id) apply(PERKS[id].mods);
  if (active && cd.ability.id === active) apply(cd.ability.mods);
  cache.set(p.id, { key, m });
  return m;
}

/** 反動の補正（重装兵は機関銃・重火器だけさらに軽い） @param {Player} p @param {string} cat */
export function recoilMod(p, cat) {
  const m = mods(p);
  return m.recoil * (cat === "lmg" || cat === "heavy" ? m.heavyRecoil : 1);
}

/** 敵 AI から見つかる距離の補正（プレイヤー以外は 1） @param {import("@minecraft/server").Entity} e */
export function sightMod(e) {
  return e instanceof Player ? mods(e).sight : 1;
}

/** 受けるダメージの補正 @param {Player} p @param {string|undefined} kind */
export function takenMod(p, kind) {
  const m = mods(p);
  return m.dmgTaken * (kind === "explosive" ? m.explTaken : 1);
}

/**
 * 兵科とパークを決める（試合中・切り替えの待ち時間中は変えられない）
 * @param {Player} p @param {string} cls @param {(string|null)[]} perks
 * @returns {string|null} 変えられないときの理由（翻訳キー）
 */
export function setLoadout(p, cls, perks) {
  if (!CLASSES[cls]) return "arsenal.class.unknown";
  const r = rankOf(p);
  for (let i = 0; i < 3; i++) {
    const id = perks[i];
    if (!id) continue;
    const d = PERKS[id];
    if (!d || d.tier !== i + 1) return "arsenal.class.unknown";
    if (r < d.rank) return "arsenal.class.perk_locked";
  }
  const prof = profile(p);
  const s = S(p);
  const now = system.currentTick;
  if (prof.cls !== cls && s.classSwitchAt > now) return "arsenal.class.switch_wait";
  if (prof.cls !== cls) {
    s.classSwitchAt = now + DATA.CLASS_SWITCH_COOLDOWN * 20;
    // 兵科を変えたらアビリティは使い直し（最初から使える）
    s.abilityReady = 0;
    s.abilityUntil = 0;
  }
  prof.cls = cls;
  prof.perks = [perks[0] ?? null, perks[1] ?? null, perks[2] ?? null];
  markProfileDirty(p);
  cache.delete(p.id);
  return null;
}

/**
 * アビリティを使う（戦術デバイス）
 * @param {Player} p
 * @returns {boolean}
 */
export function useAbility(p) {
  const s = S(p);
  const now = system.currentTick;
  const cd = CLASSES[classOf(p)];
  const a = cd.ability;
  if (s.abilityReady > now) {
    const left = Math.ceil((s.abilityReady - now) / 20);
    announce(p, { rawtext: [{ text: "§7" }, t("arsenal.class.cooldown", { translate: `arsenal.ability.${a.id}` }, String(left))] }, 30);
    playTo(p, "arsenal.ui.error", { volume: 0.5 });
    return false;
  }
  s.abilityReady = now + a.cooldown * 20;
  s.abilityId = a.id;
  s.abilityUntil = now + (a.seconds ?? 0) * 20;
  s.abilityAnnounced = false;
  cache.delete(p.id);
  const dim = p.dimension;
  switch (a.id) {
    case "rush":
      emit(dim, "arsenal:sonic_ring", p.location, undefined, { range: 32 });
      playNear(dim, p.location, "arsenal.gear.adrenaline", { range: 16 });
      break;
    case "field":
      fields.push({ dim, pos: { ...p.location }, ownerId: p.id, until: now + a.seconds * 20, radius: a.radius });
      emit(dim, "arsenal:heal", p.location, undefined, { range: 32 });
      playNear(dim, p.location, "arsenal.gear.heal", { range: 16 });
      break;
    case "resupply":
      resupply(p, a);
      break;
    case "pulse":
      pulse(p, a);
      break;
    case "bulwark":
      // スクリプトのダメージは mods の dmgTaken で、エンジンのダメージ（落下・mob の近接など）は耐性で軽くする
      safe("ab.bulwark", () => p.addEffect("resistance", a.seconds * 20, { amplifier: 2, showParticles: true }));
      emit(dim, "arsenal:energy_ring", p.getAABB().center, undefined, { range: 32 });
      playNear(dim, p.location, "arsenal.armor.plate_insert", { range: 16 });
      break;
  }
  announce(p, { rawtext: [{ text: "§b" }, t("arsenal.class.used", { translate: `arsenal.ability.${a.id}` })] }, 40);
  return true;
}

/** @param {Player} p @param {any} a */
function resupply(p, a) {
  const targets = safe("ab.res.near", () => p.dimension.getPlayers({ location: p.location, maxDistance: a.radius })) ?? [p];
  for (const q of targets) {
    const s = S(q);
    const st = s.stats;
    if (!st || st.ammoFamily === "none") continue;
    const id = ammoItemId(st.ammoFamily, s.ammoType) ?? ammoItemId(st.ammoFamily, "std");
    if (!id) continue;
    giveItem(q, id, Math.max(1, Math.ceil((st.mag * a.mags) / Math.max(1, st.ammoPerItem))));
    playTo(q, "arsenal.mech.mag_in", { volume: 0.7 });
    if (q.id !== p.id) announce(q, { rawtext: [{ text: "§a" }, t("arsenal.gear.resupplied")] }, 30);
  }
  emit(p.dimension, "arsenal:sonic_ring", p.location, undefined, { range: 24 });
}

/** @param {Player} p @param {any} a */
function pulse(p, a) {
  const ticks = a.seconds * 20;
  const list = safe("ab.pulse", () => p.dimension.getEntities({ location: p.location, maxDistance: a.radius, families: ["arsenal_enemy"] })) ?? [];
  const mon = safe("ab.pulse2", () => p.dimension.getEntities({ location: p.location, maxDistance: a.radius, families: ["monster"] })) ?? [];
  const ids = new Set();
  for (const e of [...list, ...mon]) {
    if (ids.has(e.id)) continue;
    ids.add(e.id);
    markEntity(e.id, ticks);
  }
  pulses.set(p.id, { ids: [...ids].slice(0, 24), until: system.currentTick + ticks });
  emit(p.dimension, "arsenal:sonic_ring", p.location, undefined, { range: 64 });
  playNear(p.dimension, p.location, "arsenal.world.sonar", { range: 48 });
  announce(p, { rawtext: [{ text: "§b" }, t("arsenal.class.pulse_found", String(ids.size))] }, 40);
}

/** 毎 tick（main.js）。重い処理は間引く */
export function tickClasses() {
  const now = system.currentTick;
  // 回復フィールド（1 秒ごと）
  if (now % 20 === 0) {
    for (let i = fields.length - 1; i >= 0; i--) {
      const f = fields[i];
      if (now >= f.until) {
        fields.splice(i, 1);
        continue;
      }
      safe("ab.field", () => {
        for (const q of f.dim.getPlayers({ location: f.pos, maxDistance: f.radius })) q.addEffect("regeneration", 30, { amplifier: 1, showParticles: false });
        for (const e of f.dim.getEntities({ location: f.pos, maxDistance: f.radius, families: ["arsenal_squad"] })) {
          const h = e.getComponent("minecraft:health");
          if (h) h.setCurrentValue(Math.min(h.effectiveMax, h.currentValue + 2));
        }
        emit(f.dim, "arsenal:heal", f.pos, undefined, { range: 32, minQ: 1 });
      });
    }
  }
  // パルススキャンの影絵（4 tick ごと、使った本人にだけ）
  if (now % 4 === 0 && pulses.size) {
    for (const [pid, ps] of pulses) {
      const p = world.getEntity(pid);
      if (!(p instanceof Player) || now >= ps.until) {
        pulses.delete(pid);
        continue;
      }
      const eye = p.getHeadLocation();
      for (const id of ps.ids) {
        const e = world.getEntity(id);
        if (!e || !e.isValid || e.dimension.id !== p.dimension.id) continue;
        safe("ab.sil", () => silhouette(p, eye, e, e.getAABB().center, [0.4, 0.8, 1.0], 0.75));
      }
    }
  }
  // 衛生兵の自然回復・アビリティの準備完了の知らせ（1 秒ごと）
  if (now % 20 === 10) {
    for (const p of world.getAllPlayers()) {
      const s = S(p);
      const cd = CLASSES[classOf(p)];
      if (cd.regen && now % cd.regen.every < 20 && now - s.lastHurtTick > cd.regen.calm) {
        safe("ab.regen", () => {
          const h = p.getComponent("minecraft:health");
          if (h && h.currentValue > 0 && h.currentValue < h.effectiveMax) h.setCurrentValue(Math.min(h.effectiveMax, h.currentValue + cd.regen.amount));
        });
      }
      if (s.abilityReady > 0 && now >= s.abilityReady && !s.abilityAnnounced) {
        s.abilityAnnounced = true;
        announce(p, { rawtext: [{ text: "§a" }, t("arsenal.class.ready", { translate: `arsenal.ability.${cd.ability.id}` })] }, 40);
        playTo(p, "arsenal.ui.streak_ready", { volume: 0.6, pitch: 1.4 });
      }
    }
  }
}

/** 起動時：倒したときのパーク・不屈 */
export function attachClasses() {
  on("kill", (ev) => {
    const k = ev.killer;
    if (!(k instanceof Player)) return;
    const perks = perksOf(k);
    for (const id of perks) {
      if (!id) continue;
      const d = PERKS[id];
      if (d.killHeal) {
        safe("perk.heal", () => {
          const h = k.getComponent("minecraft:health");
          if (h && h.currentValue > 0) h.setCurrentValue(Math.min(h.effectiveMax, h.currentValue + d.killHeal));
        });
      }
      if (d.scavenge && ev.kind === "gun") {
        const s = S(k);
        const st = s.stats;
        if (!st || st.ammoFamily === "none") continue;
        const aid = ammoItemId(st.ammoFamily, s.ammoType) ?? ammoItemId(st.ammoFamily, "std");
        if (aid) giveItem(k, aid, Math.max(1, Math.ceil((st.mag * d.scavenge) / Math.max(1, st.ammoPerItem))));
      }
    }
  });
  // 不屈：倒れるダメージを 1 回だけ体力 1 で耐える（ダウン制より先に調べる）
  addLethalGuard((target, _attacker, info) => {
    if (!(target instanceof Player) || !hasPerk(target, "last_stand")) return false;
    const s = S(target);
    const now = system.currentTick;
    if (s.lastStandReady > now) return false;
    const d = PERKS.last_stand.lastStand;
    s.lastStandReady = now + d.cooldown * 20;
    const save = () => safe("perk.ls", () => {
      target.getComponent("minecraft:health")?.setCurrentValue(1);
      target.addEffect("resistance", d.seconds * 20, { amplifier: 3, showParticles: true });
      announce(target, { rawtext: [{ text: "§6" }, t("arsenal.class.last_stand")] }, 40);
      playTo(target, "arsenal.gear.adrenaline");
    });
    if (info && info.engine) system.run(save);
    else save();
    return true;
  }, true);
}

/** 使用中のアビリティ（HUD・テスト用） @param {Player} p */
export function abilityState(p) {
  const s = S(p);
  const now = system.currentTick;
  return { id: CLASSES[classOf(p)].ability.id, active: s.abilityUntil > now, ready: s.abilityReady <= now, left: Math.max(0, Math.ceil((s.abilityReady - now) / 20)) };
}

/** 説明（フォーム用） @param {Player} p */
export function loadoutBody(p) {
  const cls = classOf(p);
  const cd = CLASSES[cls];
  const lines = [raw("§l", { translate: `arsenal.class.${cls}` }, "§r  §7", { translate: `arsenal.class.${cls}.desc` })];
  lines.push(raw("§b", { translate: `arsenal.ability.${cd.ability.id}` }, "§7: ", { translate: `arsenal.ability.${cd.ability.id}.desc` }, ` §8(${cd.ability.cooldown}s)`));
  perksOf(p).forEach((id, i) => {
    lines.push(raw(`§e${i + 1}. `, id ? { translate: `arsenal.perk.${id}` } : { text: "-" }, "§7 ", id ? { translate: `arsenal.perk.${id}.desc` } : { text: "" }));
  });
  return { rawtext: lines.flatMap((l, i) => (i ? [{ text: "\n" }, l] : [l])) };
}
