// @ts-check
/**
 * 経路ロックオン（アリアドネ）。
 * 照準の円錐（中心から 10°、捕まえ続けるのは 18°）の中の敵を、壁の向こうでも候補にする。
 * ただしロックが進むのは、撃ち手の目から目標の体まで「ミサイルが実際に通れる道」（pathfind.js）が見つかっている間だけ。
 * 1 マスの穴・窓・開いた扉があれば道はつながり、完全に閉じた部屋の中や地中の敵にはロックできない。
 * 道が見つからなかった敵は 1.5 秒のあいだ候補から外し、次に中心に近い敵を調べる。
 * ロック中は道を点線で見せる（撃ち手にだけ）。
 * 覗いている間は、壁の向こう・建物の中の mob を影絵で見せる（レーダー。drawRadar）。
 */
import { world, system, MolangVariableMap } from "@minecraft/server";
import { startSearch, cancelSearch, segOk, samplePath } from "../systems/pathfind.js";
import { playTo } from "../fx/effects.js";
import { sub, len, dot, dist, add, hitPoint } from "../util/math.js";
import { safe } from "../util/log.js";

const ACQ_COS = Math.cos((10 * Math.PI) / 180);
const KEEP_COS = Math.cos((18 * Math.PI) / 180);
const RANGE = 96;
/** ロック完了後に照準から外れても保つ tick */
const GRACE = 30;
/** 道を確かめ直す間隔 */
const RECHECK = 10;
/** 道が見つからなかった敵を候補から外す tick */
const UNREACH_TTL = 30;

/**
 * @typedef {Object} PathLock
 * @property {string|null} targetId
 * @property {import("../systems/pathfind.js").Search|null} search
 * @property {import("../util/math.js").Vec3[]|null} path
 * @property {number} pathTick
 * @property {Map<string, number>} unreach
 */

/** @type {Map<string, PathLock>} */
const locks = new Map();

/** @param {import("@minecraft/server").Player} player */
function lockOf(player) {
  let L = locks.get(player.id);
  if (!L) {
    L = { targetId: null, search: null, path: null, pathTick: 0, unreach: new Map() };
    locks.set(player.id, L);
  }
  return L;
}

/** ロックを捨てる（覗くのをやめた・武器を替えた） @param {import("@minecraft/server").Player} player */
export function clearPathLock(player) {
  const L = locks.get(player.id);
  if (!L) return;
  cancelSearch(L.search);
  L.search = null;
  L.targetId = null;
  L.path = null;
}

/**
 * 撃つ：ロック済みなら目標と道を渡す（ロックは消える）
 * @param {import("@minecraft/server").Player} player
 * @returns {{targetId:string, path:import("../util/math.js").Vec3[]}|null}
 */
export function takePathLock(player) {
  const L = locks.get(player.id);
  if (!L || !L.targetId || !L.path) return null;
  const out = { targetId: L.targetId, path: L.path.map((p) => ({ ...p })) };
  clearPathLock(player);
  return out;
}

/** @param {import("@minecraft/server").Entity} e @param {import("../util/math.js").Vec3} eye @param {import("../util/math.js").Vec3} dir */
function coneCos(e, eye, dir) {
  const v = sub(e.getAABB().center, eye);
  const L = len(v);
  return L < 1e-3 ? 1 : dot(v, dir) / L;
}

/**
 * 円錐の中で中心に近い順の候補（壁の向こうも含む。道が見つからなかった敵は除く）
 * @param {import("@minecraft/server").Player} player @param {import("../util/math.js").Vec3} eye @param {import("../util/math.js").Vec3} dir @param {PathLock} L
 */
function candidate(player, eye, dir, L) {
  const now = system.currentTick;
  let best = null;
  let bestCos = ACQ_COS;
  for (const e of player.dimension.getEntities({ location: eye, maxDistance: RANGE, excludeFamilies: ["inanimate", "arsenal_fx", "projectile"], excludeTypes: ["minecraft:item", "minecraft:xp_orb"] })) {
    if (e.id === player.id || !e.getComponent("minecraft:health")) continue;
    if ((L.unreach.get(e.id) ?? 0) > now) continue;
    const c = coneCos(e, eye, dir);
    if (c > bestCos) {
      best = e;
      bestCos = c;
    }
  }
  return best;
}

/**
 * @param {import("@minecraft/server").Entity} target
 * @returns {{min:import("../util/math.js").Vec3, max:import("../util/math.js").Vec3}}
 */
function boxOf(target) {
  const b = target.getAABB();
  return { min: sub(b.center, b.extent), max: add(b.center, b.extent) };
}

/**
 * 毎 tick（アリアドネを覗いている間）
 * @param {import("@minecraft/server").Player} player @param {import("./state.js").PlayerState} s @param {any} st
 */
export function tickPathLock(player, s, st) {
  const now = system.currentTick;
  safe("pathlock", () => {
    const L = lockOf(player);
    const eye = player.getHeadLocation();
    const dir = player.getViewDirection();
    const locked = s.lockTicks >= st.lockTicks;
    safe("pathlock.radar", () => drawRadar(player, eye, dir, locked ? L.targetId : null));
    const cur = L.targetId ? world.getEntity(L.targetId) : undefined;
    const curOk = !!cur && cur.isValid && cur.dimension.id === player.dimension.id && dist(cur.location, eye) <= RANGE + 8;
    /** @type {import("@minecraft/server").Entity|undefined} */
    let target;
    if (curOk && coneCos(/** @type {any} */ (cur), eye, dir) >= KEEP_COS) {
      target = cur;
      s.lockSeen = now;
    } else if (curOk && locked && now - s.lockSeen <= GRACE) {
      target = cur;
    } else if (now % 2 === 0 || !L.targetId) {
      target = candidate(player, eye, dir, L) ?? undefined;
      if (target) s.lockSeen = now;
    }
    if (!target) {
      if (s.lockTicks > 0) s.lockTicks = Math.max(0, Math.min(s.lockTicks, st.lockTicks - 1) - 1);
      if (s.lockTicks === 0) {
        clearPathLock(player);
        s.lockTarget = null;
      }
      return;
    }
    if (L.targetId !== target.id) {
      clearPathLock(player);
      L.targetId = target.id;
      s.lockTarget = target.id;
      s.lockTicks = 0;
    }
    const center = target.getAABB().center;
    // 探索の結果
    if (L.search && L.search.state !== "run") {
      if (L.search.state === "ok" && L.search.path) {
        L.path = L.search.path;
        L.pathTick = now;
      } else {
        // 道がない：この敵はしばらく候補から外す
        L.unreach.set(target.id, now + UNREACH_TTL);
        clearPathLock(player);
        s.lockTarget = null;
        s.lockTicks = 0;
        return;
      }
      L.search = null;
    }
    // 道がまだない・古くなった（撃ち手か目標が動いた、途中がふさがれた）なら探し直す。結果が出るまで前の道を使う
    if (!L.search) {
      const stale = !L.path || (now - L.pathTick >= RECHECK && (dist(L.path[0], eye) > 1.0 || dist(L.path[L.path.length - 1], center) > 1.0 || !pathStillOk(player.dimension, L.path)));
      if (stale) L.search = startSearch(player.dimension, eye, boxOf(target), center);
      else if (now - L.pathTick >= RECHECK) L.pathTick = now;
    }
    s.hudDirty = true;
    if (!L.path) {
      // 道を探している間はロックが進まない
      lockMarker(player, eye, center, 0.8);
      return;
    }
    if (s.lockTicks < st.lockTicks + 1) s.lockTicks++;
    const done = s.lockTicks >= st.lockTicks;
    lockMarker(player, eye, center, done ? 0.2 : 0.8);
    if (!done && s.lockTicks % 4 === 0) playTo(player, "arsenal.fx.lock_beep", { volume: 0.6, pitch: 0.8 + (0.6 * s.lockTicks) / st.lockTicks });
    if (s.lockTicks === st.lockTicks) playTo(player, "arsenal.fx.lock_on", { volume: 0.7 });
    // ミサイルが飛ぶ道を点線で（撃ち手にだけ）
    if (done && now % 4 === 0) {
      const dots = samplePath(L.path, 0.8, 120);
      for (let i = 1; i < dots.length; i++) {
        const dv = new MolangVariableMap();
        dv.setFloat("variable.alpha", 0.55);
        player.spawnParticle("arsenal:trajectory", dots[i], dv);
      }
    }
  });
}

// ---------------------------------------------------------------------------
//  レーダー：壁の向こう・建物の中の mob の影絵
//  Bedrock には壁越しに描く素材がないので、撃ち手の目と mob を結ぶ線の上の「壁より手前」に影絵を置き、
//  距離の比で縮める。画面上は mob の位置と大きさにぴったり重なり、壁にも隠れない（撃ち手にだけ見える）。
//  一人称で覗いているとき用（三人称はカメラが目の位置にないのでずれる）
// ---------------------------------------------------------------------------

const RADAR_RANGE = 64;
const RADAR_MAX = 16;
/** 影絵を置く、目からの最大の距離 */
const NEAR = 2.4;
/** レーダーの走査（明るくなる）間隔 */
const PING = 30;
const SIL_UV = { humanoid: [0, 0], quadruped: [32, 0], flyer: [0, 32], blob: [32, 32] };
const FLYERS = /drone|bat|phantom|bee|parrot|ghast|blaze|vex|allay|wither$/;

/**
 * 目から見て c が壁に隠れているなら、壁より手前の同じ線の上の点と縮める比。見えているなら null
 * @param {import("@minecraft/server").Dimension} dim @param {import("../util/math.js").Vec3} eye @param {import("../util/math.js").Vec3} c
 */
export function nearPoint(dim, eye, c) {
  const v = sub(c, eye);
  const d = len(v);
  if (d < 1.5) return null;
  const dir = { x: v.x / d, y: v.y / d, z: v.z / d };
  const hit = dim.getBlockFromRay(eye, dir, { maxDistance: d, includePassableBlocks: false, includeLiquidBlocks: false });
  if (!hit) return null;
  const bd = dist(eye, hitPoint(hit));
  const dn = Math.max(0.35, Math.min(NEAR, bd - 0.2));
  return { pos: add(eye, { x: dir.x * dn, y: dir.y * dn, z: dir.z * dn }), k: dn / d };
}

/**
 * @param {import("@minecraft/server").Player} player @param {import("../util/math.js").Vec3} eye @param {import("../util/math.js").Vec3} dir
 * @param {string|null} lockedId
 */
function drawRadar(player, eye, dir, lockedId) {
  const now = system.currentTick;
  const dim = player.dimension;
  const list = dim.getEntities({ location: eye, maxDistance: RADAR_RANGE, excludeFamilies: ["inanimate", "arsenal_fx", "projectile"], excludeTypes: ["minecraft:item", "minecraft:xp_orb"] })
    .filter((e) => e.id !== player.id && !!e.getComponent("minecraft:health"))
    .map((e) => ({ e, c: e.getAABB().center }))
    .filter((x) => dot(sub(x.c, eye), dir) > 0)
    .sort((a, b) => dist(a.c, eye) - dist(b.c, eye))
    .slice(0, RADAR_MAX);
  // 走査が通った直後は明るく、だんだん薄く（レーダー風）
  const phase = (now % PING) / PING;
  const alpha = 0.4 + 0.45 * Math.exp(-phase * 4);
  for (const { e, c } of list) {
    const locked = e.id === lockedId;
    const hostile = e.matches({ families: ["monster"] }) || e.matches({ families: ["arsenal_enemy"] });
    const rgb = locked ? [0.35, 1.0, 0.45] : hostile ? [1.0, 0.3, 0.25] : [1.0, 0.85, 0.3];
    silhouette(player, eye, e, c, rgb, locked ? Math.max(alpha, 0.75) : alpha);
  }
}

/**
 * 壁の向こうの相手の影絵を、その人にだけ出す（見えている相手には出さない）。偵察兵のパルススキャン（3.0）も使う
 * @param {import("@minecraft/server").Player} player @param {import("../util/math.js").Vec3} eye @param {import("@minecraft/server").Entity} e
 * @param {import("../util/math.js").Vec3} c @param {number[]} rgb @param {number} alpha
 */
export function silhouette(player, eye, e, c, rgb, alpha) {
  const dim = player.dimension;
  const np = nearPoint(dim, eye, c);
  if (!np) return; // 見えている mob はそのまま見えるので出さない
  const ext = e.getAABB().extent;
  const hw = Math.max(ext.x, ext.z);
  const hh = ext.y;
  const ratio = hh / Math.max(0.05, hw);
  const shape = FLYERS.test(e.typeId) || e.matches({ families: ["arsenal_flying"] }) ? "flyer" : ratio >= 1.4 ? "humanoid" : ratio < 0.9 ? "quadruped" : "blob";
  const v = new MolangVariableMap();
  v.setFloat("variable.hw", hw * np.k * 1.15);
  v.setFloat("variable.hh", hh * np.k * 1.05);
  v.setFloat("variable.u", SIL_UV[shape][0]);
  v.setFloat("variable.v", SIL_UV[shape][1]);
  v.setFloat("variable.r", rgb[0]);
  v.setFloat("variable.g", rgb[1]);
  v.setFloat("variable.b", rgb[2]);
  v.setFloat("variable.a", alpha);
  player.spawnParticle("arsenal:silhouette", np.pos, v);
}

/**
 * ロックの印（壁に隠れていても、レーダーの影絵と同じく手前に置いて見せる）
 * @param {import("@minecraft/server").Player} player @param {import("../util/math.js").Vec3} eye @param {import("../util/math.js").Vec3} center @param {number} locked
 */
function lockMarker(player, eye, center, locked) {
  const v = new MolangVariableMap();
  v.setFloat("variable.locked", locked);
  const np = nearPoint(player.dimension, eye, center);
  if (np) v.setFloat("variable.scale", np.k);
  player.spawnParticle("arsenal:lock_marker", np ? np.pos : center, v);
}

/** 道の途中がふさがれていないか @param {import("@minecraft/server").Dimension} dim @param {import("../util/math.js").Vec3[]} path */
function pathStillOk(dim, path) {
  for (let i = 1; i < path.length; i++) if (!segOk(dim, path[i - 1], path[i])) return false;
  return true;
}

/** 退出したプレイヤーの後始末 @param {string} playerId */
export function forgetPathLock(playerId) {
  const L = locks.get(playerId);
  if (L) cancelSearch(L.search);
  locks.delete(playerId);
}
