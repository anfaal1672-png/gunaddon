// @ts-check
/**
 * 演出（パーティクル・効果音）。受け手ごとの設定（演出品質・血しぶき・音量）を反映するため、
 * 近くのプレイヤーそれぞれに個別送信する。
 */
import { MolangVariableMap } from "@minecraft/server";
import { P } from "../core/settings.js";
import { DATA, FAR_SOUND_SETS } from "../config/constants.js";
import { add, mul, basis, dist, rand } from "../util/math.js";
import { safe } from "../util/log.js";

const Q = { low: 0, medium: 1, high: 2 };

/** @param {import("@minecraft/server").Player} p */
function quality(p) {
  return /** @type {any} */ (Q)[P(p).fxQuality] ?? 2;
}

/**
 * 近くのプレイヤーへパーティクルを送る
 * @param {import("@minecraft/server").Dimension} dim
 * @param {string} id
 * @param {import("../util/math.js").Vec3} loc
 * @param {MolangVariableMap | undefined} vars
 * @param {{range?:number, minQ?:number, blood?:boolean, except?:string}} [opt]
 */
export function emit(dim, id, loc, vars, opt = {}) {
  const range = opt.range ?? 64;
  safe("fx.emit", () => {
    for (const p of dim.getPlayers({ location: loc, maxDistance: range })) {
      if (opt.except && p.id === opt.except) continue;
      if ((opt.minQ ?? 0) > quality(p)) continue;
      if (opt.blood && !P(p).blood) continue;
      try {
        p.spawnParticle(id, loc, vars);
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
    for (const p of dim.getPlayers({ location: loc, maxDistance: range })) {
      playTo(p, sound, { location: loc, volume: o.volume ?? 1, pitch: o.pitch ?? 1 });
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
    for (const p of dim.getPlayers({ location: loc, maxDistance: Math.max(nearR, farR) })) {
      const d = dist(p.location, loc);
      if (d <= nearR) {
        playTo(p, `arsenal.fire.${set}`, { location: loc, volume: p.id === shooter.id ? 0.9 : 1.0, pitch });
      }
      if (farR > 0 && d > 24 && FAR_SOUND_SETS.has(set)) {
        const v = Math.max(0.15, 1 - (d - 24) / farR);
        playTo(p, `arsenal.far.${set}`, { location: loc, volume: v, pitch });
      }
    }
  });
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
    emit(dim, "arsenal:muzzle_flash", muzzle, v, { range: 96 });
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

/**
 * 曳光弾：飛んでいく光の筋（加算合成で光る）＋弾道に一瞬残る細い線
 * @param {import("@minecraft/server").Dimension} dim @param {import("../util/math.js").Vec3} from @param {import("../util/math.js").Vec3} to
 * @param {{r:number,g:number,b:number}} color @param {number} [width] @param {string} [except]
 */
export function tracer(dim, from, to, color, width = 0.05, except) {
  const d = dist(from, to);
  if (d < 1.2) return;
  // 速すぎると 1 フレームで通り過ぎて見えないので、見やすい速さに抑える
  const speed = Math.min(150, Math.max(70, d * 2.2));
  const v = new MolangVariableMap();
  const dir = mul({ x: to.x - from.x, y: to.y - from.y, z: to.z - from.z }, 1 / d);
  v.setSpeedAndDirection("variable.tracer", speed, dir);
  v.setFloat("variable.life", d / speed);
  v.setFloat("variable.width", width);
  v.setFloat("variable.len", d * 0.5);
  v.setColorRGB("variable.color", { red: color.r, green: color.g, blue: color.b });
  emit(dim, "arsenal:tracer", from, v, { range: 160, except });
  const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2, z: (from.z + to.z) / 2 };
  emit(dim, "arsenal:tracer_trail", mid, v, { range: 128, minQ: 1 });
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
  v.setFloat("variable.count", 6);
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
