// @ts-check
/**
 * 設置物の動作：センチネル砲台・クレイモア・弾薬ステーション・医療ステーション・迫撃砲陣地・偵察ドローン
 *
 * 予算：砲台の索敵（周囲の敵を探して見通しを調べる）は 1 tick に 6 台まで。射撃そのものは目標がいる砲台だけ毎 tick。
 * 砲台の弾は持ち主のインベントリの中口径弾から 60 発ずつ補充する（持ち主が 32 ブロック以内にいるとき）。
 * キルストリークの砲台（a:inf）は弾が無限で、期限（a:until）が来ると消える。
 */
import { world, system, Player } from "@minecraft/server";
import { ModalFormData } from "@minecraft/server-ui";
import { DATA, NS, ammoItemId } from "../config/constants.js";
import { S } from "../core/state.js";
import { computeStats } from "../core/weaponState.js";
import { traceHitscan, drawTracer } from "../core/ballistics.js";
import { explode, sameTeam, canDamage } from "../core/damage.js";
import { takeUpTo, countItem, consumeItem, giveItem, isCreative } from "../core/inventory.js";
import { isEmpd, hasLos as hasLosTo } from "./ai/brain.js";
import { stopBleeding } from "./gear.js";
import { fireMortar } from "./projectiles.js";
import { gunshot, muzzleFx, emit, playNear, playTo } from "../fx/effects.js";
import { announce } from "../ui/hud2.js";
import { add, sub, mul, norm, dist, dot, cone, rotFromDir, dirFromRot, isLoaded, len, loadedReach } from "../util/math.js";
import { t } from "../util/i18n.js";
import { safe } from "../util/log.js";

const DEP = /** @type {Record<string, any>} */ (DATA.DEPLOYABLES);
const KINDS = new Set(["sentry", "shield_wall", "claymore", "ammo_station", "med_station", "mortar_emplacement", "recon_drone"]);
const SENTRY = DEP.sentry_turret;
const SCANS_PER_TICK = 6;

/**
 * @typedef {{id:string, kind:string, ent:import("@minecraft/server").Entity, target:string|null, scanTick:number, shotTimer:number, ammo:number, ammoDirty:boolean, next:number}} Dep
 */
/** @type {Map<string, Dep>} */
const deps = new Map();
let scanCursor = 0;

/** 砲台のステータス（中口径のライフル弾） */
const sentryStats = (() => {
  /** @type {any} */
  let st = null;
  return () => {
    if (st) return st;
    const b = computeStats("sentinel", {}, "std");
    st = { ...b, id: "sentry_turret", dmg: SENTRY.dmg, dmgMin: SENTRY.dmg, range0: SENTRY.range, range1: SENTRY.range * 1.5, falloff: 0.8, tracer: true, flash: true };
    return st;
  };
})();

/** @param {import("@minecraft/server").Entity} e */
function kindOf(e) {
  if (!e.typeId.startsWith(`${NS}:`)) return null;
  const k = e.typeId.slice(NS.length + 1);
  return KINDS.has(k) ? k : null;
}

/** @param {import("@minecraft/server").Entity} e */
function register(e) {
  const kind = kindOf(e);
  if (!kind) return undefined;
  let d = deps.get(e.id);
  if (d) {
    d.ent = e;
    return d;
  }
  const ammo = /** @type {number} */ (safe("dep.ammo", () => e.getDynamicProperty("a:ammo")) ?? 0);
  d = { id: e.id, kind, ent: e, target: null, scanTick: -99, shotTimer: 0, ammo, ammoDirty: false, next: 0 };
  deps.set(e.id, d);
  return d;
}

/** @param {import("@minecraft/server").Entity} e */
function ownerOf(e) {
  const id = safe("dep.own", () => e.getDynamicProperty("a:own"));
  if (typeof id !== "string") return undefined;
  const p = world.getEntity(id);
  return p instanceof Player ? p : undefined;
}

/**
 * 味方か（持ち主本人・同じチーム）
 * @param {import("@minecraft/server").Entity} dep @param {Player} p
 */
function isFriend(dep, p) {
  const own = safe("dep.own2", () => dep.getDynamicProperty("a:own"));
  if (own === p.id) return true;
  const o = typeof own === "string" ? world.getEntity(own) : undefined;
  if (o instanceof Player) {
    if (sameTeam(o, p)) return true;
    // チームのない状態では、PvP が OFF なら全員味方、ON でも持ち主以外に使わせてよい（協力プレイの補給）
    return !p.getTags().some((x) => x.startsWith("arsenal_team:"));
  }
  return true;
}

/** @param {Dep} d */
function removeDep(d, fx = true) {
  deps.delete(d.id);
  if (d.ent.isValid) {
    if (fx) {
      emit(d.ent.dimension, "arsenal:explosion_smoke", d.ent.location, undefined, { range: 32 });
      playNear(d.ent.dimension, d.ent.location, "arsenal.armor.plate_break", { range: 16 });
    }
    safe("dep.remove", () => d.ent.remove());
  }
}

// ---------------------------------------------------------------------------
//  砲台
// ---------------------------------------------------------------------------

/**
 * 敵を探す
 * @param {Dep} d
 */
function sentryScan(d) {
  const e = d.ent;
  const eye = add(e.location, { x: 0, y: 0.8, z: 0 });
  const owner = ownerOf(e);
  /** @type {import("@minecraft/server").Entity|null} */
  let best = null;
  let bd = Infinity;
  safe("sentry.scan", () => {
    for (const c of e.dimension.getEntities({ location: eye, maxDistance: SENTRY.range, families: ["monster"] })) {
      if (!c.isValid || !c.getComponent("minecraft:health")) continue;
      if (owner && !canDamage(owner, c)) continue;
      const dd = dist(c.location, e.location);
      if (dd >= bd) continue;
      if (!hasLosTo(e.dimension, eye, c.getAABB().center)) continue;
      best = c;
      bd = dd;
    }
  });
  d.target = best ? /** @type {any} */ (best).id : null;
}

/** @param {Dep} d */
function refill(d) {
  const e = d.ent;
  if (safe("sentry.inf", () => e.getDynamicProperty("a:inf")) === true) {
    d.ammo = SENTRY.mag;
    return;
  }
  const owner = ownerOf(e);
  if (!owner || dist(owner.location, e.location) > 32 || owner.dimension.id !== e.dimension.id) return;
  const id = ammoItemId(SENTRY.ammo, "std");
  if (!id) return;
  if (isCreative(owner)) {
    d.ammo = SENTRY.mag;
    return;
  }
  const got = takeUpTo(owner, id, SENTRY.mag - d.ammo);
  if (got > 0) {
    d.ammo += got;
    d.ammoDirty = true;
    playNear(e.dimension, e.location, "arsenal.mech.belt", { range: 12 });
  }
}

/** @param {Dep} d @param {number} now */
function sentryTick(d, now) {
  const e = d.ent;
  const until = safe("sentry.until", () => e.getDynamicProperty("a:until"));
  if (typeof until === "number" && now >= until) {
    removeDep(d);
    return;
  }
  if (isEmpd(e)) {
    if (now % 10 === 0) emit(e.dimension, "arsenal:arc_spark", add(e.location, { x: 0, y: 0.8, z: 0 }), undefined, { range: 24 });
    return;
  }
  if (!d.target) return;
  const tg = world.getEntity(d.target);
  if (!tg || !tg.isValid) {
    d.target = null;
    return;
  }
  const eye = add(e.location, { x: 0, y: 0.8, z: 0 });
  const aim = tg.getAABB().center;
  const dir = norm(sub(aim, eye));
  const rot = rotFromDir(dir);
  // rotFromDir は { pitch, yaw }（2.4.1 まで rot.x / rot.y を読んでいて undefined になり、砲台が的の方を向かなかった）
  safe("sentry.rot", () => {
    e.setRotation({ x: 0, y: rot.yaw });
    e.setProperty(`${NS}:pitch`, Math.max(-60, Math.min(80, Math.round(-rot.pitch))));
  });
  if (d.ammo <= 0) {
    refill(d);
    if (d.ammo <= 0) {
      if (now % 40 === 0) playNear(e.dimension, e.location, "arsenal.mech.dry_fire", { range: 12 });
      return;
    }
  }
  d.shotTimer -= 1;
  if (d.shotTimer > 0) return;
  d.shotTimer += 1200 / SENTRY.rpm;
  const st = sentryStats();
  const muzzle = add(eye, mul(dir, 0.7));
  gunshot(e, st, muzzle);
  muzzleFx(/** @type {any} */ (e), st, muzzle, null);
  const r = traceHitscan(e, eye, cone(dir, 1.6), st, { maxRange: SENTRY.range * 1.2 });
  drawTracer(e, muzzle, r.end, st, true);
  d.ammo--;
  d.ammoDirty = true;
}

// ---------------------------------------------------------------------------
//  そのほかの設置物（数 tick ごと）
// ---------------------------------------------------------------------------

/** @param {Dep} d @param {number} now */
function claymoreTick(d, now) {
  if (now % 4 !== 0) return;
  const e = d.ent;
  const born = /** @type {number} */ (safe("clay.born", () => e.getDynamicProperty("a:born")) ?? 0);
  if (now - born < 40) return; // 設置直後は作動しない
  const yaw = /** @type {number} */ (safe("clay.yaw", () => e.getDynamicProperty("a:yaw")) ?? 0);
  const f = dirFromRot(0, yaw);
  const owner = ownerOf(e);
  const def = DEP.claymore;
  const hit = safe("clay.scan", () => {
    for (const c of e.dimension.getEntities({ location: e.location, maxDistance: def.range + 0.5, excludeFamilies: ["inanimate", "arsenal_fx", "arsenal_deployable"], excludeTypes: ["minecraft:item", "minecraft:xp_orb"] })) {
      if (!c.getComponent("minecraft:health")) continue;
      if (owner && (c.id === owner.id || !canDamage(owner, c))) continue;
      if (!owner && c instanceof Player) continue;
      const v = sub(c.location, e.location);
      const L = Math.hypot(v.x, v.z);
      if (L < 0.4 || (v.x * f.x + v.z * f.z) / L > 0.45) return true;
    }
    return false;
  });
  if (!hit) return;
  const loc = add(add(e.location, { x: 0, y: 0.4, z: 0 }), mul({ x: f.x, y: 0, z: f.z }, 0.8));
  const dim = e.dimension;
  playNear(dim, e.location, "arsenal.gear.claymore", { range: 24 });
  removeDep(d, false);
  explode(dim, loc, def.power, owner, false, false, "claymore");
}

/** @param {Dep} d @param {number} now */
function ammoStationTick(d, now) {
  if (now % 100 !== 0) return;
  const e = d.ent;
  let stock = /** @type {number} */ (safe("as.stock", () => e.getDynamicProperty("a:stock")) ?? 0);
  if (stock <= 0) {
    removeDep(d);
    return;
  }
  for (const p of e.dimension.getPlayers({ location: e.location, maxDistance: DEP.ammo_station.range })) {
    if (!isFriend(e, p) || stock <= 0) continue;
    const s = S(p);
    const st = s.stats;
    if (!st || st.ammoFamily === "none") continue;
    const id = ammoItemId(st.ammoFamily, s.ammoType) ?? ammoItemId(st.ammoFamily, "std");
    if (!id) continue;
    const want = Math.max(0, Math.ceil((st.mag * 3) / st.ammoPerItem) - countItem(p, id));
    const give = Math.min(want, Math.ceil(stock / Math.max(1, st.ammoPerItem)), Math.ceil(st.mag / st.ammoPerItem));
    if (give <= 0) continue;
    giveItem(p, id, give);
    stock -= give * st.ammoPerItem;
    playTo(p, "arsenal.mech.mag_in", { volume: 0.6 });
    announce(p, { rawtext: [{ text: "§a" }, t("arsenal.gear.resupplied")] }, 20);
  }
  safe("as.save", () => e.setDynamicProperty("a:stock", Math.max(0, stock)));
}

/** @param {Dep} d @param {number} now */
function medStationTick(d, now) {
  if (now % 20 !== 0) return;
  const e = d.ent;
  const born = /** @type {number} */ (safe("ms.born", () => e.getDynamicProperty("a:born")) ?? now);
  if (now - born > DEP.med_station.duration || born > now + 10) {
    // 期限切れ（ワールドを開き直して tick が戻った場合も消す）
    removeDep(d);
    return;
  }
  emit(e.dimension, "arsenal:heal", add(e.location, { x: 0, y: 1, z: 0 }), undefined, { range: 24, minQ: 1 });
  for (const p of e.dimension.getPlayers({ location: e.location, maxDistance: DEP.med_station.range })) {
    if (!isFriend(e, p)) continue;
    safe("ms.heal", () => {
      const h = p.getComponent("minecraft:health");
      if (h && h.currentValue > 0 && h.currentValue < h.effectiveMax) h.setCurrentValue(Math.min(h.effectiveMax, h.currentValue + 1));
    });
    stopBleeding(p);
  }
}

// ---------------------------------------------------------------------------
//  迫撃砲陣地（使うと座標を指定するフォーム）
// ---------------------------------------------------------------------------

/**
 * @param {Player} player @param {import("@minecraft/server").Entity} ent
 */
export async function useMortarEmplacement(player, ent) {
  const s = S(player);
  const now = system.currentTick;
  const cd = /** @type {number} */ (safe("mortar.cd", () => ent.getDynamicProperty("a:cd")) ?? 0);
  if (cd > now && cd - now < 400) {
    player.sendMessage(t("arsenal.gear.mortar_reload", String(Math.ceil((cd - now) / 20))));
    return;
  }
  const shell = ammoItemId("mortar", "std");
  if (!shell || (!isCreative(player) && countItem(player, shell) <= 0)) {
    player.sendMessage(t("arsenal.gear.mortar_noammo"));
    playTo(player, "arsenal.ui.error", { volume: 0.6 });
    return;
  }
  // 既定値：視線の先（最大 160 ブロック）
  const eye = player.getHeadLocation();
  const vd = player.getViewDirection();
  const reach = loadedReach(player.dimension, eye, vd, 160, system.currentTick);
  const hit = reach > 0 ? safe("mortar.ray", () => player.dimension.getBlockFromRay(eye, vd, { maxDistance: reach, includeLiquidBlocks: true, includePassableBlocks: false })) : undefined;
  const def = hit ? add(hit.block.location, { x: 0.5, y: 1, z: 0.5 }) : s.mortarTarget ? { x: s.mortarTarget.x, y: ent.location.y, z: s.mortarTarget.z } : add(ent.location, { x: 0, y: 0, z: 40 });
  s.menuOpen = true;
  const form = new ModalFormData()
    .title(t("arsenal.gear.mortar_title"))
    .textField(t("arsenal.gear.mortar_x"), "x", { defaultValue: String(Math.floor(def.x)) })
    .textField(t("arsenal.gear.mortar_z"), "z", { defaultValue: String(Math.floor(def.z)) })
    .slider(t("arsenal.gear.mortar_rounds"), 1, 3, { valueStep: 1, defaultValue: 1 });
  const res = await form.show(/** @type {any} */ (player)).catch(() => undefined);
  s.menuOpen = false;
  if (!res || res.canceled || !res.formValues) return;
  const x = Number(res.formValues[0]);
  const z = Number(res.formValues[1]);
  const rounds = Math.max(1, Math.min(3, Number(res.formValues[2]) || 1));
  if (!isFinite(x) || !isFinite(z)) return;
  const target = { x: x + 0.5, y: def.y, z: z + 0.5 };
  const d2 = Math.hypot(target.x - ent.location.x, target.z - ent.location.z);
  if (d2 < 12 || d2 > DEP.mortar_emplacement.range) {
    player.sendMessage(t("arsenal.gear.mortar_range", "12", String(DEP.mortar_emplacement.range)));
    return;
  }
  // 着弾点の高さ：読み込まれていれば地面を探す
  const ground = safe("mortar.ground", () => {
    const from = { x: target.x, y: Math.min(300, ent.location.y + 60), z: target.z };
    if (!isLoaded(player.dimension, from, system.currentTick)) return null;
    const down = { x: 0, y: -1, z: 0 };
    const r2 = loadedReach(player.dimension, from, down, 140, system.currentTick);
    const h = r2 > 0 ? player.dimension.getBlockFromRay(from, down, { maxDistance: r2, includeLiquidBlocks: true, includePassableBlocks: false }) : undefined;
    return h ? h.block.location.y + 1 : null;
  });
  if (typeof ground === "number") target.y = ground;
  s.mortarTarget = { x: target.x, z: target.z };
  let fired = 0;
  for (let i = 0; i < rounds; i++) {
    if (!isCreative(player) && !consumeItem(player, shell, 1)) break;
    fired++;
    system.runTimeout(() => safe("mortar.fire", () => {
      if (!ent.isValid) return;
      const st = computeStats("mortarman", {}, "std");
      const muzzle = add(ent.location, { x: 0, y: 1.1, z: 0 });
      fireMortar(ent, muzzle, norm(sub(target, muzzle)), st, target, 1.5 + i);
      gunshot(ent, st, muzzle);
      emit(ent.dimension, "arsenal:muzzle_smoke", muzzle, undefined, { range: 48 });
    }), i * 30);
  }
  if (fired > 0) {
    safe("mortar.cd.set", () => ent.setDynamicProperty("a:cd", now + 60 + fired * 30));
    emit(player.dimension, "arsenal:target_marker", target, undefined, { range: 160 });
    player.sendMessage(t("arsenal.gear.mortar_fired", String(fired), String(Math.round(d2))));
  }
}

// ---------------------------------------------------------------------------
//  偵察ドローン（ドローン視点で飛ばす）
// ---------------------------------------------------------------------------

/**
 * @typedef {{drone:import("@minecraft/server").Entity, until:number, camera:boolean, origin:import("../util/math.js").Vec3, marked:Map<string, number>}} DroneRun
 */
/** @type {Map<string, DroneRun>} */
const drones = new Map();

/**
 * 飛ばす（アイテムの使用）
 * @param {Player} player
 */
export function launchDrone(player) {
  if (drones.has(player.id)) return false;
  const def = DEP.recon_drone;
  const pos = add(player.location, { x: 0, y: 2.2, z: 0 });
  const dim = player.dimension;
  if (!isLoaded(dim, pos, system.currentTick)) return false;
  const e = safe("drone.spawn", () => dim.spawnEntity(`${NS}:recon_drone`, pos));
  if (!e) return false;
  safe("drone.own", () => {
    e.setDynamicProperty("a:own", player.id);
    e.setDynamicProperty("a:born", system.currentTick);
  });
  if (!isCreative(player)) consumeItem(player, `${NS}:recon_drone`, 1);
  const cam = !!safe("drone.cam", () => {
    player.camera.setCamera("minecraft:free", { location: pos, rotation: player.getRotation() });
    return true;
  });
  drones.set(player.id, { drone: e, until: system.currentTick + def.duration, camera: cam, origin: { ...player.location }, marked: new Map() });
  S(player).droneId = e.id;
  safe("drone.freeze", () => player.addEffect("slowness", def.duration + 20, { amplifier: 5, showParticles: false }));
  playNear(dim, pos, "arsenal.world.drone", { range: 24 });
  player.sendMessage(t("arsenal.gear.drone_hint"));
  return true;
}

/**
 * 戻す
 * @param {Player|undefined} player @param {string} pid @param {boolean} lost 撃ち落とされた
 */
function endDrone(player, pid, lost) {
  const run = drones.get(pid);
  drones.delete(pid);
  if (!run) return;
  if (run.drone.isValid) safe("drone.rm", () => run.drone.remove());
  if (!player) return;
  S(player).droneId = null;
  safe("drone.cam.clear", () => player.camera.clear());
  safe("drone.unfreeze", () => player.removeEffect("slowness"));
  if (!lost) giveItem(player, `${NS}:recon_drone`, 1);
  else player.sendMessage(t("arsenal.gear.drone_lost"));
}

/** 毎 tick：ドローンの操縦 */
function tickDrones() {
  const now = system.currentTick;
  for (const [pid, run] of drones) {
    const p = world.getEntity(pid);
    if (!(p instanceof Player) || !p.isValid) {
      endDrone(undefined, pid, false);
      continue;
    }
    if (!run.drone.isValid) {
      endDrone(p, pid, true);
      continue;
    }
    if (now >= run.until || p.isSneaking) {
      endDrone(p, pid, false);
      continue;
    }
    const d = run.drone;
    if (isEmpd(d)) continue;
    const v = p.getViewDirection();
    let next = add(d.location, mul(v, 0.55));
    // 操縦者から 64 ブロックまで
    const off = sub(next, run.origin);
    if (len(off) > DEP.recon_drone.range) next = add(run.origin, mul(norm(off), DEP.recon_drone.range));
    if (!isLoaded(d.dimension, next, now)) continue;
    const blocked = safe("drone.block", () => {
      const b = d.dimension.getBlock(next);
      return !!b && !b.isAir && !b.isLiquid;
    });
    if (!blocked) safe("drone.move", () => d.teleport(next, { facingLocation: add(next, v) }));
    if (run.camera) safe("drone.cam", () => p.camera.setCamera("minecraft:free", { location: add(d.location, { x: 0, y: 0.2, z: 0 }), rotation: p.getRotation(), easeOptions: { easeTime: 0.05 } }));
    // マーキング（見えている敵、5 tick ごと）
    if (now % 5 === 0) {
      safe("drone.mark", () => {
        for (const c of d.dimension.getEntities({ location: d.location, maxDistance: 28, families: ["arsenal_enemy"] })) {
          const to = sub(c.getAABB().center, d.location);
          if (dot(norm(to), v) < 0.6) continue;
          if (!hasLosTo(d.dimension, d.location, c.getAABB().center)) continue;
          if ((run.marked.get(c.id) ?? 0) > now) continue;
          run.marked.set(c.id, now + 200);
          emit(c.dimension, "arsenal:lock_marker", add(c.getAABB().center, { x: 0, y: 1.2, z: 0 }), undefined, { range: 96 });
          playTo(p, "arsenal.fx.lock_beep", { volume: 0.6 });
          markFor(c, 200);
        }
      });
    }
    if (now % 40 === 0) playNear(d.dimension, d.location, "arsenal.world.drone", { range: 24, volume: 0.5 });
  }
}

/** ドローン・スナップグレネードで見つけた敵（ほかのシステムが参照） @type {Map<string, number>} */
const spotted = new Map();
/** @param {import("@minecraft/server").Entity} e @param {number} ticks */
export function markFor(e, ticks) {
  spotted.set(e.id, system.currentTick + ticks);
}
/** @param {string} id */
export function isSpotted(id) {
  const u = spotted.get(id);
  return u !== undefined && u > system.currentTick;
}

// ---------------------------------------------------------------------------
//  ループ・イベント
// ---------------------------------------------------------------------------

export function tickDeployables() {
  const now = system.currentTick;
  // 索敵（予算内）
  const sentries = [];
  for (const d of deps.values()) if (d.kind === "sentry") sentries.push(d);
  for (let i = 0; i < Math.min(SCANS_PER_TICK, sentries.length); i++) {
    const d = sentries[(scanCursor + i) % sentries.length];
    if (d.ent.isValid && now - d.scanTick >= 10) {
      d.scanTick = now;
      if (!isEmpd(d.ent)) sentryScan(d);
    }
  }
  scanCursor = sentries.length ? (scanCursor + SCANS_PER_TICK) % sentries.length : 0;
  for (const d of [...deps.values()]) {
    if (!d.ent.isValid) {
      deps.delete(d.id);
      continue;
    }
    if (!isLoaded(d.ent.dimension, d.ent.location, now)) continue;
    safe(`dep.${d.kind}`, () => {
      if (d.kind === "sentry") sentryTick(d, now);
      else if (d.kind === "claymore") claymoreTick(d, now);
      else if (d.kind === "ammo_station") ammoStationTick(d, now);
      else if (d.kind === "med_station") medStationTick(d, now);
    });
    if (d.ammoDirty && now % 40 === 0) {
      d.ammoDirty = false;
      safe("dep.ammo.save", () => d.ent.setDynamicProperty("a:ammo", d.ammo));
    }
  }
  tickDrones();
  if (now % 200 === 0) for (const [id, u] of spotted) if (u <= now) spotted.delete(id);
}

export function attachDeployables() {
  world.afterEvents.entitySpawn.subscribe((ev) => safe("dep.spawn", () => {
    if (ev.entity.isValid && kindOf(ev.entity)) register(ev.entity);
  }));
  const load = /** @type {any} */ (world.afterEvents).entityLoad;
  if (load && typeof load.subscribe === "function") load.subscribe((/** @type {any} */ ev) => safe("dep.load", () => {
    if (ev.entity?.isValid && kindOf(ev.entity)) register(ev.entity);
  }));
  world.afterEvents.entityRemove.subscribe((ev) => {
    deps.delete(ev.removedEntityId);
  });
  world.afterEvents.playerInteractWithEntity.subscribe((ev) => safe("dep.interact", () => {
    const e = ev.target;
    const k = kindOf(e);
    if (!k) return;
    const p = ev.player;
    if (k === "mortar_emplacement") {
      system.run(() => useMortarEmplacement(p, e));
      return;
    }
    // スニークして触ると回収（持ち主のみ）。砲台は残弾も戻す
    if (p.isSneaking && safe("dep.own3", () => e.getDynamicProperty("a:own")) === p.id && k !== "recon_drone") {
      const itemId = Object.entries(DEP).find(([, v]) => v.entity === k)?.[0];
      const d = deps.get(e.id);
      if (d && k === "sentry" && d.ammo > 0 && safe("dep.inf", () => e.getDynamicProperty("a:inf")) !== true) {
        const id = ammoItemId(SENTRY.ammo, "std");
        if (id) giveItem(p, id, d.ammo);
      }
      if (d) deps.delete(d.id);
      safe("dep.pick", () => e.remove());
      if (itemId && safe("dep.inf2", () => e.getDynamicProperty("a:inf")) !== true) giveItem(p, `${NS}:${itemId}`, 1);
      playNear(p.dimension, p.location, "arsenal.gear.deploy", { range: 12, pitch: 1.3 });
    }
  }));
  // ドローンの持ち主が落ちたとき
  world.beforeEvents.playerLeave.subscribe((ev) => {
    const id = ev.player.id;
    system.run(() => endDrone(undefined, id, false));
  });
}

/** 設置物の数（報告用） */
export function deployableCount() {
  return deps.size;
}

/**
 * 砲台を置く（キルストリーク）
 * @param {Player} owner @param {import("../util/math.js").Vec3} pos @param {number} seconds
 */
export function dropSentry(owner, pos, seconds) {
  const e = safe("ks.sentry", () => owner.dimension.spawnEntity(`${NS}:sentry`, pos));
  if (!e) return undefined;
  safe("ks.sentry.setup", () => {
    e.setDynamicProperty("a:own", owner.id);
    e.setDynamicProperty("a:inf", true);
    e.setDynamicProperty("a:until", system.currentTick + seconds * 20);
    e.setDynamicProperty("a:born", system.currentTick);
  });
  const d = register(e);
  if (d) d.ammo = SENTRY.mag;
  return e;
}

