// @ts-check
/**
 * 分隊（3.0）：クレジットで雇う味方の兵士（1 人につき最大 SQUAD_MAX 人）
 *   ・持ち主について行く：離れたら道しるべ（arsenal:waypoint）へ歩き、遠すぎたらそばへ瞬間移動する
 *   ・戦う：エンジンの射撃 AI が合図の弾（ai_shot）を撃つと、敵と同じく brain.js が横取りし、ここで撃ち直す
 *     狙うのは敵勢力と敵対 mob だけ。プレイヤーは撃たない（damage.js の canDamage）
 *   ・命令：ついて来い／ここで待て／解散（野戦マニュアル →「分隊」）
 *   ・衛生兵は持ち主の傷を手当てする
 * 持ち主は「a:own」（設置物と同じ）。命令は「a:sq」に保存するので、ワールドを開き直しても続く
 */
import { world, system, Player } from "@minecraft/server";
import { DATA, ENTITY, NS } from "../config/constants.js";
import { computeStats } from "../core/weaponState.js";
import { traceHitscan, whizzBy, drawTracer, isSupersonic } from "../core/ballistics.js";
import { gunshot, muzzleFx, emit, playNear, playTo } from "../fx/effects.js";
import { credits, addCredits } from "../economy/economy.js";
import { announce } from "../ui/hud2.js";
import { add, sub, mul, norm, dist, dot, cone, basis, isLoaded, len } from "../util/math.js";
import { safe } from "../util/log.js";
import { t, raw } from "../util/i18n.js";

const SQUAD = /** @type {Record<string, any>} */ (DATA.SQUAD);
const FOLLOW = DATA.SQUAD_FOLLOW;

/**
 * @typedef {Object} Mate
 * @property {string} id
 * @property {string} sid 種類（data/squad.js）
 * @property {import("@minecraft/server").Entity} ent
 * @property {string} owner
 * @property {"follow"|"hold"} order
 * @property {string|null} wp 道しるべの id
 * @property {string} mode engage / hold / move
 * @property {number} healAt
 */

/** @type {Map<string, Mate>} */
const mates = new Map();

/** @param {string} typeId */
export function squadIdOf(typeId) {
  const id = typeId.startsWith(`${NS}:`) ? typeId.slice(NS.length + 1) : "";
  return SQUAD[id] ? id : undefined;
}

/** @param {import("@minecraft/server").Entity} e */
function register(e) {
  const sid = squadIdOf(e.typeId);
  if (!sid) return undefined;
  const have = mates.get(e.id);
  if (have) {
    have.ent = e;
    return have;
  }
  const own = safe("sq.own", () => e.getDynamicProperty("a:own"));
  const order = safe("sq.order", () => e.getDynamicProperty("a:sq"));
  /** @type {Mate} */
  const m = { id: e.id, sid, ent: e, owner: typeof own === "string" ? own : "", order: order === "hold" ? "hold" : "follow", wp: null, mode: "engage", healAt: 0 };
  mates.set(e.id, m);
  return m;
}

/** @param {string} id */
function unregister(id) {
  const m = mates.get(id);
  if (!m) return;
  clearWp(m);
  mates.delete(id);
}

/** 持ち主の分隊 @param {Player} p */
export function squadOf(p) {
  return [...mates.values()].filter((m) => m.owner === p.id && m.ent.isValid);
}

/** @param {Mate} m @param {string} mode */
function setMode(m, mode) {
  if (m.mode === mode) return;
  m.mode = mode;
  safe("sq.mode", () => m.ent.triggerEvent(`${NS}:ai_${mode}`));
}

/** @param {Mate} m */
function clearWp(m) {
  if (!m.wp) return;
  const w = world.getEntity(m.wp);
  if (w && w.isValid) safe("sq.wp.rm", () => w.remove());
  m.wp = null;
}

/**
 * 雇う
 * @param {Player} p @param {string} sid
 * @returns {string|null} 雇えなかった理由（翻訳キー）
 */
export function hire(p, sid) {
  const d = SQUAD[sid];
  if (!d) return "arsenal.squad.unknown";
  if (squadOf(p).length >= DATA.SQUAD_MAX) return "arsenal.squad.full";
  if (credits(p) < d.cost) return "arsenal.squad.no_credits";
  const v = p.getViewDirection();
  const at = { x: p.location.x - v.x * 1.5, y: p.location.y, z: p.location.z - v.z * 1.5 };
  const e = safe("sq.spawn", () => p.dimension.spawnEntity(`${NS}:${sid}`, at));
  if (!e) return "arsenal.squad.unknown";
  addCredits(p, -d.cost, false);
  safe("sq.setup", () => {
    e.setDynamicProperty("a:own", p.id);
    e.setDynamicProperty("a:sq", "follow");
    e.nameTag = `§a${p.name}`;
  });
  register(e);
  playNear(p.dimension, at, "arsenal.ui.radio", { range: 16 });
  return null;
}

/**
 * 命令
 * @param {Player} p @param {"follow"|"hold"|"dismiss"} order
 */
export function orderSquad(p, order) {
  for (const m of squadOf(p)) {
    if (order === "dismiss") {
      clearWp(m);
      emit(m.ent.dimension, "arsenal:explosion_smoke", m.ent.location, undefined, { range: 24 });
      safe("sq.dismiss", () => m.ent.remove());
      mates.delete(m.id);
      continue;
    }
    m.order = order;
    safe("sq.order.save", () => m.ent.setDynamicProperty("a:sq", order));
    if (order === "hold") {
      clearWp(m);
      setMode(m, "hold");
    } else setMode(m, "engage");
  }
  playTo(p, "arsenal.ui.radio", { volume: 0.7 });
}

/** 10 tick ごと（main.js）：ついて行く・衛生兵の手当て */
export function tickSquad() {
  const now = system.currentTick;
  if (now % 10 !== 0) return;
  for (const m of [...mates.values()]) {
    const e = m.ent;
    if (!e.isValid) {
      unregister(m.id);
      continue;
    }
    if (!isLoaded(e.dimension, e.location, now)) continue;
    const owner = m.owner ? world.getEntity(m.owner) : undefined;
    if (!(owner instanceof Player)) {
      // 持ち主がいない（退出中）：その場で待つ
      clearWp(m);
      setMode(m, "hold");
      continue;
    }
    const d = SQUAD[m.sid];
    // 衛生兵：持ち主の手当て
    if (d.heal && now >= m.healAt && owner.dimension.id === e.dimension.id && dist(owner.location, e.location) < 8) {
      const h = owner.getComponent("minecraft:health");
      if (h && h.currentValue > 0 && h.currentValue < h.effectiveMax * d.heal.below) {
        h.setCurrentValue(Math.min(h.effectiveMax, h.currentValue + d.heal.amount));
        m.healAt = now + d.heal.every;
        emit(owner.dimension, "arsenal:heal", owner.getAABB().center, undefined, { range: 24 });
        playNear(owner.dimension, owner.location, "arsenal.gear.heal", { range: 10, volume: 0.6 });
      }
    }
    if (m.order === "hold") {
      setMode(m, "hold");
      continue;
    }
    const sameDim = owner.dimension.id === e.dimension.id;
    const far = sameDim ? dist(owner.location, e.location) : Infinity;
    if (far > FOLLOW.teleport) {
      // 遠すぎる・別のディメンション：持ち主のそばへ
      const v = owner.getViewDirection();
      const at = { x: owner.location.x - v.x * 2, y: owner.location.y, z: owner.location.z - v.z * 2 };
      if (isLoaded(owner.dimension, at, now)) {
        clearWp(m);
        safe("sq.tp", () => e.teleport(at, { dimension: owner.dimension }));
        setMode(m, "engage");
      }
      continue;
    }
    if (far > FOLLOW.far) {
      // 追いかける（持ち主の少し後ろへ）
      const v = owner.getViewDirection();
      const to = { x: owner.location.x - v.x * 2, y: owner.location.y, z: owner.location.z - v.z * 2 };
      const w = m.wp ? world.getEntity(m.wp) : undefined;
      if (w && w.isValid) safe("sq.wp.move", () => w.teleport(to));
      else {
        const nw = safe("sq.wp", () => e.dimension.spawnEntity(ENTITY.waypoint, to));
        m.wp = nw ? nw.id : null;
      }
      setMode(m, "move");
    } else if (far < FOLLOW.near || m.mode === "move" && far < FOLLOW.far - 1) {
      clearWp(m);
      setMode(m, "engage");
    }
  }
}

/**
 * 撃つ相手（敵勢力・敵対 mob。プレイヤーと分隊は狙わない）
 * @param {import("@minecraft/server").Entity} e @param {import("../util/math.js").Vec3} dir @param {number} range
 * @returns {import("@minecraft/server").Entity|null}
 */
function targetAlong(e, dir, range) {
  const eye = e.getHeadLocation();
  /** @type {import("@minecraft/server").Entity|null} */
  let best = null;
  let bestDot = 0.85;
  safe("sq.along", () => {
    for (const fam of ["arsenal_enemy", "monster"]) {
      for (const c of e.dimension.getEntities({ location: eye, maxDistance: range, families: [fam] })) {
        const v = sub(c.getAABB().center, eye);
        const L = len(v);
        if (L < 0.5) continue;
        const dd = dot(mul(v, 1 / L), dir);
        if (dd > bestDot) {
          bestDot = dd;
          best = c;
        }
      }
    }
  });
  return /** @type {import("@minecraft/server").Entity|null} */ (best);
}

/** @type {Map<string, any>} */
const statCache = new Map();
/** @param {any} d */
function mateStats(d) {
  let st = statCache.get(d.weapon + d.damage);
  if (st) return st;
  const base = computeStats(d.weapon, {}, "std");
  st = { ...base, dmg: d.damage, dmgMin: d.damage, head: Math.min(base.head, 1.6), range0: d.range * 1.4, range1: d.range * 2.6, falloff: 0.7, tracer: true, flash: true };
  statCache.set(d.weapon + d.damage, st);
  return st;
}

/**
 * 分隊の 1 回の射撃（brain.js が合図の弾を横取りしたとき）
 * @param {import("@minecraft/server").Entity} e @param {import("../util/math.js").Vec3} dir0
 */
export function squadFire(e, dir0) {
  const m = mates.get(e.id) ?? register(e);
  if (!m) return;
  const d = SQUAD[m.sid];
  const st = mateStats(d);
  const eye = e.getHeadLocation();
  const tgt = targetAlong(e, dir0, d.range * 1.5);
  if (!tgt) return; // 撃つ相手がいない（味方やプレイヤーの方を向いていた）なら撃たない
  const dir = norm(sub(tgt.getAABB().center, eye));
  const { r: right, u } = basis(dir);
  const muzzle = add(add(add(eye, mul(dir, 0.9)), mul(right, 0.28)), mul(u, -0.22));
  gunshot(e, st, muzzle);
  muzzleFx(/** @type {any} */ (e), st, muzzle, null);
  const r = traceHitscan(e, eye, cone(dir, 1.6), st, { maxRange: d.range * 3 });
  drawTracer(e, muzzle, r.end, st, true);
  whizzBy(e, muzzle, r.end, isSupersonic(st));
}

/** 起動時：読み込まれた分隊を登録・死亡で外す */
export function attachSquad() {
  const load = /** @type {any} */ (world.afterEvents).entityLoad;
  if (load && typeof load.subscribe === "function") load.subscribe((/** @type {any} */ ev) => safe("sq.load", () => ev.entity?.isValid && register(ev.entity)));
  world.afterEvents.entitySpawn.subscribe((ev) => safe("sq.spawnev", () => ev.entity.isValid && register(ev.entity)));
  world.afterEvents.entityDie.subscribe((ev) => {
    const m = mates.get(ev.deadEntity.id);
    if (!m) return;
    const owner = world.getEntity(m.owner);
    if (owner instanceof Player) announce(owner, { rawtext: [{ text: "§c" }, t("arsenal.squad.down", { translate: `entity.${NS}:${m.sid}.name` })] }, 50);
    unregister(m.id);
  });
  world.afterEvents.entityRemove.subscribe((ev) => safe("sq.rm", () => unregister(ev.removedEntityId)));
}

/** 取りこぼしを拾う（100 tick ごと） */
export function scanSquad() {
  for (const p of world.getAllPlayers()) {
    safe("sq.scan", () => {
      for (const e of p.dimension.getEntities({ location: p.location, maxDistance: 96, families: ["arsenal_squad"] })) if (!mates.has(e.id)) register(e);
    });
  }
}

/** 分隊の説明（フォーム用） @param {Player} p */
export function squadBody(p) {
  const list = squadOf(p);
  /** @type {any[]} */
  const lines = [t("arsenal.squad.body", String(list.length), String(DATA.SQUAD_MAX))];
  for (const m of list) {
    const h = m.ent.getComponent("minecraft:health");
    lines.push(raw("\n§a- ", { translate: `entity.${NS}:${m.sid}.name` }, ` §7${Math.ceil(h?.currentValue ?? 0)}/${h?.effectiveMax ?? 0}  `, t(m.order === "hold" ? "arsenal.squad.order_hold" : "arsenal.squad.order_follow")));
  }
  return { rawtext: lines };
}
