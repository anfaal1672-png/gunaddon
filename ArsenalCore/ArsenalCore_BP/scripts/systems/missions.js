// @ts-check
/**
 * ミッション（3.0）：依頼とキャンペーン
 *
 *  ・1 人 1 つ。受けると目標地点（55〜85 ブロック先）が決まり、HUD とアクションバーで方向と距離を示す
 *  ・敵は近づいたときに初めて出す（遠くでは何も動かさない。10 tick ごとに有効な任務だけを見る）
 *  ・出した敵には arsenal_ms:<番号> のタグ。死亡を数えて進める。標的（賞金首・ボス）には arsenal_mst も付ける
 *  ・状態はプレイヤーのダイナミックプロパティ a:mis（JSON）。ワールドを閉じても続きから
 *  ・終わった・中止した任務の敵は arsenal:release で普通の敵に戻す（遠ざかれば消える）
 */
import { world, system, Player } from "@minecraft/server";
import { DATA, NS } from "../config/constants.js";
import { S } from "../core/state.js";
import { W as WS } from "../core/settings.js";
import { status } from "../core/reload.js";
import { giveStack } from "../core/inventory.js";
import { spawnEnemy, aiOf } from "./ai/brain.js";
import { groundBelow } from "./bosses.js";
import { rollLoot } from "./lootgen.js";
import { addCredits } from "../economy/economy.js";
import { profile, rankOf, addRankXp, addStat, markProfileDirty } from "../progression/progression.js";
import { emit, playNear, playTo, explosionFx } from "../fx/effects.js";
import { addHud2Provider, announce } from "../ui/hud2.js";
import { isLoaded } from "../util/math.js";
import { t, raw } from "../util/i18n.js";
import { safe } from "../util/log.js";

const TYPES = /** @type {Record<string, any>} */ (DATA.MISSION_TYPES);
const RULES = /** @type {any} */ (DATA.MISSION_RULES);
const CAMPAIGN = /** @type {any[]} */ (DATA.CAMPAIGN);
const FACTIONS = /** @type {Record<string, any>} */ (DATA.FACTIONS);
const ENEMIES = /** @type {Record<string, any>} */ (DATA.ENEMIES);
const KEY = "a:mis";
const STEP = 10;

/**
 * k … "c" キャンペーン / "x" 依頼。ph … go 移動 / fight 交戦 / hold 防衛 / extract 離脱
 * need・got … 進み具合（掃討＝倒した数、回収＝秒、防衛＝ウェーブ、賞金首・ボス＝標的）。left … 生きている出した敵
 * @typedef {{k:"c"|"x", id:string, ty:string, fac:string, dim:string, x:number, z:number, y:number|null, ph:string, n:number,
 *   need:number, got:number, left:number, wave:number, gap:number, cr:number, xp:number, loot:string, ens:[string, number][], tgt:string|null}} Mission
 */

/** プレイヤー ID → 任務（読み込んだもの。null は「無い」と確認済み） @type {Map<string, Mission|null>} */
const active = new Map();
/** 中止したあと次を受けられるまで @type {Map<string, number>} */
const cooldown = new Map();
/** 外から差し替え（テスト） */
let inMatchFn = (/** @type {Player} */ _p) => false;
/** @param {(p:Player)=>boolean} fn */
export function setMissionMatchCheck(fn) {
  inMatchFn = fn;
}

/** @param {Player} p @returns {Mission|null} */
export function missionOf(p) {
  if (active.has(p.id)) return active.get(p.id) ?? null;
  /** @type {Mission|null} */
  let m = null;
  const s = safe("mis.load", () => p.getDynamicProperty(KEY));
  if (typeof s === "string") safe("mis.parse", () => {
    const o = JSON.parse(s);
    if (o && TYPES[o.ty]) m = o;
  });
  active.set(p.id, m);
  return m;
}

/** @param {Player} p @param {Mission|null} m */
function save(p, m) {
  active.set(p.id, m);
  safe("mis.save", () => p.setDynamicProperty(KEY, m ? JSON.stringify(m) : undefined));
}

function nextN() {
  const n = /** @type {number} */ (safe("mis.n", () => world.getDynamicProperty("a:mis_n")) ?? 0) + 1;
  safe("mis.n.save", () => world.setDynamicProperty("a:mis_n", n));
  return n;
}

/** @param {number[]} r */
const between = (r) => r[0] + Math.floor(Math.random() * (r[1] - r[0] + 1));

// ---------------------------------------------------------------------------
//  依頼の中身
// ---------------------------------------------------------------------------

/** ワールド設定で ON の勢力 */
function enabledFactions() {
  const ws = /** @type {any} */ (WS());
  const l = DATA.CONTRACT_FACTIONS.filter((f) => ws[FACTIONS[f]?.setting ?? f] !== false);
  return l.length ? l : ["raiders"];
}

/** 階級で出せる敵 @param {string} fac @param {number} rank */
export function enemyPool(fac, rank) {
  const maxTier = rank >= RULES.tier3From ? 3 : rank >= RULES.tier2From ? 2 : 1;
  return Object.keys(ENEMIES).filter((id) => ENEMIES[id].faction === fac && (ENEMIES[id].tier ?? 1) <= maxTier);
}

/** @param {string} ty @param {string} fac @param {number} rank @returns {[string, number][]} */
function rollRoster(ty, fac, rank) {
  const pool = enemyPool(fac, rank);
  const n = between(TYPES[ty].count) + Math.floor(rank / RULES.rankPerExtra);
  /** @type {Record<string, number>} */
  const c = {};
  for (let i = 0; i < n && pool.length; i++) {
    const id = pool[Math.floor(Math.random() * pool.length)];
    c[id] = (c[id] ?? 0) + 1;
  }
  return Object.entries(c);
}

/** 賞金首の標的：その勢力でいちばん強い（tier の高い）兵 @param {string} fac */
function bountyTarget(fac) {
  const l = Object.keys(ENEMIES).filter((id) => ENEMIES[id].faction === fac && ENEMIES[id].role !== "drone");
  l.sort((a, b) => (ENEMIES[b].tier ?? 1) - (ENEMIES[a].tier ?? 1) || ENEMIES[b].health - ENEMIES[a].health);
  return l[0];
}

/** 依頼の報酬 @param {string} ty @param {number} rank */
export function contractReward(ty, rank) {
  const k = 1 + rank * RULES.rankScale;
  return { cr: Math.round((TYPES[ty].credits * k) / 10) * 10, xp: Math.round(TYPES[ty].xp * k) };
}

/** 依頼の一覧（足りなければ引き直す） @param {Player} p @returns {{ty:string, fac:string}[]} */
export function offers(p) {
  const prof = /** @type {any} */ (profile(p));
  if (!Array.isArray(prof.offers)) prof.offers = [];
  const fac = enabledFactions();
  let changed = false;
  for (let i = 0; i < RULES.offers; i++) {
    const o = prof.offers[i];
    if (o && TYPES[o.ty] && fac.includes(o.fac)) continue;
    prof.offers[i] = { ty: DATA.CONTRACT_TYPES[Math.floor(Math.random() * DATA.CONTRACT_TYPES.length)], fac: fac[Math.floor(Math.random() * fac.length)] };
    changed = true;
  }
  prof.offers.length = RULES.offers;
  if (changed) markProfileDirty(p);
  return prof.offers;
}

/** キャンペーンの進み具合（クリアした話の数） @param {Player} p */
export function campaignProgress(p) {
  return Math.max(0, Math.min(CAMPAIGN.length, Number(/** @type {any} */ (profile(p)).cp) || 0));
}

// ---------------------------------------------------------------------------
//  受ける・やめる
// ---------------------------------------------------------------------------

/** @param {Player} p @returns {string|null} 受けられない理由のキー */
function canStart(p) {
  if (inMatchFn(p)) return "in_match";
  if (missionOf(p)) return "busy";
  if ((cooldown.get(p.id) ?? 0) > system.currentTick) return "wait";
  return null;
}

/** 目標地点 @param {Player} p */
function pickPoint(p) {
  const a = Math.random() * Math.PI * 2;
  const d = RULES.distance[0] + Math.random() * (RULES.distance[1] - RULES.distance[0]);
  return { x: Math.floor(p.location.x + Math.cos(a) * d), z: Math.floor(p.location.z + Math.sin(a) * d) };
}

/**
 * @param {Player} p @param {"c"|"x"} k @param {string} id @param {string} ty @param {string} fac
 * @param {{cr:number, xp:number, loot:string, ens:[string, number][], tgt:string|null}} o
 */
function begin(p, k, id, ty, fac, o) {
  const pt = pickPoint(p);
  const def = TYPES[ty];
  /** @type {Mission} */
  const m = {
    k, id, ty, fac, dim: p.dimension.id, x: pt.x, z: pt.z, y: null, ph: "go", n: nextN(),
    need: ty === "intel" ? def.hold : ty === "defend" ? def.waves : ty === "sweep" ? o.ens.reduce((a, e) => a + e[1], 0) : 1,
    got: 0, left: 0, wave: 0, gap: 0, cr: o.cr, xp: o.xp, loot: o.loot, ens: o.ens, tgt: o.tgt,
  };
  save(p, m);
  playTo(p, "arsenal.ui.streak_ready");
  announce(p, raw("§e", t("arsenal.mission.started"), " §f", title(m)), 60);
  p.sendMessage(raw("§e", t("arsenal.mission.started"), " §f", title(m), "§7 - ", { translate: `arsenal.mission.type.${ty}.desc` }));
  return m;
}

/**
 * 依頼を受ける
 * @param {Player} p @param {number} idx @returns {string|null} 受けられない理由のキー（null で成功）
 */
export function startContract(p, idx) {
  const why = canStart(p);
  if (why) return why;
  const list = offers(p);
  const o = list[idx];
  if (!o) return "unknown";
  const rank = rankOf(p);
  const rw = contractReward(o.ty, rank);
  const ens = rollRoster(o.ty, o.fac, rank);
  begin(p, "x", `x${idx}`, o.ty, o.fac, { ...rw, loot: TYPES[o.ty].loot, ens, tgt: o.ty === "bounty" ? bountyTarget(o.fac) : null });
  // 受けた枠は次のために引き直す
  /** @type {any} */ (profile(p)).offers[idx] = null;
  offers(p);
  return null;
}

/**
 * キャンペーンの次の話を始める
 * @param {Player} p @returns {string|null}
 */
export function startCampaign(p) {
  const why = canStart(p);
  if (why) return why;
  const c = CAMPAIGN[campaignProgress(p)];
  if (!c) return "campaign_done";
  begin(p, "c", c.id, c.type, c.faction, { cr: c.credits, xp: c.xp, loot: c.loot, ens: c.enemies.map((/** @type {any} */ e) => [e[0], e[1]]), tgt: c.boss ?? c.target ?? null });
  return null;
}

/** 任務をやめる @param {Player} p */
export function abandonMission(p) {
  const m = missionOf(p);
  if (!m) return false;
  release(m);
  save(p, null);
  cooldown.set(p.id, system.currentTick + RULES.abandonCooldown * 20);
  p.sendMessage(t("arsenal.mission.abandoned"));
  return true;
}

/** 出した敵を普通の敵に戻す（読み込まれている範囲だけ） @param {Mission} m */
function release(m) {
  const dim = safe("mis.dim", () => world.getDimension(m.dim));
  if (!dim) return;
  const list = safe("mis.rel", () => dim.getEntities({ tags: [`arsenal_ms:${m.n}`] })) ?? [];
  for (const e of list) safe("mis.rel.e", () => e.triggerEvent(`${NS}:release`));
}

// ---------------------------------------------------------------------------
//  表示
// ---------------------------------------------------------------------------

/** 任務の名前 @param {Mission} m @returns {import("@minecraft/server").RawMessage} */
export function title(m) {
  if (m.k === "c") return { translate: `arsenal.mission.c.${m.id}` };
  return raw({ translate: `arsenal.mission.type.${m.ty}` }, " - ", { translate: `arsenal.faction.${m.fac}` });
}

/** 目標の説明（今の段階） @param {Mission} m */
function objective(m) {
  if (m.ph === "go") return t("arsenal.mission.obj.go");
  if (m.ph === "extract") return t("arsenal.mission.obj.extract", String(TYPES.intel.extract));
  if (m.ty === "intel") return t("arsenal.mission.obj.intel", String(Math.floor(m.got)), String(m.need));
  if (m.ty === "defend") return t("arsenal.mission.obj.defend", String(m.wave), String(m.need));
  if (m.ty === "bounty" || m.ty === "boss") return t("arsenal.mission.obj.target");
  return t("arsenal.mission.obj.sweep", String(m.got), String(m.need));
}

/** メニュー用の説明 @param {Player} p */
export function missionBody(p) {
  const m = missionOf(p);
  const lines = [];
  const cp = campaignProgress(p);
  lines.push(raw("§l", t("arsenal.mission.campaign"), "§r §7", `${cp}/${CAMPAIGN.length}`));
  if (m) {
    const d = Math.round(Math.hypot(p.location.x - m.x, p.location.z - m.z));
    lines.push("", raw("§e", t("arsenal.mission.current"), " §f", title(m)));
    lines.push(raw("§7", objective(m)));
    lines.push(raw("§7", t("arsenal.mission.where", String(m.x), String(m.z), String(d))));
    lines.push(raw("§7", t("arsenal.mission.reward", String(m.cr), String(m.xp))));
  } else lines.push("", t("arsenal.mission.none"));
  return raw(...lines.flatMap((l, i) => (i ? ["\n", l] : [l])));
}

/** 進行方向の矢印（視線に対して 8 方向） @param {Player} p @param {Mission} m */
function arrow(p, m) {
  const yaw = (p.getRotation().y * Math.PI) / 180;
  const want = Math.atan2(-(m.x + 0.5 - p.location.x), m.z + 0.5 - p.location.z);
  let a = want - yaw;
  a = Math.atan2(Math.sin(a), Math.cos(a));
  return ["↑", "↗", "→", "↘", "↓", "↙", "←", "↖"][((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8];
}

/** HUD 2.0 のゲームモード欄に出す（試合中は試合が優先） @param {Player} p */
function hudProvider(p) {
  const m = active.get(p.id);
  if (!m || inMatchFn(p)) return null;
  const d = Math.min(9999, Math.round(Math.hypot(p.location.x - m.x, p.location.z - m.z)));
  /** @type {Record<string, string|number>} */
  const v = { gm: "6", tm: String(d).padStart(5, " ") };
  if (m.ty === "defend") {
    v.sa = m.wave;
    v.sb = m.left;
  } else if (m.ty === "intel") {
    v.sa = Math.floor(m.got);
    v.sb = m.need;
  } else {
    v.sa = m.got;
    v.sb = m.need;
  }
  return v;
}

// ---------------------------------------------------------------------------
//  出現
// ---------------------------------------------------------------------------

/**
 * 地表の高さ（木の上・水の上は避ける）
 * @param {import("@minecraft/server").Dimension} dim @param {number} x @param {number} z @param {number} refY
 * @returns {number|null}
 */
function surfaceY(dim, x, z, refY) {
  const top = safe("mis.top", () => /** @type {any} */ (dim).getTopmostBlock?.({ x, z }));
  if (top) {
    const id = String(top.typeId);
    if (id.includes("water") || id.includes("lava") || id.includes("leaves")) return null;
    return top.location.y + 1;
  }
  const g = groundBelow(dim, { x: x + 0.5, y: refY, z: z + 0.5 });
  return g ? g.y : null;
}

/**
 * 中心のまわりに 1 体出す
 * @param {import("@minecraft/server").Dimension} dim @param {Mission} m @param {{x:number,y:number,z:number}} c @param {number} r0 @param {number} r1 @param {string} eid
 */
function spawnAround(dim, m, c, r0, r1, eid) {
  for (let i = 0; i < 5; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = r0 + Math.random() * (r1 - r0);
    const x = Math.floor(c.x + Math.cos(a) * r);
    const z = Math.floor(c.z + Math.sin(a) * r);
    if (!isLoaded(dim, { x, y: c.y, z }, system.currentTick)) continue;
    const y = surfaceY(dim, x, z, c.y + 8);
    if (y === null || Math.abs(y - c.y) > 12) continue;
    const e = spawnEnemy(dim, { x: x + 0.5, y, z: z + 0.5 }, eid, { persist: true, tag: `arsenal_ms:${m.n}`, src: "mission" });
    if (e) {
      m.left++;
      return e;
    }
  }
  return undefined;
}

/** @param {import("@minecraft/server").Dimension} dim @param {Mission} m @param {{x:number,y:number,z:number}} c @param {number} r0 @param {number} r1 */
function spawnRoster(dim, m, c, r0, r1) {
  for (const [id, n] of m.ens) for (let i = 0; i < n; i++) spawnAround(dim, m, c, r0, r1, id);
}

/**
 * 出した敵にプレイヤーの居場所を知らせる（見えていない敵がそこへ向かう。防衛のウェーブ・回収の増援）
 * @param {import("@minecraft/server").Dimension} dim @param {Mission} m @param {Player} p
 */
function alertMine(dim, m, p) {
  const now = system.currentTick;
  const list = safe("mis.alert", () => dim.getEntities({ tags: [`arsenal_ms:${m.n}`], location: p.location, maxDistance: 64 })) ?? [];
  for (const e of list) {
    const ai = aiOf(e);
    if (ai && !ai.target) ai.alert = { pos: { ...p.location }, tick: now };
  }
}

/** 目標地点に着いた：敵を出す @param {Player} p @param {Mission} m @param {import("@minecraft/server").Dimension} dim */
function deploy(p, m, dim) {
  const c = { x: m.x + 0.5, y: /** @type {number} */ (m.y), z: m.z + 0.5 };
  m.left = 0;
  if (m.ty === "defend") {
    m.ph = "hold";
    m.gap = 4;
    announce(p, raw("§e", t("arsenal.mission.obj.defend_go")), 60);
    return;
  }
  if (m.ty === "boss") {
    playNear(dim, c, "arsenal.world.klaxon", { range: 128 });
    for (let i = 0; i < 3; i++) system.runTimeout(() => emit(dim, "arsenal:signal_smoke", c, undefined, { range: 128 }), i * 10);
    const e = spawnEnemy(dim, { x: c.x, y: c.y, z: c.z }, /** @type {string} */ (m.tgt), { persist: true, tag: `arsenal_ms:${m.n}`, src: "mission" });
    if (!e) return;
    safe("mis.boss.tag", () => e.addTag("arsenal_mst"));
    m.left = 1;
    explosionFx(dim, c, 1.5);
    announce(p, raw("§4", t("arsenal.boss.incoming", { translate: `entity.${NS}:${m.tgt}.name` })), 60);
  } else {
    spawnRoster(dim, m, c, 1.5, m.ty === "intel" ? 9 : 6);
    if (m.ty === "bounty" && m.tgt) {
      const e = spawnAround(dim, m, c, 0, 2, m.tgt);
      if (e) safe("mis.bounty", () => {
        e.addTag("arsenal_mst");
        e.addEffect("health_boost", 20 * 1800, { amplifier: TYPES.bounty.boost, showParticles: false });
        const h = e.getComponent("minecraft:health");
        if (h) h.setCurrentValue(h.effectiveMax);
        e.nameTag = "§c★ WANTED ★";
      });
    }
    if (m.left === 0 && m.ty !== "intel") return;
    announce(p, raw("§c", t("arsenal.mission.contact")), 40);
  }
  m.ph = "fight";
}

// ---------------------------------------------------------------------------
//  進行
// ---------------------------------------------------------------------------

/** 完了 @param {Player} p @param {Mission} m */
function complete(p, m) {
  release(m);
  save(p, null);
  addCredits(p, m.cr);
  addRankXp(p, m.xp);
  addStat(p, "missions");
  for (const it of rollLoot(m.loot)) giveStack(p, it);
  if (m.k === "c") {
    const prof = /** @type {any} */ (profile(p));
    const idx = CAMPAIGN.findIndex((c) => c.id === m.id);
    if (idx >= 0) prof.cp = Math.max(Number(prof.cp) || 0, idx + 1);
    markProfileDirty(p);
  }
  playTo(p, "arsenal.ui.challenge");
  announce(p, raw("§a", t("arsenal.mission.complete"), " §f", title(m)), 80);
  p.sendMessage(raw("§a", t("arsenal.mission.complete"), " §f", title(m), " §7", t("arsenal.mission.reward", String(m.cr), String(m.xp))));
  if (m.k === "c" && campaignProgress(p) >= CAMPAIGN.length) {
    world.sendMessage(raw("§6", { text: p.name }, " ", t("arsenal.mission.campaign_all")));
  }
}

/** @param {Player} p @param {Mission} m */
function step(p, m) {
  const now = system.currentTick;
  if (p.dimension.id !== m.dim) return;
  const dim = p.dimension;
  const loc = p.location;
  const d = Math.hypot(loc.x - (m.x + 0.5), loc.z - (m.z + 0.5));
  const s = S(p);
  let dirty = false;
  // 道案内（ほかの知らせが出ていないときだけ）
  const far = m.ph === "go" || m.ph === "extract" || (m.ty === "intel" && m.ph === "fight" && d > TYPES.intel.holdRadius) || (m.ph === "hold" && d > TYPES.defend.radius);
  if (far && s.statusMsgUntil <= now && now % 20 < STEP) {
    status(s, raw(arrow(p, m), " ", objective(m), ` §f${Math.round(d)}m`));
    s.statusMsgUntil = now + 25;
  }
  // 目標地点の目印（煙。2 秒ごと）
  if (m.y !== null && (m.ph === "go" || (m.ty === "intel" && m.ph === "fight")) && now % 40 < STEP && d < 96) {
    const c = { x: m.x + 0.5, y: m.y, z: m.z + 0.5 };
    if (isLoaded(dim, c, now)) emit(dim, "arsenal:signal_smoke", c, undefined, { range: 128 });
  }
  if (m.ph === "go") {
    if (d > RULES.spawnNear) return;
    const c = { x: m.x, y: m.y ?? loc.y, z: m.z };
    if (!isLoaded(dim, c, now)) return;
    if (m.y === null) {
      let y = null;
      for (let i = 0; i < 4 && y === null; i++) {
        y = surfaceY(dim, m.x, m.z, loc.y + 10);
        if (y === null) {
          m.x += Math.round((Math.random() - 0.5) * 12);
          m.z += Math.round((Math.random() - 0.5) * 12);
        }
      }
      m.y = y ?? Math.floor(loc.y);
      dirty = true;
    }
    if (m.ty === "defend" && d > TYPES.defend.radius) {
      if (dirty) save(p, m);
      return;
    }
    deploy(p, m, dim);
    save(p, m);
    return;
  }
  // 数え直し（死亡を取りこぼした・消えた敵）。近くにいるときだけ
  if (now % 100 < STEP && d < 40 && m.left > 0) {
    const n = (safe("mis.count", () => dim.getEntities({ tags: [`arsenal_ms:${m.n}`], location: { x: m.x + 0.5, y: m.y ?? loc.y, z: m.z + 0.5 }, maxDistance: 64 })) ?? []).length;
    if (n < m.left) {
      if ((m.ty === "bounty" || m.ty === "boss") && n === 0 && m.got === 0) {
        // 標的が消えた（倒されずに）→ 出し直す
        m.ph = "go";
        m.left = 0;
        save(p, m);
        return;
      }
      m.left = n;
      dirty = true;
    }
  }
  if (m.ph === "fight") {
    if (m.ty === "sweep") {
      if (m.left <= 0) return complete(p, m);
    } else if (m.ty === "bounty" || m.ty === "boss") {
      if (m.got >= 1) return complete(p, m);
    } else if (m.ty === "intel") {
      if (d <= TYPES.intel.holdRadius) {
        m.got = Math.min(m.need, m.got + STEP / 20);
        dirty = true;
        if (Math.floor(m.got) !== Math.floor(m.got - STEP / 20)) playTo(p, "arsenal.ui.radio");
        if (m.got >= m.need) {
          m.ph = "extract";
          const c = { x: m.x + 0.5, y: /** @type {number} */ (m.y), z: m.z + 0.5 };
          const pool = enemyPool(m.fac, rankOf(p));
          for (let i = 0; i < TYPES.intel.reinforce && pool.length; i++) spawnAround(dim, m, c, 16, 24, pool[Math.floor(Math.random() * pool.length)]);
          alertMine(dim, m, p);
          announce(p, raw("§e", t("arsenal.mission.intel_done")), 60);
          playTo(p, "arsenal.ui.streak_ready");
        }
      }
    }
  } else if (m.ph === "extract") {
    if (d >= TYPES.intel.extract) return complete(p, m);
  } else if (m.ph === "hold") {
    const def = TYPES.defend;
    if (d > def.radius) {
      if (now % 60 < STEP) announce(p, raw("§c", t("arsenal.mission.return")), 30);
    } else if (m.left > 0) {
      // 見えていないウェーブの敵を呼び寄せる（4 秒ごと）
      if (now % 80 < STEP) alertMine(dim, m, p);
    } else {
      if (m.wave >= m.need) return complete(p, m);
      if (m.gap > 0) {
        m.gap--;
        dirty = true;
      } else {
        m.wave++;
        const c = { x: m.x + 0.5, y: /** @type {number} */ (m.y), z: m.z + 0.5 };
        // ウェーブごとに 1 体ずつ増える
        const extra = m.wave - 1;
        spawnRoster(dim, m, c, def.spawnDist[0], def.spawnDist[1]);
        const pool = enemyPool(m.fac, rankOf(p));
        for (let i = 0; i < extra && pool.length; i++) spawnAround(dim, m, c, def.spawnDist[0], def.spawnDist[1], pool[Math.floor(Math.random() * pool.length)]);
        m.gap = def.waveGap * 2;
        dirty = true;
        alertMine(dim, m, p);
        announce(p, raw("§c", t("arsenal.mission.wave", String(m.wave), String(m.need))), 50);
        playNear(dim, c, "arsenal.world.klaxon", { range: 64 });
      }
    }
  }
  if (dirty) save(p, m);
}

/** 毎 tick（中で 10 tick ごとに間引く） */
export function tickMissions() {
  const now = system.currentTick;
  if (now % STEP !== 3 || !active.size) return;
  for (const [id, m] of active) {
    if (!m) continue;
    const p = /** @type {Player|undefined} */ (safe("mis.p", () => world.getEntity(id)));
    if (!p || !p.isValid) continue;
    safe("mis.step", () => step(p, m));
  }
}

/** 出した敵の死亡 @param {import("@minecraft/server").Entity} e */
function onDeath(e) {
  const tags = safe("mis.tags", () => e.getTags()) ?? [];
  const tag = tags.find((x) => x.startsWith("arsenal_ms:"));
  if (!tag) return;
  const n = Number(tag.slice("arsenal_ms:".length));
  for (const [id, m] of active) {
    if (!m || m.n !== n) continue;
    m.left = Math.max(0, m.left - 1);
    if (m.ty === "sweep") m.got = Math.min(m.need, m.got + 1);
    if (tags.includes("arsenal_mst")) m.got = 1;
    const p = /** @type {Player|undefined} */ (safe("mis.p2", () => world.getEntity(id)));
    if (p) save(p, m);
    return;
  }
}

export function attachMissions() {
  addHud2Provider(hudProvider);
  world.afterEvents.entityDie.subscribe((ev) => safe("mis.die", () => onDeath(ev.deadEntity)));
  world.afterEvents.playerSpawn.subscribe((ev) => safe("mis.spawn", () => {
    if (ev.initialSpawn) missionOf(ev.player);
  }));
  world.afterEvents.playerLeave.subscribe((ev) => {
    active.delete(ev.playerId);
    cooldown.delete(ev.playerId);
  });
}

/** テスト用：読み込み直しを強いる @param {string} [id] */
export function __forgetMission(id) {
  if (id) active.delete(id);
  else active.clear();
}
