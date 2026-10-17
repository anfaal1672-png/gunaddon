// @ts-check
/**
 * 防具：部位防御（ヘルメット）・プレート（ボディアーマー）・移動速度・特殊（暗視・ガスマスク・ギリー）・ライオットシールド
 *
 * プレートはボディアーマーのアイテム（胸の防具スロット）のダイナミックプロパティに保存する。
 *   a:pl … 差し込んでいるプレートの枚数 / a:pd … いま受け止めているプレートの損傷
 * 被弾ごとの状態はメモリに持ち、書き込みは次の tick にまとめて行う（胸のスロットは手持ちではないので、射撃中でも問題ない）。
 */
import { system, world, EquipmentSlot, Player } from "@minecraft/server";
import { DATA, NS, armorIdOf } from "../config/constants.js";
import { P } from "./settings.js";
import { playNear } from "../fx/effects.js";
import { safe } from "../util/log.js";
import { dot } from "../util/math.js";

const ARMOR = /** @type {Record<string, any>} */ (DATA.ARMOR);
const PLATE_HP = DATA.PLATE_HP;

/**
 * @typedef {{chestType:string|null, plates:number, pd:number, cap:number, dirty:boolean, headType:string|null, checked:number}} ArmorState
 */
/** @type {Map<string, ArmorState>} */
const states = new Map();
/** 暗視ゴーグルで暗視を付けたプレイヤー */
const nvgApplied = new Set();

/** @param {Player} p @param {any} slot */
function equipment(p, slot) {
  return safe("armor.eq", () => p.getComponent("minecraft:equippable")?.getEquipment(slot));
}

/**
 * 装備の読み直し（胸・頭のアイテムが替わったら）
 * @param {Player} p @param {boolean} [cacheOnly] before イベント中など、世界を読めないとき
 * @returns {ArmorState}
 */
function armorState(p, cacheOnly = false) {
  let st = states.get(p.id);
  if (!st) {
    st = { chestType: null, plates: 0, pd: 0, cap: 0, dirty: false, headType: null, checked: -99 };
    states.set(p.id, st);
  }
  if (cacheOnly) return st;
  const now = system.currentTick;
  if (now === st.checked) return st;
  st.checked = now;
  const chest = equipment(p, EquipmentSlot.Chest);
  const head = equipment(p, EquipmentSlot.Head);
  st.headType = head?.typeId ?? null;
  const ct = chest?.typeId ?? null;
  if (ct !== st.chestType) {
    if (st.dirty) st.dirty = false; // 別の防具に替えた：前のアイテムの状態は捨てる（アイテム側に保存済み）
    st.chestType = ct;
    const aid = ct ? armorIdOf(ct) : undefined;
    const a = aid ? ARMOR[aid] : undefined;
    st.cap = a ? a.plates ?? 0 : 0;
    st.plates = chest && st.cap > 0 ? Math.min(st.cap, /** @type {number} */ (chest.getDynamicProperty("a:pl") ?? 0)) : 0;
    st.pd = chest && st.cap > 0 ? /** @type {number} */ (chest.getDynamicProperty("a:pd") ?? 0) : 0;
  }
  return st;
}

/** @param {Player} p */
function flushPlates(p) {
  const st = states.get(p.id);
  if (!st || !st.dirty) return;
  st.dirty = false;
  safe("armor.flush", () => {
    const eq = p.getComponent("minecraft:equippable");
    const chest = eq?.getEquipment(EquipmentSlot.Chest);
    if (!eq || !chest || chest.typeId !== st.chestType) return;
    chest.setDynamicProperties({ "a:pl": st.plates, "a:pd": Math.round(st.pd * 100) / 100 });
    eq.setEquipment(EquipmentSlot.Chest, chest);
  });
}

/**
 * プレートでダメージを受け止める。戻り値は残りのダメージ
 * @param {Player} p @param {number} dmg @param {boolean} [fromBefore] before イベント中（書き込み・音は次の tick に回す）
 */
export function absorbPlates(p, dmg, fromBefore = false) {
  if (dmg <= 0) return dmg;
  const st = armorState(p, fromBefore);
  if (st.plates <= 0) return dmg;
  let left = dmg;
  let broke = false;
  while (left > 0 && st.plates > 0) {
    const cap = PLATE_HP - st.pd;
    const take = Math.min(cap, left);
    st.pd += take;
    left -= take;
    if (st.pd >= PLATE_HP - 1e-6) {
      st.plates--;
      st.pd = 0;
      broke = true;
    }
  }
  st.dirty = true;
  const dim = p.dimension;
  const loc = p.location;
  system.run(() => {
    flushPlates(p);
    playNear(dim, loc, broke ? "arsenal.armor.plate_break" : "arsenal.armor.plate_hit", { range: 16, volume: 0.9 });
  });
  return left;
}

/**
 * プレートを 1 枚差し込む（入れられたら true）
 * @param {Player} p
 */
export function addPlate(p) {
  const st = armorState(p);
  if (st.cap <= 0 || st.plates >= st.cap) return false;
  st.plates++;
  if (st.plates === 1) st.pd = 0;
  st.dirty = true;
  flushPlates(p);
  playNear(p.dimension, p.location, "arsenal.armor.plate_insert", { range: 12 });
  return true;
}

/** HUD：プレートの残り（ボディアーマーなしは -1） @param {Player} p */
export function plateInfo(p) {
  const st = armorState(p);
  if (st.cap <= 0) return { plates: -1, cap: 0 };
  return { plates: st.plates, cap: st.cap };
}

/** ヘルメットによるヘッドショット倍率 @param {Player} p */
export function helmetHeadMul(p) {
  const st = armorState(p);
  const aid = st.headType ? armorIdOf(st.headType) : undefined;
  if (!aid) return 1;
  return 1 - (ARMOR[aid].headProt ?? 0);
}

/** 防具による移動速度の倍率 @param {Player} p */
export function armorMove(p) {
  const st = armorState(p);
  const aid = st.chestType ? armorIdOf(st.chestType) : undefined;
  return aid ? ARMOR[aid].move ?? 1 : 1;
}

/** 頭の特殊装備 @param {Player} p */
function headSpecial(p) {
  const st = armorState(p);
  const aid = st.headType ? armorIdOf(st.headType) : undefined;
  return aid ? ARMOR[aid].special ?? null : null;
}

/** ガスマスクを着けているか @param {import("@minecraft/server").Entity} e */
export function isGasImmune(e) {
  if (!(e instanceof Player)) return false;
  return headSpecial(e) === "gasmask";
}

/**
 * 見つかりやすさ（1 = 普通。ギリースーツでスニーク静止中は小さい）
 * @param {import("@minecraft/server").Entity} e
 */
export function stealthFactor(e) {
  if (!(e instanceof Player)) return 1;
  const st = armorState(e);
  const aid = st.chestType ? armorIdOf(st.chestType) : undefined;
  let f = 1;
  if (aid && ARMOR[aid].special === "ghillie" && e.isSneaking) {
    const v = e.getVelocity();
    if (Math.hypot(v.x, v.z) < 0.02) f = 0.35;
    else f = 0.7;
  } else if (e.isSneaking) f = 0.8;
  return f;
}

/**
 * ライオットシールド：オフハンドに持ち、弾が正面から来ていれば止める
 * @param {Player} p @param {import("../util/math.js").Vec3} bulletDir
 */
export function hasRiotShieldFacing(p, bulletDir) {
  const off = equipment(p, EquipmentSlot.Offhand);
  if (!off || off.typeId !== `${NS}:riot_shield`) return false;
  const v = p.getViewDirection();
  const facing = dot({ x: v.x, y: 0, z: v.z }, { x: -bulletDir.x, y: 0, z: -bulletDir.z });
  const need = p.isSneaking ? 0.15 : 0.55;
  if (facing < need) return false;
  // 盾の耐久（オフハンドは手持ちではないので書き換えてよい）
  system.run(() => safe("shield.wear", () => {
    const eq = p.getComponent("minecraft:equippable");
    const it = eq?.getEquipment(EquipmentSlot.Offhand);
    const d = it?.getComponent("minecraft:durability");
    if (!eq || !it || !d) return;
    if (d.damage + 3 >= d.maxDurability) {
      eq.setEquipment(EquipmentSlot.Offhand, undefined);
      playNear(p.dimension, p.location, "arsenal.armor.plate_break", { range: 16 });
    } else {
      d.damage += 3;
      eq.setEquipment(EquipmentSlot.Offhand, it);
    }
  }));
  return true;
}

/** ライオットシールドを構えているか（移動が遅くなる） @param {Player} p */
export function riotShieldMove(p) {
  const off = equipment(p, EquipmentSlot.Offhand);
  if (!off || off.typeId !== `${NS}:riot_shield`) return 1;
  return p.isSneaking ? 0.7 : 0.9;
}

/**
 * 暗視ゴーグル：暗いところで自動（個人設定）／手動の ON/OFF
 * @param {Player} p @param {import("./state.js").PlayerState} s
 * @returns {boolean} 画面効果を出すか
 */
export function tickNvg(p, s) {
  const now = system.currentTick;
  if (now - s.nvgTick < 10) return s.nvgTick > 0 && headSpecial(p) === "nvg" && s.nvgOn;
  s.nvgTick = now;
  const nvg = headSpecial(p) === "nvg";
  if (!nvg || !s.nvgOn) {
    if (nvgApplied.has(p.id)) {
      nvgApplied.delete(p.id);
      safe("nvg.off", () => {
        const e = p.getEffect("night_vision");
        if (e && e.duration <= 300 && !s.nvApplied) p.removeEffect("night_vision");
      });
    }
    return false;
  }
  let dark = true;
  if (P(p).nvgAuto) {
    dark = safe("nvg.light", () => {
      const dim = /** @type {any} */ (p.dimension);
      if (typeof dim.getLightLevel === "function") return dim.getLightLevel(p.getHeadLocation()) < 8;
      const tod = world.getTimeOfDay();
      return (tod > 13000 && tod < 23000) || p.location.y < 50;
    }) ?? true;
  }
  if (dark) {
    nvgApplied.add(p.id);
    safe("nvg.effect", () => p.addEffect("night_vision", 300, { amplifier: 0, showParticles: false }));
  }
  return dark;
}

/** @param {string} id */
export function forgetArmor(id) {
  states.delete(id);
  nvgApplied.delete(id);
}
