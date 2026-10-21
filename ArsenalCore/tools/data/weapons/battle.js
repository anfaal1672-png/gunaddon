// ARSENAL CORE データ定義（tools/data/）。ランタイムにはビルド時に 1 ファイル（BP/scripts/config/weapons.data.js）へまとめて出力する。
import { R } from "./_util.js";

export const BATTLE = {
  longbow: {
    cat: "battle", tier: "uncommon", name: { ja: "ロングボウ", en: "Longbow" },
    desc: { ja: "高威力のセミオートライフル。3 発で確実に倒す", en: "Hard-hitting semi-auto rifle" },
    ammo: "heavy", mag: 20, rpm: 330, modes: ["semi"], dmg: 7.5, head: 2.0, range: [45, 90], falloff: 0.65,
    spread: R(3.4, 0.3, 2.0, 0.8, 3.6, 0.35), recoil: { v: 2.1, h: 0.5, shake: 0.045 },
    reload: { tac: 38, empty: 50 }, ads: 5, move: 0.95, pen: 2, sound: "battle", pitch: 1.0, optic: "iron",
    slots: ["optic", "muzzle", "underbarrel", "mag", "laser", "stock"],
    model: { type: "rifle", body: 14, h: 4.5, barrel: 11, guard: 8, mag: "straight_short", stock: "wood", finish: "wood", accent: "tier" },
  },
  anvil: {
    cat: "battle", tier: "rare", name: { ja: "アンヴィル", en: "Anvil" },
    desc: { ja: "フルオート可能なバトルライフル。制御できれば最強", en: "Full-auto battle rifle with brutal recoil" },
    ammo: "heavy", mag: 20, rpm: 600, modes: ["auto", "semi"], dmg: 6.4, head: 1.9, range: [38, 80], falloff: 0.6,
    spread: R(3.8, 0.5, 2.2, 0.55, 4.5, 0.3), recoil: { v: 2.3, h: 1.2, shake: 0.05 },
    reload: { tac: 40, empty: 52 }, ads: 5, move: 0.93, pen: 3, sound: "battle", pitch: 0.92, optic: "iron",
    slots: ["optic", "muzzle", "underbarrel", "mag", "laser", "stock"],
    model: { type: "rifle", body: 14, h: 5, barrel: 10, guard: 9, mag: "straight_short", stock: "fixed", finish: "od", accent: "tier" },
  },
  harrier: {
    cat: "battle", tier: "rare", name: { ja: "ハリアー", en: "Harrier" },
    desc: { ja: "2 点バーストのバトルライフル。2 回の引き金で決着", en: "Two-round burst battle rifle" },
    ammo: "heavy", mag: 24, rpm: 780, burstRpm: 900, burstDelay: 6, modes: ["burst2", "semi"], dmg: 6.0, head: 1.9, range: [40, 82], falloff: 0.62,
    spread: R(3.4, 0.4, 2.0, 0.5, 3.8, 0.35), recoil: { v: 1.7, h: 0.55, shake: 0.04 },
    reload: { tac: 38, empty: 50 }, ads: 5, move: 0.95, pen: 2, sound: "battle", pitch: 1.05, optic: "reddot",
    slots: ["optic", "muzzle", "underbarrel", "mag", "laser", "stock"],
    model: { type: "rifle", body: 14, h: 4.5, barrel: 10, guard: 9, mag: "straight_short", stock: "skeleton", finish: "tan", accent: "tier" },
  },
  // ---- 2.0 で追加 ----
  halberd: {
    cat: "battle", tier: "rare", name: { ja: "ハルバード", en: "Halberd" },
    desc: { ja: "20 連フルオートのバトルライフル。弾倉 1 本で分隊を止める", en: "20-round full-auto battle rifle" },
    ammo: "heavy", mag: 20, rpm: 640, modes: ["auto", "semi"], dmg: 5.8, head: 1.9, range: [36, 76], falloff: 0.6,
    spread: R(3.8, 0.55, 2.2, 0.5, 4.6, 0.3), recoil: { v: 2.0, h: 1.0, shake: 0.045 },
    reload: { tac: 40, empty: 52 }, ads: 5, move: 0.93, pen: 3, sound: "battle", pitch: 0.96, optic: "iron",
    slots: ["optic", "muzzle", "underbarrel", "mag", "laser", "stock"],
    model: { type: "rifle", body: 14, h: 5, barrel: 9, guard: 8, mag: "straight_short", stock: "fixed", finish: "black", accent: "tier" },
  },

  // ---- 2.3 で追加 ----
  warhorse: {
    cat: "battle", tier: "rare", name: { ja: "ウォーホース", en: "Warhorse" },
    desc: { ja: "フルオートで撃てるバトルライフル。抑えるのは大変", en: "Full-auto battle rifle. Hard to tame" },
    ammo: "heavy", mag: 20, rpm: 560, modes: ["auto", "semi"], dmg: 6.6, head: 1.9, range: [40, 84], falloff: 0.63,
    spread: R(3.6, 0.45, 2.0, 0.6, 4.4, 0.32), recoil: { v: 2.0, h: 0.9, shake: 0.05 },
    reload: { tac: 40, empty: 52 }, ads: 5, move: 0.93, pen: 3, sound: "battle", pitch: 0.95, optic: "iron",
    slots: ["optic", "muzzle", "underbarrel", "mag", "laser", "stock"],
    model: { type: "rifle", body: 14, h: 4.6, barrel: 10, guard: 8, mag: "straight", stock: "fixed", finish: "black", accent: "tier" },
  },
  highlander: {
    cat: "battle", tier: "uncommon", name: { ja: "ハイランダー", en: "Highlander" },
    desc: { ja: "木製ストックの古い半自動小銃。1 発 1 発が重い", en: "Classic wooden semi-auto battle rifle" },
    ammo: "heavy", mag: 10, rpm: 260, modes: ["semi"], dmg: 8.2, head: 2.0, range: [48, 96], falloff: 0.66,
    spread: R(3.4, 0.28, 2.0, 0.9, 3.6, 0.34), recoil: { v: 2.4, h: 0.5, shake: 0.05 },
    reload: { tac: 36, empty: 48 }, ads: 5, move: 0.95, pen: 3, sound: "battle", pitch: 1.05, optic: "iron",
    slots: ["optic", "muzzle", "mag", "stock"],
    model: { type: "rifle", body: 15, h: 4.2, barrel: 12, guard: 10, mag: "straight_short", stock: "wood", finish: "wood", accent: "tier" },
  },
  // ---- 3.0 で追加（ブラッククロウの装備） ----
  rook: {
    cat: "battle", tier: "rare", name: { ja: "ルーク", en: "Rook" },
    desc: { ja: "3 点バーストのバトルライフル。重い弾を素早く 3 発送り込む", en: "Three-round burst battle rifle" },
    ammo: "heavy", mag: 21, rpm: 700, burstRpm: 850, burstDelay: 8, modes: ["burst3", "semi"], dmg: 5.6, head: 1.9, range: [38, 80], falloff: 0.6,
    spread: R(3.3, 0.45, 2.0, 0.5, 3.9, 0.34), recoil: { v: 1.55, h: 0.5, shake: 0.038 },
    reload: { tac: 40, empty: 52 }, ads: 5, move: 0.95, pen: 2, sound: "battle", pitch: 0.98, optic: "reddot",
    slots: ["optic", "muzzle", "underbarrel", "mag", "laser", "stock"],
    model: { type: "rifle", body: 14, h: 4.5, barrel: 9, guard: 9, mag: "straight_short", stock: "fixed", finish: "black", accent: "tier" },
  },
};
