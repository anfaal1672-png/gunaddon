// ARSENAL CORE データ定義（tools/data/）。ランタイムにはビルド時に 1 ファイル（BP/scripts/config/weapons.data.js）へまとめて出力する。
// カービン（2.0 で追加）：SMG の機動力とライフルの射程の中間
import { R } from "./_util.js";

export const CARBINE = {
  drifter: {
    cat: "carbine", tier: "common", name: { ja: "ドリフター", en: "Drifter" },
    desc: { ja: "軽量で扱いやすい万能カービン。どの距離でも及第点", en: "Light, forgiving all-rounder carbine" },
    ammo: "medium", mag: 30, rpm: 720, modes: ["auto", "semi"], dmg: 3.9, head: 1.7, range: [24, 55], falloff: 0.55,
    spread: R(2.8, 0.6, 1.5, 0.3, 3.6, 0.38), recoil: { v: 0.9, h: 0.55, shake: 0.025 },
    reload: { tac: 32, empty: 44 }, ads: 3, move: 1.0, pen: 2, sound: "rifle", pitch: 1.12, optic: "iron",
    slots: ["optic", "muzzle", "underbarrel", "mag", "laser", "stock"],
    model: { type: "rifle", body: 11, h: 4, barrel: 5, guard: 5, mag: "curved", stock: "skeleton", finish: "od", accent: "tier" },
  },
  pathfinder: {
    cat: "carbine", tier: "uncommon", name: { ja: "パスファインダー", en: "Pathfinder" },
    desc: { ja: "最速の ADS。角を曲がった瞬間に照準が合う", en: "Fastest aim in the class" },
    ammo: "medium", mag: 30, rpm: 780, modes: ["auto", "semi"], dmg: 3.7, head: 1.7, range: [22, 50], falloff: 0.55,
    spread: R(2.6, 0.55, 1.4, 0.3, 3.5, 0.4), recoil: { v: 0.95, h: 0.6, shake: 0.025 },
    reload: { tac: 30, empty: 42 }, ads: 2, move: 1.02, pen: 2, sound: "rifle", pitch: 1.15, optic: "reddot",
    slots: ["optic", "muzzle", "underbarrel", "mag", "laser", "stock"],
    model: { type: "rifle", body: 11, h: 4, barrel: 4, guard: 5, mag: "curved", stock: "fixed", finish: "tan", accent: "tier" },
  },
  ridgeback: {
    cat: "carbine", tier: "rare", name: { ja: "リッジバック", en: "Ridgeback" },
    desc: { ja: "ヘビー弾を撃つ短銃身カービン。重いが一発が強い", en: "Short carbine chambered in heavy rounds" },
    ammo: "heavy", mag: 20, rpm: 480, modes: ["auto", "semi"], dmg: 5.6, head: 1.8, range: [30, 64], falloff: 0.6,
    spread: R(3.2, 0.55, 1.8, 0.45, 4.0, 0.34), recoil: { v: 1.7, h: 0.8, shake: 0.04 },
    reload: { tac: 36, empty: 48 }, ads: 4, move: 0.97, pen: 2, sound: "battle", pitch: 1.1, optic: "iron",
    slots: ["optic", "muzzle", "underbarrel", "mag", "laser", "stock"],
    model: { type: "rifle", body: 12, h: 4.5, barrel: 6, guard: 6, mag: "straight_short", stock: "fixed", finish: "black", accent: "tier" },
  },
  quillback: {
    cat: "carbine", tier: "uncommon", name: { ja: "クイルバック", en: "Quillback" },
    desc: { ja: "高貫通の徹甲カービン。レートは低いが壁越しに届く", en: "Slow, deep-penetrating carbine" },
    ammo: "medium", mag: 25, rpm: 540, modes: ["semi", "auto"], dmg: 4.4, head: 1.8, range: [28, 60], falloff: 0.6, ap: 0.35,
    spread: R(3.0, 0.45, 1.6, 0.35, 3.6, 0.36), recoil: { v: 1.1, h: 0.5, shake: 0.03 },
    reload: { tac: 34, empty: 46 }, ads: 4, move: 0.99, pen: 4, sound: "rifle", pitch: 0.95, optic: "iron",
    slots: ["optic", "muzzle", "underbarrel", "mag", "laser", "stock"],
    model: { type: "rifle", body: 12, h: 4, barrel: 7, guard: 6, mag: "straight", stock: "wire", finish: "arctic", accent: "tier" },
  },
};
