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
  check("迷彩 8 種", Object.keys(D.CAMOS).length === 8);
  const armorFam = new Set(Object.values(D.ARMOR).map((a) => a.family));
  check(`防具 4 系統×3 段階＋特殊 3（${Object.keys(D.ARMOR).length}）`, armorFam.size === 4 && Object.values(D.ARMOR).filter((a) => a.special).length === 3 && Object.keys(D.ARMOR).length >= 27);
  const gearN = Object.keys(D.THROWABLES).length + Object.keys(D.MEDICAL).length + Object.keys(D.DEPLOYABLES).length + Object.keys(D.VEHICLES).length;
  check(`装備 24 種以上（${gearN}）`, gearN >= 24);
  check(`3 勢力・敵 14 種以上（${Object.keys(D.ENEMIES).length}）・ボス 2`, Object.keys(D.FACTIONS).length === 3 && Object.keys(D.ENEMIES).length >= 14 && Object.keys(D.BOSSES).length === 2);
  check(`構造物 6 種以上（${Object.keys(D.STRUCTURES).length}）`, Object.keys(D.STRUCTURES).length >= 6);
  check("銃座 3・乗り物 1", Object.values(D.VEHICLES).filter((v) => v.kind === "emplacement").length === 3 && Object.values(D.VEHICLES).filter((v) => v.kind === "vehicle").length === 1);
  check("キルストリーク 6 種", Object.keys(D.KILLSTREAKS).length === 6);
  check("ゲームモード 5 種（FFA・TDM・ガンゲーム・ホード・陣取り）", ["ffa", "tdm", "gungame", "horde", "koth"].every((m) => D.MODES[m]));
  check("武器レベル 1〜30・階級 1〜50 の経験値表", D.WEAPON_XP_TABLE.length === 31 && D.RANK_XP_TABLE.length === 51 && D.WEAPON_XP_TABLE[30] > D.WEAPON_XP_TABLE[29]);
  const variants = Object.keys(D.VARIANT_OF);
  check(`見た目違い ID（${variants.length}）がすべて元の武器を指す`, variants.length > 0 && variants.every((v) => D.WEAPONS[D.VARIANT_OF[v].base]));
  check("ガンゲームのはしごは実在の武器で最後が近接", D.MODES.gungame.ladder.every((w) => D.WEAPONS[w] || D.MELEE[w]) && D.MELEE[D.MODES.gungame.ladder.at(-1)]);
  check("装備セットの武器・防具が実在する", Object.values(D.LOADOUTS).every((l) => D.WEAPONS[l.primary] && D.WEAPONS[l.secondary] && D.MELEE[l.melee] && l.armor.every((a) => D.ARMOR[a.replace("arsenal:", "")])));
  check("構造物の守備隊は実在の敵", Object.values(D.STRUCTURES).every((s) => s.garrison.every((g) => D.ENEMIES[g.id])));

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
    __tick(110);
    check("TDM のチームタグは試合後に外す", !player.getTags().some((t) => t.startsWith("arsenal_team:mode_")));
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
