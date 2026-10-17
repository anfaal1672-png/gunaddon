// @ts-check
/**
 * 経路探索（アリアドネのミサイル用）：ブロック 1 マスを 1 マスとする 3D の A*。
 *
 * ミサイルはほかのロケットと同じく「点」として飛び、毎 tick のレイ判定でぶつかる（すり抜けない）。
 * ここで探すのは、その点が実際に通れるマスをつないだ道だけ：
 *  - 空気・草花・液体など、弾が止まらないブロックのマス … 通れる
 *  - 扉・トラップドア・フェンスゲート … 開いていて通れるかを、隣のマスの中心から中心へのレイで確かめる
 *  - それ以外のブロック・読み込まれていないマス・高さの範囲外 … 通れない
 * つまり 1 マスの穴・窓・開いた扉があれば、壁の向こうや建物の中まで道がつながる。
 *
 * 隣り合う 6 方向のマスで探し（斜めにすり抜けない）、見つかった道は「両脇に余裕のある直線」でつないで滑らかにする。
 * 探索は 1 tick あたりの展開数の予算（全員の探索で共有）の中で少しずつ進める。
 */
import { world, system, LiquidType } from "@minecraft/server";
import { add, sub, mul, len, dist, isLoaded } from "../util/math.js";

const OPEN = 0;
const SOLID = 1;
const GATE = 2;
/** マスの判定を覚えておく tick 数（ブロックが変わることがあるので短め） */
const CACHE_TTL = 40;
/** 1 tick に展開するマスの数（全員の探索の合計） */
export const PF_BUDGET = 600;
/** 1 回の探索で展開するマスの上限 */
const MAX_EXPAND = 12000;
/** 重み付き A*（1 より大きいと速いが最短ではなくなる。直線化するので問題ない） */
const H_WEIGHT = 1.4;
/** 直線化の余裕（ブロックの角・縁をかすめる線を使わない） */
const MARGIN = 0.1;
const GATE_RE = /door|fence_gate/;

/** 統計（負荷の確認用） */
export const pfStats = { blocks: 0, expanded: 0, searches: 0 };

/**
 * 弾が止まるブロックか（草花・たいまつ・光源ブロック・液体などはすり抜ける）
 * @param {import("@minecraft/server").Block|undefined} b
 */
export function isSolidBlock(b) {
  if (!b || b.isAir || b.isLiquid) return false;
  const id = b.typeId;
  if (id.startsWith("minecraft:light_block") || id === "minecraft:fire" || id === "minecraft:soul_fire" || id === "minecraft:structure_void") return false;
  try {
    if (b.canBeDestroyedByLiquidSpread(LiquidType.Water)) return false;
  } catch {
    /* 判定できないときは固体扱い */
  }
  return true;
}

/** @type {Map<string, Map<string, {v:number, t:number}>>} */
const cellCache = new Map();
/** @type {Map<string, Map<string, {v:boolean, t:number}>>} */
const gateCache = new Map();

/** @param {Map<string, any>} root @param {string} id */
function sub_(root, id) {
  let m = root.get(id);
  if (!m) {
    m = new Map();
    root.set(id, m);
  }
  return m;
}

/**
 * マスの状態
 * @param {import("@minecraft/server").Dimension} dim @param {number} x @param {number} y @param {number} z
 */
function cell(dim, x, y, z) {
  const now = system.currentTick;
  const m = sub_(cellCache, dim.id);
  const k = x + "," + y + "," + z;
  const c = m.get(k);
  if (c && now - c.t <= CACHE_TTL) return c.v;
  if (m.size > 80000) m.clear();
  let v = SOLID;
  const p = { x, y, z };
  if (isLoaded(dim, p, now)) {
    try {
      const b = dim.getBlock(p);
      if (b) v = !isSolidBlock(b) ? OPEN : GATE_RE.test(b.typeId) ? GATE : SOLID;
    } catch {
      v = SOLID;
    }
  }
  pfStats.blocks++;
  m.set(k, { v, t: now });
  return v;
}

/**
 * 扉などのマスを含む 1 歩：マスの中心から中心へのレイが何にも当たらなければ通れる
 * @param {import("@minecraft/server").Dimension} dim
 * @param {number} ax @param {number} ay @param {number} az @param {number} bx @param {number} by @param {number} bz
 */
function gatePass(dim, ax, ay, az, bx, by, bz) {
  const now = system.currentTick;
  const m = sub_(gateCache, dim.id);
  const k = `${ax},${ay},${az}>${bx},${by},${bz}`;
  const c = m.get(k);
  if (c && now - c.t <= CACHE_TTL) return c.v;
  if (m.size > 20000) m.clear();
  let v = false;
  try {
    const from = { x: ax + 0.5, y: ay + 0.5, z: az + 0.5 };
    const d = { x: bx - ax, y: by - ay, z: bz - az };
    v = !dim.getBlockFromRay(from, d, { maxDistance: 1, includePassableBlocks: false, includeLiquidBlocks: false });
  } catch {
    v = false;
  }
  m.set(k, { v, t: now });
  return v;
}

/**
 * 隣のマスへ 1 歩進めるか
 * @param {import("@minecraft/server").Dimension} dim
 * @param {number} ax @param {number} ay @param {number} az @param {number} bx @param {number} by @param {number} bz
 */
function canStep(dim, ax, ay, az, bx, by, bz) {
  const vb = cell(dim, bx, by, bz);
  if (vb === SOLID) return false;
  const va = cell(dim, ax, ay, az);
  if (va === SOLID) return false;
  if (va === GATE || vb === GATE) return gatePass(dim, ax, ay, az, bx, by, bz);
  return true;
}

/**
 * 直線 a→b が、両脇に余裕を持って通れるマスだけを通るか（扉のマスは通らない）
 * @param {import("@minecraft/server").Dimension} dim @param {import("../util/math.js").Vec3} a @param {import("../util/math.js").Vec3} b
 */
export function segClear(dim, a, b) {
  const L = dist(a, b);
  const n = Math.max(1, Math.ceil(L / 0.25));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const px = a.x + (b.x - a.x) * t, py = a.y + (b.y - a.y) * t, pz = a.z + (b.z - a.z) * t;
    // 8 隅（同じマスは 1 回だけ調べる）
    let last = "";
    for (let c = 0; c < 8; c++) {
      const x = Math.floor(px + (c & 1 ? MARGIN : -MARGIN));
      const y = Math.floor(py + (c & 2 ? MARGIN : -MARGIN));
      const z = Math.floor(pz + (c & 4 ? MARGIN : -MARGIN));
      const k = x + "," + y + "," + z;
      if (k === last) continue;
      last = k;
      if (cell(dim, x, y, z) !== OPEN) return false;
    }
  }
  return true;
}

/**
 * 区間 a→b が今も通れるか（経路の確かめ直し・ミサイルの次の区間）
 * 同じマスの中・隣のマスへの軸に沿った 1 歩・余裕のある直線 のどれか
 * @param {import("@minecraft/server").Dimension} dim @param {import("../util/math.js").Vec3} a @param {import("../util/math.js").Vec3} b
 */
export function segOk(dim, a, b) {
  const ax = Math.floor(a.x), ay = Math.floor(a.y), az = Math.floor(a.z);
  const bx = Math.floor(b.x), by = Math.floor(b.y), bz = Math.floor(b.z);
  const md = Math.abs(ax - bx) + Math.abs(ay - by) + Math.abs(az - bz);
  if (md === 0) return cell(dim, ax, ay, az) !== SOLID;
  if (md === 1) {
    // 軸に沿った 1 歩（扉のマスを含む）
    const axisOk = (ax !== bx ? Math.abs(a.y - b.y) + Math.abs(a.z - b.z) : ay !== by ? Math.abs(a.x - b.x) + Math.abs(a.z - b.z) : Math.abs(a.x - b.x) + Math.abs(a.y - b.y)) < 1e-6;
    if (axisOk) return canStep(dim, ax, ay, az, bx, by, bz);
  }
  return segClear(dim, a, b);
}

// ---------------------------------------------------------------------------
//  探索
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} PNode
 * @property {number} x @property {number} y @property {number} z
 * @property {number} g @property {number} f
 * @property {PNode|null} parent
 * @property {boolean} closed
 */

/**
 * @typedef {Object} Search
 * @property {import("@minecraft/server").Dimension} dim
 * @property {"run"|"ok"|"fail"} state
 * @property {import("../util/math.js").Vec3[]|null} path 見つかった道（始点 … 目標の点）
 * @property {import("../util/math.js").Vec3} from
 * @property {import("../util/math.js").Vec3} goal
 * @property {Set<string>} goals 目標の体が重なるマス
 * @property {Map<string, PNode>} nodes
 * @property {PNode[]} heap
 * @property {number} expanded
 * @property {number} maxRange
 * @property {number} maxLen
 */

/** @type {Set<Search>} */
const active = new Set();

/**
 * 探索を始める（結果は tickPathfinding の中で少しずつ出る）
 * @param {import("@minecraft/server").Dimension} dim @param {import("../util/math.js").Vec3} from
 * @param {{min:import("../util/math.js").Vec3, max:import("../util/math.js").Vec3}} box 目標の体（当たり判定）
 * @param {import("../util/math.js").Vec3} goal 目標の点（体の中心）
 * @param {{maxRange?:number, maxLen?:number}} [o]
 * @returns {Search}
 */
export function startSearch(dim, from, box, goal, o = {}) {
  pfStats.searches++;
  /** @type {Search} */
  const s = {
    dim, state: "run", path: null, from: { ...from }, goal: { ...goal }, goals: new Set(), nodes: new Map(), heap: [], expanded: 0,
    maxRange: o.maxRange ?? 110, maxLen: o.maxLen ?? 180,
  };
  const e = 0.05;
  for (let x = Math.floor(box.min.x + e); x <= Math.floor(box.max.x - e); x++) {
    for (let y = Math.floor(box.min.y + e); y <= Math.floor(box.max.y - e); y++) {
      for (let z = Math.floor(box.min.z + e); z <= Math.floor(box.max.z - e); z++) s.goals.add(x + "," + y + "," + z);
    }
  }
  const sx = Math.floor(from.x), sy = Math.floor(from.y), sz = Math.floor(from.z);
  if (cell(dim, sx, sy, sz) === SOLID || !s.goals.size) {
    s.state = "fail";
    return s;
  }
  /** @type {PNode} */
  const n0 = { x: sx, y: sy, z: sz, g: 0, f: 0, parent: null, closed: false };
  n0.f = heur(s, n0);
  s.nodes.set(sx + "," + sy + "," + sz, n0);
  heapPush(s.heap, n0);
  active.add(s);
  return s;
}

/** 探索をやめる @param {Search|null|undefined} s */
export function cancelSearch(s) {
  if (!s) return;
  if (s.state === "run") s.state = "fail";
  active.delete(s);
}

/** @param {Search} s @param {{x:number,y:number,z:number}} n */
function heur(s, n) {
  const dx = n.x + 0.5 - s.goal.x, dy = n.y + 0.5 - s.goal.y, dz = n.z + 0.5 - s.goal.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz) * H_WEIGHT;
}

const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

/**
 * 探索を budget マスぶん進める
 * @param {Search} s @param {number} budget
 * @returns {number} 使った展開数
 */
export function stepSearch(s, budget) {
  let used = 0;
  const { dim } = s;
  while (s.state === "run" && used < budget) {
    const cur = heapPop(s.heap);
    if (!cur) {
      s.state = "fail";
      break;
    }
    if (cur.closed) continue;
    cur.closed = true;
    used++;
    s.expanded++;
    pfStats.expanded++;
    if (s.goals.has(cur.x + "," + cur.y + "," + cur.z)) {
      s.path = finish(s, cur);
      s.state = "ok";
      break;
    }
    if (s.expanded >= MAX_EXPAND) {
      s.state = "fail";
      break;
    }
    for (const [dx, dy, dz] of DIRS) {
      const nx = cur.x + dx, ny = cur.y + dy, nz = cur.z + dz;
      const k = nx + "," + ny + "," + nz;
      let nb = s.nodes.get(k);
      if (nb && nb.closed) continue;
      const g = cur.g + 1;
      if (g > s.maxLen) continue;
      if (nb && g >= nb.g) continue;
      const rx = nx + 0.5 - s.from.x, ry = ny + 0.5 - s.from.y, rz = nz + 0.5 - s.from.z;
      if (rx * rx + ry * ry + rz * rz > s.maxRange * s.maxRange) continue;
      if (!canStep(dim, cur.x, cur.y, cur.z, nx, ny, nz)) continue;
      if (!nb) {
        nb = { x: nx, y: ny, z: nz, g, f: 0, parent: cur, closed: false };
        s.nodes.set(k, nb);
      } else {
        nb.g = g;
        nb.parent = cur;
      }
      nb.f = g + heur(s, nb);
      heapPush(s.heap, nb);
    }
  }
  if (s.state !== "run") {
    active.delete(s);
    s.nodes = new Map();
    s.heap = [];
  }
  return used;
}

/**
 * 見つかったマスの列 → 道（始点・マスの中心・目標の点）を直線化
 * @param {Search} s @param {PNode} end
 */
function finish(s, end) {
  /** @type {import("../util/math.js").Vec3[]} */
  const cells = [];
  for (let n = /** @type {PNode|null} */ (end); n; n = n.parent) cells.push({ x: n.x + 0.5, y: n.y + 0.5, z: n.z + 0.5 });
  cells.reverse();
  /** @type {import("../util/math.js").Vec3[]} */
  const pts = [s.from, ...cells];
  // 目標の点（体の中心）まで余裕を持って届くなら、最後をそこへ
  if (segClear(s.dim, cells[cells.length - 1], s.goal)) pts.push(s.goal);
  return smooth(s.dim, pts);
}

/**
 * 直線化：i から、余裕のある直線でつなげる限り先の点へ（隣どうしの点はもともと通れる）
 * @param {import("@minecraft/server").Dimension} dim @param {import("../util/math.js").Vec3[]} pts
 */
export function smooth(dim, pts) {
  if (pts.length <= 2) return pts;
  const out = [pts[0]];
  let i = 0;
  while (i < pts.length - 1) {
    let j = i + 1;
    while (j + 1 < pts.length && segClear(dim, pts[i], pts[j + 1])) j++;
    out.push(pts[j]);
    i = j;
  }
  return out;
}

/** 道の長さ @param {import("../util/math.js").Vec3[]} path */
export function pathLength(path) {
  let L = 0;
  for (let i = 1; i < path.length; i++) L += dist(path[i - 1], path[i]);
  return L;
}

/**
 * 道の上に点を並べる（表示用）
 * @param {import("../util/math.js").Vec3[]} path @param {number} step @param {number} max
 */
export function samplePath(path, step, max) {
  /** @type {import("../util/math.js").Vec3[]} */
  const out = [];
  let next = 0;
  let acc = 0;
  for (let i = 1; i < path.length && out.length < max; i++) {
    const a = path[i - 1];
    const v = sub(path[i], a);
    const L = len(v);
    while (next <= acc + L && out.length < max) {
      out.push(add(a, mul(v, L > 1e-6 ? (next - acc) / L : 0)));
      next += step;
    }
    acc += L;
  }
  return out;
}

/**
 * マスの判定を忘れる（ブロックが置かれた・壊れた・ミサイルが思わぬブロックに当たった）
 * @param {import("@minecraft/server").Dimension} dim @param {import("../util/math.js").Vec3} loc
 */
export function invalidateCell(dim, loc) {
  const x = Math.floor(loc.x), y = Math.floor(loc.y), z = Math.floor(loc.z);
  cellCache.get(dim.id)?.delete(x + "," + y + "," + z);
  const g = gateCache.get(dim.id);
  if (g && g.size) {
    const k = x + "," + y + "," + z;
    for (const key of [...g.keys()]) if (key.startsWith(k + ">") || key.endsWith(">" + k)) g.delete(key);
  }
}

/** ブロックの変化でマスの判定を忘れる */
export function attachPathfinding() {
  world.afterEvents.playerPlaceBlock.subscribe((ev) => invalidateCell(ev.block.dimension, ev.block.location));
  world.afterEvents.playerBreakBlock.subscribe((ev) => invalidateCell(ev.block.dimension, ev.block.location));
  world.afterEvents.blockExplode.subscribe((ev) => invalidateCell(ev.dimension, ev.block.location));
  world.afterEvents.playerInteractWithBlock.subscribe((ev) => invalidateCell(ev.block.dimension, ev.block.location)); // 扉の開け閉め
}

/** 毎 tick：予算の中で各探索を進める */
export function tickPathfinding() {
  if (!active.size) return;
  let budget = PF_BUDGET;
  const list = [...active];
  const per = Math.max(60, Math.floor(PF_BUDGET / list.length));
  for (const s of list) {
    if (budget <= 0) break;
    if (s.state !== "run") {
      active.delete(s);
      continue;
    }
    budget -= stepSearch(s, Math.min(per, budget));
  }
  // 公平に：使い終わったものを後ろへ
  for (const s of list) {
    if (active.has(s)) {
      active.delete(s);
      active.add(s);
    }
  }
}

/** 進行中の探索の数（報告用） */
export function activeSearches() {
  return active.size;
}

// ---------------------------------------------------------------------------
//  二分ヒープ（f の小さい順）
// ---------------------------------------------------------------------------

/** @param {PNode[]} h @param {PNode} n */
function heapPush(h, n) {
  h.push(n);
  let i = h.length - 1;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (h[p].f <= h[i].f) break;
    [h[p], h[i]] = [h[i], h[p]];
    i = p;
  }
}

/** @param {PNode[]} h */
function heapPop(h) {
  if (!h.length) return undefined;
  const top = h[0];
  const last = /** @type {PNode} */ (h.pop());
  if (h.length) {
    h[0] = last;
    let i = 0;
    for (;;) {
      const l = i * 2 + 1, r = l + 1;
      let m = i;
      if (l < h.length && h[l].f < h[m].f) m = l;
      if (r < h.length && h[r].f < h[m].f) m = r;
      if (m === i) break;
      [h[m], h[i]] = [h[i], h[m]];
      i = m;
    }
  }
  return top;
}
