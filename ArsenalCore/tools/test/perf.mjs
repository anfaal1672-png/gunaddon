// ARSENAL CORE — ランタイムのスモークテスト（モック環境でゲームループを実際に回す）
//   node tools/test/run.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const run = path.join(here, ".run_perf");
fs.rmSync(run, { recursive: true, force: true });
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
globalThis.__onSpawnEntity = (e) => { if (e.typeId === "arsenal:storage") e.comps["minecraft:inventory"] = { container: new mc.Container(54) }; };
const player = new Player(__overworld);
player.setDynamicProperty("arsenal:prefs", JSON.stringify({ hudStyle: "classic" }));  // 1.0.2 の試験は従来の HUD で行う
world.players.push(player);
world.afterEvents.playerSpawn.fire({ player, initialSpawn: true });
__tick(2);

// ---- 負荷試験：プレイヤー 20 人（全員フルオート射撃）＋敵 60 体（3 勢力）を 600 tick ----
const { spawnEnemy, aiStats, allAI } = await import(pathToFileURL(path.join(run, "scripts", "systems", "ai", "brain.js")).href);
const players = [player];
for (let i = 1; i < 20; i++) {
  const p = new Player(__overworld);
  p.name = `P${i}`;
  // PERF_MOBILE=1：全員スマホ（演出品質「自動」が中になる）
  if (process.env.PERF_MOBILE) p.clientSystemInfo = { platformType: "Mobile" };
  p.setDynamicProperty("arsenal:prefs", JSON.stringify({ hudStyle: i % 2 ? "hud2" : "classic" }));
  world.players.push(p);
  world.afterEvents.playerSpawn.fire({ player: p, initialSpawn: true });
  players.push(p);
}
const guns = ["sentinel", "hornet", "juggernaut", "mako", "bastion"];
players.forEach((p, i) => {
  p.location = { x: -40 + (i % 5) * 20 + 0.5, y: 64, z: -30 + Math.floor(i / 5) * 20 + 0.5 };
  p.inv.items[0] = new ItemStack(`arsenal:${guns[i % guns.length]}`, 1);
  p.inv.items[1] = new ItemStack("arsenal:ammo_medium", 64);
  p.inv.items[2] = new ItemStack("arsenal:ammo_light", 64);
  p.inv.items[3] = new ItemStack("arsenal:ammo_medium", 64);
  p.selectedSlotIndex = 0;
  p.gm = "Creative"; // 敵に倒されないように（射撃・AI・HUD の負荷はそのまま）
});
const kinds = Object.keys(D.ENEMIES);
for (let i = 0; i < 60; i++) {
  const p = players[i % players.length];
  spawnEnemy(__overworld, { x: p.location.x + ((i * 7) % 11) - 5, y: 64, z: p.location.z + 8 + (i % 3) * 3 }, kinds[i % kinds.length], { persist: true });
}
__tick(5);
for (const p of players) {
  const e = { source: p, itemStack: p.inv.getItem(0), useDuration: 72000 };
  world.afterEvents.itemStartUse.fire(e);
}
const times = [];
const t0 = aiStats().thinks;
const api0 = { ...LOG.api };
const sumOf = (o) => Object.values(o ?? {}).reduce((a, b) => a + b, 0);
const snd0 = sumOf(LOG.sounds);
const ptc0 = sumOf(LOG.particleIds);
for (let i = 0; i < 600; i++) {
  const a = performance.now();
  __tick(1);
  times.push(performance.now() - a);
  // エンジンの射撃 AI の代わり：武器を持つ敵が 1 秒に 1 回くらい合図（ai_shot）を撃つ
  let k = 0;
  for (const ai of allAI().values()) {
    if ((k++ + i) % 20 !== 0 || !ai.def.weapon || !ai.ent.isValid) continue;
    const tgt = players[k % players.length];
    const from = ai.ent.getHeadLocation();
    const d = { x: tgt.location.x - from.x, y: tgt.location.y + 1 - from.y, z: tgt.location.z - from.z };
    const L = Math.hypot(d.x, d.y, d.z) || 1;
    const shot = new Entity("arsenal:ai_shot", from, __overworld, 0);
    shot.comps["minecraft:projectile"] = { owner: ai.ent };
    shot.vel = { x: (d.x / L) * 3, y: (d.y / L) * 3, z: (d.z / L) * 3 };
    world.afterEvents.entitySpawn.fire({ entity: shot, cause: "Spawned" });
  }
  if (i % 40 === 39) for (const p of players) {
    // 撃ち続ける（弾を補充）
    const it = p.inv.items[1]; if (it) it.amount = 64; else p.inv.items[1] = new ItemStack("arsenal:ammo_medium", 64);
    p.inv.items[2] = new ItemStack("arsenal:ammo_light", 64);
  }
}
times.sort((a, b) => a - b);
const avg = times.reduce((a, b) => a + b, 0) / times.length;
const p99 = times[Math.floor(times.length * 0.99)];
const st = aiStats();
const thinksPerTick = (st.thinks - t0) / 600;
const api = Object.fromEntries(Object.entries(LOG.api).map(([k, v]) => [k, (v - api0[k]) / 600]));
console.log(`perf: API/tick blockRay ${api.blockRay.toFixed(1)} entityRay ${api.entityRay.toFixed(1)} getEntities ${api.getEntities.toFixed(1)} getBlock ${api.getBlock.toFixed(1)}`);
const fireSnd = Object.entries(LOG.sounds).filter(([k2]) => k2.startsWith("arsenal.fire.")).reduce((a, [, v]) => a + v, 0);
console.log(`perf: player+AI gunshot sounds ${fireSnd}`);
if (process.env.PERF_DUMP) {
  console.log(JSON.stringify(Object.entries(LOG.particleIds).sort((a, b) => b[1] - a[1]).slice(0, 15)));
  console.log(JSON.stringify(Object.entries(LOG.sounds).sort((a, b) => b[1] - a[1]).slice(0, 15)));
}
console.log(`perf: sends/tick sounds ${((sumOf(LOG.sounds) - snd0) / 600).toFixed(1)} particles ${((sumOf(LOG.particleIds) - ptc0) / 600).toFixed(1)}`);
console.log(`perf: avg ${avg.toFixed(2)} ms/tick, p99 ${p99.toFixed(2)} ms, max ${times.at(-1).toFixed(2)} ms, AI thinks/tick ${thinksPerTick.toFixed(2)} (max ${st.maxThinkPerTick}), AI shots ${st.shots}, warnings ${warnings.length}`);
check("負荷：平均 15 ms/tick 未満（モック環境）", avg < 15, `(${avg.toFixed(2)})`);
check("負荷：99 パーセンタイル 50 ms 未満", p99 < 50, `(${p99.toFixed(2)})`);
check("負荷：AI の思考は 1 tick 8 体以下", st.maxThinkPerTick <= D.AI_BUDGET.thinkPerTick);
// API 呼び出しの予算（1 tick あたり。DESIGN_DECISIONS.md「性能予算」）
const API_BUDGET = { blockRay: 60, entityRay: 60, getEntities: 200, getBlock: 60 };
for (const [k, lim] of Object.entries(API_BUDGET)) check(`負荷：${k} は 1 tick ${lim} 回以内`, api[k] <= lim, `(${api[k].toFixed(1)})`);
check("負荷：敵の射撃（合図の横取り）が処理される", st.shots > 300, `(${st.shots})`);
check("負荷：プレイヤーが撃ち続けている", fireSnd > 2000, `(${fireSnd})`);
check("負荷：600 tick の間に例外なし", warnings.length === 0, warnings.slice(0, 3).join(" | "));
console.log(`\n${passes} passed, ${failures} failed`);
console.warn = origWarn;
fs.rmSync(run, { recursive: true, force: true });
process.exit(failures ? 1 : 0);
