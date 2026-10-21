// ARSENAL CORE データ定義（tools/data/）。ランタイムにはビルド時に 1 ファイル（BP/scripts/config/weapons.data.js）へまとめて出力する。
// 経済（2.0 で追加）：通貨「クレジット」・価格・商人の品揃え・闇市・報酬
//
// 価格の考え方
//  - 買値はティアとカテゴリの係数から算出する（個別の上書きは PRICE_OVERRIDE）
//  - 売値は買値の SELL_RATE 倍（差でインフレを防ぐ）。耐久が減った武器は残り耐久に比例して下がる
//  - 1 体倒して得られる額は、コモン武器 1 挺の 1/15〜1/8 程度（夜 1 回の戦闘で弾薬と小物が買える）
import { TIERS, CATEGORIES } from "./core.js";
import { WEAPONS, MELEE } from "./weapons/index.js";
import { ATTACHMENTS } from "./attachments.js";
import { ARMOR } from "./armor.js";
import { THROWABLES, MEDICAL, DEPLOYABLES } from "./equipment.js";

export const CURRENCY = { name: { ja: "クレジット", en: "Credits" }, glyph: "¢", start: 150, max: 9999999 };

export const SELL_RATE = 0.35;

const TIER_PRICE = { common: 400, uncommon: 800, rare: 1500, legendary: 4000 };
const ATT_PRICE = { common: 120, uncommon: 260, rare: 520, legendary: 1500 };
const ARMOR_PRICE = { 1: 220, 2: 480, 3: 900 };

/** 個別の価格（算出式より優先） */
export const PRICE_OVERRIDE = {
  // 戦術核（2.6）：ほかの装備の値段表（ティアで 40〜260）では安すぎる
  "arsenal:tactical_nuke": 6000,
  "arsenal:steel_ingot": 12,
  "arsenal:polymer": 10,
  "arsenal:precision_parts": 30,
  "arsenal:energy_core": 180,
  "arsenal:repair_kit": 90,
  "arsenal:field_manual": 5,
  "arsenal:streak_terminal": 60,
  "arsenal:tactical_device": 80,
  "arsenal:armor_plate": 45,
  "arsenal:warlord_banner": 1800,
  "arsenal:legion_core": 2200,
  "arsenal:hollow_heart": 2000,
};

/** 弾薬 1 個あたりの価格（弾薬系統ごと） */
export const AMMO_PRICE = { light: 1, medium: 2, heavy: 3, magnum: 3, precision: 6, antimat: 16, shell: 3, gl40: 18, rocket: 45, flare: 6, cell: 8, fuel: 5, mortar: 30, none: 0 };

/**
 * 武器の買値
 * @param {string} id
 * @returns {number}
 */
export function weaponPrice(id) {
  const w = /** @type {any} */ (WEAPONS)[id] ?? /** @type {any} */ (MELEE)[id];
  const base = /** @type {any} */ (TIER_PRICE)[w.tier];
  const mul = /** @type {any} */ (CATEGORIES)[w.cat].costMul;
  return Math.round((base * mul) / 10) * 10;
}

/**
 * アタッチメントの買値
 * @param {string} id
 * @returns {number}
 */
export function attachmentPrice(id) {
  const a = /** @type {any} */ (ATTACHMENTS)[id];
  return /** @type {any} */ (ATT_PRICE)[a.tier];
}

/**
 * 防具の買値
 * @param {string} id
 * @returns {number}
 */
export function armorPrice(id) {
  const a = /** @type {any} */ (ARMOR)[id];
  const base = /** @type {any} */ (ARMOR_PRICE)[a.level];
  return Math.round((a.special ? base * 1.4 : a.slot === "chest" ? base * 1.3 : base) / 10) * 10;
}

/**
 * 装備（投擲物・医療品・設置物）の買値
 * @param {string} id
 * @returns {number}
 */
export function gearPrice(id) {
  const g = /** @type {any} */ (THROWABLES)[id] ?? /** @type {any} */ (MEDICAL)[id] ?? /** @type {any} */ (DEPLOYABLES)[id];
  const t = /** @type {any} */ (TIERS)[g.tier ?? "common"].order;
  return [40, 70, 130, 260][t];
}

// ---------------------------------------------------------------------------
//  補給係（通常の商人）の売り場。カテゴリ → 一覧 → 詳細の 3 段で見せる
//  maxTier … 売る上限（レジェンダリーは闇市だけ）
// ---------------------------------------------------------------------------
export const SHOP = {
  weapons: { name: { ja: "武器", en: "Weapons" }, maxTier: "rare" },
  ammo: { name: { ja: "弾薬", en: "Ammunition" }, stacks: [16, 32, 64] },
  attachments: { name: { ja: "アタッチメント", en: "Attachments" }, maxTier: "rare" },
  armor: { name: { ja: "防具", en: "Armor" } },
  gear: { name: { ja: "装備・医療品", en: "Gear & Medical" } },
  materials: { name: { ja: "素材", en: "Materials" }, items: ["arsenal:steel_ingot", "arsenal:polymer", "arsenal:precision_parts", "arsenal:energy_core", "arsenal:repair_kit", "arsenal:armor_plate"] },
  sell: { name: { ja: "売る", en: "Sell" } },
};

// ---------------------------------------------------------------------------
//  闇市：ゲーム内の日ごとに入れ替わる。日の番号から決まる（全員同じ品揃え）
// ---------------------------------------------------------------------------
export const BLACK_MARKET = {
  slots: 5,            // 並ぶ品の数
  legendaryWeapons: 2, // うちレジェンダリー武器
  legendaryParts: 1,   // うちレジェンダリーのアタッチメント
  rareParts: 2,        // うちレアのアタッチメント・防具
  markup: 1.6,         // 通常価格への上乗せ
  stock: 1,            // 各品の在庫（1 日・ワールド全体）
  unlockRank: 5,       // 利用に必要な階級
};

// ---------------------------------------------------------------------------
//  報酬
// ---------------------------------------------------------------------------
export const REWARDS = {
  killByTier: { 1: 12, 2: 20, 3: 35, 4: 400 },
  headshotBonus: 5,
  longshotBonus: 10,   // 60 ブロック以上
  longshotDist: 60,
  pvpKill: 25,
  assist: 5,
  structureClear: 150,
  hordeWave: 40,
  matchWin: 200,
  matchPlay: 60,
};
