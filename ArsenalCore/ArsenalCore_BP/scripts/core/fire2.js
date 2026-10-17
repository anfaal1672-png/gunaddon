// @ts-check
/**
 * 2.0 で増えた射撃方式
 *   flame（火炎放射：押している間、短距離の円錐に毎射撃で判定。燃料を消費）
 *   beam（照射ビーム：押している間、細いレーザーで判定。過熱する）
 *   gravity（重力ガン：通常は引き寄せ、スニーク中は吹き飛ばし）
 *   coil（溜め撃ちの電磁砲。命中した相手から連鎖）
 *   plasma（過熱式の連射。着弾で小さく炸裂する実体弾）
 *   needle（追尾ニードル。5 本刺さると炸裂）
 *   sonic（扇状の衝撃波でノックバック）
 *   mortar（携行迫撃砲。視線の先、またはメニューで決めた座標に落ちる）
 */
import { MolangVariableMap, system } from "@minecraft/server";
import { traceHitscan, arcLine } from "./ballistics.js";
import { bulletHit, canDamage, dealDamage, hitFeedback } from "./damage.js";
import { firePlasma, fireNeedle, fireMortar } from "../systems/projectiles.js";
import { emit, playNear } from "../fx/effects.js";
import { cone, add, mul, sub, norm, dist, dot, len } from "../util/math.js";
import { W as WS, explosionBreaksBlocks } from "./settings.js";
import { safe } from "../util/log.js";

const EXCLUDE = ["inanimate", "arsenal_fx", "projectile"];
const EXCLUDE_T = ["minecraft:item", "minecraft:xp_orb"];

/**
 * 円錐内の相手（視線が通るもの）
 * @param {import("@minecraft/server").Entity} shooter @param {import("../util/math.js").Vec3} eye @param {import("../util/math.js").Vec3} dir @param {number} range @param {number} cosHalf
 */
export function entitiesInCone(shooter, eye, dir, range, cosHalf) {
  /** @type {{e:import("@minecraft/server").Entity, d:number, p:import("../util/math.js").Vec3}[]} */
  const out = [];
  safe("cone", () => {
    for (const e of shooter.dimension.getEntities({ location: eye, maxDistance: range + 1.5, excludeFamilies: EXCLUDE, excludeTypes: EXCLUDE_T })) {
      if (e.id === shooter.id) continue;
      const c = e.getAABB().center;
      const v = sub(c, eye);
      const d = len(v);
      if (d < 0.01 || d > range + 0.8) continue;
      if (dot(mul(v, 1 / d), dir) < cosHalf) continue;
      const bh = shooter.dimension.getBlockFromRay(eye, mul(v, 1 / d), { maxDistance: Math.max(0.1, d - 0.4), includePassableBlocks: false, includeLiquidBlocks: false });
      if (bh) continue;
      out.push({ e, d, p: c });
    }
  });
  return out;
}

/**
 * 火炎放射
 * @param {import("@minecraft/server").Entity} shooter @param {import("../util/math.js").Vec3} eye @param {import("../util/math.js").Vec3} dir @param {any} st @param {import("../util/math.js").Vec3} muzzle
 */
export function fireFlame(shooter, eye, dir, st, muzzle) {
  const v = new MolangVariableMap();
  v.setSpeedAndDirection("variable.aim", 14, dir);
  emit(shooter.dimension, "arsenal:flame", muzzle, v, { range: 64 });
  const range = st.range1;
  let hits = 0;
  for (const h of entitiesInCone(shooter, eye, dir, range, Math.cos((14 * Math.PI) / 180))) {
    if (h.e.typeId === "arsenal:target_dummy") {
      bulletHit(shooter, h.e, h.p, dir, h.d, st, 1, { noZones: true, silent: true });
      continue;
    }
    if (!h.e.getComponent("minecraft:health") || !canDamage(shooter, h.e)) continue;
    const falloff = h.d > st.range0 ? 0.6 : 1;
    const r = dealDamage(shooter, h.e, st.dmg * falloff * WS().damageMul, { fire: st.fireSecs || 5, weaponId: st.id });
    hitFeedback(shooter, r.killed ? "kill" : "hit", r.dealt);
    hits++;
  }
  // 地面に火を付ける（ブロックの破壊が許可されているときだけ）
  if (Math.random() < 0.25 && explosionBreaksBlocks()) {
    safe("flame.fire", () => {
      const bh = shooter.dimension.getBlockFromRay(eye, dir, { maxDistance: range, includePassableBlocks: false, includeLiquidBlocks: false });
      if (!bh) return;
      const above = bh.block.above();
      if (above && above.isAir && bh.face === "Up") above.setType("minecraft:fire");
    });
  }
  return hits;
}

/**
 * 照射ビーム
 * @param {import("@minecraft/server").Entity} shooter @param {import("../util/math.js").Vec3} eye @param {import("../util/math.js").Vec3} dir @param {any} st @param {import("../util/math.js").Vec3} muzzle
 */
export function fireBeam(shooter, eye, dir, st, muzzle) {
  const r = traceHitscan(shooter, eye, dir, st, { pen: 0, silent: true });
  const v = new MolangVariableMap();
  const L = dist(muzzle, r.end);
  const dn = norm(sub(r.end, muzzle));
  v.setSpeedAndDirection("variable.tracer", 0.01, dn);
  v.setColorRGB("variable.color", { red: 1.0, green: 0.55, blue: 0.25 });
  const step = L > 20 ? 1.0 : 0.6;
  for (let i = 0; i < L; i += step) emit(shooter.dimension, "arsenal:rail_beam", add(muzzle, mul(dn, i)), v, { range: 96, minQ: i % 2 === 0 ? 0 : 1 });
  emit(shooter.dimension, "arsenal:impact_spark", r.end, undefined, { range: 48 });
  return r;
}

/**
 * 重力ガン：引き寄せ（通常）／吹き飛ばし（スニーク）
 * @param {import("@minecraft/server").Entity} shooter @param {import("../util/math.js").Vec3} eye @param {import("../util/math.js").Vec3} dir @param {any} st @param {boolean} push
 */
export function fireGravity(shooter, eye, dir, st, push) {
  const range = st.range1;
  const hits = entitiesInCone(shooter, eye, dir, range, Math.cos((12 * Math.PI) / 180));
  const v = new MolangVariableMap();
  v.setFloat("variable.radius", 2.5);
  const end = add(eye, mul(dir, Math.min(range, hits[0]?.d ?? range)));
  emit(shooter.dimension, "arsenal:gravity_swirl", end, v, { range: 64 });
  for (const h of hits) {
    if (!canDamage(shooter, h.e) && h.e.typeId !== "minecraft:item") continue;
    const k = push ? 2.4 : -1.6;
    const to = norm(sub(h.p, eye));
    safe("gravity.knock", () => h.e.applyKnockback({ x: to.x * k, z: to.z * k }, push ? 0.45 : 0.25));
    if (h.e.getComponent("minecraft:health")) {
      const r = dealDamage(shooter, h.e, st.dmg * WS().damageMul, { weaponId: st.id });
      hitFeedback(shooter, r.killed ? "kill" : "hit", r.dealt);
    }
  }
  // 落ちているアイテムも引き寄せる
  if (!push) {
    safe("gravity.items", () => {
      for (const it of shooter.dimension.getEntities({ location: end, maxDistance: 4, type: "minecraft:item" })) {
        const to = norm(sub(eye, it.location));
        it.applyImpulse(mul(to, 0.6));
      }
    });
  }
  playNear(shooter.dimension, end, "arsenal.fire.gravity", { range: 24, volume: 0.6, pitch: push ? 1.2 : 0.8 });
}

/**
 * 電磁コイルガン（溜め撃ち・連鎖）
 * @param {import("@minecraft/server").Entity} shooter @param {import("../util/math.js").Vec3} eye @param {import("../util/math.js").Vec3} dir @param {any} st @param {number} charge @param {import("../util/math.js").Vec3} muzzle
 */
export function fireCoil(shooter, eye, dir, st, charge, muzzle) {
  const dmg = st.dmgMin + (st.dmg - st.dmgMin) * charge;
  /** @type {import("@minecraft/server").Entity|null} */
  let first = null;
  const r = traceHitscan(shooter, eye, dir, st, { baseDmg: dmg, pen: 1 + charge * 3, onEntity: (e) => { if (!first) first = e; } });
  const v = new MolangVariableMap();
  v.setColorRGB("variable.color", { red: 0.45, green: 0.7, blue: 1.0 });
  const dn = norm(sub(r.end, muzzle));
  v.setSpeedAndDirection("variable.tracer", 0.01, dn);
  const L = dist(muzzle, r.end);
  for (let i = 0; i < L; i += 0.7) emit(shooter.dimension, "arsenal:rail_beam", add(muzzle, mul(dn, i)), v, { range: 128 });
  if (!first || !st.chain || charge < 0.5) return;
  /** @type {import("@minecraft/server").Entity} */
  let cur = first;
  const done = new Set([shooter.id, cur.id]);
  let d2 = dmg * 0.6;
  for (let j = 0; j < st.chain.jumps; j++) {
    d2 *= st.chain.falloff;
    const from = cur.getAABB().center;
    const next = cur.dimension.getEntities({ location: from, maxDistance: st.chain.radius, excludeFamilies: EXCLUDE, excludeTypes: EXCLUDE_T })
      .filter((e) => !done.has(e.id) && e.getComponent("minecraft:health") && canDamage(shooter, e))
      .sort((a, b) => dist(a.location, from) - dist(b.location, from))[0];
    if (!next) break;
    done.add(next.id);
    const to = next.getAABB().center;
    arcLine(shooter.dimension, from, to, v);
    bulletHit(shooter, next, to, norm(sub(to, from)), dist(eye, to), st, 1, { baseDmg: d2, noZones: true });
    cur = next;
  }
}

/**
 * 音波砲：扇状の衝撃波（ダメージ＋強いノックバック）
 * @param {import("@minecraft/server").Entity} shooter @param {import("../util/math.js").Vec3} eye @param {import("../util/math.js").Vec3} dir @param {any} st @param {import("../util/math.js").Vec3} muzzle
 */
export function fireSonic(shooter, eye, dir, st, muzzle) {
  const v = new MolangVariableMap();
  v.setSpeedAndDirection("variable.tracer", 16, dir);
  emit(shooter.dimension, "arsenal:sonic_ring", muzzle, v, { range: 64 });
  system.runTimeout(() => emit(shooter.dimension, "arsenal:sonic_ring", add(muzzle, mul(dir, 0.5)), v, { range: 64 }), 2);
  for (const h of entitiesInCone(shooter, eye, dir, st.range1, Math.cos((30 * Math.PI) / 180))) {
    if (!canDamage(shooter, h.e)) continue;
    const k = (st.knock || 2) * (1 - (h.d / (st.range1 + 1)) * 0.5);
    const to = norm(sub(h.p, eye));
    safe("sonic.knock", () => h.e.applyKnockback({ x: to.x * k, z: to.z * k }, 0.5));
    if (h.e.getComponent("minecraft:health")) {
      const r = dealDamage(shooter, h.e, st.dmg * WS().damageMul, { weaponId: st.id });
      hitFeedback(shooter, r.killed ? "kill" : "hit", r.dealt);
      safe("sonic.stun", () => h.e.addEffect("nausea", 60, { amplifier: 0, showParticles: false }));
    }
  }
}

/**
 * プラズマ・ニードル・迫撃砲（実体弾）
 * @param {import("@minecraft/server").Entity} shooter @param {import("../util/math.js").Vec3} muzzle @param {import("../util/math.js").Vec3} dir @param {any} st
 * @param {import("../util/math.js").Vec3|null} [target] 迫撃砲の着弾点
 * @param {string|null} [lockId] ニードルの追尾先
 */
export function fireProjectile2(shooter, muzzle, dir, st, target = null, lockId = null) {
  if (st.fire === "plasma") firePlasma(shooter, muzzle, dir, st);
  else if (st.fire === "needle") fireNeedle(shooter, muzzle, dir, st, lockId);
  else if (st.fire === "mortar") fireMortar(shooter, muzzle, dir, st, target);
}

/**
 * 迫撃砲の着弾点：視線の先のブロック（160 ブロックまで）。空に向けたときは最大射程の地面
 * @param {import("@minecraft/server").Entity} shooter @param {any} st @param {{x:number,z:number}|null} fixed
 */
export function mortarTarget(shooter, st, fixed) {
  const eye = shooter.getHeadLocation();
  if (fixed) {
    const d = Math.hypot(fixed.x - eye.x, fixed.z - eye.z);
    if (d >= st.range0 * 0.5 && d <= st.range1) return { x: fixed.x, y: eye.y, z: fixed.z, fixed: true };
  }
  const dir = shooter.getViewDirection();
  const bh = safe("mortar.ray", () => shooter.dimension.getBlockFromRay(eye, dir, { maxDistance: st.range1, includePassableBlocks: false, includeLiquidBlocks: true }));
  if (bh) return { ...add(bh.block.location, bh.faceLocation), fixed: false };
  const flat = norm({ x: dir.x, y: 0, z: dir.z });
  return { x: eye.x + flat.x * st.range1 * 0.8, y: eye.y, z: eye.z + flat.z * st.range1 * 0.8, fixed: false };
}

export { cone };
