// @ts-check
/**
 * 弾道：ヒットスキャン（レイキャスト）、拡散、貫通
 */
import { DATA } from "../config/constants.js";
import { W as WS } from "./settings.js";
import { bulletHit } from "./damage.js";
import { impactBlock, playNear, tracer, emit } from "../fx/effects.js";
import { add, mul, sub, dist, rayExitBlock, faceNormal, norm, dot, loadedReach } from "../util/math.js";
import { safe } from "../util/log.js";
import { Player, system } from "@minecraft/server";

const RAY_EXCLUDE_FAMILIES = ["inanimate", "arsenal_fx", "projectile"];
const RAY_EXCLUDE_TYPES = ["minecraft:item", "minecraft:xp_orb", "minecraft:arrow", "minecraft:fishing_hook", "minecraft:area_effect_cloud", "minecraft:painting", "minecraft:leash_knot"];

/** @type {Map<string, {cost:number|null, glass:boolean}>} */
const penCache = new Map();

/** @param {string} typeId */
export function penetration(typeId) {
  let c = penCache.get(typeId);
  if (c) return c;
  const id = typeId.replace("minecraft:", "");
  if (DATA.UNPENETRABLE.some((u) => id === u)) c = { cost: null, glass: false };
  else {
    const e = DATA.PENETRABLE.find((p) => p.match.some((m) => id.includes(m)));
    if (e) c = { cost: e.cost, glass: !!(/** @type {any} */ (e).breakable) };
    else c = { cost: 3.5, glass: false };
  }
  penCache.set(typeId, c);
  return c;
}

/**
 * ヒットスキャン弾道
 * @param {import("@minecraft/server").Entity} shooter
 * @param {import("../util/math.js").Vec3} origin
 * @param {import("../util/math.js").Vec3} dir
 * @param {any} st 実効ステータス
 * @param {{maxRange?:number, pen?:number, baseDmg?:number, onEntity?:(e:import("@minecraft/server").Entity, p:import("../util/math.js").Vec3)=>void, silent?:boolean, noImpact?:boolean, pierceAll?:boolean, wallPierce?:boolean, hitSet?:Set<string>, distOffset?:number, mulDmg?:number}} [o]
 * @returns {{end: import("../util/math.js").Vec3, hitEntity: boolean, hitIds: string[], pen: number, stopped: boolean, mulDmg: number, cut: boolean}}
 */
export function traceHitscan(shooter, origin, dir, st, o = {}) {
  const dim = shooter.dimension;
  const wantRange = o.maxRange ?? st.range1;
  // 読み込まれていないチャンクの手前で止める（遠方への射撃で例外を出さない）
  const maxRange = loadedReach(dim, origin, dir, wantRange, system.currentTick);
  let pen = o.pen ?? st.pen;
  let mulDmg = o.mulDmg ?? 1;
  let pos = origin;
  let traveled = 0;
  let end = add(origin, mul(dir, maxRange));
  let hitEntity = false;
  let stopped = false;
  const offset = o.distOffset ?? 0;
  const hit = o.hitSet ?? new Set();
  hit.add(shooter.id);
  /** @type {string[]} */
  const hitIds = [];
  const wallPierce = o.wallPierce ?? st.wallPierce;
  safe("traceHitscan", () => {
    for (let seg = 0; seg < 10; seg++) {
      const remaining = maxRange - traveled;
      if (remaining <= 0.05) {
        end = pos;
        return;
      }
      const bh = dim.getBlockFromRay(pos, dir, { maxDistance: remaining, includeLiquidBlocks: false, includePassableBlocks: false });
      /** @type {import("../util/math.js").Vec3|null} */
      let bpoint = null;
      let bdist = remaining;
      if (bh) {
        bpoint = add(bh.block.location, bh.faceLocation);
        bdist = dist(pos, bpoint);
      }
      const ents = dim.getEntitiesFromRay(pos, dir, {
        maxDistance: Math.max(0.01, bdist),
        ignoreBlockCollision: true,
        excludeFamilies: RAY_EXCLUDE_FAMILIES,
        excludeTypes: RAY_EXCLUDE_TYPES,
      });
      ents.sort((a, b) => a.distance - b.distance);
      for (const eh of ents) {
        const e = eh.entity;
        if (hit.has(e.id)) continue;
        hit.add(e.id);
        const p = add(pos, mul(dir, eh.distance));
        const r = bulletHit(shooter, e, p, dir, offset + traveled + eh.distance, st, mulDmg, { baseDmg: o.baseDmg, silent: o.silent });
        if (r === "pass") continue;
        if (r === "block") {
          end = p;
          stopped = true;
          return;
        }
        hitEntity = true;
        hitIds.push(e.id);
        if (o.onEntity) o.onEntity(e, p);
        if (o.pierceAll) continue;
        pen -= 1;
        mulDmg *= 0.7;
        if (pen < 0) {
          end = p;
          stopped = true;
          return;
        }
      }
      if (!bh || !bpoint) {
        end = add(pos, mul(dir, remaining));
        return;
      }
      const normal = faceNormal(bh.face);
      const typeId = bh.block.typeId;
      if (!o.noImpact) impactBlock(dim, bpoint, normal, typeId);
      const pc = penetration(typeId);
      // ガラスの破壊
      if (pc.glass && WS().glassBreak && shooter instanceof Player) {
        safe("glassBreak", () => {
          bh.block.setType("minecraft:air");
          playNear(dim, bpoint, "arsenal.fx.glass", { range: 24, volume: 0.6, pitch: 1.3 });
        });
        traveled += bdist;
        pos = add(bpoint, mul(dir, 0.02));
        continue;
      }
      if (pc.cost === null) {
        end = bpoint;
        stopped = true;
        if (!st.noRicochet) ricochet(dim, bpoint, dir, normal);
        return;
      }
      const cost = wallPierce ? pc.cost * 0.5 : pc.cost;
      if (pen < cost) {
        end = bpoint;
        stopped = true;
        if (!st.noRicochet) ricochet(dim, bpoint, dir, normal);
        return;
      }
      pen -= cost;
      mulDmg *= wallPierce ? 0.85 : 0.65;
      const ex = rayExitBlock(bh.block.location, bpoint, dir);
      traveled += bdist + ex.t;
      pos = add(ex.point, mul(dir, 0.01));
      if (!o.noImpact) impactBlock(dim, ex.point, mul(normal, -1), typeId);
    }
  });
  return { end, hitEntity, hitIds, pen, stopped, mulDmg, cut: maxRange < wantRange - 0.01 };
}

/**
 * 跳弾音（浅い角度のみ）
 * @param {import("@minecraft/server").Dimension} dim @param {import("../util/math.js").Vec3} p @param {import("../util/math.js").Vec3} dir @param {import("../util/math.js").Vec3} n
 */
function ricochet(dim, p, dir, n) {
  const c = -dot(dir, n);
  if (c < 0.35 && Math.random() < 0.5) playNear(dim, p, "arsenal.fx.ricochet", { range: 24, volume: 0.7, pitch: 0.9 + Math.random() * 0.3 });
  else if (Math.random() < 0.35) playNear(dim, p, "arsenal.fx.impact_block", { range: 16, volume: 0.5 });
}

/**
 * 飛翔音（弾道の近くにいたプレイヤーに風切り音）
 * @param {import("@minecraft/server").Entity} shooter @param {import("../util/math.js").Vec3} from @param {import("../util/math.js").Vec3} to
 */
/** 超音速の弾（小銃弾）か：近くを通るとクラック音がする。亜音速弾は風切り音だけ @param {any} st */
export function isSupersonic(st) {
  return !!st && !st.subsonic && ["carbine", "assault", "battle", "dmr", "sniper", "lmg", "heavy"].includes(st.cat);
}

/**
 * 弾が近くを通った人に風切り音（超音速ならクラック音も）と制圧
 * @param {import("@minecraft/server").Entity} shooter @param {import("../util/math.js").Vec3} from @param {import("../util/math.js").Vec3} to @param {boolean} [supersonic]
 */
export function whizzBy(shooter, from, to, supersonic = false) {
  safe("whizz", () => {
    const d = sub(to, from);
    const L = Math.sqrt(dot(d, d));
    if (L < 4) return;
    const dirn = mul(d, 1 / L);
    const mid = add(from, mul(dirn, L / 2));
    for (const p of shooter.dimension.getPlayers({ location: mid, maxDistance: L / 2 + 4 })) {
      if (p.id === shooter.id) continue;
      const rel = sub(p.getHeadLocation(), from);
      const tt = dot(rel, dirn);
      if (tt < 2 || tt > L) continue;
      const closest = add(from, mul(dirn, tt));
      const miss = dist(closest, p.getHeadLocation());
      if (miss < 2.2) {
        if (supersonic) p.playSound("arsenal.fx.crack", { location: closest, volume: 1.0, pitch: 0.92 + Math.random() * 0.16 });
        p.playSound("arsenal.fx.whizz", { location: closest, volume: supersonic ? 0.5 : 0.9, pitch: 0.9 + Math.random() * 0.3 });
        // 制圧：敵（または敵チーム）の弾が至近を通過した
        suppressHook(p, shooter, miss);
      }
    }
  });
}

/** @type {(p:Player, shooter:import("@minecraft/server").Entity, miss:number)=>void} */
let suppressHook = () => {};
/** @param {(p:Player, shooter:import("@minecraft/server").Entity, miss:number)=>void} fn */
export function setSuppressHook(fn) {
  suppressHook = fn;
}

/**
 * 曳光弾の描画
 * @param {import("@minecraft/server").Entity} shooter @param {import("../util/math.js").Vec3} from @param {import("../util/math.js").Vec3} to @param {any} st @param {boolean} force
 */
export function drawTracer(shooter, from, to, st, force) {
  if (!force && !st.tracer) return;
  const color = st.tracerAlways ? { r: 1.0, g: 0.3, b: 0.18 } : st.ammoFamily === "cell" ? { r: 0.35, g: 0.9, b: 1.0 } : { r: 1.0, g: 0.78, b: 0.35 };
  const heavy = st.cat === "sniper" || st.cat === "lmg" || st.cat === "battle";
  tracer(shooter.dimension, from, to, color, st.tracerAlways ? 0.085 : heavy ? 0.065 : 0.05);
}

/**
 * 電撃の見た目（2 点間にスパークを並べる）
 * @param {import("@minecraft/server").Dimension} dim @param {import("../util/math.js").Vec3} a @param {import("../util/math.js").Vec3} b @param {import("@minecraft/server").MolangVariableMap} [vars]
 */
export function arcLine(dim, a, b, vars) {
  const L = dist(a, b);
  const n = Math.min(40, Math.max(3, Math.floor(L * 2)));
  const d = norm(sub(b, a));
  for (let i = 0; i <= n; i++) {
    const p = add(a, mul(d, (L * i) / n));
    const j = { x: (Math.random() - 0.5) * 0.25, y: (Math.random() - 0.5) * 0.25, z: (Math.random() - 0.5) * 0.25 };
    emit(dim, "arsenal:arc_spark", add(p, j), vars, { range: 64 });
  }
}
