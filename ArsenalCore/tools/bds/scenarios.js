// ARSENAL CORE — BDS での実機確認シナリオ（tools/bds/run.py が DEV_GAMETEST=1 のとき BDS 上のコピーにだけ読み込む。配布物には入らない）
//   シミュレートプレイヤーは、それを生成したパックのスクリプトからしか扱えないため、アドオン本体のコピーに読み込ませる
import { world, system, ItemStack, BlockVolume, GameMode } from "@minecraft/server";
import { spawnSimulatedPlayer } from "@minecraft/server-gametest";
import { S } from "./core/state.js";
import { startReload } from "./core/reload.js";
import { isIndoor } from "./fx/effects.js";
import { summonBoss } from "./systems/bosses.js";
import { spawnEnemy } from "./systems/ai/brain.js";
import { nearPoint } from "./core/pathlock.js";
import { setPrefs } from "./core/settings.js";
const log = (...a) => console.warn("[DEVTEST] " + a.join(" "));
const dim = () => world.getDimension("overworld");
const Y = 120;
function platform() {
  dim().fillBlocks(new BlockVolume({ x: -6, y: Y - 1, z: -6 }, { x: 60, y: Y - 1, z: 6 }), "minecraft:stone");
  dim().fillBlocks(new BlockVolume({ x: -6, y: Y, z: -6 }, { x: 60, y: Y + 6, z: 6 }), "minecraft:air");
}
function clearMobs() {
  for (const e of dim().getEntities({ location: { x: 20, y: Y, z: 0 }, maxDistance: 60 })) if (e.typeId !== "minecraft:player") e.remove();
}
let sim = null;
function getSim() {
  if (sim && sim.isValid) return sim;
  sim = spawnSimulatedPlayer({ dimension: dim(), x: 0.5, y: Y, z: 0.5 }, "Tester", GameMode.Survival);
  return sim;
}
function give(p, id, n = 1, slot = 0) {
  p.getComponent("minecraft:inventory").container.setItem(slot, new ItemStack(id, n));
}
function zombieAt(x, z, hp) {
  const e = dim().spawnEntity("minecraft:zombie", { x, y: Y, z });
  e.addEffect("slowness", 600, { amplifier: 255, showParticles: false });
  e.addEffect("fire_resistance", 600, { amplifier: 0, showParticles: false });
  e.nameTag = "target";
  return e;
}
const after = (t, f) => system.runTimeout(() => { try { f(); } catch (e) { log("ERR", e, e.stack); } }, t);

system.afterEvents.scriptEventReceive.subscribe((ev) => {
  if (ev.id === "dev:players") log("players: " + world.getAllPlayers().map((p) => p.name + "@" + p.getComponent("minecraft:inventory").container.getItem(p.selectedSlotIndex)?.typeId).join(","));
  try {
    if (ev.id === "dev:setup") { platform(); clearMobs(); const p = getSim(); p.teleport({ x: 0.5, y: Y, z: 0.5 }); log("setup ok", p.name); }
    if (ev.id === "dev:bullet") bulletTest(Number(ev.message || 40));
    if (ev.id === "dev:c4") c4Test();
    if (ev.id === "dev:lock") lockTest(ev.message === "nolock");
    if (ev.id === "dev:lead") leadTest(Number(ev.message || 0));
    if (ev.id === "dev:mags") magsTest();
    if (ev.id === "dev:limb") limbTest();
    if (ev.id === "dev:ready") readyTest();
    if (ev.id === "dev:indoor") indoorTest();
    if (ev.id === "dev:spawn23") spawn23Test();
    if (ev.id === "dev:mother") motherTest();
    if (ev.id === "dev:despawn") despawnTest(ev.message);
    if (ev.id === "dev:ariadne") ariadneTest(ev.message || "back");
    if (ev.id === "dev:hud2") hud2Test();
    if (ev.id === "dev:structure") structureTest(ev.message);
  } catch (e) { log("ERR", e, e.stack); }
});

function bulletTest(distZ) {
  clearMobs();
  const p = getSim();
  p.teleport({ x: 0.5, y: Y, z: 0.5 });
  give(p, "arsenal:sentinel", 1, 0);
  give(p, "arsenal:ammo_medium", 64, 1);
  p.selectedSlotIndex = 0;
  const z = zombieAt(0.5 + distZ, 0.5, 20);
  after(1, () => log(`spawned at ${distZ}: valid=${z.isValid} loaded=${dim().isChunkLoaded({ x: 0.5 + distZ, y: Y, z: 0.5 })}`));
  let shotTick = -1;
  const hurt = world.afterEvents.entityHurt.subscribe((e) => {
    if (e.hurtEntity.id === z.id && shotTick >= 0) {
      log(`bullet dist=${distZ} hitDelayTicks=${system.currentTick - shotTick} dmg=${e.damage.toFixed(2)} cause=${e.damageSource.cause}`);
      world.afterEvents.entityHurt.unsubscribe(hurt);
    }
  });
  after(20, () => {
    p.lookAtLocation({ x: z.location.x, y: z.location.y + 1.0, z: z.location.z });
    after(5, () => {
      shotTick = system.currentTick;
      p.useItemInSlot(0);
      after(3, () => p.stopUsingItem());
      after(60, () => { const it = p.getComponent("minecraft:inventory").container.getItem(0); log(`bullet dist=${distZ} done zombieHp=${z.getComponent("minecraft:health")?.currentValue} ammo=${it?.getDynamicProperty("a:ammo")} init=${it?.getDynamicProperty("a:init")} rot=${JSON.stringify(p.getRotation())}`); world.afterEvents.entityHurt.unsubscribe(hurt); });
    });
  });
}

function c4Test() {
  clearMobs();
  const p = getSim();
  p.teleport({ x: 0.5, y: Y, z: 0.5 });
  give(p, "arsenal:c4", 4, 0);
  p.selectedSlotIndex = 0;
  const z = zombieAt(4.5, 0.5, 20);
  after(20, () => {
    p.lookAtEntity(z);
    after(5, () => {
      p.useItemInSlot(0);
      after(6, () => p.stopUsingItem());
      after(30, () => {
        const all = dim().getEntities({ type: "arsenal:projectile" });
        log(`c4 thrown: projectiles=${all.length} at ${all.map((e) => `${e.location.x.toFixed(2)},${e.location.y.toFixed(2)},${e.location.z.toFixed(2)}`).join(" ")} zombie=${z.location.x.toFixed(2)},${z.location.y.toFixed(2)} c4left=${p.getComponent("minecraft:inventory").container.getItem(0)?.amount}`);
      });
      after(40, () => {
        const start = { ...z.location };
        after(100, () => {
          const l = z.location;
          const c4 = dim().getEntities({ type: "arsenal:projectile", location: l, maxDistance: 3 });
          log(`c4 stuckNear=${c4.length} displacement=${Math.hypot(l.x - start.x, l.z - start.z).toFixed(3)}`);
        });
      });
    });
  });
}

function lockTest(noLock) {
  clearMobs();
  const p = getSim();
  p.teleport({ x: 0.5, y: Y, z: 0.5 });
  give(p, "arsenal:seeker", 1, 0);
  give(p, "arsenal:ammo_rocket", 8, 1);
  p.selectedSlotIndex = 0;
  const z = zombieAt(40.5, 6.0, 20);
  const hurt = world.afterEvents.entityHurt.subscribe((e) => {
    if (e.hurtEntity.id === z.id) { log(`lock${noLock ? "(no ADS)" : ""} HIT dmg=${e.damage.toFixed(2)} cause=${e.damageSource.cause}`); world.afterEvents.entityHurt.unsubscribe(hurt); }
  });
  after(20, () => {
    // 照準を敵から約 5° ずらす（ピクセル単位で重ねなくてもロックできるか）
    p.lookAtLocation({ x: 40.5, y: Y + 1.6, z: 2.5 });
    if (!noLock) p.isSneaking = true;
    after(40, () => {
      p.useItemInSlot(0);
      after(3, () => p.stopUsingItem());
      after(100, () => { p.isSneaking = false; log(`lock${noLock ? "(no ADS)" : ""} done zombieHp=${z.isValid ? z.getComponent("minecraft:health")?.currentValue : "dead"}`); world.afterEvents.entityHurt.unsubscribe(hurt); });
    });
  });
}

/** 横に走る相手（0.25 ブロック/tick）を 36 ブロック先で、覗いて 5 発撃つ。lead=0 は相手の今の位置、1 は弾の到達時間ぶん先を狙う */
function leadTest(lead) {
  clearMobs();
  const p = getSim();
  p.teleport({ x: 0.5, y: Y, z: 0.5 });
  try { p.isSprinting = false; } catch {}
  p.stopMoving();
  give(p, "arsenal:longbow", 1, 0);
  give(p, "arsenal:ammo_heavy", 64, 1);
  p.selectedSlotIndex = 0;
  const D = 36.5;
  const z = zombieAt(D, -6, 200);
  z.getComponent("minecraft:health").setCurrentValue(20);
  let zz = -6, hits = 0, shots = 0;
  const hurt = world.afterEvents.entityHurt.subscribe((e) => { if (e.hurtEntity.id === z.id && e.damageSource.cause === "entityAttack") { hits++; z.getComponent("minecraft:health").setCurrentValue(20); } });
  after(10, () => {
    p.isSneaking = true;
    let k = 0;
    const mv = system.runInterval(() => {
      if (!z.isValid) return;
      k++;
      zz += 0.25;
      if (zz > 6) zz = -6;
      z.teleport({ x: D, y: Y, z: zz });
      // 30 tick 覗いてから、12 tick ごとに撃つ（5 発）
      if (k > 30 && (k - 30) % 12 === 0 && shots < 5) {
        const t = 1 + D / 14;
        let aimZ = zz + (lead ? 0.25 * t : 0);
        p.lookAtLocation({ x: D, y: Y + 1.1, z: aimZ });
        shots++;
        system.runTimeout(() => { p.useItemInSlot(0); system.runTimeout(() => p.stopUsingItem(), 1); }, 1);
      }
      if (k > 110) {
        system.clearRun(mv);
        world.afterEvents.entityHurt.unsubscribe(hurt);
        p.isSneaking = false;
        const it = p.getComponent("minecraft:inventory").container.getItem(0);
        log(`lead=${lead} shots=${shots} hits=${hits} ammoLeft=${it?.getDynamicProperty("a:ammo")}`);
      }
    }, 1);
  });
}

/** 2.2：薬室の 1 発と途中のマガジン。10 発撃ってからリロード → 31 発、残り 19 発のマガジンが残る */
function magsTest() {
  clearMobs();
  const p = getSim();
  p.teleport({ x: 0.5, y: Y, z: 0.5 });
  give(p, "arsenal:sentinel", 1, 0);
  give(p, "arsenal:ammo_medium", 60, 1);
  p.selectedSlotIndex = 0;
  after(10, () => {
    p.lookAtLocation({ x: 20, y: Y + 1, z: 0.5 });
    p.useItemInSlot(0);
    after(9, () => p.stopUsingItem());
    after(25, () => {
      const s = S(p);
      const before = s.ammo;
      startReload(p, s, true);
      after(80, () => {
        const it = p.getComponent("minecraft:inventory").container.getItem(0);
        const res = p.getComponent("minecraft:inventory").container.getItem(1)?.amount;
        log(`mags before=${before} after=${s.ammo} partial=${it?.getDynamicProperty("a:mg")} reserveItems=${res}`);
      });
    });
  });
}

/** 2.2：ゾンビの脚を撃つと鈍足になる */
function limbTest() {
  clearMobs();
  const p = getSim();
  p.teleport({ x: 0.5, y: Y, z: 0.5 });
  give(p, "arsenal:sentinel", 1, 0);
  give(p, "arsenal:ammo_medium", 60, 1);
  p.selectedSlotIndex = 0;
  const z = zombieAt(8.5, 0.5, 20);
  z.removeEffect("slowness");
  after(10, () => {
    p.isSneaking = true;
    after(20, () => {
      p.lookAtLocation({ x: 8.5, y: Y + 0.35, z: 0.5 });
      p.useItemInSlot(0);
      after(2, () => p.stopUsingItem());
      after(10, () => {
        const ef = z.getEffect("slowness");
        p.isSneaking = false;
        log(`limb slowness=${ef ? ef.duration + "t amp" + ef.amplifier : "none"} hp=${z.getComponent("minecraft:health")?.currentValue}`);
      });
    });
  });
}

/** 2.2：走るのをやめた直後は撃てず、構え終わってから撃つ */
function readyTest() {
  clearMobs();
  const p = getSim();
  p.teleport({ x: 0.5, y: Y, z: 0.5 });
  give(p, "arsenal:sentinel", 1, 0);
  give(p, "arsenal:ammo_medium", 60, 1);
  p.selectedSlotIndex = 0;
  after(10, () => {
    const s = S(p);
    try { p.isSprinting = true; } catch (e) { log("isSprinting not settable", e); }
    p.moveRelative(0, 1, 1);
    after(10, () => {
      const pose = s.sprintPose;
      p.stopMoving();
      try { p.isSprinting = false; } catch {}
      after(1, () => {
        const a0 = s.ammo;
        p.useItemInSlot(0);
        after(2, () => {
          const a1 = s.ammo;
          after(10, () => {
            p.stopUsingItem();
            log(`ready sprintPose=${pose} readyAt-now=${s.readyAt - system.currentTick} ammo ${a0} -> ${a1} (2t) -> ${s.ammo} (12t)`);
          });
        });
      });
    });
  });
}

/** 2.2：石の小屋の中は屋内、外は屋外と判定する */
function indoorTest() {
  const d = dim();
  d.fillBlocks(new BlockVolume({ x: 30, y: Y, z: -4 }, { x: 36, y: Y + 4, z: 2 }), "minecraft:stone");
  d.fillBlocks(new BlockVolume({ x: 31, y: Y, z: -3 }, { x: 35, y: Y + 3, z: 1 }), "minecraft:air");
  const inside = isIndoor(d, { x: 33, y: Y + 1.5, z: -1 }, "t1");
  const outside = isIndoor(d, { x: 10, y: Y + 1.5, z: 0 }, "t2");
  log(`indoor inside=${inside} outside=${outside}`);
}

// 2.3：新しい敵・ボス・銃座・乗り物が実機で読み込まれ、出せるか
function spawn23Test() {
  const ids = ["raider_breacher", "raider_scout", "raider_marksman", "legion_lancer", "legion_hunter", "hollow_crawler", "gl_post", "apc"];
  const out = ids.map((id, i) => {
    try {
      const e = dim().spawnEntity(`arsenal:${id}`, { x: 6 + i * 4, y: Y, z: 3 });
      return [id, e];
    } catch (err) {
      return [id, null, String(err)];
    }
  });
  after(60, () => log("spawn23 " + out.map(([id, e, err]) => `${id}=${e && e.isValid ? "ok" : err ?? "gone"}`).join(" ")));
}

// 2.3：ホロウ・マザーを呼び、出現と群れの召喚を確かめる
function motherTest() {
  for (const e of dim().getEntities({ families: ["arsenal_enemy"] })) e.remove();
  for (const e of dim().getEntities({ type: "arsenal:boss_hollow_mother" })) e.remove();
  // 増援は周囲 6 ブロックに出るので、足場を広げる
  dim().fillBlocks(new BlockVolume({ x: -10, y: Y - 1, z: -16 }, { x: 30, y: Y - 1, z: 16 }), "minecraft:stone");
  dim().fillBlocks(new BlockVolume({ x: -10, y: Y, z: -16 }, { x: 30, y: Y + 6, z: 16 }), "minecraft:air");
  const p = getSim();
  p.addEffect("resistance", 2400, { amplifier: 4, showParticles: false });
  p.addEffect("fire_resistance", 2400, { amplifier: 0, showParticles: false });
  give(p, "arsenal:hollow_heart", 1, 0);
  world.gameRules.doMobSpawning = false;
  p.teleport({ x: 0.5, y: Y, z: 0.5 }, { rotation: { x: 0, y: -90 } }); // 東（+x、足場の上）を向く
  if (!globalThis.__motherDbg) {
    globalThis.__motherDbg = true;
    world.afterEvents.entityDie.subscribe((ev) => {
      if (ev.deadEntity.typeId?.startsWith("arsenal:hollow")) log(`die ${ev.deadEntity.typeId} cause=${ev.damageSource.cause} by=${ev.damageSource.damagingEntity?.typeId}`);
    });
    globalThis.__lastPos = new Map();
    system.runInterval(() => {
      for (const e of dim().getEntities({ families: ["arsenal_hollow"] })) globalThis.__lastPos.set(e.id, `${e.location.x.toFixed(1)},${e.location.y.toFixed(1)},${e.location.z.toFixed(1)} v=${JSON.stringify(e.getVelocity())}`);
    }, 1);
    world.afterEvents.entityRemove.subscribe((ev) => {
      if (ev.typeId?.startsWith("arsenal:hollow")) log(`removed ${ev.typeId} last=${globalThis.__lastPos.get(ev.removedEntityId)} tick=${system.currentTick}`);
    });
  }
  const ok = summonBoss(p, "boss_hollow_mother", "arsenal:hollow_heart");
  log(`mother summon=${ok}`);
  after(100, () => {
    const m = dim().getEntities({ type: "arsenal:boss_hollow_mother" })[0];
    log(`mother spawned=${!!m} hp=${m?.getComponent("minecraft:health")?.currentValue} at=${m ? [m.location.x, m.location.y, m.location.z].map((v) => v.toFixed(1)).join(",") : "-"} target=${m?.target?.typeId}`);
    if (!m) return;
    for (const t of [100, 200, 300, 400, 500]) after(t, () => {
      const kids = dim().getEntities({ tags: [`arsenal_minion:${m.id}`] });
      const all = dim().getEntities({ families: ["arsenal_hollow"] }).filter((e) => e.typeId !== "arsenal:boss_hollow_mother");
      log(`mother t=${t} minions=${kids.length} hollow=${all.length} types=${[...new Set(kids.map((k) => k.typeId))].join(",")} simHp=${p.getComponent("minecraft:health")?.currentValue}`);
    });
    // 撃破すると手下は朽ちて倒れる
    after(520, () => m.isValid && m.kill());
    after(1000, () => log(`mother killed: minions left=${dim().getEntities({ tags: [`arsenal_minion:${m.id}`] }).length}`));
  });
}

// 2.3：構造物を置き、宝箱の数を数える
function structureTest(sid) {
  const at = { x: 8, y: Y + 8, z: 10 };
  const p = getSim();
  p.teleport({ x: 0.5, y: Y, z: 0.5 });
  after(40, () => {
    world.structureManager.place(`arsenal:${sid}`, dim(), at);
    const st = world.structureManager.get(`arsenal:${sid}`);
    let chests = 0;
    for (let x = 0; x < st.size.x; x++) for (let y = 0; y < st.size.y; y++) for (let z = 0; z < st.size.z; z++) {
      if (dim().getBlock({ x: at.x + x, y: at.y + y, z: at.z + z })?.typeId === "minecraft:chest") chests++;
    }
    log(`structure ${sid} size=${st.size.x}x${st.size.y}x${st.size.z} chests=${chests}`);
  });
}

// 出した敵が勝手に消えないか（ボスの増援と同じく persist なしで出す）
function despawnTest(arg) {
  const p = getSim();
  const ids = ["hollow_runner", "hollow_crawler", "raider_gunner", "legion_trooper"];
  const viaAi = arg === "ai";
  const es = ids.map((id, i) => viaAi ? spawnEnemy(dim(), { x: 6 + i * 2, y: Y, z: 2 }, id, { tag: "arsenal_minion:x", src: "boss" }) : dim().spawnEntity(`arsenal:${id}`, { x: 6 + i * 2, y: Y, z: 2 }));
  for (const t of [40, 120, 200, 300]) after(t, () => log(`despawn t=${t} ` + es.map((e, i) => `${ids[i]}=${e.isValid ? "ok" : "gone"}`).join(" ") + ` simAt=${p.location.x.toFixed(1)},${p.location.y.toFixed(1)},${p.location.z.toFixed(1)}`));
}

// 2.4：アリアドネ。石の小屋（x 20..26, z -4..4）の中のゾンビを、壁越しに覗いてロックし撃つ
//   back   … 裏の壁（x=26）に 1 マスの穴：小屋の外を回って裏から入るか
//   window … 正面の壁の端（x=20, z=3）に 1 マスの窓
//   closed … 穴なし：ロックできないか
//   swap   … 正面と裏の 2 つの穴。ミサイルが近づいた穴をふさぐ：もう一方へ回り道するか
//   ミサイルの位置を毎 tick 記録し、ブロックの中に入った回数（inside）を数える
function ariadneTest(mode) {
  clearMobs();
  const d = dim();
  const p = getSim();
  p.teleport({ x: 0.5, y: Y, z: 0.5 });
  d.fillBlocks(new BlockVolume({ x: 20, y: Y, z: -4 }, { x: 26, y: Y + 4, z: 4 }), "minecraft:stone");
  d.fillBlocks(new BlockVolume({ x: 21, y: Y, z: -3 }, { x: 25, y: Y + 3, z: 3 }), "minecraft:air");
  const holes = mode === "back" ? [{ x: 26, y: Y + 1, z: 0 }] : mode === "window" ? [{ x: 20, y: Y + 2, z: 3 }] : mode === "swap" ? [{ x: 26, y: Y + 1, z: 0 }, { x: 20, y: Y + 2, z: 3 }] : [];
  for (const h of holes) d.getBlock(h)?.setType("minecraft:air");
  give(p, "arsenal:ariadne", 1, 0);
  give(p, "arsenal:ammo_rocket", 8, 1);
  p.selectedSlotIndex = 0;
  const z = zombieAt(23.5, 0.5, 20);
  let hit = false;
  const hurt = world.afterEvents.entityHurt.subscribe((e) => {
    if (e.hurtEntity.id === z.id && !hit) { hit = true; log(`ariadne(${mode}) HIT dmg=${e.damage.toFixed(2)} cause=${e.damageSource.cause}`); }
  });
  after(20, () => {
    p.lookAtLocation({ x: 23.5, y: Y + 1, z: 0.5 }); // 壁越しに覗く
    p.isSneaking = true;
    after(70, () => {
      const s = S(p);
      log(`ariadne(${mode}) lock target=${s.lockTarget === z.id} ticks=${s.lockTicks}`);
      // レーダーの影絵の置き場所：壁（x=20）より手前の、目とゾンビを結ぶ線の上
      const eye = p.getHeadLocation();
      const np = nearPoint(d, eye, z.getAABB().center);
      log(`ariadne(${mode}) radar eye=${[eye.x, eye.y, eye.z].map((v) => v.toFixed(2)).join(",")} silhouette=${np ? [np.pos.x, np.pos.y, np.pos.z].map((v) => v.toFixed(2)).join(",") + " k=" + np.k.toFixed(3) + " block=" + d.getBlock(np.pos)?.typeId : "visible"}`);
      p.useItemInSlot(0);
      after(3, () => p.stopUsingItem());
      let inside = 0, samples = 0, maxX = 0, closed = "";
      const mv = system.runInterval(() => {
        for (const m of d.getEntities({ type: "arsenal:projectile", location: { x: 13, y: Y, z: 0 }, maxDistance: 40 })) {
          samples++;
          const b = d.getBlock(m.location);
          if (b && !b.isAir && !b.isLiquid && !b.typeId.startsWith("minecraft:light_block")) inside++;
          maxX = Math.max(maxX, m.location.x);
          if (mode === "swap" && !closed) {
            for (const h of holes) {
              const dd = Math.hypot(m.location.x - (h.x + 0.5), m.location.y - (h.y + 0.5), m.location.z - (h.z + 0.5));
              if (dd < 4.5 && dd > 2) { d.getBlock(h)?.setType("minecraft:stone"); closed = `${h.x},${h.y},${h.z}`; break; }
            }
          }
        }
      }, 1);
      after(240, () => {
        system.clearRun(mv);
        world.afterEvents.entityHurt.unsubscribe(hurt);
        p.isSneaking = false;
        log(`ariadne(${mode}) done hit=${hit} zombieHp=${z.isValid ? z.getComponent("minecraft:health")?.currentValue : "dead"} samples=${samples} inside=${inside} maxX=${maxX.toFixed(1)} closed=${closed || "-"}`);
      });
    });
  });
}

// 2.4.1：HUD 2.0 の照準・方位はサブタイトルで送る。向きを変え続けても例外が出ず、タイトルは毎 tick 送らないか
function hud2Test() {
  const p = getSim();
  give(p, "arsenal:sentinel", 1, 0);
  p.selectedSlotIndex = 0;
  setPrefs(p, { hudStyle: "hud2", compass: true });
  const s = S(p);
  let yaw = 0, k = 0, titles = 0, lives = 0, lastLast = s.hud2Last, lastLive = s.hud2Live;
  const mv = system.runInterval(() => {
    k++;
    yaw += 7;
    p.setRotation({ x: 0, y: yaw });
    if (s.hud2Last !== lastLast) { titles++; lastLast = s.hud2Last; }
    if (s.hud2Live !== lastLive) { lives++; lastLive = s.hud2Live; }
    if (k >= 60) {
      system.clearRun(mv);
      log(`hud2 ticks=${k} titleChanges=${titles} subtitleChanges=${lives} live=${JSON.stringify(s.hud2Live)}`);
    }
  }, 1);
}
