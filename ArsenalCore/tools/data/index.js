// ARSENAL CORE データ定義（tools/data/）。ランタイムにはビルド時に 1 ファイル（BP/scripts/config/weapons.data.js）へまとめて出力する。
// すべてのデータモジュールを束ねる。derived() は生成スクリプトとランタイムが共通で使う派生値（見た目違い ID・価格表など）
export * from "./core.js";
export * from "./ammo.js";
export * from "./attachments.js";
export * from "./armor.js";
export * from "./equipment.js";
export * from "./enemies.js";
export * from "./structures.js";
export * from "./killstreaks.js";
export * from "./economy.js";
export * from "./progression.js";
export * from "./modes.js";
export * from "./recipes.js";
export * from "./hud.js";
export { WEAPONS, MELEE } from "./weapons/index.js";

import { NS, MATERIALS, TOOLS } from "./core.js";
import { WEAPONS, MELEE } from "./weapons/index.js";
import { ATTACHMENTS, OPTICS, OPTIC_GROUP } from "./attachments.js";
import { ARMOR, armorRecipe } from "./armor.js";
import { THROWABLES, MEDICAL, DEPLOYABLES, VEHICLES } from "./equipment.js";
import { CAMOS } from "./progression.js";
import { meleeRecipe } from "./recipes.js";
import { listAmmoItems } from "./ammo.js";
import { weaponPrice, attachmentPrice, armorPrice, gearPrice, PRICE_OVERRIDE, AMMO_PRICE } from "./economy.js";

/** 見た目グループ（0 = アイアン、1 = ドット系、2 = 倍率スコープ系） */
export const LOOK_GROUPS = [0, 1, 2];
/** 見た目グループごとにサイトを描き分けられるモデルの種類（ほかは照準器が本体と一体） */
export const LOOK_MODEL_TYPES = ["pistol", "revolver", "flare", "smg", "rifle", "sniper", "shotgun", "lmg", "energy"];

/**
 * 武器の既定の見た目グループ（素の状態のモデルに載っている光学）
 * @param {any} w
 * @returns {number}
 */
export function defaultLookGroup(w) {
  const m = w.model ?? {};
  if (m.scope) return 2;
  if (m.dot || m.holo || m.reddot) return 1;
  return OPTIC_GROUP[/** @type {keyof typeof OPTIC_GROUP} */ (w.optic ?? "iron")] ?? 0;
}

/**
 * 派生値
 *  LOOK … 武器ごとの見た目違い：{ base: 既定グループ, groups: 見た目違い ID を作るグループ }
 *          光学の枠が無い・光学が固定の武器は groups が空
 *  VARIANT_OF … 見た目違い ID（"<id>__o1" / "<id>__c3"）→ { base, look?, camo? }
 *  PRICES … アイテム ID → 買値
 */
export function derived() {
  /** @type {Record<string, {base: number, groups: number[]}>} */
  const LOOK = {};
  /** @type {Record<string, {base: string, look?: number, camo?: string}>} */
  const VARIANT_OF = {};
  for (const [id, w] of Object.entries(WEAPONS)) {
    const base = defaultLookGroup(w);
    const canOptic = w.slots.includes("optic") && !(w.fixed && w.fixed.optic) && LOOK_MODEL_TYPES.includes(w.model.type);
    const groups = canOptic ? LOOK_GROUPS.filter((g) => g !== base) : [];
    LOOK[id] = { base, groups };
    for (const g of groups) VARIANT_OF[`${id}__o${g}`] = { base: id, look: g };
    for (const c of Object.keys(CAMOS)) VARIANT_OF[`${id}__${c}`] = { base: id, camo: c };
  }
  /** @type {Record<string, number>} */
  const PRICES = {};
  for (const id of Object.keys(WEAPONS)) PRICES[`${NS}:${id}`] = weaponPrice(id);
  for (const id of Object.keys(MELEE)) PRICES[`${NS}:${id}`] = weaponPrice(id);
  for (const id of Object.keys(ATTACHMENTS)) PRICES[`${NS}:${id}`] = attachmentPrice(id);
  for (const id of Object.keys(ARMOR)) PRICES[`${NS}:${id}`] = armorPrice(id);
  for (const id of [...Object.keys(THROWABLES), ...Object.keys(MEDICAL), ...Object.keys(DEPLOYABLES)]) PRICES[`${NS}:${id}`] = gearPrice(id);
  for (const id of Object.keys(VEHICLES)) PRICES[`${NS}:${id}`] = 1200;
  for (const a of listAmmoItems()) PRICES[`${NS}:${a.id}`] = /** @type {any} */ (AMMO_PRICE)[a.family] ?? 2;
  for (const id of Object.keys(MATERIALS)) PRICES[`${NS}:${id}`] = PRICES[`${NS}:${id}`] ?? 10;
  for (const id of Object.keys(TOOLS)) PRICES[`${NS}:${id}`] = PRICES[`${NS}:${id}`] ?? 60;
  Object.assign(PRICES, PRICE_OVERRIDE);
  const MELEE_RECIPES = Object.fromEntries(Object.keys(MELEE).map((id) => [id, meleeRecipe(id)]));
  const ARMOR_RECIPES = Object.fromEntries(Object.keys(ARMOR).map((id) => [id, armorRecipe(id)]));
  const OPTIC_IDS = Object.keys(OPTICS);
  return { LOOK, VARIANT_OF, PRICES, MELEE_RECIPES, ARMOR_RECIPES, OPTIC_IDS };
}
