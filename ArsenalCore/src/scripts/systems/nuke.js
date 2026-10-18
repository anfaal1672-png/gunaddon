// @ts-check
/**
 * 核爆発（2.6）：戦術核（置いて 15 秒）と核ミサイル（キルストリーク）の弾頭が使う
 *   1. 閃光：見える範囲のプレイヤーの画面を白く飛ばす（近いほど長く）
 *   2. 音：遠いほど遅れて届く（1 tick に約 17 ブロック）
 *   3. 爆発：中心で大きな爆発。ブロックを壊す設定なら、少し遅れて周りに 6 つの爆発でクレーターを広げる
 *   4. 爆風：kill 以内は致死、blast 以内は距離で減るダメージと火、knock 以内は外へ吹き飛ばす
 *   5. きのこ雲：3 秒かけて柱が立ち、上に傘が開く
 *   6. 放射性降下物：fallout の範囲に 60 秒、毒と衰弱（ガスマスク・機械には効かない。systems/fields.js）
 * ワールド設定「核兵器」（nukes）が切ってあれば置けず、撃てない。
 */
import { world, system, Player, MolangVariableMap } from "@minecraft/server";
import { DATA, ENTITY } from "../config/constants.js";
import { canDamage, dealDamage, explode } from "../core/damage.js";
import { W as WS, explosionBreaksBlocks } from "../core/settings.js";
import { emit, playTo, receiversNear } from "../fx/effects.js";
import { addFallout } from "./fields.js";
import { add, sub, len, isLoaded } from "../util/math.js";
import { safe } from "../util/log.js";
import { t } from "../util/i18n.js";

/** 戦術核の値（data/equipment.js） */
export function nukeSpec() {
  return /** @type {any} */ (DATA.THROWABLES).tactical_nuke;
}

/** 核兵器を使ってよいか */
export function nukesAllowed() {
  return WS().nukes !== false;
}

/** 大きな知らせ（main.js が HUD の announce を登録する。循環 import を避ける） @type {(p:Player, msg:any, stay?:number)=>void} */
let announcer = (p, msg) => safe("nuke.msg", () => p.onScreenDisplay.setActionBar(msg));
/** @param {(p:Player, msg:any, stay?:number)=>void} fn */
export function setNukeAnnouncer(fn) {
  announcer = fn;
}

/**
 * 周りのプレイヤーへカウントダウンを知らせる
 * @param {import("@minecraft/server").Dimension} dim @param {import("../util/math.js").Vec3} pos @param {string} key @param {number} secs @param {number} range
 */
export function warnNear(dim, pos, key, secs, range) {
  for (const r of receiversNear(dim, pos, range)) announcer(r.p, { rawtext: [{ text: "§c" }, t(key, String(secs))] }, 25);
}

/** 戦術核の起爆までの tick（数えながら知らせる）。projectiles.js の置いた弾が毎 tick 呼ぶ @param {{dim:any, pos:any, fuse:number, age:number}} p */
export function nukeCountdown(p) {
  if (p.fuse <= 0) return;
  const secs = Math.ceil(p.fuse / 20);
  if (p.fuse % 20 === 0) {
    warnNear(p.dim, p.pos, "arsenal.nuke.armed", secs, 96);
    for (const r of receiversNear(p.dim, p.pos, 64)) playTo(r.p, "arsenal.fx.c4_beep", { location: p.pos, volume: 1, pitch: secs <= 5 ? 1.6 : 1.0 });
  } else if (secs <= 5 && p.fuse % 5 === 0) {
    for (const r of receiversNear(p.dim, p.pos, 48)) playTo(r.p, "arsenal.fx.c4_beep", { location: p.pos, volume: 0.8, pitch: 1.9 });
  }
  if (p.fuse === nukeSpec().fuse - 1 || p.fuse === 100) {
    for (const r of receiversNear(p.dim, p.pos, 160)) playTo(r.p, "arsenal.world.klaxon", { location: p.pos, volume: 1, pitch: 0.8 });
  }
}

/**
 * 核爆発
 * @param {import("@minecraft/server").Dimension} dim @param {import("../util/math.js").Vec3} pos @param {string} ownerId @param {string} weaponId
 * @returns {{hit:number, killed:number}} 爆風が当たった数・倒した数（テスト用）
 */
export function detonateNuke(dim, pos, ownerId, weaponId = "tactical_nuke") {
  const N = nukeSpec();
  const res = { hit: 0, killed: 0 };
  if (!isLoaded(dim, pos, system.currentTick)) return res;
  const src = /** @type {import("@minecraft/server").Entity|undefined} */ (safe("nuke.src", () => world.getEntity(ownerId)));
  const srcOk = !!src && src.isValid;
  // 1. 閃光と 2. 音
  for (const r of receiversNear(dim, pos, N.hear)) {
    const d = Math.hypot(r.x - pos.x, r.y - pos.y, r.z - pos.z);
    if (d <= N.flash) {
      const I = Math.max(0, 1 - d / N.flash);
      safe("nuke.flash", () => r.p.camera.fade({ fadeColor: { red: 1, green: 0.97, blue: 0.9 }, fadeTime: { fadeInTime: 0.05, holdTime: 0.4 + 2.6 * I, fadeOutTime: 1.5 + 3 * I } }));
      if (d < 60) safe("nuke.blind", () => r.p.addEffect("blindness", Math.round(40 + 80 * I), { amplifier: 0, showParticles: false }));
    }
    const delay = Math.floor(d / 17);
    const v = Math.max(0.3, 1 - d / N.hear);
    const play = () => {
      if (!r.p.isValid) return;
      playTo(r.p, d < 96 ? "arsenal.fx.explosion" : "arsenal.fx.explosion_far", { location: pos, volume: v, pitch: 0.5 });
      playTo(r.p, "arsenal.fx.explosion_far", { location: pos, volume: v, pitch: 0.4 });
    };
    if (delay <= 0) play();
    else system.runTimeout(() => safe("nuke.sound", play), delay);
  }
  // 3. 爆発（中心）と、ブロックを壊す設定ならクレーターを広げる周りの爆発
  const breaks = explosionBreaksBlocks();
  explode(dim, pos, N.power, srcOk ? src : undefined, breaks, true, weaponId);
  if (breaks) {
    for (let i = 0; i < N.ring; i++) {
      const a = (i / N.ring) * Math.PI * 2;
      const at = { x: pos.x + Math.cos(a) * N.ringRadius, y: pos.y, z: pos.z + Math.sin(a) * N.ringRadius };
      system.runTimeout(() => safe("nuke.ring", () => explode(dim, at, N.ringPower, undefined, true, true, weaponId)), 2 + i * 2);
    }
  }
  // 4. 爆風
  safe("nuke.blast", () => {
    for (const e of dim.getEntities({ location: pos, maxDistance: N.knock, excludeFamilies: ["inanimate", "arsenal_fx"], excludeTypes: ["minecraft:item", "minecraft:xp_orb"] })) {
      // 補給係・保管庫・補給箱・目印は壊さない（canDamage と同じ）
      if (e.typeId === ENTITY.quartermaster || e.typeId === ENTITY.storage || e.typeId === ENTITY.crate || e.typeId === ENTITY.waypoint) continue;
      const c = e.getAABB().center;
      const off = sub(c, pos);
      const d = len(off);
      if (d <= N.blast && e.getComponent("minecraft:health")) {
        const dmg = d <= N.kill ? N.lethal : 60 - 52 * ((d - N.kill) / (N.blast - N.kill));
        const mine = srcOk && /** @type {any} */ (src).id === e.id;
        if (srcOk && !mine && canDamage(/** @type {any} */ (src), e)) {
          const r = dealDamage(/** @type {any} */ (src), e, dmg * WS().damageMul, { weaponId, kind: "explosive", fire: N.burnSecs });
          if (r.killed) res.killed++;
        } else {
          // 置いた本人も、味方も、持ち主のいない爆発でも、核からは逃げられない
          safe("nuke.raw", () => e.applyDamage(dmg * WS().damageMul, { cause: /** @type {any} */ ("entityExplosion") }));
          safe("nuke.fire", () => e.setOnFire(N.burnSecs, true));
          if (!e.isValid) res.killed++;
        }
        res.hit++;
      }
      if (e.isValid && d > 0.5) {
        const k = 3.2 * (1 - d / N.knock);
        safe("nuke.knock", () => e.applyKnockback({ x: (off.x / d) * k, z: (off.z / d) * k }, 0.4 + 0.5 * (1 - d / N.knock)));
      }
    }
  });
  // 5. きのこ雲（柱が立ってから傘が開く）
  mushroom(dim, pos);
  // 6. 放射性降下物
  addFallout(dim, pos, N.fallout, N.falloutSecs * 20, ownerId);
  return res;
}

/** @param {import("@minecraft/server").Dimension} dim @param {import("../util/math.js").Vec3} pos */
function mushroom(dim, pos) {
  emit(dim, "arsenal:sonic_ring", add(pos, { x: 0, y: 0.5, z: 0 }), undefined, { range: 256 });
  emit(dim, "arsenal:explosion", add(pos, { x: 0, y: 1, z: 0 }), undefined, { range: 256 });
  for (let i = 0; i < 12; i++) {
    const h = 2 + i * 2;
    system.runTimeout(() => safe("nuke.stem", () => {
      emit(dim, "arsenal:explosion", add(pos, { x: 0, y: h, z: 0 }), undefined, { range: 256 });
      emit(dim, "arsenal:explosion_smoke", add(pos, { x: 0, y: h, z: 0 }), undefined, { range: 256 });
    }), i * 3);
  }
  for (let k = 0; k < 3; k++) {
    system.runTimeout(() => safe("nuke.cap", () => {
      const v = new MolangVariableMap();
      v.setFloat("variable.duration", 8);
      v.setFloat("variable.radius", 6 + k * 3);
      emit(dim, "arsenal:smoke_cloud", add(pos, { x: 0, y: 26 + k * 2, z: 0 }), v, { range: 256 });
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const r = 5 + k * 3;
        emit(dim, "arsenal:explosion_smoke", add(pos, { x: Math.cos(a) * r, y: 25 + k * 2, z: Math.sin(a) * r }), undefined, { range: 256, minQ: 1 });
      }
    }), 36 + k * 6);
  }
  // 地面を這う爆風の煙
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    system.runTimeout(() => safe("nuke.base", () => emit(dim, "arsenal:explosion_smoke", add(pos, { x: Math.cos(a) * 10, y: 1, z: Math.sin(a) * 10 }), undefined, { range: 192, minQ: 1 })), 6);
  }
}

