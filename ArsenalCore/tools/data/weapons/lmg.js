// ARSENAL CORE データ定義（tools/data/）。ランタイムにはビルド時に 1 ファイル（BP/scripts/config/weapons.data.js）へまとめて出力する。
import { R } from "./_util.js";

export const LMG = {
  juggernaut: {
    cat: "lmg", tier: "uncommon", name: { ja: "ジャガーノート", en: "Juggernaut" },
    desc: { ja: "100 発の大容量ボックスマガジン。弾幕で押し潰す", en: "100-round box-fed LMG" },
    ammo: "medium", mag: 100, rpm: 650, modes: ["auto"], dmg: 4.0, head: 1.6, range: [32, 70], falloff: 0.6,
    spread: R(4.5, 0.9, 2.2, 0.25, 4.8, 0.28), recoil: { v: 1.1, h: 0.9, shake: 0.03 },
    reload: { tac: 90, empty: 110 }, ads: 7, move: 0.84, pen: 2, sound: "lmg", pitch: 1.0, optic: "iron",
    slots: ["optic", "muzzle", "underbarrel", "laser", "stock"],
    model: { type: "lmg", body: 15, h: 5, barrel: 10, guard: 7, mag: "box_side", stock: "fixed", finish: "od", accent: "tier", carry: true },
  },
  grinder: {
    cat: "lmg", tier: "rare", name: { ja: "グラインダー", en: "Grinder" },
    desc: { ja: "回転銃身の多銃身機関銃。回転が上がるまで撃てない", en: "Rotary gun: spin up, then shred" },
    ammo: "medium", mag: 150, rpm: 1200, modes: ["auto"], spinup: 14, dmg: 3.2, head: 1.5, range: [26, 58], falloff: 0.55,
    spread: R(5.0, 2.2, 2.0, 0.15, 4.5, 0.3), recoil: { v: 0.55, h: 1.0, shake: 0.03 },
    reload: { tac: 110, empty: 130 }, ads: 8, move: 0.74, pen: 2, sound: "rotary", pitch: 1.0, optic: "iron",
    slots: ["laser"],
    model: { type: "rotary", body: 14, h: 6, barrel: 14, mag: "belt", stock: "none", finish: "steel", accent: "tier" },
  },
  bulwark: {
    cat: "lmg", tier: "rare", name: { ja: "ブルワーク", en: "Bulwark" },
    desc: { ja: "バイポッド一体型の重機関銃。据え撃ち（スニーク）で精度が激変", en: "Heavy LMG with built-in bipod" },
    ammo: "heavy", mag: 75, rpm: 560, modes: ["auto"], dmg: 5.4, head: 1.7, range: [40, 85], falloff: 0.62,
    spread: R(5.0, 1.0, 2.6, 0.35, 5.0, 0.26), recoil: { v: 1.6, h: 1.1, shake: 0.04 },
    reload: { tac: 96, empty: 116 }, ads: 8, move: 0.8, pen: 3, sound: "lmg_heavy", pitch: 0.9, optic: "iron",
    slots: ["optic", "muzzle", "laser"], fixed: { underbarrel: "bipod" },
    model: { type: "lmg", body: 16, h: 5.5, barrel: 12, guard: 8, mag: "belt_box", stock: "fixed", finish: "black", accent: "tier", bipodBuilt: true },
  },
};
