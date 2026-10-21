// @ts-check
/**
 * 戦術 AI（3 勢力の敵・ボスの共通の頭脳）
 *
 * 役割分担
 *   ・移動・索敵・射撃のタイミングはエンジンの行動（エンティティ定義のコンポーネントグループ）に任せる
 *       arsenal:engage … 通常（近づいて撃つ）/ arsenal:hold … その場で撃つ / arsenal:move … 道しるべ（arsenal:waypoint）へ向かう
 *   ・スクリプトは「どのグループにするか」「どこへ動かすか（遮蔽・側面・後退・様子見）」と役割ごとの特殊行動を決める
 *   ・エンジンの射撃は合図（arsenal:ai_shot）だけ撃たせ、出現した瞬間に消して、ここで弾道計算（難易度の拡散・距離減衰・部位・防具）をやり直す
 *
 * 予算（AI_BUDGET）
 *   ・1 tick に考える AI は thinkPerTick 体まで。各 AI は 5〜10 tick ごと（難易度で変わる）に 1 回だけ考える
 *   ・1 次元あたり maxActive 体を超えた分は考えない（エンジンの行動だけで動く）
 *   ・遮蔽物探しは 1 回あたり coverSamples 本のレイまで、同じ AI は 60 tick に 1 回まで
 */
import { world, system, Player, EntityInitializationCause, GameMode } from "@minecraft/server";
import { DATA, ENTITY, NS, enemyIdOf, enemyDef } from "../../config/constants.js";
import { W as WS } from "../../core/settings.js";
import { S } from "../../core/state.js";
import { computeStats } from "../../core/weaponState.js";
import { traceHitscan, whizzBy, drawTracer, isSupersonic } from "../../core/ballistics.js";
import { setEnemyDamageMul, explode, canDamage, onLimbHit } from "../../core/damage.js";
import { stealthFactor } from "../../core/armor.js";
import { fireGrenade40, fireMortar, throwAt, setEmpHandler, getDecoys } from "../projectiles.js";
import { setStunHandler } from "../fields.js";
import { gunshot, muzzleFx, emit, playNear, playTo } from "../../fx/effects.js";
import { add, sub, mul, norm, dist, dot, cone, basis, isLoaded, rand, len, hitPoint } from "../../util/math.js";
import { safe } from "../../util/log.js";
import { t } from "../../util/i18n.js";

const BUDGET = DATA.AI_BUDGET;
const DIFF = /** @type {Record<string, any>} */ (DATA.AI_DIFFICULTY);
const FACTIONS = /** @type {Record<string, any>} */ (DATA.FACTIONS);
const ROBOT_MODELS = new Set(["robot", "shield_bot", "mortar_bot", "drone", "juggernaut"]);
const LEGACY_BULLETS = new Set(Object.keys(DATA.RAIDERS).map((r) => `${NS}:${r}_bullet`));

/** 役割ごとの基本の拡散（度） */
const ROLE_SPREAD = { rifle: 2.0, leader: 1.8, sniper: 0.45, heavy: 3.2, medic: 2.4, demo: 2.0, shield: 2.6, drone: 3.0, mortar: 2.5 };

/**
 * @typedef {Object} AI
 * @property {string} id
 * @property {string} eid 敵の ID
 * @property {any} def
 * @property {import("@minecraft/server").Entity} ent
 * @property {number} next 次に考える tick
 * @property {"engage"|"hold"|"move"} mode
 * @property {string|null} target
 * @property {number} targetTick
 * @property {string|null} wp 道しるべ
 * @property {import("../../util/math.js").Vec3|null} wpPos
 * @property {number} moveUntil
 * @property {string} moveWhy
 * @property {number} coverTick
 * @property {Record<string, number>} cd クールダウン（行動 → 次に使える tick）
 * @property {number} empUntil
 * @property {number} stunUntil
 * @property {{pos:import("../../util/math.js").Vec3, tick:number}|null} alert 味方・自分が最後に見た敵の位置
 * @property {number} lastHurt
 * @property {boolean} retreated
 * @property {number} fuseAt 自爆の起爆 tick（-1 なし）
 * @property {number} spotTick
 */

/** @type {Map<string, AI>} */
const registry = new Map();
/** 考える順番（ラウンドロビン） @type {string[]} */
let queue = [];
let qi = 0;
/** スクリプトから出現させた敵（自然発生の設定に関係なく残す） */
const scripted = new Set();
/** 1 tick に考えた数（テスト・報告用） */
const stats = { thinks: 0, shots: 0, maxThinkPerTick: 0, skipped: 0 };

/** @type {((ai:AI, now:number)=>boolean)[]} ボスなどが特別な思考を登録する（true を返すと通常の思考をしない） */
const thinkHooks = [];
/** @param {(ai:AI, now:number)=>boolean} fn */
export function addThinkHook(fn) {
  thinkHooks.push(fn);
}

/** 難易度の補正 */
function diff() {
  return DIFF[WS().aiDifficulty] ?? DIFF.normal;
}

/** 難易度が変わったら敵の弾の倍率を更新（毎秒） */
function syncDifficulty() {
  setEnemyDamageMul(diff().damage);
}

/** 勢力が有効か @param {string} faction */
function factionEnabled(faction) {
  const f = FACTIONS[faction];
  if (!f) return true;
  return /** @type {any} */ (WS())[f.setting] !== false;
}

// ---------------------------------------------------------------------------
//  登録
// ---------------------------------------------------------------------------

/**
 * @param {import("@minecraft/server").Entity} e
 * @returns {AI|undefined}
 */
function register(e) {
  const eid = enemyIdOf(e.typeId);
  if (!eid) return undefined;
  const have = registry.get(e.id);
  if (have) {
    have.ent = e;
    return have;
  }
  const def = enemyDef(eid);
  const now = system.currentTick;
  /** @type {AI} */
  const ai = {
    id: e.id, eid, def, ent: e, next: now + Math.floor(rand(1, 10)), mode: "engage", target: null, targetTick: -99,
    wp: null, wpPos: null, moveUntil: 0, moveWhy: "", coverTick: -99, cd: {}, empUntil: 0, stunUntil: 0, alert: null,
    lastHurt: -99, retreated: false, fuseAt: -1, spotTick: -99,
  };
  registry.set(e.id, ai);
  queue.push(e.id);
  // 1.0 系のワールドから来た敵：新しい行動グループを付ける（1 回だけ）
  safe("ai.init", () => {
    if (e.getDynamicProperty("a:ai") !== 1) {
      e.triggerEvent(`${NS}:init`);
      e.setDynamicProperty("a:ai", 1);
    }
  });
  return ai;
}

/** @param {string} id */
function unregister(id) {
  const ai = registry.get(id);
  if (!ai) return;
  registry.delete(id);
  clearWaypoint(ai);
}

/**
 * 敵を出現させる（構造物・ゲームモード・ボス・召喚）
 * @param {import("@minecraft/server").Dimension} dim @param {import("../../util/math.js").Vec3} loc @param {string} eid
 * @param {{persist?:boolean, tag?:string, src?:string}} [o]
 */
export function spawnEnemy(dim, loc, eid, o = {}) {
  if (!isLoaded(dim, loc, system.currentTick)) return undefined;
  return safe("ai.spawn", () => {
    const e = dim.spawnEntity(`${NS}:${eid}`, loc);
    scripted.add(e.id);
    if (o.persist) e.triggerEvent(`${NS}:persist`);
    if (o.tag) e.addTag(o.tag);
    if (o.src) e.setDynamicProperty("a:src", o.src);
    e.setDynamicProperty("a:ai", 1);
    register(e);
    return e;
  });
}

/** @param {import("@minecraft/server").Entity} e */
export function aiOf(e) {
  return registry.get(e.id);
}

export function aiCount() {
  return registry.size;
}
export function aiStats() {
  return { ...stats, registered: registry.size };
}

// ---------------------------------------------------------------------------
//  行動グループの切り替え・道しるべ
// ---------------------------------------------------------------------------

/** @param {AI} ai @param {"engage"|"hold"|"move"} mode */
function setMode(ai, mode) {
  if (ai.mode === mode) return;
  ai.mode = mode;
  safe("ai.mode", () => ai.ent.triggerEvent(`${NS}:ai_${mode}`));
}

/** @param {AI} ai */
function clearWaypoint(ai) {
  if (ai.wp) {
    const w = world.getEntity(ai.wp);
    if (w && w.isValid) safe("ai.wp.remove", () => w.remove());
  }
  ai.wp = null;
  ai.wpPos = null;
  ai.moveUntil = 0;
}

/**
 * 道しるべへ移動させる
 * @param {AI} ai @param {import("../../util/math.js").Vec3} pos @param {string} why @param {number} ticks
 */
function moveTo(ai, pos, why, ticks = 160) {
  const dim = ai.ent.dimension;
  if (!isLoaded(dim, pos, system.currentTick)) return false;
  clearWaypoint(ai);
  const w = safe("ai.wp", () => dim.spawnEntity(ENTITY.waypoint, pos));
  if (!w) return false;
  ai.wp = w.id;
  ai.wpPos = { ...pos };
  ai.moveUntil = system.currentTick + ticks;
  ai.moveWhy = why;
  // 飛行する敵は道しるべを使わず、その場で待つ（ホバリングの行動が自然に寄っていく）
  if (ai.def.flying) {
    safe("ai.fly", () => ai.ent.teleport(ai.ent.location, { facingLocation: pos }));
    return true;
  }
  ai.mode = "engage"; // 強制的に切り替える
  setMode(ai, "move");
  return true;
}

// ---------------------------------------------------------------------------
//  視界・目標
// ---------------------------------------------------------------------------

/**
 * 見通しがあるか
 * @param {import("@minecraft/server").Dimension} dim @param {import("../../util/math.js").Vec3} a @param {import("../../util/math.js").Vec3} b
 */
export function hasLos(dim, a, b) {
  const now = system.currentTick;
  if (!isLoaded(dim, a, now) || !isLoaded(dim, b, now)) return false;
  const v = sub(b, a);
  const L = len(v);
  if (L < 0.5) return true;
  const hit = safe("ai.los", () => dim.getBlockFromRay(a, mul(v, 1 / L), { maxDistance: L, includeLiquidBlocks: false, includePassableBlocks: false }));
  if (!hit) return true;
  const hp = hitPoint(hit);
  return dist(a, hp) >= L - 0.4;
}

/** 目標にしてよい相手か @param {import("@minecraft/server").Entity} e */
function targetable(e) {
  if (!e.isValid) return false;
  if (e instanceof Player) {
    const gm = safe("ai.gm", () => e.getGameMode());
    return gm !== GameMode.Creative && gm !== GameMode.Spectator;
  }
  return true;
}

/**
 * 見えている一番近い敵（プレイヤー・プレイヤーの設置物）
 * @param {AI} ai
 */
function findTarget(ai) {
  const e = ai.ent;
  const dim = e.dimension;
  const eye = e.getHeadLocation();
  const sight = ai.def.sight ?? ai.def.range + 8;
  /** @type {import("@minecraft/server").Entity|null} */
  let best = null;
  let bestD = Infinity;
  /** @type {import("@minecraft/server").Entity[]} */
  const cands = [];
  safe("ai.scan", () => {
    for (const p of dim.getPlayers({ location: e.location, maxDistance: sight })) cands.push(p);
    for (const d of dim.getEntities({ location: e.location, maxDistance: sight, families: ["arsenal_player_deployable"] })) cands.push(d);
    for (const d of dim.getEntities({ location: e.location, maxDistance: sight, families: ["arsenal_squad"] })) cands.push(d);
  });
  for (const c of cands) {
    if (!targetable(c)) continue;
    const d = dist(c.location, e.location);
    const eff = d / stealthFactor(c);
    if (eff > sight || eff >= bestD) continue;
    const head = c instanceof Player ? c.getHeadLocation() : c.getAABB().center;
    if (!hasLos(dim, eye, head)) continue;
    best = c;
    bestD = eff;
  }
  return best;
}

/** 近くの同じ勢力の AI @param {AI} ai @param {number} r */
function squad(ai, r) {
  /** @type {AI[]} */
  const out = [];
  const loc = ai.ent.location;
  for (const o of registry.values()) {
    if (o === ai || o.def.faction !== ai.def.faction || !o.ent.isValid || o.ent.dimension.id !== ai.ent.dimension.id) continue;
    if (dist(o.ent.location, loc) <= r) out.push(o);
  }
  return out;
}

/**
 * 味方へ敵の位置を知らせる
 * @param {AI} ai @param {import("../../util/math.js").Vec3} pos @param {number} r
 */
function share(ai, pos, r) {
  const now = system.currentTick;
  for (const o of squad(ai, r)) {
    if (!o.alert || now - o.alert.tick > 20) o.alert = { pos: { ...pos }, tick: now };
  }
}

// ---------------------------------------------------------------------------
//  遮蔽・側面
// ---------------------------------------------------------------------------

/**
 * 足場の高さ（上から下へのレイ）
 * @param {import("@minecraft/server").Dimension} dim @param {number} x @param {number} y @param {number} z
 */
function groundAt(dim, x, y, z) {
  const from = { x, y: y + 3, z };
  if (!isLoaded(dim, from, system.currentTick)) return null;
  const hit = safe("ai.ground", () => dim.getBlockFromRay(from, { x: 0, y: -1, z: 0 }, { maxDistance: 7, includeLiquidBlocks: true, includePassableBlocks: false }));
  if (!hit) return null;
  if (hit.block.isLiquid) return null;
  return { x: Math.floor(x) + 0.5, y: hit.block.location.y + 1, z: Math.floor(z) + 0.5 };
}

/**
 * 遮蔽物の陰（目標から頭が見えない地点）を探す
 * @param {AI} ai @param {import("../../util/math.js").Vec3} threat @param {boolean} away 目標から離れる方向を優先
 */
function findCover(ai, threat, away) {
  const e = ai.ent;
  const dim = e.dimension;
  const R = BUDGET.coverSearchRadius;
  const base = e.location;
  const toT = norm({ x: threat.x - base.x, y: 0, z: threat.z - base.z });
  /** @type {import("../../util/math.js").Vec3|null} */
  let best = null;
  let bestScore = -Infinity;
  for (let i = 0; i < BUDGET.coverSamples; i++) {
    const a = (i / BUDGET.coverSamples) * Math.PI * 2 + rand(-0.2, 0.2);
    const r = rand(2.5, R);
    const x = base.x + Math.cos(a) * r;
    const z = base.z + Math.sin(a) * r;
    const g = groundAt(dim, x, base.y, z);
    if (!g || Math.abs(g.y - base.y) > 2) continue;
    const head = { x: g.x, y: g.y + 1.5, z: g.z };
    if (hasLos(dim, threat, head)) continue;
    const off = sub(g, base);
    const along = dot(norm({ x: off.x, y: 0, z: off.z }), toT);
    const score = (away ? -along : 0.3 - Math.abs(along)) * 2 - len(off) * 0.15 + rand(0, 0.3);
    if (score > bestScore) {
      bestScore = score;
      best = g;
    }
  }
  return best;
}

/**
 * 側面へ回り込む地点（目標を中心に 90° ずれた位置）
 * @param {AI} ai @param {import("../../util/math.js").Vec3} threat
 */
function flankPoint(ai, threat) {
  const e = ai.ent;
  const v = sub(e.location, threat);
  const d = Math.max(6, Math.min(14, Math.hypot(v.x, v.z)));
  const s = Math.random() < 0.5 ? 1 : -1;
  const ang = Math.atan2(v.z, v.x) + (s * Math.PI) / 2.2;
  return groundAt(e.dimension, threat.x + Math.cos(ang) * d, e.location.y, threat.z + Math.sin(ang) * d);
}

// ---------------------------------------------------------------------------
//  思考
// ---------------------------------------------------------------------------

/** @param {AI} ai */
function health01(ai) {
  const h = safe("ai.hp", () => ai.ent.getComponent("minecraft:health"));
  return h ? h.currentValue / Math.max(1, h.effectiveMax) : 1;
}

/**
 * @param {AI} ai @param {number} now
 */
function think(ai, now) {
  const e = ai.ent;
  if (!e.isValid) {
    unregister(ai.id);
    return;
  }
  if (!isLoaded(e.dimension, e.location, now)) return;
  for (const h of thinkHooks) if (safe("ai.hook", () => h(ai, now))) return;
  // スタン・EMP 中は動かない
  if (ai.stunUntil > now || ai.empUntil > now) {
    setMode(ai, "hold");
    return;
  }
  // 移動中：到着・時間切れ
  if (ai.moveUntil > 0) {
    const arrived = ai.wpPos && dist(e.location, ai.wpPos) < 1.8;
    if (arrived || now >= ai.moveUntil) {
      clearWaypoint(ai);
      setMode(ai, ai.moveWhy === "cover" || ai.moveWhy === "retreat" ? "hold" : "engage");
    } else if (ai.moveWhy !== "retreat" && ai.moveWhy !== "heal") {
      // 移動中でも目の前に敵が出たら撃ち合いに戻る（近すぎるとき）
      const tg = ai.target ? world.getEntity(ai.target) : undefined;
      if (tg && tg.isValid && dist(tg.location, e.location) < 6) {
        clearWaypoint(ai);
        setMode(ai, "engage");
      }
      return;
    } else return;
  }

  // 目標の更新（20 tick ごと）
  /** @type {import("@minecraft/server").Entity|null|undefined} */
  let tg = ai.target ? world.getEntity(ai.target) : null;
  if (now - ai.targetTick >= 20 || !tg || !tg.isValid) {
    tg = findTarget(ai);
    ai.target = tg ? tg.id : null;
    ai.targetTick = now;
    if (tg) {
      ai.alert = { pos: { ...tg.location }, tick: now };
      if (ai.def.role === "leader" || ai.def.role === "drone") share(ai, tg.location, BUDGET.squadRadius * 2);
      else share(ai, tg.location, BUDGET.squadRadius * 0.6);
    }
  }
  const role = ai.def.role;
  const d = tg ? dist(tg.location, e.location) : Infinity;
  const hp = health01(ai);
  const df = diff();

  switch (role) {
    case "sniper": {
      if (tg && d < 9 && now - ai.coverTick > 60) {
        ai.coverTick = now;
        const c = findCover(ai, tg.getHeadLocation ? tg.getHeadLocation() : tg.location, true);
        if (c) {
          moveTo(ai, c, "retreat", 100);
          return;
        }
      }
      setMode(ai, tg ? "hold" : "engage");
      break;
    }
    case "mortar": {
      setMode(ai, tg && d >= (ai.def.minRange ?? 10) ? "hold" : "engage");
      break;
    }
    case "leader": {
      setMode(ai, tg && d <= ai.def.range ? "hold" : "engage");
      break;
    }
    case "medic": {
      if (medicThink(ai, now)) return;
      setMode(ai, "engage");
      break;
    }
    case "demo": {
      if (tg && d >= 6 && d <= 22 && (ai.cd.grenade ?? 0) <= now && Math.random() < 0.5 * df.grenade) {
        ai.cd.grenade = now + Math.round((ai.def.grenadeCooldown ?? 160) / df.grenade);
        const aim = add(tg.location, { x: rand(-1.5, 1.5), y: 0, z: rand(-1.5, 1.5) });
        safe("ai.grenade", () => throwAt(e, ai.def.grenade ?? "grenade_frag", aim));
        playNear(e.dimension, e.location, "arsenal.fx.grenade_pin", { range: 16 });
      }
      setMode(ai, "engage");
      break;
    }
    case "drone": {
      if (tg && now - ai.spotTick > 60) {
        ai.spotTick = now;
        spot(ai, tg);
      }
      break;
    }
    case "bomber": {
      bomberThink(ai, tg, d, now);
      return;
    }
    case "melee":
    case "shield":
    case "heavy":
    default:
      setMode(ai, "engage");
  }

  // 撃ち合いで弱ったら遮蔽へ（1 回だけ）
  if (tg && hp < 0.4 && !ai.retreated && role !== "melee" && role !== "bomber" && role !== "drone" && !ai.def.phases && now - ai.coverTick > 60) {
    ai.coverTick = now;
    ai.retreated = true;
    const c = findCover(ai, tg.location, true);
    if (c && moveTo(ai, c, "cover", 120)) return;
  }
  // 側面へ回り込む（分隊がいて、撃ち合いが続いているとき）
  if (tg && (role === "rifle" || role === "shield") && d > 8 && d < 30 && now - ai.coverTick > 200 && Math.random() < df.flank * 0.35) {
    ai.coverTick = now;
    if (squad(ai, BUDGET.squadRadius).length >= 1) {
      const f = flankPoint(ai, tg.location);
      if (f && moveTo(ai, f, "flank", 140)) return;
    }
  }
  // 目標が見えない：味方の知らせ・デコイの音へ向かう
  if (!tg) {
    const decoy = nearestDecoy(ai);
    if (decoy) {
      moveTo(ai, decoy, "decoy", 160);
      return;
    }
    if (ai.alert && now - ai.alert.tick < 200 && dist(ai.alert.pos, e.location) > 6 && role !== "sniper" && role !== "mortar") {
      const a = ai.alert.pos;
      ai.alert = null;
      const g = groundAt(e.dimension, a.x + rand(-3, 3), a.y, a.z + rand(-3, 3));
      if (g) moveTo(ai, g, "investigate", 200);
    }
  }
}

/** @param {AI} ai */
function nearestDecoy(ai) {
  const loc = ai.ent.location;
  for (const d of getDecoys()) {
    if (d.dim.id !== ai.ent.dimension.id) continue;
    if (dist(d.pos, loc) <= d.radius) return d.pos;
  }
  return null;
}

/**
 * 衛生兵：弱った味方へ寄って回復
 * @param {AI} ai @param {number} now
 */
function medicThink(ai, now) {
  if ((ai.cd.heal ?? 0) > now) return false;
  /** @type {AI|null} */
  let worst = null;
  let worstHp = 0.6;
  for (const o of squad(ai, 14)) {
    const h = health01(o);
    if (h < worstHp) {
      worst = o;
      worstHp = h;
    }
  }
  if (!worst) return false;
  const d = dist(worst.ent.location, ai.ent.location);
  if (d > 3.5) {
    const g = worst.ent.location;
    moveTo(ai, { x: g.x, y: g.y, z: g.z }, "heal", 100);
    return true;
  }
  ai.cd.heal = now + (ai.def.healCooldown ?? 120);
  safe("ai.heal", () => {
    const h = worst.ent.getComponent("minecraft:health");
    if (h) h.setCurrentValue(Math.min(h.effectiveMax, h.currentValue + (ai.def.heal ?? 6)));
  });
  emit(worst.ent.dimension, "arsenal:heal", worst.ent.getAABB().center, undefined, { range: 32 });
  playNear(worst.ent.dimension, worst.ent.location, "arsenal.gear.heal", { range: 16, volume: 0.7 });
  return false;
}

/**
 * 偵察ドローン：見つけた相手を味方に知らせる（相手には警告）
 * @param {AI} ai @param {import("@minecraft/server").Entity} tg
 */
function spot(ai, tg) {
  share(ai, tg.location, 40);
  emit(tg.dimension, "arsenal:lock_marker", add(tg.getAABB().center, { x: 0, y: 1.4, z: 0 }), undefined, { range: 48 });
  playNear(ai.ent.dimension, ai.ent.location, "arsenal.gear.beep", { range: 24, volume: 0.7, pitch: 1.4 });
  if (tg instanceof Player) {
    const s = S(tg);
    if (system.currentTick - (s.spottedTick ?? -999) > 200) {
      s.spottedTick = system.currentTick;
      safe("ai.spotted", () => tg.sendMessage(t("arsenal.ui.spotted")));
    }
  }
}

/**
 * 自爆する敵：近づいたら膨らみ、少しして爆発
 * @param {AI} ai @param {import("@minecraft/server").Entity|null|undefined} tg @param {number} d @param {number} now
 */
function bomberThink(ai, tg, d, now) {
  setMode(ai, "engage");
  if (ai.fuseAt < 0 && tg && d <= (ai.def.range ?? 2.5) + 0.8) {
    ai.fuseAt = now + (ai.def.fuse ?? 30);
    safe("ai.fuse", () => ai.ent.setProperty(`${NS}:fuse`, true));
    playNear(ai.ent.dimension, ai.ent.location, "arsenal.fx.c4_beep", { range: 16, pitch: 0.6 });
  } else if (ai.fuseAt >= 0 && now >= ai.fuseAt) {
    detonateBomber(ai);
  } else if (ai.fuseAt >= 0 && tg && d > 7) {
    // 離れられたら萎む
    ai.fuseAt = -1;
    safe("ai.unfuse", () => ai.ent.setProperty(`${NS}:fuse`, false));
  }
}

/** @param {AI} ai */
function detonateBomber(ai) {
  const e = ai.ent;
  if (!e.isValid) return;
  const loc = e.location;
  const dim = e.dimension;
  const power = (ai.def.blast ?? 3.5) / 2;
  unregister(ai.id);
  safe("ai.bomber.kill", () => e.remove());
  explode(dim, add(loc, { x: 0, y: 0.8, z: 0 }), power, undefined, false, false, null);
  emit(dim, "arsenal:gas_cloud", add(loc, { x: 0, y: 0.6, z: 0 }), undefined, { range: 48 });
}

// ---------------------------------------------------------------------------
//  射撃（エンジンの合図を横取り）
// ---------------------------------------------------------------------------

/** @type {Map<string, any>} */
const aiStatCache = new Map();

/** 敵用の実効ステータス（ダメージ・射程は敵の定義から） @param {any} def */
function enemyStats(def) {
  const key = `${def.weapon}|${def.damage}|${def.range}`;
  let st = aiStatCache.get(key);
  if (st) return st;
  const base = computeStats(def.weapon, {}, "std");
  st = {
    ...base, dmg: def.damage, dmgMin: def.damage, head: Math.min(base.head, 1.5), range0: def.range * 1.4, range1: def.range * 2.6, falloff: 0.7,
    tracer: true, flash: true, pen: Math.min(base.pen, 1.5), ap: base.ap ?? 0,
  };
  aiStatCache.set(key, st);
  return st;
}

/**
 * 合図の向きに一番近い相手
 * @param {import("@minecraft/server").Entity} shooter @param {import("../../util/math.js").Vec3} dir @param {number} range
 */
function targetAlong(shooter, dir, range) {
  const eye = shooter.getHeadLocation();
  /** @type {import("@minecraft/server").Entity|null} */
  let best = null;
  let bestDot = 0.9;
  safe("ai.along", () => {
    for (const c of shooter.dimension.getEntities({ location: eye, maxDistance: range + 12, excludeFamilies: ["arsenal_enemy", "inanimate", "arsenal_fx"], excludeTypes: ["minecraft:item", "minecraft:xp_orb"] })) {
      if (!c.getComponent("minecraft:health")) continue;
      const v = sub(c.getAABB().center, eye);
      const L = len(v);
      if (L < 0.5) continue;
      const dd = dot(mul(v, 1 / L), dir);
      if (dd > bestDot) {
        bestDot = dd;
        best = c;
      }
    }
  });
  return best;
}

/**
 * 敵が 1 回撃つ（スクリプトの弾道）
 * @param {import("@minecraft/server").Entity} shooter @param {AI} ai @param {import("../../util/math.js").Vec3} dir0 合図の飛ぶ向き
 */
export function aiFire(shooter, ai, dir0) {
  const now = system.currentTick;
  const def = ai.def;
  if (!def.weapon) return;
  if (ai.empUntil > now || ai.stunUntil > now) {
    playNear(shooter.dimension, shooter.location, "arsenal.mech.dry_fire", { range: 12 });
    return;
  }
  const st = enemyStats(def);
  const eye = shooter.getHeadLocation();
  let tgt = ai.target ? world.getEntity(ai.target) : undefined;
  if (!tgt || !tgt.isValid || dot(norm(sub(tgt.getAABB().center, eye)), dir0) < 0.8) tgt = targetAlong(shooter, dir0, def.range * 1.5) ?? undefined;
  let aimPt = tgt ? tgt.getAABB().center : add(eye, mul(dir0, 20));
  if (tgt) {
    // 頭を狙う確率（難易度が高いほど上がる）
    const hc = tgt instanceof Player ? 0.08 / diff().spread : 0.1;
    if (Math.random() < hc) aimPt = tgt instanceof Player ? tgt.getHeadLocation() : aimPt;
  }
  const dir = norm(sub(aimPt, eye));
  let spread = /** @type {any} */ (ROLE_SPREAD)[def.role] ?? 2.2;
  spread *= diff().spread;
  if (tgt) {
    const v = safe("ai.tv", () => tgt.getVelocity()) ?? { x: 0, y: 0, z: 0 };
    if (Math.hypot(v.x, v.z) > 0.1) spread += 1.2;
    spread /= Math.max(0.35, stealthFactor(tgt));
  }
  if (now - ai.lastHurt < 20) spread *= 1.4;
  // 腕を撃たれた：狙いが甘くなる
  if (now < (/** @type {any} */ (ai).armHitUntil ?? 0)) spread *= 1.6;
  const { r: right, u } = basis(dir);
  const muzzle = add(add(add(eye, mul(dir, 0.9)), mul(right, 0.28)), mul(u, -0.22));
  stats.shots++;
  gunshot(shooter, st, muzzle);
  muzzleFx(/** @type {any} */ (shooter), st, muzzle, null);
  switch (st.fire) {
    case "gl40":
      fireGrenade40(shooter, muzzle, cone(dir, spread), st);
      return;
    case "mortar": {
      const to = tgt ? tgt.location : add(shooter.location, mul(norm({ x: dir.x, y: 0, z: dir.z }), 30));
      fireMortar(shooter, muzzle, dir, st, to, 2.5 * diff().spread);
      emit(shooter.dimension, "arsenal:target_marker", to, undefined, { range: 64 });
      return;
    }
    default: {
      const pellets = st.pellets ?? 1;
      for (let i = 0; i < pellets; i++) {
        const dd = cone(dir, spread + (pellets > 1 ? st.pelletSpread ?? 3 : 0));
        const r = traceHitscan(shooter, eye, dd, st, { maxRange: Math.max(st.range1, def.range * 3) });
        drawTracer(shooter, muzzle, r.end, st, i === 0);
        whizzBy(shooter, muzzle, r.end, isSupersonic(st));
      }
    }
  }
}

// ---------------------------------------------------------------------------
//  EMP・スタン
// ---------------------------------------------------------------------------

/**
 * EMP の処理（EMP グレネード・キルストリーク・ボス）
 * @param {import("@minecraft/server").Dimension} dim @param {import("../../util/math.js").Vec3} loc @param {number} radius @param {number} ticks @param {string|null} sourceId
 */
export function applyEmp(dim, loc, radius, ticks, sourceId) {
  const now = system.currentTick;
  const src = sourceId ? world.getEntity(sourceId) : undefined;
  const fromEnemy = !!(src && enemyIdOf(src.typeId));
  emit(dim, "arsenal:emp_wave", loc, undefined, { range: 96 });
  playNear(dim, loc, "arsenal.gear.emp", { range: 48 });
  safe("emp.scan", () => {
    for (const e of dim.getEntities({ location: loc, maxDistance: radius, excludeFamilies: ["inanimate"], excludeTypes: ["minecraft:item", "minecraft:xp_orb"] })) {
      const ai = registry.get(e.id);
      if (ai) {
        if (fromEnemy) continue;
        if (ROBOT_MODELS.has(ai.def.model) || ai.def.energy) {
          ai.empUntil = now + (ai.def.phases ? Math.round(ticks * 0.4) : ticks);
          safe("emp.slow", () => e.addEffect("slowness", ai.empUntil - now, { amplifier: 5, showParticles: false }));
          emit(dim, "arsenal:arc_spark", e.getAABB().center, undefined, { range: 48 });
          if (ai.def.flying) safe("emp.drop", () => e.applyImpulse({ x: 0, y: -0.6, z: 0 }));
        }
        continue;
      }
      if (e instanceof Player) {
        if (src instanceof Player && (e.id === src.id)) continue;
        if (src && !fromEnemy && !(src instanceof Player && canDamage(src, e))) continue;
        const s = S(e);
        s.empUntil = now + ticks;
        s.hudDirty = true;
        playTo(e, "arsenal.gear.emp", { volume: 0.8 });
        continue;
      }
      // 設置物（砲台・ドローン・銃座）
      if (e.typeId.startsWith(`${NS}:`)) {
        const own = safe("emp.own", () => e.getDynamicProperty("a:own"));
        if (src instanceof Player && own === src.id) continue;
        if (src instanceof Player && typeof own === "string") {
          const op = world.getEntity(own);
          if (op instanceof Player && !canDamage(src, op)) continue;
        }
        safe("emp.dep", () => e.setDynamicProperty("a:emp", now + ticks));
        emit(dim, "arsenal:arc_spark", e.getAABB().center, undefined, { range: 48 });
      }
    }
  });
}

/**
 * スタン（ライオットバトンなど）
 * @param {import("@minecraft/server").Entity} e @param {number} ticks
 */
export function stun(e, ticks) {
  const ai = registry.get(e.id);
  const now = system.currentTick;
  if (ai) {
    ai.stunUntil = Math.max(ai.stunUntil, now + (ai.def.phases ? Math.round(ticks * 0.3) : ticks));
    setMode(ai, "hold");
  }
  safe("stun", () => {
    e.addEffect("slowness", ticks, { amplifier: 4, showParticles: false });
    e.addEffect("weakness", ticks, { amplifier: 2, showParticles: false });
  });
  emit(e.dimension, "arsenal:arc_spark", e.getAABB().center, undefined, { range: 32 });
}

/** 設置物が EMP で止まっているか @param {import("@minecraft/server").Entity} e */
export function isEmpd(e) {
  const v = safe("emp.get", () => e.getDynamicProperty("a:emp"));
  return typeof v === "number" && v > system.currentTick;
}

// ---------------------------------------------------------------------------
//  イベント
// ---------------------------------------------------------------------------

/** 分隊の射撃（systems/squad.js。循環 import を避けて main.js が登録する） @type {((e:import("@minecraft/server").Entity, dir:import("../../util/math.js").Vec3)=>void)|null} */
let squadShot = null;
/** @param {(e:import("@minecraft/server").Entity, dir:import("../../util/math.js").Vec3)=>void} fn */
export function setSquadShotHandler(fn) {
  squadShot = fn;
}

export function attachBrain() {
  setEmpHandler(applyEmp);
  setStunHandler(stun);
  onLimbHit((e, zone, until) => {
    const ai = registry.get(e.id);
    if (ai && zone === "arm") /** @type {any} */ (ai).armHitUntil = until;
  });
  // 難易度はワールド設定（ダイナミックプロパティ）から読むので、早期実行が終わってから
  world.afterEvents.worldLoad.subscribe(() => safe("ai.difficulty", syncDifficulty));
  world.afterEvents.entitySpawn.subscribe((ev) => {
    safe("ai.spawn", () => {
      const e = ev.entity;
      if (!e.isValid) return;
      const tid = e.typeId;
      // 敵の射撃の合図：消して撃ち直す
      if (tid === ENTITY.aiShot || LEGACY_BULLETS.has(tid)) {
        const owner = safe("ai.owner", () => e.getComponent("minecraft:projectile")?.owner);
        const v = safe("ai.vel", () => e.getVelocity()) ?? { x: 0, y: 0, z: 1 };
        safe("ai.shot.remove", () => e.remove());
        if (!owner || !owner.isValid) return;
        // 分隊（3.0）の合図は分隊の側で撃ち直す
        if (squadShot && owner.matches({ families: ["arsenal_squad"] })) {
          squadShot(owner, len(v) > 0.001 ? norm(v) : owner.getViewDirection());
          return;
        }
        const ai = registry.get(owner.id) ?? register(owner);
        if (!ai) return;
        aiFire(owner, ai, len(v) > 0.001 ? norm(v) : owner.getViewDirection());
        return;
      }
      const eid = enemyIdOf(tid);
      if (!eid) return;
      const def = enemyDef(eid);
      // 勢力が OFF：自然発生を取り除く（スポーンエッグ・構造物・ゲームモードは残す）
      if (ev.cause === EntityInitializationCause.Spawned && !scripted.has(e.id) && !def.phases && !factionEnabled(def.faction)) {
        const near = e.dimension.getPlayers({ location: e.location, maxDistance: 12 });
        if (near.length === 0) {
          e.remove();
          return;
        }
      }
      scripted.delete(e.id);
      register(e);
    });
  });
  const load = /** @type {any} */ (world.afterEvents).entityLoad;
  if (load && typeof load.subscribe === "function") {
    load.subscribe((/** @type {any} */ ev) => safe("ai.load", () => {
      if (ev.entity && ev.entity.isValid && enemyIdOf(ev.entity.typeId)) register(ev.entity);
    }));
  }
  world.afterEvents.entityHurt.subscribe((ev) => {
    safe("ai.hurt", () => {
      const ai = registry.get(ev.hurtEntity.id);
      if (!ai) return;
      const now = system.currentTick;
      ai.lastHurt = now;
      const src = ev.damageSource.damagingEntity;
      if (src && !enemyIdOf(src.typeId)) {
        ai.alert = { pos: { ...src.location }, tick: now };
        if (!ai.target) ai.targetTick = -99;
      }
      // 移動中に撃たれたら、様子見・調査はやめて撃ち返す
      if (ai.moveUntil > 0 && (ai.moveWhy === "investigate" || ai.moveWhy === "decoy")) {
        clearWaypoint(ai);
        setMode(ai, "engage");
      }
    });
  });
  // 敵の近接攻撃の追加効果（ブルートのノックバック）
  world.afterEvents.entityHitEntity.subscribe((ev) => {
    safe("ai.hit", () => {
      const ai = registry.get(ev.damagingEntity.id);
      if (!ai || !ai.def.knockback) return;
      const h = ev.hitEntity;
      const v = norm(sub(h.location, ev.damagingEntity.location));
      h.applyKnockback({ x: v.x * ai.def.knockback, z: v.z * ai.def.knockback }, 0.45);
      playNear(h.dimension, h.location, "arsenal.boss.stomp", { range: 16, volume: 0.5, pitch: 1.4 });
    });
  });
  world.afterEvents.entityDie.subscribe((ev) => {
    safe("ai.die", () => {
      const ai = registry.get(ev.deadEntity.id);
      if (!ai) return;
      const loc = ev.deadEntity.location;
      const dim = ev.deadEntity.dimension;
      unregister(ai.id);
      // 膨らんでいたブローターは倒されても破裂する（弱い）
      if (ai.def.role === "bomber" && dim) {
        emit(dim, "arsenal:gas_cloud", add(loc, { x: 0, y: 0.6, z: 0 }), undefined, { range: 48 });
        if (ai.fuseAt >= 0) explode(dim, add(loc, { x: 0, y: 0.8, z: 0 }), (ai.def.blast ?? 3.5) / 3, undefined, false, false, null);
      }
    });
  });
  world.afterEvents.entityRemove.subscribe((ev) => {
    safe("ai.remove", () => unregister(ev.removedEntityId));
  });
}

/** 取りこぼしを拾う（100 tick ごと）：プレイヤーの周りの敵を登録 */
export function scanForAI() {
  const seen = new Set();
  for (const p of world.getAllPlayers()) {
    const dim = p.dimension;
    const k = dim.id + Math.floor(p.location.x / 64) + "," + Math.floor(p.location.z / 64);
    if (seen.has(k)) continue;
    seen.add(k);
    safe("ai.scan2", () => {
      for (const e of dim.getEntities({ location: p.location, maxDistance: 96, families: ["arsenal_enemy"] })) {
        if (!registry.has(e.id) && enemyIdOf(e.typeId)) register(e);
      }
    });
  }
  syncDifficulty();
}

/** 毎 tick：予算内で思考 */
export function tickBrain() {
  const now = system.currentTick;
  if (queue.length > registry.size * 2 + 32) queue = [...registry.keys()];
  const think0 = stats.thinks;
  const perDim = new Map();
  let n = 0;
  const df = diff();
  const limit = queue.length;
  for (let k = 0; k < limit && n < BUDGET.thinkPerTick; k++) {
    if (qi >= queue.length) qi = 0;
    const id = queue[qi++];
    const ai = registry.get(id);
    if (!ai) {
      queue.splice(--qi, 1);
      continue;
    }
    // 自爆の起爆だけは予算外で毎 tick 見る
    if (ai.fuseAt >= 0 && now >= ai.fuseAt) {
      detonateBomber(ai);
      continue;
    }
    if (ai.next > now) continue;
    const dimId = ai.ent.isValid ? ai.ent.dimension.id : "";
    const c = (perDim.get(dimId) ?? 0) + 1;
    perDim.set(dimId, c);
    if (c > BUDGET.maxActive) {
      stats.skipped++;
      ai.next = now + BUDGET.thinkIntervalMax;
      continue;
    }
    ai.next = now + Math.max(BUDGET.thinkIntervalMin, Math.min(BUDGET.thinkIntervalMax, df.think + Math.floor(rand(-1, 2))));
    n++;
    stats.thinks++;
    safe("ai.think", () => think(ai, now));
  }
  stats.maxThinkPerTick = Math.max(stats.maxThinkPerTick, stats.thinks - think0);
}

/** 敵の一覧（ボス・ゲームモード・構造物が使う） */
export function allAI() {
  return registry;
}
