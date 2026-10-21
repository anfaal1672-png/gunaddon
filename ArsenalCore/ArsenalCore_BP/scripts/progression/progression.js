// @ts-check
/**
 * 進行：武器経験値・武器レベル（1〜40）・迷彩の解放・階級（1〜50）・チャレンジ（デイリー 3／ウィークリー 3）・統計
 *
 * 保存：プレイヤーのダイナミックプロパティに JSON を分割して保存する
 *   a:prog.v … 形式のバージョン（SAVE_VERSION）/ a:prog.n … 分割数 / a:prog.0, a:prog.1 … 本体（1 つ SAVE_CHUNK 文字まで）
 *   書き込みは 5 秒ごと（変化があったときだけ）。退出時の before イベントでは書けないため、最大 5 秒分の差分は失われうる
 *   （経験値の取りこぼしは小さいので許容。DESIGN_DECISIONS.md 参照）
 */
import { world, system, Player } from "@minecraft/server";
import { DATA, NS, weaponIdOf, meleeIdOf, enemyIdOf, enemyDef } from "../config/constants.js";
import { P } from "../core/settings.js";
import { S } from "../core/state.js";
import { on, emitEvent } from "../core/events.js";
import { playTo } from "../fx/effects.js";
import { announce } from "../ui/hud2.js";
import { t, raw, itemName } from "../util/i18n.js";
import { safe } from "../util/log.js";

const WXP = DATA.WEAPON_XP;
const WTABLE = /** @type {number[]} */ (DATA.WEAPON_XP_TABLE);
const RTABLE = /** @type {number[]} */ (DATA.RANK_XP_TABLE);
const RXP = DATA.RANK_XP;
const CH = DATA.CHALLENGES;
const CAMOS = /** @type {Record<string, any>} */ (DATA.CAMOS);
const CHUNK = DATA.SAVE_CHUNK;
const VERSION = DATA.SAVE_VERSION;

/**
 * @typedef {{id:string, n:number, prog:number, done:boolean}} ChallengeState
 * @typedef {{v:number, rankXp:number, wxp:Record<string, number>, stats:Record<string, number>, day:number, week:number, daily:ChallengeState[], weekly:ChallengeState[], cls:string, perks:(string|null)[], cp:number, offers:({ty:string, fac:string}|null)[]}} Profile
 */

/** @type {Map<string, {p:Profile, dirty:boolean}>} */
const profiles = new Map();

/** @returns {Profile} */
function blank() {
  /** @type {Record<string, number>} */
  const stats = {};
  for (const k of DATA.STAT_KEYS) stats[k] = 0;
  return { v: VERSION, rankXp: 0, wxp: {}, stats, day: -1, week: -1, daily: [], weekly: [], cls: DATA.DEFAULT_CLASS, perks: [null, null, null], cp: 0, offers: [] };
}

/**
 * 分割した JSON を読む
 * @param {Player} p @param {string} key
 */
export function readChunked(p, key) {
  const n = /** @type {number} */ (safe("prog.n", () => p.getDynamicProperty(`${key}.n`)) ?? 0);
  if (!n) return null;
  let s = "";
  for (let i = 0; i < n; i++) {
    const part = safe("prog.part", () => p.getDynamicProperty(`${key}.${i}`));
    if (typeof part !== "string") return null;
    s += part;
  }
  return s;
}

/**
 * 分割して書く（余った古い断片は消す）
 * @param {Player|any} p @param {string} key @param {string} json
 */
export function writeChunked(p, key, json) {
  const parts = [];
  for (let i = 0; i < json.length; i += CHUNK) parts.push(json.slice(i, i + CHUNK));
  if (!parts.length) parts.push("");
  const old = /** @type {number} */ (p.getDynamicProperty(`${key}.n`) ?? 0);
  parts.forEach((s, i) => p.setDynamicProperty(`${key}.${i}`, s));
  for (let i = parts.length; i < old; i++) p.setDynamicProperty(`${key}.${i}`, undefined);
  p.setDynamicProperty(`${key}.n`, parts.length);
  p.setDynamicProperty(`${key}.v`, VERSION);
}

/** @param {Player} p @returns {Profile} */
export function profile(p) {
  const c = profiles.get(p.id);
  if (c) return c.p;
  let prof = blank();
  const json = readChunked(p, "a:prog");
  if (json) {
    safe("prog.parse", () => {
      const o = JSON.parse(json);
      prof = migrateProfile(o);
    });
  }
  profiles.set(p.id, { p: prof, dirty: false });
  rollChallenges(p, prof);
  return prof;
}

/**
 * 古い形式の読み替え（今は v1 だけ。将来の形式変更はここで吸収する）
 * @param {any} o @returns {Profile}
 */
function migrateProfile(o) {
  const b = blank();
  if (!o || typeof o !== "object") return b;
  b.rankXp = Math.max(0, Number(o.rankXp) || 0);
  if (o.wxp && typeof o.wxp === "object") for (const [k, v] of Object.entries(o.wxp)) if (typeof v === "number" && v > 0) b.wxp[k] = v;
  if (o.stats && typeof o.stats === "object") for (const k of DATA.STAT_KEYS) b.stats[k] = Math.max(0, Number(o.stats[k]) || 0);
  b.day = Number(o.day ?? -1);
  b.week = Number(o.week ?? -1);
  if (Array.isArray(o.daily)) b.daily = o.daily.filter((/** @type {any} */ c) => c && typeof c.id === "string");
  if (Array.isArray(o.weekly)) b.weekly = o.weekly.filter((/** @type {any} */ c) => c && typeof c.id === "string");
  // 3.0：兵科とパーク（2.x のプロフィールには無いので既定のまま）
  if (typeof o.cls === "string" && /** @type {any} */ (DATA.CLASSES)[o.cls]) b.cls = o.cls;
  // 3.0：キャンペーンの進み具合と依頼の一覧
  b.cp = Math.max(0, Number(o.cp) || 0);
  if (Array.isArray(o.offers)) b.offers = o.offers.filter((/** @type {any} */ x) => x && typeof x.ty === "string" && typeof x.fac === "string");
  if (Array.isArray(o.perks)) b.perks = [0, 1, 2].map((i) => (typeof o.perks[i] === "string" && /** @type {any} */ (DATA.PERKS)[o.perks[i]] ? o.perks[i] : null));
  return b;
}

/** プロフィールを書き換えたら呼ぶ（次の保存で書き出す） @param {Player} p */
export function markProfileDirty(p) {
  dirty(p);
}

/** @param {Player} p */
function dirty(p) {
  const c = profiles.get(p.id);
  if (c) c.dirty = true;
}

/** @param {Player} p */
export function flushProfile(p) {
  const c = profiles.get(p.id);
  if (!c || !c.dirty) return;
  c.dirty = false;
  safe("prog.save", () => writeChunked(p, "a:prog", JSON.stringify(c.p)));
}

/** 5 秒ごと */
export function flushAll() {
  for (const p of world.getAllPlayers()) flushProfile(p);
}

/** @param {string} id */
export function forgetProfile(id) {
  profiles.delete(id);
}

// ---------------------------------------------------------------------------
//  レベル計算
// ---------------------------------------------------------------------------

/** @param {number} xp */
export function levelFromXp(xp) {
  let lv = 1;
  while (lv < DATA.WEAPON_MAX_LEVEL && xp >= WTABLE[lv + 1]) lv++;
  return lv;
}
/** @param {number} xp */
export function rankFromXp(xp) {
  let r = 1;
  while (r < DATA.RANK_MAX && xp >= RTABLE[r + 1]) r++;
  return r;
}

/** @param {Player} p @param {string} wid */
export function weaponLevel(p, wid) {
  return levelFromXp(profile(p).wxp[wid] ?? 0);
}
/** @param {Player} p */
export function rankOf(p) {
  return rankFromXp(profile(p).rankXp);
}

/** 階級の称号 @param {number} r */
export function rankTitle(r) {
  let best = DATA.RANK_TITLES[0];
  for (const x of DATA.RANK_TITLES) if (r >= x.from) best = x;
  return best;
}
/** 階級グリフ（U+E130〜） @param {number} r */
export function rankGlyph(r) {
  let code = 0;
  for (const g of DATA.RANK_GLYPHS) if (r >= g.from) code = g.code;
  return String.fromCharCode(0xe130 + code);
}

/**
 * 迷彩が使えるか
 * @param {Player} p @param {string} wid @param {string} camo
 */
export function camoUnlocked(p, wid, camo) {
  const c = CAMOS[camo];
  return !!c && weaponLevel(p, wid) >= c.level;
}

// ---------------------------------------------------------------------------
//  加算
// ---------------------------------------------------------------------------

/**
 * 武器経験値
 * @param {Player} p @param {string} wid @param {number} xp
 */
export function addWeaponXp(p, wid, xp) {
  if (!(/** @type {any} */ (DATA.WEAPONS)[wid] || /** @type {any} */ (DATA.MELEE)[wid]) || xp <= 0) return;
  const prof = profile(p);
  const before = levelFromXp(prof.wxp[wid] ?? 0);
  prof.wxp[wid] = Math.min(WTABLE[DATA.WEAPON_MAX_LEVEL] + 1, (prof.wxp[wid] ?? 0) + xp);
  const after = levelFromXp(prof.wxp[wid]);
  dirty(p);
  if (after > before) {
    playTo(p, "arsenal.ui.levelup");
    p.sendMessage(raw("§b", itemName(wid), " §f", t("arsenal.prog.weapon_level", String(after))));
    for (const [cid, c] of Object.entries(CAMOS)) {
      if (c.level > before && c.level <= after) p.sendMessage(raw("§6", t("arsenal.prog.camo_unlocked", { translate: `arsenal.camo.${cid}` })));
    }
    emitEvent("weaponLevel", { player: p, weaponId: wid, level: after });
  }
}

/**
 * 階級経験値
 * @param {Player} p @param {number} xp
 */
export function addRankXp(p, xp) {
  if (xp <= 0) return;
  const prof = profile(p);
  const before = rankFromXp(prof.rankXp);
  prof.rankXp = Math.min(RTABLE[DATA.RANK_MAX] + 1, prof.rankXp + xp);
  const after = rankFromXp(prof.rankXp);
  dirty(p);
  if (after > before) {
    playTo(p, "arsenal.ui.rankup");
    const title = rankTitle(after);
    announce(p, raw("§6", t("arsenal.prog.rank_up", String(after)), " ", { translate: `arsenal.rank.${DATA.RANK_TITLES.indexOf(title)}` }), 60);
    world.sendMessage(raw("§6", { text: p.name }, " §7", t("arsenal.prog.rank_up_all", String(after))));
    applyNameTag(p);
  }
}

/**
 * 統計
 * @param {Player} p @param {string} key @param {number} [n]
 */
export function addStat(p, key, n = 1) {
  const prof = profile(p);
  if (key === "longest") prof.stats.longest = Math.max(prof.stats.longest ?? 0, Math.round(n));
  else prof.stats[key] = (prof.stats[key] ?? 0) + n;
  dirty(p);
}

/** 名前の横の階級グリフ（個人設定 showRank） @param {Player} p */
export function applyNameTag(p) {
  safe("prog.nametag", () => {
    const want = P(p).showRank ? `${rankGlyph(rankOf(p))} ${p.name}` : p.name;
    if (p.nameTag !== want) p.nameTag = want;
  });
}

// ---------------------------------------------------------------------------
//  チャレンジ
// ---------------------------------------------------------------------------

/** @param {string} s */
function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** 実時間の日・週（UTC） */
export function periodNow() {
  const day = Math.floor(Date.now() / 86400000);
  return { day, week: Math.floor((day + 3) / 7) };
}

/**
 * 日（週）が変わっていたら選び直す
 * @param {Player} p @param {Profile} prof
 */
function rollChallenges(p, prof) {
  const { day, week } = periodNow();
  /** @param {any[]} pool @param {number} seed */
  const choose = (pool, seed) => {
    const idx = pool.map((_, i) => i).sort((a, b) => hash(`${seed}:${a}`) - hash(`${seed}:${b}`));
    return idx.slice(0, CH.perPeriod).map((i) => ({ id: pool[i].id, n: pool[i].n, prog: 0, done: false }));
  };
  if (prof.day !== day) {
    prof.day = day;
    prof.daily = choose(CH.daily, hash(`${day}|${p.id}`));
    dirty(p);
  }
  if (prof.week !== week) {
    prof.week = week;
    prof.weekly = choose(CH.weekly, hash(`w${week}|${p.id}`));
    dirty(p);
  }
}

/** @param {string} id */
function chDef(id) {
  return CH.daily.find((/** @type {any} */ c) => c.id === id) ?? CH.weekly.find((/** @type {any} */ c) => c.id === id);
}

/**
 * チャレンジを進める
 * @param {Player} p @param {string} stat @param {{cat?:string, faction?:string}} ctx @param {number} [n]
 */
function progress(p, stat, ctx, n = 1) {
  const prof = profile(p);
  rollChallenges(p, prof);
  for (const [list, weekly] of /** @type {[ChallengeState[], boolean][]} */ ([[prof.daily, false], [prof.weekly, true]])) {
    for (const c of list) {
      if (c.done) continue;
      const d = chDef(c.id);
      if (!d || d.stat !== stat) continue;
      if (d.filter?.cat && d.filter.cat !== ctx.cat) continue;
      if (d.filter?.faction && d.filter.faction !== ctx.faction) continue;
      c.prog = Math.min(c.n, c.prog + n);
      dirty(p);
      if (c.prog >= c.n) {
        c.done = true;
        playTo(p, "arsenal.ui.challenge");
        p.sendMessage(raw("§a", t("arsenal.prog.challenge_done"), " §f", t(`arsenal.ch.${c.id}`, String(c.n))));
        addRankXp(p, weekly ? RXP.challengeWeekly : RXP.challengeDaily);
        emitEvent("challengeDone", { player: p, id: c.id, credits: d.credits, weekly });
      }
    }
  }
}

/** @param {Player} p */
export function challenges(p) {
  const prof = profile(p);
  rollChallenges(p, prof);
  return { daily: prof.daily, weekly: prof.weekly };
}

// ---------------------------------------------------------------------------
//  イベント
// ---------------------------------------------------------------------------

/** 命中の経験値の上限（200 tick ごとに hitCapPerMag 回まで） @type {Map<string, {t:number, n:number}>} */
const hitWin = new Map();

/** @param {string|null} wid */
function catOf(wid) {
  if (!wid) return undefined;
  return /** @type {any} */ (DATA.WEAPONS)[wid]?.cat ?? /** @type {any} */ (DATA.MELEE)[wid]?.cat;
}

export function attachProgression() {
  on("kill", (ev) => {
    const k = ev.killer;
    if (!(k instanceof Player)) return;
    const wid = ev.weaponId;
    const eid = enemyIdOf(ev.victimType ?? "");
    const faction = eid ? enemyDef(eid)?.faction : undefined;
    const ctx = { cat: catOf(wid), faction };
    addStat(k, "kills");
    progress(k, "kills", ctx);
    if (ev.head) {
      addStat(k, "headKills");
      progress(k, "headKills", ctx);
    }
    if (ev.kind === "melee") {
      addStat(k, "meleeKills");
      progress(k, "meleeKills", ctx);
    }
    if (ev.kind === "explosive") {
      addStat(k, "explosiveKills");
      progress(k, "explosiveKills", ctx);
    }
    if (ev.distance >= 50) {
      addStat(k, "longKills");
      progress(k, "longKills", ctx);
    }
    if (ev.distance > 0) addStat(k, "longest", ev.distance);
    if (wid) {
      let xp = WXP.kill + (ev.head ? WXP.headshot : 0) + (ev.distance >= 50 ? WXP.longshot : 0);
      if (eid && enemyDef(eid)?.phases) xp += WXP.bossKill;
      addWeaponXp(k, wid, xp);
    }
    addRankXp(k, ev.pvp ? RXP.pvpKill : RXP.kill + (ev.head ? RXP.headshot : 0));
  });
  on("death", (ev) => {
    if (ev.victim instanceof Player) addStat(ev.victim, "deaths");
  });
  on("shot", (ev) => {
    if (ev.player instanceof Player) addStat(ev.player, "shots", ev.n ?? 1);
  });
  on("hit", (ev) => {
    const p = ev.shooter;
    if (!(p instanceof Player) || ev.dummy) return;
    addStat(p, "hits");
    if (ev.head) addStat(p, "headHits");
    const now = system.currentTick;
    const w = hitWin.get(p.id) ?? { t: now, n: 0 };
    if (now - w.t > 200) {
      w.t = now;
      w.n = 0;
    }
    if (w.n < WXP.hitCapPerMag && ev.weaponId) {
      w.n++;
      addWeaponXp(p, ev.weaponId, WXP.hit);
    }
    hitWin.set(p.id, w);
  });
  on("assist", (ev) => {
    const p = ev.player;
    if (!(p instanceof Player)) return;
    const s = S(p);
    if (s.weaponId) addWeaponXp(p, s.weaponId, WXP.assist);
    addRankXp(p, 5);
  });
  on("medUsed", (ev) => {
    addStat(ev.player, "medsUsed");
    progress(ev.player, "medsUsed", {});
  });
  on("structureCleared", (ev) => {
    for (const p of ev.players ?? []) {
      addStat(p, "structuresCleared");
      progress(p, "structuresCleared", {});
      addRankXp(p, RXP.structureClear);
    }
  });
  on("wave", (ev) => {
    for (const p of ev.players ?? []) {
      addStat(p, "wavesSurvived");
      progress(p, "wavesSurvived", {});
      addRankXp(p, RXP.wave);
    }
  });
  on("matchEnd", (ev) => {
    for (const p of ev.players ?? []) {
      addStat(p, "matchesPlayed");
      const win = (ev.winners ?? []).some((/** @type {Player} */ w) => w.id === p.id);
      if (win) {
        addStat(p, "matchWins");
        progress(p, "matchWins", {});
      }
      addRankXp(p, win ? RXP.matchWin : RXP.matchPlay);
    }
  });
  on("streakUsed", (ev) => {
    addStat(ev.player, "streaksUsed");
    progress(ev.player, "streaksUsed", {});
  });
  on("bossKill", (ev) => {
    for (const p of ev.players ?? []) {
      addStat(p, "bossKills");
      addRankXp(p, ev.xp ?? 0);
    }
  });
  world.afterEvents.playerSpawn.subscribe((ev) => safe("prog.spawn", () => {
    profile(ev.player);
    applyNameTag(ev.player);
  }));
}

/**
 * 近接武器・銃の ID（手に持っているもの）
 * @param {Player} p
 */
export function heldWeaponId(p) {
  const it = safe("prog.held", () => p.getComponent("minecraft:inventory")?.container?.getItem(p.selectedSlotIndex));
  if (!it) return undefined;
  return weaponIdOf(it.typeId) ?? meleeIdOf(it.typeId);
}

void NS;
