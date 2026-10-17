// ARSENAL CORE — ランタイムのスモークテスト（モック環境でゲームループを実際に回す）
//   node tools/test/run.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const run = path.join(here, ".run");
if (!process.env.KEEP) fs.rmSync(run, { recursive: true, force: true });
fs.mkdirSync(path.join(run, "node_modules"), { recursive: true });
fs.cpSync(path.join(root, "ArsenalCore_BP", "scripts"), path.join(run, "scripts"), { recursive: true });
fs.cpSync(path.join(here, "mock", "@minecraft"), path.join(run, "node_modules", "@minecraft"), { recursive: true });
fs.writeFileSync(path.join(run, "package.json"), '{"type":"module"}');

// 乱数を固定（拡散・散弾・ジャムの抽選で結果が揺れないように）
let seed = 0x2f6e2b1;
Math.random = () => {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const warnings = [];
const origWarn = console.warn;
console.warn = (...a) => { warnings.push(a.join(" ")); };
console.info = () => {};

const D = await import(pathToFileURL(path.join(run, "scripts", "config", "weapons.data.js")).href);
globalThis.__WEAPON_IDS = new Set([...Object.keys(D.WEAPONS), ...Object.keys(D.VARIANT_OF ?? {})]);
const FAM_OF = new Map();
for (const [id, e] of Object.entries({ ...D.ENEMIES, ...D.BOSSES })) FAM_OF.set(`arsenal:${id}`, ["arsenal_enemy", D.FACTIONS[e.faction].family, "monster", "mob", ...(["robot", "shield_bot", "mortar_bot", "drone", "juggernaut"].includes(e.model) ? ["arsenal_robot"] : []), ...(e.flying ? ["arsenal_flying"] : []), ...(e.phases ? ["arsenal_boss"] : [])]);
for (const k of ["sentry", "shield_wall", "claymore", "ammo_station", "med_station", "mortar_emplacement", "recon_drone"]) FAM_OF.set(`arsenal:${k}`, ["arsenal_deployable", "arsenal_player_deployable", `arsenal_${k}`]);
for (const k of Object.keys(D.VEHICLES)) FAM_OF.set(`arsenal:${k}`, ["arsenal_deployable", "arsenal_player_deployable", "arsenal_vehicle"]);
FAM_OF.set("arsenal:waypoint", ["arsenal_waypoint", "inanimate", "arsenal_fx"]);
FAM_OF.set("arsenal:storage", ["arsenal_storage", "inanimate", "arsenal_fx"]);
FAM_OF.set("arsenal:ai_shot", ["projectile", "arsenal_fx"]);
FAM_OF.set("arsenal:supply_crate", ["arsenal_crate", "inanimate"]);
FAM_OF.set("arsenal:quartermaster", ["arsenal_npc", "mob"]);
globalThis.__familyOf = (t) => FAM_OF.get(t);
globalThis.__healthOf = (t) => { const id = t.replace("arsenal:", ""); const e = D.ENEMIES[id] ?? D.BOSSES[id]; if (e) return e.health; const dd = Object.values(D.DEPLOYABLES).find((x) => x.entity === id); if (dd) return dd.health; if (D.VEHICLES[id]) return D.VEHICLES[id].health; return undefined; };
const mc = await import(pathToFileURL(path.join(run, "node_modules", "@minecraft", "server", "index.js")).href);
const ui = await import(pathToFileURL(path.join(run, "node_modules", "@minecraft", "server-ui", "index.js")).href);
const { world, system, ItemStack, Player, Entity, LOG, __tick, __overworld, __use } = mc;

let failures = 0;
let passes = 0;
function check(name, cond, info = "") {
  if (cond) { passes++; console.log(`  ✔ ${name}`); }
  else { failures++; console.log(`  ✘ ${name} ${info}`); }
}

// ---- 起動 ----
const comps = { block: {}, item: {} };
await import(pathToFileURL(path.join(run, "scripts", "main.js")).href);
system.beforeEvents.startup.fire({
  blockComponentRegistry: { registerCustomComponent: (n, c) => (comps.block[n] = c) },
  itemComponentRegistry: { registerCustomComponent: (n, c) => (comps.item[n] = c) },
  customCommandRegistry: {}, dimensionRegistry: {},
});
world.afterEvents.worldLoad.fire({});
const player = new Player(__overworld);
player.setDynamicProperty("arsenal:prefs", JSON.stringify({ hudStyle: "classic" }));  // 1.0.2 の試験は従来の HUD で行う
world.players.push(player);
world.afterEvents.playerSpawn.fire({ player, initialSpawn: true });
__tick(2);

async function flush() { for (let i = 0; i < 5; i++) await Promise.resolve(); }
const snippet = process.argv[2];
const mod = await import(pathToFileURL(path.resolve(snippet)).href);
await mod.default({ mc, ui, D, run, player, check, flush, warnings, comps, LOG, world, system, ItemStack, Player, Entity, __tick, __overworld });
console.log(`\n${passes} passed, ${failures} failed`);
console.warn = origWarn;
for (const w of warnings.slice(0, 5)) console.log("WARN", w.slice(0, 400));
