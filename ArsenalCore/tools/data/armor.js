// ARSENAL CORE データ定義（tools/data/）。ランタイムにはビルド時に 1 ファイル（BP/scripts/config/weapons.data.js）へまとめて出力する。
// 防具（2.0 で追加）
//  slot        … "head" | "chest"
//  protection  … バニラの防具値（ゲーム本体の軽減と、ARSENAL の弾丸ダメージ軽減の両方に効く）
//  headProt    … ヘルメット：ヘッドショット倍率を (1 - headProt) 倍にする
//  plates      … ボディアーマー：差し込めるプレートの枚数
//  move        … 着用中の移動速度倍率（武器の倍率に掛け合わせる）
//  special     … "nvg"（暗所で自動暗視）| "gasmask"（ガス無効）| "ghillie"（スニーク静止で敵に見つかりにくい）

export const ARMOR_FAMILIES = {
  light: { name: { ja: "軽装", en: "Light" }, color: [120, 112, 90], accent: [70, 64, 50] },
  standard: { name: { ja: "標準", en: "Standard" }, color: [86, 98, 70], accent: [48, 56, 40] },
  heavy: { name: { ja: "重装", en: "Heavy" }, color: [70, 72, 78], accent: [36, 38, 44] },
  specops: { name: { ja: "特殊部隊", en: "Spec Ops" }, color: [40, 42, 46], accent: [20, 20, 24] },
};

const TIER_NAMES = { 1: "I", 2: "II", 3: "III" };
const TIER_OF = { 1: "common", 2: "uncommon", 3: "rare" };

/** @type {Record<string, {helmet: number[], headProt: number[], vest: number[], plates: number[], move: number[], dur: number[]}>} */
const STATS = {
  light: { helmet: [1, 2, 2], headProt: [0.15, 0.2, 0.25], vest: [3, 4, 5], plates: [1, 1, 2], move: [1.0, 1.0, 1.0], dur: [200, 300, 420] },
  standard: { helmet: [2, 2, 3], headProt: [0.25, 0.3, 0.35], vest: [5, 6, 7], plates: [2, 2, 3], move: [0.97, 0.97, 0.98], dur: [300, 420, 560] },
  heavy: { helmet: [3, 3, 4], headProt: [0.35, 0.4, 0.5], vest: [7, 8, 9], plates: [3, 3, 4], move: [0.9, 0.9, 0.92], dur: [420, 560, 720] },
  specops: { helmet: [2, 3, 3], headProt: [0.3, 0.35, 0.4], vest: [5, 6, 7], plates: [2, 3, 3], move: [1.0, 1.0, 1.0], dur: [320, 460, 600] },
};

/** @returns {Record<string, any>} */
function build() {
  /** @type {Record<string, any>} */
  const out = {};
  for (const [fam, f] of Object.entries(ARMOR_FAMILIES)) {
    const st = STATS[fam];
    for (const t of [1, 2, 3]) {
      const i = t - 1;
      out[`helmet_${fam}_${t}`] = {
        slot: "head", family: fam, level: t, tier: TIER_OF[t],
        name: { ja: `${f.name.ja}ヘルメット ${TIER_NAMES[t]}`, en: `${f.name.en} Helmet ${TIER_NAMES[t]}` },
        protection: st.helmet[i], headProt: st.headProt[i], plates: 0, move: 1.0, durability: st.dur[i],
        model: { kind: "helmet", fam, level: t },
      };
      out[`vest_${fam}_${t}`] = {
        slot: "chest", family: fam, level: t, tier: TIER_OF[t],
        name: { ja: `${f.name.ja}ボディアーマー ${TIER_NAMES[t]}`, en: `${f.name.en} Body Armor ${TIER_NAMES[t]}` },
        protection: st.vest[i], headProt: 0, plates: st.plates[i], move: st.move[i], durability: st.dur[i] + 80,
        model: { kind: "vest", fam, level: t },
      };
    }
  }
  out.nvg_helmet = {
    slot: "head", family: "specops", level: 2, tier: "rare", special: "nvg",
    name: { ja: "暗視ゴーグル付きヘルメット", en: "NVG Helmet" }, protection: 2, headProt: 0.25, plates: 0, move: 1.0, durability: 400,
    model: { kind: "helmet", fam: "specops", level: 2, nvg: true },
  };
  out.gas_mask = {
    slot: "head", family: "light", level: 1, tier: "uncommon", special: "gasmask",
    name: { ja: "ガスマスク", en: "Gas Mask" }, protection: 1, headProt: 0.05, plates: 0, move: 1.0, durability: 300,
    model: { kind: "mask" },
  };
  out.ghillie_suit = {
    slot: "chest", family: "light", level: 1, tier: "rare", special: "ghillie",
    name: { ja: "ギリースーツ", en: "Ghillie Suit" }, protection: 2, headProt: 0, plates: 0, move: 1.0, durability: 300,
    model: { kind: "ghillie" },
  };
  return out;
}

export const ARMOR = build();

/** プレート 1 枚が受け止めるダメージ */
export const PLATE_HP = 10;

/**
 * 防具のレシピ
 * @param {string} id
 * @returns {Record<string, number>}
 */
export function armorRecipe(id) {
  const a = ARMOR[id];
  if (a.special === "nvg") return { "arsenal:steel_ingot": 4, "arsenal:precision_parts": 3, "minecraft:golden_carrot": 2, "minecraft:glass_pane": 2 };
  if (a.special === "gasmask") return { "arsenal:polymer": 3, "minecraft:leather": 2, "minecraft:glass_pane": 1, "minecraft:charcoal": 2 };
  if (a.special === "ghillie") return { "minecraft:string": 12, "minecraft:vine": 8, "minecraft:leather": 4, "minecraft:moss_block": 2 };
  const mul = a.slot === "head" ? 1 : 2;
  /** @type {Record<string, number>} */
  const out = { "arsenal:steel_ingot": (1 + a.level) * mul, "arsenal:polymer": a.level * mul, "minecraft:leather": 2 };
  if (a.family === "heavy") out["minecraft:iron_ingot"] = 2 * mul;
  if (a.family === "specops") out["arsenal:precision_parts"] = a.level;
  if (a.level === 3) out["minecraft:diamond"] = 1;
  return out;
}
