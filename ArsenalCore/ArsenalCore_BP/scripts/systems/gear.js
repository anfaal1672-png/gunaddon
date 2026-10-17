// @ts-check
/**
 * 装備：医療品（包帯・メディキット・アドレナリン・除細動器・アーマープレート）、出血、設置物・銃座・乗り物の設置
 *
 *  ・医療品はアイテムの使用時間（use_modifiers）を最後まで使い切ると効く（onCompleteUse）。途中でやめれば消費しない
 *  ・除細動器は押しっぱなしで 2 秒、目の前 3 ブロック以内のダウンした味方を蘇生（消費しない。30 秒のクールダウン）
 *  ・出血（ワールド設定 bleeding）：大きな被弾・ホロウの爪で 10 秒間、毎秒 0.5 ダメージ（体力 1 までで止まる）。包帯・メディキット・医療ステーションで止まる
 *  ・設置物は地面（ブロックの上面）に向けて使うと置ける。持ち主（a:own）を記録し、同じ種類の上限を超えると置けない
 */
import { world, system, Player, GameMode, EntityDamageCause } from "@minecraft/server";
import { DATA, NS, medicalIdOf, deployableIdOf, vehicleIdOf, enemyIdOf } from "../config/constants.js";
import { W as WS } from "../core/settings.js";
import { S } from "../core/state.js";
import { addPlate } from "../core/armor.js";
import { isDowned, revive } from "../core/downed.js";
import { emitEvent } from "../core/events.js";
import { consumeItem, isCreative } from "../core/inventory.js";
import { emit, playNear, playTo } from "../fx/effects.js";
import { announce } from "../ui/hud2.js";
import { dist, norm, sub, dot, isLoaded } from "../util/math.js";
import { t } from "../util/i18n.js";
import { safe } from "../util/log.js";

const MEDICAL = /** @type {Record<string, any>} */ (DATA.MEDICAL);
const DEPLOYABLES = /** @type {Record<string, any>} */ (DATA.DEPLOYABLES);
const VEHICLES = /** @type {Record<string, any>} */ (DATA.VEHICLES);

/** 1 人が同時に置ける数（種類ごと） */
export const DEPLOY_LIMIT = { sentry: 2, shield_wall: 3, claymore: 6, ammo_station: 2, med_station: 2, mortar_emplacement: 1, hmg_nest: 2, aa_gun: 1, at_post: 1, buggy: 2, gl_post: 1, apc: 1 };
const DEFIB_COOLDOWN = 600;
/** @type {Map<string, number>} */
const lastDeploy = new Map();

/** @param {Player} p */
function msg(p, key, ...args) {
  safe("gear.msg", () => p.sendMessage(t(key, ...args)));
}

// ---------------------------------------------------------------------------
//  医療品
// ---------------------------------------------------------------------------

/**
 * 使い切ったとき
 * @param {Player} player @param {string} mid
 */
export function completeMedical(player, mid) {
  const m = MEDICAL[mid];
  if (!m || mid === "defibrillator") return;
  const s = S(player);
  const now = system.currentTick;
  if (m.plate) {
    if (!addPlate(player)) {
      msg(player, "arsenal.gear.plate_full");
      playTo(player, "arsenal.ui.error", { volume: 0.6 });
      return;
    }
  } else {
    if (m.heal) safe("med.heal", () => {
      const h = player.getComponent("minecraft:health");
      if (h) h.setCurrentValue(Math.min(h.effectiveMax, h.currentValue + m.heal));
    });
    if (m.stopsBleed && s.bleedUntil > now) {
      s.bleedUntil = 0;
      msg(player, "arsenal.gear.bleed_stop");
    }
    if (m.regen) s.medUntil = now + m.regen[0];
    if (m.buff) {
      s.adrenUntil = now + m.buff;
      safe("med.buff", () => {
        player.addEffect("speed", m.buff, { amplifier: 1, showParticles: false });
        player.addEffect("resistance", m.buff, { amplifier: 0, showParticles: false });
      });
      playTo(player, "arsenal.gear.adrenaline");
    }
    emit(player.dimension, "arsenal:heal", player.getAABB().center, undefined, { range: 24 });
    playNear(player.dimension, player.location, "arsenal.gear.heal", { range: 12, volume: 0.7 });
    emitEvent("medUsed", { player, id: mid });
  }
  if (!isCreative(player)) consumeItem(player, `${NS}:${mid}`, 1);
}

/**
 * 除細動器：押しっぱなし中（毎 tick）
 * @param {Player} player @param {import("../core/state.js").PlayerState} s
 */
function tickDefib(player, s) {
  const now = system.currentTick;
  if (s.useItem !== "defibrillator" || s.useStart < 0) return;
  const held = now - s.useStart;
  if (held % 10 === 0) playTo(player, "arsenal.gear.beep", { volume: 0.5, pitch: 1 + held / 40 });
  if (held < MEDICAL.defibrillator.use) return;
  s.useStart = -1;
  s.useItem = null;
  if (s.meleeCd > now) return;
  if (!WS().downed) {
    msg(player, "arsenal.gear.defib_off");
    return;
  }
  const eye = player.getHeadLocation();
  const v = player.getViewDirection();
  /** @type {Player|null} */
  let best = null;
  let bd = 3.2;
  for (const o of player.dimension.getPlayers({ location: player.location, maxDistance: 4 })) {
    if (o.id === player.id || !isDowned(o)) continue;
    const d = dist(o.location, player.location);
    if (d < bd && dot(norm(sub(o.getAABB().center, eye)), v) > 0.3) {
      best = o;
      bd = d;
    }
  }
  if (!best) {
    msg(player, "arsenal.gear.defib_none");
    return;
  }
  revive(best, player);
  s.meleeCd = now + DEFIB_COOLDOWN;
  emitEvent("medUsed", { player, id: "defibrillator", revived: best });
}

/**
 * 使用開始（除細動器）
 * @param {Player} player @param {string} typeId
 */
export function startGearUse(player, typeId) {
  const mid = medicalIdOf(typeId);
  if (mid !== "defibrillator") return false;
  const s = S(player);
  s.useStart = system.currentTick;
  s.useItem = mid;
  return true;
}

/** @param {Player} player */
export function stopGearUse(player) {
  const s = S(player);
  s.useStart = -1;
  s.useItem = null;
}

// ---------------------------------------------------------------------------
//  出血
// ---------------------------------------------------------------------------

/** @param {Player} p @param {number} ticks */
export function startBleeding(p, ticks = 200) {
  if (!WS().bleeding) return;
  const s = S(p);
  const now = system.currentTick;
  if (s.bleedUntil <= now) msg(p, "arsenal.gear.bleeding");
  s.bleedUntil = Math.max(s.bleedUntil, now + ticks);
}

/** @param {Player} p */
export function stopBleeding(p) {
  S(p).bleedUntil = 0;
}

/**
 * 毎 tick（プレイヤーごと）
 * @param {Player} player @param {import("../core/state.js").PlayerState} s
 */
export function tickGearPlayer(player, s) {
  const now = system.currentTick;
  if (s.useItem) tickDefib(player, s);
  if (now % 20 !== 0) return;
  if (s.medUntil > now) safe("med.regen", () => {
    const h = player.getComponent("minecraft:health");
    if (h && h.currentValue > 0) h.setCurrentValue(Math.min(h.effectiveMax, h.currentValue + (MEDICAL.medkit.regen[1] ?? 1)));
  });
  if (s.bleedUntil > now) {
    safe("bleed", () => {
      const h = player.getComponent("minecraft:health");
      if (h && h.currentValue > 1.5) h.setCurrentValue(Math.max(1, h.currentValue - 0.5));
    });
    emit(player.dimension, "arsenal:blood", player.getAABB().center, undefined, { range: 16, blood: true, minQ: 1 });
    if (now % 60 === 0) announce(player, { rawtext: [{ text: "§c" }, t("arsenal.gear.bleeding_hud")] }, 20);
  }
}

export function attachBleeding() {
  world.afterEvents.entityHurt.subscribe((ev) => {
    safe("bleed.hurt", () => {
      const p = ev.hurtEntity;
      if (!(p instanceof Player) || !WS().bleeding) return;
      const c = ev.damageSource.cause;
      const src = ev.damageSource.damagingEntity;
      const hollow = !!src && (enemyIdOf(src.typeId) ?? "").startsWith("hollow_");
      const dog = src?.typeId === `${NS}:raider_dog`;
      if (c === EntityDamageCause.entityAttack && (hollow || dog)) {
        if (Math.random() < 0.5) startBleeding(p, 200);
      } else if ((c === EntityDamageCause.projectile || c === EntityDamageCause.entityAttack) && ev.damage >= 5 && Math.random() < 0.3) {
        startBleeding(p, 160);
      }
    });
  });
}

// ---------------------------------------------------------------------------
//  設置
// ---------------------------------------------------------------------------

/**
 * 持ち主の設置数
 * @param {Player} player @param {string} typeId
 */
function ownedCount(player, typeId) {
  let n = 0;
  safe("deploy.count", () => {
    for (const e of player.dimension.getEntities({ type: typeId, location: player.location, maxDistance: 512 })) {
      if (e.getDynamicProperty("a:own") === player.id) n++;
    }
  });
  return n;
}

/**
 * 地面に向けて使った（カスタムコンポーネント onUseOn）
 * @param {Player} player @param {import("@minecraft/server").Block} block @param {string} face @param {string} typeId
 * @returns {boolean} 置いたか
 */
export function tryDeploy(player, block, face, typeId) {
  const did = deployableIdOf(typeId);
  const vid = vehicleIdOf(typeId);
  const def = did ? DEPLOYABLES[did] : vid ? VEHICLES[vid] : undefined;
  if (!def || def.offhand || did === "recon_drone") return false;
  const kind = did ? def.entity : vid;
  if (!kind) return false;
  // 押しっぱなしで onUseOn が繰り返し来ても 1 回だけ置く
  const now0 = system.currentTick;
  if (now0 - (lastDeploy.get(player.id) ?? -99) < 10) return false;
  lastDeploy.set(player.id, now0);
  if (String(face) !== "Up") {
    msg(player, "arsenal.gear.place_ground");
    return false;
  }
  const gm = safe("deploy.gm", () => player.getGameMode());
  if (gm === GameMode.Adventure || gm === GameMode.Spectator) return false;
  const pos = { x: block.location.x + 0.5, y: block.location.y + 1, z: block.location.z + 0.5 };
  const dim = player.dimension;
  if (!isLoaded(dim, pos, system.currentTick)) return false;
  // 置く場所が空いているか（足元と頭の高さ）
  const free = safe("deploy.free", () => {
    const a = dim.getBlock(pos);
    const b = dim.getBlock({ x: pos.x, y: pos.y + 1, z: pos.z });
    return (!a || a.isAir || a.typeId.includes("grass") || a.typeId.includes("snow_layer")) && (!b || b.isAir);
  });
  if (!free) {
    msg(player, "arsenal.gear.place_blocked");
    return false;
  }
  const limit = /** @type {any} */ (DEPLOY_LIMIT)[kind] ?? 2;
  if (ownedCount(player, `${NS}:${kind}`) >= limit) {
    msg(player, "arsenal.gear.place_limit", String(limit));
    playTo(player, "arsenal.ui.error", { volume: 0.6 });
    return false;
  }
  const e = safe("deploy.spawn", () => dim.spawnEntity(`${NS}:${kind}`, pos));
  if (!e) return false;
  const yaw = player.getRotation().y;
  safe("deploy.setup", () => {
    e.setDynamicProperty("a:own", player.id);
    e.setDynamicProperty("a:yaw", yaw);
    e.setDynamicProperty("a:born", system.currentTick);
    e.setRotation({ x: 0, y: yaw });
    if (kind === "sentry") e.setDynamicProperty("a:ammo", 0);
    if (kind === "ammo_station") e.setDynamicProperty("a:stock", def.stock ?? 300);
    if (kind === "buggy" || kind === "apc") e.setDynamicProperty("a:fuel", Math.round((def.fuel ?? 2400) * 0.5));
    e.nameTag = "";
  });
  playNear(dim, pos, "arsenal.gear.deploy", { range: 16 });
  if (!isCreative(player)) consumeItem(player, typeId, 1);
  emitEvent("deployed", { player, entity: e, kind });
  return true;
}

