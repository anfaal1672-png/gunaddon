// @ts-check
/**
 * 射撃練習ターゲット：部位・ダメージ・DPS・距離を頭上に表示
 */
import { system, world, Player, ItemStack } from "@minecraft/server";
import { ENTITY, ITEM } from "../config/constants.js";
import { safe } from "../util/log.js";

/** @type {Map<string, {hits:{tick:number,dmg:number}[], total:number, last:number, lastZone:string, lastDmg:number, dist:number, shooter:string, weapon:string}>} */
const stats = new Map();

/**
 * @param {Player} shooter @param {import("@minecraft/server").Entity} dummy @param {number} dmg @param {string} zone @param {number} distance @param {string} weaponId
 */
export function onDummyHit(shooter, dummy, dmg, zone, distance, weaponId) {
  const now = system.currentTick;
  let s = stats.get(dummy.id);
  if (!s || now - s.last > 100) s = { hits: [], total: 0, last: now, lastZone: zone, lastDmg: dmg, dist: distance, shooter: shooter.name, weapon: weaponId };
  s.hits.push({ tick: now, dmg });
  s.total += dmg;
  s.last = now;
  s.lastZone = zone;
  s.lastDmg = dmg;
  s.dist = distance;
  s.shooter = shooter.name;
  s.weapon = weaponId;
  stats.set(dummy.id, s);
  render(dummy, s);
  safe("dummy.anim", () => dummy.playAnimation("animation.arsenal.dummy.wobble", { controller: "arsenal_wobble", blendOutTime: 0.1 }));
}

/** @param {import("@minecraft/server").Entity} dummy @param {any} s */
function render(dummy, s) {
  const now = system.currentTick;
  const recent = s.hits.filter((/** @type {any} */ h) => now - h.tick <= 60);
  s.hits = recent;
  const span = recent.length > 1 ? Math.max(1, recent[recent.length - 1].tick - recent[0].tick) / 20 : 1;
  const dps = recent.length > 1 ? recent.reduce((a, /** @type {any} */ h) => a + h.dmg, 0) / span : s.lastDmg;
  const zc = s.lastZone === "head" ? "§c" : s.lastZone === "leg" ? "§9" : "§e";
  const zl = s.lastZone === "head" ? "HEAD" : s.lastZone === "leg" ? "LEG" : "BODY";
  safe("dummy.name", () => {
    dummy.nameTag = `${zc}${zl} §f${s.lastDmg.toFixed(1)}\n§7DPS §a${dps.toFixed(1)} §7| TOTAL §b${s.total.toFixed(0)}\n§8${s.dist.toFixed(1)}m`;
  });
}

/** 一定時間撃たれなければリセット */
export function tickDummies() {
  const now = system.currentTick;
  for (const [id, s] of stats) {
    if (now - s.last > 100) {
      stats.delete(id);
      safe("dummy.reset", () => {
        const e = world.getEntity(id);
        if (e && e.isValid) e.nameTag = "§7-- READY --";
      });
    }
  }
}

/** スニークしながら殴ると回収 */
export function attachDummyPickup() {
  world.afterEvents.entityHitEntity.subscribe((ev) => {
    safe("dummy.pickup", () => {
      const p = ev.damagingEntity;
      const e = ev.hitEntity;
      if (!(p instanceof Player) || e.typeId !== ENTITY.dummy || !p.isSneaking) return;
      const loc = e.location;
      const dim = e.dimension;
      stats.delete(e.id);
      e.remove();
      dim.spawnItem(new ItemStack(ITEM.targetKit, 1), loc);
    });
  });
  world.afterEvents.entitySpawn.subscribe((ev) => {
    safe("dummy.spawn", () => {
      if (ev.entity.typeId === ENTITY.dummy) ev.entity.nameTag = "§7-- READY --";
    });
  });
}
