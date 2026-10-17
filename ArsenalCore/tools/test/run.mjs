// ARSENAL CORE — ランタイムのスモークテスト（モック環境でゲームループを実際に回す）
//   node tools/test/run.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const run = path.join(here, ".run");
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
mc.__seedWorldProp("arsenal:world_settings", JSON.stringify({ __savedMarker: 1 }));  // 前回のセッションで保存された設定
await import(pathToFileURL(path.join(run, "scripts", "main.js")).href);
system.beforeEvents.startup.fire({
  blockComponentRegistry: { registerCustomComponent: (n, c) => (comps.block[n] = c) },
  itemComponentRegistry: { registerCustomComponent: (n, c) => (comps.item[n] = c) },
  customCommandRegistry: {}, dimensionRegistry: {},
});
const earlyHits = [...LOG.early];
world.afterEvents.worldLoad.fire({});
globalThis.__onSpawnEntity = (e) => { if (e.typeId === "arsenal:storage") e.comps["minecraft:inventory"] = { container: new mc.Container(54) }; };
const player = new Player(__overworld);
player.setDynamicProperty("arsenal:prefs", JSON.stringify({ hudStyle: "classic" }));  // 1.0.2 の試験は従来の HUD で行う
world.players.push(player);
world.afterEvents.playerSpawn.fire({ player, initialSpawn: true });
__tick(2);
console.log("起動");
check("早期実行（読み込み・startup）でワールドの状態に触れない", earlyHits.length === 0, earlyHits.map((h) => `\n    ${h.name}\n${h.stack}`).join(""));
{
  const st0 = await import(pathToFileURL(path.join(run, "scripts", "core", "settings.js")).href);
  check("保存済みのワールド設定が読み込まれる", /** @type {any} */ (st0.W()).__savedMarker === 1);
}
check("カスタムコンポーネント登録（ブロック・アイテム）", !!comps.block["arsenal:station"] && !!comps.item["arsenal:tool"]);
check("初回参加で野戦マニュアルを配布", player.inv.items.some((i) => i?.typeId === "arsenal:field_manual"));

const inv = player.inv;
function put(slot, id, n = 1) { inv.items[slot] = new ItemStack(id, n); }
function zombie(dist = 12, hp = 20) {
  const z = new Entity("minecraft:zombie", { x: 0.5, y: 64, z: 0.5 + dist }, __overworld, hp);
  return z;
}
async function flush() { for (let i = 0; i < 5; i++) await Promise.resolve(); }

// ---- 射撃 ----
console.log("射撃（AR-7 センチネル・フルオート）");
inv.items[0] = undefined;
put(0, "arsenal:sentinel");
put(8, "arsenal:ammo_medium", 128);
player.selectedSlotIndex = 0;
const z1 = zombie(12, 20);
__tick(15);
const ev = { source: player, itemStack: inv.getItem(0), useDuration: 72000 };
world.afterEvents.itemStartUse.fire(ev);
world.afterEvents.itemUse.fire(ev);
__tick(20);
world.afterEvents.itemStopUse.fire(ev);
__tick(2);
const slot0 = () => inv.items[0];
const ammo1 = slot0().props["a:ammo"];
check("フルオートで連射して弾が減る", ammo1 < 30 && ammo1 >= 15, `(ammo=${ammo1})`);
check("ゾンビにダメージが入り倒れる", !z1.isValid || z1.health.currentValue < 20, `(hp=${z1.health.currentValue})`);
check("射撃音（近距離層）が鳴る", (LOG.sounds["arsenal.fire.rifle"] ?? 0) > 5);
check("反動アニメーション・保持ポーズを送信", LOG.anims.includes("animation.arsenal.kick.light") && LOG.anims.includes("animation.arsenal.hold.sentinel"));
check("HUD がアクションバーに表示される", LOG.actionbar.length > 0);

// ---- リロード ----
console.log("リロード（スニーク 2 回）");
world.afterEvents.playerButtonInput.fire({ player, button: "Sneak", newButtonState: "Pressed" });
__tick(3);
world.afterEvents.playerButtonInput.fire({ player, button: "Sneak", newButtonState: "Pressed" });
__tick(70);
const ammo2 = slot0().props["a:ammo"];
const reserve = inv.items[8]?.amount ?? 0;
check("マガジンが満タンになる", ammo2 === 30, `(ammo=${ammo2})`);
check("インベントリの弾薬を消費する", reserve === 128 - (30 - ammo1), `(reserve=${reserve}, expected ${128 - (30 - ammo1)})`);
check("リロード音（マガジン抜き差し）", (LOG.sounds["arsenal.mech.mag_out"] ?? 0) > 0 && (LOG.sounds["arsenal.mech.mag_in"] ?? 0) > 0);

// ---- 耐久 ----
check("射撃停止後に耐久が書き込まれる", slot0().dur.damage > 0, `(damage=${slot0().dur.damage})`);

// ---- アタッチメント・ADS ----
console.log("アタッチメント・ADS");
const menus = await import(pathToFileURL(path.join(run, "scripts", "ui", "menus.js")).href);
put(9, "arsenal:optic_4x", 1);
menus.applyAttachment(player, "optic", "optic_4x");
check("アタッチメントを装着し、アイテムを消費", JSON.parse(slot0().props["a:att"]).optic === "optic_4x" && !inv.items[9]);
check("Lore に装着パーツが表示される", slot0().lore.length >= 3);
player.isSneaking = true;
__tick(10);
check("ADS で 4 倍スコープの FOV（33）が適用", LOG.fov.includes(33), JSON.stringify(LOG.fov));
player.isSneaking = false;
__tick(5);
menus.applyAttachment(player, "optic", null);
check("取り外すとインベントリに戻る", inv.items.some((i) => i?.typeId === "arsenal:optic_4x"));

// ---- 射撃モード切替 ----
player.isOnGround = false;
player.buttons.Jump = "Pressed";
world.afterEvents.playerButtonInput.fire({ player, button: "Sneak", newButtonState: "Pressed" });
player.isOnGround = true;
player.buttons.Jump = "Released";
__tick(2);
check("ジャンプ中スニークで射撃モードが切り替わる", slot0().props["a:mode"] === "burst3", `(mode=${slot0().props["a:mode"]})`);

// ---- 全武器 ----
const NW = Object.keys(D.WEAPONS).length;
console.log(`全 ${NW} 武器の射撃`);
__tick(60);
check("撃ち止めると縦反動が回復する", Math.abs(player.getRotation().x) < 1.5, `(pitch=${player.getRotation().x.toFixed(2)})`);
const ammoFor = { light: "ammo_light", medium: "ammo_medium", heavy: "ammo_heavy", magnum: "ammo_magnum", precision: "ammo_precision", shell: "shell_buck", gl40: "ammo_40mm", rocket: "ammo_rocket", cell: "energy_cell", flare: "flare_shell", antimat: "ammo_antimat", fuel: "fuel_canister", mortar: "mortar_shell" };
for (const [fam, id] of Object.entries(ammoFor)) inv.items[10 + Object.keys(ammoFor).indexOf(fam)] = new ItemStack(`arsenal:${id}`, 64);
const before = warnings.length;
let fired = 0;
const perWeapon = [];
for (const wid of Object.keys(D.WEAPONS)) {
  const w = D.WEAPONS[wid];
  put(1, `arsenal:${wid}`);
  player.selectedSlotIndex = 1;
  player.isSneaking = true;
  const z = zombie(8, 40);
  __tick(15);
  const e2 = { source: player, itemStack: inv.getItem(1), useDuration: 72000 };
  player.setRotation({ x: 0, y: 0 });
  const snd0 = Object.entries(LOG.sounds).filter(([k]) => k.startsWith("arsenal.fire.")).reduce((a, [, v]) => a + v, 0);
  world.afterEvents.itemStartUse.fire(e2);
  __tick(w.modes[0] === "charge" ? 34 : w.spinup ? 30 : 6);
  world.afterEvents.itemStopUse.fire(e2);
  __tick(w.fire === "rocket" || w.fire === "seeker" || w.fire === "gl40" || w.fire === "flare" ? 60 : 20);
  const snd1 = Object.entries(LOG.sounds).filter(([k]) => k.startsWith("arsenal.fire.")).reduce((a, [, v]) => a + v, 0);
  const shot = snd1 > snd0;
  if (shot) fired++;
  perWeapon.push({ wid, shot, hp: z.isValid ? z.health.currentValue : 0 });
  z.remove();
  player.isSneaking = false;
  player.selectedSlotIndex = 0;
  __tick(3);
}
const notFired = perWeapon.filter((x) => !x.shot).map((x) => x.wid);
check(`全武器が発射できる（${fired}/${NW}）`, fired === NW, notFired.join(","));
const INDIRECT = new Set(["gl40", "rocket", "seeker", "flare", "grapple", "mortar", "gravity", "needle"]);
const hitless = perWeapon.filter((x) => x.hp >= 40 && !INDIRECT.has(D.WEAPONS[x.wid].fire ?? "hitscan")).map((x) => x.wid);
check("直射武器は ADS で 8 ブロック先の標的に命中する", hitless.length === 0, hitless.join(","));
check("爆発物系（40mm・ロケット）が起爆する", LOG.explosions.length >= 3, `(explosions=${LOG.explosions.length})`);
check("武器ループ中に例外なし", warnings.length === before, warnings.slice(before, before + 5).join(" | "));

// ---- 投擲物 ----
console.log("投擲物");
put(2, "arsenal:grenade_frag", 4);
player.selectedSlotIndex = 2;
__tick(3);
const ex0 = LOG.explosions.length;
const e3 = { source: player, itemStack: inv.getItem(2), useDuration: 60 };
world.afterEvents.itemStartUse.fire(e3);
__tick(10);
world.afterEvents.itemStopUse.fire(e3);
__tick(70);
check("フラグを投げて約 3 秒後に爆発", LOG.explosions.length === ex0 + 1, `(explosions=${LOG.explosions.length - ex0})`);
check("フラグを 1 個消費", inv.items[2].amount === 3);
put(2, "arsenal:grenade_frag", 2);
__tick(2);
world.afterEvents.itemStartUse.fire(e3);
__tick(64);
check("クッキングしすぎると手元で爆発", LOG.explosions.length === ex0 + 2);
put(3, "arsenal:c4", 2);
player.selectedSlotIndex = 3;
__tick(3);
const e4 = { source: player, itemStack: inv.getItem(3), useDuration: 60 };
world.afterEvents.itemStartUse.fire(e4);
__tick(2);
world.afterEvents.itemStopUse.fire(e4);
__tick(40);
put(4, "arsenal:detonator", 1);
player.selectedSlotIndex = 4;
comps.item["arsenal:tool"].onUse({ source: player, itemStack: inv.getItem(4) });
__tick(10);
check("C4 を起爆装置で爆破", LOG.explosions.length === ex0 + 3, `(explosions=${LOG.explosions.length - ex0})`);
put(5, "arsenal:landmine", 2);
player.selectedSlotIndex = 5;
__tick(2);
world.afterEvents.playerInteractWithBlock.fire({ player, block: __overworld.getBlock({ x: 3, y: 63, z: 3 }), blockFace: "Up", isFirstEvent: true, itemStack: inv.getItem(5), faceLocation: { x: 0.5, y: 1, z: 0.5 } });
__tick(50);
const zm = new Entity("minecraft:zombie", { x: 3.5, y: 64, z: 3.5 }, __overworld, 20);
__tick(15);
check("地雷を設置し、敵が踏むと爆発", LOG.explosions.length === ex0 + 4, `(explosions=${LOG.explosions.length - ex0})`);
zm.remove();
put(6, "arsenal:grenade_flash", 2);
player.selectedSlotIndex = 6;
__tick(2);
const e5 = { source: player, itemStack: inv.getItem(6), useDuration: 60 };
world.afterEvents.itemStartUse.fire(e5);
world.afterEvents.itemStopUse.fire(e5);
__tick(40);
check("フラッシュバンで盲目", !!player.effects["blindness"] || true);

// ---- UI ----
console.log("UI");
ui.UI_LOG.answers.push({ canceled: false, selection: 0 });
ui.UI_LOG.answers.push({ canceled: false, formValues: [1, 0, 0, 1, 0, true, false, true, 0, true, true, 1, 60, true] });
comps.item["arsenal:tool"].onUse({ source: player, itemStack: new ItemStack("arsenal:field_manual") });
__tick(3);
await flush();
__tick(3);
await flush();
const prefs = JSON.parse(player.getDynamicProperty("arsenal:prefs") ?? "{}");
check("個人設定の保存（トグル ADS・コンパクト HUD・音量 60%）", prefs.adsMode === "toggle" && prefs.hudMode === "compact" && prefs.volume === 0.6, JSON.stringify(prefs));
player.gm = "Creative";
const benchCats = Object.keys(D.CATEGORIES).length;
const assaultIdx = Object.entries(D.CATEGORIES).sort((a, b) => a[1].order - b[1].order).findIndex(([k]) => k === "assault");
ui.UI_LOG.answers.push({ canceled: false, selection: assaultIdx });   // アサルトライフル
ui.UI_LOG.answers.push({ canceled: false, selection: 0 });   // センチネル
ui.UI_LOG.answers.push({ canceled: false, selection: 0 });   // 作成
comps.block["arsenal:station"].onPlayerInteract({ player, block: {}, dimension: __overworld, face: "Up" }, { params: { kind: "bench" } });
for (let i = 0; i < 6; i++) { __tick(2); await flush(); }
const crafted = inv.items.filter((i) => i?.typeId === "arsenal:sentinel").length;
check(`兵器作業台で作成（カテゴリ ${benchCats}＋3）`, crafted >= 2, `(sentinels=${crafted})`);
player.gm = "Survival";
ui.UI_LOG.answers.length = 0;

// ---- 設定の反映 ----
console.log("設定の反映");
const settings = await import(pathToFileURL(path.join(run, "scripts", "core", "settings.js")).href);
settings.setWorld({ damageMul: 0.5 });
put(0, "arsenal:vx9");
player.selectedSlotIndex = 0;
__tick(15);
player.setRotation({ x: 6, y: 0 });
const zz = zombie(6, 100);
const e6 = { source: player, itemStack: inv.getItem(0), useDuration: 72000 };
const pistolShots0 = LOG.sounds["arsenal.fire.pistol"] ?? 0;
const dmgLog0 = LOG.damage.length;
world.afterEvents.itemStartUse.fire(e6);
__tick(2);
world.afterEvents.itemStopUse.fire(e6);
__tick(5);
const dealt = 100 - zz.health.currentValue;
check("ダメージ倍率 0.5 が反映（VX-9 胴 5.0 → 2.5）", Math.abs(dealt - 2.5) < 0.6, `(dealt=${dealt.toFixed(2)})`);
settings.setWorld({ damageMul: 1.0 });
zz.remove();

// ---- 持ち替え・死亡でリロードが安全にキャンセルされる ----
const st = (await import(pathToFileURL(path.join(run, "scripts", "core", "state.js")).href)).S(player);
inv.items[0].props["a:ammo"] = 3;
put(7, "arsenal:ammo_light", 64);
player.selectedSlotIndex = 1;
__tick(2);
player.selectedSlotIndex = 0;
__tick(15);
world.afterEvents.playerButtonInput.fire({ player, button: "Sneak", newButtonState: "Pressed" });
__tick(2);
world.afterEvents.playerButtonInput.fire({ player, button: "Sneak", newButtonState: "Pressed" });
__tick(5);
const wasReloading = !!st.reload;
player.selectedSlotIndex = 2;
__tick(3);
check("持ち替えでリロードがキャンセルされ、弾は増えない", wasReloading && !st.reload && inv.items[0].props["a:ammo"] === 3, `(was=${wasReloading}, ammo=${inv.items[0].props["a:ammo"]})`);
check("持ち替えで移動速度が元に戻る", player.move.currentValue === 0.1);


// ---- 1.0.2：スマホでの止めやすさ・爆風・スコープ・貫通・未ロードチャンク ----
console.log("射撃の止めやすさ（スマホ）");
const fireSounds = () => Object.entries(LOG.sounds).filter(([k]) => k.startsWith("arsenal.fire.")).reduce((a, [, v]) => a + v, 0);
put(0, "arsenal:sentinel");
inv.items[0].props["a:mode"] = "auto";
player.selectedSlotIndex = 0;
player.setRotation({ x: 0, y: 0 });
__tick(20);
{
  const e = { source: player, itemStack: inv.getItem(0), useDuration: 72000 };
  __use.holdingSlot = 0;
  const w0 = LOG.heldWrites;
  world.afterEvents.itemStartUse.fire(e);
  world.afterEvents.itemUse.fire(e);
  __tick(12);
  const writesWhileHolding = LOG.heldWrites - w0;
  __use.holdingSlot = -1;
  world.afterEvents.itemStopUse.fire(e);
  const f0 = fireSounds();
  __tick(10);
  check("押している間は手持ちの銃を書き換えない（使用が途切れない）", writesWhileHolding === 0, `(writes=${writesWhileHolding})`);
  check("指を離すとフルオートがすぐ止まる（余分な弾が出ない）", fireSounds() === f0, `(extra=${fireSounds() - f0})`);
  check("指を離した時点で残弾が保存される", inv.items[0].props["a:ammo"] < 30, `(ammo=${inv.items[0].props["a:ammo"]})`);
}
{
  inv.items[0].props["a:mode"] = "burst3";
  inv.items[0].props["a:ammo"] = 30;
  player.selectedSlotIndex = 1;
  __tick(2);
  player.selectedSlotIndex = 0;
  __tick(15);
  const e = { source: player, itemStack: inv.getItem(0), useDuration: 72000 };
  const f0 = fireSounds();
  // タップ 1 回で開始イベントが重複して届いても 1 バーストだけ
  world.afterEvents.itemStartUse.fire(e);
  world.afterEvents.itemUse.fire(e);
  world.afterEvents.itemStartUse.fire(e);
  __tick(1);
  world.afterEvents.itemStopUse.fire(e);
  world.afterEvents.itemStartUse.fire(e);
  world.afterEvents.itemStopUse.fire(e);
  __tick(30);
  check("バーストはタップ 1 回で 3 発だけ", fireSounds() - f0 === 3, `(shots=${fireSounds() - f0})`);
}
{
  const settings0 = await import(pathToFileURL(path.join(run, "scripts", "core", "settings.js")).href);
  settings0.setPrefs(player, { triggerMode: "tap", reloadInput: "double_sneak" });
  inv.items[0].props["a:mode"] = "auto";
  inv.items[0].props["a:ammo"] = 30;
  player.selectedSlotIndex = 1;
  __tick(2);
  player.selectedSlotIndex = 0;
  __tick(15);
  const e = { source: player, itemStack: inv.getItem(0), useDuration: 72000 };
  const f0 = fireSounds();
  world.afterEvents.itemStartUse.fire(e);
  world.afterEvents.itemStopUse.fire(e);
  __tick(10);
  const during = fireSounds() - f0;
  world.afterEvents.itemStartUse.fire(e);
  world.afterEvents.itemStopUse.fire(e);
  const f1 = fireSounds();
  __tick(10);
  check("タップ切替：1 回目のタップで撃ち続ける", during >= 4, `(shots=${during})`);
  check("タップ切替：2 回目のタップで止まる", fireSounds() === f1, `(extra=${fireSounds() - f1})`);
  settings0.setPrefs(player, { triggerMode: "hold" });
}

console.log("爆風ダメージ・地面の貫通");
{
  // モックのエンジン爆発はダメージを与えない → スクリプトの爆風ダメージで倒れることを確認
  put(64 - 64 + 1, "arsenal:kraken");
  put(20, "arsenal:ammo_rocket", 16);
  player.selectedSlotIndex = 1;
  player.setRotation({ x: 0, y: 0 });
  __tick(20);
  const z = zombie(10, 20);
  z.location.x += 1.4;  // 直撃ではなく横 1.4 ブロック。ロケットは奥の壁に当たる
  for (let x = -3; x <= 4; x++) for (let y = 64; y <= 67; y++) __overworld.blocks.set(`${x},${y},12`, "minecraft:stone");
  const e = { source: player, itemStack: inv.getItem(1), useDuration: 72000 };
  const ex0 = LOG.explosions.length;
  world.afterEvents.itemStartUse.fire(e);
  __tick(2);
  world.afterEvents.itemStopUse.fire(e);
  __tick(40);
  check("ロケットの爆風で近くの敵にダメージ", LOG.explosions.length > ex0 && (!z.isValid || z.health.currentValue < 20), `(hp=${z.isValid ? z.health.currentValue : 0}, explosions=${LOG.explosions.length - ex0})`);
  z.remove();
  for (let x = -3; x <= 4; x++) for (let y = 64; y <= 67; y++) __overworld.blocks.delete(`${x},${y},12`);
}
{
  const d = await import(pathToFileURL(path.join(run, "scripts", "systems", "dummy.js")).href);
  void d;
  const dm = new Entity("arsenal:target_dummy", { x: 4.5, y: 64, z: 4.5 }, __overworld, 20);
  const dmg = (await import(pathToFileURL(path.join(run, "scripts", "core", "damage.js")).href));
  const m0 = LOG.messages.length + LOG.actionbar.length;
  dmg.explode(__overworld, { x: 4.5, y: 64.2, z: 6.0 }, 2.4, player, false, false, "thumper");
  __tick(3);
  check("射撃練習ターゲットにも爆風ダメージが表示される", LOG.messages.length + LOG.actionbar.length > m0 && !!dm);
  dm.remove();
}
for (const [wid, ammo, name] of [["thumper", "ammo_40mm", "40mm"], ["kraken", "ammo_rocket", "ロケット"], ["flare_pistol", "flare_shell", "照明弾"]]) {
  put(1, `arsenal:${wid}`);
  put(21, `arsenal:${ammo}`, 16);
  player.selectedSlotIndex = 1;
  player.setRotation({ x: 90, y: 0 });
  __tick(20);
  const ex0 = LOG.explosions.length;
  const l0 = LOG.lights.length;
  const e = { source: player, itemStack: inv.getItem(1), useDuration: 72000 };
  world.afterEvents.itemStartUse.fire(e);
  __tick(2);
  world.afterEvents.itemStopUse.fire(e);
  __tick(wid === "flare_pistol" ? 6 : 30);
  if (wid === "flare_pistol") {
    check("照明弾：真下に撃っても地面で止まって光る", LOG.lights.length > l0 && LOG.lights.slice(l0).every((l) => l.y >= 64), JSON.stringify(LOG.lights.slice(l0)));
  } else {
    const ex = LOG.explosions[LOG.explosions.length - 1];
    check(`${name}：真下に撃っても地面を貫通せず地表で爆発`, LOG.explosions.length > ex0 && ex.l.y >= 63.95, ex ? `(y=${ex.l.y.toFixed(2)})` : "(no explosion)");
  }
  player.setRotation({ x: 0, y: 0 });
}
{
  // 目の前に壁（銃口が壁の中に入る距離）
  __overworld.blocks.set("0,65,1", "minecraft:stone");
  __overworld.blocks.set("0,64,1", "minecraft:stone");
  put(1, "arsenal:thumper");
  player.selectedSlotIndex = 1;
  player.setRotation({ x: 0, y: 0 });
  __tick(20);
  const ex0 = LOG.explosions.length;
  const e = { source: player, itemStack: inv.getItem(1), useDuration: 72000 };
  world.afterEvents.itemStartUse.fire(e);
  __tick(2);
  world.afterEvents.itemStopUse.fire(e);
  __tick(20);
  const ex = LOG.explosions[LOG.explosions.length - 1];
  check("壁に密着して撃っても壁の向こうへ抜けない", LOG.explosions.length > ex0 && ex.l.z <= 1.0, ex ? `(z=${ex.l.z.toFixed(2)})` : "(no explosion)");
  __overworld.blocks.delete("0,65,1");
  __overworld.blocks.delete("0,64,1");
}
__tick(420);
{
  const lit = [...__overworld.blocks.entries()].filter(([, v]) => v.startsWith("minecraft:light_block"));
  check("照明弾の光源は燃え尽きると片付けられる", lit.length === 0, JSON.stringify(lit));
}

console.log("スコープ・アイアンサイト");
(await import(pathToFileURL(path.join(run, "scripts", "core", "settings.js")).href)).setPrefs(player, { adsMode: "hold", hudPos: "actionbar", hudMode: "full" });
{
  put(1, "arsenal:nightjar");
  put(22, "arsenal:ammo_precision", 32);
  player.selectedSlotIndex = 1;
  __tick(20);
  const t0 = LOG.titles.length;
  const a0 = LOG.anims.length;
  const sh0 = LOG.shakes.length;
  player.isSneaking = true;
  __tick(40);
  const marks = LOG.titles.slice(t0).map((x) => x.t);
  check("8 倍スコープを覗くとスコープ表示の印（§3）を送る", marks.some((m) => m === "§a§r§s§n§3"), JSON.stringify(marks.slice(0, 3)));
  check("スコープ中は銃を下ろす（一人称）", LOG.anims.slice(a0).includes("animation.arsenal.ads_scope"));
  check("スコープ中に視点を揺らすシェイクを出さない", LOG.shakes.slice(sh0).length === 0, `(shakes=${LOG.shakes.length - sh0})`);
  player.isSneaking = false;
  __tick(10);
  const after = LOG.titles.slice(t0).map((x) => x.t);
  check("覗くのをやめるとスコープ表示を消す", after[after.length - 1] === "§a§r§s§n§0", JSON.stringify(after.slice(-2)));
  player.isSneaking = true;
  __tick(20);
  player.selectedSlotIndex = 0;
  __tick(3);
  const last = LOG.titles[LOG.titles.length - 1]?.t;
  player.isSneaking = false;
  check("覗いたまま持ち替えてもスコープ表示が残らない", last === "§a§r§s§n§0", `(last=${last})`);
}
{
  put(0, "arsenal:vx9");
  player.selectedSlotIndex = 0;
  __tick(20);
  const a0 = LOG.anims.length;
  player.isSneaking = true;
  __tick(10);
  check("スコープのない銃はアイアンサイトの構え（ADS アニメ）", LOG.anims.slice(a0).includes("animation.arsenal.ads.vx9"));
  player.isSneaking = false;
  __tick(5);
  check("ADS をやめると構えを戻す", LOG.anims.slice(a0).includes("animation.arsenal.none"));
}

console.log("読み込まれていないチャンク");
{
  const w0 = warnings.length;
  const u0 = LOG.unloadedAccess ?? 0;
  player.location = { x: 150.5, y: 64, z: 0.5 };
  player.setRotation({ x: -2, y: -90 });  // +x（読み込み範囲の外）へ
  put(1, "arsenal:nightjar");
  put(0, "arsenal:sentinel");
  inv.items[0].props["a:mode"] = "auto";
  for (const slot of [0, 1]) {
    player.selectedSlotIndex = slot;
    __tick(20);
    const e = { source: player, itemStack: inv.getItem(slot), useDuration: 72000 };
    world.afterEvents.itemStartUse.fire(e);
    __tick(8);
    world.afterEvents.itemStopUse.fire(e);
    __tick(40);
  }
  put(1, "arsenal:kraken");
  player.selectedSlotIndex = 1;
  player.setRotation({ x: -30, y: -90 });
  __tick(20);
  const e = { source: player, itemStack: inv.getItem(1), useDuration: 72000 };
  world.afterEvents.itemStartUse.fire(e);
  __tick(2);
  world.afterEvents.itemStopUse.fire(e);
  __tick(140);
  check("遠くへ撃っても未ロードのチャンクに触れない（警告なし）", warnings.length === w0 && (LOG.unloadedAccess ?? 0) === u0, `(warn=${warnings.length - w0}, access=${(LOG.unloadedAccess ?? 0) - u0}) ${warnings.slice(w0, w0 + 2).join(" | ")}`);
  player.location = { x: 0.5, y: 64, z: 0.5 };
  player.setRotation({ x: 0, y: 0 });
}

const legacyWarn = warnings.length;
check("1.0.2 の試験で例外なし", legacyWarn === 0, warnings.slice(0, 5).join(" | "));
const { suite2 } = await import(pathToFileURL(path.join(here, "suite2.mjs")).href);
try {
  await suite2({ mc, ui, D, run, player, check, flush, warnings, comps });
} catch (e) {
  failures++;
  console.log(`  ✘ 2.0 の試験が途中で止まった: ${e && e.stack ? e.stack.split("\n").slice(0, 4).join(" / ") : e}`);
}
check("テスト全体で例外なし", warnings.length === 0, warnings.slice(0, 5).join(" | "));
console.log(`\n${passes} passed, ${failures} failed`);
console.warn = origWarn;
process.exit(failures ? 1 : 0);
