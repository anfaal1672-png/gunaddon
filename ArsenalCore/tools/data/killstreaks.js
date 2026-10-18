// ARSENAL CORE データ定義（tools/data/）。ランタイムにはビルド時に 1 ファイル（BP/scripts/config/weapons.data.js）へまとめて出力する。
// キルストリーク（2.0 で追加）
//  kills   … PvP／ゲームモードで必要な連続キル数（死ぬと 0 に戻る）
//  points  … PvE で必要なポイント（敵を倒すとその tier に応じて貯まる。使うと減る）
//  targeted … 使用時に着弾点を選ぶ（視線の先 160 ブロックまで）
//  camera  … 使用中に上空カメラへ切り替える（カメラ API が使えない場合は通常視点で上空から撃つ）

export const KILLSTREAKS = {
  recon: {
    name: { ja: "偵察", en: "Recon Sweep" }, desc: { ja: "半径 64 ブロックの敵を 20 秒間発光させる", en: "Reveals enemies within 64 blocks for 20s" },
    kills: 3, points: 60, radius: 64, seconds: 20, icon: "recon",
  },
  supply_drop: {
    name: { ja: "補給投下", en: "Supply Drop" }, desc: { ja: "視線の先に補給箱を落とす。弾薬・装備・たまにレア武器", en: "Drops a crate with ammo, gear and sometimes a rare gun" },
    kills: 4, points: 90, targeted: true, fallTicks: 80, icon: "crate", lootTier: "uncommon", bonusTier: "rare", bonusChance: 0.25,
  },
  turret_drop: {
    name: { ja: "砲台投下", en: "Sentry Drop" }, desc: { ja: "視線の先に 90 秒動くセンチネル砲台を落とす（弾は無限）", en: "Drops a sentry that runs for 90s with unlimited ammo" },
    kills: 5, points: 120, targeted: true, fallTicks: 60, seconds: 90, icon: "sentry",
  },
  airstrike: {
    name: { ja: "空爆", en: "Airstrike" }, desc: { ja: "視線の方向へ一直線に 8 発の爆撃", en: "Eight bombs walk along your line of sight" },
    kills: 6, points: 150, targeted: true, shots: 8, spacing: 4, power: 3.0, warn: 50, icon: "bomb",
  },
  emp_strike: {
    name: { ja: "EMP", en: "EMP Blast" }, desc: { ja: "半径 48 の敵の電子機器・ドローン・砲台・エネルギー兵器を 15 秒止める", en: "Disables enemy drones, turrets and energy weapons (48 blocks, 15s)" },
    kills: 7, points: 170, radius: 48, seconds: 15, icon: "emp",
  },
  // ---- 2.6 ----
  missile_strike: {
    name: { ja: "誘導ミサイル", en: "Guided Missile" }, desc: { ja: "上空から自分で操縦して落とすミサイル。向いた方へ曲がる。スニークで空中爆発", en: "Steer a missile down from the sky; it turns where you look. Sneak to airburst" },
    kills: 8, points: 200, camera: true, height: 80, power: 5.0, seconds: 12, icon: "missile",
  },
  nuke: {
    name: { ja: "核ミサイル", en: "Nuclear Missile" }, desc: { ja: "視線の先に 10 秒後、核弾頭の弾道ミサイルが落ちる（ワールド設定「核兵器」が必要）", en: "A nuclear ballistic missile hits the marked spot after 10s (needs the Nukes world setting)" },
    kills: 25, points: 800, targeted: true, warn: 200, height: 120, icon: "nuke", warhead: "tactical_nuke",
  },
  gunship: {
    name: { ja: "ガンシップ", en: "Gunship" }, desc: { ja: "上空から 30 秒間、機関砲で地上を撃つ", en: "30 seconds of cannon fire from above" },
    kills: 9, points: 220, camera: true, seconds: 30, height: 36, rpm: 300, damage: 10, blast: 1.6, icon: "gunship",
  },
};

/** PvE のポイント：敵の tier ごと */
export const STREAK_POINTS = { 1: 10, 2: 18, 3: 30, 4: 120 };
