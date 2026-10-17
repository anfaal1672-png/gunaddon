// ARSENAL CORE データ定義（tools/data/）。ランタイムにはビルド時に 1 ファイル（BP/scripts/config/weapons.data.js）へまとめて出力する。
import { R } from "./_util.js";

export const DMR = {
  marksman12: {
    cat: "dmr", tier: "uncommon", name: { ja: "マークスマン-12", en: "Marksman-12" },
    desc: { ja: "標準的な選抜射手ライフル。中遠距離の要", en: "Standard designated marksman rifle" },
    ammo: "heavy", mag: 12, rpm: 280, modes: ["semi"], dmg: 9.0, head: 2.2, range: [60, 120], falloff: 0.7,
    spread: R(4.5, 0.12, 2.5, 1.0, 4.0, 0.35), recoil: { v: 2.6, h: 0.6, shake: 0.05 },
    reload: { tac: 40, empty: 52 }, ads: 6, move: 0.94, pen: 2, sound: "battle", pitch: 1.08, optic: "scope4",
    slots: ["optic", "muzzle", "underbarrel", "mag", "stock"],
    model: { type: "rifle", body: 14, h: 4.5, barrel: 13, guard: 9, mag: "straight_short", stock: "fixed", finish: "black", accent: "tier", scope: 4 },
  },
  heron: {
    cat: "dmr", tier: "rare", name: { ja: "ヘロン", en: "Heron" },
    desc: { ja: "高初速弾で弾道が素直。遠距離でも減衰が小さい", en: "High-velocity marksman rifle" },
    ammo: "heavy", mag: 15, rpm: 320, modes: ["semi"], dmg: 8.0, head: 2.2, range: [75, 140], falloff: 0.75,
    spread: R(4.2, 0.1, 2.4, 0.9, 3.8, 0.38), recoil: { v: 2.2, h: 0.5, shake: 0.045 },
    reload: { tac: 38, empty: 50 }, ads: 6, move: 0.95, pen: 2, sound: "battle", pitch: 1.18, optic: "scope4",
    slots: ["optic", "muzzle", "underbarrel", "mag", "stock"],
    model: { type: "rifle", body: 13, h: 4, barrel: 15, guard: 10, mag: "straight_short", stock: "skeleton", finish: "arctic", accent: "tier", scope: 4 },
  },
  obelisk: {
    cat: "dmr", tier: "rare", name: { ja: "オベリスク", en: "Obelisk" },
    desc: { ja: "超高貫通の重 DMR。薄い壁も防具も意に介さない", en: "Deep-penetration heavy DMR" },
    ammo: "heavy", mag: 10, rpm: 180, modes: ["semi"], dmg: 10.0, head: 2.1, range: [65, 130], falloff: 0.7, ap: 0.6,
    spread: R(4.8, 0.12, 2.6, 1.2, 4.2, 0.32), recoil: { v: 3.2, h: 0.8, shake: 0.06 },
    reload: { tac: 42, empty: 56 }, ads: 6, move: 0.92, pen: 4, sound: "battle", pitch: 0.9, optic: "scope4",
    slots: ["optic", "muzzle", "underbarrel", "mag", "stock"],
    model: { type: "rifle", body: 15, h: 5, barrel: 14, guard: 10, mag: "box", stock: "fixed", finish: "steel", accent: "tier", scope: 4 },
  },
  // ---- 2.0 で追加 ----
  kitehawk: {
    cat: "dmr", tier: "uncommon", name: { ja: "カイトホーク", en: "Kitehawk" },
    desc: { ja: "3 倍プリズムを載せた軽量 DMR。走り回りながら中距離を抜く", en: "Light DMR with a 3x prism sight" },
    ammo: "heavy", mag: 15, rpm: 360, modes: ["semi"], dmg: 7.6, head: 2.1, range: [55, 110], falloff: 0.7,
    spread: R(4.0, 0.15, 2.2, 0.8, 3.6, 0.4), recoil: { v: 2.0, h: 0.5, shake: 0.045 },
    reload: { tac: 36, empty: 48 }, ads: 5, move: 0.97, pen: 2, sound: "battle", pitch: 1.14, optic: "scope3",
    slots: ["optic", "muzzle", "underbarrel", "mag", "stock"],
    model: { type: "rifle", body: 13, h: 4, barrel: 12, guard: 9, mag: "straight_short", stock: "skeleton", finish: "tan", accent: "tier", scope: 3 },
  },
  magistrate: {
    cat: "dmr", tier: "rare", name: { ja: "マジストレート", en: "Magistrate" },
    desc: { ja: "10 連の高威力セミオート。判決は 2 発で下る", en: "10-round high-damage semi-auto" },
    ammo: "heavy", mag: 10, rpm: 240, modes: ["semi"], dmg: 10.5, head: 2.1, range: [60, 120], falloff: 0.7, ap: 0.2,
    spread: R(4.6, 0.12, 2.5, 1.2, 4.2, 0.32), recoil: { v: 3.0, h: 0.7, shake: 0.06 },
    reload: { tac: 40, empty: 54 }, ads: 6, move: 0.93, pen: 3, sound: "battle", pitch: 0.88, optic: "scope4",
    slots: ["optic", "muzzle", "underbarrel", "mag", "stock"],
    model: { type: "rifle", body: 15, h: 5, barrel: 13, guard: 9, mag: "box", stock: "fixed", finish: "od", accent: "tier", scope: 4 },
  },
  longwatch: {
    cat: "dmr", tier: "rare", name: { ja: "ロングウォッチ", en: "Longwatch" },
    desc: { ja: "精密弾を撃つ強装 DMR。狙撃銃に迫る射程を連射で", en: "Precision-round DMR with near-sniper reach" },
    ammo: "precision", mag: 8, rpm: 200, modes: ["semi"], dmg: 12.0, head: 2.2, range: [80, 160], falloff: 0.75,
    spread: R(5.0, 0.1, 2.8, 1.3, 4.4, 0.3), recoil: { v: 3.4, h: 0.8, shake: 0.065 },
    reload: { tac: 44, empty: 58 }, ads: 6, move: 0.92, pen: 3, sound: "sniper", pitch: 1.15, optic: "scope4",
    fire: "ballistic", projectile: { speed: 16, gravity: 0.012 },
    slots: ["optic", "muzzle", "underbarrel", "mag", "stock"],
    model: { type: "rifle", body: 15, h: 4.5, barrel: 15, guard: 10, mag: "box", stock: "fixed", finish: "tan", accent: "tier", scope: 4 },
  },
};
