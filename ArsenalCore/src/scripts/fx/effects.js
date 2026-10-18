// @ts-check
/**
 * 演出（パーティクル・効果音）。受け手ごとの設定（演出品質・血しぶき・音量）を反映するため、
 * 近くのプレイヤーそれぞれに個別送信する。
 */
import { MolangVariableMap, system, world } from "@minecraft/server";
import { P } from "../core/settings.js";
import { DATA, FAR_SOUND_SETS } from "../config/constants.js";
import { add, mul, basis, dist, rand } from "../util/math.js";
import { safe } from "../util/log.js";

const Q = { low: 0, medium: 1, high: 2 };

/**
 * 受け手の演出品質。「自動」はスマホなら中、それ以外は高
 * @param {import("@minecraft/server").Player} p
 */
export function quality(p) {
  const q = P(p).fxQuality;
  if (q === "auto" || q === undefined) {
    const mobile = safe("fx.platform", () => /** @type {any} */ (p).clientSystemInfo?.platformType === "Mobile") ?? false;
    return mobile ? 1 : 2;
  }
  return /** @type {any} */ (Q)[q] ?? 2;
}

/**
 * 受け手の一覧（tick ごとに 1 回だけ作る）。パーティクル 1 つ・音 1 つごとに getPlayers を呼んでいた
 * （照射ビームは 1 発で数十個のパーティクルを出す）のをやめ、ここで距離を比べる
 * @typedef {{p:import("@minecraft/server").Player, id:string, x:number, y:number, z:number, q:number, blood:boolean}} Recv
 */
let recvTick = -1;
/** @type {Map<string, Recv[]>} */
const recvByDim = new Map();

/** @param {import("@minecraft/server").Dimension} dim @returns {Recv[]} */
function receivers(dim) {
  const now = system.currentTick;
  if (now !== recvTick) {
    recvTick = now;
    recvByDim.clear();
    for (const p of world.getAllPlayers()) {
      const l = safe("fx.recv", () => (p.isValid ? p.location : undefined));
      if (!l) continue;
      const did = p.dimension.id;
      let arr = recvByDim.get(did);
      if (!arr) recvByDim.set(did, (arr = []));
      arr.push({ p, id: p.id, x: l.x, y: l.y, z: l.z, q: quality(p), blood: P(p).blood });
    }
  }
  return recvByDim.get(dim.id) ?? [];
}

/**
 * 範囲内の受け手
 * @param {import("@minecraft/server").Dimension} dim @param {import("../util/math.js").Vec3} loc @param {number} range
 */
export function receiversNear(dim, loc, range) {
  const r2 = range * range;
  return receivers(dim).filter((r) => {
    const dx = r.x - loc.x, dy = r.y - loc.y, dz = r.z - loc.z;
    return dx * dx + dy * dy + dz * dz <= r2;
  });
}

/**
 * 近くのプレイヤーへパーティクルを送る
 * @param {import("@minecraft/server").Dimension} dim
 * @param {string} id
 * @param {import("../util/math.js").Vec3} loc
 * @param {MolangVariableMap | undefined} vars
 * @param {{range?:number, minQ?:number, blood?:boolean, except?:string, near?:number}} [opt] near … これより遠い受け手には高品質のときだけ送る
 */
export function emit(dim, id, loc, vars, opt = {}) {
  const range = opt.range ?? 64;
  const minQ = opt.minQ ?? 0;
  const near2 = opt.near !== undefined ? opt.near * opt.near : Infinity;
  safe("fx.emit", () => {
    for (const r of receiversNear(dim, loc, range)) {
      if (opt.except && r.id === opt.except) continue;
      if (minQ > r.q) continue;
      if (near2 < Infinity && r.q < 2 && (r.x - loc.x) ** 2 + (r.y - loc.y) ** 2 + (r.z - loc.z) ** 2 > near2) continue;
      if (opt.blood && !r.blood) continue;
      try {
        r.p.spawnParticle(id, loc, vars);
      } catch {
        /* チャンク未ロード等 */
      }
    }
  });
}

/**
 * プレイヤーに音を鳴らす（個人音量を反映）
 * @param {import("@minecraft/server").Player} p @param {string} sound
 * @param {{location?: import("../util/math.js").Vec3, volume?: number, pitch?: number}} [o]
 */
export function playTo(p, sound, o = {}) {
  safe("fx.playTo", () => {
    const v = (o.volume ?? 1) * P(p).volume;
    if (v <= 0.001) return;
    p.playSound(sound, { location: o.location, volume: v, pitch: o.pitch ?? 1 });
  });
}

/**
 * 周囲に効果音
 * @param {import("@minecraft/server").Dimension} dim @param {import("../util/math.js").Vec3} loc @param {string} sound
 * @param {{range?:number, volume?:number, pitch?:number}} [o]
 */
export function playNear(dim, loc, sound, o = {}) {
  const range = o.range ?? 32;
  safe("fx.playNear", () => {
    for (const r of receiversNear(dim, loc, range)) {
      playTo(r.p, sound, { location: loc, volume: o.volume ?? 1, pitch: o.pitch ?? 1 });
    }
  });
}

/**
 * 射撃音：近距離層と遠距離層
 * @param {import("@minecraft/server").Entity} shooter @param {any} st @param {import("../util/math.js").Vec3} loc
 */
export function gunshot(shooter, st, loc) {
  const set = st.sound;
  const suppressed = st.suppressed;
  const nearR = suppressed ? 20 : 64;
  const farR = suppressed ? 0 : 220;
  const pitch = st.pitch * rand(0.96, 1.04);
  safe("fx.gunshot", () => {
    const dim = shooter.dimension;
    // 屋内（天井と 2 方向以上の壁）では、短く密な残響の音（arsenal.in.*）を使い、遠くへはこもって届く
    const indoor = !suppressed && FAR_SOUND_SETS.has(set) && isIndoor(dim, loc, shooter.id);
    const now = system.currentTick;
    for (const r of receiversNear(dim, loc, Math.max(nearR, farR))) {
      const p = r.p;
      const d = Math.hypot(r.x - loc.x, r.y - loc.y, r.z - loc.z);
      // 遠くの連射は 3 tick に 1 回だけ届ける（遠くでは 1 発ずつは聞き分けられない。音の送信を減らす）
      if (d > nearR) {
        const k = `${p.id}|${shooter.id}`;
        if (now - (farGate.get(k) ?? -99) < 3) continue;
        farGate.set(k, now);
        if (farGate.size > 512) farGate.clear();
      }
      if (d <= nearR) {
        playTo(p, indoor ? `arsenal.in.${set}` : `arsenal.fire.${set}`, { location: loc, volume: p.id === shooter.id ? 0.9 : 1.0, pitch });
      }
      if (farR > 0 && d > 24 && FAR_SOUND_SETS.has(set)) {
        const v = Math.max(0.15, 1 - (d - 24) / farR) * (indoor ? 0.6 : 1);
        // 音は 1 tick に約 17 ブロック（音速 343 m/s）しか進まない：遠いほど遅れて聞こえる
        const delay = Math.floor(d / 17);
        if (delay <= 0) playTo(p, `arsenal.far.${set}`, { location: loc, volume: v, pitch });
        else system.runTimeout(() => safe("fx.farshot", () => { if (p.isValid) playTo(p, `arsenal.far.${set}`, { location: loc, volume: v, pitch }); }), delay);
      }
    }
  });
}

/** 遠くの射撃音を最後に届けた tick（受け手|撃ち手） @type {Map<string, number>} */
const farGate = new Map();

/** 屋内判定のキャッシュ（撃った者ごと、2 秒・2 ブロック以内なら使い回す） @type {Map<string, {tick:number, x:number, y:number, z:number, v:boolean}>} */
const indoorCache = new Map();

/**
 * 屋内か：真上 8 ブロック以内に天井があり、水平 4 方向のうち 2 方向以上で 6 ブロック以内に壁がある
 * @param {import("@minecraft/server").Dimension} dim @param {import("../util/math.js").Vec3} loc @param {string} key
 */
export function isIndoor(dim, loc, key) {
  const now = system.currentTick;
  const c = indoorCache.get(key);
  if (c && now - c.tick < 40 && Math.abs(c.x - loc.x) + Math.abs(c.y - loc.y) + Math.abs(c.z - loc.z) < 2) return c.v;
  const opt = { maxDistance: 8, includePassableBlocks: false, includeLiquidBlocks: false };
  let v = false;
  if (safe("indoor.up", () => dim.getBlockFromRay(loc, { x: 0, y: 1, z: 0 }, opt))) {
    let walls = 0;
    const o2 = { ...opt, maxDistance: 6 };
    for (const d of [{ x: 1, y: 0, z: 0 }, { x: -1, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: -1 }]) {
      if (safe("indoor.wall", () => dim.getBlockFromRay(loc, d, o2))) walls++;
    }
    v = walls >= 2;
  }
  if (indoorCache.size > 256) indoorCache.clear();
  indoorCache.set(key, { tick: now, x: loc.x, y: loc.y, z: loc.z, v });
  return v;
}

/**
 * マズル位置
 * @param {import("@minecraft/server").Player} player @param {boolean} ads
 */
export function muzzlePos(player, ads) {
  const eye = player.getHeadLocation();
  const { f, r, u } = basis(player.getViewDirection());
  if (ads) return add(add(eye, mul(f, 0.85)), mul(u, -0.1));
  return add(add(add(eye, mul(f, 0.95)), mul(r, 0.28)), mul(u, -0.2));
}

/**
 * マズルフラッシュ・硝煙・薬莢
 * @param {import("@minecraft/server").Player} player @param {any} st @param {import("../util/math.js").Vec3} muzzle @param {string|null} casing
 */
export function muzzleFx(player, st, muzzle, casing) {
  const dim = player.dimension;
  if (st.flash) {
    const v = new MolangVariableMap();
    v.setFloat("variable.size", st.cat === "lmg" || st.cat === "battle" || st.cat === "sniper" ? 0.36 : st.cat === "handgun" ? 0.2 : 0.28);
    emit(dim, "arsenal:muzzle_flash", muzzle, v, { range: 96, near: 48 });
  }
  emit(dim, "arsenal:muzzle_smoke", muzzle, undefined, { range: 40, minQ: 1 });
  if (casing) {
    const { f, r, u } = basis(player.getViewDirection());
    const at = add(add(player.getHeadLocation(), mul(f, 0.55)), add(mul(r, 0.22), mul(u, -0.12)));
    const v = new MolangVariableMap();
    const dir = add(add(mul(r, 1), mul(u, 0.8)), mul(f, -0.2));
    v.setSpeedAndDirection("variable.eject", rand(2.2, 3.2), dir);
    emit(dim, casing === "shell" ? "arsenal:shell_casing" : "arsenal:casing", at, v, { range: 24, minQ: 1 });
  }
}

/** 曳光の通し番号（間引きに使う） */
let tracerSeq = 0;

/**
 * 曳光弾：飛んでいく光の筋（加算合成で光る）＋弾道に一瞬残る細い線
 * @param {import("@minecraft/server").Dimension} dim @param {import("../util/math.js").Vec3} from @param {import("../util/math.js").Vec3} to
 * @param {{r:number,g:number,b:number}} color @param {number} [width] @param {string} [except] @param {number} [key] 同じ弾の続きの番号（間引きをそろえる）
 */
export function tracer(dim, from, to, color, width = 0.05, except, key) {
  const d = dist(from, to);
  if (d < 1.2) return;
  // 受け手の演出品質で間引く：高はすべて、中は 2 本に 1 本、低は 4 本に 1 本（同じ弾の続きは key でそろえる）
  const k = key ?? tracerSeq++;
  const minQ = k % 4 === 0 ? 0 : k % 2 === 0 ? 1 : 2;
  // 速すぎると 1 フレームで通り過ぎて見えないので、見やすい速さに抑える
  const speed = Math.min(150, Math.max(70, d * 2.2));
  const v = new MolangVariableMap();
  const dir = mul({ x: to.x - from.x, y: to.y - from.y, z: to.z - from.z }, 1 / d);
  v.setSpeedAndDirection("variable.tracer", speed, dir);
  v.setFloat("variable.life", d / speed);
  v.setFloat("variable.width", width);
  v.setFloat("variable.len", d * 0.5);
  v.setColorRGB("variable.color", { red: color.r, green: color.g, blue: color.b });
  emit(dim, "arsenal:tracer", from, v, { range: 96, except, minQ });
  const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2, z: (from.z + to.z) / 2 };
  // 尾は高品質の受け手で、近いときだけ
  emit(dim, "arsenal:tracer_trail", mid, v, { range: 64, minQ: 2 });
}

/** @param {string} typeId */
function impactColor(typeId) {
  const id = typeId.replace("minecraft:", "");
  for (const e of DATA.IMPACT_COLORS) {
    if (e.match.some((m) => id.includes(m))) return e.color;
  }
  return DATA.IMPACT_DEFAULT;
}

/**
 * 着弾（ブロック）
 * @param {import("@minecraft/server").Dimension} dim @param {import("../util/math.js").Vec3} point
 * @param {import("../util/math.js").Vec3} normal @param {string} blockType @param {boolean} [metalSpark]
 */
export function impactBlock(dim, point, normal, blockType, metalSpark = false) {
  const c = impactColor(blockType);
  const v = new MolangVariableMap();
  v.setColorRGB("variable.color", { red: c[0] / 255, green: c[1] / 255, blue: c[2] / 255 });
  v.setVector3("variable.normal", normal);
  v.setFloat("variable.count", 3);
  const p = add(point, mul(normal, 0.03));
  emit(dim, "arsenal:impact_debris", p, v, { range: 48 });
  emit(dim, "arsenal:impact_dust", p, v, { range: 48, minQ: 1 });
  if (metalSpark || /iron|gold|copper|stone|deepslate|anvil|bars|chain/.test(blockType)) {
    emit(dim, "arsenal:impact_spark", p, undefined, { range: 48, minQ: 1 });
  }
}

/** 被弾（生物） @param {import("@minecraft/server").Dimension} dim @param {import("../util/math.js").Vec3} point @param {boolean} flesh */
export function impactEntity(dim, point, flesh) {
  if (flesh) emit(dim, "arsenal:blood", point, undefined, { range: 40, blood: true });
  else emit(dim, "arsenal:impact_spark", point, undefined, { range: 40 });
}

/** 爆発演出 @param {import("@minecraft/server").Dimension} dim @param {import("../util/math.js").Vec3} loc @param {number} power */
export function explosionFx(dim, loc, power) {
  const v = new MolangVariableMap();
  v.setFloat("variable.power", power);
  emit(dim, "arsenal:explosion", loc, v, { range: 160 });
  emit(dim, "arsenal:explosion_smoke", loc, v, { range: 160, minQ: 1 });
  safe("fx.explosionSound", () => {
    for (const p of dim.getPlayers({ location: loc, maxDistance: 320 })) {
      const d = dist(p.location, loc);
      if (d < 72) playTo(p, "arsenal.fx.explosion", { location: loc, volume: 1.0, pitch: rand(0.9, 1.05) });
      else playTo(p, "arsenal.fx.explosion_far", { location: loc, volume: Math.max(0.2, 1 - d / 320) });
      // 近くのプレイヤーは画面が揺れる
      if (d < power * 6 && P(p).cameraShake) {
        try {
          p.camera.addShake({ intensity: Math.min(0.6, (1 - d / (power * 6)) * 0.5), duration: 0.5, type: /** @type {any} */ ("Positional") });
        } catch {
          /* noop */
        }
      }
    }
  });
}
