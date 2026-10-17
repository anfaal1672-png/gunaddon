// @ts-check
/**
 * 近接戦闘：近接武器の追加効果・背後からの一撃・溜め攻撃・投擲・刃の射出・ブリーチング、銃の銃床打撃
 *
 *  ・近接武器の素のダメージはエンジン（アイテムの minecraft:damage）が与える。ここでは追加分だけをスクリプトで与える
 *  ・背後から：相手の視線と逆側から当てると backstab 倍（プレイヤー相手はワールド設定 backstabPvp が上限）
 *  ・溜め攻撃：使用ボタンを 0.6 秒以上押して離すと前へ踏み込み、0.75 秒以内の一撃が 1.6 倍
 *  ・スニーク＋使用：投げナイフ（コンバットナイフ）／刃の射出（スプリングナイフ）
 *  ・ブリーチングアックス：ドア・トラップドア・柵・フェンスゲート・板ガラスに向けて使うと一撃で壊す
 *  ・銃を持って殴ると銃床打撃（12 tick に 1 回）
 */
import { system, Player, GameMode, EquipmentSlot } from "@minecraft/server";
import { DATA, meleeIdOf, weaponIdOf, enemyIdOf } from "../config/constants.js";
import { W as WS } from "./settings.js";
import { S } from "./state.js";
import { meleeDamage, noteAttack } from "./damage.js";
import { stun } from "../systems/ai/brain.js";
import { throwBlade } from "../systems/projectiles.js";
import { playNear, emit } from "../fx/effects.js";
import { norm, sub, dot } from "../util/math.js";
import { safe } from "../util/log.js";

const MELEE = /** @type {Record<string, any>} */ (DATA.MELEE);
const ROBOT = new Set(["robot", "shield_bot", "mortar_bot", "drone", "juggernaut"]);
const BREACHABLE = ["door", "trapdoor", "fence", "glass_pane", "bars", "barrel", "scaffolding"];
const HEAVY_HOLD = 12;
const BUTT = { handgun: 3, machine_pistol: 3, smg: 4, carbine: 4.5, assault: 5, battle: 5.5, dmr: 5, sniper: 5, shotgun: 5.5, lmg: 6, heavy: 6.5, launcher: 5, special: 5 };

/**
 * 背後から当てたか
 * @param {import("@minecraft/server").Entity} attacker @param {import("@minecraft/server").Entity} target
 */
export function isBehind(attacker, target) {
  const v = safe("melee.view", () => target.getViewDirection());
  if (!v) return false;
  const toA = norm({ x: attacker.location.x - target.location.x, y: 0, z: attacker.location.z - target.location.z });
  return dot(norm({ x: v.x, y: 0, z: v.z }), toA) < -0.45;
}

/** @param {import("@minecraft/server").Entity} target */
function metallic(target) {
  const id = enemyIdOf(target.typeId);
  const def = id ? /** @type {any} */ (DATA.ENEMIES)[id] ?? /** @type {any} */ (DATA.BOSSES)[id] : undefined;
  return !!def && ROBOT.has(def.model);
}

/**
 * 近接武器が当たった（カスタムコンポーネント onHitEntity）
 * @param {Player} attacker @param {import("@minecraft/server").Entity} target @param {string} mid
 */
export function onMeleeHit(attacker, target, mid) {
  const m = MELEE[mid];
  if (!m || !target.isValid) return;
  const now = system.currentTick;
  const s = S(attacker);
  noteAttack(target, attacker, mid, "melee");
  let extraMul = 0;
  // 背後から
  if (isBehind(attacker, target)) {
    let bs = m.backstab ?? 2;
    if (target instanceof Player) bs = Math.min(bs, WS().backstabPvp ?? 2);
    extraMul += bs - 1;
    emit(target.dimension, "arsenal:blood", target.getAABB().center, undefined, { range: 24, blood: true });
  }
  // 溜め攻撃
  let heavy = false;
  if (s.heavyUntil > now) {
    heavy = true;
    s.heavyUntil = 0;
    extraMul += 0.6;
  }
  // ヴァイブロ：防具の半分を無視（素のダメージの 1/4 を防具無視で上乗せ）
  if (m.special === "vibro") extraMul += 0.25;
  if (extraMul > 0) {
    const tgt = target;
    system.run(() => safe("melee.extra", () => {
      if (tgt.isValid) meleeDamage(attacker, tgt, m.dmg * extraMul, mid, { ap: m.ap ?? 0, fire: m.fireSecs });
    }));
  }
  if (m.special === "vibro" && m.fireSecs) safe("melee.fire", () => target.setOnFire(m.fireSecs, true));
  if (m.special === "stun") {
    stun(target, 40);
    playNear(target.dimension, target.location, "arsenal.melee.zap", { range: 16 });
  }
  if (m.special === "sweep") {
    safe("melee.sweep", () => {
      for (const o of target.dimension.getEntities({ location: target.location, maxDistance: 2.5, excludeFamilies: ["inanimate", "arsenal_fx"], excludeTypes: ["minecraft:item", "minecraft:xp_orb"] })) {
        if (o.id === target.id || o.id === attacker.id) continue;
        if (dot(norm(sub(o.location, attacker.location)), attacker.getViewDirection()) < 0.2) continue;
        meleeDamage(attacker, o, m.dmg * 0.4, mid);
      }
    });
  }
  playNear(target.dimension, target.location, metallic(target) ? "arsenal.melee.hit_metal" : "arsenal.melee.hit", { range: 16, volume: heavy ? 1 : 0.7, pitch: heavy ? 0.8 : 1 });
  if (heavy) safe("melee.kb", () => {
    const v = norm(sub(target.location, attacker.location));
    target.applyKnockback({ x: v.x * 0.9, z: v.z * 0.9 }, 0.3);
  });
}

/**
 * 近接武器の使用開始（溜め／スニークで投擲・射出）
 * @param {Player} player @param {string} mid @param {import("@minecraft/server").ItemStack} item
 */
export function onMeleeStartUse(player, mid, item) {
  const m = MELEE[mid];
  const s = S(player);
  const now = system.currentTick;
  if (player.isSneaking && (m.special === "throw" || m.special === "spring")) {
    if (s.meleeCd > now) return;
    if (m.special === "throw") {
      s.meleeCd = now + 10;
      const slot = player.selectedSlotIndex;
      const thrown = item.clone();
      thrown.amount = 1;
      throwBlade(player, mid, thrown, m.throwDmg ?? m.dmg * 1.5);
      // 投げた武器を手から外す（1 回きりの操作。押しっぱなしの間の書き換えではない）
      system.run(() => safe("melee.throw.take", () => {
        const inv = player.getComponent("minecraft:inventory")?.container;
        const cur = inv?.getItem(slot);
        if (!inv || !cur || cur.typeId !== item.typeId) return;
        if (player.getGameMode() === GameMode.Creative) return;
        if (cur.amount > 1) {
          cur.amount--;
          inv.setItem(slot, cur);
        } else inv.setItem(slot, undefined);
      }));
    } else {
      s.meleeCd = now + (m.cooldown ?? 100);
      throwBlade(player, mid, null, m.throwDmg ?? 10);
      playNear(player.dimension, player.location, "arsenal.mech.bolt_forward", { range: 12, pitch: 1.6 });
    }
    s.meleeStart = -1;
    return;
  }
  s.meleeStart = now;
}

/**
 * 近接武器の使用終了（溜め攻撃の踏み込み）
 * @param {Player} player
 */
export function onMeleeStopUse(player) {
  const s = S(player);
  const now = system.currentTick;
  if (s.meleeStart < 0) return;
  const held = now - s.meleeStart;
  s.meleeStart = -1;
  if (held < HEAVY_HOLD) return;
  s.heavyUntil = now + 15;
  const v = player.getViewDirection();
  const h = norm({ x: v.x, y: 0, z: v.z });
  safe("melee.lunge", () => player.applyKnockback({ x: h.x * 0.9, z: h.z * 0.9 }, 0.12));
  playNear(player.dimension, player.location, "arsenal.melee.swing_heavy", { range: 12 });
}

/**
 * ブリーチング（カスタムコンポーネント onUseOn）
 * @param {Player} player @param {import("@minecraft/server").Block} block
 */
export function tryBreach(player, block) {
  const mid = meleeIdOf(heldTypeId(player) ?? "");
  if (!mid || MELEE[mid].special !== "breach") return false;
  const gm = safe("breach.gm", () => player.getGameMode());
  if (gm === GameMode.Adventure || gm === GameMode.Spectator) return false;
  const id = block.typeId.replace("minecraft:", "");
  if (!BREACHABLE.some((k) => id.includes(k))) return false;
  const s = S(player);
  const now = system.currentTick;
  if (s.meleeCd > now) return false;
  s.meleeCd = now + 16;
  const iron = id.includes("iron");
  const { x, y, z } = block.location;
  const dim = block.dimension;
  system.run(() => safe("breach", () => {
    dim.runCommand(`setblock ${x} ${y} ${z} air destroy`);
    playNear(dim, { x: x + 0.5, y: y + 0.5, z: z + 0.5 }, "arsenal.melee.swing_heavy", { range: 24, pitch: 0.7 });
    emit(dim, "arsenal:impact_debris", { x: x + 0.5, y: y + 0.5, z: z + 0.5 }, undefined, { range: 32 });
    // 耐久（鉄のドアは多め）
    const eq = player.getComponent("minecraft:equippable");
    const it = eq?.getEquipment(EquipmentSlot.Mainhand);
    const d = it?.getComponent("minecraft:durability");
    if (eq && it && d && player.getGameMode() !== GameMode.Creative) {
      d.damage = Math.min(d.maxDurability, d.damage + (iron ? 20 : 4));
      eq.setEquipment(EquipmentSlot.Mainhand, d.damage >= d.maxDurability ? undefined : it);
    }
  }));
  return true;
}

/** @param {Player} player */
function heldTypeId(player) {
  return safe("melee.held", () => player.getComponent("minecraft:equippable")?.getEquipment(EquipmentSlot.Mainhand)?.typeId);
}

/**
 * 銃床打撃（銃を持って殴った）
 * @param {Player} player @param {import("@minecraft/server").Entity} target
 */
export function buttStroke(player, target) {
  const tid = heldTypeId(player);
  const wid = tid ? weaponIdOf(tid) : undefined;
  if (!wid) return false;
  const s = S(player);
  const now = system.currentTick;
  if (now - s.lastButt < 12) return false;
  s.lastButt = now;
  const cat = /** @type {any} */ (DATA.WEAPONS)[wid].cat;
  let dmg = /** @type {any} */ (BUTT)[cat] ?? 4;
  if (isBehind(player, target)) dmg *= target instanceof Player ? Math.min(1.5, WS().backstabPvp ?? 2) : 1.5;
  meleeDamage(player, target, dmg, wid);
  playNear(target.dimension, target.location, metallic(target) ? "arsenal.melee.hit_metal" : "arsenal.melee.hit", { range: 16, pitch: 0.8 });
  const v = norm(sub(target.location, player.location));
  safe("butt.kb", () => target.applyKnockback({ x: v.x * 0.6, z: v.z * 0.6 }, 0.25));
  return true;
}

/** 近接武器の移動速度の倍率 @param {string} mid */
export function meleeMove(mid) {
  return MELEE[mid]?.move ?? 1;
}

