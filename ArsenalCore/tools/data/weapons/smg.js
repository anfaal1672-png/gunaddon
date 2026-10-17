// ARSENAL CORE データ定義（tools/data/）。ランタイムにはビルド時に 1 ファイル（BP/scripts/config/weapons.data.js）へまとめて出力する。
import { R } from "./_util.js";

export const SMG = {
  hornet: {
    cat: "smg", tier: "uncommon", name: { ja: "ホーネット", en: "Hornet" },
    desc: { ja: "超高レートの SMG。弾をばら撒き至近距離を制圧する", en: "Ultra high fire-rate SMG" },
    ammo: "light", mag: 30, rpm: 1100, modes: ["auto", "semi"], dmg: 2.6, head: 1.5, range: [10, 28], falloff: 0.5,
    spread: R(3.0, 1.2, 1.2, 0.3, 4.5, 0.4), recoil: { v: 0.65, h: 0.95, shake: 0.02 },
    reload: { tac: 30, empty: 40 }, ads: 3, move: 1.08, pen: 1, sound: "smg", pitch: 1.25, optic: "iron",
    slots: ["optic", "muzzle", "underbarrel", "mag", "laser", "stock"],
    model: { type: "smg", body: 11, h: 3, barrel: 4, mag: "straight", stock: "wire", finish: "black", accent: "tier" },
  },
  mako: {
    cat: "smg", tier: "common", name: { ja: "マコ", en: "Mako" },
    desc: { ja: "素直な反動の万能 SMG。初めての 1 丁に", en: "Well-rounded, controllable SMG" },
    ammo: "light", mag: 30, rpm: 750, modes: ["auto", "semi"], dmg: 3.4, head: 1.6, range: [14, 32], falloff: 0.55,
    spread: R(2.6, 0.9, 1.2, 0.3, 3.5, 0.4), recoil: { v: 0.6, h: 0.5, shake: 0.02 },
    reload: { tac: 30, empty: 40 }, ads: 3, move: 1.06, pen: 1, sound: "smg", pitch: 1.1, optic: "iron",
    slots: ["optic", "muzzle", "underbarrel", "mag", "laser", "stock"],
    model: { type: "smg", body: 12, h: 3.5, barrel: 4, mag: "curved", stock: "fixed", finish: "black", accent: "tier" },
  },
  rattler: {
    cat: "smg", tier: "uncommon", name: { ja: "ラトラー", en: "Rattler" },
    desc: { ja: "低レート高威力。当て続ければ誰よりも早く倒せる", en: "Slow, hard-hitting SMG" },
    ammo: "light", mag: 25, rpm: 560, modes: ["auto", "semi"], dmg: 4.4, head: 1.7, range: [15, 34], falloff: 0.55,
    spread: R(2.6, 0.8, 1.2, 0.45, 3.8, 0.4), recoil: { v: 1.15, h: 0.7, shake: 0.03 },
    reload: { tac: 32, empty: 44 }, ads: 3, move: 1.05, pen: 1, sound: "smg_heavy", pitch: 0.95, optic: "iron",
    slots: ["optic", "muzzle", "underbarrel", "mag", "laser", "stock"],
    model: { type: "smg", body: 13, h: 3.5, barrel: 5, mag: "straight", stock: "wood", finish: "wood", accent: "tier" },
  },
  kestrel_pdw: {
    cat: "smg", tier: "rare", name: { ja: "ケストレル PDW", en: "Kestrel PDW" },
    desc: { ja: "高貫通弾を大容量で扱う PDW。防具越しにも通る", en: "Armor-piercing PDW" },
    ammo: "light", mag: 40, rpm: 820, modes: ["auto", "burst3", "semi"], burstRpm: 1000, burstDelay: 5, dmg: 3.2, head: 1.6, range: [18, 38], falloff: 0.6, ap: 0.35,
    spread: R(2.6, 0.8, 1.2, 0.3, 3.5, 0.4), recoil: { v: 0.75, h: 0.6, shake: 0.02 },
    reload: { tac: 32, empty: 42 }, ads: 3, move: 1.06, pen: 3, sound: "smg", pitch: 1.18, optic: "reddot",
    slots: ["optic", "muzzle", "mag", "laser", "stock"],
    model: { type: "smg", body: 13, h: 4, barrel: 3, mag: "top", stock: "fixed", finish: "arctic", accent: "tier", bullpup: true },
  },
  stinger: {
    cat: "smg", tier: "uncommon", name: { ja: "スティンガー", en: "Stinger" },
    desc: { ja: "腰だめ撃ちに特化した軽量 SMG。走りながら撃て", en: "Hip-fire specialist SMG" },
    ammo: "light", mag: 35, rpm: 900, modes: ["auto"], dmg: 3.0, head: 1.5, range: [10, 26], falloff: 0.5,
    spread: R(1.5, 1.1, 0.6, 0.25, 3.0, 0.45), recoil: { v: 0.6, h: 0.7, shake: 0.02 },
    reload: { tac: 28, empty: 36 }, ads: 2, move: 1.1, pen: 1, sound: "smg", pitch: 1.3, optic: "iron",
    slots: ["muzzle", "mag", "laser", "stock"],
    model: { type: "smg", body: 10, h: 3, barrel: 3, mag: "straight", stock: "none", finish: "od", accent: "tier", foregrip: true },
  },
  specter: {
    cat: "smg", tier: "rare", name: { ja: "スペクター", en: "Specter" },
    desc: { ja: "一体型サプレッサーを備えた静音 SMG。気付かれずに仕留める", en: "Integrally suppressed SMG" },
    ammo: "light", mag: 30, rpm: 800, modes: ["auto", "semi"], dmg: 3.1, head: 1.7, range: [14, 30], falloff: 0.55,
    spread: R(2.4, 0.8, 1.2, 0.3, 3.5, 0.4), recoil: { v: 0.55, h: 0.45, shake: 0.015 },
    reload: { tac: 30, empty: 40 }, ads: 3, move: 1.06, pen: 1, sound: "suppressed", pitch: 1.1, optic: "iron",
    slots: ["optic", "underbarrel", "mag", "laser", "stock"], fixed: { muzzle: "muzzle_suppressor" },
    model: { type: "smg", body: 12, h: 3.5, barrel: 0, mag: "straight", stock: "fixed", finish: "black", accent: "tier", intSuppressor: 9 },
  },
};
