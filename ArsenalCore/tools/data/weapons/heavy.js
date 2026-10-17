// ARSENAL CORE データ定義（tools/data/）。ランタイムにはビルド時に 1 ファイル（BP/scripts/config/weapons.data.js）へまとめて出力する。
// 重火器（2.0 で追加）：重機関銃・火炎放射器・自動擲弾銃・ベルト給弾 LMG
import { R } from "./_util.js";

export const HEAVY = {
  titan: {
    cat: "heavy", tier: "rare", name: { ja: "タイタン", en: "Titan" },
    desc: { ja: "重機関銃。立ったままでは暴れるが、据え撃ち（スニーク）で精密な弾幕になる", en: "Heavy machine gun. Wild standing, surgical when braced (sneak)" },
    ammo: "heavy", mag: 100, rpm: 520, modes: ["auto"], dmg: 6.0, head: 1.7, range: [44, 90], falloff: 0.62,
    spread: R(6.0, 1.4, 3.0, 0.45, 6.0, 0.25), recoil: { v: 2.2, h: 1.4, shake: 0.05 },
    reload: { tac: 120, empty: 140 }, ads: 9, move: 0.72, pen: 4, sound: "hmg", pitch: 1.0, optic: "iron",
    slots: ["optic", "laser"], fixed: { underbarrel: "bipod" },
    model: { type: "lmg", body: 18, h: 6, barrel: 16, guard: 0, mag: "belt_box", stock: "fixed", finish: "od", accent: "tier", bipodBuilt: true, shroud: true },
  },
  hellmouth: {
    cat: "heavy", tier: "rare", name: { ja: "ヘルマウス", en: "Hellmouth" },
    desc: { ja: "火炎放射器。押している間、7 ブロック先まで炎を浴びせ続ける", en: "Flamethrower. Hose fire up to 7 blocks while held" },
    ammo: "fuel", ammoPerItem: 50, mag: 100, rpm: 600, modes: ["auto"], dmg: 1.6, head: 1.0, range: [7, 8], falloff: 1.0, fireSecs: 5,
    spread: R(0.0, 0.0, 0.0, 0, 0, 0.4), recoil: { v: 0.05, h: 0.05, shake: 0.005 },
    reload: { tac: 60, empty: 60 }, ads: 4, move: 0.88, pen: 0, sound: "flamer", pitch: 1.0, optic: "iron",
    fire: "flame",
    slots: [],
    model: { type: "flamer", body: 14, h: 4, barrel: 10, finish: "red", accent: "tier" },
  },
  hammerfall: {
    cat: "heavy", tier: "rare", name: { ja: "ハンマーフォール", en: "Hammerfall" },
    desc: { ja: "自動擲弾銃。40mm を連射して一帯を耕す", en: "Automatic grenade launcher" },
    ammo: "gl40", mag: 12, rpm: 180, modes: ["auto"], dmg: 5.0, head: 1.0, range: [70, 90], falloff: 1.0,
    spread: R(2.2, 0.9, 1.4, 0.35, 3.0, 0.35), recoil: { v: 3.2, h: 0.9, shake: 0.07 },
    reload: { tac: 90, empty: 100 }, ads: 6, move: 0.82, pen: 0, sound: "launcher", pitch: 1.1, optic: "iron",
    fire: "gl40", projectile: { speed: 1.7, gravity: 0.045, power: 2.0, arm: 0.5 },
    slots: ["optic", "laser"],
    model: { type: "launcher", body: 11, h: 4, barrel: 8, bore: 3, cylinder: true, stock: "fixed", finish: "od", accent: "tier" },
  },
  rampart: {
    cat: "heavy", tier: "uncommon", name: { ja: "ランパート", en: "Rampart" },
    desc: { ja: "150 発ベルト給弾の LMG。陣地を守り切る持久力", en: "150-round belt-fed LMG" },
    ammo: "medium", mag: 150, rpm: 700, modes: ["auto"], dmg: 3.9, head: 1.6, range: [30, 66], falloff: 0.58,
    spread: R(4.8, 1.0, 2.4, 0.26, 5.0, 0.27), recoil: { v: 1.2, h: 1.0, shake: 0.03 },
    reload: { tac: 100, empty: 120 }, ads: 7, move: 0.82, pen: 2, sound: "lmg", pitch: 1.05, optic: "iron",
    slots: ["optic", "muzzle", "underbarrel", "laser", "stock"],
    model: { type: "lmg", body: 15, h: 5, barrel: 11, guard: 7, mag: "belt_box", stock: "skeleton", finish: "tan", accent: "tier" },
  },
  sawtooth: {
    cat: "heavy", tier: "rare", name: { ja: "ソウトゥース", en: "Sawtooth" },
    desc: { ja: "チェーン給弾の高速機関銃。200 発を吐き出すが過熱に注意", en: "Chain-fed 200-round gun. Watch the heat" },
    ammo: "medium", mag: 200, rpm: 950, modes: ["auto"], dmg: 3.4, head: 1.5, range: [26, 56], falloff: 0.55,
    spread: R(5.2, 1.6, 2.4, 0.2, 5.0, 0.28), recoil: { v: 0.9, h: 1.1, shake: 0.03 },
    reload: { tac: 120, empty: 140 }, ads: 8, move: 0.78, pen: 2, sound: "lmg", pitch: 0.95, optic: "iron",
    heat: { perShot: 0.55, cool: 1.2, lockout: 50 },
    slots: ["optic", "laser"],
    model: { type: "lmg", body: 16, h: 5.5, barrel: 12, guard: 8, mag: "belt_box", stock: "fixed", finish: "black", accent: "tier", shroud: true },
  },

  // ---- 2.3 で追加 ----
  avalanche: {
    cat: "heavy", tier: "legendary", name: { ja: "アバランチ", en: "Avalanche" },
    desc: { ja: "回転銃身の手持ち機関砲。回り始めると止まらない", en: "Hand-held rotary cannon. Unstoppable once spun up" },
    ammo: "medium", mag: 250, rpm: 1600, modes: ["auto"], spinup: 20, dmg: 2.7, head: 1.4, range: [24, 54], falloff: 0.55,
    spread: R(5.8, 2.6, 2.4, 0.12, 5.0, 0.3), recoil: { v: 0.5, h: 1.2, shake: 0.035 },
    reload: { tac: 140, empty: 160 }, ads: 10, move: 0.7, pen: 2, sound: "rotary", pitch: 0.9, optic: "iron",
    slots: ["laser", "trigger", "ammo"],
    model: { type: "rotary", body: 16, h: 6.5, barrel: 16, mag: "belt", stock: "none", finish: "black", accent: "tier" },
  },
};
