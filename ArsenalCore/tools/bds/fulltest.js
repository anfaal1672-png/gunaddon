// ARSENAL CORE — アドオン全体の通し試験（BDS 上のコピーにだけ読み込む。配布物には入らない）
//
// シミュレートプレイヤーに、実際のプレイヤーと同じ操作（アイテムを使う・ブロックに使う・乗る・ジャンプ・殴る）をさせて、
// 武器・近接・投擲物・医療品・設置物・乗り物・敵・ボス・構造物・キルストリーク・ゲームモード・経済・メニューを一通り動かす。
// 結果は [FULL] 行に出す。例外は tools/bds/debugclient.mjs（Mojang の Minecraft Bedrock Debugger と同じプロトコル）が
// スタックと変数ごと記録し、アドオン側で握りつぶした例外は [ARSENAL] 行（safe()）に出る。
//
//   scriptevent dev:full <段階> [開始 終了]
//   段階：weapons（開始 終了で範囲）/ melee / throw / gear / enemies / bosses / structures / streaks / modes / misc
import { world, system, ItemStack, BlockVolume, GameMode, Direction } from "@minecraft/server";
import { spawnSimulatedPlayer } from "@minecraft/server-gametest";
import { DATA, ammoItemId } from "./config/constants.js";
import { S } from "./core/state.js";
import { on } from "./core/events.js";
import { setWorld, setPrefs } from "./core/settings.js";
import { startReload } from "./core/reload.js";
import { spreadNow } from "./core/recoil.js";
import { addStreakPoints, useStreak, available } from "./systems/killstreaks.js";
import { expand } from "./systems/structures.js";
import { summonBoss } from "./systems/bosses.js";
import { spawnEnemy } from "./systems/ai/brain.js";
import { startLobby, joinMatch, endMatch, currentMatch, __setMatchLobbyNow } from "./modes/modes.js";
import { addCredits, credits, buy, shopItems, sellSlot, priceOf } from "./economy/economy.js";

const log = (...a) => console.warn("[FULL] " + a.join(" "));
const dim = () => world.getDimension("overworld");
const Y = 120;
const wait = (n) => system.waitTicks(n);
const fails = [];
const fail = (stage, what, why) => {
  fails.push(`${stage}:${what}`);
  log("FAIL", stage, what, why ?? "");
};

let shots = 0;
on("shot", () => shots++);

/** 試験場：x -12..44, z -20..20 の石の床、上は空気（シミュレートプレイヤーの周りが読み込まれてから） */
async function arena() {
  const p = sim();
  // 前の段階で遠くへ移っていたら戻し、試験場のチャンクが全部読み込まれるまで待つ
  if (Math.abs(p.location.x) > 40 || Math.abs(p.location.z) > 40) p.teleport({ x: 0.5, y: Y, z: 0.5 });
  const cells = [];
  for (let x = -12; x <= 44; x += 8) for (let z = -20; z <= 20; z += 8) cells.push({ x, y: Y, z });
  await wait(20);
  for (let t = 0; t < 60 && !cells.every((c) => dim().isChunkLoaded(c)); t++) await wait(10);
  const d = dim();
  d.fillBlocks(new BlockVolume({ x: -12, y: Y - 1, z: -20 }, { x: 44, y: Y - 1, z: 20 }), "minecraft:stone");
  for (let y = Y; y <= Y + 14; y += 5) d.fillBlocks(new BlockVolume({ x: -12, y, z: -20 }, { x: 44, y: Math.min(Y + 18, y + 4), z: 20 }), "minecraft:air");
}
/** 射線の床を直す（前の武器の爆発で穴が開くと、的が沈んで床の縁に弾が当たる） */
function repairLane() {
  const d = dim();
  d.fillBlocks(new BlockVolume({ x: -3, y: Y - 2, z: -4 }, { x: 24, y: Y - 1, z: 4 }), "minecraft:stone");
  d.fillBlocks(new BlockVolume({ x: -3, y: Y, z: -4 }, { x: 24, y: Y + 4, z: 4 }), "minecraft:air");
}
function clearMobs() {
  for (const e of dim().getEntities({ location: { x: 16, y: Y, z: 0 }, maxDistance: 60 })) {
    if (e.typeId === "minecraft:player") continue;
    try { e.remove(); } catch { /* 消えている */ }
  }
}

/** @type {import("@minecraft/server-gametest").SimulatedPlayer[]} */
const sims = [];
function sim(i = 0) {
  if (sims[i] && sims[i].isValid) return sims[i];
  sims[i] = spawnSimulatedPlayer({ dimension: dim(), x: 0.5 + i * 3, y: Y, z: 0.5 }, `QA${i}`, GameMode.Survival);
  return sims[i];
}
function inv(p) {
  return p.getComponent("minecraft:inventory").container;
}
function clearInv(p) {
  const c = inv(p);
  for (let i = 0; i < c.size; i++) c.setItem(i);
}
function tough(p) {
  p.addEffect("resistance", 20000, { amplifier: 255, showParticles: false });
  p.addEffect("fire_resistance", 20000, { amplifier: 0, showParticles: false });
  p.addEffect("regeneration", 20000, { amplifier: 4, showParticles: false });
}
/** 動かない的（ゾンビ・体力 200） */
function target(x, z) {
  const e = dim().spawnEntity("minecraft:zombie", { x, y: Y, z });
  e.addEffect("slowness", 20000, { amplifier: 255, showParticles: false });
  e.addEffect("fire_resistance", 20000, { amplifier: 0, showParticles: false });
  e.addEffect("weakness", 20000, { amplifier: 255, showParticles: false });
  e.nameTag = "qa_target";
  try { e.getComponent("minecraft:health").setCurrentValue(20); } catch { /* */ }
  return e;
}
function hpOf(e) {
  return e && e.isValid ? e.getComponent("minecraft:health")?.currentValue ?? 0 : 0;
}

// ---------------------------------------------------------------------------
//  武器
// ---------------------------------------------------------------------------
const INDIRECT = new Set(["gl40", "rocket", "seeker", "pathfinder", "flare", "grapple", "mortar", "gravity", "needle"]);
async function weapons(from, to) {
  const p = sim();
  tough(p);
  const ids = Object.keys(DATA.WEAPONS).slice(from, to);
  let fired = 0, hit = 0, reloaded = 0;
  for (const wid of ids) {
    const w = DATA.WEAPONS[wid];
    clearMobs();
    repairLane();
    clearInv(p);
    p.teleport({ x: 0.5, y: Y, z: 0.5 });
    const c = inv(p);
    c.setItem(0, new ItemStack(`arsenal:${wid}`, 1));
    const am = w.ammo && w.ammo !== "none" ? ammoItemId(w.ammo, "std") : undefined;
    if (am) {
      c.setItem(1, new ItemStack(am, 64));
      c.setItem(2, new ItemStack(am, 64));
    }
    p.selectedSlotIndex = 0;
    const z = target(8.5, 0.5);
    let hurt = 0;
    const sub = world.afterEvents.entityHurt.subscribe((ev) => { if (ev.hurtEntity.id === z.id) hurt++; });
    await wait(14);
    p.lookAtLocation(z.getAABB().center);
    p.isSneaking = true;
    await wait(Math.max(10, (w.ads ?? 4) + 8));
    p.lookAtLocation(z.getAABB().center);
    const s0 = shots;
    p.useItemInSlot(0);
    const hold = w.modes?.[0] === "charge" ? 40 : w.spinup ? 40 : w.modes?.includes("auto") ? 10 : 4;
    await wait(hold);
    p.stopUsingItem();
    await wait(INDIRECT.has(w.fire ?? "hitscan") ? 50 : 16);
    world.afterEvents.entityHurt.unsubscribe(sub);
    const didFire = shots > s0;
    const s = S(p);
    if (didFire) fired++;
    else fail("weapons", wid, `not fired (ammo=${s.ammo} mags=${JSON.stringify(s.mags)} reload=${!!s.reload})`);
    if (hurt > 0) hit++;
    else if (didFire && !INDIRECT.has(w.fire ?? "hitscan") && w.cat !== "melee") fail("weapons", wid, `no hit (fire=${w.fire ?? "hitscan"})`);
    // リロード（弾を使う武器）
    if (am && s.stats && s.ammo < s.stats.mag) {
      const r = startReload(p, s, true);
      await wait(Math.ceil((w.reload?.empty ?? 60) + (w.single ? (w.single.start + w.single.per * w.mag + w.single.end) : 0)) + 6);
      if (r && !s.reload && s.ammo > 0) reloaded++;
      else if (r) fail("weapons", wid, `reload stuck (ammo=${s.ammo} reload=${!!s.reload})`);
    }
    p.isSneaking = false;
    if (z.isValid) z.remove();
  }
  log(`weapons ${from}-${to}: n=${ids.length} fired=${fired} hit=${hit} reloaded=${reloaded}`);
}

// ---------------------------------------------------------------------------
//  近接
// ---------------------------------------------------------------------------
async function melee() {
  const p = sim();
  tough(p);
  let ok = 0;
  for (const mid of Object.keys(DATA.MELEE)) {
    clearMobs();
    clearInv(p);
    p.teleport({ x: 0.5, y: Y, z: 0.5 });
    inv(p).setItem(0, new ItemStack(`arsenal:${mid}`, 1));
    p.selectedSlotIndex = 0;
    const z = target(2.0, 0.5);
    await wait(10);
    const h0 = hpOf(z);
    p.lookAtLocation(z.getAABB().center);
    p.attackEntity(z);
    await wait(12);
    if (hpOf(z) < h0) ok++;
    else fail("melee", mid, `hp ${h0} → ${hpOf(z)}`);
    if (z.isValid) z.remove();
  }
  log(`melee: n=${Object.keys(DATA.MELEE).length} ok=${ok}`);
}

// ---------------------------------------------------------------------------
//  投擲物
// ---------------------------------------------------------------------------
async function throwables() {
  const p = sim();
  tough(p);
  let ok = 0;
  for (const tid of Object.keys(DATA.THROWABLES)) {
    const t = DATA.THROWABLES[tid];
    clearMobs();
    clearInv(p);
    p.teleport({ x: 0.5, y: Y, z: 0.5 });
    inv(p).setItem(0, new ItemStack(`arsenal:${tid}`, 4));
    p.selectedSlotIndex = 0;
    await wait(6);
    p.lookAtLocation({ x: 10, y: Y + 1.5, z: 0.5 });
    if (t.kind === "mine") {
      p.useItemInSlotOnBlock(0, { x: 4, y: Y - 1, z: 0 }, Direction.Up, { x: 0.5, y: 1, z: 0.5 });
    } else {
      p.useItemInSlot(0);
      await wait(8);
      p.stopUsingItem();
    }
    await wait(6);
    const left = inv(p).getItem(0)?.amount ?? 0;
    const proj = dim().getEntities({ type: "arsenal:projectile", location: { x: 5, y: Y, z: 0 }, maxDistance: 30 }).length;
    if (left < 4) ok++;
    else fail("throw", tid, `not used (left=${left} proj=${proj})`);
    if (t.kind === "c4") {
      inv(p).setItem(1, new ItemStack("arsenal:detonator", 1));
      p.selectedSlotIndex = 1;
      await wait(4);
      p.useItemInSlot(1);
      await wait(3);
      p.stopUsingItem();
    }
    await wait(Math.max(20, (t.fuse ?? 0) + 10));
  }
  log(`throw: n=${Object.keys(DATA.THROWABLES).length} used=${ok}`);
}

// ---------------------------------------------------------------------------
//  医療品・設置物・乗り物
// ---------------------------------------------------------------------------
async function gear() {
  const p = sim();
  let okMed = 0, okDep = 0, okVeh = 0;
  for (const mid of Object.keys(DATA.MEDICAL)) {
    const m = DATA.MEDICAL[mid];
    clearInv(p);
    p.removeEffect("resistance");
    p.removeEffect("regeneration");
    p.getComponent("minecraft:health").setCurrentValue(8);
    inv(p).setItem(0, new ItemStack(`arsenal:${mid}`, 2));
    p.selectedSlotIndex = 0;
    await wait(6);
    p.useItemInSlot(0);
    await wait((m.use ?? 20) + 6);
    p.stopUsingItem();
    await wait(4);
    const left = inv(p).getItem(0)?.amount ?? 0;
    if (left < 2 || m.revive || m.plate) okMed++;
    else fail("gear", mid, `not consumed hp=${p.getComponent("minecraft:health").currentValue}`);
  }
  tough(p);
  const place = async (id, kind, x) => {
    clearInv(p);
    inv(p).setItem(0, new ItemStack(`arsenal:${id}`, 1));
    p.selectedSlotIndex = 0;
    p.teleport({ x: 0.5, y: Y, z: 0.5 });
    await wait(4);
    p.lookAtLocation({ x: x + 0.5, y: Y - 0.5, z: 0.5 });
    p.useItemInSlotOnBlock(0, { x, y: Y - 1, z: 0 }, Direction.Up, { x: 0.5, y: 1, z: 0.5 });
    await wait(10);
    return dim().getEntities({ type: `arsenal:${kind}`, location: { x: x + 0.5, y: Y, z: 0.5 }, maxDistance: 6 })[0];
  };
  for (const did of Object.keys(DATA.DEPLOYABLES)) {
    const d = DATA.DEPLOYABLES[did];
    if (d.offhand) {
      okDep++;
      continue;
    }
    clearMobs();
    if (did === "recon_drone") {
      // ドローンは地面に置かず、手に持って使うと飛び立つ
      clearInv(p);
      inv(p).setItem(0, new ItemStack(`arsenal:${did}`, 1));
      p.selectedSlotIndex = 0;
      await wait(4);
      p.useItemInSlot(0);
      await wait(10);
      const dr = dim().getEntities({ type: "arsenal:recon_drone", location: p.location, maxDistance: 8 })[0];
      if (dr) okDep++;
      else fail("gear", did, "not launched");
      p.isSneaking = true;
      await wait(4);
      p.isSneaking = false;
      await wait(10);
      continue;
    }
    const e = await place(did, d.entity ?? did, 4);
    if (e) okDep++;
    else fail("gear", did, "not placed");
    if (did === "sentry_turret" && e) {
      inv(p).setItem(1, new ItemStack(ammoItemId("medium", "std"), 64));
      p.interactWithEntity(e);
      const z = target(12.5, 0.5);
      await wait(60);
      if (hpOf(z) >= 20) fail("gear", did, "sentry did not shoot");
    }
    if (did === "mortar_emplacement") {
      if (e) p.interactWithEntity(e);
      await wait(30);
      p.isSneaking = true;
      await wait(4);
      p.isSneaking = false;
    }
  }
  for (const vid of Object.keys(DATA.VEHICLES)) {
    const v = DATA.VEHICLES[vid];
    clearMobs();
    const e = await place(vid, vid, 5);
    if (!e) {
      fail("gear", vid, "not placed");
      continue;
    }
    const am = ammoItemId(v.ammo, "std");
    if (am) inv(p).setItem(2, new ItemStack(am, 64));
    if (v.kind === "vehicle") inv(p).setItem(3, new ItemStack("arsenal:fuel_canister", 4));
    p.selectedSlotIndex = 4;
    p.interactWithEntity(e);
    await wait(10);
    const riding = p.getComponent("minecraft:riding")?.entityRidingOn?.id === e.id;
    if (!riding) {
      fail("gear", vid, "could not mount");
      continue;
    }
    const z = target(20.5, 0.5);
    p.lookAtLocation(z.getAABB().center);
    const before = inv(p).getItem(2)?.amount ?? 0;
    // シムは乗車中のジャンプが inputInfo に出ないので、「タップで撃ち続ける」設定のトグルを直接立てる
    setPrefs(p, { triggerMode: "tap" });
    S(p).jumpToggle = true;
    await wait(30);
    S(p).jumpToggle = false;
    setPrefs(p, { triggerMode: "hold" });
    await wait(10);
    const after = inv(p).getItem(2)?.amount ?? 0;
    if (v.kind === "vehicle" || after < before) okVeh++;
    else fail("gear", vid, `no ammo used (${before} → ${after})`);
    try { e.getComponent("minecraft:rideable")?.ejectRiders(); } catch { /* */ }
    await wait(4);
  }
  log(`gear: medical ok=${okMed}/${Object.keys(DATA.MEDICAL).length} deployables ok=${okDep}/${Object.keys(DATA.DEPLOYABLES).length} vehicles ok=${okVeh}/${Object.keys(DATA.VEHICLES).length}`);
}

// ---------------------------------------------------------------------------
//  敵
// ---------------------------------------------------------------------------
async function enemies() {
  const p = sim();
  tough(p);
  clearInv(p);
  p.teleport({ x: 0.5, y: Y, z: 0.5 });
  let ok = 0;
  for (const eid of Object.keys(DATA.ENEMIES)) {
    clearMobs();
    const e = spawnEnemy(dim(), { x: 14.5, y: Y, z: 0.5 }, eid, {});
    if (!e) {
      fail("enemies", eid, "spawn failed");
      continue;
    }
    let attacked = 0;
    const sub = world.afterEvents.entityHurt.subscribe((ev) => { if (ev.hurtEntity.id === p.id && ev.damageSource.damagingEntity?.id === e.id) attacked++; });
    const sub2 = world.afterEvents.entityHurt.subscribe((ev) => { if (ev.hurtEntity.id === p.id && ev.damageSource.cause === "entityExplosion") attacked++; });
    for (let i = 0; i < 12 && !attacked; i++) await wait(20);
    world.afterEvents.entityHurt.unsubscribe(sub);
    world.afterEvents.entityHurt.unsubscribe(sub2);
    if (attacked || !e.isValid) ok++;
    else fail("enemies", eid, "never attacked the player in 12 s");
    // 倒せるか（倒れたら戦利品）
    if (e.isValid) {
      try { e.applyDamage(9999, { cause: "entityAttack", damagingEntity: p }); } catch (err) { fail("enemies", eid, `kill threw ${err}`); }
    }
    await wait(10);
  }
  log(`enemies: n=${Object.keys(DATA.ENEMIES).length} attacked=${ok}`);
}

// ---------------------------------------------------------------------------
//  ボス
// ---------------------------------------------------------------------------
async function bosses() {
  const p = sim();
  tough(p);
  clearInv(p);
  setWorld({ bosses: true });
  let ok = 0;
  for (const bid of Object.keys(DATA.BOSSES)) {
    clearMobs();
    p.teleport({ x: 0.5, y: Y, z: 0.5 }, { rotation: { x: 0, y: -90 } });
    const item = DATA.BOSSES[bid].summon;
    inv(p).setItem(0, new ItemStack(`arsenal:${item}`, 1));
    p.selectedSlotIndex = 0;
    await wait(4);
    p.useItemInSlot(0);
    await wait(5);
    p.stopUsingItem();
    await wait(80);
    const b = dim().getEntities({ type: `arsenal:${bid}` })[0];
    if (!b) {
      fail("bosses", bid, "not summoned");
      continue;
    }
    const h = b.getComponent("minecraft:health");
    // 段階を進める：体力 60% → 25%
    for (const frac of [0.6, 0.25]) {
      h.setCurrentValue(h.effectiveMax * frac);
      await wait(200);
      if (!b.isValid) break;
    }
    const kills0 = fails.length;
    let killed = false;
    const sub = world.afterEvents.entityDie.subscribe((ev) => { if (ev.deadEntity.id === b.id) killed = true; });
    if (b.isValid) b.applyDamage(99999, { cause: "entityAttack", damagingEntity: p });
    await wait(40);
    world.afterEvents.entityDie.unsubscribe(sub);
    const minions = dim().getEntities({ tags: [`arsenal_minion:${b.id}`] }).length;
    await wait(420);
    const left = dim().getEntities({ tags: [`arsenal_minion:${b.id}`] }).length;
    if (killed && left === 0 && fails.length === kills0) ok++;
    else fail("bosses", bid, `killed=${killed} minions ${minions} → ${left}`);
  }
  log(`bosses: n=${Object.keys(DATA.BOSSES).length} ok=${ok}`);
}

// ---------------------------------------------------------------------------
//  構造物
// ---------------------------------------------------------------------------
const dropArea = (name) => { try { dim().runCommand(`tickingarea remove ${name}`); } catch { /* ない */ } };
async function structures() {
  // 前の回が途中で止まって残ったエリアを消す（ティッキングエリアは 10 個まで）
  try { dim().runCommand("tickingarea remove_all"); } catch { /* ない */ }
  const p = sim();
  tough(p);
  setWorld({ structures: "high" });
  let ok = 0;
  const sids = Object.keys(DATA.STRUCTURES);
  for (let i = 0; i < sids.length; i++) {
    const sid = sids[i];
    const at = { x: 100 + i * 48, y: Y, z: 100 };
    p.teleport({ x: at.x - 6, y: Y + 4, z: at.z - 6 });
    // シムが移っただけでは周りのチャンクがすぐには読み込まれないので、ティッキングエリアにして待つ
    // 名前は場所ごとに変える（消してすぐ同じ名前で足すと失敗することがある）
    const area = `qa_site_${i}`;
    const add = dim().runCommand(`tickingarea add ${at.x - 8} 0 ${at.z - 8} ${at.x + 48} 0 ${at.z + 48} ${area}`);
    const cells = [];
    for (let x = at.x - 4; x <= at.x + 46; x += 8) for (let z = at.z - 4; z <= at.z + 46; z += 8) cells.push({ x, y: Y, z });
    let t = 0;
    for (; t < 60 && !cells.every((c) => dim().isChunkLoaded(c)); t++) await wait(10);
    const notLoaded = cells.filter((c) => !dim().isChunkLoaded(c));
    if (notLoaded.length) {
      fail("structures", sid, `site not loaded after ${t * 10} ticks (tickingarea ok=${add.successCount}) ${JSON.stringify(notLoaded[0])}`);
      dropArea(area);
      continue;
    }
    dim().fillBlocks(new BlockVolume({ x: at.x - 4, y: Y - 1, z: at.z - 4 }, { x: at.x + 30, y: Y - 1, z: at.z + 30 }), "minecraft:stone");
    let r;
    try {
      r = expand(dim(), sid, at, undefined);
    } catch (err) {
      fail("structures", sid, `expand threw ${err}`);
      dropArea(area);
      continue;
    }
    await wait(20);
    const want = DATA.STRUCTURES[sid].garrison.reduce((a, g) => a + g.count, 0);
    const got = dim().getEntities({ location: at, maxDistance: 40 }).filter((e) => e.getTags().some((t) => t.startsWith("arsenal_site:"))).length;
    if (got >= want) ok++;
    else fail("structures", sid, `garrison ${got}/${want} expand=${JSON.stringify(r)}`);
    dropArea(area);
  }
  p.teleport({ x: 0.5, y: Y, z: 0.5 });
  log(`structures: n=${sids.length} ok=${ok}`);
}

// ---------------------------------------------------------------------------
//  キルストリーク
// ---------------------------------------------------------------------------
async function streaks() {
  const p = sim();
  tough(p);
  clearMobs();
  p.teleport({ x: 0.5, y: Y, z: 0.5 }, { rotation: { x: 10, y: -90 } });
  let ok = 0;
  for (const kid of Object.keys(DATA.KILLSTREAKS)) {
    addStreakPoints(p, 9999);
    target(18.5, 0.5);
    // 狙う系（補給・砲台投下・空爆）は視線の先の地面が要る。teleport の向きはシムの頭には効かないので見下ろさせる
    p.teleport({ x: 0.5, y: Y, z: 0.5 });
    p.lookAtLocation({ x: 12.5, y: Y - 1, z: 0.5 });
    await wait(4);
    if (!available(p).includes(kid)) {
      fail("streaks", kid, "not available");
      continue;
    }
    let r = false;
    try { r = useStreak(p, kid); } catch (err) { fail("streaks", kid, `threw ${err}`); }
    await wait(160);
    if (r) ok++;
    else fail("streaks", kid, "useStreak returned false");
    clearMobs();
  }
  log(`streaks: n=${Object.keys(DATA.KILLSTREAKS).length} ok=${ok}`);
}

// ---------------------------------------------------------------------------
//  ゲームモード
// ---------------------------------------------------------------------------
async function modes() {
  const a = sim(0), b = sim(1);
  tough(a);
  tough(b);
  const ar = {
    id: "qa", name: "QA", dim: "minecraft:overworld", a: { x: -10, y: Y, z: -20 }, b: { x: 40, y: Y, z: 20 },
    spawns: [{ x: 0.5, y: Y, z: -10.5 }, { x: 0.5, y: Y, z: 10.5 }, { x: 20.5, y: Y, z: -10.5 }, { x: 20.5, y: Y, z: 10.5 }], hills: [{ x: 15.5, y: Y, z: 0.5 }],
  };
  world.setDynamicProperty("a:arenas", JSON.stringify([ar]));
  let ok = 0;
  for (const mode of Object.keys(DATA.MODES)) {
    clearMobs();
    try {
      startLobby(mode, ar, a);
      joinMatch(b);
    } catch (err) {
      fail("modes", mode, `start threw ${err}`);
      continue;
    }
    __setMatchLobbyNow();
    await wait(60);
    const m = currentMatch();
    if (!m || m.phase !== "live") {
      fail("modes", mode, `not live (phase=${m?.phase})`);
      if (m) endMatch([]);
      await wait(20);
      continue;
    }
    // 1 回撃ち合って倒す（PvP のキル判定）
    inv(a).setItem(0, new ItemStack("arsenal:sentinel", 1));
    inv(a).setItem(1, new ItemStack(ammoItemId("medium", "std"), 64));
    a.selectedSlotIndex = 0;
    b.removeEffect("resistance");
    b.removeEffect("regeneration");
    await wait(10);
    a.lookAtEntity(b);
    a.useItemInSlot(0);
    await wait(30);
    a.stopUsingItem();
    await wait(mode === "horde" ? 300 : 80);
    try { endMatch([]); } catch (err) { fail("modes", mode, `end threw ${err}`); }
    // 終了後 100 tick は結果を見せる時間（その後に持ち物を戻して試合を消す）
    await wait(130);
    tough(b);
    if (!currentMatch()) ok++;
    else fail("modes", mode, `match did not end (phase=${currentMatch()?.phase})`);
  }
  log(`modes: n=${Object.keys(DATA.MODES).length} ok=${ok}`);
}

// ---------------------------------------------------------------------------
//  経済・メニュー・設定・HUD
// ---------------------------------------------------------------------------
async function misc() {
  const p = sim();
  tough(p);
  clearInv(p);
  // 経済
  addCredits(p, 50000);
  const c0 = credits(p);
  const first = shopItems("weapons")?.[0];
  let bought = false;
  try { bought = first ? buy(p, first, 1, priceOf(first)) : false; } catch (err) { fail("misc", "buy", `${err}`); }
  if (!bought || credits(p) >= c0) fail("misc", "buy", `bought=${bought} credits ${c0} → ${credits(p)}`);
  inv(p).setItem(5, new ItemStack("arsenal:steel_ingot", 10));
  try { sellSlot(p, 5); } catch (err) { fail("misc", "sell", `${err}`); }
  // メニュー（フォームを開くアイテム。シミュレートプレイヤーには表示されないが、開くまでの処理を通す）
  for (const tool of ["field_manual", "streak_terminal", "arena_tool", "repair_kit", "gunsmith_kit"]) {
    if (!DATA.TOOLS[tool] && tool !== "field_manual") continue;
    clearInv(p);
    inv(p).setItem(0, new ItemStack("arsenal:sentinel", 1));
    inv(p).setItem(1, new ItemStack(`arsenal:${tool}`, 1));
    p.selectedSlotIndex = 1;
    await wait(4);
    p.useItemInSlot(1);
    await wait(10);
    p.stopUsingItem();
  }
  // シムにはフォームが表示されず閉じられもしないので、「メニューを開いている」が残る（その間は撃てない）
  log(`menuOpen after menus: ${S(p).menuOpen}`);
  S(p).menuOpen = false;
  // 設定の切り替え：弾が飛ぶ・マガジン単位・部位を切って撃つ、HUD を切り替える
  setWorld({ bulletTravel: false, magRealism: false, limbDamage: false });
  for (const style of ["classic", "hud2", "off"]) setPrefs(p, { hudStyle: style });
  clearInv(p);
  inv(p).setItem(0, new ItemStack("arsenal:sentinel", 1));
  inv(p).setItem(1, new ItemStack(ammoItemId("medium", "std"), 64));
  p.selectedSlotIndex = 0;
  const z = target(8.5, 0.5);
  await wait(10);
  p.lookAtLocation(z.getAABB().center);
  const s0 = shots;
  p.useItemInSlot(0);
  await wait(10);
  p.stopUsingItem();
  await wait(10);
  if (shots === s0) fail("misc", "settings-off fire", "not fired");
  setWorld({ bulletTravel: true, magRealism: true, limbDamage: true });
  setPrefs(p, { hudStyle: "hud2" });
  log(`misc: credits ${c0} → ${credits(p)}`);
}

// 1 挺を撃って、1 発ごとに ADS・拡散・広がり・視線と的のずれを出す（命中しない武器の調査用）
let diagOn = null;
on("shot", () => diagOn && diagOn());
async function diag(wid) {
  const p = sim();
  tough(p);
  clearMobs();
  clearInv(p);
  p.teleport({ x: 0.5, y: Y, z: 0.5 });
  const w = DATA.WEAPONS[wid];
  inv(p).setItem(0, new ItemStack(`arsenal:${wid}`, 1));
  const am = ammoItemId(w.ammo, "std");
  if (am) inv(p).setItem(1, new ItemStack(am, 64));
  p.selectedSlotIndex = 0;
  const z = target(8.5, 0.5);
  let hurt = 0;
  const sub = world.afterEvents.entityHurt.subscribe((ev) => { if (ev.hurtEntity.id === z.id) hurt++; });
  diagOn = () => {
    const s = S(p);
    const c = z.getAABB().center;
    const eye = p.getHeadLocation();
    const v = p.getViewDirection();
    const t = { x: c.x - eye.x, y: c.y - eye.y, z: c.z - eye.z };
    const L = Math.hypot(t.x, t.y, t.z);
    const ang = (Math.acos(Math.min(1, (v.x * t.x + v.y * t.y + v.z * t.z) / L)) * 180) / Math.PI;
    log(`shot ${wid} t=${system.currentTick} ads=${s.adsLevel.toFixed(2)} spread=${spreadNow(p, s, s.stats).toFixed(2)} bloom=${s.bloom.toFixed(2)} aimErr=${ang.toFixed(2)}° sneak=${p.isSneaking} hurt=${hurt} ammo=${s.ammo}`);
  };
  await wait(14);
  p.lookAtLocation(z.getAABB().center);
  p.isSneaking = true;
  await wait((w.ads ?? 4) + 6);
  p.lookAtLocation(z.getAABB().center);
  p.useItemInSlot(0);
  await wait(w.spinup ? 40 : w.charge ? 40 : 12);
  p.stopUsingItem();
  await wait(30);
  world.afterEvents.entityHurt.unsubscribe(sub);
  diagOn = null;
  log(`diag ${wid} hurt=${hurt}`);
  p.isSneaking = false;
}

const STAGES = { diag, weapons, melee, throw: throwables, gear, enemies, bosses, structures, streaks, modes, misc };

system.afterEvents.scriptEventReceive.subscribe((ev) => {
  if (ev.id !== "dev:full") return;
  const [stage, a, b] = (ev.message || "").split(" ");
  const fn = STAGES[stage];
  if (!fn) {
    log("unknown stage", stage);
    return;
  }
  const n0 = fails.length;
  const t0 = Date.now();
  log("BEGIN", stage, a ?? "", b ?? "");
  arena()
    .then(() => {
      clearMobs();
      return stage === "weapons" ? weapons(Number(a ?? 0), Number(b ?? 9999)) : stage === "diag" ? diag(a) : fn();
    })
    .then(() => log("END", stage, `fails=${fails.length - n0}`, `secs=${((Date.now() - t0) / 1000).toFixed(0)}`, fails.slice(n0).join(" ")))
    .catch((err) => log("CRASH", stage, String(err), err?.stack ?? ""));
});
