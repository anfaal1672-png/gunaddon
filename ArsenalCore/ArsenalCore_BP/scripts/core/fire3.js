// @ts-check
/**
 * 2.5 で増えた射撃方式（弾を飛ばさないもの）
 *   reflect（壁で反射するレーザー。反射するたびに威力が上がる）
 *   prism（扇状に何本もレーザーを放つ）
 *   smart（覗いている間に視界の敵を自動でロックし、撃つとロックした敵へ順に当たる）
 *   blink（撃った先へ瞬間移動。壁は抜けない）
 *   heal（照射した味方を回復し、自分の設置物・乗り物を直す。敵には弱い熱線）
 *   acid（円錐の酸：毒と腐食）
 *   orbital（照準の先に、少し遅れて空から光の柱。空が見えない場所には呼べない）
 * 実体弾の方式（disc・singularity・swarm など）は systems/projectiles.js の fireSpecial。
 */
import { MolangVariableMap, Player, system, world } from "@minecraft/server";
import { traceHitscan } from "./ballistics.js";
import { canDamage, dealDamage, hitFeedback, bulletHit, corrode } from "./damage.js";
import { entitiesInCone } from "./fire2.js";
import { addOrbital } from "../systems/fields.js";
import { isSolidBlock } from "../systems/pathfind.js";
import { emit, playNear, playTo } from "../fx/effects.js";
import { add, sub, mul, norm, dist, dot, len, loadedReach, faceNormal } from "../util/math.js";
import { W as WS } from "./settings.js";
import { safe } from "../util/log.js";

const EXCLUDE = ["inanimate", "arsenal_fx", "projectile"];
const EXCLUDE_T = ["minecraft:item", "minecraft:xp_orb"];

/**
 * 光線を描く
 * @param {import("@minecraft/server").Dimension} dim @param {import("../util/math.js").Vec3} a @param {import("../util/math.js").Vec3} b @param {{red:number, green:number, blue:number}} color
 */
function beamLine(dim, a, b, color) {
  const v = new MolangVariableMap();
  const L = dist(a, b);
  if (L < 0.05) return;
  const dn = norm(sub(b, a));
  v.setSpeedAndDirection("variable.tracer", 0.01, dn);
  v.setColorRGB("variable.color", color);
  const step = L > 20 ? 1.0 : 0.6;
  for (let i = 0; i < L; i += step) emit(dim, "arsenal:rail_beam", add(a, mul(dn, i)), v, { range: 96, minQ: i % (step * 2) < step ? 0 : 1 });
}

/** @param {import("../util/math.js").Vec3} v @param {import("../util/math.js").Vec3} n */
function reflect(v, n) {
  return sub(v, mul(n, 2 * dot(v, n)));
}

/**
 * 反射レーザー
 * @param {import("@minecraft/server").Entity} shooter @param {import("../util/math.js").Vec3} eye @param {import("../util/math.js").Vec3} dir @param {any} st @param {import("../util/math.js").Vec3} muzzle
 * @returns {number} 反射した回数
 */
export function fireReflect(shooter, eye, dir, st, muzzle) {
  const sp = st.spec ?? {};
  const dim = shooter.dimension;
  const color = { red: 1.0, green: 0.35, blue: 0.35 };
  const hitSet = new Set([shooter.id]);
  let pos = eye;
  let d = dir;
  let left = st.range1;
  let mulDmg = 1;
  let drawFrom = muzzle;
  let bounces = 0;
  for (let seg = 0; seg <= (sp.bounces ?? 3) && left > 0.5; seg++) {
    const reach = loadedReach(dim, pos, d, left, system.currentTick);
    if (reach <= 0.05) break;
    const bh = safe("reflect.ray", () => dim.getBlockFromRay(pos, d, { maxDistance: reach, includePassableBlocks: false, includeLiquidBlocks: false }));
    const wallAt = bh ? add(bh.block.location, bh.faceLocation) : null;
    const segLen = wallAt ? Math.max(0.05, dist(pos, wallAt) - 0.02) : reach;
    const r = traceHitscan(shooter, pos, d, st, { maxRange: segLen, pen: st.pen, hitSet, mulDmg, silent: seg > 0, noImpact: true });
    beamLine(dim, drawFrom, r.end, color);
    if (r.stopped && r.hitEntity) return bounces;
    if (!bh || !wallAt) return bounces;
    // 壁で反射する
    const n = faceNormal(bh.face);
    emit(dim, "arsenal:impact_spark", wallAt, undefined, { range: 48 });
    left -= dist(pos, wallAt);
    d = norm(reflect(d, n));
    pos = add(wallAt, mul(n, 0.05));
    drawFrom = pos;
    mulDmg *= 1 + (sp.gain ?? 0.25);
    bounces++;
    if (seg === 0) playNear(dim, wallAt, "arsenal.fx.ricochet", { range: 24, pitch: 1.6 });
  }
  return bounces;
}

/**
 * 扇状のレーザー（水平に広がる）
 * @param {import("@minecraft/server").Entity} shooter @param {import("../util/math.js").Vec3} eye @param {import("../util/math.js").Vec3} dir @param {any} st @param {import("../util/math.js").Vec3} muzzle
 */
export function firePrism(shooter, eye, dir, st, muzzle) {
  const sp = st.spec ?? {};
  const n = sp.rays ?? 7;
  const fan = ((sp.fan ?? 12) * Math.PI) / 180;
  const side = norm({ x: -dir.z, y: 0, z: dir.x });
  for (let i = 0; i < n; i++) {
    const a = (i - (n - 1) / 2) * (fan / Math.max(1, (n - 1) / 2)) * 0.5;
    const d = norm(add(mul(dir, Math.cos(a)), mul(side, Math.sin(a))));
    // 1 本ずつ当たる（同じ相手に複数本当たる。hitSet は貫通の判定だけに使う）
    const r = traceHitscan(shooter, eye, d, st, { pen: 0, silent: i > 0, hitSet: new Set([shooter.id]) });
    beamLine(shooter.dimension, muzzle, r.end, { red: 1.0, green: 0.5, blue: 1.0 });
  }
}

// ---------------------------------------------------------------------------
//  スマートピストル
// ---------------------------------------------------------------------------

/** プレイヤーごとのロック（相手の ID → ロックが進んだ tick 数） @type {Map<string, Map<string, number>>} */
const smartLocks = new Map();
/** 次に撃つロックの番 @type {Map<string, number>} */
const smartTurn = new Map();

/**
 * 覗いている間：視界の円錐の中の見えている敵を近い順に最大 maxLocks 体ロックしていく
 * @param {Player} player @param {any} st
 */
export function tickSmart(player, st) {
  const sp = st.spec ?? {};
  const max = sp.maxLocks ?? 3;
  const need = sp.lockTicks ?? 8;
  const cosHalf = Math.cos(((sp.cone ?? 28) * Math.PI) / 180);
  const eye = player.getHeadLocation();
  const dir = player.getViewDirection();
  let locks = smartLocks.get(player.id);
  if (!locks) smartLocks.set(player.id, (locks = new Map()));
  const seen = entitiesInCone(player, eye, dir, st.range1, cosHalf)
    .filter((h) => h.e.getComponent("minecraft:health") && canDamage(player, h.e) && h.e.id !== player.id)
    .sort((a, b) => dot(norm(sub(b.p, eye)), dir) - dot(norm(sub(a.p, eye)), dir))
    .slice(0, max);
  const ids = new Set(seen.map((h) => h.e.id));
  for (const id of [...locks.keys()]) if (!ids.has(id)) locks.delete(id);
  for (const h of seen) {
    const t = Math.min(need, (locks.get(h.e.id) ?? 0) + 1);
    locks.set(h.e.id, t);
    const v = new MolangVariableMap();
    v.setFloat("variable.locked", t >= need ? 0.2 : 0.8);
    safe("smart.mark", () => player.spawnParticle("arsenal:lock_marker", h.p, v));
    if (t === need) playTo(player, "arsenal.fx.lock_on", { volume: 0.5, pitch: 1.4 });
  }
}

/** 覗くのをやめた・持ち替えた @param {string} playerId */
export function clearSmart(playerId) {
  smartLocks.delete(playerId);
}

/** ロック済みの数（HUD・テスト用） @param {string} playerId @param {any} st */
export function smartLocked(playerId, st) {
  const need = st.spec?.lockTicks ?? 8;
  return [...(smartLocks.get(playerId)?.values() ?? [])].filter((t) => t >= need).length;
}

/**
 * 次に撃つ方向：ロック済みの敵へ順番に（見えていなければ飛ばす）。なければ null
 * @param {Player} player @param {import("../util/math.js").Vec3} eye @param {any} st
 */
export function smartDir(player, eye, st) {
  const need = st.spec?.lockTicks ?? 8;
  const locks = smartLocks.get(player.id);
  if (!locks || !locks.size) return null;
  const ready = [...locks.entries()].filter(([, t]) => t >= need).map(([id]) => id);
  if (!ready.length) return null;
  const turn = smartTurn.get(player.id) ?? 0;
  for (let k = 0; k < ready.length; k++) {
    const id = ready[(turn + k) % ready.length];
    const e = world.getEntity(id);
    if (!e || !e.isValid) {
      locks.delete(id);
      continue;
    }
    const c = e.getAABB().center;
    const v = sub(c, eye);
    const L = len(v);
    if (L < 0.1) continue;
    const d = mul(v, 1 / L);
    // ズルはしない：撃つ瞬間に目から見えている相手だけ
    const bh = safe("smart.los", () => player.dimension.getBlockFromRay(eye, d, { maxDistance: Math.max(0.1, L - 0.4), includePassableBlocks: false, includeLiquidBlocks: false }));
    if (bh) continue;
    smartTurn.set(player.id, turn + k + 1);
    return d;
  }
  return null;
}

// ---------------------------------------------------------------------------
//  ブリンク・回復ビーム・酸・衛星砲
// ---------------------------------------------------------------------------

/** 足元と頭の高さが空いているか @param {import("@minecraft/server").Dimension} dim @param {import("../util/math.js").Vec3} feet */
function standable(dim, feet) {
  return !!safe("blink.fit", () => {
    const a = dim.getBlock({ x: Math.floor(feet.x), y: Math.floor(feet.y), z: Math.floor(feet.z) });
    const b = dim.getBlock({ x: Math.floor(feet.x), y: Math.floor(feet.y) + 1, z: Math.floor(feet.z) });
    return !!a && !!b && !isSolidBlock(a) && !isSolidBlock(b) && !a.isLiquid;
  });
}

/**
 * 撃った先へ瞬間移動（壁の手前で止まる）
 * @param {Player} player @param {import("../util/math.js").Vec3} eye @param {import("../util/math.js").Vec3} dir @param {any} st
 * @returns {boolean} 移動できたか
 */
export function fireBlink(player, eye, dir, st) {
  const dim = player.dimension;
  const reach = loadedReach(dim, eye, dir, st.range1, system.currentTick);
  if (reach < 1) return false;
  const bh = safe("blink.ray", () => dim.getBlockFromRay(eye, dir, { maxDistance: reach, includePassableBlocks: false, includeLiquidBlocks: true }));
  const hit = bh ? add(bh.block.location, bh.faceLocation) : add(eye, mul(dir, reach));
  // 床に向けて撃ったら床の上に立つ。壁なら手前に下がりながら立てる場所を探す
  const onFloor = bh && bh.face === "Up";
  /** @type {import("../util/math.js").Vec3|null} */
  let feet = null;
  if (onFloor) {
    const f = { x: hit.x, y: Math.floor(hit.y + 0.01), z: hit.z };
    if (standable(dim, f)) feet = f;
  }
  for (let back = 0.6; !feet && back < Math.min(6, dist(eye, hit)); back += 0.5) {
    const p = add(hit, mul(dir, -back));
    const f = { x: p.x, y: p.y - 1.62, z: p.z };
    if (standable(dim, f)) feet = f;
  }
  if (!feet) return false;
  const from = player.location;
  const ok = !!safe("blink.tp", () => {
    player.teleport(feet, { keepVelocity: false, checkForBlocks: true, rotation: player.getRotation() });
    return true;
  });
  if (!ok) return false;
  emit(dim, "arsenal:energy_ring", add(from, { x: 0, y: 1, z: 0 }), undefined, { range: 64 });
  emit(dim, "arsenal:energy_ring", add(feet, { x: 0, y: 1, z: 0 }), undefined, { range: 64 });
  playNear(dim, feet, "arsenal.fire.sonic", { range: 24, pitch: 1.8 });
  return true;
}

/** 味方か（回復ビームの対象） @param {import("@minecraft/server").Entity} shooter @param {import("@minecraft/server").Entity} e */
function isFriend(shooter, e) {
  if (e instanceof Player) return !canDamage(shooter, e);
  // 自分の設置物・乗り物（a:own）と、飼いならした動物
  if (safe("heal.own", () => e.getDynamicProperty("a:own")) === shooter.id) return true;
  const tame = safe("heal.tame", () => e.getComponent("minecraft:tameable"));
  return !!tame && /** @type {any} */ (tame).tamedToPlayerId === shooter.id;
}

/**
 * 回復ビーム
 * @param {import("@minecraft/server").Entity} shooter @param {import("../util/math.js").Vec3} eye @param {import("../util/math.js").Vec3} dir @param {any} st @param {import("../util/math.js").Vec3} muzzle
 * @returns {"heal"|"hurt"|"none"}
 */
export function fireHeal(shooter, eye, dir, st, muzzle) {
  const dim = shooter.dimension;
  const reach = loadedReach(dim, eye, dir, st.range1, system.currentTick);
  if (reach <= 0.1) return "none";
  const bh = safe("heal.ray", () => dim.getBlockFromRay(eye, dir, { maxDistance: reach, includePassableBlocks: false, includeLiquidBlocks: false }));
  const wall = bh ? dist(eye, add(bh.block.location, bh.faceLocation)) : reach;
  const hits = safe("heal.ents", () => dim.getEntitiesFromRay(eye, dir, { maxDistance: Math.max(0.1, wall), excludeFamilies: EXCLUDE, excludeTypes: EXCLUDE_T, ignoreBlockCollision: true })) ?? [];
  const h = hits.filter((x) => x.entity.id !== shooter.id).sort((a, b) => a.distance - b.distance)[0];
  const end = h ? add(eye, mul(dir, h.distance)) : add(eye, mul(dir, wall));
  const friend = !!h && isFriend(shooter, h.entity);
  beamLine(dim, muzzle, end, friend ? { red: 0.35, green: 1.0, blue: 0.45 } : { red: 1.0, green: 0.6, blue: 0.3 });
  if (!h) return "none";
  const e = h.entity;
  const hp = e.getComponent("minecraft:health");
  if (!hp) return "none";
  if (friend) {
    const amt = st.spec?.heal ?? 0.5;
    if (hp.currentValue < hp.effectiveMax) safe("heal.set", () => hp.setCurrentValue(Math.min(hp.effectiveMax, hp.currentValue + amt)));
    if (system.currentTick % 4 === 0) emit(dim, "arsenal:heal", e.getAABB().center, undefined, { range: 32, minQ: 1 });
    return "heal";
  }
  if (!canDamage(shooter, e)) return "none";
  bulletHit(shooter, e, end, dir, h.distance, st, 1, { noZones: true, silent: true });
  return "hurt";
}

/**
 * 酸：円錐の相手に毒と腐食（機械にも効く）
 * @param {import("@minecraft/server").Entity} shooter @param {import("../util/math.js").Vec3} eye @param {import("../util/math.js").Vec3} dir @param {any} st @param {import("../util/math.js").Vec3} muzzle
 * @returns {number} 当たった数
 */
export function fireAcid(shooter, eye, dir, st, muzzle) {
  const sp = st.spec ?? {};
  const v = new MolangVariableMap();
  v.setColorRGB("variable.color", { red: 0.6, green: 1.0, blue: 0.25 });
  for (let i = 1; i <= 3; i++) emit(shooter.dimension, "arsenal:plasma_glow", add(muzzle, mul(dir, i * (st.range1 / 3.5))), v, { range: 48, minQ: i === 2 ? 0 : 1 });
  let n = 0;
  for (const h of entitiesInCone(shooter, eye, dir, st.range1, Math.cos(((sp.cone ?? 16) * Math.PI) / 180))) {
    if (!h.e.getComponent("minecraft:health") || !canDamage(shooter, h.e)) continue;
    const r = dealDamage(shooter, h.e, st.dmg * WS().damageMul, { weaponId: st.id, kind: "acid" });
    if (shooter instanceof Player) hitFeedback(shooter, r.killed ? "kill" : "hit", r.dealt);
    if (h.e.isValid) {
      corrode(h.e.id, sp.corrode ?? 100);
      safe("acid.poison", () => h.e.addEffect("poison", sp.poison ?? 60, { amplifier: 0, showParticles: false }));
    }
    n++;
  }
  return n;
}

/**
 * 衛星砲の照準：照準の先の地面に印を付ける。真上に空が見えなければ呼べない
 * @param {Player} player @param {import("../util/math.js").Vec3} eye @param {import("../util/math.js").Vec3} dir @param {any} st
 * @returns {boolean} 呼べたか
 */
export function fireOrbital(player, eye, dir, st) {
  const dim = player.dimension;
  const reach = loadedReach(dim, eye, dir, st.range1, system.currentTick);
  if (reach < 1) return false;
  const bh = safe("orbital.ray", () => dim.getBlockFromRay(eye, dir, { maxDistance: reach, includePassableBlocks: false, includeLiquidBlocks: true }));
  if (!bh) return false;
  const at = add(add(bh.block.location, bh.faceLocation), mul(faceNormal(bh.face), 0.1));
  // 空が見えるか（真上に 40 ブロックのあいだ、ふさぐブロックがない）
  const up = loadedReach(dim, at, { x: 0, y: 1, z: 0 }, 40, system.currentTick);
  const roof = up > 0 ? safe("orbital.sky", () => dim.getBlockFromRay(add(at, { x: 0, y: 0.2, z: 0 }), { x: 0, y: 1, z: 0 }, { maxDistance: up, includePassableBlocks: false, includeLiquidBlocks: false })) : undefined;
  if (roof) return false;
  addOrbital(dim, at, player.id, st);
  return true;
}
