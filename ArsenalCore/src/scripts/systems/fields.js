// @ts-check
/**
 * 2.5 の特殊武器が地面や相手に残す効果
 *   singularity（重力井戸：まわりを吸い込み、最後に押しつぶす）
 *   stasis（時間減速フィールド：中の相手はほとんど動けない）
 *   orbital（衛星砲：印を付けた地点に、少し遅れて空から光の柱）
 *   net（網：着弾点のまわりを動けなくする）
 *   tranq（麻酔：少し遅れて眠らせる）
 *   pin（銛で壁に縫い付ける）
 * 動けなくするのは鈍足（レベル 7 で移動 0）と、敵 AI のスタン（撃たない・動かない）。
 */
import { system, world, MolangVariableMap, Player } from "@minecraft/server";
import { canDamage, dealDamage, hitFeedback } from "../core/damage.js";
import { W as WS } from "../core/settings.js";
import { emit, playNear } from "../fx/effects.js";
import { add, sub, len, norm, dist, isLoaded } from "../util/math.js";
import { safe } from "../util/log.js";

const EXCLUDE = ["inanimate", "arsenal_fx", "projectile"];
const EXCLUDE_T = ["minecraft:item", "minecraft:xp_orb"];

/** 敵 AI のスタン（ai/brain.js が登録する。撃たない・動かない） @type {(e:import("@minecraft/server").Entity, ticks:number)=>void} */
let stunHandler = () => {};
/** @param {(e:import("@minecraft/server").Entity, ticks:number)=>void} fn */
export function setStunHandler(fn) {
  stunHandler = fn;
}

/**
 * @typedef {{kind:"singularity"|"stasis"|"orbital", dim:import("@minecraft/server").Dimension, pos:import("../util/math.js").Vec3, radius:number,
 *   start:number, until:number, ownerId:string, weaponId:string, data:any}} Field
 */
/** @type {Field[]} */
const fields = [];
const MAX_FIELDS = 24;

/** @param {string} id */
function owner(id) {
  const e = world.getEntity(id);
  return e && e.isValid ? e : undefined;
}

/** ボス（段階のある敵）か @param {import("@minecraft/server").Entity} e */
function isBoss(e) {
  return e.typeId.startsWith("arsenal:") && safe("boss.prop", () => e.getDynamicProperty("a:boss")) !== undefined;
}

/**
 * 範囲内の、撃ち手が攻撃できる相手
 * @param {import("@minecraft/server").Dimension} dim @param {import("../util/math.js").Vec3} pos @param {number} r @param {import("@minecraft/server").Entity|undefined} src @param {string} ownerId
 */
function victims(dim, pos, r, src, ownerId) {
  /** @type {import("@minecraft/server").Entity[]} */
  const out = [];
  safe("field.scan", () => {
    for (const e of dim.getEntities({ location: pos, maxDistance: r, excludeFamilies: EXCLUDE, excludeTypes: EXCLUDE_T })) {
      if (e.id === ownerId || !e.getComponent("minecraft:health")) continue;
      if (src && !canDamage(src, e)) continue;
      out.push(e);
    }
  });
  return out;
}

/**
 * 動けなくする（鈍足 7 = 移動 0、敵 AI はスタン）
 * @param {import("@minecraft/server").Entity} e @param {number} ticks
 */
export function immobilize(e, ticks) {
  const t = isBoss(e) ? Math.round(ticks * 0.3) : ticks;
  // AI のスタン（鈍足 4）を先に。後から鈍足 7 を重ねる
  stunHandler(e, t);
  safe("immobilize", () => {
    e.addEffect("slowness", t, { amplifier: 6, showParticles: false });
    e.addEffect("weakness", t, { amplifier: 1, showParticles: false });
  });
  return t;
}

/** @param {Field} f */
function push(f) {
  if (fields.length >= MAX_FIELDS) fields.shift();
  fields.push(f);
}

/**
 * 重力井戸
 * @param {import("@minecraft/server").Dimension} dim @param {import("../util/math.js").Vec3} pos @param {string} ownerId @param {any} st
 */
export function addSingularity(dim, pos, ownerId, st) {
  const sp = st.spec ?? {};
  const now = system.currentTick;
  push({ kind: "singularity", dim, pos, radius: sp.radius ?? 7, start: now, until: now + (sp.secs ?? 3) * 20, ownerId, weaponId: st.id, data: { pull: sp.pull ?? 0.3, dot: sp.dot ?? 1, burst: sp.burst ?? 16, burstRadius: sp.burstRadius ?? 4 } });
  playNear(dim, pos, "arsenal.fire.gravity", { range: 48, pitch: 0.5 });
}

/**
 * 時間減速フィールド
 * @param {import("@minecraft/server").Dimension} dim @param {import("../util/math.js").Vec3} pos @param {string} ownerId @param {any} st
 */
export function addStasis(dim, pos, ownerId, st) {
  const sp = st.spec ?? {};
  const now = system.currentTick;
  push({ kind: "stasis", dim, pos, radius: sp.radius ?? 5, start: now, until: now + (sp.secs ?? 6) * 20, ownerId, weaponId: st.id, data: {} });
  playNear(dim, pos, "arsenal.fire.gravity", { range: 32, pitch: 1.6 });
}

/**
 * 衛星砲の照準（少し遅れて落ちる）
 * @param {import("@minecraft/server").Dimension} dim @param {import("../util/math.js").Vec3} pos @param {string} ownerId @param {any} st
 */
export function addOrbital(dim, pos, ownerId, st) {
  const sp = st.spec ?? {};
  const now = system.currentTick;
  push({ kind: "orbital", dim, pos, radius: sp.radius ?? 3.5, start: now, until: now + (sp.delay ?? 40), ownerId, weaponId: st.id, data: { dmg: st.dmg } });
  playNear(dim, pos, "arsenal.world.klaxon", { range: 64, pitch: 1.4, volume: 0.6 });
}

/**
 * 網：着弾点のまわりの相手を動けなくする
 * @param {import("@minecraft/server").Dimension} dim @param {import("../util/math.js").Vec3} pos @param {string} ownerId @param {any} st
 * @returns {number} 捕まえた数
 */
export function castNet(dim, pos, ownerId, st) {
  const sp = st.spec ?? {};
  const src = owner(ownerId);
  let n = 0;
  for (const e of victims(dim, pos, sp.radius ?? 2.2, src, ownerId)) {
    immobilize(e, (sp.secs ?? 4) * 20);
    emit(dim, "arsenal:frost", e.getAABB().center, undefined, { range: 32 });
    n++;
  }
  const v = new MolangVariableMap();
  v.setFloat("variable.radius", sp.radius ?? 2.2);
  emit(dim, "arsenal:target_marker", add(pos, { x: 0, y: 0.1, z: 0 }), v, { range: 48 });
  playNear(dim, pos, "arsenal.fx.bounce", { range: 16, pitch: 0.6 });
  return n;
}

/**
 * 麻酔：delay tick 後に眠らせる
 * @param {import("@minecraft/server").Entity} e @param {any} st
 */
export function tranquilize(e, st) {
  const sp = st.spec ?? {};
  const id = e.id;
  safe("tranq.drowsy", () => e.addEffect("slowness", sp.delay ?? 40, { amplifier: 1, showParticles: false }));
  system.runTimeout(() => safe("tranq.sleep", () => {
    const t = world.getEntity(id);
    if (!t || !t.isValid) return;
    const ticks = immobilize(t, (sp.secs ?? 8) * 20);
    if (t instanceof Player) {
      t.addEffect("blindness", ticks, { amplifier: 0, showParticles: false });
      safe("tranq.fade", () => t.camera.fade({ fadeColor: { red: 0, green: 0, blue: 0 }, fadeTime: { fadeInTime: 0.6, holdTime: Math.max(0.5, ticks / 20 - 1.2), fadeOutTime: 0.6 } }));
    }
    emit(t.dimension, "arsenal:steam", add(t.location, { x: 0, y: 2.1, z: 0 }), undefined, { range: 32 });
  }), sp.delay ?? 40);
}

/**
 * 銛で縫い付ける
 * @param {import("@minecraft/server").Entity} e @param {number} ticks
 */
export function pin(e, ticks) {
  immobilize(e, ticks);
  emit(e.dimension, "arsenal:impact_spark", e.getAABB().center, undefined, { range: 32 });
}

/** 有効なフィールドの数（テスト用） */
export function activeFields() {
  return fields.length;
}

/** @param {Field} f @param {number} now */
function tickSingularity(f, now) {
  const src = owner(f.ownerId);
  const age = now - f.start;
  // 渦の見た目
  if (age % 2 === 0) {
    const v = new MolangVariableMap();
    v.setColorRGB("variable.color", { red: 0.6, green: 0.25, blue: 1.0 });
    emit(f.dim, "arsenal:plasma_glow", f.pos, v, { range: 96 });
    const a = age * 0.6;
    const r = f.radius * (1 - (age % 20) / 20);
    emit(f.dim, "arsenal:plasma_glow", add(f.pos, { x: Math.cos(a) * r, y: 0.3, z: Math.sin(a) * r }), v, { range: 64, minQ: 1 });
  }
  for (const e of victims(f.dim, f.pos, f.radius, src, f.ownerId)) {
    const c = e.getAABB().center;
    const to = sub(f.pos, c);
    const d = len(to);
    if (d > 0.6) {
      const k = f.data.pull * (0.5 + 0.5 * (1 - d / f.radius));
      const n = norm(to);
      safe("sing.pull", () => e.applyKnockback({ x: n.x * k, z: n.z * k }, Math.max(-0.05, Math.min(0.25, n.y * k + 0.04))));
    }
    if (age % 10 === 0 && src) {
      const r = dealDamage(src, e, f.data.dot * WS().damageMul, { weaponId: f.weaponId, kind: "field" });
      if (src instanceof Player) hitFeedback(src, r.killed ? "kill" : "hit", r.dealt);
    }
  }
}

/** @param {Field} f */
function collapse(f) {
  const src = owner(f.ownerId);
  emit(f.dim, "arsenal:sonic_ring", f.pos, undefined, { range: 96 });
  emit(f.dim, "arsenal:impact_spark", f.pos, undefined, { range: 96 });
  playNear(f.dim, f.pos, "arsenal.fx.explosion", { range: 64, pitch: 0.6 });
  if (!src) return;
  for (const e of victims(f.dim, f.pos, f.data.burstRadius, src, f.ownerId)) {
    const d = dist(e.getAABB().center, f.pos);
    const k = 1 - 0.5 * Math.min(1, d / f.data.burstRadius);
    const r = dealDamage(src, e, f.data.burst * k * WS().damageMul, { weaponId: f.weaponId, kind: "field" });
    if (src instanceof Player) hitFeedback(src, r.killed ? "kill" : "hit", r.dealt);
  }
}

/** @param {Field} f @param {number} now */
function tickStasis(f, now) {
  const age = now - f.start;
  if (age % 4 === 0) {
    const v = new MolangVariableMap();
    v.setFloat("variable.radius", f.radius);
    emit(f.dim, "arsenal:target_marker", add(f.pos, { x: 0, y: 0.1, z: 0 }), v, { range: 64, minQ: age % 8 === 0 ? 0 : 1 });
  }
  if (age % 5 !== 0) return;
  const src = owner(f.ownerId);
  for (const e of victims(f.dim, f.pos, f.radius, src, f.ownerId)) {
    safe("stasis.slow", () => {
      e.addEffect("slowness", 12, { amplifier: 5, showParticles: false });
      e.addEffect("mining_fatigue", 12, { amplifier: 2, showParticles: false });
      e.addEffect("weakness", 12, { amplifier: 1, showParticles: false });
    });
    // 落ちる速さも遅くする（宙に浮いた相手はゆっくり落ちる）
    safe("stasis.fall", () => e.addEffect("slow_falling", 12, { amplifier: 0, showParticles: false }));
    emit(f.dim, "arsenal:frost", e.getAABB().center, undefined, { range: 32, minQ: 1 });
  }
}

/** @param {Field} f @param {number} now */
function tickOrbital(f, now) {
  const left = f.until - now;
  if (left % 5 === 0) {
    const v = new MolangVariableMap();
    v.setFloat("variable.radius", f.radius);
    emit(f.dim, "arsenal:target_marker", add(f.pos, { x: 0, y: 0.15, z: 0 }), v, { range: 128 });
  }
  if (left === 10) playNear(f.dim, f.pos, "arsenal.fire.beam", { range: 96, pitch: 0.5 });
}

/** @param {Field} f */
function strike(f) {
  const src = owner(f.ownerId);
  const v = new MolangVariableMap();
  v.setSpeedAndDirection("variable.tracer", 0.01, { x: 0, y: -1, z: 0 });
  v.setColorRGB("variable.color", { red: 1.0, green: 0.9, blue: 0.5 });
  for (let y = 0; y < 40; y += 1.2) emit(f.dim, "arsenal:rail_beam", add(f.pos, { x: 0, y, z: 0 }), v, { range: 160, minQ: y % 2.4 < 1.2 ? 0 : 1 });
  emit(f.dim, "arsenal:sonic_ring", f.pos, undefined, { range: 128 });
  playNear(f.dim, f.pos, "arsenal.fx.explosion", { range: 128 });
  playNear(f.dim, f.pos, "arsenal.fx.explosion_far", { range: 320 });
  if (!src) return;
  for (const e of victims(f.dim, f.pos, f.radius + 0.5, src, f.ownerId)) {
    const c = e.getAABB().center;
    const d = Math.hypot(c.x - f.pos.x, c.z - f.pos.z);
    const k = 1 - 0.6 * Math.min(1, d / (f.radius + 0.5));
    const r = dealDamage(src, e, f.data.dmg * k * WS().damageMul, { weaponId: f.weaponId, fire: 4, kind: "field" });
    if (src instanceof Player) hitFeedback(src, r.killed ? "kill" : "hit", r.dealt);
  }
}

/** 毎 tick */
export function tickFields() {
  const now = system.currentTick;
  for (let i = fields.length - 1; i >= 0; i--) {
    const f = fields[i];
    if (!isLoaded(f.dim, f.pos, now)) {
      fields.splice(i, 1);
      continue;
    }
    if (now >= f.until) {
      fields.splice(i, 1);
      if (f.kind === "singularity") safe("field.collapse", () => collapse(f));
      else if (f.kind === "orbital") safe("field.strike", () => strike(f));
      continue;
    }
    if (f.kind === "singularity") safe("field.sing", () => tickSingularity(f, now));
    else if (f.kind === "stasis") safe("field.stasis", () => tickStasis(f, now));
    else if (f.kind === "orbital") safe("field.orbital", () => tickOrbital(f, now));
  }
}

