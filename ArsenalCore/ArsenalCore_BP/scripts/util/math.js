// @ts-check
/**
 * ベクトル・乱数・幾何ユーティリティ
 * @typedef {{x:number,y:number,z:number}} Vec3
 */

/** @param {Vec3} a @param {Vec3} b @returns {Vec3} */
export const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
/** @param {Vec3} a @param {Vec3} b @returns {Vec3} */
export const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
/** @param {Vec3} a @param {number} s @returns {Vec3} */
export const mul = (a, s) => ({ x: a.x * s, y: a.y * s, z: a.z * s });
/** @param {Vec3} a @param {Vec3} b */
export const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
/** @param {Vec3} a @param {Vec3} b @returns {Vec3} */
export const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
/** @param {Vec3} a */
export const len = (a) => Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
/** @param {Vec3} a @param {Vec3} b */
export const dist = (a, b) => len(sub(a, b));
/** @param {Vec3} a @param {Vec3} b */
export const dist2 = (a, b) => {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
};
/** @param {Vec3} a @returns {Vec3} */
export const norm = (a) => {
  const l = len(a);
  return l < 1e-9 ? { x: 0, y: 1, z: 0 } : { x: a.x / l, y: a.y / l, z: a.z / l };
};
/** @param {Vec3} a @param {Vec3} b @param {number} t @returns {Vec3} */
export const lerpV = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });
/** @param {number} v @param {number} lo @param {number} hi */
export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
/** @param {number} a @param {number} b @param {number} t */
export const lerp = (a, b, t) => a + (b - a) * t;
/** @param {number} lo @param {number} hi */
export const rand = (lo, hi) => lo + Math.random() * (hi - lo);
export const UP = Object.freeze({ x: 0, y: 1, z: 0 });

/** 視線方向から右・上ベクトルを作る @param {Vec3} f */
export function basis(f) {
  let r = cross(f, UP);
  if (len(r) < 1e-4) r = { x: 1, y: 0, z: 0 };
  r = norm(r);
  const u = norm(cross(r, f));
  return { f, r, u };
}

/** @type {Map<string, boolean>} */
const chunkCache = new Map();
let chunkCacheTick = -1;

/**
 * 位置がスクリプトから触れる（読み込み済みのチャンク・ワールドの高さ内）か
 * @param {import("@minecraft/server").Dimension} dim @param {Vec3} p @param {number} tick
 */
export function isLoaded(dim, p, tick) {
  if (!isFinite(p.x) || !isFinite(p.y) || !isFinite(p.z)) return false;
  const hr = /** @type {any} */ (dim).heightRange;
  if (hr && (p.y < hr.min || p.y >= hr.max)) return false;
  if (tick !== chunkCacheTick) {
    chunkCache.clear();
    chunkCacheTick = tick;
  }
  const k = `${dim.id}:${Math.floor(p.x) >> 4},${Math.floor(p.z) >> 4}`;
  let v = chunkCache.get(k);
  if (v === undefined) {
    try {
      v = typeof dim.isChunkLoaded === "function" ? dim.isChunkLoaded({ x: p.x, y: hr ? Math.max(hr.min, Math.min(hr.max - 1, p.y)) : p.y, z: p.z }) : true;
    } catch {
      v = false;
    }
    chunkCache.set(k, v);
  }
  return v;
}

/**
 * レイが読み込み済みの範囲にとどまる最大距離（チャンク境界ごとに確認）
 * @param {import("@minecraft/server").Dimension} dim @param {Vec3} o @param {Vec3} d @param {number} max @param {number} tick
 */
export function loadedReach(dim, o, d, max, tick) {
  if (!isLoaded(dim, o, tick)) return 0;
  const step = 8;
  for (let t = step; t < max + step; t += step) {
    const tt = Math.min(t, max);
    if (!isLoaded(dim, { x: o.x + d.x * tt, y: o.y + d.y * tt, z: o.z + d.z * tt }, tick)) {
      return Math.max(0, tt - step);
    }
    if (tt >= max) break;
  }
  return max;
}

/** 正規分布（Box-Muller）*/
export function gauss() {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

/**
 * 円錐内のランダム方向（spreadDeg はおよそ 2σ の半角）
 * @param {Vec3} dir @param {number} spreadDeg @returns {Vec3}
 */
export function cone(dir, spreadDeg) {
  if (spreadDeg <= 0.0001) return dir;
  const { r, u } = basis(dir);
  const s = Math.tan((spreadDeg * Math.PI) / 180) * 0.5;
  const a = clamp(gauss(), -2.2, 2.2) * s;
  const b = clamp(gauss(), -2.2, 2.2) * s;
  return norm(add(dir, add(mul(r, a), mul(u, b))));
}

/** 回転（ピッチ・ヨー、度）→ 方向ベクトル @param {number} pitch @param {number} yaw @returns {Vec3} */
export function dirFromRot(pitch, yaw) {
  const p = (pitch * Math.PI) / 180;
  const y = (yaw * Math.PI) / 180;
  return { x: -Math.sin(y) * Math.cos(p), y: -Math.sin(p), z: Math.cos(y) * Math.cos(p) };
}

/** 方向ベクトル → { pitch, yaw }（度）@param {Vec3} d */
export function rotFromDir(d) {
  const n = norm(d);
  const pitch = (-Math.asin(clamp(n.y, -1, 1)) * 180) / Math.PI;
  const yaw = (Math.atan2(-n.x, n.z) * 180) / Math.PI;
  return { pitch, yaw };
}

/**
 * 単位立方体（ブロック）からレイが抜ける点。
 * @param {Vec3} blockLoc ブロックの最小角 @param {Vec3} o レイ始点 @param {Vec3} d 方向（正規化済み）
 * @returns {{point: Vec3, t: number}}
 */
export function rayExitBlock(blockLoc, o, d) {
  let tExit = Infinity;
  for (const k of /** @type {("x"|"y"|"z")[]} */ (["x", "y", "z"])) {
    const dk = d[k];
    if (Math.abs(dk) < 1e-9) continue;
    const lo = blockLoc[k];
    const hi = lo + 1;
    const t1 = (lo - o[k]) / dk;
    const t2 = (hi - o[k]) / dk;
    const tf = Math.max(t1, t2);
    if (tf < tExit) tExit = tf;
  }
  if (!isFinite(tExit) || tExit < 0) tExit = 1.0;
  return { point: add(o, mul(d, tExit)), t: tExit };
}

/** @param {number} n */
export const round1 = (n) => Math.round(n * 10) / 10;

/** @param {Vec3} v */
export const fmtVec = (v) => `${v.x.toFixed(1)},${v.y.toFixed(1)},${v.z.toFixed(1)}`;

/** 面方向 → 法線 @param {string} face @returns {Vec3} */
export function faceNormal(face) {
  switch (face) {
    case "Up": return { x: 0, y: 1, z: 0 };
    case "Down": return { x: 0, y: -1, z: 0 };
    case "North": return { x: 0, y: 0, z: -1 };
    case "South": return { x: 0, y: 0, z: 1 };
    case "East": return { x: 1, y: 0, z: 0 };
    case "West": return { x: -1, y: 0, z: 0 };
    default: return { x: 0, y: 1, z: 0 };
  }
}

/** @template T @param {T[]} arr @returns {T} */
export function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
