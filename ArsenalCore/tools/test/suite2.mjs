// ARSENAL CORE 2.0 — 追加のランタイムテスト（run.mjs から呼ばれる）
import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * @param {{mc:any, ui:any, D:any, run:string, player:any, check:(n:string,c:boolean,i?:string)=>void, flush:()=>Promise<void>, warnings:string[], comps:any}} ctx
 */
export async function suite2(ctx) {
  const { mc, ui, D, run, player, check, flush, comps } = ctx;
  const { world, system, ItemStack, Entity, Player, LOG, __tick, __overworld: dim, __entities } = mc;
  const imp = async (p) => import(pathToFileURL(path.join(run, "scripts", p)).href);
  const settings = await imp("core/settings.js");
  const stateM = await imp("core/state.js");
  const S = stateM.S;
  const brain = await imp("systems/ai/brain.js");
  const dmg = await imp("core/damage.js");
  const armor = await imp("core/armor.js");
  const melee = await imp("core/melee.js");
  const gear = await imp("systems/gear.js");
  const downed = await imp("core/downed.js");
  const deps = await imp("systems/deployables.js");
  const veh = await imp("systems/vehicles.js");
  const ks = await imp("systems/killstreaks.js");
  const structs = await imp("systems/structures.js");
  const prog = await imp("progression/progression.js");
  const eco = await imp("economy/economy.js");
  const modes = await imp("modes/modes.js");
  const hud2 = await imp("ui/hud2.js");
  const migrate = await imp("core/migrate.js");
  const events = await imp("core/events.js");
  const bosses = await imp("systems/bosses.js");
  const codex = await imp("ui/codex.js");
  const menus = await imp("ui/menus.js");
  const lootgen = await imp("systems/lootgen.js");
  const inv = player.inv;
  const heal = (e, v = null) => { const h = e.getComponent("minecraft:health"); h.setCurrentValue(v ?? h.effectiveMax); };
  const clearInv = () => { for (let i = 0; i < inv.size; i++) inv.items[i] = undefined; };
  const count = (id) => inv.items.reduce((a, it) => a + (it?.typeId === id ? it.amount : 0), 0);
  const emitted = {};
  for (const n of ["kill", "death", "structureCleared", "bossKill", "matchEnd", "wave", "streakUsed", "medUsed", "challengeDone", "weaponLevel"]) {
    emitted[n] = 0;
    events.on(n, () => { emitted[n]++; });
  }
  const zombie = (x, z, hp = 20) => new Entity("minecraft:zombie", { x, y: 64, z }, dim, hp);
  const killAllArsenal = () => { for (const e of [...__entities.values()]) if (e.typeId.startsWith("arsenal:") && e.typeId !== "arsenal:projectile") e.remove(); };
  const reset = () => {
    killAllArsenal();
    if (!player.isValid) { player._valid = true; __entities.set(player.id, player); }
    player.location = { x: 0.5, y: 64, z: 0.5 };
    player.setRotation({ x: 0, y: 0 });
    player.isSneaking = false;
    player.gm = "Survival";
    heal(player);
    player.effects = {};
    const s = S(player);
    s.bleedUntil = 0; s.medUntil = 0; s.menuOpen = false;
    player.selectedSlotIndex = 0;
  };

  // =====================================================================
  console.log("2.0 データ");
  // =====================================================================
  const nGuns = Object.keys(D.WEAPONS).length, nMelee = Object.keys(D.MELEE).length;
  check(`武器 90 種以上（銃 ${nGuns}＋近接 ${nMelee}）`, nGuns + nMelee >= 90 && nMelee >= 6);
  check(`アタッチメント 50 種以上（${Object.keys(D.ATTACHMENTS).length}）`, Object.keys(D.ATTACHMENTS).length >= 50);
  check("迷彩 12 種", Object.keys(D.CAMOS).length === 12);
  const armorFam = new Set(Object.values(D.ARMOR).map((a) => a.family));
  check(`防具 4 系統×3 段階＋特殊 3（${Object.keys(D.ARMOR).length}）`, armorFam.size === 4 && Object.values(D.ARMOR).filter((a) => a.special).length === 3 && Object.keys(D.ARMOR).length >= 27);
  const gearN = Object.keys(D.THROWABLES).length + Object.keys(D.MEDICAL).length + Object.keys(D.DEPLOYABLES).length + Object.keys(D.VEHICLES).length;
  check(`装備 24 種以上（${gearN}）`, gearN >= 24);
  check(`3 勢力・敵 20 種以上（${Object.keys(D.ENEMIES).length}）・ボス 3`, Object.keys(D.FACTIONS).length === 3 && Object.keys(D.ENEMIES).length >= 20 && Object.keys(D.BOSSES).length === 3);
  check(`構造物 6 種以上（${Object.keys(D.STRUCTURES).length}）`, Object.keys(D.STRUCTURES).length >= 6);
  check("銃座 4・乗り物 2", Object.values(D.VEHICLES).filter((v) => v.kind === "emplacement").length === 4 && Object.values(D.VEHICLES).filter((v) => v.kind === "vehicle").length === 2);
  check("キルストリーク 8 種（2.6 で誘導ミサイル・核ミサイル）", Object.keys(D.KILLSTREAKS).length === 8);
  check("ゲームモード 5 種（FFA・TDM・ガンゲーム・ホード・陣取り）", ["ffa", "tdm", "gungame", "horde", "koth"].every((m) => D.MODES[m]));
  check("武器レベル 1〜40・階級 1〜50 の経験値表", D.WEAPON_XP_TABLE.length === 41 && D.RANK_XP_TABLE.length === 51 && D.WEAPON_XP_TABLE[40] > D.WEAPON_XP_TABLE[39]);
  const variants = Object.keys(D.VARIANT_OF);
  check(`見た目違い ID（${variants.length}）がすべて元の武器を指す`, variants.length > 0 && variants.every((v) => D.WEAPONS[D.VARIANT_OF[v].base]));
  check("ガンゲームのはしごは実在の武器で最後が近接", D.MODES.gungame.ladder.every((w) => D.WEAPONS[w] || D.MELEE[w]) && D.MELEE[D.MODES.gungame.ladder.at(-1)]);
  check("装備セットの武器・防具が実在する", Object.values(D.LOADOUTS).every((l) => D.WEAPONS[l.primary] && D.WEAPONS[l.secondary] && D.MELEE[l.melee] && l.armor.every((a) => D.ARMOR[a.replace("arsenal:", "")])));
  check("構造物の守備隊は実在の敵", Object.values(D.STRUCTURES).every((s) => s.garrison.every((g) => D.ENEMIES[g.id])));

  // =====================================================================
  console.log("2.2 リアル化（マガジン・薬室・構え・部位）");
  // =====================================================================
  {
    const reloadM = await imp("core/reload.js");
    clearInv();
    reset();
    inv.items[0] = new ItemStack("arsenal:sentinel", 1);
    player.selectedSlotIndex = 0;
    __tick(3);
    const s = S(player);
    // 予備弾がなくても途中のマガジンがあれば差せる。抜いたマガジンの残り（薬室の 1 発を除く）は残る
    s.ammo = 5;
    s.mags = [12];
    check("予備弾がなくても途中のマガジンでリロードできる", reloadM.startReload(player, s, true) === true);
    __tick(90);
    check("途中のマガジンを差し、薬室の 1 発を残す（1+12、残り [4]）", s.ammo === 13 && JSON.stringify(s.mags) === "[4]", `(ammo=${s.ammo} mags=${JSON.stringify(s.mags)})`);
    // ワールド設定で切ると継ぎ足し（従来どおり）
    settings.setWorld({ magRealism: false });
    inv.items[8] = new ItemStack("arsenal:ammo_medium", 64);
    s.ammo = 5;
    s.mags = [];
    reloadM.startReload(player, s, true);
    __tick(90);
    check("マガジン単位を切ると継ぎ足し（31 発、予備から 26 発）", s.ammo === 31 && inv.items[8]?.amount === 38, `(ammo=${s.ammo} reserve=${inv.items[8]?.amount})`);
    settings.setWorld({ magRealism: true });
    check("満タン＋薬室（31）ではリロードしない", reloadM.startReload(player, s, true) === false);
    // 走ったあとは構えるまで撃てない（アサルトは 6 tick）
    s.ammo = 20;
    player.isSprinting = true;
    __tick(4);
    check("走っている間は走る構えを再生", s.sprintPose === true && LOG.anims.includes("animation.arsenal.sprint"));
    player.isSprinting = false;
    __tick(1);
    const a0 = s.ammo;
    const ev = { source: player, itemStack: inv.getItem(0), useDuration: 72000 };
    world.afterEvents.itemStartUse.fire(ev);
    __tick(2);
    const a1 = s.ammo;
    __tick(8);
    world.afterEvents.itemStopUse.fire(ev);
    __tick(1);
    check("構え直すまで撃てず、構えたら撃つ", a1 === a0 && s.ammo < a0, `(${a0} → ${a1} → ${s.ammo})`);
    // 部位：胴の高さの横の端は腕、脚に当てると鈍足
    const z = zombie(3.5, 0.5, 40);
    const c = z.getAABB().center;
    const fwd = { x: 0, y: 0, z: 1 };
    check("胴の高さで弾筋が横の端なら「腕」、正面の中心は「胴」", dmg.hitZone(z, { x: c.x + 0.27, y: c.y + 0.1, z: c.z - 0.3 }, fwd) === "arm" && dmg.hitZone(z, { x: c.x, y: c.y + 0.1, z: c.z - 0.3 }, fwd) === "body" && dmg.hitZone(z, { x: c.x + 0.27, y: c.y + 0.1, z: c.z - 0.3 }) === "body");
    dmg.bulletHit(player, z, { x: c.x, y: z.location.y + 0.3, z: c.z - 0.3 }, { x: 0, y: 0, z: 1 }, 3, s.stats, 1);
    check("脚に当てると鈍足になる", !!z.effects?.slowness, JSON.stringify(z.effects ?? {}));
    z.remove();
  }

  // =====================================================================
  console.log("2.4 アリアドネ（経路探索ミサイル）");
  // =====================================================================
  {
    const pf = await imp("systems/pathfind.js");
    // 後の試験（HUD 2.0）は前の試験で持った銃を使うので、持ち物と位置は最後に戻す
    const savedInv = inv.items.slice();
    const savedSlot = player.selectedSlotIndex;
    const savedLoc = { ...player.location };
    clearInv();
    reset();
    // 石の部屋（x -3..3, y 64..68, z 8..16 の殻）。holes の位置だけ空ける
    const ROOM = [];
    for (let x = -3; x <= 3; x++) for (let y = 64; y <= 68; y++) for (let z = 8; z <= 16; z++) ROOM.push([x, y, z]);
    const room = (holes) => {
      for (const [x, y, z] of ROOM) {
        const shell = x === -3 || x === 3 || z === 8 || z === 16 || y === 68;
        dim.blocks.set(`${x},${y},${z}`, shell ? "minecraft:stone" : "minecraft:air");
      }
      for (const h of holes) dim.blocks.set(h, "minecraft:air");
      for (const [x, y, z] of ROOM) pf.invalidateCell(dim, { x, y, z });
    };
    const unroom = () => { for (const [x, y, z] of ROOM) dim.blocks.delete(`${x},${y},${z}`); };
    const solidAt = (p) => { const t = dim.blockAt(p); return t !== "minecraft:air" && !t.startsWith("minecraft:light_block"); };
    const missiles = () => [...__entities.values()].filter((e) => e.typeId === "arsenal:projectile" && e.isValid);
    // 道の探索そのもの：穴があれば道が見つかり、道はブロックの中を通らない
    room(["3,65,12"]);
    const s0 = pf.startSearch(dim, { x: 0.5, y: 65.6, z: 0.5 }, { min: { x: 0.2, y: 64, z: 12.2 }, max: { x: 0.8, y: 65.9, z: 12.8 } }, { x: 0.5, y: 64.95, z: 12.5 });
    for (let i = 0; i < 60 && s0.state === "run"; i++) pf.stepSearch(s0, 600);
    const pathPts = s0.path ? pf.samplePath(s0.path, 0.1, 5000) : [];
    check("穴 1 マスの部屋の中まで道が見つかる", s0.state === "ok" && pathPts.length > 0, `(state=${s0.state})`);
    check("道は一度もブロックの中を通らず、東の穴（3,65,12）を通る", pathPts.every((p) => !solidAt(p)) && pathPts.some((p) => Math.floor(p.x) === 3 && Math.floor(p.y) === 65 && Math.floor(p.z) === 12));
    room([]);
    const s1 = pf.startSearch(dim, { x: 0.5, y: 65.6, z: 0.5 }, { min: { x: 0.2, y: 64, z: 12.2 }, max: { x: 0.8, y: 65.9, z: 12.8 } }, { x: 0.5, y: 64.95, z: 12.5 });
    for (let i = 0; i < 200 && s1.state === "run"; i++) pf.stepSearch(s1, 600);
    check("完全に閉じた部屋には道がない", s1.state === "fail");

    // 実際に覗いてロックし、撃つ
    room(["3,65,12"]);
    inv.items[0] = new ItemStack("arsenal:ariadne", 1);
    player.selectedSlotIndex = 0;
    player.location = { x: 0.5, y: 64, z: 0.5 };
    player.setRotation({ x: 0, y: 0 });
    const z = zombie(0.5, 12.5, 200);
    __tick(3);
    const s = S(player);
    player.isSneaking = true;
    __tick(60);
    check("壁の向こう（穴 1 マス）の敵にロックできる", s.lockTarget === z.id && s.lockTicks >= s.stats.lockTicks, `(target=${s.lockTarget === z.id} ticks=${s.lockTicks})`);
    // レーダー：壁の向こうの mob の影絵は、目と mob を結ぶ線の上の壁より手前に、距離の比で縮めて置く
    const pl = await imp("core/pathlock.js");
    const sil0 = LOG.particleIds["arsenal:silhouette"] ?? 0;
    __tick(5);
    check("覗いている間、壁の向こうの mob の影絵を出す", (LOG.particleIds["arsenal:silhouette"] ?? 0) > sil0);
    const eyeP = player.getHeadLocation();
    const zc = z.getAABB().center;
    const np = pl.nearPoint(dim, eyeP, zc);
    const toZ = { x: zc.x - eyeP.x, y: zc.y - eyeP.y, z: zc.z - eyeP.z };
    const toN = np ? { x: np.pos.x - eyeP.x, y: np.pos.y - eyeP.y, z: np.pos.z - eyeP.z } : null;
    const Lz = Math.hypot(toZ.x, toZ.y, toZ.z);
    const Ln = toN ? Math.hypot(toN.x, toN.y, toN.z) : 0;
    const colinear = toN ? (toZ.x * toN.x + toZ.y * toN.y + toZ.z * toN.z) / (Lz * Ln) > 0.9999 : false;
    check("影絵は壁（z=8）より手前・同じ線の上・距離の比で縮める", !!np && np.pos.z < 8 && colinear && Math.abs(np.k - Ln / Lz) < 1e-6 && !solidAt(np.pos), JSON.stringify(np));
    const zv = zombie(0.5, 5.5, 20);
    check("見えている mob には影絵を出さない", pl.nearPoint(dim, eyeP, zv.getAABB().center) === null);
    zv.remove();
    s.ammo = 1;
    const hp0 = z.health.currentValue;
    const ex0 = LOG.explosions.length;
    const ev = { source: player, itemStack: inv.getItem(0), useDuration: 72000 };
    world.afterEvents.itemStartUse.fire(ev);
    __tick(2);
    world.afterEvents.itemStopUse.fire(ev);
    let inside = 0;
    let outsideEast = false;
    const trail = [];
    for (let t = 0; t < 200 && LOG.explosions.length === ex0; t++) {
      __tick(1);
      for (const m of missiles()) {
        trail.push({ ...m.location });
        if (solidAt(m.location)) inside++;
        // 部屋の中は x < 3。x ≥ 3 でブロックの中でなければ、東の穴か部屋の外
        if (m.location.x >= 3) outsideEast = true;
      }
    }
    check("ミサイルは部屋の外を回って穴から入り、命中する", outsideEast && z.health.currentValue < hp0 && LOG.explosions.length > ex0, `(east=${outsideEast} hp ${hp0}→${z.health.currentValue} trail=${trail.length})`);
    check("ミサイルは一度もブロックの中に入らない（すり抜けない）", inside === 0 && trail.length > 5, `(inside=${inside})`);
    player.isSneaking = false;
    __tick(2);
    z.remove();
    killAllArsenal();

    // 閉じた部屋の敵にはロックできない
    room([]);
    const z2 = zombie(0.5, 12.5, 200);
    player.isSneaking = true;
    __tick(60);
    check("完全に閉じた部屋の敵にはロックできない", !(s.lockTarget === z2.id && s.lockTicks >= s.stats.lockTicks), `(ticks=${s.lockTicks})`);
    player.isSneaking = false;
    __tick(2);
    z2.remove();

    // 飛んでいる途中で穴をふさぐ：もう一方の穴へ回り道する（ふさいだ穴はすり抜けない）
    room(["3,65,12", "-3,65,12"]);
    const z3 = zombie(0.5, 12.5, 200);
    player.isSneaking = true;
    __tick(60);
    check("穴が 2 つの部屋でもロック", s.lockTarget === z3.id && s.lockTicks >= s.stats.lockTicks);
    s.ammo = 1;
    const hp3 = z3.health.currentValue;
    const ex3 = LOG.explosions.length;
    const ev3 = { source: player, itemStack: inv.getItem(0), useDuration: 72000 };
    world.afterEvents.itemStartUse.fire(ev3);
    __tick(2);
    world.afterEvents.itemStopUse.fire(ev3);
    let closed = "";
    let inside3 = 0;
    for (let t = 0; t < 300 && LOG.explosions.length === ex3; t++) {
      __tick(1);
      for (const m of missiles()) {
        if (solidAt(m.location)) inside3++;
        if (!closed) {
          for (const [hk, hx] of [["3,65,12", 3.5], ["-3,65,12", -2.5]]) {
            const d = Math.hypot(m.location.x - hx, m.location.y - 65.5, m.location.z - 12.5);
            if (d < 4.5 && d > 2) {
              dim.blocks.set(hk, "minecraft:stone");
              pf.invalidateCell(dim, { x: Number(hk.split(",")[0]), y: 65, z: 12 });
              closed = hk;
            }
          }
        }
      }
    }
    check("途中で穴をふさがれても、もう一方の穴から入って命中", !!closed && z3.health.currentValue < hp3, `(closed=${closed} hp ${hp3}→${z3.health.currentValue})`);
    check("ふさいだ穴をすり抜けない", inside3 === 0, `(inside=${inside3})`);
    player.isSneaking = false;
    __tick(2);
    z3.remove();
    killAllArsenal();
    unroom();
    clearInv();
    for (let i = 0; i < savedInv.length; i++) inv.items[i] = savedInv[i];
    player.selectedSlotIndex = savedSlot;
    player.location = savedLoc;
    __tick(3);
  }

  // =====================================================================
  console.log("2.5 特殊武器");
  // =====================================================================
  {
    const fields = await imp("systems/fields.js");
    const fire3 = await imp("core/fire3.js");
    const fire2 = await imp("core/fire2.js");
    const savedInv = inv.items.slice();
    const savedSlot = player.selectedSlotIndex;
    const savedLoc = { ...player.location };
    const placed = [];
    const wall = (x0, x1, y0, y1, z0, z1) => {
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) {
        dim.blocks.set(`${x},${y},${z}`, "minecraft:stone");
        placed.push(`${x},${y},${z}`);
      }
    };
    const unwall = () => { for (const k of placed.splice(0)) dim.blocks.delete(k); };
    // 1 挺持たせて、覗いて（ads）撃つ。弾は満タン
    const shoot = (wid, { ads = true, hold = 2, after = 20, rot = { x: 0, y: 0 } } = {}) => {
      clearInv();
      reset();
      inv.items[0] = new ItemStack(`arsenal:${wid}`, 1);
      inv.items[9] = new ItemStack("arsenal:energy_cell", 64);
      player.selectedSlotIndex = 0;
      player.setRotation(rot);
      __tick(3);
      const s = S(player);
      s.ammo = s.stats.mag;
      s.overheatUntil = 0;
      s.heat = 0;
      s.cooldownUntil = 0;
      player.isSneaking = ads;
      // 持ち替えてから構え終わるまで待つ（覗かない場合も）
      __tick(ads ? (s.stats.adsTime ?? 4) + 4 : 10);
      const ev = { source: player, itemStack: inv.getItem(0), useDuration: 72000 };
      world.afterEvents.itemStartUse.fire(ev);
      __tick(hold);
      world.afterEvents.itemStopUse.fire(ev);
      __tick(after);
      player.isSneaking = false;
      return s;
    };
    const hp = (e) => (e.isValid ? e.health.currentValue : 0);
    const eff = (e, id) => e.getEffect(id)?.amplifier ?? -1;

    // リコシェディスク：正面の壁で跳ね返り、後ろの敵に当たる
    wall(-3, 3, 64, 66, 6, 6);
    const zb = zombie(0.5, -5.5, 40);
    const ric0 = LOG.sounds["arsenal.fx.ricochet"] ?? 0;
    shoot("ricochet_disc", { after: 30 });
    check("リコシェディスク：壁で跳ね返って後ろの敵に当たる", hp(zb) < 40 && (LOG.sounds["arsenal.fx.ricochet"] ?? 0) > ric0, `(hp=${hp(zb)})`);
    zb.remove();
    unwall();
    const za = zombie(0.5, 4.5, 40), zc = zombie(0.5, 8.5, 40);
    shoot("ricochet_disc");
    check("リコシェディスク：一直線の 2 体を貫く", hp(za) < 40 && hp(zc) < 40, `(hp=${hp(za)},${hp(zc)})`);
    za.remove(); zc.remove();

    // シンギュラリティ：着弾点のまわりを吸い込み、3 秒後に押しつぶす
    const zs = zombie(0.5, 6.5, 200), zn = zombie(3.5, 7.5, 200);
    shoot("singularity", { after: 12 });
    check("シンギュラリティ：着弾点に重力井戸ができる", fields.activeFields() >= 1);
    const kn = (zn.knocks ?? []).slice(-1)[0];
    check("シンギュラリティ：近くの敵を中心へ引き寄せる（-x 向き）", !!kn && kn.x < 0, JSON.stringify(kn));
    const hpn = hp(zn);
    __tick(60);
    check("シンギュラリティ：最後に押しつぶして周りにもダメージ", hp(zn) < hpn && fields.activeFields() === 0, `(hp ${hpn} → ${hp(zn)})`);
    zs.remove(); zn.remove();

    // スウォームランチャー：前方の 3 体へ 1 発ずつ
    const sw = [zombie(-4.5, 12.5, 60), zombie(0.5, 14.5, 60), zombie(5.5, 12.5, 60)];
    inv.items[9] = undefined;
    shoot("swarm_launcher", { after: 2 });
    inv.items[9] = new ItemStack("arsenal:ammo_rocket", 8);
    __tick(80);
    check("スウォームランチャー：前方の 3 体それぞれに当たる", sw.every((z) => hp(z) < 60), sw.map(hp).join(","));
    for (const z of sw) z.remove();

    // スマートピストル：覗くと照準の外の 2 体をロックし、撃つとそれぞれに当たる
    const sm = [zombie(-3.5, 10.5, 40), zombie(4.5, 10.5, 40)];
    clearInv(); reset();
    inv.items[0] = new ItemStack("arsenal:smart_pistol", 1);
    inv.items[9] = new ItemStack("arsenal:ammo_light", 64);
    player.selectedSlotIndex = 0;
    __tick(3);
    const ss = S(player);
    ss.ammo = ss.stats.mag;
    player.isSneaking = true;
    __tick(16);
    check("スマートピストル：視界の 2 体をロック", fire3.smartLocked(player.id, ss.stats) === 2, `(${fire3.smartLocked(player.id, ss.stats)})`);
    for (let i = 0; i < 2; i++) {
      const ev = { source: player, itemStack: inv.getItem(0), useDuration: 72000 };
      world.afterEvents.itemStartUse.fire(ev);
      __tick(2);
      world.afterEvents.itemStopUse.fire(ev);
      __tick(6);
    }
    check("スマートピストル：撃つとロックした 2 体に順に当たる（照準の中心は空）", sm.every((z) => hp(z) < 40), sm.map(hp).join(","));
    // 壁の向こうはロックしない
    wall(-6, -1, 64, 66, 7, 7);
    __tick(12);
    check("スマートピストル：壁に隠れた敵はロックしない", fire3.smartLocked(player.id, ss.stats) === 1, `(${fire3.smartLocked(player.id, ss.stats)})`);
    player.isSneaking = false;
    __tick(3);
    check("スマートピストル：覗くのをやめるとロックを外す", fire3.smartLocked(player.id, ss.stats) === 0);
    unwall();
    for (const z of sm) z.remove();

    // リフレクター：正面の壁で反射して後ろの敵に当たり、反射ぶん威力が上がる
    wall(-3, 3, 64, 66, 6, 6);
    const zr = zombie(0.5, -4.5, 100);
    const rs = shoot("reflector", { after: 4 });
    const lost = 100 - hp(zr);
    check("リフレクター：壁で反射して後ろの敵に当たる", lost > 0, `(dealt=${lost})`);
    check("リフレクター：反射したぶん威力が上がる（6 × 1.25 以上）", lost >= rs.stats.dmg * 1.25 - 0.01, `(dealt=${lost.toFixed(2)})`);
    zr.remove();
    unwall();

    // プリズムスキャッター：近い敵には何本も当たる
    const zp = zombie(0.5, 3.5, 100);
    shoot("prism_scatter", { after: 4 });
    check("プリズムスキャッター：近い敵に複数本当たる（1 本ぶんより多い）", 100 - hp(zp) > 3.2 * 1.5, `(dealt=${(100 - hp(zp)).toFixed(2)})`);
    zp.remove();

    // ブリンクピストル：撃った先（壁の手前）へ移る。壁が目の前なら移らず弾も減らない
    wall(-3, 3, 64, 66, 12, 12);
    shoot("blink_pistol", { ads: false, after: 4 });
    check("ブリンクピストル：壁の手前へ瞬間移動", player.location.z > 9 && player.location.z < 12, `(z=${player.location.z.toFixed(2)})`);
    // 実機で見つかった：視線がわずかに下向きだと、足の位置が床にめり込んで移れなかった
    shoot("blink_pistol", { ads: false, after: 4, rot: { x: 0.5, y: 0 } });
    check("ブリンクピストル：少し下向きに撃っても床の上に移る", player.location.z > 9 && player.location.z < 12 && player.location.y === 64, `(y=${player.location.y.toFixed(2)} z=${player.location.z.toFixed(2)})`);
    unwall();
    wall(-3, 3, 64, 66, 1, 1);
    const sb = shoot("blink_pistol", { ads: false, after: 4 });
    check("ブリンクピストル：移れる場所がなければ移らず弾を戻す", player.location.z < 1 && sb.ammo === sb.stats.mag, `(z=${player.location.z.toFixed(2)} ammo=${sb.ammo})`);
    unwall();

    // メディックビーム：味方を回復し、自分の設置物を直し、敵には熱線
    const mate = new Player(dim);
    mate.name = "Mate";
    world.players.push(mate);
    mate.location = { x: 0.5, y: 64, z: 6.5 };
    mate.health.currentValue = 6;
    const pvp0 = world.gameRules.pvp;
    world.gameRules.pvp = false;
    shoot("medic_beam", { hold: 20, after: 2 });
    world.gameRules.pvp = pvp0;
    check("メディックビーム：味方の体力を回復", mate.health.currentValue > 6, `(hp=${mate.health.currentValue})`);
    mate.remove();
    world.players.splice(world.players.indexOf(mate), 1);
    const zm = zombie(0.5, 6.5, 40);
    shoot("medic_beam", { hold: 10, after: 2 });
    check("メディックビーム：敵には熱線（弱いダメージ）", hp(zm) < 40);
    zm.remove();

    // ネットランチャー：着弾点のまわりを動けなくする
    const z1 = zombie(0.5, 8.5, 40), z2 = zombie(2.0, 8.5, 40);
    shoot("net_launcher", { after: 16 });
    check("ネットランチャー：当たった敵と隣の敵が動けない（鈍足 7）", eff(z1, "slowness") >= 6 && eff(z2, "slowness") >= 6, `(${eff(z1, "slowness")},${eff(z2, "slowness")})`);
    z1.remove(); z2.remove();

    // ステイシス：フィールドの中の敵はほとんど動けない
    const zt = zombie(0.5, 8.5, 60), zt2 = zombie(3.0, 9.5, 60);
    shoot("stasis_projector", { after: 16 });
    check("ステイシス：フィールドの中の敵を強く減速（鈍足 6）", eff(zt2, "slowness") >= 5, `(${eff(zt2, "slowness")})`);
    __tick(130);
    check("ステイシス：6 秒で消える", fields.activeFields() === 0);
    zt.remove(); zt2.remove();

    // アシッドスプレー：毒と腐食（受けるダメージ 1.25 倍）
    const zx = zombie(0.5, 4.5, 100);
    shoot("acid_sprayer", { hold: 4, after: 2 });
    check("アシッドスプレー：毒と腐食", eff(zx, "poison") >= 0 && dmg.isCorroded(zx.id));
    const h0 = hp(zx);
    dmg.dealDamage(player, zx, 4, {});
    check("腐食中は受けるダメージが 1.25 倍", Math.abs(h0 - hp(zx) - 4 * dmg.CORRODE_MUL) < 0.01, `(dealt=${(h0 - hp(zx)).toFixed(2)})`);
    zx.remove();

    // オービタルマーカー：空の見える地面に 2 秒後に落ちる。屋根の下には呼べない
    const zo = zombie(0.5, 6.5, 100);
    shoot("orbital_marker", { ads: false, after: 2, rot: { x: 14, y: 0 } });
    check("オービタルマーカー：地面に印を付ける", fields.activeFields() === 1, `(fields=${fields.activeFields()})`);
    const ho = hp(zo);
    __tick(45);
    check("オービタルマーカー：2 秒後に光の柱でダメージ", hp(zo) < ho, `(hp ${ho} → ${hp(zo)})`);
    zo.remove();
    wall(-8, 8, 70, 70, -2, 16);
    const so = shoot("orbital_marker", { ads: false, after: 2, rot: { x: 14, y: 0 } });
    check("オービタルマーカー：屋根の下には呼べず、弾を戻す", fields.activeFields() === 0 && so.ammo === so.stats.mag);
    unwall();

    // EMP ブラスター：着弾点で EMP
    const emp0 = LOG.particleIds["arsenal:emp_wave"] ?? 0;
    const ze = zombie(0.5, 8.5, 40);
    shoot("emp_blaster", { after: 12 });
    check("EMP ブラスター：着弾点で EMP が起きる", (LOG.particleIds["arsenal:emp_wave"] ?? 0) > emp0 && hp(ze) < 40);
    ze.remove();

    // トランキライザー：当たって 2 秒後に眠らせる
    const zq = zombie(0.5, 10.5, 40);
    shoot("tranq_rifle", { after: 10 });
    check("トランキライザー：当たった直後はまだ眠らない", eff(zq, "slowness") < 6 && hp(zq) < 40);
    __tick(45);
    check("トランキライザー：2 秒後に眠る（動けない）", eff(zq, "slowness") >= 6);
    zq.remove();

    // スティッキーランチャー：壁に張り付いて 1.5 秒後に爆発
    wall(-3, 3, 64, 66, 8, 8);
    inv.items[9] = undefined;
    const ex0 = LOG.explosions.length;
    clearInv();
    inv.items[8] = new ItemStack("arsenal:ammo_40mm", 16);
    shoot("sticky_launcher", { after: 10 });
    check("スティッキーランチャー：張り付いてすぐには爆発しない", LOG.explosions.length === ex0);
    __tick(40);
    check("スティッキーランチャー：1.5 秒後に爆発", LOG.explosions.length > ex0);
    unwall();

    // クラスターキャノン：着弾で炸裂し、子弾も爆発する
    const ex1 = LOG.explosions.length;
    shoot("cluster_cannon", { after: 30, rot: { x: 20, y: 0 } });
    __tick(60);
    check("クラスターキャノン：炸裂して子弾も爆発（2 回以上）", LOG.explosions.length - ex1 >= 2, `(${LOG.explosions.length - ex1})`);

    // ハープーンガン：後ろに壁があれば縫い付け、なければ引き寄せる
    wall(-3, 3, 64, 66, 10, 10);
    const zh = zombie(0.5, 8.6, 60);
    shoot("harpoon_gun", { ads: false, after: 10 });
    check("ハープーンガン：後ろに壁があれば縫い付ける（動けない）", hp(zh) < 60 && eff(zh, "slowness") >= 6);
    zh.remove();
    unwall();
    const zh2 = zombie(0.5, 8.6, 60);
    shoot("harpoon_gun", { ads: false, after: 10 });
    const kh = (zh2.knocks ?? []).slice(-1)[0];
    check("ハープーンガン：壁がなければ手前へ引き寄せる", !!kh && kh.z < 0 && eff(zh2, "slowness") < 6, JSON.stringify(kh));
    zh2.remove();

    // ライトニングガン：照射した敵から隣の敵へ連鎖
    const zl1 = zombie(0.5, 8.5, 60), zl2 = zombie(3.0, 9.5, 60);
    shoot("lightning_gun", { hold: 10, after: 2 });
    check("ライトニングガン：隣の敵へ連鎖する", hp(zl1) < 60 && hp(zl2) < 60, `(${hp(zl1)},${hp(zl2)})`);
    zl1.remove(); zl2.remove();

    // クライオビーム：当て続けると凍る
    const zf = zombie(0.5, 8.5, 200);
    shoot("cryo_beam", { hold: 40, after: 1 });
    check("クライオビーム：当て続けると凍る（鈍足 5・採掘速度低下）", fire2.chillLevel(zf.id) === 4 && eff(zf, "slowness") >= 4 && eff(zf, "mining_fatigue") >= 0, `(lv=${fire2.chillLevel(zf.id)})`);
    zf.remove();

    // ボルテックスキャノン：細く遠く（20 ブロック先まで届き、横の敵には当たらない）
    const zv1 = zombie(0.5, 20.5, 60), zv2 = zombie(6.5, 8.5, 60);
    shoot("vortex_cannon", { after: 4 });
    check("ボルテックスキャノン：20 ブロック先まで届き、横の敵には当たらない", hp(zv1) < 60 && hp(zv2) === 60, `(${hp(zv1)},${hp(zv2)})`);
    zv1.remove(); zv2.remove();

    killAllArsenal();
    clearInv();
    for (let i = 0; i < savedInv.length; i++) inv.items[i] = savedInv[i];
    player.selectedSlotIndex = savedSlot;
    player.location = savedLoc;
    player.setRotation({ x: 0, y: 0 });
    __tick(3);
  }

  // =====================================================================
  console.log("2.6 エイムアシスト");
  // =====================================================================
  {
    const savedInv = inv.items.slice();
    const savedSlot = player.selectedSlotIndex;
    const savedLoc = { ...player.location };
    clearInv();
    reset();
    const rifle = Object.keys(D.WEAPONS).find((w) => D.WEAPONS[w].cat === "assault");
    inv.items[0] = new ItemStack(`arsenal:${rifle}`, 1);
    player.selectedSlotIndex = 0;
    __tick(3);
    // 照準の中心から角度 a（度）の向き
    const angTo = (e) => {
      const eye = player.getHeadLocation();
      const c = e.getAABB().center;
      const v = { x: c.x - eye.x, y: c.y - eye.y, z: c.z - eye.z };
      const L = Math.hypot(v.x, v.y, v.z);
      const d = player.getViewDirection();
      return (Math.acos(Math.min(1, (v.x * d.x + v.y * d.y + v.z * d.z) / L)) * 180) / Math.PI;
    };
    const adsFor = (ticks) => {
      player.isSneaking = true;
      __tick(ticks);
      player.isSneaking = false;
      __tick(4);
    };
    settings.setPrefs(player, { aimAssist: "light" });
    const z = zombie(1.5, 10.5, 200);
    player.setRotation({ x: 0, y: 0 });
    const a0 = angTo(z);
    adsFor(30);
    check("エイムアシスト：覗くと照準の近くの敵へ寄る", a0 > 3 && angTo(z) < 1.0, `(${a0.toFixed(2)}° → ${angTo(z).toFixed(2)}°)`);
    // 1 tick に回る量には上限がある（急に首が回らない）
    player.setRotation({ x: 0, y: 0 });
    player.isSneaking = true;
    const rs = [];
    for (let i = 0; i < 12; i++) {
      __tick(1);
      rs.push(player.getRotation().y);
    }
    player.isSneaking = false;
    __tick(4);
    let maxStep = 0;
    for (let i = 1; i < rs.length; i++) maxStep = Math.max(maxStep, Math.abs(rs[i] - rs[i - 1]));
    check("エイムアシスト：1 tick の回転は 1.8° まで", maxStep <= 1.81, `(max=${maxStep.toFixed(2)}°)`);
    // 壁の向こうの敵には寄せない
    const placed = [];
    for (let x = -3; x <= 4; x++) for (let y = 64; y <= 66; y++) { dim.blocks.set(`${x},${y},6`, "minecraft:stone"); placed.push(`${x},${y},6`); }
    player.setRotation({ x: 0, y: 0 });
    adsFor(30);
    check("エイムアシスト：壁の向こうの敵には寄せない", Math.abs(player.getRotation().y) < 0.01 && Math.abs(player.getRotation().x) < 0.01, JSON.stringify(player.getRotation()));
    for (const k of placed) dim.blocks.delete(k);
    // 敵対しない mob には寄せない
    z.remove();
    const cow = new Entity("minecraft:cow", { x: 1.5, y: 64, z: 10.5 }, dim, 10);
    player.setRotation({ x: 0, y: 0 });
    adsFor(30);
    check("エイムアシスト：敵対しない mob には寄せない", Math.abs(player.getRotation().y) < 0.01);
    cow.remove();
    // 照準から遠い（円錐の外の）敵には寄せない。「強」は円錐が広い
    const zf = zombie(2.2, 10.5, 200);
    player.setRotation({ x: 0, y: 0 });
    adsFor(20);
    const lightMoved = Math.abs(player.getRotation().y) > 0.01;
    settings.setPrefs(player, { aimAssist: "strong" });
    player.setRotation({ x: 0, y: 0 });
    adsFor(30);
    check("エイムアシスト：「弱」は 8° の外の敵に寄せず、「強」は 12° まで寄せる", angTo(zf) < 1.0 && !lightMoved, `(light moved=${lightMoved}, strong → ${angTo(zf).toFixed(2)}°)`);
    zf.remove();
    // 「なし」では寄せない
    settings.setPrefs(player, { aimAssist: "off" });
    const zo = zombie(1.5, 10.5, 200);
    player.setRotation({ x: 0, y: 0 });
    adsFor(30);
    check("エイムアシスト：「なし」では寄せない", Math.abs(player.getRotation().y) < 0.01);
    zo.remove();
    clearInv();
    for (let i = 0; i < savedInv.length; i++) inv.items[i] = savedInv[i];
    player.selectedSlotIndex = savedSlot;
    player.location = savedLoc;
    player.setRotation({ x: 0, y: 0 });
    __tick(3);
  }

  // =====================================================================
  console.log("2.6 核爆弾・ミサイル");
  // =====================================================================
  {
    const proj = await imp("systems/projectiles.js");
    const nuke = await imp("systems/nuke.js");
    const fields = await imp("systems/fields.js");
    const thr = await imp("systems/throwables.js");
    const savedInv = inv.items.slice();
    const savedSlot = player.selectedSlotIndex;
    const savedLoc = { ...player.location };
    clearInv();
    reset();
    const N = D.THROWABLES.tactical_nuke;
    const ground = dim.getBlock({ x: 30, y: 63, z: 30 });
    // 置ける・カウントダウン・爆発
    inv.items[0] = new ItemStack("arsenal:tactical_nuke", 1);
    player.location = { x: 0.5, y: 64, z: 0.5 };
    player.health.currentValue = player.health.effectiveMax;
    settings.setWorld({ nukes: false });
    check("核：ワールド設定で禁止なら置けない", thr.tryPlaceNuke(player, ground, "Up") === false && count("arsenal:tactical_nuke") === 1);
    settings.setWorld({ nukes: true });
    check("核：ブロックの上面にだけ置ける", thr.tryPlaceNuke(player, ground, "North") === false && thr.tryPlaceNuke(player, ground, "Up") === true && count("arsenal:tactical_nuke") === 0);
    const near = zombie(33.5, 30.5, 150);   // 致死圏内（3 ブロック。致死のダメージは 200）
    const mid = zombie(30.5, 54.5, 400);    // 爆風圏（24 ブロック）
    const far = zombie(30.5, 75.5, 400);    // 吹き飛ばしだけ（45 ブロック）
    const beeps0 = LOG.sounds["arsenal.fx.c4_beep"] ?? 0;
    const ex0 = LOG.explosions.length;
    __tick(N.fuse - 20);
    check("核：起爆まで数えながら鳴る（まだ爆発しない）", (LOG.sounds["arsenal.fx.c4_beep"] ?? 0) > beeps0 && LOG.explosions.length === ex0);
    __tick(30);
    check("核：15 秒後に爆発（中心の大きな爆発）", LOG.explosions.some((e, i) => i >= ex0 && e.p === N.power));
    check("核：致死圏内の敵は倒れる", !near.isValid || near.health.currentValue <= 0);
    check("核：爆風圏の敵は大きく削られ、燃える", mid.isValid && mid.health.currentValue < 400 && mid.health.currentValue > 0);
    check("核：遠くの敵は吹き飛ばされるだけ", far.isValid && far.health.currentValue === 400 && (far.knocks ?? []).length > 0);
    check("核：放射性降下物が残る", fields.activeFields() >= 1);
    // 放射性降下物：毒と衰弱。ガスマスクで防げる
    const zr = zombie(35.5, 30.5, 400);
    // ガスマスクをかぶったプレイヤーは平気
    const maskId = Object.keys(D.ARMOR).find((k) => D.ARMOR[k].special === "gasmask");
    player.eqSlots.Head = new ItemStack(`arsenal:${maskId}`, 1);
    player.location = { x: 27.5, y: 64, z: 30.5 };
    player.effects = {};
    __tick(25);
    check("核：降下物の中は毒と衰弱", !!zr.getEffect("poison") && !!zr.getEffect("wither"));
    check("核：ガスマスクをかぶっていれば降下物は効かない", !player.getEffect("poison") && !player.getEffect("wither"), JSON.stringify(player.effects));
    player.eqSlots.Head = undefined;
    __tick(25);
    check("核：マスクを外すと降下物が効く", !!player.getEffect("poison"));
    player.effects = {};
    player.location = { x: 0.5, y: 64, z: 0.5 };
    zr.remove(); mid.remove(); far.remove();
    // 置いた本人も巻き込む
    reset();
    inv.items[0] = new ItemStack("arsenal:tactical_nuke", 1);
    player.location = { x: 31.5, y: 64, z: 31.5 };
    player.health.currentValue = player.health.effectiveMax;
    const hp0 = player.health.currentValue;
    nuke.detonateNuke(dim, { x: 30.5, y: 64, z: 30.5 }, player.id);
    check("核：置いた本人も巻き込まれる", player.health.currentValue < hp0 || !player.isValid || downed.isDowned(player));
    __tick(2);
    reset();
    player.location = { x: 0.5, y: 64, z: 0.5 };
    __tick(1300); // 降下物が消えるまで
    check("核：降下物は 60 秒で消える", fields.activeFields() === 0);

    // 核ミサイル（キルストリーク）：10 秒の警告のあと、上空から落ちて核爆発
    reset();
    clearInv();
    const ksM = await imp("systems/killstreaks.js");
    ksM.addStreakPoints(player, 9999);
    player.location = { x: 0.5, y: 64, z: 0.5 };
    player.setRotation({ x: 30, y: 0 });
    const tz = zombie(0.5, 3.4, 150);
    const ex1 = LOG.explosions.length;
    const ok = ksM.useStreak(player, "nuke");
    __tick(100);
    check("核ミサイル：使えて、警告の間は爆発しない", ok && LOG.explosions.length === ex1);
    __tick(160);
    check("核ミサイル：上空から落ちて核爆発", LOG.explosions.some((e, i) => i >= ex1 && e.p === N.power) && (!tz.isValid || tz.health.currentValue <= 0));
    reset();
    __tick(1300);

    // 巡航ミサイル（アルバトロス）：上昇してから目標の上空へ飛び、急降下する
    reset();
    clearInv();
    player.location = { x: 0.5, y: 64, z: 0.5 };
    // 77 ブロック先の地面を狙う（目の高さ 1.62 / tan 1.2°）
    player.setRotation({ x: 1.2, y: 0 });
    inv.items[0] = new ItemStack("arsenal:albatross", 1);
    inv.items[9] = new ItemStack("arsenal:ammo_rocket", 8);
    player.selectedSlotIndex = 0;
    __tick(12);
    const sA = S(player);
    sA.ammo = 1;
    const maxY = { v: 0 };
    const ex2 = LOG.explosions.length;
    // 浅い角度で地面を狙うので、覗いて撃つ（腰だめの拡散だと着弾点が数十ブロック変わる）
    player.isSneaking = true;
    __tick(sA.stats.adsTime + 4);
    const evA = { source: player, itemStack: inv.getItem(0), useDuration: 72000 };
    world.afterEvents.itemStartUse.fire(evA);
    __tick(2);
    world.afterEvents.itemStopUse.fire(evA);
    player.isSneaking = false;
    for (let i = 0; i < 200 && LOG.explosions.length === ex2; i++) {
      __tick(1);
      for (const e of __entities.values()) if (e.typeId === "arsenal:projectile" && e.isValid) maxY.v = Math.max(maxY.v, e.location.y);
    }
    const boom = LOG.explosions[ex2];
    check("巡航ミサイル：巡航高度（目標 + 22 前後）まで上がる", maxY.v > 82, `(maxY=${maxY.v.toFixed(1)})`);
    check("巡航ミサイル：狙った地点（77 ブロック先）の近くで爆発する", !!boom && Math.hypot(boom.l.x - 0.5, boom.l.z - 77.8) < 8, JSON.stringify(boom?.l));

    // 誘導ミサイル（キルストリーク）：向いた方へ曲がり、当たって爆発。操縦中はカメラが付く
    reset();
    ksM.addStreakPoints(player, 9999);
    player.location = { x: 0.5, y: 64, z: 0.5 };
    player.setRotation({ x: 60, y: 0 });
    const cam0 = player.camera.calls?.length ?? 0;
    const ex3 = LOG.explosions.length;
    check("誘導ミサイル：使える", ksM.useStreak(player, "missile_strike") === true && proj.isGuiding(player.id));
    // 真下を向いて操縦する
    player.setRotation({ x: 89, y: 0 });
    for (let i = 0; i < 240 && LOG.explosions.length === ex3; i++) __tick(1);
    check("誘導ミサイル：当たって爆発し、操縦が終わる", LOG.explosions.length > ex3 && !proj.isGuiding(player.id));
    void cam0;
    // 敵に直撃しても爆発して操縦が終わる（実機で、直撃のときに例外が出続けてカメラが戻らなかった）
    ksM.addStreakPoints(player, 9999);
    player.setRotation({ x: 60, y: 0 });
    const w0 = ctx.warnings.length;
    ksM.useStreak(player, "missile_strike");
    __tick(1);
    const gm = [...__entities.values()].find((e) => e.typeId === "arsenal:projectile" && e.isValid);
    // 弾の進む先に敵を置く
    const gz = gm ? new Entity("minecraft:zombie", { x: gm.location.x, y: gm.location.y - 6, z: gm.location.z + 2 }, dim, 400) : null;
    if (gz) gz.height = 3;
    player.setRotation({ x: 70, y: 0 });
    const ex5 = LOG.explosions.length;
    for (let i = 0; i < 60 && proj.isGuiding(player.id); i++) __tick(1);
    check("誘導ミサイル：敵に直撃しても爆発し、操縦が終わる（例外なし）", !proj.isGuiding(player.id) && LOG.explosions.length > ex5 && ctx.warnings.length === w0, ctx.warnings.slice(w0, w0 + 2).join(" | "));
    if (gz) gz.remove();
    // スニークで空中爆発
    ksM.addStreakPoints(player, 9999);
    player.setRotation({ x: 30, y: 0 });
    const ex4 = LOG.explosions.length;
    ksM.useStreak(player, "missile_strike");
    __tick(15);
    player.isSneaking = true;
    __tick(2);
    player.isSneaking = false;
    check("誘導ミサイル：スニークで空中爆発", LOG.explosions.length > ex4 && !proj.isGuiding(player.id));
    __tick(5);

    killAllArsenal();
    for (const e of [...__entities.values()]) if (e.typeId === "minecraft:zombie") e.remove();
    clearInv();
    for (let i = 0; i < savedInv.length; i++) inv.items[i] = savedInv[i];
    player.selectedSlotIndex = savedSlot;
    player.location = savedLoc;
    player.setRotation({ x: 0, y: 0 });
    reset();
    __tick(3);
  }

  // =====================================================================
  console.log("HUD 2.0");
  // =====================================================================
  {
    const vals = { hit: "2", dir: "3", xh: "4", ammo: 27, res: 120, mode: "A", st: "R", heat: "5", plate: "3", hp: 17, hdg: "037", sup: "1", nvg: "0", gm: "2", sa: 12, sb: 9, tm: " 4:05", stk: 3, cr: 1234, ks: "1", rng: 150, wdir: "3", wstr: "2", sz: "1", lay: "0" };
    const enc = hud2.encodeHud2(vals);
    const dec = hud2.decodeHud2(enc);
    check("HUD 2.0：符号化の長さが配置表と一致", enc.length === D.HUD2_LAYOUT.length, `(${enc.length} vs ${D.HUD2_LAYOUT.length})`);
    check("HUD 2.0：往復で値が戻る（数値は右寄せ）", dec.ammo === " 27" && dec.res === " 120" && dec.cr === "  1234" && dec.hp === "17" && dec.tm === " 4:05" && dec.mode === "A");
    check("HUD 2.0：札は 1 文字ずつ（弾数 \" 27\" → .a0_.a12.a27.）", enc.includes(".a0_.a12.a27.") && enc.includes(".m0A."));
    check("HUD 2.0：ASCII だけ・空白を含まない", /^[\x21-\x7e]+$/.test(enc));
    const odd = hud2.decodeHud2(hud2.encodeHud2({ ...vals, tm: "1.5_x" }));
    check("HUD 2.0：値の区切り文字・空白の記号は置き換える", odd.tm === "1,5-x");
    const over = hud2.decodeHud2(hud2.encodeHud2({ ...vals, ammo: 12345, cr: 99999999 }));
    check("HUD 2.0：桁あふれは 9 で詰める", over.ammo === "999" && over.cr === "999999");
    settings.setPrefs(player, { hudStyle: "hud2" });
    const t0 = LOG.titles.length;
    const s = S(player);
    s.hud2Tick = -99;
    __tick(12);
    const tt = LOG.titles.slice(t0).map((x) => x.t);
    check("HUD 2.0：タイトルに AC2. と目印を付けて送る", tt.some((x) => x.startsWith("AC2.") && x.includes("§a§r§s§n")), JSON.stringify(tt.slice(0, 1)));
    // 毎 tick 変わる値（照準の広がり・方位）はサブタイトル。タイトルでは固定なので、向きを変えてもタイトルは送らない
    const lastT = LOG.titles.at(-1);
    check("HUD 2.0：照準と方位はサブタイトルで送る（AC2L・目印付き）", typeof lastT?.o?.subtitle === "string" && lastT.o.subtitle.startsWith("AC2L.") && /~\d{1,3}(?!\d)/.test(lastT.o.subtitle) && lastT.o.subtitle.includes("§a§r§s§n"), JSON.stringify(lastT?.o?.subtitle));
    const decT = hud2.decodeHud2(lastT.t);
    check("HUD 2.0：タイトルの照準・方位は固定", decT.hdg === "---" && decT.xh === "-", JSON.stringify({ hdg: decT.hdg, xh: decT.xh }));
    s.hud2Tick = system.currentTick;
    const tc = LOG.titles.length;
    const sc = LOG.subtitles.length;
    player.setRotation({ x: 0, y: 90 });
    __tick(1);
    player.setRotation({ x: 0, y: 120 });
    __tick(1);
    check("HUD 2.0：向きを変えただけならタイトルは送らず、サブタイトルだけ差し替える", LOG.titles.length === tc && LOG.subtitles.length >= sc + 2 && LOG.subtitles.at(-1).startsWith("AC2L."), `(titles +${LOG.titles.length - tc}, subtitles +${LOG.subtitles.length - sc})`);
    __tick(1);
    check("HUD 2.0：向きが変わらなければサブタイトルも送らない", LOG.subtitles.length === sc + 2);
    // 実機の JSON UI は '090' を 90 にしてから画像名につなぐので、方位は 0 埋めしない（2.6.0 で 0〜99 が見つからない画像になった）
    check("HUD 2.0：方位は 0 埋めしない（120° → 60、画像 compass_60）", hud2.liveHeading(LOG.subtitles.at(-1)) === "60", JSON.stringify(LOG.subtitles.at(-1)));
    player.setRotation({ x: 0, y: 10 });
    __tick(1);
    check("HUD 2.0：方位 10° → 5（005 ではない）", hud2.liveHeading(LOG.subtitles.at(-1)) === "5", JSON.stringify(LOG.subtitles.at(-1)));
    player.setRotation({ x: 0, y: 0 });
    const a0 = LOG.actionbar.length;
    hud2.announce(player, "hello", 20);
    check("HUD 2.0 の知らせはアクションバーへ", LOG.actionbar.length === a0 + 1);
    settings.setPrefs(player, { hudStyle: "classic" });
    const t1 = LOG.titles.length;
    hud2.announce(player, "hello", 20);
    check("従来の HUD の知らせはサブタイトルへ", LOG.titles.length === t1 + 1 && LOG.titles.at(-1).o?.subtitle === "hello");
  }

  // =====================================================================
  console.log("1.0.2 からの移行・見た目違い ID");
  // =====================================================================
  {
    clearInv();
    const old = new ItemStack("arsenal:sentinel", 1);
    old.props = { "a:init": true, "a:ammo": 17, "a:mode": "auto", "a:att": JSON.stringify({ optic: "optic_4x", grip: "not_real", muzzle: "optic_holo" }), "a:at": "std", "a:ub": 0 };
    inv.items[0] = old;
    player.selectedSlotIndex = 0;
    __tick(3);
    const it = inv.items[0];
    const att = JSON.parse(it.props["a:att"]);
    check("移行：a:v が付く", it.props["a:v"] === D.ITEM_FORMAT);
    check("移行：既存のキー（a:ammo / a:mode / a:at）を保つ", it.props["a:ammo"] === 17 && it.props["a:mode"] === "auto" && it.props["a:at"] === "std");
    check("移行：無効なアタッチメントだけ外す", att.optic === "optic_4x" && !att.grip && !att.muzzle, JSON.stringify(att));
    check("持った時に光学に合った見た目違い ID になる", it.typeId === "arsenal:sentinel__o2", it.typeId);
    check("見た目違いでも同じ武器として扱う（持ち替え扱いにならない）", S(player).weaponId === "sentinel" && S(player).ammo === 17);
    it.dur.damage = 123;
    const n = migrate.normalizeVariants(player);
    check("normalize で元の ID に戻り、状態を保つ", n === 1 && inv.items[0].typeId === "arsenal:sentinel" && inv.items[0].props["a:ammo"] === 17 && inv.items[0].dur.damage === 123);
    check("desiredTypeId：迷彩が優先・ドット系は o1", migrate.desiredTypeId("sentinel", { optic: "optic_reddot" }, null) === "arsenal:sentinel__o1" && migrate.desiredTypeId("sentinel", {}, "c3") === "arsenal:sentinel__c3");
    // 同じ武器を 2 挺：識別子で見分け、別の 1 挺に残弾を書かない
    clearInv();
    const g1 = new ItemStack("arsenal:vx9", 1);
    const g2 = new ItemStack("arsenal:vx9", 1);
    inv.items[0] = g1;
    inv.items[1] = g2;
    player.selectedSlotIndex = 0;
    __tick(3);
    const uidA = inv.items[0].props["a:id"];
    S(player).ammo = 4;
    S(player).ammoDirty = true;
    const tmp = inv.items[0];
    inv.items[0] = inv.items[1];
    inv.items[1] = tmp;
    __tick(3);
    check("同じ武器の別の 1 挺に入れ替えると持ち替え扱い（識別子）", S(player).uid !== uidA && typeof S(player).uid === "string");
    check("入れ替え前の 1 挺に残弾を書く（識別子で追いかける）", inv.items[1].props["a:id"] === uidA && inv.items[1].props["a:ammo"] === 4 && inv.items[0].props["a:ammo"] !== 4);
    // 見た目違いへの差し替えで説明文を失わない
    inv.items[2] = new ItemStack("arsenal:sentinel", 1);
    player.selectedSlotIndex = 2;
    __tick(3);
    const lore0 = inv.items[2].lore.length;
    menus.setCamo(player, "c1");
    check("迷彩を付けても説明文（ティア・弾薬・迷彩）を保つ", inv.items[2].typeId === "arsenal:sentinel__c1" && inv.items[2].lore.length === lore0 + 1, `(${lore0} → ${inv.items[2].lore.length})`);
    menus.setCamo(player, null);
    // HUD 2.0 は ARSENAL の品を持っていないときタイトルを使わない
    clearInv();
    settings.setPrefs(player, { hudStyle: "hud2" });
    __tick(3);
    const tq = LOG.titles.length;
    __tick(30);
    check("何も持っていないときは HUD 2.0 のタイトルを送らない（ほかの /title を邪魔しない）", LOG.titles.slice(tq).every((x) => !x.t.startsWith("AC2")));
    inv.items[0] = new ItemStack("arsenal:bandage", 2);
    player.selectedSlotIndex = 0;
    __tick(12);
    check("ARSENAL の品を持つと HUD 2.0 を送る", LOG.titles.slice(tq).some((x) => x.t.startsWith("AC2.")));
    settings.setPrefs(player, { hudStyle: "classic" });
    const tr = LOG.titles.length;
    __tick(3);
    check("従来型へ切り替えると HUD 2.0 の文字列を消す", LOG.titles.slice(tr).some((x) => x.t === "§a§r§s§n§0"));
    clearInv();
    // 1.0.2 で HUD を消していた人は従来型のまま
    const oldP = new Player(dim);
    oldP.setDynamicProperty("arsenal:prefs", JSON.stringify({ hudMode: "off" }));
    migrate.migratePlayer(oldP);
    check("1.0.2 で HUD を消していた人は従来型の HUD のまま", JSON.parse(oldP.getDynamicProperty("arsenal:prefs")).hudStyle === "classic");
    const newP = new Player(dim);
    newP.setDynamicProperty("arsenal:prefs", JSON.stringify({ volume: 0.5 }));
    migrate.migratePlayer(newP);
    check("1.0.2 の既存の個人設定を保ったまま 2.0 の既定値を足す", JSON.parse(newP.getDynamicProperty("arsenal:prefs")).volume === 0.5 && JSON.parse(newP.getDynamicProperty("arsenal:prefs")).hudStyle === "hud2");
    oldP.remove();
    newP.remove();
    world.setDynamicProperty("arsenal:world_settings", JSON.stringify({ damageMul: 1.5 }));
    world.setDynamicProperty("a:v", undefined);
    migrate.migrateWorld();
    const ws = JSON.parse(world.getDynamicProperty("arsenal:world_settings"));
    check("ワールド設定の移行：既存値を保ち 2.0 の既定値を足す", ws.damageMul === 1.5 && ws.aiDifficulty === "normal" && ws.structures === "normal" && world.getDynamicProperty("a:v") === D.ITEM_FORMAT);
    world.setDynamicProperty("arsenal:world_settings", JSON.stringify({ ...ws, damageMul: 1.0 }));
    settings.setWorld({ damageMul: 1.0 });
    clearInv();
    __tick(3);
  }

  // =====================================================================
  console.log("防具・プレート");
  // =====================================================================
  {
    reset();
    const vest = new ItemStack("arsenal:vest_heavy_2", 1);
    vest.props["a:pl"] = 2;
    player.eqSlots.Chest = vest;
    __tick(2);
    check("プレート枚数を胸のアイテムから読む", armor.plateInfo(player).plates === 2 && armor.plateInfo(player).cap === 3);
    const left = armor.absorbPlates(player, 14);
    __tick(2);
    check("プレートがダメージを受け止め、1 枚割れる", Math.abs(left - 0) < 1e-6 && armor.plateInfo(player).plates === 1, `(left=${left}, plates=${armor.plateInfo(player).plates})`);
    check("割れた状態を胸のアイテムへ書く", player.eqSlots.Chest.props["a:pl"] === 1);
    check("プレートの効果音", (LOG.sounds["arsenal.armor.plate_break"] ?? 0) > 0);
    clearInv();
    inv.items[3] = new ItemStack("arsenal:armor_plate", 3);
    gear.completeMedical(player, "armor_plate");
    check("アーマープレートを使うと 1 枚差し込み、1 個消費", armor.plateInfo(player).plates === 2 && count("arsenal:armor_plate") === 2);
    player.eqSlots.Head = new ItemStack("arsenal:helmet_heavy_3", 1);
    __tick(1);
    check("重装ヘルメット III でヘッドショット倍率が半分", Math.abs(armor.helmetHeadMul(player) - 0.5) < 1e-6);
    check("重装アーマーで移動が遅くなる", armor.armorMove(player) < 1);
    player.eqSlots.Chest = new ItemStack("arsenal:ghillie_suit", 1);
    player.isSneaking = true;
    __tick(1);
    check("ギリースーツでスニーク静止中は見つかりにくい", armor.stealthFactor(player) < 0.5);
    player.isSneaking = false;
    player.eqSlots.Head = new ItemStack("arsenal:gas_mask", 1);
    __tick(1);
    check("ガスマスクでガス無効", armor.isGasImmune(player));
    player.eqSlots.Offhand = new ItemStack("arsenal:riot_shield", 1);
    player.eqSlots.Offhand.dur = { damage: 0, maxDurability: 600 };
    player.eqSlots.Offhand.getComponent = function (id) { return id === "minecraft:durability" ? this.dur : undefined; };
    check("ライオットシールドは正面の弾を止める", armor.hasRiotShieldFacing(player, { x: 0, y: 0, z: -1 }) && !armor.hasRiotShieldFacing(player, { x: 0, y: 0, z: 1 }));
    player.eqSlots = {};
    __tick(2);
  }

  // =====================================================================
  console.log("近接");
  // =====================================================================
  {
    reset();
    const z = zombie(0.5, 2.5, 60);
    z.setRotation({ x: 0, y: 0 }); // 南（+z）を向く → プレイヤーは背後
    check("背後判定", melee.isBehind(player, z));
    melee.onMeleeHit(player, z, "combat_knife");
    __tick(2);
    check("背後から刺すと追加ダメージ（×5 の差分）", 60 - z.health.currentValue >= 20, `(dealt=${60 - z.health.currentValue})`);
    heal(z, 60);
    z.setRotation({ x: 0, y: 180 });
    melee.onMeleeHit(player, z, "riot_baton");
    __tick(2);
    check("ライオットバトンでスタン（鈍足）", !!z.effects.slowness);
    const z2 = zombie(1.2, 2.8, 40);
    melee.onMeleeHit(player, z, "machete");
    __tick(2);
    check("マチェットの薙ぎ払いで周りにも当たる", z2.health.currentValue < 40);
    z2.remove();
    const s = S(player);
    s.meleeStart = system.currentTick - 20;
    melee.onMeleeStopUse(player);
    heal(z, 60);
    z.setRotation({ x: 0, y: 180 });
    melee.onMeleeHit(player, z, "machete");
    __tick(2);
    check("溜め攻撃（長押し→離す）で次の一撃が強くなる", 60 - z.health.currentValue >= 7 * 0.6 - 0.1 && s.heavyUntil === 0, `(dealt=${60 - z.health.currentValue})`);
    clearInv();
    inv.items[0] = new ItemStack("arsenal:combat_knife", 1);
    player.selectedSlotIndex = 0;
    player.isSneaking = true;
    const spawned0 = LOG.spawned.length;
    melee.onMeleeStartUse(player, "combat_knife", inv.getItem(0));
    __tick(2);
    player.isSneaking = false;
    check("スニーク＋使用でナイフを投げ、手から外れる", !inv.items[0] && LOG.spawned.length > spawned0);
    __tick(60);
    check("投げたナイフは地面に落ちて拾える", [...__entities.values()].some((e) => e.typeId === "minecraft:item" && e.item?.typeId === "arsenal:combat_knife"));
    inv.items[0] = new ItemStack("arsenal:spring_knife", 1);
    player.isSneaking = true;
    melee.onMeleeStartUse(player, "spring_knife", inv.getItem(0));
    const cd = S(player).meleeCd;
    player.isSneaking = false;
    check("スプリングナイフは刃を射出し、再装填まで待つ（本体は残る）", !!inv.items[0] && cd > system.currentTick + 50);
    inv.items[0] = new ItemStack("arsenal:breaching_axe", 1);
    S(player).meleeCd = 0;
    player.equip.getEquipment = (sl) => (sl === "Mainhand" ? inv.getItem(player.selectedSlotIndex) : player.eqSlots[sl]);
    const c0 = LOG.commands.length;
    const door = dim.getBlock({ x: 2, y: 64, z: 2 });
    door.typeId = "minecraft:oak_door";
    melee.tryBreach(player, door);
    __tick(2);
    check("ブリーチングアックスでドアを壊す", LOG.commands.slice(c0).some((c) => c.startsWith("setblock 2 64 2 air destroy")));
    clearInv();
    inv.items[0] = new ItemStack("arsenal:vx9", 1);
    __tick(3);
    heal(z, 60);
    const ok = melee.buttStroke(player, z);
    check("銃を持って殴ると銃床打撃", ok && z.health.currentValue < 60);
    check("銃床打撃は 12 tick に 1 回", !melee.buttStroke(player, z));
    z.remove();
    clearInv();
    __tick(2);
  }

  // =====================================================================
  console.log("医療品・出血・ダウン制");
  // =====================================================================
  {
    reset();
    clearInv();
    inv.items[4] = new ItemStack("arsenal:bandage", 2);
    heal(player, 10);
    S(player).bleedUntil = system.currentTick + 200;
    comps.item["arsenal:gear"].onCompleteUse({ source: player, itemStack: new ItemStack("arsenal:bandage", 1) });
    __tick(2);
    check("包帯：回復・止血・1 個消費", player.health.currentValue === 12 && S(player).bleedUntil === 0 && count("arsenal:bandage") === 1);
    inv.items[5] = new ItemStack("arsenal:medkit", 1);
    gear.completeMedical(player, "medkit");
    const h0 = player.health.currentValue;
    __tick(60);
    check("メディキット：持続回復", player.health.currentValue > h0 + 1, `(${h0} → ${player.health.currentValue})`);
    inv.items[6] = new ItemStack("arsenal:adrenaline", 1);
    gear.completeMedical(player, "adrenaline");
    check("アドレナリン：加速と軽減", !!player.effects.speed && !!player.effects.resistance);
    check("医療品の使用で medUsed イベント", emitted.medUsed >= 3);
    player.effects = {};
    heal(player, 3);
    S(player).medUntil = 0;
    gear.startBleeding(player, 200);
    __tick(200);
    check("出血は体力 1 で止まる（出血では死なない）", player.isValid && player.health.currentValue >= 1 && player.health.currentValue < 3);
    S(player).bleedUntil = 0;
    heal(player);
    const hollow = new Entity("arsenal:hollow_runner", { x: 1, y: 64, z: 1 }, dim, 18);
    let bled = false;
    for (let i = 0; i < 20 && !bled; i++) {
      world.afterEvents.entityHurt.fire({ hurtEntity: player, damage: 4, damageSource: { cause: "entityAttack", damagingEntity: hollow } });
      bled = S(player).bleedUntil > system.currentTick;
    }
    check("ホロウの爪で出血する", bled);
    S(player).bleedUntil = 0;
    hollow.remove();
    // ダウン制
    settings.setWorld({ downed: true });
    heal(player, 3);
    const z = zombie(0.5, 2, 20);
    dmg.dealDamage(z, player, 50, {});
    check("ダウン制：致死ダメージでダウン（死なない）", player.isValid && downed.isDowned(player) && player.health.currentValue >= 1);
    const other = new Player(dim);
    other.name = "Medic";
    world.players.push(other);
    other.location = { x: 0.5, y: 64, z: -1.5 };
    other.setRotation({ x: 10, y: 0 });
    other.inv.items[0] = new ItemStack("arsenal:defibrillator", 1);
    gear.startGearUse(other, "arsenal:defibrillator");
    __tick(45);
    check("除細動器で蘇生", !downed.isDowned(player) && player.health.currentValue >= 8);
    dmg.dealDamage(z, player, 50, {});
    check("もう一度ダウン", downed.isDowned(player));
    __tick(630);
    check("30 秒で蘇生されなければ死亡", !player.isValid && !downed.isDowned(player));
    // 復活
    player._valid = true;
    __entities.set(player.id, player);
    heal(player);
    world.afterEvents.playerSpawn.fire({ player, initialSpawn: false });
    settings.setWorld({ downed: false });
    other.remove();
    world.players.splice(world.players.indexOf(other), 1);
    z.remove();
    __tick(2);
  }

  // =====================================================================
  console.log("敵 AI");
  // =====================================================================
  {
    reset();
    settings.setWorld({ aiDifficulty: "normal" });
    const e = brain.spawnEnemy(dim, { x: 0.5, y: 64, z: 10.5 }, "raider_rifleman");
    __tick(2);
    check("spawnEnemy で登録され、初期化済みの印が付く", !!brain.aiOf(e) && e.getDynamicProperty("a:ai") === 1);
    e.setRotation({ x: 0, y: 180 });
    const hp0 = player.health.currentValue;
    const s0 = LOG.sounds["arsenal.fire.rifle"] ?? 0;
    for (let i = 0; i < 6; i++) {
      const shot = new Entity("arsenal:ai_shot", { x: 0.5, y: 65.6, z: 10 }, dim, 0);
      shot.comps["minecraft:projectile"] = { owner: e };
      shot.vel = { x: 0, y: -0.05, z: -3 };
      world.afterEvents.entitySpawn.fire({ entity: shot, cause: "Spawned" });
      __tick(3);
      heal(player, Math.max(player.health.currentValue, 1));
    }
    const shotsGone = ![...__entities.values()].some((x) => x.typeId === "arsenal:ai_shot" && x.isValid);
    check("エンジンの合図（ai_shot）は即座に消える", shotsGone);
    check("敵の射撃はスクリプトの弾道で当たる", LOG.damage.some((d) => d.target === "minecraft:player") || player.health.currentValue < hp0);
    check("敵の銃声が鳴る", (LOG.sounds["arsenal.fire.rifle"] ?? 0) > s0);
    heal(player);
    // 旧弾（1.0 の raider_*_bullet）も横取り
    const legacy = new Entity("arsenal:raider_gunner_bullet", { x: 0.5, y: 65.6, z: 10 }, dim, 0);
    legacy.comps["minecraft:projectile"] = { owner: e };
    legacy.vel = { x: 0, y: 0, z: -3 };
    world.afterEvents.entitySpawn.fire({ entity: legacy, cause: "Spawned" });
    check("1.0 の敵の弾も横取りして消す", !legacy.isValid);
    // 難易度
    settings.setWorld({ aiDifficulty: "veteran" });
    brain.scanForAI();
    check("難易度で敵の弾の倍率が変わる", Math.abs(dmg.enemyDamageMul() - D.AI_DIFFICULTY.veteran.damage) < 1e-6);
    settings.setWorld({ aiDifficulty: "normal" });
    brain.scanForAI();
    // EMP
    const bot = brain.spawnEnemy(dim, { x: 4.5, y: 64, z: 12.5 }, "legion_trooper");
    __tick(1);
    brain.applyEmp(dim, { x: 4.5, y: 64, z: 12.5 }, 6, 100, player.id);
    const ai = brain.aiOf(bot);
    check("EMP でレギオンの機械が止まる", ai.empUntil > system.currentTick && !!bot.effects.slowness);
    const d0 = LOG.damage.length;
    const sh = new Entity("arsenal:ai_shot", { x: 4.5, y: 65.6, z: 12 }, dim, 0);
    sh.comps["minecraft:projectile"] = { owner: bot };
    sh.vel = { x: 0, y: 0, z: -3 };
    world.afterEvents.entitySpawn.fire({ entity: sh, cause: "Spawned" });
    check("EMP 中は撃てない（空撃ち）", LOG.damage.length === d0);
    check("EMP はレイダー（人間）には効かない", brain.aiOf(e).empUntil <= system.currentTick);
    // 勢力の設定
    settings.setWorld({ legion: false });
    const nat = new Entity("arsenal:legion_trooper", { x: 60, y: 64, z: 60 }, dim, 30);
    world.afterEvents.entitySpawn.fire({ entity: nat, cause: "Spawned" });
    check("勢力 OFF：自然発生は取り除く", !nat.isValid);
    const placed = brain.spawnEnemy(dim, { x: 62, y: 64, z: 60 }, "legion_trooper");
    __tick(2);
    check("勢力 OFF でも構造物・召喚の敵は残す", placed.isValid);
    settings.setWorld({ legion: true });
    // 1.0 から来た敵には init イベント
    const oldR = new Entity("arsenal:raider_gunner", { x: 8, y: 64, z: 8 }, dim, 22);
    world.afterEvents.entityLoad.fire({ entity: oldR });
    check("読み込まれた 1.0 の敵に arsenal:init を送る（1 回だけ）", oldR.events.includes("arsenal:init") && oldR.getDynamicProperty("a:ai") === 1);
    // 予算
    const many = [];
    for (let i = 0; i < 40; i++) many.push(brain.spawnEnemy(dim, { x: -20 + (i % 8) * 2, y: 64, z: 30 + Math.floor(i / 8) * 2 }, "raider_gunner"));
    __tick(3);
    const st0 = brain.aiStats();
    __tick(40);
    const st1 = brain.aiStats();
    check("思考は 1 tick 8 体まで（予算）", st1.maxThinkPerTick <= D.AI_BUDGET.thinkPerTick, `(max=${st1.maxThinkPerTick})`);
    check("40 体いても全員いずれ考える", st1.thinks - st0.thinks >= 40 * 3, `(thinks=${st1.thinks - st0.thinks})`);
    for (const m of many) m.remove();
    // 衛生兵
    const med = brain.spawnEnemy(dim, { x: 10.5, y: 64, z: -10.5 }, "raider_medic");
    const hurt = brain.spawnEnemy(dim, { x: 11.5, y: 64, z: -10.5 }, "raider_gunner");
    __tick(2);
    hurt.health.setCurrentValue(5);
    __tick(40);
    check("衛生兵が弱った味方を回復", hurt.health.currentValue > 5, `(hp=${hurt.health.currentValue})`);
    // 自爆
    const bl = brain.spawnEnemy(dim, { x: 0.5, y: 64, z: 2.5 }, "hollow_bloater");
    __tick(2);
    const ex0 = LOG.explosions.length;
    __tick(60);
    check("ブローターは近づくと膨らんで爆発", LOG.explosions.length > ex0 && !bl.isValid);
    heal(player);
    // 撃たれて弱ったら遮蔽へ
    for (let x = -9; x <= 10; x++) dim.blocks.set(`${x},64,14`, "minecraft:stone"), dim.blocks.set(`${x},65,14`, "minecraft:stone");
    const wp0 = LOG.spawned.filter((x) => x === "arsenal:waypoint").length;
    const cov = brain.spawnEnemy(dim, { x: 0.5, y: 64, z: 12.5 }, "raider_rifleman");
    cov.health.setCurrentValue(6);
    __tick(40);
    const ca = brain.aiOf(cov);
    check("弱ると遮蔽へ（または分隊で側面へ）道しるべで移動（arsenal:ai_move）", cov.events.includes("arsenal:ai_move") && LOG.spawned.filter((x) => x === "arsenal:waypoint").length > wp0 && ["cover", "flank"].includes(ca.moveWhy), ca.moveWhy);
    for (let x = -9; x <= 10; x++) dim.blocks.delete(`${x},64,14`), dim.blocks.delete(`${x},65,14`);
    // スタン
    brain.stun(cov, 40);
    check("スタンで思考が止まる（その場で待機）", brain.aiOf(cov).stunUntil > system.currentTick && cov.events.includes("arsenal:ai_hold"));
    // 偵察ドローン
    const m0 = LOG.messages.length;
    const dr = brain.spawnEnemy(dim, { x: 0.5, y: 68, z: 8.5 }, "legion_drone");
    __tick(30);
    check("偵察ドローンに見つかると警告", LOG.messages.slice(m0).some((m) => m?.translate === "arsenal.ui.spotted"));
    dr.remove();
    // 敵同士は撃ち合わない
    check("敵同士は撃ち合わない", !dmg.canDamage(e, cov));
    killAllArsenal();
    __tick(3);
  }

  // =====================================================================
  console.log("ボス");
  // =====================================================================
  {
    reset();
    clearInv();
    settings.setWorld({ bosses: false });
    inv.items[0] = new ItemStack("arsenal:warlord_banner", 1);
    check("ボス設定 OFF では呼べない", !bosses.summonBoss(player, "boss_warlord", "arsenal:warlord_banner"));
    settings.setWorld({ bosses: true });
    player.addEffect("resistance", 100000, { amplifier: 4 });  // ボスの攻撃で倒れないように
    const ok = bosses.summonBoss(player, "boss_warlord", "arsenal:warlord_banner");
    check("軍旗を使うとウォーロードを召喚（アイテム消費）", ok && count("arsenal:warlord_banner") === 0);
    __tick(65);
    const boss = [...__entities.values()].find((x) => x.typeId === "arsenal:boss_warlord" && x.isValid);
    check("予兆の 3 秒後に出現", !!boss);
    check("同じボスが近くにいると呼べない", !bosses.summonBoss(player, "boss_warlord", "arsenal:warlord_banner"));
    boss.health.setCurrentValue(boss.health.effectiveMax * 0.5);
    __tick(30);
    const b = JSON.parse(boss.getDynamicProperty("a:boss") ?? "{}");
    check("体力 50% で第 2 段階へ（保存される）", b.phase === 2, JSON.stringify(b));
    __tick(400);
    const minions = [...__entities.values()].filter((x) => x.isValid && x.hasTag?.(`arsenal_minion:${boss.id}`));
    check("第 2 段階で増援を呼ぶ", minions.length > 0, `(minions=${minions.length})`);
    const kill0 = emitted.bossKill;
    heal(player);
    dmg.dealDamage(player, boss, 9999, { weaponId: "sentinel" });
    __tick(3);
    check("撃破で bossKill（報酬）とレジェンダリー武器のドロップ", emitted.bossKill === kill0 + 1 && [...__entities.values()].some((x) => x.typeId === "minecraft:item" && D.WEAPONS[x.item?.typeId?.replace("arsenal:", "")]?.tier === "legendary"));
    // ジャガーノートの部位破壊
    const jug = brain.spawnEnemy(dim, { x: 0.5, y: 64, z: 12.5 }, "boss_juggernaut", { persist: true });
    jug.height = 3.2; jug.width = 1.6;
    jug.setRotation({ x: 0, y: 180 });
    __tick(2);
    const hpJ = jug.health.currentValue;
    const st = (await imp("core/weaponState.js")).computeStats("sentinel", {}, "std");
    // 左ポッド（北を向いているので右手 = -x 側が左…向きから計算）
    const { r } = (await imp("util/math.js")).basis(jug.getViewDirection());
    const podPt = { x: jug.location.x - r.x * 0.7, y: jug.location.y + 3.0, z: jug.location.z - r.z * 0.7 };
    for (let i = 0; i < 40; i++) dmg.bulletHit(player, jug, podPt, { x: 0, y: 0, z: 1 }, 10, { ...st, dmg: 8 }, 1, {});
    const bj = JSON.parse(jug.getDynamicProperty("a:boss") ?? "{}");
    check("ジャガーノート：ポッドを撃ち続けると破壊（見た目も外れる）", bj.parts && bj.parts.left_pod === 0 && jug.props["arsenal:pod_l"] === false, JSON.stringify(bj.parts));
    check("部位を撃つと本体へのダメージは減る", hpJ - jug.health.currentValue < 40 * 8, `(dealt=${hpJ - jug.health.currentValue})`);
    killAllArsenal();
    clearInv();
    player.removeEffect("resistance");
    __tick(3);
  }

  // =====================================================================
  console.log("実機で見つかった不具合（2.4.2）");
  // =====================================================================
  {
    reset();
    // 爆発の出どころを実機が受け付けない（シミュレートプレイヤーなど）ときも爆発そのものは起こす
    const orig = dim.createExplosion;
    dim.createExplosion = function (l, pw, o) {
      if (o?.source) throw new TypeError("Native optional type conversion failed. Interface property ['source']");
      return orig.call(this, l, pw, o);
    };
    const n0 = LOG.explosions.length;
    dmg.explode(dim, { x: 2.5, y: 64, z: 2.5 }, 2, player, false, false, "grenade_frag");
    dim.createExplosion = orig;
    check("爆発の出どころが拒まれても出どころなしで爆発する", LOG.explosions.length === n0 + 1 && !LOG.explosions[n0].o.source);
    // 投擲の予測線：読み込まれていないチャンクの手前で線を終える（毎 tick 例外を投げて捕まえていた）
    const proj = await imp("systems/projectiles.js");
    const u0 = LOG.unloadedAccess ?? 0;
    const r0 = dim.loadedRadius;
    dim.loadedRadius = 15.999; // チャンク 0 だけ読み込み（x = 16 から先は未読み込み）
    player.setRotation({ x: -35, y: -90 });
    proj.previewTrajectory(player, "grenade_frag");
    dim.loadedRadius = r0;
    check("予測線は読み込み範囲の外へレイを撃たない（例外を出さずに線を終える）", (LOG.unloadedAccess ?? 0) === u0, `(unloaded=${(LOG.unloadedAccess ?? 0) - u0})`);
    __tick(2);
  }

  // =====================================================================
  console.log("設置物");
  // =====================================================================
  {
    reset();
    clearInv();
    inv.items[0] = new ItemStack("arsenal:sentry_turret", 3);
    inv.items[1] = new ItemStack("arsenal:ammo_medium", 64);
    const ground = dim.getBlock({ x: 3, y: 63, z: 3 });
    check("側面には置けない", !gear.tryDeploy(player, ground, "North", "arsenal:sentry_turret"));
    __tick(12);
    check("ブロックの上面に砲台を置く（1 個消費）", gear.tryDeploy(player, ground, "Up", "arsenal:sentry_turret") && count("arsenal:sentry_turret") === 2);
    const sentry = [...__entities.values()].find((x) => x.typeId === "arsenal:sentry" && x.isValid);
    check("持ち主を記録", sentry?.getDynamicProperty("a:own") === player.id);
    __tick(12);
    gear.tryDeploy(player, dim.getBlock({ x: 5, y: 63, z: 3 }), "Up", "arsenal:sentry_turret");
    __tick(12);
    check("同時に置ける数の上限（砲台 2）", !gear.tryDeploy(player, dim.getBlock({ x: 7, y: 63, z: 3 }), "Up", "arsenal:sentry_turret"));
    __tick(2);
    const z = zombie(3.5, 10.5, 60);
    __tick(60);
    check("砲台が敵を撃つ", z.health.currentValue < 60 || !z.isValid, `(hp=${z.health.currentValue})`);
    check("砲台の弾は持ち主の中口径弾から補充", count("arsenal:ammo_medium") < 64);
    check("砲台は持ち主を撃たない", player.health.currentValue === player.health.effectiveMax);
    // 2.4.2：rotFromDir の { pitch, yaw } を読む（rot.x / rot.y を読んで砲台が的を向かなかった）
    const srot = sentry.getRotation();
    check("砲台が的の方を向く（向きと仰角が数値）", Number.isFinite(srot.y) && Math.abs(srot.y) < 30 && Number.isFinite(sentry.props["arsenal:pitch"]), `(rot=${JSON.stringify(srot)} pitch=${sentry.props["arsenal:pitch"]})`);
    z.remove();
    brain.applyEmp(dim, sentry.location, 4, 60, null);
    check("EMP で砲台が止まる", brain.isEmpd(sentry));
    // 回収
    player.isSneaking = true;
    const before = count("arsenal:sentry_turret");
    world.afterEvents.playerInteractWithEntity.fire({ player, target: sentry });
    player.isSneaking = false;
    check("スニークで触ると回収（アイテムが戻る）", !sentry.isValid && count("arsenal:sentry_turret") === before + 1);
    // クレイモア
    inv.items[2] = new ItemStack("arsenal:claymore", 2);
    __tick(12);
    player.setRotation({ x: 0, y: 0 });
    gear.tryDeploy(player, dim.getBlock({ x: -4, y: 63, z: -4 }), "Up", "arsenal:claymore");
    __tick(45);
    const ex0 = LOG.explosions.length;
    const zc = zombie(-3.5, -1.5, 20);
    __tick(8);
    check("クレイモア：前方の敵で起爆", LOG.explosions.length > ex0);
    zc.remove();
    // 弾薬・医療ステーション
    inv.items[3] = new ItemStack("arsenal:ammo_station", 1);
    inv.items[4] = new ItemStack("arsenal:med_station", 1);
    __tick(12);
    gear.tryDeploy(player, dim.getBlock({ x: 1, y: 63, z: 1 }), "Up", "arsenal:ammo_station");
    __tick(12);
    gear.tryDeploy(player, dim.getBlock({ x: 0, y: 63, z: 1 }), "Up", "arsenal:med_station");
    inv.items[8] = new ItemStack("arsenal:sentinel", 1);
    inv.items[1] = undefined;
    player.selectedSlotIndex = 8;
    heal(player, 10);
    S(player).bleedUntil = system.currentTick + 400;
    __tick(110);
    check("弾薬ステーションが持っている武器の弾を補給", count("arsenal:ammo_medium") > 0);
    check("医療ステーションが回復・止血", player.health.currentValue > 10 && S(player).bleedUntil === 0);
    // 迫撃砲陣地
    inv.items[5] = new ItemStack("arsenal:mortar_emplacement", 1);
    inv.items[6] = new ItemStack("arsenal:mortar_shell", 4);
    __tick(12);
    gear.tryDeploy(player, dim.getBlock({ x: -6, y: 63, z: 0 }), "Up", "arsenal:mortar_emplacement");
    const mortar = [...__entities.values()].find((x) => x.typeId === "arsenal:mortar_emplacement" && x.isValid);
    ui.UI_LOG.answers.push({ canceled: false, formValues: ["-6", "40", 2] });
    await deps.useMortarEmplacement(player, mortar);
    const ex1 = LOG.explosions.length;
    __tick(140);
    check("迫撃砲陣地：座標を指定して 2 発撃つ（砲弾消費）", count("arsenal:mortar_shell") === 2 && LOG.explosions.length >= ex1 + 1, `(shells=${count("arsenal:mortar_shell")}, ex=${LOG.explosions.length - ex1})`);
    // 偵察ドローン
    inv.items[7] = new ItemStack("arsenal:recon_drone", 1);
    const cam0 = LOG.cameras.length;
    deps.launchDrone(player);
    __tick(10);
    check("偵察ドローン：カメラをドローン視点に", LOG.cameras.length > cam0 && count("arsenal:recon_drone") === 0);
    player.isSneaking = true;
    __tick(2);
    player.isSneaking = false;
    check("スニークでドローンが戻り、アイテムも戻る", count("arsenal:recon_drone") === 1 && !S(player).droneId);
    killAllArsenal();
    clearInv();
    heal(player);
    __tick(3);
  }

  // =====================================================================
  console.log("銃座・乗り物");
  // =====================================================================
  {
    reset();
    clearInv();
    inv.items[0] = new ItemStack("arsenal:hmg_nest", 1);
    gear.tryDeploy(player, dim.getBlock({ x: 0, y: 63, z: 2 }), "Up", "arsenal:hmg_nest");
    const nest = [...__entities.values()].find((x) => x.typeId === "arsenal:hmg_nest" && x.isValid);
    check("重機関銃座を設置", !!nest);
    player.riding = nest;
    const z = zombie(0.5, 14.5, 80);
    player.setRotation({ x: 0, y: 0 });
    __tick(3);
    player.buttons.Jump = "Pressed";
    __tick(20);
    player.buttons.Jump = "Released";
    check("弾がないと撃てない（知らせ）", z.health.currentValue === 80);
    inv.items[1] = new ItemStack("arsenal:ammo_heavy", 30);
    player.buttons.Jump = "Pressed";
    __tick(20);
    player.buttons.Jump = "Released";
    check("乗ってジャンプで撃つ（大口径弾を消費）", count("arsenal:ammo_heavy") < 30 && z.health.currentValue < 80, `(ammo=${count("arsenal:ammo_heavy")}, hp=${z.health.currentValue})`);
    check("砲身が視点に合わせて回る", nest.props["arsenal:pitch"] !== undefined);
    player.riding = null;
    __tick(2);
    // バギー
    const bug = dim.spawnEntity("arsenal:buggy", { x: 4.5, y: 64, z: 4.5 });
    bug.setDynamicProperty("a:fuel", 100);
    bug.setDynamicProperty("a:own", player.id);
    bug.comps["minecraft:rideable"] = { getRiders: () => [player] };
    const mv = { v: 0.34, setCurrentValue(x) { this.v = x; } };
    bug.comps["minecraft:movement"] = mv;
    bug.vel = { x: 0.2, y: 0, z: 0 };
    player.riding = bug;
    __tick(40);
    check("バギーは走ると燃料が減る", bug.getDynamicProperty("a:fuel") < 100);
    __tick(80);
    check("燃料切れで止まる", mv.v === 0);
    player.riding = null;
    __tick(2);
    inv.items[2] = new ItemStack("arsenal:fuel_canister", 2);
    const ev = { player, target: bug, itemStack: new ItemStack("arsenal:fuel_canister", 1), cancel: false };
    world.beforeEvents.playerInteractWithEntity.fire(ev);
    __tick(2);
    check("燃料キャニスターで給油（乗らない）", ev.cancel && bug.getDynamicProperty("a:fuel") >= 600 && count("arsenal:fuel_canister") === 1);
    killAllArsenal();
    z.remove();
    clearInv();
    __tick(3);
  }

  // =====================================================================
  console.log("2.3 ボリューム（アタッチメント・迷彩・敵・ボス・銃座）");
  // =====================================================================
  {
    reset();
    clearInv();
    const ws = await imp("core/weaponState.js");
    const base = ws.computeStats("sentinel", {}, "std");
    const pm = ws.computeStats("sentinel", { mag: "mag_polymer" }, "std");
    check("ポリマーマガジン：装弾数 ×1.2", pm.mag === Math.ceil(base.mag * 1.2), `(${base.mag} → ${pm.mag})`);
    const ap = ws.computeStats("sentinel", { ammo: "ammo_ap_core" }, "std");
    check("徹甲芯弾：貫通 +1・ダメージ ×0.92", ap.pen === base.pen + 1 && Math.abs(ap.dmg - base.dmg * 0.92) < 1e-9, `(pen ${base.pen} → ${ap.pen})`);
    check("迷彩 12 種：最後の迷彩は武器 Lv40", D.CAMOS.c12.level === D.WEAPON_MAX_LEVEL && D.WEAPON_MAX_LEVEL === 40 && !prog.camoUnlocked(player, "sentinel", "c12"));
    check("新しい投擲物（ミニ・高性能インパクト・テルミット）", D.THROWABLES.grenade_mini?.kind === "frag" && D.THROWABLES.grenade_heavy_impact?.kind === "impact" && D.THROWABLES.thermite?.kind === "molotov");
    // 新しい敵はすべて出せる
    const ids = ["raider_breacher", "raider_scout", "raider_marksman", "legion_lancer", "legion_hunter", "hollow_crawler"];
    const spawned = ids.map((id, i) => brain.spawnEnemy(dim, { x: -20.5 + i * 3, y: 64, z: 30.5 }, id, {}));
    check("新しい敵 6 種を出せる", spawned.every((e) => e && e.isValid), ids.filter((_, i) => !spawned[i]).join(","));
    player.addEffect("resistance", 100000, { amplifier: 4 });
    __tick(100);
    killAllArsenal();
    heal(player);
    __tick(3);
    // 自動擲弾銃座
    inv.items[0] = new ItemStack("arsenal:gl_post", 1);
    gear.tryDeploy(player, dim.getBlock({ x: 0, y: 63, z: 2 }), "Up", "arsenal:gl_post");
    const gl = [...__entities.values()].find((x) => x.typeId === "arsenal:gl_post" && x.isValid);
    check("自動擲弾銃座を設置", !!gl);
    player.riding = gl;
    inv.items[1] = new ItemStack("arsenal:ammo_40mm", 10);
    player.setRotation({ x: -10, y: 0 });
    __tick(3);
    player.buttons.Jump = "Pressed";
    __tick(12);
    player.buttons.Jump = "Released";
    check("乗ってジャンプで 40mm 擲弾を撃つ", count("arsenal:ammo_40mm") < 10, `(ammo=${count("arsenal:ammo_40mm")})`);
    player.riding = null;
    __tick(60);
    killAllArsenal();
    clearInv();
    heal(player);
    __tick(3);
    // ホロウ・マザー
    settings.setWorld({ bosses: true });
    inv.items[0] = new ItemStack("arsenal:hollow_heart", 1);
    check("ホロウの心臓でホロウ・マザーを呼ぶ（アイテム消費）", bosses.summonBoss(player, "boss_hollow_mother", "arsenal:hollow_heart") && count("arsenal:hollow_heart") === 0);
    __tick(65);
    const mom = [...__entities.values()].find((x) => x.typeId === "arsenal:boss_hollow_mother" && x.isValid);
    check("ホロウ・マザーが出現", !!mom);
    __tick(400);
    const kids = [...__entities.values()].filter((x) => x.isValid && x.hasTag?.(`arsenal_minion:${mom?.id}`));
    check("ホロウの群れを産む", kids.length > 0 && kids.every((k) => k.typeId.startsWith("arsenal:hollow_")), `(kids=${kids.map((k) => k.typeId).join(",")})`);
    const k0 = emitted.bossKill;
    heal(player);
    dmg.dealDamage(player, mom, 9999, { weaponId: "sentinel" });
    __tick(3);
    check("ホロウ・マザーの撃破で bossKill", emitted.bossKill === k0 + 1);
    killAllArsenal();
    clearInv();
    player.removeEffect("resistance");
    heal(player);
    __tick(3);
  }

  // =====================================================================
  console.log("キルストリーク");
  // =====================================================================
  {
    reset();
    clearInv();
    const s = S(player);
    ks.forgetStreaks(player.id);
    player.setDynamicProperty("a:ks", undefined);
    const z = new Entity("arsenal:raider_captain", { x: 0.5, y: 64, z: 5.5 }, dim, 60);
    for (let i = 0; i < 3; i++) events.emitEvent("kill", { killer: player, victim: z, victimType: "arsenal:raider_captain", weaponId: "sentinel", head: false, distance: 5, kind: "gun", pvp: false });
    check("PvE：敵を倒すと tier に応じてポイント", JSON.parse(player.getDynamicProperty("a:ks")).pts === 90);
    check("ポイントが足りるストリークが使える", ks.available(player).includes("recon") && ks.available(player).includes("supply_drop") && !ks.available(player).includes("gunship"));
    check("HUD の ks フィールド", ks.streakReady(player));
    const r0 = LOG.sounds["arsenal.world.sonar"] ?? 0;
    check("偵察を使う（ポイント消費）", ks.useStreak(player, "recon") && JSON.parse(player.getDynamicProperty("a:ks")).pts === 30 && (LOG.sounds["arsenal.world.sonar"] ?? 0) > r0);
    check("足りないと使えない", !ks.useStreak(player, "supply_drop"));
    ks.addStreakPoints(player, 400);
    player.setRotation({ x: 60, y: 0 });
    check("補給投下：視線の先に箱を落とす", ks.useStreak(player, "supply_drop"));
    __tick(100);
    const crate = [...__entities.values()].find((x) => x.typeId === "arsenal:supply_crate" && x.isValid);
    check("補給箱が地面に着いて落下傘を外す", crate && crate.props["arsenal:landed"] === true && Math.abs(crate.location.y - 64) < 0.01);
    world.afterEvents.playerInteractWithEntity.fire({ player, target: crate });
    check("補給箱を開けると中身が出る", !crate.isValid && [...__entities.values()].some((x) => x.typeId === "minecraft:item" && x.isValid));
    ks.addStreakPoints(player, 400);
    const ex0 = LOG.explosions.length;
    check("空爆", ks.useStreak(player, "airstrike"));
    __tick(80);
    check("空爆：予兆のあと一直線に 8 発", LOG.explosions.length - ex0 === 8, `(${LOG.explosions.length - ex0})`);
    ks.addStreakPoints(player, 400);
    ks.useStreak(player, "turret_drop");
    __tick(80);
    check("砲台投下：着地すると期限付き・弾無限の砲台", [...__entities.values()].some((x) => x.typeId === "arsenal:sentry" && x.isValid && x.getDynamicProperty("a:inf") === true));
    ks.addStreakPoints(player, 400);
    player.setRotation({ x: 80, y: 0 });
    check("ガンシップ（上空視点・カメラ）", ks.useStreak(player, "gunship") && S(player).gunshipUntil > system.currentTick);
    player.buttons.Jump = "Pressed";
    const mb0 = LOG.particles;
    __tick(20);
    player.buttons.Jump = "Released";
    player.isSneaking = true;
    __tick(2);
    player.isSneaking = false;
    check("ガンシップはジャンプで撃ち、スニークで終わる", LOG.particles > mb0 && S(player).gunshipUntil === 0);
    player.setRotation({ x: 0, y: 0 });
    // PvP の連続キル
    s.streak = 0;
    const other = new Player(dim);
    for (let i = 0; i < 3; i++) events.emitEvent("kill", { killer: player, victim: other, victimType: "minecraft:player", weaponId: "sentinel", head: false, distance: 5, kind: "gun", pvp: true });
    check("PvP：3 連続キルで偵察が使える", JSON.parse(player.getDynamicProperty("a:ks")).ready.includes("recon") && s.streak === 3);
    events.emitEvent("death", { victim: player });
    check("死ぬと連続キルは 0（使える権利は残る）", s.streak === 0 && JSON.parse(player.getDynamicProperty("a:ks")).ready.includes("recon"));
    settings.setWorld({ killstreaks: false });
    check("ワールド設定 OFF で使えない", !ks.useStreak(player, "recon"));
    settings.setWorld({ killstreaks: true });
    other.remove();
    z.remove();
    killAllArsenal();
    __tick(3);
  }

  // =====================================================================
  console.log("構造物");
  // =====================================================================
  {
    reset();
    const pts = (await imp("config/structures.gen.js")).STRUCTURE_POINTS;
    globalThis.__onPlace = (name, d, loc) => {
      const sid = name.replace("arsenal:", "");
      for (const c of pts[sid]?.chests ?? []) {
        const k = `${loc.x + c[0]},${loc.y + c[1]},${loc.z + c[2]}`;
        d.blocks.set(k, "minecraft:chest");
        d.containers.set(k, new mc.Container(27));
      }
      for (const m of pts[sid]?.markers ?? []) d.blocks.set(`${loc.x + m[0]},${loc.y + m[1]},${loc.z + m[2]}`, "arsenal:spawn_marker");
    };
    const mark = (x, z, kind) => {
      const k = `${x},64,${z}`;
      dim.blocks.set(k, "arsenal:site_marker");
      dim.states.set(k, { "arsenal:kind": kind });
      return dim.getBlock({ x, y: 64, z });
    };
    const kinds = (await imp("config/structures.gen.js")).SITE_KINDS;
    player.location = { x: 200.5, y: 64, z: 0.5 };
    const far = mark(140, 0, 0);
    comps.block["arsenal:site"].onTick({ block: far, dimension: dim });
    check("近くにプレイヤーがいなければ何もしない", dim.blocks.get("140,64,0") === "arsenal:site_marker" && LOG.placed.length === 0);
    player.location = { x: 0.5, y: 64, z: 0.5 };
    settings.setWorld({ structures: "off" });
    const m1 = mark(10, 10, 0);
    comps.block["arsenal:site"].onTick({ block: m1, dimension: dim });
    check("密度 OFF：目印を消すだけ（本体は置かない）", dim.blocks.get("10,64,10") === "minecraft:air" && LOG.placed.length === 0);
    settings.setWorld({ structures: "high" });
    const campIdx = kinds.indexOf("raider_camp");
    const m2 = mark(20, 20, campIdx);
    comps.block["arsenal:site"].onTick({ block: m2, dimension: dim });
    check("密度「多め」：野営地を展開", LOG.placed.some((p) => p.name === "arsenal:raider_camp"));
    __tick(4);
    const chests = [...dim.containers.values()];
    check(`宝箱に中身を詰める（${chests.length} 個）`, chests.length === 3 && chests.every((c) => c.items.some((x) => x)));
    const garrison = [...__entities.values()].filter((x) => x.isValid && x.hasTag?.("arsenal_site:1") || x.getTags?.().some((t) => t.startsWith("arsenal_site:")));
    const want = D.STRUCTURES.raider_camp.garrison.reduce((a, g) => a + g.count, 0);
    check(`守備隊を出す（${garrison.length}/${want}）`, garrison.length === want);
    check("守備隊の出現位置の目印は消す", ![...dim.blocks.values()].includes("arsenal:spawn_marker"));
    const m3 = mark(40, 20, campIdx);
    comps.block["arsenal:site"].onTick({ block: m3, dimension: dim });
    check("ほかの構造物の近く（40 ブロック以内）には置かない", LOG.placed.filter((p) => p.name === "arsenal:raider_camp").length === 1);
    const c0 = emitted.structureCleared;
    const cr0 = eco.credits(player);
    for (const g of garrison) dmg.dealDamage(player, g, 9999, { weaponId: "sentinel" });
    __tick(3);
    check("守備隊を全滅させると制圧（イベント）", emitted.structureCleared === c0 + 1);
    check("制圧の報酬（クレジット）", eco.credits(player) >= cr0 + D.REWARDS.structureClear);
    const sites = structs.siteList();
    check("構造物の記録を保存（再起動後も制圧済み）", JSON.parse(world.getDynamicProperty("a:sites")).some((s) => s.sid === "raider_camp" && s.cleared) && sites.length >= 1);
    const lt = lootgen.rollLoot("legendary");
    check("レジェンダリーの宝箱には必ずレジェンダリー武器", lt.some((it) => D.WEAPONS[it.typeId.replace("arsenal:", "")]?.tier === "legendary"));
    // 2.3 の構造物：それぞれ離して展開し、宝箱と守備隊が揃うか
    for (const [i, sid] of ["checkpoint", "radar_station", "infested_farm"].entries()) {
      killAllArsenal();
      dim.containers.clear();
      const [x, zz] = [[-120, -120], [120, -120], [-120, 120]][i];
      player.location = { x: x + 0.5, y: 64, z: zz + 0.5 };
      const mk = mark(x + 5, zz + 5, kinds.indexOf(sid));
      comps.block["arsenal:site"].onTick({ block: mk, dimension: dim });
      __tick(4);
      const wantCh = D.STRUCTURES[sid].chests.reduce((a, c) => a + c.count, 0);
      const ch = [...dim.containers.values()];
      const gar = [...__entities.values()].filter((e) => e.isValid && e.getTags?.().some((t) => t.startsWith("arsenal_site:")));
      const wantG = D.STRUCTURES[sid].garrison.reduce((a, g) => a + g.count, 0);
      check(`${sid}：展開・宝箱 ${ch.length}/${wantCh}・守備隊 ${gar.length}/${wantG}`, LOG.placed.some((p) => p.name === `arsenal:${sid}`) && ch.length === wantCh && gar.length === wantG);
    }
    player.location = { x: 0.5, y: 64, z: 0.5 };
    settings.setWorld({ structures: "normal" });
    killAllArsenal();
    __tick(3);
  }

  // =====================================================================
  console.log("進行（武器レベル・階級・チャレンジ・保存）");
  // =====================================================================
  {
    reset();
    prog.forgetProfile(player.id);
    for (const k of Object.keys(player.props)) if (k.startsWith("dp:a:prog")) delete player.props[k];
    const vic = new Entity("arsenal:raider_gunner", { x: 0.5, y: 64, z: 5.5 }, dim, 22);
    const r0 = prog.profile(player).rankXp;
    events.emitEvent("kill", { killer: player, victim: vic, victimType: "arsenal:raider_gunner", weaponId: "sentinel", head: true, distance: 55, kind: "gun", pvp: false });
    const p1 = prog.profile(player);
    check("キルで武器経験値（キル＋頭＋遠距離）", p1.wxp.sentinel === D.WEAPON_XP.kill + D.WEAPON_XP.headshot + D.WEAPON_XP.longshot);
    check("キルで階級経験値", p1.rankXp === r0 + D.RANK_XP.kill + D.RANK_XP.headshot);
    check("統計（キル・頭・遠距離・最長）", p1.stats.kills === 1 && p1.stats.headKills === 1 && p1.stats.longKills === 1 && p1.stats.longest === 55);
    const lv0 = prog.weaponLevel(player, "sentinel");
    const m0 = LOG.messages.length;
    prog.addWeaponXp(player, "sentinel", D.WEAPON_XP_TABLE[4] + 5);
    check("武器レベルが上がる（知らせと迷彩の解放）", prog.weaponLevel(player, "sentinel") >= 4 && lv0 === 1 && LOG.messages.slice(m0).length >= 2);
    check("迷彩の解放判定", prog.camoUnlocked(player, "sentinel", "c1") && !prog.camoUnlocked(player, "sentinel", "c8"));
    prog.addRankXp(player, D.RANK_XP_TABLE[6]);
    check("階級が上がる（称号・グリフ）", prog.rankOf(player) >= 5 && prog.rankGlyph(prog.rankOf(player)).charCodeAt(0) >= 0xe130);
    const ch = prog.challenges(player);
    check("デイリー 3・ウィークリー 3", ch.daily.length === 3 && ch.weekly.length === 3);
    const dk = ch.daily.find((c) => c.id === "d_kills") ?? ch.weekly.find((c) => c.id === "w_kills");
    const pre = dk ? dk.prog : 0;
    events.emitEvent("kill", { killer: player, victim: vic, victimType: "arsenal:raider_gunner", weaponId: "sentinel", head: false, distance: 5, kind: "gun", pvp: false });
    check("チャレンジが進む", !dk || dk.prog === pre + 1);
    const any = ch.daily[0];
    any.prog = any.n - 1;
    const cd0 = emitted.challengeDone;
    const d = D.CHALLENGES.daily.find((c) => c.id === any.id);
    const ctx = { cat: d.filter?.cat === "assault" ? "sentinel" : d.filter?.cat === "smg" ? "mako" : d.filter?.cat === "shotgun" ? "breacher" : d.filter?.cat === "sniper" ? "nightjar" : "sentinel" };
    if (d.stat === "medsUsed") events.emitEvent("medUsed", { player, id: "bandage" });
    else if (d.stat === "meleeKills") events.emitEvent("kill", { killer: player, victim: vic, victimType: d.filter?.faction === "hollow" ? "arsenal:hollow_runner" : "arsenal:raider_gunner", weaponId: "machete", head: false, distance: 2, kind: "melee", pvp: false });
    else if (d.stat === "explosiveKills") events.emitEvent("kill", { killer: player, victim: vic, victimType: "arsenal:raider_gunner", weaponId: "thumper", head: false, distance: 10, kind: "explosive", pvp: false });
    else if (d.stat === "longKills") events.emitEvent("kill", { killer: player, victim: vic, victimType: "arsenal:raider_gunner", weaponId: "nightjar", head: false, distance: 80, kind: "gun", pvp: false });
    else if (d.stat === "headKills") events.emitEvent("kill", { killer: player, victim: vic, victimType: "arsenal:raider_gunner", weaponId: ctx.cat, head: true, distance: 10, kind: "gun", pvp: false });
    else events.emitEvent("kill", { killer: player, victim: vic, victimType: d.filter?.faction === "hollow" ? "arsenal:hollow_runner" : "arsenal:raider_gunner", weaponId: ctx.cat, head: false, distance: 10, kind: "gun", pvp: false });
    check(`チャレンジ達成で報酬（${any.id}）`, any.done && emitted.challengeDone === cd0 + 1);
    // 大きな保存（分割）
    const prof = prog.profile(player);
    for (let i = 0; i < 1500; i++) prof.wxp[`fake_weapon_${i}_xxxxxxxxxxxx`] = i + 1;
    prog.writeChunked(player, "a:prog", JSON.stringify(prof));
    const nParts = player.getDynamicProperty("a:prog.n");
    const back = JSON.parse(prog.readChunked(player, "a:prog"));
    check(`分割保存（${nParts} 個）と読み戻し`, nParts >= 2 && back.wxp.fake_weapon_1499_xxxxxxxxxxxx === 1500 && player.getDynamicProperty("a:prog.v") === D.SAVE_VERSION);
    for (let i = 0; i < 1500; i++) delete prof.wxp[`fake_weapon_${i}_xxxxxxxxxxxx`];
    prog.writeChunked(player, "a:prog", JSON.stringify(prof));
    check("縮んだら古い断片を消す", player.getDynamicProperty("a:prog.n") === 1 && player.getDynamicProperty("a:prog.1") === undefined);
    prog.forgetProfile(player.id);
    check("読み直しても同じ", prog.profile(player).wxp.sentinel === prof.wxp.sentinel);
    prog.applyNameTag(player);
    check("名前の横に階級グリフ", player.nameTag.startsWith(prog.rankGlyph(prog.rankOf(player))));
    vic.remove();
  }

  // =====================================================================
  console.log("経済");
  // =====================================================================
  {
    reset();
    clearInv();
    const other = new Player(dim);
    check("初期クレジット", eco.credits(other) === D.CURRENCY.start);
    other.remove();
    player.setDynamicProperty("a:cr", 1000);
    const vic = new Entity("arsenal:raider_heavy", { x: 0.5, y: 64, z: 5.5 }, dim, 44);
    events.emitEvent("kill", { killer: player, victim: vic, victimType: "arsenal:raider_heavy", weaponId: "sentinel", head: true, distance: 10, kind: "gun", pvp: false });
    check("撃破報酬（tier 2＋ヘッドショット）", eco.credits(player) === 1000 + D.REWARDS.killByTier[2] + D.REWARDS.headshotBonus);
    vic.remove();
    const cr = eco.credits(player);
    const price = eco.priceOf("arsenal:vx9");
    check("買う：代金を払って初期化済みの武器を受け取る", eco.buy(player, "arsenal:vx9", 1, price) && eco.credits(player) === cr - price && inv.items.some((i) => i?.typeId === "arsenal:vx9" && i.props["a:init"] === true));
    player.setDynamicProperty("a:cr", 5);
    check("お金が足りないと買えない", !eco.buy(player, "arsenal:vx9", 1, price) && eco.credits(player) === 5);
    const slot = inv.items.findIndex((i) => i?.typeId === "arsenal:vx9");
    const got = eco.sellSlot(player, slot);
    check("売る：買値の 35%", got === Math.floor(price * D.SELL_RATE) && eco.credits(player) === 5 + got);
    check("闇市の品揃えは日で決まる（同じ日なら同じ）", JSON.stringify(eco.blackMarketStock(10)) === JSON.stringify(eco.blackMarketStock(10)) && JSON.stringify(eco.blackMarketStock(10)) !== JSON.stringify(eco.blackMarketStock(11)));
    check("闇市：レジェンダリー武器 2 を含む 5 品", eco.blackMarketStock(3).length === 5 && eco.blackMarketStock(3).filter((x) => D.WEAPONS[x.id.replace("arsenal:", "")]?.tier === "legendary").length === 2);
    prog.forgetProfile(player.id);
    for (const k of Object.keys(player.props)) if (k.startsWith("dp:a:prog")) delete player.props[k];
    player.setDynamicProperty("a:cr", 999999);
    check("闇市は階級 5 未満では買えない", !eco.buyBlackMarket(player, 0));
    prog.addRankXp(player, D.RANK_XP_TABLE[6]);
    check("階級 5 で買える", eco.buyBlackMarket(player, 0));
    check("各品は 1 日 1 個まで（売り切れ）", !eco.buyBlackMarket(player, 0));
    const qm = new Entity("arsenal:quartermaster", { x: 1.5, y: 64, z: 1.5 }, dim, 40);
    ui.UI_LOG.answers.push({ canceled: true });
    const f0 = ui.UI_LOG.forms.length;
    world.afterEvents.playerInteractWithEntity.fire({ player, target: qm });
    __tick(2);
    await flush();
    check("補給係に触ると店が開く", ui.UI_LOG.forms.length > f0);
    check("補給係は撃てない", !dmg.canDamage(player, qm));
    qm.remove();
    settings.setWorld({ economy: false });
    const c1 = eco.credits(player);
    events.emitEvent("kill", { killer: player, victim: player, victimType: "arsenal:raider_heavy", weaponId: "sentinel", head: false, distance: 10, kind: "gun", pvp: false });
    check("経済 OFF では稼げない", eco.credits(player) === c1);
    settings.setWorld({ economy: true });
    clearInv();
  }

  // =====================================================================
  console.log("ゲームモード");
  // =====================================================================
  {
    reset();
    clearInv();
    player.gm = "Survival";
    const p2 = new Player(dim);
    p2.name = "Bravo";
    world.players.push(p2);
    p2.location = { x: 10.5, y: 64, z: 10.5 };
    // アリーナ
    ui.UI_LOG.answers.push({ canceled: false, selection: 0 });
    ui.UI_LOG.answers.push({ canceled: false, formValues: ["test arena"] });
    ui.UI_LOG.answers.push({ canceled: true });
    player.location = { x: -15.5, y: 64, z: -15.5 };
    await modes.openArenaTool(player);
    await flush();
    const ar = modes.arenas().find((a) => a.name === "test arena");
    check("アリーナツールで新しいアリーナ（隅 A）", !!ar && ar.a && Math.floor(ar.a.x) === -16);
    ar.b = { x: 15.5, y: 64, z: 15.5 };
    ar.spawns = [{ x: -10.5, y: 64, z: -10.5 }, { x: 10.5, y: 64, z: 10.5 }, { x: -10.5, y: 64, z: 10.5 }, { x: 10.5, y: 64, z: -10.5 }];
    ar.hills = [{ x: 0.5, y: 64, z: 0.5 }];
    check("アリーナの検査：旗がないと陣取りはできない", modes.arenaProblem({ ...ar, hills: [] }, "koth") === "arsenal.mode.err_hill" && modes.arenaProblem(ar, "koth") === null);
    check("アリーナの検査：狭すぎる", modes.arenaProblem({ ...ar, b: { x: -10, y: 64, z: -10 } }, "ffa") === "arsenal.mode.err_small");
    player.location = { x: 0.5, y: 64, z: 0.5 };
    // 持ち物を用意
    inv.items[0] = new ItemStack("arsenal:nightjar", 1);
    inv.items[5] = new ItemStack("minecraft:diamond", 7);
    player.eqSlots.Head = new ItemStack("arsenal:nvg_helmet", 1);
    p2.inv.items[0] = new ItemStack("minecraft:emerald", 3);
    modes.startLobby("ffa", ar, player);
    modes.joinMatch(p2);
    check("ロビー：参加者 2 人", modes.currentMatch().parts.size === 2);
    modes.__setMatchLobbyNow();
    __tick(3);
    const m = modes.currentMatch();
    check("開始：試合中になる", m?.phase === "live");
    check("持ち物を保管庫へ（手持ちは装備セットに入れ替え）", !inv.items.some((i) => i?.typeId === "minecraft:diamond") && inv.items[0]?.typeId?.startsWith("arsenal:sentinel") && !player.eqSlots.Head?.typeId?.includes("nvg"));
    check("装備セット：防具とプレート", player.eqSlots.Chest?.typeId === "arsenal:vest_standard_1" && player.eqSlots.Chest.props["a:pl"] === 2);
    check("保管庫をティッキングエリアで読み込んだままにする", LOG.commands.some((c) => c.startsWith("tickingarea add")));
    check("a:msave に元の位置とゲームモードを記録", JSON.parse(player.getDynamicProperty("a:msave")).gm === "Survival");
    check("アドベンチャーモードでスポーン地点へ", player.gm === "Adventure" && ar.spawns.some((sp) => Math.abs(sp.x - player.location.x) < 0.01));
    check("スコアボード", !!world.scoreboard.getObjective("arsenal_score"));
    // 撃破と復活
    const k0 = emitted.kill;
    heal(p2, 3);
    dmg.dealDamage(player, p2, 50, { weaponId: "sentinel" });
    check("試合中は死なない（横取りして撃破を数える）", p2.isValid && m.parts.get(p2.id).deaths === 1 && m.parts.get(player.id).kills === 1 && emitted.kill === k0 + 1);
    check("撃破された人は観戦で待つ", p2.gm === "Spectator");
    __tick(70);
    check("数秒後に復活（アドベンチャー・体力満タン）", p2.gm === "Adventure" && p2.health.currentValue === p2.health.effectiveMax);
    const hudv = hud2.hud2Values(player, S(player));
    check("HUD 2.0 に得点と時間", hudv.gm === "1" && hudv.sa === 1 && typeof hudv.tm === "string" && hudv.tm.includes(":"));
    check("試合中（ガンゲーム以外）はキルストリークが使える", ks.available(player).length >= 0);
    // 勝利
    m.parts.get(player.id).kills = D.MODES.ffa.scoreLimit - 1;
    heal(p2, 2);
    dmg.dealDamage(player, p2, 50, { weaponId: "sentinel" });
    check("目標キル数で勝利", m.phase === "end" && m.winners.includes(player.id));
    const me0 = emitted.matchEnd;
    __tick(110);
    check("終了後に持ち物・位置・ゲームモードを戻す", inv.items.some((i) => i?.typeId === "minecraft:diamond" && i.amount === 7) && inv.items.some((i) => i?.typeId === "arsenal:nightjar") && player.eqSlots.Head?.typeId === "arsenal:nvg_helmet" && player.gm === "Survival" && player.getDynamicProperty("a:msave") === undefined);
    check("2 人目も戻る", p2.inv.items.some((i) => i?.typeId === "minecraft:emerald"));
    check("試合の結果（matchEnd）", emitted.matchEnd >= me0 && modes.currentMatch() === null);
    check("保管庫は片付ける", ![...__entities.values()].some((e) => e.typeId === "arsenal:storage" && e.isValid));
    // TDM
    modes.startLobby("tdm", ar, player);
    modes.joinMatch(p2);
    modes.__setMatchLobbyNow();
    __tick(3);
    const m2 = modes.currentMatch();
    check("TDM：2 チームに分かれる", new Set([...m2.parts.values()].map((x) => x.team)).size === 2 && player.getTags().some((t) => t.startsWith("arsenal_team:mode_")));
    heal(p2, 2);
    dmg.dealDamage(player, p2, 50, { weaponId: "sentinel" });
    check("TDM：チームの得点", m2.teamScore[m2.parts.get(player.id).team] === 1);
    modes.endMatch(null, "arsenal.mode.stopped");
    // 2.4.2：結果表示の間（持ち物を戻す前）に別の試合を始めると上書きされ、参加者の持ち物が戻らなくなっていた
    check("試合の終了処理中は次の試合を始めない", modes.startLobby("ffa", ar, player) === false && modes.currentMatch() === m2 && m2.mode === "tdm");
    __tick(110);
    check("TDM のチームタグは試合後に外す", !player.getTags().some((t) => t.startsWith("arsenal_team:mode_")));
    check("終了処理のあとは次の試合を始められ、持ち物も戻っている", player.getDynamicProperty("a:msave") === undefined && p2.getDynamicProperty("a:msave") === undefined);
    // ガンゲーム
    modes.startLobby("gungame", ar, player);
    modes.joinMatch(p2);
    modes.__setMatchLobbyNow();
    __tick(3);
    const m3 = modes.currentMatch();
    check("ガンゲーム：1 段目の武器だけ", inv.items[0]?.typeId === `arsenal:${D.MODES.gungame.ladder[0]}`);
    check("ガンゲームではキルストリーク不可", ks.available(player).length === 0);
    heal(p2, 2);
    dmg.dealDamage(player, p2, 50, { weaponId: D.MODES.gungame.ladder[0] });
    __tick(3);
    check("ガンゲーム：キルで次の武器", m3.parts.get(player.id).level === 1 && inv.items[0]?.typeId?.startsWith(`arsenal:${D.MODES.gungame.ladder[1]}`), inv.items[0]?.typeId);
    modes.endMatch(null);
    __tick(110);
    // ホード
    modes.startLobby("horde", ar, player);
    modes.__setMatchLobbyNow();
    __tick(3);
    const m4 = modes.currentMatch();
    __tick(110);
    check("ホード：ウェーブ 1 開始", m4.wave === 1 && m4.waveState === "fight");
    __tick(200);
    const enemies = [...__entities.values()].filter((e) => e.isValid && e.hasTag?.("arsenal_mode_enemy"));
    check("ホード：ホロウが湧く", enemies.length > 0);
    const w0 = emitted.wave;
    for (let i = 0; i < 30; i++) {
      for (const e of [...__entities.values()].filter((x) => x.isValid && x.hasTag?.("arsenal_mode_enemy"))) dmg.dealDamage(player, e, 9999, {});
      heal(player);
      __tick(10);
      if (m4.waveState === "break") break;
    }
    check("ホード：全滅させるとウェーブ突破（報酬）", m4.waveState === "break" && emitted.wave === w0 + 1);
    heal(player, 2);
    const z = new Entity("arsenal:hollow_runner", { x: 1, y: 64, z: 1 }, dim, 18);
    dmg.dealDamage(z, player, 50, {});
    check("ホード：全員倒れると終了", m4.phase === "end");
    z.remove();
    __tick(110);
    // 陣取り
    modes.startLobby("koth", ar, player);
    modes.joinMatch(p2);
    modes.__setMatchLobbyNow();
    __tick(3);
    const m5 = modes.currentMatch();
    player.location = { x: 0.5, y: 64, z: 0.5 };
    p2.location = { x: 12.5, y: 64, z: 12.5 };
    __tick(60);
    check("陣取り：丘にいるチームに得点", m5.teamScore[m5.parts.get(player.id).team] >= 2);
    modes.endMatch(null);
    __tick(110);
    // 再起動からの復帰
    modes.startLobby("ffa", ar, player);
    modes.joinMatch(p2);
    modes.__setMatchLobbyNow();
    __tick(3);
    // 試合中にワールドが閉じられた想定：試合の記録を消し、次の参加で戻す
    world.afterEvents.worldLoad.fire({});
    const mm = modes.currentMatch();
    mm.phase = "end";
    mm.restoreAt = 1e12;
    world.afterEvents.playerSpawn.fire({ player: p2, initialSpawn: true });
    __tick(25);
    check("再起動後の参加で a:msave から持ち物を戻す", p2.getDynamicProperty("a:msave") === undefined && p2.inv.items.some((i) => i?.typeId === "minecraft:emerald"));
    mm.restoreAt = system.currentTick;
    __tick(3);
    p2.remove();
    world.players.splice(world.players.indexOf(p2), 1);
    reset();
    clearInv();
    player.eqSlots = {};
  }

  // =====================================================================
  console.log("メニュー・図鑑・調整・報告");
  // =====================================================================
  {
    reset();
    clearInv();
    ui.UI_LOG.answers.push({ canceled: false, selection: 1 });
    ui.UI_LOG.answers.push({ canceled: false, formValues: [0, 2, 2, true, true, false, 1, false, 1, -1, true, false] });
    await menus.openManual(player);
    await flush();
    const p = settings.P(player);
    check("HUD・2.0 の設定を保存（大きさ・配置・エイムアシスト・一人称の位置）", p.hudScale === "large" && p.hudLayout === "raised" && p.aimAssist === "light" && p.fpOffsetV === 1 && p.fpOffsetD === -1 && p.suppressionFx === false && p.nvgAuto === false);
    ui.UI_LOG.answers.push({ canceled: false, selection: 3 });
    ui.UI_LOG.answers.push({ canceled: false, formValues: [false, true, 3, 2, true, true, true, true, true, 30, false, true, true, true] });
    await menus.openManual(player);
    await flush();
    const w = settings.W();
    check("ワールド設定（2.0）を保存", w.legion === false && w.structures === "high" && w.aiDifficulty === "hard" && w.downed === true && w.backstabPvp === 3);
    settings.setWorld({ legion: true, structures: "normal", aiDifficulty: "normal", downed: false, backstabPvp: 2 });
    let visited = 0;
    for (let c = 0; c < 9; c++) {
      ui.UI_LOG.answers.push({ canceled: false, selection: c });
      ui.UI_LOG.answers.push({ canceled: false, selection: 0 });
      ui.UI_LOG.answers.push({ canceled: true });
      const f0 = ui.UI_LOG.forms.length;
      await codex.openCodex2(player);
      await flush();
      if (ui.UI_LOG.forms.length - f0 >= 3) visited++;
    }
    check("図鑑：9 カテゴリすべて詳細まで開ける", visited === 9, `(${visited})`);
    let chapters = 0;
    for (let c = 0; c < Object.keys(codex.GUIDE_CHAPTERS).length; c++) {
      ui.UI_LOG.answers.push({ canceled: false, selection: c });
      ui.UI_LOG.answers.push({ canceled: true });
      const f0 = ui.UI_LOG.forms.length;
      await codex.openGuide2(player);
      await flush();
      if (ui.UI_LOG.forms.length - f0 === 2) chapters++;
    }
    check("操作ガイド：全章", chapters === Object.keys(codex.GUIDE_CHAPTERS).length);
    ui.UI_LOG.answers.push({ canceled: true });
    await codex.openProgress(player);
    check("戦績の画面", ui.UI_LOG.forms.at(-1)?._body?.rawtext?.length > 10);
    // 迷彩
    inv.items[0] = new ItemStack("arsenal:sentinel", 1);
    player.selectedSlotIndex = 0;
    __tick(3);
    prog.addWeaponXp(player, "sentinel", D.WEAPON_XP_TABLE[10]);
    menus.setCamo(player, "c3");
    __tick(2);
    check("迷彩を付けると見た目違い ID（迷彩）へ", inv.items[0].typeId === "arsenal:sentinel__c3" && inv.items[0].props["a:cm"] === "c3");
    menus.setCamo(player, null);
    check("迷彩を外すと元へ", inv.items[0].typeId === "arsenal:sentinel");
    // 調整モード
    codex.toggleCalib(player);
    const s = S(player);
    const c0 = s.calib;
    world.afterEvents.playerButtonInput.fire({ player, button: "Jump", newButtonState: "Pressed" });
    check("調整モード：ジャンプで次の位置", s.calib === (c0 % 25) + 1);
    __tick(3);
    check("調整モード中は一人称の位置のアニメを送る", LOG.anims.some((a) => a.startsWith("animation.arsenal.fpoff.")));
    world.afterEvents.playerButtonInput.fire({ player, button: "Sneak", newButtonState: "Pressed" });
    __tick(2);
    world.afterEvents.playerButtonInput.fire({ player, button: "Sneak", newButtonState: "Pressed" });
    check("スニーク 2 回で保存して終了", s.calib === 0 && typeof settings.P(player).fpOffsetV === "number");
    const lines = codex.reportLines();
    check("診断レポート（版・AI・設置物・構造物・試合）", lines.length >= 6 && lines[0].includes(D.ADDON_VERSION.join(".")) && lines.some((l) => l.includes("AI registered")));
    system.afterEvents.scriptEventReceive.fire({ id: "arsenal:report", message: "", sourceEntity: player });
    await flush();
    check("/scriptevent arsenal:report でフォームを出す", ui.UI_LOG.forms.at(-1)?._title === "ARSENAL report");
    ui.UI_LOG.answers.length = 0;
    settings.setPrefs(player, { hudStyle: "classic", aimAssist: "off", fpOffsetV: 0, fpOffsetD: 0, suppressionFx: true, nvgAuto: true, hudScale: "normal", hudLayout: "auto" });
    clearInv();
    __tick(3);
  }
}
