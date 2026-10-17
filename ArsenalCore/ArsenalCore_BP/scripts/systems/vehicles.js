// @ts-check
/**
 * 銃座（重機関銃座・対空機関砲・対装甲ランチャー座）と軽装甲バギー
 *
 *  ・乗って（右クリック／タップ）視点で狙い、ジャンプボタンで撃つ。個人設定「射撃の操作」がタップなら、ジャンプを押すたびに撃ち始め／止め
 *  ・弾は乗っている人のインベントリから（重機関銃・対空は大口径弾、対装甲はロケット弾、バギーの機関銃は中口径弾）
 *  ・対装甲ランチャーは有線誘導：ロケットは撃った人の視線の先へ曲がって飛ぶ
 *  ・バギー：運転席（前）と銃手席（後ろの機関銃）。燃料（燃料キャニスターを持って触ると補給）、鋼鉄インゴットを持って触ると修理
 *  ・持ち主がスニークして素手で触ると回収（耐久・燃料はアイテムに残らない＝満タンで戻る代わりに、壊れかけで回収しても直らない仕様は採らない）
 */
import { world, system, Player, InputButton, ButtonState, EquipmentSlot } from "@minecraft/server";
import { DATA, NS, ammoItemId, vehicleIdOf, ITEM } from "../config/constants.js";
import { P } from "../core/settings.js";
import { S } from "../core/state.js";
import { computeStats } from "../core/weaponState.js";
import { traceHitscan, drawTracer } from "../core/ballistics.js";
import { miniBlast } from "../core/damage.js";
import { consumeItem, giveItem, isCreative } from "../core/inventory.js";
import { isEmpd } from "./ai/brain.js";
import { fireRocket } from "./projectiles.js";
import { gunshot, muzzleFx, emit, playNear, playTo } from "../fx/effects.js";
import { announce } from "../ui/hud2.js";
import { add, mul, dist, cone } from "../util/math.js";
import { t } from "../util/i18n.js";
import { safe } from "../util/log.js";

const VEH = /** @type {Record<string, any>} */ (DATA.VEHICLES);
/** 銃座ごとの基準武器（見た目・音・弾道の元） */
const BASE = { hmg_nest: "titan", aa_gun: "titan", at_post: "thumper", buggy: "juggernaut" };

/** @type {Map<string, any>} */
const statCache = new Map();
/** @param {string} vid */
function vStats(vid) {
  let st = statCache.get(vid);
  if (st) return st;
  const v = VEH[vid];
  const b = computeStats(/** @type {any} */ (BASE)[vid], {}, "std");
  st = { ...b, id: vid, dmg: v.dmg, dmgMin: v.dmg, range0: v.range * 0.6, range1: v.range, falloff: 0.7, tracer: true, flash: true, sound: v.sound, pen: 2, ap: 0.3 };
  statCache.set(vid, st);
  return st;
}

/**
 * 乗っている銃座・乗り物と席
 * @param {Player} p
 * @returns {{veh:import("@minecraft/server").Entity, vid:string, seat:number}|null}
 */
export function mountOf(p) {
  const r = safe("veh.riding", () => p.getComponent("minecraft:riding"));
  const veh = r?.entityRidingOn;
  if (!veh || !veh.isValid) return null;
  const vid = vehicleIdOf(veh.typeId);
  if (!vid) return null;
  let seat = 0;
  if (VEH[vid].kind === "vehicle") {
    const riders = safe("veh.riders", () => veh.getComponent("minecraft:rideable")?.getRiders()) ?? [];
    seat = Math.max(0, riders.findIndex((x) => x.id === p.id));
  }
  return { veh, vid, seat };
}

/** @param {string} vid @param {number} seat */
function gunAt(vid, seat) {
  const v = VEH[vid];
  if (v.kind === "vehicle") return seat >= 1;
  return true;
}

/** @param {string} vid */
function ammoFor(vid) {
  const v = VEH[vid];
  return ammoItemId(v.ammo, "std");
}

/**
 * 1 発撃つ
 * @param {Player} p @param {import("@minecraft/server").Entity} veh @param {string} vid
 */
function fireOnce(p, veh, vid) {
  const v = VEH[vid];
  const st = vStats(vid);
  const id = ammoFor(vid);
  if (!isCreative(p)) {
    if (!id || !consumeItem(p, id, 1)) {
      playTo(p, "arsenal.mech.dry_fire", { volume: 0.8 });
      announce(p, { rawtext: [{ text: "§c" }, t("arsenal.veh.no_ammo")] }, 20);
      return false;
    }
  }
  const eye = p.getHeadLocation();
  const dir = p.getViewDirection();
  const base = add(veh.location, { x: 0, y: v.kind === "vehicle" ? 1.9 : 1.2, z: 0 });
  const muzzle = add(base, mul(dir, 1.4));
  gunshot(p, st, muzzle);
  muzzleFx(p, st, muzzle, null);
  const hitSet = new Set([veh.id]);
  switch (v.fire) {
    case "wire": {
      fireRocket(p, muzzle, dir, { ...st, projectile: { speed: 1.0, accel: 0.08, max: 2.6, power: v.power, turn: 0.2 } }, null, { wire: p.id, power: v.power, kind: "rocket", maxAge: 200 });
      emit(p.dimension, "arsenal:muzzle_smoke", muzzle, undefined, { range: 48 });
      break;
    }
    case "flak": {
      const r = traceHitscan(p, eye, cone(dir, v.spread), st, { maxRange: v.range, hitSet });
      drawTracer(p, muzzle, r.end, st, true);
      // 近接信管：弾道のそばを飛んでいるもの、または弾の終点で炸裂
      let burst = r.end;
      safe("flak.prox", () => {
        for (const f of p.dimension.getEntities({ location: add(eye, mul(dir, Math.min(v.range, dist(eye, r.end)) / 2)), maxDistance: v.range / 2 + 4, families: ["arsenal_flying"] })) {
          const c = f.getAABB().center;
          const along = Math.max(0, Math.min(dist(eye, r.end), (c.x - eye.x) * dir.x + (c.y - eye.y) * dir.y + (c.z - eye.z) * dir.z));
          const closest = add(eye, mul(dir, along));
          if (dist(closest, c) < 3) {
            burst = closest;
            break;
          }
        }
      });
      miniBlast(p, burst, v.flak ?? 2.5, st.dmg * 0.8, vid);
      break;
    }
    default: {
      const r = traceHitscan(p, eye, cone(dir, v.spread), st, { maxRange: v.range, hitSet });
      drawTracer(p, muzzle, r.end, st, true);
    }
  }
  return true;
}

/**
 * 毎 tick（乗っているプレイヤーごと）
 * @param {Player} p @param {import("../core/state.js").PlayerState} s
 */
export function tickMounted(p, s) {
  const m = mountOf(p);
  if (!m) {
    if (s.ridingId) {
      s.ridingId = null;
      s.jumpToggle = false;
      s.hudDirty = true;
    }
    return false;
  }
  const { veh, vid, seat } = m;
  const now = system.currentTick;
  if (s.ridingId !== veh.id) {
    s.ridingId = veh.id;
    s.jumpToggle = false;
    announce(p, { rawtext: [{ text: "§e" }, t(VEH[vid].kind === "vehicle" && seat === 0 ? "arsenal.veh.hint_drive" : "arsenal.veh.hint_gun")] }, 60);
  }
  const v = VEH[vid];
  // 砲身の向き（銃座・銃手席）
  if (gunAt(vid, seat)) {
    const rot = p.getRotation();
    safe("veh.aim", () => {
      if (v.kind !== "vehicle") veh.setRotation({ x: 0, y: rot.y });
      veh.setProperty(`${NS}:pitch`, Math.max(-60, Math.min(80, Math.round(-rot.x))));
    });
    const jump = safe("veh.jump", () => p.inputInfo.getButtonState(InputButton.Jump) === ButtonState.Pressed) ?? false;
    const firing = P(p).triggerMode === "tap" ? s.jumpToggle : jump;
    if (firing && !isEmpd(veh) && now >= s.vehShot) {
      const gap = Math.max(1, Math.round(1200 / v.rpm));
      s.vehShot = now + gap;
      if (!fireOnce(p, veh, vid)) s.jumpToggle = false;
    } else if (firing && isEmpd(veh) && now % 20 === 0) {
      announce(p, { rawtext: [{ text: "§b" }, t("arsenal.ui.emp")] }, 20);
    }
  }
  // バギー：燃料と表示
  if (v.kind === "vehicle" && seat === 0) tickDriver(p, veh, v, now);
  return true;
}

/**
 * @param {Player} p @param {import("@minecraft/server").Entity} veh @param {any} v @param {number} now
 */
function tickDriver(p, veh, v, now) {
  let fuel = fuelCache.get(veh.id) ?? /** @type {number} */ (safe("veh.fuel", () => veh.getDynamicProperty("a:fuel")) ?? 0);
  const vel = safe("veh.vel", () => veh.getVelocity()) ?? { x: 0, y: 0, z: 0 };
  const moving = Math.hypot(vel.x, vel.z) > 0.03;
  if (moving && fuel > 0) {
    fuel = Math.max(0, fuel - 1);
    fuelCache.set(veh.id, fuel);
    if (now % 10 === 0 || fuel === 0) safe("veh.fuel.save", () => veh.setDynamicProperty("a:fuel", fuel));
    if (now % 30 === 0) playNear(veh.dimension, veh.location, "arsenal.vehicle.engine", { range: 32, volume: 0.7 });
  }
  const mv = safe("veh.mv", () => veh.getComponent("minecraft:movement"));
  if (mv) safe("veh.mv.set", () => mv.setCurrentValue(fuel > 0 ? v.speed : 0));
  if (now % 20 === 0) {
    const h = safe("veh.hp", () => veh.getComponent("minecraft:health"));
    announce(p, t("arsenal.veh.status", String(Math.ceil(fuel / 20)), String(Math.ceil(h?.currentValue ?? 0)), String(v.health)), 25);
    if (fuel <= 0) announce(p, { rawtext: [{ text: "§c" }, t("arsenal.veh.no_fuel")] }, 25);
  }
}

/** 走行中の燃料（毎 tick 書き込まないためのメモリ上の値） @type {Map<string, number>} */
const fuelCache = new Map();

/** @param {Player} p */
function heldId(p) {
  return safe("veh.held", () => p.getComponent("minecraft:equippable")?.getEquipment(EquipmentSlot.Mainhand)?.typeId);
}

export function attachVehicles() {
  world.afterEvents.playerButtonInput.subscribe((ev) => safe("veh.btn", () => {
    if (ev.button !== InputButton.Jump || ev.newButtonState !== ButtonState.Pressed) return;
    const s = S(ev.player);
    if (!s.ridingId) return;
    if (P(ev.player).triggerMode === "tap") s.jumpToggle = !s.jumpToggle;
  }));
  // 補給・修理・回収（乗る操作より先に処理したいので before）
  world.beforeEvents.playerInteractWithEntity.subscribe((ev) => {
    const e = ev.target;
    const vid = vehicleIdOf(e.typeId);
    if (!vid) return;
    const p = ev.player;
    const held = ev.itemStack?.typeId;
    const v = VEH[vid];
    if (held === ITEM.fuel && v.kind === "vehicle") {
      ev.cancel = true;
      system.run(() => safe("veh.refuel", () => {
        const fuel = fuelCache.get(e.id) ?? /** @type {number} */ (e.getDynamicProperty("a:fuel") ?? 0);
        if (fuel >= v.fuel) return;
        if (!isCreative(p) && !consumeItem(p, ITEM.fuel, 1)) return;
        e.setDynamicProperty("a:fuel", Math.min(v.fuel, fuel + 600));
        fuelCache.delete(e.id);
        playNear(p.dimension, e.location, "arsenal.gear.deploy", { range: 12, pitch: 0.7 });
        p.sendMessage(t("arsenal.veh.refueled", String(Math.ceil(Math.min(v.fuel, fuel + 600) / 20))));
      }));
      return;
    }
    if (held === `${NS}:steel_ingot`) {
      ev.cancel = true;
      system.run(() => safe("veh.repair", () => {
        const h = e.getComponent("minecraft:health");
        if (!h || h.currentValue >= h.effectiveMax) return;
        if (!isCreative(p) && !consumeItem(p, `${NS}:steel_ingot`, 1)) return;
        h.setCurrentValue(Math.min(h.effectiveMax, h.currentValue + 20));
        playNear(p.dimension, e.location, "arsenal.fx.repair", { range: 12 });
      }));
      return;
    }
    if (p.isSneaking && !held) {
      const own = e.getDynamicProperty("a:own");
      if (own !== p.id) return;
      ev.cancel = true;
      system.run(() => safe("veh.pick", () => {
        const riders = e.getComponent("minecraft:rideable")?.getRiders() ?? [];
        if (riders.length) return;
        e.remove();
        giveItem(p, `${NS}:${vid}`, 1);
        playNear(p.dimension, p.location, "arsenal.gear.deploy", { range: 12, pitch: 1.3 });
      }));
    }
  });
  world.afterEvents.entityDie.subscribe((ev) => safe("veh.die", () => {
    const e = ev.deadEntity;
    if (!vehicleIdOf(e.typeId)) return;
    emit(e.dimension, "arsenal:explosion", e.location, undefined, { range: 64 });
    playNear(e.dimension, e.location, "arsenal.fx.explosion", { range: 64 });
  }));
}

