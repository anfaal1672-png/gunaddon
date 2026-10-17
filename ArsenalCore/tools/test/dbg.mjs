import path from "node:path"; import { pathToFileURL } from "node:url";
const run = path.resolve(".run");
console.info=()=>{};
const D = await import(pathToFileURL(path.join(run,"scripts/config/weapons.data.js")).href);
globalThis.__WEAPON_IDS = new Set(Object.keys(D.WEAPONS));
const mc = await import(pathToFileURL(path.join(run,"node_modules/@minecraft/server/index.js")).href);
const { world, system, ItemStack, Player, Entity, LOG, __tick, __overworld } = mc;
await import(pathToFileURL(path.join(run,"scripts/main.js")).href);
system.beforeEvents.startup.fire({ blockComponentRegistry:{registerCustomComponent(){}}, itemComponentRegistry:{registerCustomComponent(){}} });
const p = new Player(__overworld); world.players.push(p);
const S = (await import(pathToFileURL(path.join(run,"scripts/core/state.js")).href)).S;
for (const wid of ["flare_pistol","grinder","thumper","pulse_rifle"]) {
  p.inv.items[1] = new ItemStack(`arsenal:${wid}`,1); p.selectedSlotIndex=1; __tick(15);
  const s=S(p); const ev={source:p,itemStack:p.inv.getItem(1)};
  console.log(wid,'before',s.weaponId,s.ammo,s.mode,s.shotTimer, s.stats?.fire);
  world.afterEvents.itemStartUse.fire(ev); __tick(30); world.afterEvents.itemStopUse.fire(ev); __tick(5);
  console.log(wid,'after', s.ammo, p.inv.items[1].props['a:ammo'], 'spin',s.spin, 'status', JSON.stringify(s.statusMsg));
  p.selectedSlotIndex=0; __tick(3);
}
