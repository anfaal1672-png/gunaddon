// ARSENAL CORE データ定義（tools/data/）。ランタイムにはビルド時に 1 ファイル（BP/scripts/config/weapons.data.js）へまとめて出力する。
// レシピ・修理コスト
import { TIERS, CATEGORIES } from "./core.js";
import { WEAPONS, MELEE } from "./weapons/index.js";
import { ATTACHMENTS } from "./attachments.js";

// ---------------------------------------------------------------------------
//  レシピ算出（兵器作業台）
// ---------------------------------------------------------------------------
const TIER_COST = {
  common: { "arsenal:steel_ingot": 6, "arsenal:precision_parts": 2, "arsenal:polymer": 2 },
  uncommon: { "arsenal:steel_ingot": 9, "arsenal:precision_parts": 4, "arsenal:polymer": 3 },
  rare: { "arsenal:steel_ingot": 12, "arsenal:precision_parts": 7, "arsenal:polymer": 4, "minecraft:diamond": 1 },
  legendary: null,
};

/**
 * 武器のレシピ。Legendary は作成不可（ルート限定）
 * @param {string} id
 * @returns {Record<string, number> | null}
 */
export function weaponRecipe(id) {
  const w = /** @type {any} */ (WEAPONS)[id];
  const base = /** @type {any} */ (TIER_COST)[w.tier];
  if (!base) return null;
  const mul = /** @type {any} */ (CATEGORIES)[w.cat].costMul;
  /** @type {Record<string, number>} */
  const out = {};
  for (const [k, v] of Object.entries(base)) out[k] = Math.max(1, Math.round(v * (k === "minecraft:diamond" ? 1 : mul)));
  if (w.model && w.model.finish === "wood") out["minecraft:oak_planks"] = 2;
  if (w.cat === "launcher") out["minecraft:tnt"] = 1;
  if (w.ammo === "cell") out["arsenal:energy_core"] = w.tier === "rare" ? 2 : 1;
  if (w.fire === "grapple") {
    out["minecraft:tripwire_hook"] = 2;
    out["minecraft:string"] = 8;
  }
  if (w.fire === "flare") out["minecraft:glowstone_dust"] = 4;
  // 2.0 の武器
  if (w.fire === "flame") out["minecraft:blaze_rod"] = 2;
  if (w.fire === "mortar") out["minecraft:iron_block"] = 1;
  if (w.cat === "heavy") out["minecraft:iron_block"] = (out["minecraft:iron_block"] ?? 0) + 1;
  if (w.ammo === "antimat") out["minecraft:netherite_scrap"] = 1;
  return out;
}

const ATT_TIER_COST = {
  common: { "arsenal:steel_ingot": 2, "arsenal:polymer": 1 },
  uncommon: { "arsenal:steel_ingot": 3, "arsenal:precision_parts": 1, "arsenal:polymer": 1 },
  rare: { "arsenal:steel_ingot": 4, "arsenal:precision_parts": 3, "minecraft:diamond": 1 },
  legendary: null,
};

/**
 * アタッチメントのレシピ
 * @param {string} id
 * @returns {Record<string, number> | null}
 */
export function attachmentRecipe(id) {
  const a = /** @type {any} */ (ATTACHMENTS)[id];
  /** @type {Record<string, number>} */
  const base = /** @type {any} */ (ATT_TIER_COST)[a.tier];
  if (!base) return null;
  const out = { ...base };
  if (a.slot === "optic") out["minecraft:glass_pane"] = 2;
  if (a.optic === "thermal") out["minecraft:golden_carrot"] = 1;
  if (id === "flashlight") out["minecraft:glowstone_dust"] = 2;
  if (id === "laser_tactical") out["minecraft:redstone"] = 2;
  if (id === "ub_launcher") out["minecraft:tnt"] = 1;
  if (a.optic === "nvscope") out["minecraft:golden_carrot"] = 1;
  if (a.slot === "ammo") out["minecraft:gunpowder"] = 4;
  if (id === "ub_flamer") out["minecraft:blaze_rod"] = 1;
  if (id === "ub_grapple") out["minecraft:tripwire_hook"] = 1;
  if (id === "laser_combo") out["minecraft:glowstone_dust"] = 1;
  return out;
}

/**
 * 修理コスト（耐久 100% 分）
 * @param {string} id
 * @returns {Record<string, number>}
 */
export function repairCost(id) {
  const w = /** @type {any} */ (WEAPONS)[id];
  const t = /** @type {any} */ (TIERS)[w.tier].order;
  return { "arsenal:steel_ingot": 2 + t, "arsenal:precision_parts": 1 + Math.floor(t / 2) };
}

const MELEE_COST = {
  common: { "arsenal:steel_ingot": 2, "minecraft:stick": 1, "minecraft:leather": 1 },
  uncommon: { "arsenal:steel_ingot": 4, "arsenal:polymer": 1, "minecraft:leather": 1 },
  rare: { "arsenal:steel_ingot": 5, "arsenal:precision_parts": 2, "arsenal:polymer": 1 },
  legendary: null,
};

/**
 * 近接武器のレシピ
 * @param {string} id
 * @returns {Record<string, number> | null}
 */
export function meleeRecipe(id) {
  const m = /** @type {any} */ (MELEE)[id];
  const base = /** @type {any} */ (MELEE_COST)[m.tier];
  if (!base) return null;
  const out = { ...base };
  if (m.special === "stun") out["minecraft:redstone"] = 3;
  if (m.special === "spring") out["minecraft:piston"] = 1;
  if (m.special === "breach") out["minecraft:iron_ingot"] = 2;
  return out;
}
