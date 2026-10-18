// @ts-check
/**
 * スクリプト駆動の実体弾：弾道落下する狙撃弾、40mm（跳ねるグレネード）、ロケット、誘導ロケット（上から落ちる型）、
 * 照明弾、グラップル、プラズマ、追尾ニードル、迫撃砲弾、有線誘導ミサイル、
 * 2.5 の特殊武器の弾（跳ね返る刃・重力井戸・時間減速・網・EMP 弾・麻酔ダーツ・銛・粘着弾・クラスター弾・小型ミサイルの群れ）、
 * 投擲物（手榴弾・スモーク・フラッシュ・火炎瓶・粘着・C4・ガス・EMP・クラスター・デコイ・スナップ・投げナイフ）と設置物（地雷）。
 * エンジンの投射物を使わず、毎 tick レイで衝突判定して跳ね返り・貼り付き・起爆を制御する。
 * 撃ち手はプレイヤーに限らない（敵 AI・砲台・銃座も同じ弾を使う）。
 */
import { world, system, MolangVariableMap, Player, ItemStack } from "@minecraft/server";
import { ENTITY, PROJ_KIND, DATA } from "../config/constants.js";
import { explosionBreaksBlocks, W as WS } from "../core/settings.js";
import { traceHitscan, drawTracer, whizzBy, isSupersonic } from "../core/ballistics.js";
import { explode, canDamage, dealDamage, hitFeedback, miniBlast, bulletHit, isArmored, meleeDamage, hitZone } from "../core/damage.js";
import { isGasImmune } from "../core/armor.js";
import { emit, playNear, explosionFx, playTo } from "../fx/effects.js";
import { add, sub, mul, len, norm, dist, dot, faceNormal, rotFromDir, clamp, isLoaded, loadedReach, rand, hitPoint } from "../util/math.js";
import { safe } from "../util/log.js";
import { isSolidBlock, startSearch, cancelSearch, segOk, invalidateCell } from "./pathfind.js";
import { addSingularity, addStasis, castNet, tranquilize, pin } from "./fields.js";
import { detonateNuke, nukeCountdown, nukeSpec } from "./nuke.js";

/** 風（ワールド全体でゆっくり変わる。ブロック/tick²） */
const wind = { x: 0, z: 0, tx: 0, tz: 0 };
/** 風向き（HUD 用） */
export function getWind() {
  return { x: wind.x, z: wind.z };
}

/** EMP の処理（AI・設置物・プレイヤー）。ai/brain.js が登録する @type {(dim:import("@minecraft/server").Dimension, loc:import("../util/math.js").Vec3, radius:number, ticks:number, sourceId:string|null)=>void} */
let empHandler = () => {};
/** @param {(dim:import("@minecraft/server").Dimension, loc:import("../util/math.js").Vec3, radius:number, ticks:number, sourceId:string|null)=>void} fn */
export function setEmpHandler(fn) {
  empHandler = fn;
}
/** デコイ（AI を引き寄せる音源） @type {{dim:import("@minecraft/server").Dimension, pos:import("../util/math.js").Vec3, radius:number, until:number, ownerId:string}[]} */
const decoys = [];
export function getDecoys() {
  const now = system.currentTick;
  return decoys.filter((d) => d.until > now);
}

/**
 * @typedef {Object} Proj
 * @property {number} id
 * @property {string} type bullet|gl40|rocket|seeker|flare|hook|throw|mine
 * @property {string} kind 見た目
 * @property {import("@minecraft/server").Dimension} dim
 * @property {import("../util/math.js").Vec3} pos
 * @property {import("../util/math.js").Vec3} vel ブロック/tick
 * @property {string} ownerId
 * @property {import("@minecraft/server").Entity|null} ent
 * @property {number} age
 * @property {number} maxAge
 * @property {number} fuse 残り tick（-1 で無し）
 * @property {any} data
 * @property {{entityId:string|null, offset:import("../util/math.js").Vec3|null}|null} stuck
 * @property {number} traveled
 * @property {boolean} dead
 * @property {Set<string>} hitSet
 */

/** @type {Proj[]} */
const list = [];
let nextId = 1;
const MAX_ACTIVE = 400;

/** @param {string} id */
function owner(id) {
  const e = world.getEntity(id);
  return e && e.isValid ? e : undefined;
}

/**
 * 見た目のエンティティを生成
 * @param {import("@minecraft/server").Dimension} dim @param {import("../util/math.js").Vec3} pos @param {string} kind
 */
function spawnVisual(dim, pos, kind) {
  return safe("proj.spawnVisual", () => {
    const e = dim.spawnEntity(ENTITY.projectile, pos);
    e.setProperty("arsenal:kind", /** @type {any} */ (PROJ_KIND)[kind] ?? 0);
    return e;
  }) ?? null;
}

/**
 * @param {Partial<Proj> & {type:string, kind:string, dim:import("@minecraft/server").Dimension, pos:import("../util/math.js").Vec3, vel:import("../util/math.js").Vec3, ownerId:string}} p
 * @param {boolean} visual
 */
function addProj(p, visual) {
  if (list.length >= MAX_ACTIVE) {
    // あふれたら、いちばん古い銃弾から消す（設置した C4 や投げた手榴弾を先に消さない）
    const i = list.findIndex((x) => x.type === "bullet" && !x.dead);
    const old = i >= 0 ? list.splice(i, 1)[0] : list.shift();
    if (old) removeProj(old);
  }
  /** @type {Proj} */
  const pr = {
    id: nextId++, type: p.type, kind: p.kind, dim: p.dim, pos: p.pos, vel: p.vel, ownerId: p.ownerId,
    ent: visual ? spawnVisual(p.dim, p.pos, p.kind) : null,
    age: 0, maxAge: p.maxAge ?? 200, fuse: p.fuse ?? -1, data: p.data ?? {}, stuck: null, traveled: 0, dead: false,
    hitSet: new Set([p.ownerId]),
  };
  list.push(pr);
  return pr;
}

/** @param {Proj} p */
function removeProj(p) {
  p.dead = true;
  if (p.data && p.data.lightAt) clearMovingLight(p);
  if (p.ent) safe("proj.remove", () => { if (p.ent && p.ent.isValid) p.ent.remove(); });
  p.ent = null;
}

// ---------------------------------------------------------------------------
//  発射 API
// ---------------------------------------------------------------------------

/**
 * 発射位置：銃口が壁や地面にめり込んでいるときは、目から銃口までの間で止める
 * （下向きに撃ったとき地面の中から発射されてすり抜けるのを防ぐ）
 * @param {import("@minecraft/server").Entity} shooter @param {import("../util/math.js").Vec3} muzzle
 */
function launchPoint(shooter, muzzle) {
  const eye = shooter.getHeadLocation();
  const v = sub(muzzle, eye);
  const L = len(v);
  if (L < 1e-3) return eye;
  const d = mul(v, 1 / L);
  const hit = safe("proj.launch", () => shooter.dimension.getBlockFromRay(eye, d, { maxDistance: L, includeLiquidBlocks: false, includePassableBlocks: false }));
  if (!hit) return muzzle;
  const pt = hitPoint(hit);
  return add(pt, mul(d, -Math.min(0.15, dist(eye, pt) * 0.5)));
}

/** 弾道落下する狙撃弾 @param {import("@minecraft/server").Entity} shooter @param {import("../util/math.js").Vec3} muzzle @param {import("../util/math.js").Vec3} dir @param {any} st */
export function fireBallistic(shooter, muzzle, dir, st) {
  const pr = st.projectile ?? { speed: 18, gravity: 0.012 };
  const eye = shooter.getHeadLocation();
  addProj({ type: "bullet", kind: "flare", dim: shooter.dimension, pos: eye, vel: mul(dir, pr.speed), ownerId: shooter.id, maxAge: Math.ceil(st.range1 / pr.speed) + 4, data: { st, gravity: pr.gravity, pen: st.pen, mulDmg: 1, muzzle, first: true } }, false);
}

/**
 * 弾が飛ぶ普通の銃弾（ヒットスキャンの代わり）：目から撃ち、1 tick ごとに弾速ぶん進んで重力で落ちる。
 * 撃ったその tick に最初の 1 区間を進めるので、近距離は今までどおりすぐ当たる
 * @param {import("@minecraft/server").Entity} shooter @param {import("../util/math.js").Vec3} eye @param {import("../util/math.js").Vec3} dir @param {any} st
 * @param {{pen:number, silent:boolean, tracer:boolean, whizz:boolean, muzzle:import("../util/math.js").Vec3}} o
 */
export function fireBullet(shooter, eye, dir, st, o) {
  const tr = st.travel;
  const p = addProj({
    type: "bullet", kind: "flare", dim: shooter.dimension, pos: eye, vel: mul(dir, tr.speed), ownerId: shooter.id, maxAge: Math.ceil(st.range1 / tr.speed) + 4,
    data: { st, gravity: tr.gravity, pen: o.pen, mulDmg: 1, muzzle: o.muzzle, first: true, tracer: o.tracer, whizz: o.whizz, silent: o.silent },
  }, false);
  safe("proj.bullet", () => tickBullet(p));
}

/** 40mm @param {import("@minecraft/server").Entity} shooter @param {import("../util/math.js").Vec3} muzzle @param {import("../util/math.js").Vec3} dir @param {any} st */
export function fireGrenade40(shooter, muzzle, dir, st) {
  const pr = st.projectile ?? { speed: 1.9, gravity: 0.045, power: 2.4, arm: 0.5 };
  addProj({ type: "gl40", kind: "gl40", dim: shooter.dimension, pos: launchPoint(shooter, muzzle), vel: mul(dir, pr.speed), ownerId: shooter.id, maxAge: 200, fuse: pr.fuse ?? -1, data: { st, gravity: pr.gravity, power: pr.power, arm: pr.arm, weaponId: st.id, bounces: pr.bounces ?? 0 } }, true);
}

/** ロケット @param {import("@minecraft/server").Entity} shooter @param {import("../util/math.js").Vec3} muzzle @param {import("../util/math.js").Vec3} dir @param {any} st @param {string|null} targetId @param {{kind?:string, wire?:string, power?:number, maxAge?:number}} [opt] */
export function fireRocket(shooter, muzzle, dir, st, targetId, opt = {}) {
  const pr = st.projectile ?? { speed: 1.2, accel: 0.12, max: 3.2, power: 3.6 };
  const top = !!pr.topAttack && !!targetId;
  const kind = /** @type {any} */ (opt).kind ?? (targetId ? "seeker" : "rocket");
  addProj({
    type: targetId || /** @type {any} */ (opt).wire ? "seeker" : "rocket", kind, dim: shooter.dimension, pos: launchPoint(shooter, muzzle),
    vel: mul(top ? norm(add(dir, { x: 0, y: 1.2, z: 0 })) : dir, pr.speed), ownerId: shooter.id, maxAge: /** @type {any} */ (opt).maxAge ?? 120,
    data: { st, accel: pr.accel, max: pr.max, power: /** @type {any} */ (opt).power ?? pr.power, turn: pr.turn ?? 0.15, target: targetId, weaponId: st.id, top, phase: 0, wire: /** @type {any} */ (opt).wire ?? null },
  }, true);
}

/**
 * 誘導ミサイル（ボス・対装甲ランチャー座）
 * @param {import("@minecraft/server").Entity} shooter @param {import("../util/math.js").Vec3} from @param {import("../util/math.js").Vec3} dir
 * @param {{targetId?:string|null, wire?:string|null, power?:number, speed?:number, dmg?:number, weaponId?:string}} o
 */
export function fireMissile(shooter, from, dir, o) {
  const st = { id: o.weaponId ?? "missile", dmg: o.dmg ?? 8, armorBonus: 1.5, cat: "launcher" };
  addProj({
    type: "seeker", kind: "missile", dim: shooter.dimension, pos: from, vel: mul(norm(dir), o.speed ?? 0.9), ownerId: shooter.id, maxAge: 160,
    data: { st, accel: 0.08, max: 2.4, power: o.power ?? 2.4, turn: 0.18, target: o.targetId ?? null, weaponId: st.id, top: false, phase: 0, wire: o.wire ?? null },
  }, true);
}

/** 照明弾 @param {import("@minecraft/server").Entity} shooter @param {import("../util/math.js").Vec3} muzzle @param {import("../util/math.js").Vec3} dir @param {any} st */
export function fireFlare(shooter, muzzle, dir, st) {
  const pr = st.projectile ?? { speed: 1.6, gravity: 0.03, fire: 6, light: 300 };
  addProj({ type: "flare", kind: "flare", dim: shooter.dimension, pos: launchPoint(shooter, muzzle), vel: mul(dir, pr.speed), ownerId: shooter.id, maxAge: 160, data: { st, gravity: pr.gravity, fire: pr.fire, light: pr.light } }, true);
}

/** グラップル @param {import("@minecraft/server").Entity} shooter @param {import("../util/math.js").Vec3} muzzle @param {import("../util/math.js").Vec3} dir @param {any} st */
export function fireHook(shooter, muzzle, dir, st) {
  for (const p of list) if (p.type === "hook" && p.ownerId === shooter.id) removeProj(p);
  addProj({ type: "hook", kind: "hook", dim: shooter.dimension, pos: launchPoint(shooter, muzzle), vel: mul(dir, 2.6), ownerId: shooter.id, maxAge: 60, data: { st, range: st.range1, attached: null, pullTicks: 0 } }, true);
}

/**
 * 投擲
 * @param {Player} thrower @param {string} tid @param {number} heldTicks
 */
export function throwItem(thrower, tid, heldTicks) {
  const t = /** @type {any} */ (DATA.THROWABLES)[tid];
  if (!t) return;
  const eye = thrower.getHeadLocation();
  const dir = thrower.getViewDirection();
  const aim = norm(add(dir, { x: 0, y: 0.12, z: 0 }));
  const vel = add(mul(aim, t.speed), mul(thrower.getVelocity(), 0.6));
  const start = launchPoint(thrower, add(eye, mul(dir, 0.5)));
  let fuse = t.fuse ?? -1;
  if (t.cook && fuse > 0) fuse = Math.max(3, fuse - heldTicks);
  addProj({ type: "throw", kind: t.kind === "frag" ? "frag" : t.kind, dim: thrower.dimension, pos: start, vel, ownerId: thrower.id, maxAge: t.kind === "c4" ? 20 * 60 * 10 : 600, fuse, data: { t, tid } }, true);
}

/**
 * クッキングしすぎて手元で爆発
 * @param {Player} thrower @param {string} tid
 */
export function explodeInHand(thrower, tid) {
  const t = /** @type {any} */ (DATA.THROWABLES)[tid];
  const loc = thrower.getHeadLocation();
  explosionFx(thrower.dimension, loc, t.power);
  explode(thrower.dimension, loc, t.power, thrower, explosionBreaksBlocks(), false, tid);
}

/**
 * 地雷の設置
 * @param {Player} player @param {import("../util/math.js").Vec3} loc
 */
export function placeMine(player, loc) {
  const t = DATA.THROWABLES.landmine;
  const pr = addProj({ type: "mine", kind: "mine", dim: player.dimension, pos: loc, vel: { x: 0, y: 0, z: 0 }, ownerId: player.id, maxAge: 20 * 60 * 60, fuse: -1, data: { t, armAt: system.currentTick + 40 } }, true);
  pr.stuck = { entityId: null, offset: null };
  playNear(player.dimension, loc, "arsenal.fx.mine_arm", { range: 12, volume: 0.8 });
}

/**
 * 戦術核を置く（地面の上。15 秒後に爆発）
 * @param {Player} player @param {import("../util/math.js").Vec3} loc
 */
export function placeNuke(player, loc) {
  const t = nukeSpec();
  const pr = addProj({ type: "throw", kind: "nuke", dim: player.dimension, pos: loc, vel: { x: 0, y: 0, z: 0 }, ownerId: player.id, maxAge: t.fuse + 40, fuse: t.fuse, data: { t, tid: "tactical_nuke" } }, true);
  pr.stuck = { entityId: null, offset: null };
  syncVisual(pr);
  return pr;
}

/** 起爆装置 @param {Player} player */
export function detonateC4(player) {
  let n = 0;
  for (const p of list) {
    if (p.dead || p.ownerId !== player.id || p.data?.t?.kind !== "c4") continue;
    if (dist(p.pos, player.location) > 96) continue;
    const delay = n * 3;
    n++;
    system.runTimeout(() => safe("c4.boom", () => { if (!p.dead) detonate(p); }), delay + 2);
  }
  return n;
}

/** 設置済み C4 の数 @param {string} ownerId */
export function countC4(ownerId) {
  return list.filter((p) => !p.dead && p.ownerId === ownerId && p.data?.t?.kind === "c4").length;
}

// ---------------------------------------------------------------------------
//  シミュレーション
// ---------------------------------------------------------------------------


/**
 * レイ判定の取りこぼし（ブロックの面上・内部から始まるレイ）を補う：終点がブロックの中なら、進入点を探す
 * @param {import("@minecraft/server").Dimension} dim @param {import("../util/math.js").Vec3} from @param {import("../util/math.js").Vec3} d @param {number} L
 */
function marchSolid(dim, from, d, L) {
  const at = (/** @type {number} */ t) => ({ x: from.x + d.x * t, y: from.y + d.y * t, z: from.z + d.z * t });
  const end = at(L);
  if (!isSolidBlock(dim.getBlock(end))) {
    // 始点がすでに埋まっている（前 tick に面の上へ止まった）場合
    if (!isSolidBlock(dim.getBlock(from))) return null;
  }
  let prev = from;
  const n = Math.max(2, Math.ceil(L / 0.1));
  for (let i = 0; i <= n; i++) {
    const p = at((L * i) / n);
    const b = dim.getBlock(p);
    if (isSolidBlock(b) && b) {
      const bx = Math.floor(p.x), by = Math.floor(p.y), bz = Math.floor(p.z);
      const px = Math.floor(prev.x), py = Math.floor(prev.y), pz = Math.floor(prev.z);
      let normal = { x: 0, y: 0, z: 0 };
      if (py !== by) normal = { x: 0, y: py > by ? 1 : -1, z: 0 };
      else if (px !== bx) normal = { x: px > bx ? 1 : -1, y: 0, z: 0 };
      else if (pz !== bz) normal = { x: 0, y: 0, z: pz > bz ? 1 : -1 };
      else {
        // 最初から中にいる：進行方向と逆向きの最も近い面
        const ax = Math.abs(d.x), ay = Math.abs(d.y), az = Math.abs(d.z);
        if (ay >= ax && ay >= az) normal = { x: 0, y: d.y > 0 ? -1 : 1, z: 0 };
        else if (ax >= az) normal = { x: d.x > 0 ? -1 : 1, y: 0, z: 0 };
        else normal = { x: 0, y: 0, z: d.z > 0 ? -1 : 1 };
      }
      // 面の上の点
      const face = { x: p.x, y: p.y, z: p.z };
      if (normal.y === 1) face.y = by + 1;
      else if (normal.y === -1) face.y = by;
      else if (normal.x === 1) face.x = bx + 1;
      else if (normal.x === -1) face.x = bx;
      else if (normal.z === 1) face.z = bz + 1;
      else if (normal.z === -1) face.z = bz;
      return { point: face, normal, block: b };
    }
    prev = p;
  }
  return null;
}

/**
 * 区間の衝突判定
 * @param {Proj} p @param {import("../util/math.js").Vec3} from @param {import("../util/math.js").Vec3} step
 * @param {boolean} entities
 * @returns {{kind:"none"}|{kind:"void"}|{kind:"block", point:import("../util/math.js").Vec3, normal:import("../util/math.js").Vec3, block:import("@minecraft/server").Block}|{kind:"entity", point:import("../util/math.js").Vec3, entity:import("@minecraft/server").Entity}}
 */
function sweep(p, from, step, entities = true) {
  const L = len(step);
  if (L < 1e-5) return { kind: "none" };
  const d = mul(step, 1 / L);
  // 読み込まれていない先へは進めない
  if (loadedReach(p.dim, from, d, L + 0.05, system.currentTick) < L + 0.05) return { kind: "void" };
  /** @type {any} */
  let result = { kind: "none" };
  safe("proj.sweep", () => {
    const bh = p.dim.getBlockFromRay(from, d, { maxDistance: L + 0.05, includeLiquidBlocks: false, includePassableBlocks: false });
    let bd = L + 1;
    if (bh) {
      const pt = hitPoint(bh);
      bd = dist(from, pt);
      result = { kind: "block", point: pt, normal: faceNormal(bh.face), block: bh.block };
    } else {
      const m = marchSolid(p.dim, from, d, L + 0.05);
      if (m) {
        bd = dist(from, m.point);
        result = { kind: "block", point: m.point, normal: m.normal, block: m.block };
      }
    }
    if (entities) {
      const hits = p.dim.getEntitiesFromRay(from, d, { maxDistance: Math.max(0.01, Math.min(bd, L + 0.05)), ignoreBlockCollision: true, excludeFamilies: ["inanimate", "arsenal_fx", "projectile"], excludeTypes: ["minecraft:item", "minecraft:xp_orb"] });
      hits.sort((a, b) => a.distance - b.distance);
      for (const h of hits) {
        if (p.hitSet.has(h.entity.id)) continue;
        if (p.age < 3 && h.entity.id === p.ownerId) continue;
        result = { kind: "entity", point: add(from, mul(d, h.distance)), entity: h.entity };
        break;
      }
    }
  });
  return result;
}

/** 見た目エンティティの追従 @param {Proj} p */
function syncVisual(p) {
  if (!p.ent) return;
  safe("proj.sync", () => {
    if (!p.ent || !p.ent.isValid) {
      p.ent = spawnVisual(p.dim, p.pos, p.kind);
      return;
    }
    const sp = len(p.vel);
    if (sp > 0.05) {
      const r = rotFromDir(p.vel);
      p.ent.teleport(p.pos, { rotation: { x: r.pitch, y: r.yaw } });
    } else {
      p.ent.teleport(p.pos);
    }
  });
}

/** 起爆 @param {Proj} p */
function detonate(p) {
  if (p.dead) return;
  const src = owner(p.ownerId);
  const t = p.data.t;
  const kind = t ? t.kind : p.type;
  const loc = p.pos;
  if (kind === "nuke" || p.data.nuke) {
    removeProj(p);
    detonateNuke(p.dim, loc, p.ownerId, p.data.tid ?? "tactical_nuke");
    return;
  }
  if (kind === "smoke") {
    const v = new MolangVariableMap();
    v.setFloat("variable.duration", t.duration / 20);
    v.setFloat("variable.radius", t.radius);
    safe("smoke", () => p.dim.spawnParticle("arsenal:smoke_cloud", add(loc, { x: 0, y: 1.0, z: 0 }), v));
    playNear(p.dim, loc, "arsenal.fx.smoke", { range: 32 });
    zones.push({ kind: "smoke", dim: p.dim, pos: loc, radius: t.radius, until: system.currentTick + t.duration, ownerId: p.ownerId });
    removeProj(p);
    return;
  }
  if (kind === "flash") {
    flashbang(p.dim, loc, t.radius);
    removeProj(p);
    return;
  }
  if (kind === "molotov") {
    molotov(p, loc);
    removeProj(p);
    return;
  }
  if (kind === "gas") {
    const v = new MolangVariableMap();
    v.setFloat("variable.duration", t.duration / 20);
    v.setFloat("variable.radius", t.radius);
    emit(p.dim, "arsenal:gas_cloud", add(loc, { x: 0, y: 0.8, z: 0 }), v, { range: 96 });
    playNear(p.dim, loc, "arsenal.fx.smoke", { range: 32, pitch: 0.7 });
    zones.push({ kind: "gas", dim: p.dim, pos: loc, radius: t.radius, until: system.currentTick + t.duration, ownerId: p.ownerId });
    removeProj(p);
    return;
  }
  if (kind === "emp") {
    const v = new MolangVariableMap();
    v.setFloat("variable.radius", t.radius);
    emit(p.dim, "arsenal:emp_wave", add(loc, { x: 0, y: 0.3, z: 0 }), v, { range: 96 });
    playNear(p.dim, loc, "arsenal.gear.emp", { range: 48 });
    empHandler(p.dim, loc, t.radius, t.duration, p.ownerId);
    removeProj(p);
    return;
  }
  if (kind === "decoy") {
    decoys.push({ dim: p.dim, pos: loc, radius: t.radius, until: system.currentTick + t.duration, ownerId: p.ownerId });
    zones.push({ kind: "decoy", dim: p.dim, pos: loc, radius: t.radius, until: system.currentTick + t.duration, ownerId: p.ownerId });
    removeProj(p);
    return;
  }
  if (kind === "snap") {
    playNear(p.dim, loc, "arsenal.world.sonar", { range: 48 });
    zones.push({ kind: "snap", dim: p.dim, pos: loc, radius: t.radius, until: system.currentTick + t.duration, ownerId: p.ownerId });
    removeProj(p);
    return;
  }
  if (kind === "cluster") {
    explosionFx(p.dim, loc, t.power);
    explode(p.dim, loc, t.power, src, explosionBreaksBlocks(), false, p.data.tid);
    for (let i = 0; i < (t.bomblets ?? 5); i++) {
      const a = (i / (t.bomblets ?? 5)) * Math.PI * 2 + Math.random();
      const vel = { x: Math.cos(a) * rand(0.25, 0.45), y: rand(0.35, 0.55), z: Math.sin(a) * rand(0.25, 0.45) };
      addProj({ type: "throw", kind: "bomblet", dim: p.dim, pos: add(loc, { x: 0, y: 0.4, z: 0 }), vel, ownerId: p.ownerId, maxAge: 200, fuse: 18 + i * 4, data: { t: { kind: "bomblet", power: t.bombletPower ?? 1.6 }, tid: p.data.tid } }, true);
    }
    removeProj(p);
    return;
  }
  const power = t ? t.power : p.data.power ?? 3;
  explosionFx(p.dim, loc, power);
  explode(p.dim, loc, power, src, explosionBreaksBlocks(), false, t ? p.data.tid : p.data.weaponId ?? null);
  removeProj(p);
}

/**
 * フラッシュバン
 * @param {import("@minecraft/server").Dimension} dim @param {import("../util/math.js").Vec3} loc @param {number} radius
 */
function flashbang(dim, loc, radius) {
  emit(dim, "arsenal:flash_burst", loc, undefined, { range: 96 });
  playNear(dim, loc, "arsenal.fx.flash_bang", { range: 64 });
  safe("flash", () => {
    for (const e of dim.getEntities({ location: loc, maxDistance: radius, excludeFamilies: ["inanimate", "arsenal_fx"] })) {
      const eye = e.getHeadLocation();
      const to = sub(loc, eye);
      const d = len(to);
      if (d > 0.5) {
        const bh = dim.getBlockFromRay(eye, norm(to), { maxDistance: d - 0.3, includePassableBlocks: false, includeLiquidBlocks: false });
        if (bh) continue;
      }
      const facing = d > 0.5 ? dot(e.getViewDirection(), norm(to)) : 1;
      const I = clamp((1 - d / radius) * (0.3 + 0.7 * Math.max(0, facing)) * 1.3, 0, 1);
      if (I < 0.08) continue;
      if (e instanceof Player) {
        safe("flash.fade", () => e.camera.fade({ fadeColor: { red: 1, green: 1, blue: 1 }, fadeTime: { fadeInTime: 0.02, holdTime: 0.3 + 2.8 * I, fadeOutTime: 1.2 + 2.0 * I } }));
        e.addEffect("blindness", Math.round(30 + 90 * I), { amplifier: 0, showParticles: false });
        playTo(e, "arsenal.fx.flash_ring", { volume: I });
      } else {
        e.addEffect("slowness", Math.round(40 + 80 * I), { amplifier: 2, showParticles: false });
        e.addEffect("weakness", Math.round(40 + 80 * I), { amplifier: 1, showParticles: false });
      }
    }
  });
}

/** @param {Proj} p @param {import("../util/math.js").Vec3} loc */
function molotov(p, loc) {
  const t = p.data.t;
  playNear(p.dim, loc, "arsenal.fx.glass", { range: 24 });
  playNear(p.dim, loc, "arsenal.fx.fire", { range: 32 });
  const v = new MolangVariableMap();
  v.setFloat("variable.radius", t.radius);
  v.setFloat("variable.duration", t.duration / 20);
  safe("molotov.fx", () => p.dim.spawnParticle("arsenal:fire_patch", add(loc, { x: 0, y: 0.1, z: 0 }), v));
  if (explosionBreaksBlocks()) {
    safe("molotov.fire", () => {
      const r = Math.ceil(t.radius);
      for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
        if (dx * dx + dz * dz > t.radius * t.radius) continue;
        if (Math.random() < 0.35) continue;
        for (let dy = 1; dy >= -2; dy--) {
          const bl = p.dim.getBlock({ x: Math.floor(loc.x) + dx, y: Math.floor(loc.y) + dy, z: Math.floor(loc.z) + dz });
          const below = bl?.below();
          if (bl && bl.isAir && below && !below.isAir && !below.isLiquid) {
            bl.setType("minecraft:fire");
            break;
          }
        }
      }
    });
  }
  zones.push({ kind: "fire", dim: p.dim, pos: loc, radius: t.radius, until: system.currentTick + t.duration, ownerId: p.ownerId });
}

/** @type {{kind:string, dim:import("@minecraft/server").Dimension, pos:import("../util/math.js").Vec3, radius:number, until:number, ownerId:string}[]} */
const zones = [];

/** @type {{dim:import("@minecraft/server").Dimension, pos:import("../util/math.js").Vec3, until:number}[]} */
const lights = [];

/** 照明弾が置いた光源（弾が消えずに残った場合の保険） @type {Map<string, {dim:import("@minecraft/server").Dimension, pos:import("../util/math.js").Vec3, id:string, until:number}>} */
const movingLights = new Map();

/**
 * 一時的な光源
 * @param {import("@minecraft/server").Dimension} dim @param {import("../util/math.js").Vec3} pos @param {number} ticks
 */
export function tempLight(dim, pos, ticks) {
  safe("tempLight", () => {
    const b = dim.getBlock({ x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) });
    if (!b || !b.isAir) return;
    b.setType("minecraft:light_block_14");
    lights.push({ dim, pos: b.location, until: system.currentTick + ticks });
  });
}

/** @param {Proj} p */
function tickOne(p) {
  p.age++;
  // 読み込み範囲の外に出た（プレイヤーから離れすぎた）ものは静かに消す
  if (!isLoaded(p.dim, p.pos, system.currentTick)) return removeProj(p);
  if (p.age > p.maxAge) {
    if (p.type === "throw" && p.data.t.kind !== "c4" && p.data.t.kind !== "sticky" && p.data.t.kind !== "knife") detonate(p);
    else if (p.type === "rocket" || p.type === "seeker" || p.type === "pathfinder" || p.type === "mortar") detonate(p);
    else if (p.type === "spec" && p.data.mode === "clustershell") clusterBurst(p);
    else if (p.type === "ballistic" || p.type === "cruise") detonate(p);
    else if (p.type === "guided") guidedEnd(p, true);
    else {
      if (p.type === "knife") dropKnife(p, p.pos);
      removeProj(p);
    }
    return;
  }
  const now = system.currentTick;
  switch (p.type) {
    case "bullet": return tickBullet(p);
    case "gl40": return tickGl40(p);
    case "rocket":
    case "seeker": return tickRocket(p);
    case "pathfinder": return tickPathMissile(p);
    case "flare": return tickFlare(p);
    case "hook": return tickHook(p);
    case "throw": return tickThrow(p, now);
    case "mine": return tickMine(p, now);
    case "plasma": return tickPlasma(p);
    case "needle": return tickNeedle(p);
    case "mortar": return tickMortar(p);
    case "knife": return tickKnife(p);
    case "spec": return tickSpec(p);
    case "ballistic": return tickBallistic(p);
    case "cruise": return tickCruise(p);
    case "guided": return tickGuided(p);
  }
}

/** @param {Proj} p */
function tickBullet(p) {
  if (p.dead) return;
  // 1 tick に 1 区間だけ進める（撃った tick にその場で進めた弾を、同じ tick の一斉更新でもう一度進めない）
  if (p.data.stepTick === system.currentTick) return;
  p.data.stepTick = system.currentTick;
  const shooter = owner(p.ownerId);
  if (!shooter) return removeProj(p);
  const st = p.data.st;
  const from = p.pos;
  const L = len(p.vel);
  const dir = mul(p.vel, 1 / L);
  const r = traceHitscan(shooter, from, dir, st, { maxRange: L, pen: p.data.pen, hitSet: p.hitSet, distOffset: p.traveled, mulDmg: p.data.mulDmg, silent: !!p.data.silent });
  if (p.data.tracer !== false) drawTracer(shooter, p.data.first ? p.data.muzzle : from, r.end, st, true, p.id);
  if (p.data.first && p.data.whizz !== false) whizzBy(shooter, from, add(from, mul(dir, Math.min(200, st.range1))), isSupersonic(st));
  if (st.explosive && (r.stopped || r.hitEntity)) miniBlast(shooter, r.end, 1.4, 3.0, st.id);
  p.data.first = false;
  p.data.pen = r.pen;
  p.data.mulDmg = r.mulDmg;
  p.traveled += L;
  if (r.stopped || r.cut || p.traveled >= st.range1) return removeProj(p);
  p.pos = r.end;
  p.vel = add(p.vel, { x: WS().wind ? wind.x : 0, y: -p.data.gravity, z: WS().wind ? wind.z : 0 });
}

/** 見た目のエンティティ（arsenal:projectile）の当たり判定の半分の幅と高さ（entities.py の collision_box） */
const VIS_HALF = 0.05;
const VIS_H = 0.1;

/**
 * mob にくっつく位置：当たった面のすぐ外側。見た目のエンティティの箱が mob の箱に重なると、
 * mob が押し出され続ける（BDS で確認：重なると 5 秒で約 0.67 ブロック、重ならなければ 0）
 * @param {import("@minecraft/server").Entity} e @param {import("../util/math.js").Vec3} point
 */
function outsideBox(e, point) {
  const box = safe("stick.aabb", () => e.getAABB());
  if (!box) return point;
  const c = box.center;
  const x = box.extent;
  const l = sub(point, c);
  const rx = Math.abs(l.x) / Math.max(1e-3, x.x);
  const ry = Math.abs(l.y) / Math.max(1e-3, x.y);
  const rz = Math.abs(l.z) / Math.max(1e-3, x.z);
  // すき間：横は 0.03 で押されない。上は 0.02 だと豚・牛・羊が押され、0.1 なら押されない（BDS で確認）
  const gap = 0.03;
  const gapTop = 0.1;
  if (ry >= rx && ry >= rz) {
    // 上面（または下面）：箱の下端が mob の上端より上、または箱の上端が mob の下端より下
    const y = l.y >= 0 ? c.y + x.y + gapTop : c.y - x.y - VIS_H - gapTop;
    return { x: c.x + clamp(l.x, -x.x, x.x), y, z: c.z + clamp(l.z, -x.z, x.z) };
  }
  const y = c.y + clamp(l.y, -(x.y - VIS_H / 2), x.y - VIS_H / 2) - VIS_H / 2;
  if (rx >= rz) return { x: c.x + Math.sign(l.x || 1) * (x.x + VIS_HALF + gap), y, z: c.z + clamp(l.z, -x.z, x.z) };
  return { x: c.x + clamp(l.x, -x.x, x.x), y, z: c.z + Math.sign(l.z || 1) * (x.z + VIS_HALF + gap) };
}

/** @param {Proj} p */
function tickGl40(p) {
  if (p.fuse > 0) {
    p.fuse--;
    if (p.fuse === 0) return detonate(p);
  }
  p.vel = add(mul(p.vel, 0.995), { x: 0, y: -p.data.gravity, z: 0 });
  const h = sweep(p, p.pos, p.vel);
  if (h.kind === "void") return removeProj(p);
  // 跳ねるグレネード（バウンサー）：壁や地面では跳ね、敵に当たるか時間切れで爆発
  if (h.kind === "block" && p.data.bounces > 0) {
    p.data.bounces--;
    p.pos = add(h.point, mul(h.normal, 0.12));
    const vn = mul(h.normal, dot(p.vel, h.normal));
    const vt = sub(p.vel, vn);
    p.vel = add(mul(vn, -0.55), mul(vt, 0.8));
    playNear(p.dim, p.pos, "arsenal.fx.bounce", { range: 16, pitch: 1.2 });
    syncVisual(p);
    return;
  }
  // 安全距離（発射点からの飛翔距離）。至近距離で地面に撃ち込むと不発になる
  const armed = p.traveled + (h.kind === "block" || h.kind === "entity" ? dist(p.pos, h.point) : 0) >= p.data.arm;
  if (h.kind === "block" || h.kind === "entity") {
    p.pos = h.kind === "block" ? add(h.point, mul(h.normal, 0.12)) : h.point;
    if (armed) return detonate(p);
    // 未起爆：跳ねて転がる（不発）
    if (h.kind === "block") {
      p.vel = mul(reflect(p.vel, h.normal), 0.3);
      playNear(p.dim, p.pos, "arsenal.fx.bounce", { range: 16 });
    } else {
      p.vel = mul(p.vel, -0.2);
      p.hitSet.add(h.entity.id);
      const src = owner(p.ownerId);
      if (src && canDamage(src, h.entity)) dealDamage(src, h.entity, 4, { weaponId: p.data.weaponId });
    }
    if (len(p.vel) < 0.05) p.maxAge = Math.min(p.maxAge, p.age + 40);
  } else {
    p.traveled += len(p.vel);
    p.pos = add(p.pos, p.vel);
  }
  if (p.age % 2 === 0) emit(p.dim, "arsenal:shell_trail", p.pos, undefined, { range: 96, minQ: 1 });
  syncVisual(p);
}

/** @param {Proj} p */
function tickRocket(p) {
  const sp = Math.min(p.data.max, len(p.vel) + p.data.accel);
  let dir = norm(p.vel);
  if (p.data.wire) {
    // 有線誘導：撃ち手（銃座の射手）が見ている先へ曲がる
    const rider = world.getEntity(p.data.wire);
    if (rider && rider.isValid) {
      const eye = rider.getHeadLocation();
      const vd = rider.getViewDirection();
      const reach = loadedReach(rider.dimension, eye, vd, 160, system.currentTick);
      const bh = reach >= 0.5 ? safe("wire.ray", () => rider.dimension.getBlockFromRay(eye, vd, { maxDistance: reach, includePassableBlocks: false, includeLiquidBlocks: false })) : undefined;
      const aim = bh ? hitPoint(bh) : add(eye, mul(vd, 160));
      dir = norm(add(mul(dir, 0.78), mul(norm(sub(aim, p.pos)), 0.22)));
    }
  } else if (p.type === "seeker" && p.data.target) {
    const tgt = world.getEntity(p.data.target);
    if (tgt && tgt.isValid) {
      const box = tgt.getAABB();
      let aim = box.center;
      // 上から落ちる誘導弾：目標の真上まで上昇してから急降下（装甲の薄い上面を狙う）
      if (p.data.top && p.data.phase === 0) {
        const hd = Math.hypot(aim.x - p.pos.x, aim.z - p.pos.z);
        if (hd > 10) aim = { x: aim.x, y: Math.max(p.pos.y, aim.y + 16), z: aim.z };
        else p.data.phase = 1;
      }
      const want = norm(sub(aim, p.pos));
      const turn = p.data.top && p.data.phase === 1 ? 0.45 : p.data.turn;
      dir = norm(add(mul(dir, 1 - turn), mul(want, turn)));
      if (p.age % 4 === 0) playNear(p.dim, p.pos, "arsenal.fx.lock_beep", { range: 24, volume: 0.4, pitch: 1.6 });
    }
  }
  p.vel = mul(dir, sp);
  const h = sweep(p, p.pos, p.vel);
  if (h.kind === "void") return removeProj(p);
  if (h.kind !== "none") {
    if (h.kind === "entity") rocketDirectHit(p, h.entity);
    p.pos = add(h.point, mul(dir, -0.3));
    return detonate(p);
  }
  p.pos = add(p.pos, p.vel);
  emit(p.dim, "arsenal:rocket_trail", add(p.pos, mul(dir, -0.4)), undefined, { range: 96 });
  syncVisual(p);
}

/** ロケットの直撃：装甲目標には追加ダメージ（対物・対装甲） @param {Proj} p @param {import("@minecraft/server").Entity} target */
function rocketDirectHit(p, target) {
  const src = owner(p.ownerId);
  const st = p.data.st;
  if (src && canDamage(src, target) && target.getComponent("minecraft:health")) {
    const bonus = isArmored(target) ? st.armorBonus ?? 1 : 1;
    const r = dealDamage(src, target, (st.dmg ?? 6) * bonus * WS().damageMul, { weaponId: p.data.weaponId, kind: "explosive" });
    hitFeedback(src, r.killed ? "kill" : "hit", r.dealt);
  }
}

// ---------------------------------------------------------------------------
//  経路探索ミサイル（アリアドネ）
//  撃つ前に見つけた道（pathfind.js）の上を飛ぶ。ほかのロケットと同じく、毎 tick の移動はすべてレイで衝突判定する
//  （ブロックをすり抜けない・ワープしない）。目標が動けば道の終点を合わせ、届かなくなったら今いる場所から探し直す。
//  探し直している間はその場で待つ。合わせて 3 秒待っても道がなければ、その場で起爆する
// ---------------------------------------------------------------------------

/**
 * @param {import("@minecraft/server").Entity} shooter @param {import("../util/math.js").Vec3} muzzle @param {import("../util/math.js").Vec3} dir
 * @param {any} st @param {string} targetId @param {import("../util/math.js").Vec3[]} path 目から目標までの道
 */
export function firePathMissile(shooter, muzzle, dir, st, targetId, path) {
  const pr = st.projectile ?? { speed: 0.7, accel: 0.08, max: 1.5, power: 3.0 };
  const dim = shooter.dimension;
  const start = launchPoint(shooter, muzzle);
  // 道は目から始まる。銃口から道の 2 点目へ直接行けなければ、いったん目の位置（銃口→目は launchPoint が確かめた区間）を通る
  const rest = path.slice(1);
  const pts = rest.length && segOk(dim, start, rest[0]) ? [start, ...rest] : [start, shooter.getHeadLocation(), ...rest];
  addProj({
    type: "pathfinder", kind: "seeker", dim, pos: start, vel: mul(norm(dir), pr.speed), ownerId: shooter.id, maxAge: 400,
    data: { st, accel: pr.accel, max: pr.max, speed: pr.speed, power: pr.power, target: targetId, weaponId: st.id, path: pts, idx: 1, search: null, stall: 0 },
  }, true);
}

/** @param {Proj} p */
function tickPathMissile(p) {
  const d = p.data;
  const tgt = d.target ? world.getEntity(d.target) : undefined;
  if (!tgt || !tgt.isValid || tgt.dimension.id !== p.dim.id) {
    // 目標が消えた：ふつうのロケットとしてまっすぐ飛ぶ
    cancelSearch(d.search);
    p.type = "rocket";
    d.target = null;
    return tickRocket(p);
  }
  const box = tgt.getAABB();
  const goal = box.center;
  const bmin = sub(box.center, box.extent);
  const bmax = add(box.center, box.extent);
  const replan = () => {
    if (!d.search) d.search = startSearch(p.dim, p.pos, { min: bmin, max: bmax }, goal);
  };
  /** @type {import("../util/math.js").Vec3[]} */
  let path = d.path;
  // 道の終点を目標の今の位置へ合わせる（届かなければ探し直す）
  const end = path[path.length - 1];
  if (dist(end, goal) > 0.25) {
    const base = d.idx >= path.length - 1 ? p.pos : path[path.length - 2];
    if (segOk(p.dim, base, goal)) path[path.length - 1] = goal;
    else if (segOk(p.dim, end, goal)) path.push(goal);
    else replan();
    // 終点まで来ていたなら、動いた終点へ向かい直す
    if (d.idx >= path.length) d.idx = path.length - 1;
  }
  // 次の区間が今も通れるか（ブロックが置かれた・扉が閉まった）
  let blocked = d.idx < path.length && !segOk(p.dim, p.pos, path[d.idx]);
  if (blocked) replan();
  if (d.search && d.search.state !== "run") {
    if (d.search.state === "ok" && d.search.path) {
      d.path = path = [p.pos, ...d.search.path.slice(1)];
      d.idx = 1;
      d.stall = 0;
      blocked = false;
    }
    d.search = null;
  }
  if (blocked || d.search) {
    // 探し直している間・次の区間がふさがれている間はその場で待つ（すり抜けない。新しい道は今いる場所から始まる）
    d.stall++;
    d.speed = Math.min(d.speed, 0.4);
    if (d.stall > 60) {
      cancelSearch(d.search);
      return detonate(p);
    }
    emit(p.dim, "arsenal:rocket_trail", p.pos, undefined, { range: 96 });
    syncVisual(p);
    return;
  }
  d.speed = Math.min(d.max, d.speed + d.accel);
  // 道に沿って進む。区間ごとにレイで衝突判定（曲がり角をまたぐ tick も、角を切らずに区間をたどる）
  let remaining = d.speed;
  let lastDir = norm(p.vel);
  for (let guard = 0; remaining > 1e-4 && d.idx < path.length && guard < 16; guard++) {
    const to = path[d.idx];
    const seg = sub(to, p.pos);
    const L = len(seg);
    if (L < 1e-4) {
      d.idx++;
      continue;
    }
    const dir = mul(seg, 1 / L);
    const step = Math.min(L, remaining);
    const h = sweep(p, p.pos, mul(dir, step));
    if (h.kind === "void") {
      cancelSearch(d.search);
      return removeProj(p);
    }
    if (h.kind === "block" && (d.bumps ?? 0) < 4) {
      // 覚えていたマスの判定が古かった（直前にブロックが置かれた）：ぶつかる手前で止まり、そのマスを調べ直して道を探し直す
      d.bumps = (d.bumps ?? 0) + 1;
      invalidateCell(p.dim, h.block.location);
      const back = Math.max(0, dist(p.pos, h.point) - 0.3);
      p.pos = add(p.pos, mul(dir, back));
      replan();
      break;
    }
    if (h.kind !== "none") {
      if (h.kind === "entity") rocketDirectHit(p, h.entity);
      cancelSearch(d.search);
      p.pos = add(h.point, mul(dir, -0.3));
      return detonate(p);
    }
    p.pos = add(p.pos, mul(dir, step));
    remaining -= step;
    lastDir = dir;
    if (step >= L - 1e-6) d.idx++;
  }
  p.vel = mul(lastDir, d.speed);
  // 道の終点（目標の中心）まで来たのに体に触れていない（終点の直前で目標が動いた）：近接信管
  if (d.idx >= path.length && dist(p.pos, goal) < 1.2) {
    rocketDirectHit(p, tgt);
    cancelSearch(d.search);
    return detonate(p);
  }
  if (p.age % 4 === 0) playNear(p.dim, p.pos, "arsenal.fx.lock_beep", { range: 24, volume: 0.4, pitch: 1.8 });
  emit(p.dim, "arsenal:rocket_trail", add(p.pos, mul(lastDir, -0.4)), undefined, { range: 96 });
  syncVisual(p);
}

// ---------------------------------------------------------------------------
//  2.0：プラズマ・ニードル・迫撃砲
// ---------------------------------------------------------------------------

/** プラズマ弾 @param {import("@minecraft/server").Entity} shooter @param {import("../util/math.js").Vec3} muzzle @param {import("../util/math.js").Vec3} dir @param {any} st */
export function firePlasma(shooter, muzzle, dir, st) {
  const pr = st.projectile ?? { speed: 3.2, splash: 1.5, splashDmg: 2 };
  addProj({ type: "plasma", kind: "plasma", dim: shooter.dimension, pos: launchPoint(shooter, muzzle), vel: mul(dir, pr.speed), ownerId: shooter.id, maxAge: Math.ceil(st.range1 / pr.speed) + 2, data: { st, splash: pr.splash, splashDmg: pr.splashDmg, weaponId: st.id } }, true);
}

/** @param {Proj} p */
function tickPlasma(p) {
  const h = sweep(p, p.pos, p.vel);
  if (h.kind === "void") return removeProj(p);
  const v = new MolangVariableMap();
  v.setColorRGB("variable.color", { red: 0.45, green: 1.0, blue: 0.45 });
  emit(p.dim, "arsenal:plasma_glow", p.pos, v, { range: 96 });
  if (h.kind !== "none") {
    const src = owner(p.ownerId);
    const st = p.data.st;
    if (h.kind === "entity" && src) bulletHit(src, h.entity, h.point, norm(p.vel), p.traveled, st, 1);
    miniBlast(src, h.point, p.data.splash, p.data.splashDmg, p.data.weaponId);
    return removeProj(p);
  }
  p.traveled += len(p.vel);
  p.pos = add(p.pos, p.vel);
  syncVisual(p);
}

/** 刺さったニードルの数（対象ごと） @type {Map<string, {n:number, tick:number, ownerId:string}>} */
const needles = new Map();

/**
 * 追尾ニードル
 * @param {import("@minecraft/server").Entity} shooter @param {import("../util/math.js").Vec3} muzzle @param {import("../util/math.js").Vec3} dir @param {any} st @param {string|null} lockId
 */
export function fireNeedle(shooter, muzzle, dir, st, lockId) {
  const pr = st.projectile ?? { speed: 2.2, turn: 0.25, seek: 16, burst: 5, burstDmg: 8 };
  let target = lockId;
  if (!target) {
    // 前方の円錐で最も近い相手を追う
    safe("needle.seek", () => {
      const eye = shooter.getHeadLocation();
      let best = Math.cos((20 * Math.PI) / 180);
      for (const e of shooter.dimension.getEntities({ location: eye, maxDistance: pr.seek, excludeFamilies: ["inanimate", "arsenal_fx", "projectile"], excludeTypes: ["minecraft:item", "minecraft:xp_orb"] })) {
        if (e.id === shooter.id || !e.getComponent("minecraft:health") || !canDamage(shooter, e)) continue;
        const d = dot(norm(sub(e.getAABB().center, eye)), dir);
        if (d > best) {
          best = d;
          target = e.id;
        }
      }
    });
  }
  addProj({ type: "needle", kind: "needle", dim: shooter.dimension, pos: launchPoint(shooter, muzzle), vel: mul(dir, pr.speed), ownerId: shooter.id, maxAge: 50, data: { st, turn: pr.turn, target, burst: pr.burst, burstDmg: pr.burstDmg, weaponId: st.id } }, true);
}

/** @param {Proj} p */
function tickNeedle(p) {
  let dir = norm(p.vel);
  const sp = len(p.vel);
  if (p.data.target) {
    const t = world.getEntity(p.data.target);
    if (t && t.isValid) dir = norm(add(mul(dir, 1 - p.data.turn), mul(norm(sub(t.getAABB().center, p.pos)), p.data.turn)));
  }
  p.vel = mul(dir, sp);
  const h = sweep(p, p.pos, p.vel);
  if (h.kind === "void") return removeProj(p);
  if (p.age % 2 === 0) {
    const v = new MolangVariableMap();
    v.setColorRGB("variable.color", { red: 1.0, green: 0.35, blue: 0.85 });
    emit(p.dim, "arsenal:plasma_glow", p.pos, v, { range: 64, minQ: 1 });
  }
  if (h.kind !== "none") {
    const src = owner(p.ownerId);
    if (h.kind === "entity" && src) {
      const r = bulletHit(src, h.entity, h.point, dir, p.traveled, p.data.st, 1);
      if (r === "hit" && h.entity.isValid) {
        const now = system.currentTick;
        const cur = needles.get(h.entity.id);
        const n = cur && now - cur.tick < 60 ? cur.n + 1 : 1;
        needles.set(h.entity.id, { n, tick: now, ownerId: p.ownerId });
        if (n >= p.data.burst) {
          needles.delete(h.entity.id);
          const at = h.entity.getAABB().center;
          system.run(() => miniBlast(src, at, 1.8, p.data.burstDmg, p.data.weaponId));
        }
      }
    }
    return removeProj(p);
  }
  p.traveled += sp;
  p.pos = add(p.pos, p.vel);
  syncVisual(p);
}

/**
 * 迫撃砲弾（目標の地点に落ちる放物線）
 * @param {import("@minecraft/server").Entity} shooter @param {import("../util/math.js").Vec3} muzzle @param {import("../util/math.js").Vec3} dir @param {any} st
 * @param {import("../util/math.js").Vec3|null} target @param {number} [spread] 着弾のばらつき（ブロック）
 */
export function fireMortar(shooter, muzzle, dir, st, target, spread = 0) {
  const pr = st.projectile ?? { power: 3.4, flight: 50 };
  const from = launchPoint(shooter, muzzle);
  const to = target ?? add(from, mul(norm({ x: dir.x, y: 0, z: dir.z }), 40));
  const aim = { x: to.x + rand(-spread, spread), y: to.y, z: to.z + rand(-spread, spread) };
  const hd = Math.hypot(aim.x - from.x, aim.z - from.z);
  const T = Math.max(24, Math.min(90, Math.round((pr.flight ?? 50) * (0.6 + hd / 120))));
  const g = 0.06;
  const vel = { x: (aim.x - from.x) / T, y: (aim.y - from.y + 0.5 * g * T * T) / T, z: (aim.z - from.z) / T };
  addProj({ type: "mortar", kind: "mortar", dim: shooter.dimension, pos: from, vel, ownerId: shooter.id, maxAge: T + 40, data: { st, gravity: g, power: pr.power, weaponId: st.id, aim } }, true);
  playNear(shooter.dimension, aim, "arsenal.world.drop_whistle", { range: 48, volume: 0.6 });
}

/** @param {Proj} p */
function tickMortar(p) {
  p.vel = add(p.vel, { x: 0, y: -p.data.gravity, z: 0 });
  const h = sweep(p, p.pos, p.vel);
  if (h.kind === "void") return removeProj(p);
  // 着弾予定地点の警告（10 tick ごと）
  if (p.age % 10 === 0) {
    const v = new MolangVariableMap();
    v.setFloat("variable.radius", 2.5);
    emit(p.dim, "arsenal:target_marker", add(p.data.aim, { x: 0, y: 0.15, z: 0 }), v, { range: 96 });
  }
  if (h.kind !== "none") {
    p.pos = h.kind === "block" ? add(h.point, mul(h.normal, 0.2)) : h.point;
    return detonate(p);
  }
  p.pos = add(p.pos, p.vel);
  emit(p.dim, "arsenal:shell_trail", p.pos, undefined, { range: 96, minQ: 1 });
  syncVisual(p);
}

// ---------------------------------------------------------------------------
//  2.5：特殊武器の実体弾
// ---------------------------------------------------------------------------

/** 射撃方式 → 見た目の弾 */
const SPEC_VIS = { disc: "blade", singularity: "plasma", net: "hook", stasis: "plasma", empshot: "emp", tranq: "needle", harpoon: "hook", clustershell: "cluster" };
/** 飛んでいる間の光の色 */
const SPEC_COLOR = {
  disc: { red: 1.0, green: 0.8, blue: 0.3 }, singularity: { red: 0.65, green: 0.3, blue: 1.0 }, net: { red: 0.9, green: 0.9, blue: 0.5 },
  stasis: { red: 0.5, green: 1.0, blue: 0.95 }, empshot: { red: 0.5, green: 0.7, blue: 1.0 }, tranq: { red: 1.0, green: 0.85, blue: 0.5 },
  harpoon: { red: 0.8, green: 0.85, blue: 0.9 }, clustershell: { red: 1.0, green: 0.65, blue: 0.25 },
};

/**
 * 特殊武器の実体弾を撃つ（射撃方式は st.fire）
 * @param {import("@minecraft/server").Entity} shooter @param {import("../util/math.js").Vec3} muzzle @param {import("../util/math.js").Vec3} dir0 目からの向き（拡散込み） @param {any} st
 */
export function fireSpecial(shooter, muzzle, dir0, st) {
  const pr = st.projectile ?? {};
  const mode = st.fire;
  const from = launchPoint(shooter, muzzle);
  if (mode === "swarm") return fireSwarm(shooter, muzzle, dir0, st);
  // 銃口は目の横にあるので、目の視線が当たる点へ向けて撃つ（平行に飛ぶと細い的の端をかすめて外れた）
  const dir = converge(shooter, from, dir0, st.range1);
  if (mode === "stickybomb") {
    // 投げる粘着爆弾と同じ弾（張り付いてから fuse tick で爆発）
    addProj({ type: "throw", kind: "sticky", dim: shooter.dimension, pos: from, vel: mul(dir, pr.speed ?? 1.4), ownerId: shooter.id, maxAge: 400, fuse: pr.fuse ?? 30, data: { t: { kind: "sticky", power: pr.power ?? 2.4 }, tid: st.id } }, true);
    return;
  }
  const speed = pr.speed ?? 1.5;
  const bounces = pr.bounces ?? 0;
  addProj({
    type: "spec", kind: /** @type {any} */ (SPEC_VIS)[mode] ?? "plasma", dim: shooter.dimension, pos: from, vel: mul(dir, speed), ownerId: shooter.id,
    maxAge: Math.ceil((st.range1 * (1 + bounces * 0.5)) / speed) + 4,
    data: { st, mode, gravity: pr.gravity ?? 0, bounces, pierce: pr.pierce ?? 0, weaponId: st.id },
  }, true);
}

/**
 * 目の視線が最初に当たるもの（相手・ブロック、なければ射程の端）へ、from から向かう向き
 * @param {import("@minecraft/server").Entity} shooter @param {import("../util/math.js").Vec3} from @param {import("../util/math.js").Vec3} dir @param {number} range
 */
function converge(shooter, from, dir, range) {
  const eye = shooter.getHeadLocation();
  const reach = loadedReach(shooter.dimension, eye, dir, range, system.currentTick);
  if (reach < 2) return dir;
  let d = reach;
  const bh = safe("conv.block", () => shooter.dimension.getBlockFromRay(eye, dir, { maxDistance: reach, includeLiquidBlocks: false, includePassableBlocks: false }));
  if (bh) d = Math.min(d, dist(eye, hitPoint(bh)));
  const hits = safe("conv.ents", () => shooter.dimension.getEntitiesFromRay(eye, dir, { maxDistance: Math.max(0.1, d), ignoreBlockCollision: true, excludeFamilies: ["inanimate", "arsenal_fx", "projectile"], excludeTypes: ["minecraft:item", "minecraft:xp_orb"] })) ?? [];
  for (const h of hits) if (h.entity.id !== shooter.id && h.distance < d) d = h.distance;
  const to = sub(add(eye, mul(dir, Math.max(2, d))), from);
  const L = len(to);
  return L > 0.5 ? mul(to, 1 / L) : dir;
}

/**
 * 小型ミサイルの群れ：前方の近い敵に 1 発ずつ割り振る（足りなければ同じ敵へ）。敵がいなければまっすぐ
 * @param {import("@minecraft/server").Entity} shooter @param {import("../util/math.js").Vec3} muzzle @param {import("../util/math.js").Vec3} dir @param {any} st
 */
function fireSwarm(shooter, muzzle, dir, st) {
  const pr = st.projectile ?? {};
  const n = pr.count ?? 6;
  /** @type {string[]} */
  const targets = [];
  safe("swarm.seek", () => {
    const eye = shooter.getHeadLocation();
    const found = [];
    for (const e of shooter.dimension.getEntities({ location: eye, maxDistance: pr.seek ?? 32, excludeFamilies: ["inanimate", "arsenal_fx", "projectile"], excludeTypes: ["minecraft:item", "minecraft:xp_orb"] })) {
      if (e.id === shooter.id || !e.getComponent("minecraft:health") || !canDamage(shooter, e)) continue;
      const v = sub(e.getAABB().center, eye);
      const d = len(v);
      if (d < 1 || dot(mul(v, 1 / d), dir) < 0.5) continue;
      found.push({ id: e.id, d });
    }
    found.sort((a, b) => a.d - b.d);
    for (const f of found) targets.push(f.id);
  });
  const rocketSt = { ...st, projectile: { speed: pr.speed ?? 0.9, accel: pr.accel ?? 0.08, max: pr.max ?? 2.2, power: pr.power ?? 1.4, turn: pr.turn ?? 0.22 } };
  for (let i = 0; i < n; i++) {
    // 扇状に広がって出てから、それぞれの目標へ曲がる
    const a = ((i - (n - 1) / 2) / Math.max(1, n - 1)) * 0.9;
    const side = norm({ x: -dir.z, y: 0, z: dir.x });
    const d = norm(add(add(dir, mul(side, a)), { x: 0, y: 0.18 + 0.06 * (i % 2), z: 0 }));
    const tgt = targets.length ? targets[i % targets.length] : null;
    fireRocket(shooter, muzzle, d, rocketSt, tgt, { kind: "missile", maxAge: 90 });
  }
}

/** クラスター弾の炸裂 @param {Proj} p */
function clusterBurst(p) {
  const pr = p.data.st.projectile ?? {};
  p.data.t = { kind: "cluster", power: pr.power ?? 2.0, bomblets: pr.bomblets ?? 6, bombletPower: pr.bombletPower ?? 1.4 };
  p.data.tid = p.data.weaponId;
  detonate(p);
}

/** @param {Proj} p */
function tickSpec(p) {
  const d = p.data;
  if (d.gravity) p.vel = add(p.vel, { x: 0, y: -d.gravity, z: 0 });
  const h = sweep(p, p.pos, p.vel);
  if (h.kind === "void") return removeProj(p);
  if (p.age % 2 === 0 || d.mode === "singularity") {
    const v = new MolangVariableMap();
    v.setColorRGB("variable.color", /** @type {any} */ (SPEC_COLOR)[d.mode] ?? { red: 1, green: 1, blue: 1 });
    emit(p.dim, "arsenal:plasma_glow", p.pos, v, { range: 96, minQ: p.age % 4 === 0 ? 0 : 1 });
  }
  if (h.kind === "none") {
    p.traveled += len(p.vel);
    p.pos = add(p.pos, p.vel);
    syncVisual(p);
    return;
  }
  const src = owner(p.ownerId);
  const st = d.st;
  const dir = norm(p.vel);
  const ent = h.kind === "entity" ? h.entity : null;
  // 着弾点（ブロックなら面の少し手前、相手なら体の中心）
  const at = h.kind === "block" ? add(h.point, mul(h.normal, 0.5)) : ent ? ent.getAABB().center : h.point;
  /** 直撃のダメージ */
  const direct = () => (ent && src && st.dmg > 0 ? bulletHit(src, ent, h.point, dir, p.traveled, st, 1) : "pass");
  switch (d.mode) {
    case "disc": {
      if (ent) {
        direct();
        p.hitSet.add(ent.id);
        d.pierce--;
        if (d.pierce < 0) return removeProj(p);
        p.pos = add(h.point, mul(dir, 0.05));
        syncVisual(p);
        return;
      }
      if (h.kind !== "block" || d.bounces <= 0) {
        emit(p.dim, "arsenal:impact_spark", h.point, undefined, { range: 48 });
        return removeProj(p);
      }
      // 壁で跳ね返る（入った角度と同じ角度で出る）
      d.bounces--;
      p.pos = add(h.point, mul(h.normal, 0.08));
      p.vel = reflect(p.vel, h.normal);
      emit(p.dim, "arsenal:impact_spark", h.point, undefined, { range: 48 });
      playNear(p.dim, h.point, "arsenal.fx.ricochet", { range: 24, pitch: 1.3 });
      syncVisual(p);
      return;
    }
    case "singularity":
      direct();
      addSingularity(p.dim, at, p.ownerId, st);
      return removeProj(p);
    case "stasis":
      direct();
      addStasis(p.dim, at, p.ownerId, st);
      return removeProj(p);
    case "net":
      direct();
      castNet(p.dim, at, p.ownerId, st);
      return removeProj(p);
    case "empshot": {
      direct();
      const sp = st.spec ?? {};
      empHandler(p.dim, at, sp.radius ?? 4, (sp.secs ?? 8) * 20, p.ownerId);
      return removeProj(p);
    }
    case "tranq": {
      const r = direct();
      if (r === "hit" && ent && ent.isValid) tranquilize(ent, st);
      return removeProj(p);
    }
    case "harpoon": {
      const r = direct();
      if (r === "hit" && ent && ent.isValid && src) {
        const sp = st.spec ?? {};
        // 後ろに壁があれば縫い付け、なければ撃ち手の方へ引き寄せる
        const c = ent.getAABB().center;
        const reach = loadedReach(p.dim, c, dir, sp.wall ?? 3, system.currentTick);
        const wall = reach > 0 ? safe("harpoon.wall", () => p.dim.getBlockFromRay(c, dir, { maxDistance: reach, includePassableBlocks: false, includeLiquidBlocks: false })) : undefined;
        if (wall) pin(ent, sp.pin ?? 60);
        else {
          const to = norm(sub(src.location, ent.location));
          const k = sp.pull ?? 1.3;
          safe("harpoon.pull", () => ent.applyKnockback({ x: to.x * k, z: to.z * k }, 0.35));
        }
        playNear(p.dim, h.point, "arsenal.melee.hit_metal", { range: 24 });
      } else if (h.kind === "block") {
        emit(p.dim, "arsenal:impact_spark", h.point, undefined, { range: 48 });
      }
      return removeProj(p);
    }
    case "clustershell":
      p.pos = h.kind === "block" ? add(h.point, mul(h.normal, 0.3)) : h.point;
      return clusterBurst(p);
  }
  return removeProj(p);
}

// ---------------------------------------------------------------------------
//  2.6：ミサイル（弾道ミサイル・巡航ミサイル・誘導ミサイル）
// ---------------------------------------------------------------------------

/**
 * 弾道ミサイル：目標の真上の高いところから落ちてくる（核ミサイルの弾頭）
 * @param {import("@minecraft/server").Dimension} dim @param {import("../util/math.js").Vec3} target @param {string} ownerId
 * @param {{height?:number, ticks?:number, power?:number, nuke?:boolean, weaponId?:string}} [o]
 */
export function launchBallistic(dim, target, ownerId, o = {}) {
  const h = o.height ?? 120;
  const ticks = o.ticks ?? 60;
  // 真上から少し斜めに落とす（見上げたときに筋が見える）
  const from = { x: target.x + h * 0.15, y: Math.min(dim.heightRange.max - 2, target.y + h), z: target.z };
  const vel = mul(sub(target, from), 1 / ticks);
  return addProj({ type: "ballistic", kind: "missile", dim, pos: from, vel, ownerId, maxAge: ticks + 40, data: { power: o.power ?? 4, nuke: !!o.nuke, weaponId: o.weaponId ?? "missile", tid: o.weaponId } }, true);
}

/** @param {Proj} p */
function tickBallistic(p) {
  const h = sweep(p, p.pos, p.vel);
  // 読み込まれていない上空からでも落ちてくる（レイが撃てないときはそのまま進める）
  if (h.kind === "void") {
    p.pos = add(p.pos, p.vel);
    syncVisual(p);
    return;
  }
  if (h.kind !== "none") {
    p.pos = h.kind === "block" ? add(h.point, mul(h.normal, 0.5)) : h.point;
    return detonate(p);
  }
  p.pos = add(p.pos, p.vel);
  if (p.age % 2 === 0 && isLoaded(p.dim, p.pos, system.currentTick)) emit(p.dim, "arsenal:rocket_trail", p.pos, undefined, { range: 192 });
  if (p.age % 10 === 0) playNear(p.dim, p.pos, "arsenal.world.jet", { range: 160, pitch: 1.4, volume: 0.6 });
  syncVisual(p);
}

/**
 * 巡航ミサイル：上昇し、目標の上空まで巡航高度で飛び、目標の手前で急降下する
 * @param {import("@minecraft/server").Entity} shooter @param {import("../util/math.js").Vec3} muzzle @param {import("../util/math.js").Vec3} dir @param {any} st
 */
export function fireCruise(shooter, muzzle, dir, st) {
  const pr = st.projectile ?? {};
  const from = launchPoint(shooter, muzzle);
  // 目標：目の視線が当たる点（なければ射程の端）
  const eye = shooter.getHeadLocation();
  const reach = loadedReach(shooter.dimension, eye, dir, st.range1, system.currentTick);
  const bh = reach > 1 ? safe("cruise.aim", () => shooter.dimension.getBlockFromRay(eye, dir, { maxDistance: reach, includeLiquidBlocks: true, includePassableBlocks: false })) : undefined;
  const target = bh ? hitPoint(bh) : add(eye, mul(dir, Math.max(8, reach)));
  const cruiseY = Math.max(from.y, target.y) + (pr.alt ?? 22);
  const up = norm({ x: dir.x * 0.3, y: 1, z: dir.z * 0.3 });
  addProj({
    type: "cruise", kind: "missile", dim: shooter.dimension, pos: from, vel: mul(up, pr.speed ?? 0.8), ownerId: shooter.id,
    maxAge: Math.ceil((st.range1 * 1.6) / (pr.max ?? 2.4)) + 80,
    data: { st, target, cruiseY, phase: 0, accel: pr.accel ?? 0.06, max: pr.max ?? 2.4, power: pr.power ?? 4.8, weaponId: st.id },
  }, true);
  emit(shooter.dimension, "arsenal:target_marker", add(target, { x: 0, y: 0.2, z: 0 }), undefined, { range: 96 });
}

/** @param {Proj} p */
function tickCruise(p) {
  const d = p.data;
  const sp = Math.min(d.max, len(p.vel) + d.accel);
  let dir = norm(p.vel);
  const hd = Math.hypot(d.target.x - p.pos.x, d.target.z - p.pos.z);
  // 0：上昇（巡航高度へ）／1：巡航（高度を保って目標の上空へ）／2：急降下
  if (d.phase === 0 && p.pos.y >= d.cruiseY - 1) d.phase = 1;
  if (d.phase < 2 && hd < Math.max(6, (p.pos.y - d.target.y) * 0.9)) d.phase = 2;
  const aim = d.phase === 2 ? d.target : { x: d.target.x, y: d.cruiseY, z: d.target.z };
  const want = norm(sub(aim, p.pos));
  const turn = d.phase === 2 ? 0.35 : d.phase === 1 ? 0.12 : 0.08;
  dir = norm(add(mul(dir, 1 - turn), mul(want, turn)));
  p.vel = mul(dir, sp);
  const h = sweep(p, p.pos, p.vel);
  if (h.kind === "void") return removeProj(p);
  if (h.kind !== "none") {
    if (h.kind === "entity") rocketDirectHit(p, h.entity);
    p.pos = add(h.point, mul(dir, -0.3));
    return detonate(p);
  }
  p.pos = add(p.pos, p.vel);
  emit(p.dim, "arsenal:rocket_trail", add(p.pos, mul(dir, -0.4)), undefined, { range: 128 });
  if (p.age % 10 === 0) emit(p.dim, "arsenal:target_marker", add(d.target, { x: 0, y: 0.2, z: 0 }), undefined, { range: 96, minQ: 1 });
  syncVisual(p);
}

/** 誘導ミサイルを操縦しているプレイヤー → 弾の ID @type {Map<string, number>} */
const guidedBy = new Map();

/**
 * 誘導ミサイル（キルストリーク）：上空から落ちるミサイルを、プレイヤーが向いた方へ曲げて操縦する
 * @param {Player} player @param {{height:number, power:number, seconds:number}} d
 */
export function launchGuided(player, d) {
  if (guidedBy.has(player.id)) return false;
  const view = player.getViewDirection();
  const flat = norm({ x: view.x, y: 0, z: view.z });
  const from = add(player.location, { x: -flat.x * 20, y: d.height, z: -flat.z * 20 });
  if (!isLoaded(player.dimension, from, system.currentTick)) return false;
  const dir = norm({ x: flat.x, y: -0.7, z: flat.z });
  // st は直撃のダメージ（rocketDirectHit が読む）
  const st = { id: "ks_missile_strike", dmg: 16, armorBonus: 1.5, cat: "launcher" };
  const p = addProj({ type: "guided", kind: "missile", dim: player.dimension, pos: from, vel: mul(dir, 1.0), ownerId: player.id, maxAge: d.seconds * 20, data: { st, power: d.power, weaponId: st.id } }, true);
  guidedBy.set(player.id, p.id);
  safe("guided.guard", () => {
    player.addEffect("resistance", d.seconds * 20 + 20, { amplifier: 3, showParticles: false });
    player.addEffect("slowness", d.seconds * 20 + 20, { amplifier: 5, showParticles: false });
  });
  safe("guided.cam", () => player.camera.setCamera("minecraft:free", { location: add(from, mul(dir, -3)), rotation: player.getRotation() }));
  return true;
}

/** 操縦中か @param {string} playerId */
export function isGuiding(playerId) {
  return guidedBy.has(playerId);
}

/** @param {Proj} p @param {boolean} boom */
function guidedEnd(p, boom) {
  guidedBy.delete(p.ownerId);
  const pl = owner(p.ownerId);
  if (pl instanceof Player) {
    safe("guided.clear", () => pl.camera.clear());
    safe("guided.fx", () => {
      pl.removeEffect("slowness");
      pl.removeEffect("resistance");
    });
  }
  if (boom) detonate(p);
  else removeProj(p);
}

/** @param {Proj} p */
function tickGuided(p) {
  const pl = owner(p.ownerId);
  if (!(pl instanceof Player)) return guidedEnd(p, true);
  // スニークで空中爆発
  if (pl.isSneaking && p.age > 10) return guidedEnd(p, true);
  const sp = Math.min(3.2, len(p.vel) + 0.06);
  const want = pl.getViewDirection();
  let dir = norm(p.vel);
  dir = norm(add(mul(dir, 0.8), mul(want, 0.2)));
  p.vel = mul(dir, sp);
  const h = sweep(p, p.pos, p.vel);
  if (h.kind === "void") {
    p.pos = add(p.pos, p.vel);
  } else if (h.kind !== "none") {
    if (h.kind === "entity") rocketDirectHit(p, h.entity);
    p.pos = add(h.point, mul(dir, -0.3));
    return guidedEnd(p, true);
  } else {
    p.pos = add(p.pos, p.vel);
  }
  if (isLoaded(p.dim, p.pos, system.currentTick)) emit(p.dim, "arsenal:rocket_trail", add(p.pos, mul(dir, -0.4)), undefined, { range: 160 });
  // カメラは弾の少し後ろから、プレイヤーの向きで見る
  safe("guided.cam2", () => pl.camera.setCamera("minecraft:free", { location: add(p.pos, mul(dir, -3)), rotation: pl.getRotation(), easeOptions: { easeTime: 0.05 } }));
  syncVisual(p);
}

// ---------------------------------------------------------------------------
//  2.0：投げナイフ・近接武器の投擲・スプリングナイフの刃
// ---------------------------------------------------------------------------

/**
 * 近接武器を投げる（刺さった場所・当たった相手の足元に武器が落ちる）／刃を射出する
 * @param {Player} thrower @param {string} id @param {ItemStack|null} item 投げる武器（刃の射出は null） @param {number} dmg
 */
export function throwBlade(thrower, id, item, dmg) {
  const eye = thrower.getHeadLocation();
  const dir = thrower.getViewDirection();
  const start = launchPoint(thrower, add(eye, mul(dir, 0.6)));
  addProj({ type: "knife", kind: item ? "knife" : "blade", dim: thrower.dimension, pos: start, vel: mul(dir, item ? 2.2 : 2.8), ownerId: thrower.id, maxAge: 80, data: { item, dmg, id, head: 2.5, gravity: item ? 0.025 : 0.01 } }, true);
  playNear(thrower.dimension, thrower.location, "arsenal.melee.throw", { range: 16 });
}

/** @param {Proj} p */
function tickKnife(p) {
  if (p.stuck) {
    if (p.age > p.data.stuckUntil) {
      dropKnife(p, p.pos);
      removeProj(p);
    }
    return;
  }
  p.vel = add(p.vel, { x: 0, y: -p.data.gravity, z: 0 });
  const h = sweep(p, p.pos, p.vel);
  if (h.kind === "void") {
    dropKnife(p, p.pos);
    return removeProj(p);
  }
  if (h.kind === "entity") {
    const src = owner(p.ownerId);
    if (src) {
      const head = hitZone(h.entity, h.point) === "head";
      meleeDamage(src, h.entity, p.data.dmg * (head ? p.data.head : 1), p.data.id, { head });
    }
    playNear(p.dim, h.point, "arsenal.melee.hit", { range: 16 });
    dropKnife(p, h.entity.location);
    return removeProj(p);
  }
  if (h.kind === "block") {
    p.pos = add(h.point, mul(h.normal, 0.05));
    p.stuck = { entityId: null, offset: null };
    p.data.stuckUntil = p.age + 30;
    p.vel = mul(norm(p.vel), 0.01);
    playNear(p.dim, p.pos, "arsenal.melee.hit_metal", { range: 12, volume: 0.5 });
    syncVisual(p);
    return;
  }
  p.traveled += len(p.vel);
  p.pos = add(p.pos, p.vel);
  syncVisual(p);
}

/** @param {Proj} p @param {import("../util/math.js").Vec3} at */
function dropKnife(p, at) {
  if (!p.data.item || p.data.dropped) return;
  p.data.dropped = true;
  const it = p.data.item;
  safe("knife.drop", () => {
    if (isLoaded(p.dim, at, system.currentTick)) p.dim.spawnItem(it, at);
  });
}

/**
 * 敵の投擲（目標の地点へ届く放物線を計算して投げる）
 * @param {import("@minecraft/server").Entity} thrower @param {string} tid @param {import("../util/math.js").Vec3} target
 */
export function throwAt(thrower, tid, target) {
  const t = /** @type {any} */ (DATA.THROWABLES)[tid];
  if (!t) return;
  const from = thrower.getHeadLocation();
  const hd = Math.hypot(target.x - from.x, target.z - from.z);
  const T = Math.max(10, Math.min(40, hd * 1.4));
  const g = 0.05;
  const vel = { x: (target.x - from.x) / T, y: (target.y - from.y + 0.5 * g * T * T) / T, z: (target.z - from.z) / T };
  addProj({ type: "throw", kind: t.kind === "frag" ? "frag" : t.kind, dim: thrower.dimension, pos: from, vel, ownerId: thrower.id, maxAge: 400, fuse: t.fuse ?? -1, data: { t, tid } }, true);
}

/**
 * 動く光源（照明弾）：光源ブロックを弾の位置へ付け替える
 * @param {Proj} p @param {number} level
 */
function moveLight(p, level) {
  if (!WS().flashlightBlocks) return;
  const bp = { x: Math.floor(p.pos.x), y: Math.floor(p.pos.y), z: Math.floor(p.pos.z) };
  const cur = p.data.lightAt;
  if (cur && cur.x === bp.x && cur.y === bp.y && cur.z === bp.z) return;
  clearMovingLight(p);
  safe("flare.light", () => {
    if (!isLoaded(p.dim, bp, system.currentTick)) return;
    const b = p.dim.getBlock(bp);
    if (!b || !b.isAir) return;
    b.setType(`minecraft:light_block_${level}`);
    p.data.lightAt = bp;
    p.data.lightId = `minecraft:light_block_${level}`;
    movingLights.set(`${p.dim.id}:${bp.x},${bp.y},${bp.z}`, { dim: p.dim, pos: bp, id: p.data.lightId, until: system.currentTick + 400 });
  });
}

/** @param {Proj} p */
function clearMovingLight(p) {
  const at = p.data.lightAt;
  if (!at) return;
  p.data.lightAt = null;
  movingLights.delete(`${p.dim.id}:${at.x},${at.y},${at.z}`);
  safe("flare.unlight", () => {
    if (!isLoaded(p.dim, at, system.currentTick)) return;
    const b = p.dim.getBlock(at);
    if (b && b.typeId === p.data.lightId) b.setType("minecraft:air");
  });
}

/** @param {Proj} p */
function tickFlare(p) {
  if (p.stuck) {
    // 燃えている間は明るく光り、火の粉を上げる
    moveLight(p, 15);
    if (p.age % 2 === 0) emit(p.dim, "arsenal:flare_glow", p.pos, undefined, { range: 128 });
    if (p.age % 6 === 0) emit(p.dim, "arsenal:flare_halo", p.pos, undefined, { range: 160 });
    if (p.age % 10 === 0) emit(p.dim, "arsenal:flare_smoke", p.pos, undefined, { range: 96, minQ: 1 });
    if (p.age > p.data.stuckUntil) removeProj(p);
    return;
  }
  p.vel = add(mul(p.vel, 0.99), { x: 0, y: -p.data.gravity, z: 0 });
  const h = sweep(p, p.pos, p.vel);
  if (h.kind === "void") return removeProj(p);
  emit(p.dim, "arsenal:flare_glow", p.pos, undefined, { range: 160 });
  emit(p.dim, "arsenal:flare_trail", p.pos, undefined, { range: 160 });
  if (p.age % 3 === 0) emit(p.dim, "arsenal:flare_halo", p.pos, undefined, { range: 160 });
  if (h.kind !== "none") {
    p.pos = h.point;
    if (h.kind === "entity") {
      const src = owner(p.ownerId);
      if (src && canDamage(src, h.entity)) {
        dealDamage(src, h.entity, p.data.st.dmg, { fire: p.data.fire, weaponId: p.data.st.id });
        hitFeedback(src, "hit", p.data.st.dmg);
      }
    }
    p.pos = h.kind === "block" ? add(h.point, mul(h.normal, 0.3)) : h.point;
    p.stuck = { entityId: null, offset: null };
    p.data.stuckUntil = p.age + Math.min(400, p.data.light);
    p.vel = { x: 0, y: 0, z: 0 };
    playNear(p.dim, p.pos, "arsenal.fx.fire", { range: 16, volume: 0.5, pitch: 1.4 });
    moveLight(p, 15);
  } else {
    p.pos = add(p.pos, p.vel);
    moveLight(p, 14);
  }
  syncVisual(p);
}

/** @param {Proj} p */
function tickHook(p) {
  const pl = owner(p.ownerId);
  if (!(pl instanceof Player)) return removeProj(p);
  const hand = add(pl.getHeadLocation(), { x: 0, y: -0.4, z: 0 });
  // ロープ
  const L = dist(hand, p.pos);
  const n = Math.min(24, Math.floor(L * 1.5));
  for (let i = 1; i < n; i++) {
    const pt = add(hand, mul(sub(p.pos, hand), i / n));
    emit(p.dim, "arsenal:rope", pt, undefined, { range: 48, minQ: 1 });
  }
  if (p.data.attached) {
    p.data.pullTicks++;
    const to = sub(p.pos, pl.location);
    const d = len(to);
    if (d < 1.8 || p.data.pullTicks > 50 || pl.isSneaking) {
      safe("hook.release", () => pl.addEffect("slow_falling", 30, { amplifier: 0, showParticles: false }));
      return removeProj(p);
    }
    const n2 = norm(to);
    const k = clamp(d * 0.12, 0.55, 1.4);
    safe("hook.pull", () => pl.applyKnockback({ x: n2.x * k, z: n2.z * k }, clamp(n2.y * k + 0.08, -0.4, 1.0)));
    return;
  }
  const h = sweep(p, p.pos, p.vel);
  if (h.kind === "void") return removeProj(p);
  if (h.kind === "block") {
    p.pos = h.point;
    p.data.attached = true;
    p.vel = { x: 0, y: 0, z: 0 };
    playNear(p.dim, p.pos, "arsenal.fx.bounce", { range: 16, pitch: 1.5 });
    syncVisual(p);
    return;
  }
  if (h.kind === "entity") {
    const e = h.entity;
    const src = pl;
    if (canDamage(src, e)) {
      const to = norm(sub(pl.location, e.location));
      safe("hook.yank", () => e.applyKnockback({ x: to.x * 2.2, z: to.z * 2.2 }, 0.5));
      dealDamage(src, e, 1, { weaponId: "grapple" });
      hitFeedback(src, "hit", 1);
    }
    return removeProj(p);
  }
  p.pos = add(p.pos, p.vel);
  p.traveled += len(p.vel);
  if (p.traveled > p.data.range) return removeProj(p);
  syncVisual(p);
}

/** @param {import("../util/math.js").Vec3} v @param {import("../util/math.js").Vec3} n */
function reflect(v, n) {
  const d = dot(v, n);
  return sub(v, mul(n, 2 * d));
}

/** @param {Proj} p @param {number} now */
function tickThrow(p, now) {
  const t = p.data.t;
  if (t.kind === "knife") {
    // 投げナイフ：まっすぐ飛び、当たれば大ダメージ。刺さったら拾える
    if (!p.data.item) {
      p.data.item = new ItemStack("arsenal:throwing_knife", 1);
      p.data.dmg = t.dmg;
      p.data.id = p.data.tid;
      p.data.head = t.head ?? 2.5;
      p.data.gravity = 0.02;
      p.type = "knife";
    }
    return tickKnife(p);
  }
  if (t.kind === "nuke") nukeCountdown(p);
  if (p.fuse > 0) {
    p.fuse--;
    if (t.kind === "c4" || t.kind === "sticky") {
      if (p.age % 10 === 0) emit(p.dim, "arsenal:blink", add(p.pos, { x: 0, y: 0.2, z: 0 }), undefined, { range: 32 });
    }
    if (p.fuse === 0) return detonate(p);
  } else if (t.kind === "c4" && p.age % 20 === 0) {
    emit(p.dim, "arsenal:blink", add(p.pos, { x: 0, y: 0.15, z: 0 }), undefined, { range: 24 });
    if (p.age % 60 === 0) playNear(p.dim, p.pos, "arsenal.fx.c4_beep", { range: 10, volume: 0.4 });
  }
  if (p.stuck) {
    if (p.stuck.entityId) {
      const e = world.getEntity(p.stuck.entityId);
      if (e && e.isValid && p.stuck.offset) {
        p.pos = add(e.location, p.stuck.offset);
        syncVisual(p);
      } else {
        p.stuck = { entityId: null, offset: null };
      }
    }
    return;
  }
  p.vel = add(mul(p.vel, 0.985), { x: 0, y: -0.05, z: 0 });
  const h = sweep(p, p.pos, p.vel);
  if (h.kind === "void") {
    p.vel = { x: 0, y: 0, z: 0 };
    return;
  }
  if (h.kind !== "none") {
    if (t.kind === "impact" || t.kind === "molotov") {
      p.pos = h.kind === "block" ? add(h.point, mul(h.normal, 0.2)) : h.point;
      return detonate(p);
    }
    if (t.kind === "sticky" || t.kind === "c4") {
      if (h.kind === "entity") {
        const pt = outsideBox(h.entity, h.point);
        p.stuck = { entityId: h.entity.id, offset: sub(pt, h.entity.location) };
        p.pos = pt;
      } else {
        p.stuck = { entityId: null, offset: null };
        p.pos = add(h.point, mul(h.normal, 0.08));
      }
      p.vel = { x: 0, y: 0, z: 0 };
      playNear(p.dim, p.pos, "arsenal.fx.bounce", { range: 12, pitch: 0.7 });
      if (t.kind === "c4") p.fuse = -1;
      syncVisual(p);
      return;
    }
    // 跳ね返り
    if (h.kind === "block") {
      p.pos = add(h.point, mul(h.normal, 0.12));
      p.vel = reflect(p.vel, h.normal);
      const nrm = h.normal;
      const vn = mul(nrm, dot(p.vel, nrm));
      const vt = sub(p.vel, vn);
      p.vel = add(mul(vn, 0.35), mul(vt, 0.7));
      if (len(p.vel) > 0.12) playNear(p.dim, p.pos, "arsenal.fx.bounce", { range: 16, volume: clamp(len(p.vel), 0.2, 1) });
      if (len(p.vel) < 0.06) p.vel = { x: 0, y: 0, z: 0 };
    } else {
      p.hitSet.add(h.entity.id);
      p.vel = mul(p.vel, -0.25);
    }
  } else {
    p.pos = add(p.pos, p.vel);
  }
  if (t.kind === "molotov" && p.age % 2 === 0) emit(p.dim, "arsenal:flare_glow", p.pos, undefined, { range: 48, minQ: 1 });
  syncVisual(p);
}

/** @param {Proj} p @param {number} now */
function tickMine(p, now) {
  if (now < p.data.armAt || p.age % 4 !== 0) return;
  if (p.age % 40 === 0) emit(p.dim, "arsenal:blink", add(p.pos, { x: 0, y: 0.15, z: 0 }), undefined, { range: 12 });
  const src = owner(p.ownerId);
  safe("mine.scan", () => {
    for (const e of p.dim.getEntities({ location: p.pos, maxDistance: p.data.t.triggerRadius, excludeFamilies: ["inanimate", "arsenal_fx", "projectile", "arsenal_target"] })) {
      if (e.id === p.ownerId) continue;
      if (!e.getComponent("minecraft:health")) continue;
      if (src && !canDamage(src, e)) continue;
      playNear(p.dim, p.pos, "arsenal.fx.mine_arm", { range: 16, pitch: 1.6 });
      system.runTimeout(() => safe("mine.boom", () => { if (!p.dead) detonate(p); }), 5);
      p.data.armAt = now + 999999;
      return;
    }
  });
}

/** 範囲効果（煙・炎） */
function tickZones() {
  const now = system.currentTick;
  for (let i = zones.length - 1; i >= 0; i--) {
    const z = zones[i];
    if (now > z.until) {
      zones.splice(i, 1);
      continue;
    }
    if (now % 10 !== 0) continue;
    safe("zones", () => {
      if (z.kind === "fire") {
        const src = owner(z.ownerId);
        for (const e of z.dim.getEntities({ location: z.pos, maxDistance: z.radius, excludeFamilies: ["inanimate", "arsenal_fx"] })) {
          if (src && !canDamage(src, e) && e.id !== z.ownerId) continue;
          e.setOnFire(3, true);
        }
      } else if (z.kind === "smoke") {
        // 煙の中の敵対モブは標的を見失う（盲目）
        for (const e of z.dim.getEntities({ location: z.pos, maxDistance: z.radius, excludeFamilies: ["inanimate", "arsenal_fx", "player"] })) {
          e.addEffect("blindness", 30, { amplifier: 0, showParticles: false });
        }
      } else if (z.kind === "gas") {
        // 毒ガス：ガスマスクと機械には効かない
        const src = owner(z.ownerId);
        for (const e of z.dim.getEntities({ location: z.pos, maxDistance: z.radius, excludeFamilies: ["inanimate", "arsenal_fx", "arsenal_robot"] })) {
          if (isGasImmune(e) || !e.getComponent("minecraft:health")) continue;
          if (src && e.id !== z.ownerId && !canDamage(src, e)) continue;
          e.addEffect("poison", 40, { amplifier: 1, showParticles: false });
          e.addEffect("nausea", 80, { amplifier: 0, showParticles: false });
        }
      } else if (z.kind === "decoy") {
        if (now % 20 < 10) {
          const set = ["rifle", "smg", "pistol", "battle"][Math.floor(Math.random() * 4)];
          playNear(z.dim, z.pos, `arsenal.fire.${set}`, { range: 64, pitch: rand(0.9, 1.1) });
        }
      } else if (z.kind === "snap") {
        // 周囲の敵をあぶり出す：投げた本人と味方に印を見せる
        const src = owner(z.ownerId);
        const viewers = z.dim.getPlayers({ location: z.pos, maxDistance: 96 }).filter((pl) => !src || pl.id === src.id || (src instanceof Player && !canDamage(src, pl)));
        for (const e of z.dim.getEntities({ location: z.pos, maxDistance: z.radius, excludeFamilies: ["inanimate", "arsenal_fx"] })) {
          if (!e.getComponent("minecraft:health") || (src && (e.id === src.id || !canDamage(src, e)))) continue;
          const at = e.getAABB().center;
          for (const pl of viewers) safe("snap.mark", () => pl.spawnParticle("arsenal:lock_marker", { x: at.x, y: at.y + 1.2, z: at.z }));
        }
      }
    });
  }
  if (now % 40 === 0) {
    for (const [k, l] of movingLights) {
      if (now < l.until) continue;
      movingLights.delete(k);
      safe("light.expire", () => {
        if (!isLoaded(l.dim, l.pos, now)) return;
        const b = l.dim.getBlock(l.pos);
        if (b && b.typeId === l.id) b.setType("minecraft:air");
      });
    }
  }
  for (let i = lights.length - 1; i >= 0; i--) {
    const l = lights[i];
    if (now < l.until) continue;
    lights.splice(i, 1);
    safe("light.remove", () => {
      if (!isLoaded(l.dim, l.pos, now)) return;
      const b = l.dim.getBlock(l.pos);
      if (b && b.typeId === "minecraft:light_block_14") b.setType("minecraft:air");
    });
  }
}

/** 毎 tick */
export function tickProjectiles() {
  const now = system.currentTick;
  if (now % 200 === 0) {
    // 風は目標値へゆっくり近づき、目標値はときどき変わる
    if (Math.random() < 0.35) {
      const a = Math.random() * Math.PI * 2;
      const m = Math.random() * 0.0035;
      wind.tx = Math.cos(a) * m;
      wind.tz = Math.sin(a) * m;
    }
  }
  wind.x += (wind.tx - wind.x) * 0.002;
  wind.z += (wind.tz - wind.z) * 0.002;
  if (needles.size > 64) for (const [k, v] of needles) if (now - v.tick > 100) needles.delete(k);
  for (let i = decoys.length - 1; i >= 0; i--) if (decoys[i].until <= now) decoys.splice(i, 1);
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    if (p.dead) continue;
    safe(`proj.${p.type}`, () => tickOne(p));
  }
  for (let i = list.length - 1; i >= 0; i--) if (list[i].dead) list.splice(i, 1);
  tickZones();
}

/** 追跡していない見た目エンティティ（再読み込み後の残骸）を掃除 */
export function sweepOrphans() {
  const tracked = new Set(list.filter((p) => p.ent).map((p) => /** @type {any} */ (p.ent).id));
  for (const dimId of ["overworld", "nether", "the_end"]) {
    safe("orphans", () => {
      const dim = world.getDimension(dimId);
      for (const e of dim.getEntities({ type: ENTITY.projectile })) {
        if (!tracked.has(e.id)) e.remove();
      }
    });
  }
}

/**
 * 投擲の軌道予測（スニーク中・握っている間）。投擲物と同じ式で 1 tick ずつ進め、
 * 道筋を太めの点で描き、着地点に印と、爆発物なら被害の範囲の輪を出す
 * @param {Player} player @param {string} tid
 */
export function previewTrajectory(player, tid) {
  const t = /** @type {any} */ (DATA.THROWABLES)[tid];
  if (!t || t.kind === "mine" || t.kind === "nuke") return;
  const eye = player.getHeadLocation();
  const dir = player.getViewDirection();
  const aim = norm(add(dir, { x: 0, y: 0.12, z: 0 }));
  let vel = add(mul(aim, t.speed), mul(player.getVelocity(), 0.6));
  let pos = add(eye, mul(dir, 0.5));
  const dim = player.dimension;
  const knife = t.kind === "knife";
  safe("traj", () => {
    for (let i = 0; i < 80; i++) {
      vel = knife ? add(vel, { x: 0, y: -0.02, z: 0 }) : add(mul(vel, 0.985), { x: 0, y: -0.05, z: 0 });
      const L = len(vel);
      // 読み込まれていない先はレイを撃てない（例外になり、線が途中で切れていた）。そこで線を終える
      if (loadedReach(dim, pos, mul(vel, 1 / L), L, system.currentTick) < L) return;
      const bh = dim.getBlockFromRay(pos, mul(vel, 1 / L), { maxDistance: L, includePassableBlocks: false, includeLiquidBlocks: false });
      if (bh) {
        const nrm = faceNormal(bh.face);
        const pt = add(hitPoint(bh), mul(nrm, 0.05));
        const v = new MolangVariableMap();
        v.setFloat("variable.locked", 0.2);
        player.spawnParticle("arsenal:lock_marker", pt, v);
        const r = t.power ? t.power * 2 : t.radius && t.radius <= 6 ? t.radius : 0;
        if (r > 0 && nrm.y > 0.5) previewRing(player, pt, r);
        return;
      }
      pos = add(pos, vel);
      // 手前ほど薄く、先ほど濃く（自分の視界をふさがない）
      if (i >= 2) {
        const v = new MolangVariableMap();
        v.setFloat("variable.alpha", Math.min(1, 0.35 + i * 0.05));
        player.spawnParticle("arsenal:trajectory", pos, v);
      }
    }
  });
}

/** 着地点の被害範囲の輪 @param {Player} player @param {import("../util/math.js").Vec3} c @param {number} r */
function previewRing(player, c, r) {
  const n = Math.max(12, Math.min(32, Math.round(r * 5)));
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    const v = new MolangVariableMap();
    v.setFloat("variable.alpha", 0.55);
    player.spawnParticle("arsenal:trajectory", { x: c.x + Math.cos(a) * r, y: c.y + 0.05, z: c.z + Math.sin(a) * r }, v);
  }
}

