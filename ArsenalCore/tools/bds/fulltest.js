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
import { activeFields } from "./systems/fields.js";
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
import { hire, squadOf, orderSquad } from "./systems/squad.js";
import { setLoadout, useAbility, mods } from "./progression/classes.js";

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
  // 起動直後は「読み込み済み」でもまだ動いていないチャンクがあり、fillBlocks が失敗する。ティッキングエリアにして、成功するまでやり直す
  try { dim().runCommand("tickingarea add -12 0 -20 44 0 20 qa_arena"); } catch { /* もうある */ }
  await wait(20);
  for (let t = 0; t < 60 && !cells.every((c) => dim().isChunkLoaded(c)); t++) await wait(10);
  for (let t = 0; ; t++) {
    try {
      const d = dim();
      d.fillBlocks(new BlockVolume({ x: -12, y: Y - 1, z: -20 }, { x: 44, y: Y - 1, z: 20 }), "minecraft:stone");
      for (let y = Y; y <= Y + 14; y += 5) d.fillBlocks(new BlockVolume({ x: -12, y, z: -20 }, { x: 44, y: Math.min(Y + 18, y + 4), z: 20 }), "minecraft:air");
      return;
    } catch (err) {
      if (t >= 30) throw err;
      await wait(20);
    }
  }
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
const INDIRECT = new Set(["gl40", "rocket", "seeker", "pathfinder", "flare", "grapple", "mortar", "gravity", "needle", "blink", "orbital", "stickybomb", "singularity", "cruise"]);
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
    if (t.kind === "nuke") continue; // 投げずに置く。nukes の段階で確かめる
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
  for (let i = 0; i < 12; i++) dropArea(`qa_site_${i}`);
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

// ---------------------------------------------------------------------------
//  2.5 特殊武器（実機でしか確かめられない動き：瞬間移動・自動ロック・回復・網・麻酔・吸い込み・引き寄せ・衛星砲）
// ---------------------------------------------------------------------------
async function specials() {
  const p = sim();
  tough(p);
  const cell = ammoItemId("cell", "std");
  const origin = { x: 0.5, y: Y, z: 0.5 };
  const give = async (wid, ammo) => {
    clearInv(p);
    inv(p).setItem(0, new ItemStack(`arsenal:${wid}`, 1));
    if (ammo) inv(p).setItem(1, new ItemStack(ammo, 64));
    p.selectedSlotIndex = 0;
    await wait(16);
  };
  const fire = async (hold = 4) => {
    p.useItemInSlot(0);
    await wait(hold);
    p.stopUsingItem();
  };
  // 自由に動くゾンビ（的と違って鈍足なし）
  const free = (x, z) => {
    const e = dim().spawnEntity("minecraft:zombie", { x, y: Y, z });
    e.addEffect("fire_resistance", 20000, { amplifier: 0, showParticles: false });
    e.nameTag = "qa_free";
    return e;
  };
  const amp = (e, id) => (e && e.isValid ? e.getEffect(id)?.amplifier ?? -1 : -1);
  const fill = (a, b, block) => dim().fillBlocks(new BlockVolume(a, b), block);
  let ok = 0, n = 0;
  const expect = (what, cond, why) => {
    n++;
    if (cond) ok++;
    else fail("specials", what, why);
  };

  // ブリンクピストル：正面の壁（z=10）の手前へ移る
  clearMobs();
  repairLane();
  p.teleport(origin);
  fill({ x: -2, y: Y, z: 10 }, { x: 2, y: Y + 3, z: 10 }, "minecraft:stone");
  await give("blink_pistol", cell);
  p.lookAtLocation({ x: 0.5, y: Y + 1.6, z: 20 });
  await wait(4);
  await fire();
  await wait(10);
  expect("blink", p.location.z > 7 && p.location.z < 10, `z=${p.location.z.toFixed(2)}`);
  fill({ x: -2, y: Y, z: 10 }, { x: 2, y: Y + 3, z: 10 }, "minecraft:air");

  // スマートピストル：照準の外の 2 体をロックし、2 発でそれぞれに当たる
  clearMobs();
  p.teleport(origin);
  const a = target(-3.5, 10.5), b = target(4.5, 10.5);
  await give("smart_pistol", ammoItemId("light", "std"));
  p.lookAtLocation({ x: 0.5, y: Y + 1.6, z: 14 });
  p.isSneaking = true;
  await wait(24);
  const ha = hpOf(a), hb = hpOf(b);
  for (let i = 0; i < 2; i++) {
    await fire(2);
    await wait(8);
  }
  p.isSneaking = false;
  expect("smart_pistol", hpOf(a) < ha && hpOf(b) < hb, `hp ${ha}→${hpOf(a)}, ${hb}→${hpOf(b)}`);

  // メディックビーム：味方（PvP なし）の体力を回復する
  clearMobs();
  p.teleport(origin);
  dim().runCommand("gamerule pvp false");
  const q = sim(1);
  q.teleport({ x: 0.5, y: Y, z: 6.5 });
  q.removeEffect("regeneration");
  await wait(4);
  q.getComponent("minecraft:health").setCurrentValue(8);
  await give("medic_beam", cell);
  p.lookAtLocation(q.getAABB().center);
  await fire(30);
  await wait(4);
  expect("medic_beam", hpOf(q) > 8, `hp=${hpOf(q)}`);
  dim().runCommand("gamerule pvp true");
  tough(q);
  q.teleport({ x: -8.5, y: Y, z: -12.5 });

  // ネットランチャー：当たったゾンビが 4 秒動けない（鈍足 7）
  clearMobs();
  p.teleport(origin);
  const zn = free(0.5, 9.5);
  await give("net_launcher", cell);
  p.lookAtLocation(zn.getAABB().center);
  await wait(4);
  await fire();
  await wait(14);
  const pn = zn.isValid ? { ...zn.location } : null;
  await wait(30);
  const moved = pn && zn.isValid ? Math.hypot(zn.location.x - pn.x, zn.location.z - pn.z) : -1;
  expect("net_launcher", amp(zn, "slowness") >= 6 && moved >= 0 && moved < 0.5, `slowness=${amp(zn, "slowness")} moved=${moved.toFixed(2)}`);

  // トランキライザー：当たって 2 秒後に眠る
  clearMobs();
  p.teleport(origin);
  const zq = free(0.5, 10.5);
  await give("tranq_rifle", cell);
  p.lookAtLocation(zq.getAABB().center);
  p.isSneaking = true;
  await wait(12);
  await fire(2);
  p.isSneaking = false;
  await wait(10);
  const early = amp(zq, "slowness");
  await wait(45);
  expect("tranq_rifle", early < 6 && amp(zq, "slowness") >= 6, `early=${early} later=${amp(zq, "slowness")}`);

  // シンギュラリティ：着弾点の近くのゾンビが中心へ寄っていく
  clearMobs();
  p.teleport(origin);
  const center = target(0.5, 9.5);
  // 引き寄せるのは歩かない的（ゾンビがプレイヤーへ歩くと吸い込みと打ち消し合う）
  const zs = target(5.5, 10.5);
  await give("singularity", cell);
  p.lookAtLocation(center.getAABB().center);
  await wait(4);
  await fire();
  await wait(8);
  const d0 = zs.isValid ? Math.hypot(zs.location.x - 0.5, zs.location.z - 9.5) : -1;
  await wait(30);
  const d1 = zs.isValid ? Math.hypot(zs.location.x - 0.5, zs.location.z - 9.5) : -1;
  expect("singularity", d0 > 0 && d1 >= 0 && d1 < d0 - 1, `dist ${d0.toFixed(2)} → ${d1.toFixed(2)}`);
  await wait(40);

  // ハープーンガン：壁のないところでは手前へ引き寄せる
  clearMobs();
  p.teleport(origin);
  const zh = target(0.5, 12.5);
  await give("harpoon_gun");
  p.lookAtLocation(zh.getAABB().center);
  await wait(4);
  const hz = zh.location.z;
  await fire();
  await wait(14);
  expect("harpoon_gun", zh.isValid && zh.location.z < hz - 0.8, `z ${hz.toFixed(2)} → ${zh.isValid ? zh.location.z.toFixed(2) : "dead"}`);

  // オービタルマーカー：空の見える地面へ 2 秒後に落ちる
  clearMobs();
  p.teleport(origin);
  const zo = target(0.5, 9.5);
  // 試験場は山を掘った中にあるので、的の真上の空を開ける（屋根の下には呼べない）
  fill({ x: -2, y: Y + 15, z: 7 }, { x: 3, y: Y + 45, z: 12 }, "minecraft:air");
  await give("orbital_marker", cell);
  p.lookAtLocation({ x: 0.5, y: Y, z: 9.5 });
  await wait(4);
  const ho = hpOf(zo);
  await fire();
  await wait(4);
  log(`orbital: ammo ${S(p).ammo} fields=${activeFields()}`);
  await wait(51);
  expect("orbital_marker", hpOf(zo) < ho, `hp ${ho} → ${hpOf(zo)}`);

  clearMobs();
  p.teleport(origin);
  log(`specials: ok=${ok}/${n}`);
}

/** レイが当たった面の位置（faceLocation）が実機でどう返るか：6 方向から石 1 個に撃つ */
async function facetest() {
  const d = dim();
  const b = { x: 8, y: Y + 4, z: 8 };
  d.fillBlocks(new BlockVolume({ x: 4, y: Y + 1, z: 4 }, { x: 12, y: Y + 8, z: 12 }), "minecraft:air");
  d.getBlock(b).setType("minecraft:stone");
  const c = { x: b.x + 0.5, y: b.y + 0.5, z: b.z + 0.5 };
  for (const [name, dir] of [["down(Up face)", { x: 0, y: -1, z: 0 }], ["up(Down face)", { x: 0, y: 1, z: 0 }], ["+x(West face)", { x: 1, y: 0, z: 0 }], ["-x(East face)", { x: -1, y: 0, z: 0 }], ["+z(North face)", { x: 0, y: 0, z: 1 }], ["-z(South face)", { x: 0, y: 0, z: -1 }]]) {
    const o = { x: c.x - dir.x * 3 + 0.13, y: c.y - dir.y * 3 + 0.21, z: c.z - dir.z * 3 + 0.17 };
    if (dir.x) o.x = c.x - dir.x * 3;
    if (dir.y) o.y = c.y - dir.y * 3;
    if (dir.z) o.z = c.z - dir.z * 3;
    const h = d.getBlockFromRay(o, dir, { maxDistance: 6, includePassableBlocks: false, includeLiquidBlocks: false });
    log(`face ${name}: face=${h?.face} block=${JSON.stringify(h?.block.location)} fl=${JSON.stringify(h?.faceLocation)}`);
  }
}

// ---------------------------------------------------------------------------
//  2.6 エイムアシスト・ミサイル・核（試験場の天井を抜いて空を開け、ブロックは壊さない設定で）
// ---------------------------------------------------------------------------
async function nukes() {
  const p = sim();
  tough(p);
  const origin = { x: 0.5, y: Y, z: 0.5 };
  setWorld({ explosionGrief: "off", nukes: true, killstreaks: true });
  // 試験場は山の中なので、射線の上の空を開ける（巡航ミサイルは上昇してから飛ぶ）
  dim().fillBlocks(new BlockVolume({ x: -6, y: Y + 18, z: -20 }, { x: 6, y: Y + 46, z: 22 }), "minecraft:air");
  dim().fillBlocks(new BlockVolume({ x: -12, y: Y + 15, z: -20 }, { x: 44, y: Y + 17, z: 20 }), "minecraft:air");
  let ok = 0, n = 0;
  const expect = (what, cond, why) => {
    n++;
    if (cond) ok++;
    else fail("nukes", what, why);
  };
  const give = async (id, ammo) => {
    clearInv(p);
    inv(p).setItem(0, new ItemStack(`arsenal:${id}`, 1));
    if (ammo) inv(p).setItem(1, new ItemStack(ammo, 16));
    p.selectedSlotIndex = 0;
    await wait(16);
  };
  const free = (x, z, hp = 20) => {
    const e = dim().spawnEntity("minecraft:zombie", { x, y: Y, z });
    e.addEffect("slowness", 20000, { amplifier: 255, showParticles: false });
    e.addEffect("fire_resistance", 20000, { amplifier: 0, showParticles: false }); // 昼の日光で燃えて減らないように
    e.nameTag = "qa_nuke"; // 名前付きの mob は離れても消えない
    try { e.getComponent("minecraft:health").setCurrentValue(hp); } catch { /* */ }
    return e;
  };
  // 自分の爆発で倒れたら起こす（倒れたままだと向きが変わらず、狙いが足元になる）
  const revive = async () => {
    if ((p.getComponent("minecraft:health")?.currentValue ?? 0) <= 0) {
      p.respawn();
      await wait(10);
    }
    p.getComponent("minecraft:health")?.resetToMaxValue();
  };
  // エイムアシスト：覗くと照準の外 5° の敵へ寄る
  clearMobs();
  p.teleport(origin);
  setPrefs(p, { aimAssist: "light" });
  await give(Object.keys(DATA.WEAPONS).find((w) => DATA.WEAPONS[w].cat === "assault"), ammoItemId("medium", "std"));
  const za = target(1.5, 12.5);
  p.lookAtLocation({ x: 0.5, y: Y + 1.6, z: 30 });
  await wait(4);
  const y0 = p.getRotation().y;
  p.isSneaking = true;
  await wait(30);
  const y1 = p.getRotation().y;
  p.isSneaking = false;
  const want = (Math.atan2(-(za.location.x - 0.5), za.location.z - 0.5) * 180) / Math.PI;
  expect("aim_assist", Math.abs(y1 - want) < 1.5 && Math.abs(y0 - want) > 3, `yaw ${y0.toFixed(2)} → ${y1.toFixed(2)} (want ${want.toFixed(2)})`);
  setPrefs(p, { aimAssist: "off" });
  await wait(6);

  // 巡航ミサイル：上昇して 36 ブロック先の地面へ
  clearMobs();
  p.teleport(origin);
  await give("albatross", ammoItemId("rocket", "std"));
  const zc = free(0.5, 18.5);
  p.teleport({ x: 0.5, y: Y, z: -18.5 });
  await wait(4);
  p.lookAtLocation({ x: 0.5, y: Y, z: 18.5 });
  p.isSneaking = true;
  await wait(14);
  const hc = hpOf(zc);
  let maxY = 0;
  p.useItemInSlot(0);
  await wait(3);
  p.stopUsingItem();
  for (let i = 0; i < 160; i++) {
    for (const e of dim().getEntities({ type: "arsenal:projectile" })) maxY = Math.max(maxY, e.location.y);
    await wait(1);
    if (!zc.isValid || hpOf(zc) < hc) break;
  }
  p.isSneaking = false;
  expect("cruise", maxY > Y + 14 && (!zc.isValid || hpOf(zc) < hc), `maxY=${(maxY - Y).toFixed(1)} hp ${hc}→${hpOf(zc)}`);

  // 誘導ミサイル：真下を向いて操縦し、足元の敵に当てる
  clearMobs();
  p.teleport(origin);
  clearInv(p);
  addStreakPoints(p, 9999);
  const zg = free(0.5, 6.5);
  p.lookAtLocation({ x: 0.5, y: Y, z: 6.5 });
  await wait(4);
  const hg = hpOf(zg);
  let used = false;
  try { used = useStreak(p, "missile_strike"); } catch (err) { fail("nukes", "missile_strike", `threw ${err}`); }
  for (let i = 0; i < 260; i++) {
    // 弾の位置から敵の方を見る（操縦）
    const m = dim().getEntities({ type: "arsenal:projectile" })[0];
    if (m && zg.isValid) {
      const c = zg.getAABB().center;
      const dx = c.x - m.location.x, dy = c.y - m.location.y, dz = c.z - m.location.z;
      p.lookAtLocation({ x: p.getHeadLocation().x + dx, y: p.getHeadLocation().y + dy, z: p.getHeadLocation().z + dz });
    }
    await wait(1);
    if (!zg.isValid || hpOf(zg) < hg) break;
  }
  expect("missile_strike", used && (!zg.isValid || hpOf(zg) < hg), `used=${used} hp ${hg}→${hpOf(zg)}`);
  await wait(20);

  // 核ミサイル：10 秒後に落ちて、近くの敵を倒す
  log(`nukes: owner hp after guided missile ${p.getComponent("minecraft:health")?.currentValue}`);
  await revive();
  clearMobs();
  // 闘技場は山の中（空がない）。斜めに落ちてくる経路の岩を抜いておく
  try {
    dim().fillBlocks(new BlockVolume({ x: -3, y: Y + 47, z: 15 }, { x: 22, y: Math.min(dim().heightRange.max - 1, Y + 124), z: 20 }), "minecraft:air");
  } catch (err) { log(`nukes: sky fill failed ${err}`); }
  p.teleport({ x: 0.5, y: Y, z: -14.5 });
  addStreakPoints(p, 9999);
  const zn = free(0.5, 17.5);
  p.lookAtLocation({ x: 0.5, y: Y - 1, z: 17.5 });
  await wait(20); // 誘導ミサイルの操縦で真下を向いていたので、向き直るまで待つ
  let usedN = false;
  try { usedN = useStreak(p, "nuke"); } catch (err) { fail("nukes", "nuke", `threw ${err}`); }
  const t0 = Date.now();
  await wait(230);
  log(`nukes: owner hp after nuke missile ${p.getComponent("minecraft:health")?.currentValue}`);
  expect("nuke_missile", usedN && !zn.isValid, `used=${usedN} hp=${hpOf(zn)} secs=${((Date.now() - t0) / 1000).toFixed(1)}`);
  await wait(40);

  // 置く戦術核：15 秒後に爆発
  await revive();
  clearMobs();
  p.teleport({ x: 0.5, y: Y, z: -14.5 });
  await give("tactical_nuke");
  const zt = free(0.5, 10.5);
  const zfar = free(36.5, -11.5, 20); // 核から 36 ブロック（爆風 34 の外、吹き飛ばし 52 の内。闘技場の中）
  p.lookAtLocation({ x: 0.5, y: Y - 0.5, z: -11.5 });
  const nb = dim().getBlock({ x: 0, y: Y - 1, z: -12 });
  log(`nukes: place on ${nb?.typeId} above=${nb?.above()?.typeId}`);
  p.useItemInSlotOnBlock(0, { x: 0, y: Y - 1, z: -12 }, Direction.Up, { x: 0.5, y: 1, z: 0.5 });
  await wait(6);
  const placed = (inv(p).getItem(0)?.amount ?? 0) === 0;
  if (!placed) log(`nukes: not placed item=${inv(p).getItem(0)?.typeId} proj=${dim().getEntities({ type: "arsenal:projectile" }).length}`);
  p.teleport({ x: 40.5, y: Y, z: 15.5 });
  await wait(320);
  expect("tactical_nuke", placed && !zt.isValid && zfar.isValid, `placed=${placed} near=${zt.isValid} far=${zfar.isValid}`);
  log(`nukes: ok=${ok}/${n}`);
  setWorld({ explosionGrief: "gamerule" });
  await wait(1300); // 降下物が消えるまで（次の段階に残さない）
}

// 3.0：兵科のアビリティ・分隊（雇う・敵を撃つ・ついて来る・待つ・解散）
async function v3() {
  const p = sim();
  tough(p);
  let ok = 0, n = 0;
  const expect = (what, cond, why) => {
    n++;
    if (cond) ok++;
    else fail("v3", what, why);
  };
  clearMobs();
  p.teleport({ x: 0.5, y: Y, z: 0.5 });
  // 兵科：重装兵の防壁（受けるダメージが減る）
  S(p).classSwitchAt = 0;
  const err = setLoadout(p, "heavy", [null, null, null]);
  const used = useAbility(p);
  expect("ability", err === null && used && mods(p).dmgTaken < 0.5, `err=${err} used=${used} taken=${mods(p).dmgTaken}`);
  await wait(10);
  // 分隊：雇って前の敵を撃たせる
  addCredits(p, 5000, false);
  const e1 = hire(p, "squad_rifleman");
  const e2 = hire(p, "squad_gunner");
  await wait(20);
  const team = squadOf(p);
  expect("hire", e1 === null && e2 === null && team.length === 2, `${e1} ${e2} n=${team.length}`);
  const z = dim().spawnEntity("minecraft:zombie", { x: 0.5, y: Y, z: 14.5 });
  z.addEffect("slowness", 20000, { amplifier: 255, showParticles: false });
  z.addEffect("fire_resistance", 20000, { amplifier: 0, showParticles: false });
  z.nameTag = "qa_v3";
  const hz = z.getComponent("minecraft:health").currentValue;
  let shot = false;
  for (let i = 0; i < 200 && !shot; i++) {
    await wait(1);
    shot = !z.isValid || z.getComponent("minecraft:health").currentValue < hz;
  }
  expect("squad_fire", shot, `zombie hp ${hz} → ${z.isValid ? z.getComponent("minecraft:health").currentValue : "dead"}`);
  expect("squad_no_ff", p.getComponent("minecraft:health").currentValue > 0, "owner hurt");
  if (z.isValid) z.remove();
  // ついて来る：持ち主が 14 ブロック離れると寄ってくる
  p.teleport({ x: 30.5, y: Y, z: 0.5 });
  let near = false;
  for (let i = 0; i < 300 && !near; i++) {
    await wait(1);
    near = squadOf(p).every((m) => Math.hypot(m.ent.location.x - 30.5, m.ent.location.z - 0.5) < 8);
  }
  expect("squad_follow", near, JSON.stringify(squadOf(p).map((m) => m.ent.location)));
  orderSquad(p, "hold");
  const before = squadOf(p).map((m) => ({ ...m.ent.location }));
  p.teleport({ x: 0.5, y: Y, z: 0.5 });
  await wait(80);
  const moved = squadOf(p).some((m, i) => Math.hypot(m.ent.location.x - before[i].x, m.ent.location.z - before[i].z) > 3);
  expect("squad_hold", !moved, "moved while holding");
  orderSquad(p, "dismiss");
  await wait(5);
  expect("squad_dismiss", squadOf(p).length === 0, `n=${squadOf(p).length}`);
  S(p).classSwitchAt = 0;
  setLoadout(p, "assault", [null, null, null]);
  log(`v3: ok=${ok}/${n}`);
}

const STAGES = { diag, weapons, melee, throw: throwables, gear, enemies, bosses, structures, streaks, modes, misc, specials, facetest, nukes, v3 };

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
