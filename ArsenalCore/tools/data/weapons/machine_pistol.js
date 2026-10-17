// ARSENAL CORE データ定義（tools/data/）。ランタイムにはビルド時に 1 ファイル（BP/scripts/config/weapons.data.js）へまとめて出力する。
// マシンピストル（2.0 で追加）：拳銃サイズで連射できる近距離専用枠
import { R } from "./_util.js";

export const MACHINE_PISTOL = {
  midge: {
    cat: "machine_pistol", tier: "uncommon", name: { ja: "ミッジ", en: "Midge" },
    desc: { ja: "毎分 1300 発の超高レート。小さな弾倉を一瞬で吐き切る", en: "1300 RPM bullet hose with a tiny magazine" },
    ammo: "light", mag: 18, rpm: 1300, modes: ["auto", "semi"], dmg: 2.4, head: 1.5, range: [8, 22], falloff: 0.45,
    spread: R(3.4, 1.6, 1.6, 0.35, 5.0, 0.4), recoil: { v: 0.7, h: 1.1, shake: 0.02 },
    reload: { tac: 24, empty: 32 }, ads: 2, move: 1.07, pen: 1, sound: "smg", pitch: 1.35, optic: "iron",
    slots: ["optic", "muzzle", "laser", "mag"],
    model: { type: "pistol", slide: 9, h: 2.5, grip: "pistol", finish: "black", accent: "tier", extMag: true, stub: true },
  },
  clawstrike: {
    cat: "machine_pistol", tier: "uncommon", name: { ja: "クロウストライク", en: "Clawstrike" },
    desc: { ja: "2 点バーストの機関拳銃。1 回の引き金で 2 発を重ねる", en: "Two-round burst machine pistol" },
    ammo: "light", mag: 24, rpm: 900, burstRpm: 1200, burstDelay: 4, modes: ["burst2", "semi"], dmg: 3.6, head: 1.7, range: [12, 28], falloff: 0.55,
    spread: R(2.8, 0.9, 1.6, 0.4, 4.0, 0.35), recoil: { v: 0.9, h: 0.6, shake: 0.022 },
    reload: { tac: 26, empty: 34 }, ads: 3, move: 1.06, pen: 1, sound: "pistol", pitch: 1.2, optic: "iron",
    slots: ["optic", "muzzle", "laser", "mag", "stock"],
    model: { type: "pistol", slide: 10, h: 2.5, grip: "pistol", finish: "od", accent: "tier", compensator: true, stub: true },
  },
  cinder: {
    cat: "machine_pistol", tier: "rare", name: { ja: "シンダー", en: "Cinder" },
    desc: { ja: "焼夷弾専用に調整された機関拳銃。当たった敵を燃え上がらせる", en: "Tuned for incendiary rounds. Sets targets ablaze" },
    ammo: "light", defaultVariant: "inc", mag: 20, rpm: 950, modes: ["auto"], dmg: 2.8, head: 1.5, range: [10, 24], falloff: 0.5, fireSecs: 2,
    spread: R(3.2, 1.4, 1.6, 0.35, 5.0, 0.4), recoil: { v: 0.8, h: 0.9, shake: 0.02 },
    reload: { tac: 26, empty: 34 }, ads: 3, move: 1.06, pen: 0, sound: "smg", pitch: 1.15, optic: "iron",
    slots: ["optic", "muzzle", "laser", "mag"],
    model: { type: "pistol", slide: 10, h: 2.5, grip: "pistol", finish: "red", accent: "tier", extMag: true },
  },
  wisp: {
    cat: "machine_pistol", tier: "uncommon", name: { ja: "ウィスプ", en: "Wisp" },
    desc: { ja: "折りたたみストック付き。覗けば SMG 並みに安定する", en: "Folding stock makes it steady when aiming" },
    ammo: "light", mag: 25, rpm: 850, modes: ["auto", "semi"], dmg: 3.0, head: 1.6, range: [14, 30], falloff: 0.55, adsRecoil: 0.7,
    spread: R(3.0, 0.8, 1.4, 0.3, 4.0, 0.4), recoil: { v: 0.75, h: 0.55, shake: 0.02 },
    reload: { tac: 26, empty: 34 }, ads: 3, move: 1.06, pen: 1, sound: "smg", pitch: 1.25, optic: "iron",
    slots: ["optic", "muzzle", "laser", "mag", "stock"],
    model: { type: "pistol", slide: 9, h: 2.5, grip: "pistol", finish: "tan", accent: "tier", extMag: true, stub: true },
  },

  // ---- 2.3 で追加 ----
  hummingbird: {
    cat: "machine_pistol", tier: "rare", name: { ja: "ハミングバード", en: "Hummingbird" },
    desc: { ja: "毎分 1500 発。一瞬で弾倉が空になる至近距離の掃射器", en: "1500 rpm close-range hose" },
    ammo: "light", mag: 25, rpm: 1500, modes: ["auto"], dmg: 2.1, head: 1.5, range: [8, 20], falloff: 0.45,
    spread: R(3.8, 1.8, 1.6, 0.3, 5.5, 0.42), recoil: { v: 0.6, h: 1.3, shake: 0.02 },
    reload: { tac: 22, empty: 30 }, ads: 2, move: 1.07, pen: 1, sound: "smg", pitch: 1.45, optic: "iron",
    slots: ["optic", "muzzle", "laser", "mag"],
    model: { type: "pistol", slide: 9, h: 2.6, grip: "pistol", finish: "orange", accent: "tier", extMag: true, stub: true },
  },
  gadfly: {
    cat: "machine_pistol", tier: "uncommon", name: { ja: "ガドフライ", en: "Gadfly" },
    desc: { ja: "3 点バーストのマシンピストル。反動が素直", en: "Controllable 3-round burst machine pistol" },
    ammo: "light", mag: 21, rpm: 900, burstRpm: 1200, burstDelay: 6, modes: ["burst3", "semi"], dmg: 2.9, head: 1.6, range: [12, 26], falloff: 0.5,
    spread: R(3.0, 1.2, 1.5, 0.3, 4.2, 0.4), recoil: { v: 0.75, h: 0.6, shake: 0.02 },
    reload: { tac: 24, empty: 32 }, ads: 2, move: 1.06, pen: 1, sound: "smg", pitch: 1.3, optic: "iron",
    slots: ["optic", "muzzle", "laser", "mag"],
    model: { type: "pistol", slide: 10, h: 2.7, grip: "pistol", finish: "black", accent: "tier", extMag: true },
  },
};
