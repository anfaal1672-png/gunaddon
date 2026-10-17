// ARSENAL CORE データ定義（tools/data/）。ランタイムにはビルド時に 1 ファイル（BP/scripts/config/weapons.data.js）へまとめて出力する。
// 光学・アタッチメント

// ---------------------------------------------------------------------------
//  光学サイト（ADS 時の FOV）。FOV はゲームの制約上 30〜110。
// ---------------------------------------------------------------------------
export const OPTICS = {
  iron: { fov: 62, adsSpread: 1.0, adsTime: 0, zoomBoost: 0, name: { ja: "アイアンサイト", en: "Iron Sights" } },
  reddot: { fov: 58, adsSpread: 0.9, adsTime: 0, zoomBoost: 0, name: { ja: "ドットサイト", en: "Red Dot" } },
  holo: { fov: 56, adsSpread: 0.85, adsTime: 0, zoomBoost: 0, name: { ja: "ホロサイト", en: "Holographic" } },
  scope2: { fov: 44, adsSpread: 0.8, adsTime: 1, zoomBoost: 0, name: { ja: "2倍スコープ", en: "2x Scope" } },
  scope4: { fov: 33, adsSpread: 0.7, adsTime: 2, zoomBoost: 0, name: { ja: "4倍スコープ", en: "4x Scope" } },
  scope8: { fov: 30, adsSpread: 0.6, adsTime: 3, zoomBoost: 2, name: { ja: "8倍スコープ", en: "8x Scope" } },
  thermal: { fov: 44, adsSpread: 0.8, adsTime: 2, zoomBoost: 0, name: { ja: "サーマル", en: "Thermal" }, nightVision: true },
  // ---- 2.0 で追加 ----
  scope3: { fov: 38, adsSpread: 0.75, adsTime: 1, zoomBoost: 0, name: { ja: "3倍プリズム", en: "3x Prism" } },
  scope12: { fov: 30, adsSpread: 0.5, adsTime: 4, zoomBoost: 3, name: { ja: "12倍スコープ", en: "12x Scope" } },
  variable: { fov: 58, altFov: 34, adsSpread: 0.75, adsTime: 2, zoomBoost: 0, name: { ja: "可変倍率（1〜6倍）", en: "Variable 1-6x" }, variable: true },
  nvscope: { fov: 40, adsSpread: 0.8, adsTime: 2, zoomBoost: 0, name: { ja: "暗視スコープ", en: "Night Vision Scope" }, nightVision: true },
  rangefinder: { fov: 33, adsSpread: 0.7, adsTime: 2, zoomBoost: 0, name: { ja: "測距スコープ", en: "Rangefinder Scope" }, rangefinder: true },
};

/** 光学の見た目グループ（3D モデル）：0 = アイアン、1 = ドット系、2 = 倍率スコープ系 */
export const OPTIC_GROUP = { iron: 0, reddot: 1, holo: 1, scope2: 2, scope3: 2, scope4: 2, scope8: 2, scope12: 2, thermal: 2, variable: 2, nvscope: 2, rangefinder: 2 };
/** 倍率スコープ（覗くと銃を下ろして全画面のスコープを出す）。可変倍率は高倍率側のときだけ */
export const SCOPED = ["scope2", "scope3", "scope4", "scope8", "scope12", "thermal", "nvscope", "rangefinder"];
/** 全画面表示の種類（HUD の S フィールド）：1 = 2 倍型、2 = 4 倍型、3 = 8 倍型、4 = 暗視型、5 = ドット、6 = ホロ */
export const OPTIC_OVERLAY = { scope2: "1", scope3: "1", scope4: "2", rangefinder: "2", scope8: "3", scope12: "3", thermal: "4", nvscope: "4", reddot: "5", holo: "6" };

// ---------------------------------------------------------------------------
//  アタッチメント
//  mods の意味：
//   recoilV / recoilH / hipSpread / adsSpread / reload / range / move … 倍率
//   adsTime … 加算（tick）、mag … 倍率（切り上げ）、fov … 光学の上書き
//   sound "suppressed" … 消音、flash false … マズルフラッシュ無効、tracer false … 曳光非表示
// ---------------------------------------------------------------------------
export const ATTACHMENT_SLOTS = {
  optic: { name: { ja: "光学", en: "Optic" } },
  muzzle: { name: { ja: "銃口", en: "Muzzle" } },
  underbarrel: { name: { ja: "アンダーバレル", en: "Underbarrel" } },
  mag: { name: { ja: "マガジン", en: "Magazine" } },
  laser: { name: { ja: "レーザー／ライト／サイド", en: "Laser / Light / Side" } },
  stock: { name: { ja: "ストック", en: "Stock" } },
  // ---- 2.0 で追加 ----
  barrel: { name: { ja: "銃身", en: "Barrel" } },
  trigger: { name: { ja: "トリガー", en: "Trigger" } },
  ammo: { name: { ja: "弾薬改造", en: "Ammo Mod" } },
};

export const ATTACHMENTS = {
  optic_reddot: { slot: "optic", tier: "common", optic: "reddot", name: { ja: "ドットサイト", en: "Red Dot Sight" }, desc: { ja: "素早く狙える等倍サイト", en: "Fast 1x sight" }, mods: {} },
  optic_holo: { slot: "optic", tier: "common", optic: "holo", name: { ja: "ホロサイト", en: "Holographic Sight" }, desc: { ja: "視界が広く ADS が速い", en: "Wide view, faster ADS" }, mods: { adsTime: -1 } },
  optic_2x: { slot: "optic", tier: "uncommon", optic: "scope2", name: { ja: "2倍スコープ", en: "2x Scope" }, desc: { ja: "中距離向けの低倍率", en: "Mid-range magnification" }, mods: {} },
  optic_4x: { slot: "optic", tier: "uncommon", optic: "scope4", name: { ja: "4倍スコープ", en: "4x Scope" }, desc: { ja: "遠距離の精密射撃", en: "Long-range precision" }, mods: {}, only: ["assault", "battle", "dmr", "sniper", "lmg", "special"] },
  optic_8x: { slot: "optic", tier: "rare", optic: "scope8", name: { ja: "8倍スコープ", en: "8x Scope" }, desc: { ja: "超遠距離。ADS 中にジャンプで息止め", en: "Extreme range. Jump while aiming to hold breath" }, mods: {}, only: ["battle", "dmr", "sniper", "special"] },
  optic_thermal: { slot: "optic", tier: "rare", optic: "thermal", name: { ja: "サーマルスコープ", en: "Thermal Scope" }, desc: { ja: "ADS 中に暗視を得る", en: "Grants night vision while aiming" }, mods: {} },
  muzzle_suppressor: { slot: "muzzle", tier: "uncommon", name: { ja: "サプレッサー", en: "Suppressor" }, desc: { ja: "銃声と閃光を抑える。射程 -10%", en: "Quiet, no flash. Range -10%" }, mods: { sound: "suppressed", flash: false, tracer: false, range: 0.9 } },
  muzzle_compensator: { slot: "muzzle", tier: "common", name: { ja: "コンペンセイター", en: "Compensator" }, desc: { ja: "縦反動 -25%", en: "Vertical recoil -25%" }, mods: { recoilV: 0.75 } },
  muzzle_brake: { slot: "muzzle", tier: "uncommon", name: { ja: "マズルブレーキ", en: "Muzzle Brake" }, desc: { ja: "横反動 -40%、縦反動 -10%", en: "Horizontal recoil -40%, vertical -10%" }, mods: { recoilH: 0.6, recoilV: 0.9 } },
  muzzle_flash_hider: { slot: "muzzle", tier: "common", name: { ja: "フラッシュハイダー", en: "Flash Hider" }, desc: { ja: "閃光を消し、縦反動 -8%", en: "No muzzle flash, vertical recoil -8%" }, mods: { flash: false, recoilV: 0.92 } },
  muzzle_choke: { slot: "muzzle", tier: "common", name: { ja: "チョーク", en: "Choke" }, desc: { ja: "散弾の集弾性 +40%", en: "Pellet spread -40%" }, mods: { pelletSpread: 0.6 }, only: ["shotgun"] },
  grip_vertical: { slot: "underbarrel", tier: "common", name: { ja: "バーティカルグリップ", en: "Vertical Grip" }, desc: { ja: "縦反動 -20%", en: "Vertical recoil -20%" }, mods: { recoilV: 0.8 } },
  grip_angled: { slot: "underbarrel", tier: "common", name: { ja: "アングルグリップ", en: "Angled Grip" }, desc: { ja: "ADS 高速化、反動 -10%", en: "Faster ADS, recoil -10%" }, mods: { adsTime: -1, recoilV: 0.9, recoilH: 0.85 } },
  bipod: { slot: "underbarrel", tier: "uncommon", name: { ja: "バイポッド", en: "Bipod" }, desc: { ja: "スニーク中は反動 -65%・拡散 -50%", en: "While sneaking: recoil -65%, spread -50%" }, mods: { bipod: true, adsTime: 1 } },
  ub_launcher: { slot: "underbarrel", tier: "rare", name: { ja: "UB グレネードランチャー", en: "UB Grenade Launcher" }, desc: { ja: "モード切替で 40mm を発射", en: "Switch mode to fire 40mm" }, mods: { underbarrel: "launcher", move: 0.96 }, only: ["assault", "battle"] },
  ub_shotgun: { slot: "underbarrel", tier: "rare", name: { ja: "UB ショットガン", en: "UB Shotgun" }, desc: { ja: "モード切替で 3 発装填の散弾銃", en: "Switch mode for a 3-shell shotgun" }, mods: { underbarrel: "shotgun", move: 0.97 }, only: ["assault", "battle"] },
  mag_extended: { slot: "mag", tier: "common", name: { ja: "拡張マガジン", en: "Extended Mag" }, desc: { ja: "装弾数 +50%、リロード +10%", en: "Capacity +50%, reload +10%" }, mods: { mag: 1.5, reload: 1.1 } },
  mag_drum: { slot: "mag", tier: "uncommon", name: { ja: "ドラムマガジン", en: "Drum Mag" }, desc: { ja: "装弾数 +120%、リロード +40%、移動 -5%", en: "Capacity +120%, reload +40%, move -5%" }, mods: { mag: 2.2, reload: 1.4, move: 0.95 }, only: ["smg", "assault", "lmg", "shotgun"] },
  mag_quick: { slot: "mag", tier: "uncommon", name: { ja: "クイックマグ", en: "Quick Mag" }, desc: { ja: "リロード -30%", en: "Reload -30%" }, mods: { reload: 0.7 } },
  laser_tactical: { slot: "laser", tier: "common", name: { ja: "タクティカルレーザー", en: "Tactical Laser" }, desc: { ja: "腰だめ拡散 -40%。照準点を表示", en: "Hip spread -40%. Shows a laser dot" }, mods: { hipSpread: 0.6, laser: true } },
  flashlight: { slot: "laser", tier: "common", name: { ja: "フラッシュライト", en: "Flashlight" }, desc: { ja: "照準先を照らす（設定で ON/OFF）", en: "Lights up where you aim (toggle in settings)" }, mods: { flashlight: true } },
  stock_light: { slot: "stock", tier: "common", name: { ja: "軽量ストック", en: "Light Stock" }, desc: { ja: "ADS 高速化、移動 +3%、反動 +10%", en: "Faster ADS, move +3%, recoil +10%" }, mods: { adsTime: -1, move: 1.03, recoilV: 1.1 } },
  stock_heavy: { slot: "stock", tier: "uncommon", name: { ja: "重量ストック", en: "Heavy Stock" }, desc: { ja: "反動 -20%、ADS 低速化、移動 -3%", en: "Recoil -20%, slower ADS, move -3%" }, mods: { recoilV: 0.8, recoilH: 0.8, adsTime: 1, move: 0.97 } },

  // ======================= 2.0 で追加 =======================
  // 光学
  optic_prism3: { slot: "optic", tier: "uncommon", optic: "scope3", name: { ja: "3倍プリズムサイト", en: "3x Prism Sight" }, desc: { ja: "中距離向け。小型で ADS が速い", en: "Compact mid-range optic" }, mods: {} },
  optic_12x: { slot: "optic", tier: "rare", optic: "scope12", name: { ja: "12倍スコープ", en: "12x Scope" }, desc: { ja: "最大倍率。ADS は遅い", en: "Maximum zoom. Slow to aim" }, mods: {}, only: ["dmr", "sniper", "special"] },
  optic_variable: { slot: "optic", tier: "rare", optic: "variable", name: { ja: "可変倍率スコープ", en: "Variable Scope" }, desc: { ja: "ADS 中にジャンプで 1 倍 ⇔ 6 倍を切り替え", en: "Jump while aiming to switch 1x / 6x" }, mods: {}, only: ["carbine", "assault", "battle", "dmr", "lmg", "heavy", "special"] },
  optic_nv: { slot: "optic", tier: "rare", optic: "nvscope", name: { ja: "暗視スコープ", en: "Night Vision Scope" }, desc: { ja: "ADS 中に暗視。4 倍相当", en: "Night vision while aiming. ~4x" }, mods: {} },
  optic_rangefinder: { slot: "optic", tier: "uncommon", optic: "rangefinder", name: { ja: "測距スコープ", en: "Rangefinder Scope" }, desc: { ja: "ADS 中に狙った地点までの距離を表示", en: "Shows distance to target while aiming" }, mods: {}, only: ["battle", "dmr", "sniper", "lmg", "heavy", "special"] },
  // サイドレール（レーザー枠）
  side_canted: { slot: "laser", tier: "uncommon", name: { ja: "キャンテッドアイアン", en: "Canted Irons" }, desc: { ja: "ADS 中にジャンプで斜め付けのアイアンサイトに持ち替え", en: "Jump while aiming to roll to 45° iron sights" }, mods: { canted: true } },
  laser_combo: { slot: "laser", tier: "uncommon", name: { ja: "ライト＋レーザー複合", en: "Light + Laser Combo" }, desc: { ja: "腰だめ拡散 -30% と照射ライト", en: "Hip spread -30% plus a flashlight" }, mods: { hipSpread: 0.7, laser: true, flashlight: true } },
  // 銃口
  muzzle_suppressor_light: { slot: "muzzle", tier: "common", name: { ja: "軽量サプレッサー", en: "Light Suppressor" }, desc: { ja: "消音。射程 -5% だけで済む", en: "Suppressed. Only -5% range" }, mods: { sound: "suppressed", flash: false, tracer: false, range: 0.95 } },
  muzzle_suppressor_heavy: { slot: "muzzle", tier: "rare", name: { ja: "重サプレッサー", en: "Heavy Suppressor" }, desc: { ja: "消音。縦反動 -15%、射程 -12%、ADS 低速化", en: "Suppressed. Recoil -15%, range -12%, slower ADS" }, mods: { sound: "suppressed", flash: false, tracer: false, range: 0.88, recoilV: 0.85, adsTime: 1 } },
  muzzle_flash_cone: { slot: "muzzle", tier: "common", name: { ja: "フラッシュコーン", en: "Flash Cone" }, desc: { ja: "閃光を消し、腰だめ拡散 -10%", en: "No flash, hip spread -10%" }, mods: { flash: false, hipSpread: 0.9 } },
  muzzle_duckbill: { slot: "muzzle", tier: "uncommon", name: { ja: "ダックビル", en: "Duckbill" }, desc: { ja: "散弾を横一列に広げる", en: "Spreads pellets in a horizontal line" }, mods: { pelletFlat: true }, only: ["shotgun"] },
  muzzle_bayonet: { slot: "muzzle", tier: "common", name: { ja: "銃剣", en: "Bayonet" }, desc: { ja: "銃床打撃が +6 ダメージの刺突になる。移動 -2%", en: "Melee becomes a +6 stab. Move -2%" }, mods: { meleeDmg: 6, move: 0.98 }, only: ["carbine", "assault", "battle", "dmr", "shotgun"] },
  // 銃身
  barrel_long: { slot: "barrel", tier: "uncommon", name: { ja: "ロングバレル", en: "Long Barrel" }, desc: { ja: "射程 +20%、ADS 拡散 -10%、ADS 低速化", en: "Range +20%, ADS spread -10%, slower ADS" }, mods: { range: 1.2, adsSpread: 0.9, adsTime: 1, move: 0.98 } },
  barrel_short: { slot: "barrel", tier: "common", name: { ja: "ショートバレル", en: "Short Barrel" }, desc: { ja: "ADS 高速化、腰だめ拡散 -15%、射程 -15%", en: "Faster ADS, hip spread -15%, range -15%" }, mods: { range: 0.85, hipSpread: 0.85, adsTime: -1, move: 1.02 } },
  barrel_heavy: { slot: "barrel", tier: "uncommon", name: { ja: "ヘビーバレル", en: "Heavy Barrel" }, desc: { ja: "縦反動 -15%、連射の広がり -20%、移動 -4%", en: "Recoil -15%, bloom -20%, move -4%" }, mods: { recoilV: 0.85, bloom: 0.8, move: 0.96 } },
  barrel_fluted: { slot: "barrel", tier: "rare", name: { ja: "フルートバレル", en: "Fluted Barrel" }, desc: { ja: "軽量化で ADS 高速化・移動 +2%・横反動 -10%", en: "Lighter: faster ADS, move +2%, horizontal recoil -10%" }, mods: { adsTime: -1, move: 1.02, recoilH: 0.9, heatCool: 1.25 } },
  // アンダーバレル
  ub_flamer: { slot: "underbarrel", tier: "rare", name: { ja: "UB 火炎放射器", en: "UB Flamethrower" }, desc: { ja: "モード切替で短射程の火炎を放つ（燃料を使う）", en: "Switch mode for a short flame burst (uses fuel)" }, mods: { underbarrel: "flamer", move: 0.97 }, only: ["carbine", "assault", "battle"] },
  ub_grapple: { slot: "underbarrel", tier: "uncommon", name: { ja: "UB グラップル", en: "UB Grapple" }, desc: { ja: "モード切替でフックを撃ち込む", en: "Switch mode to fire a grappling hook" }, mods: { underbarrel: "grapple" }, only: ["smg", "carbine", "assault"] },
  // マガジン
  mag_dual: { slot: "mag", tier: "common", name: { ja: "テープ留め二連マガジン", en: "Taped Dual Mag" }, desc: { ja: "2 回に 1 回のリロードが 45% 速くなる", en: "Every other reload is 45% faster" }, mods: { dualMag: true } },
  mag_belt: { slot: "mag", tier: "rare", name: { ja: "大容量ベルト", en: "Extended Belt" }, desc: { ja: "装弾数 +150%、リロード +60%、移動 -4%", en: "Capacity +150%, reload +60%, move -4%" }, mods: { mag: 2.5, reload: 1.6, move: 0.96 }, only: ["lmg", "heavy"] },
  // ストック
  stock_folding: { slot: "stock", tier: "common", name: { ja: "折りたたみストック", en: "Folding Stock" }, desc: { ja: "移動 +4%、ADS 高速化、縦反動 +15%", en: "Move +4%, faster ADS, recoil +15%" }, mods: { move: 1.04, adsTime: -1, recoilV: 1.15 } },
  stock_skeleton: { slot: "stock", tier: "uncommon", name: { ja: "スケルトンストック", en: "Skeleton Stock" }, desc: { ja: "ADS 高速化、移動 +2%、縦反動 +5%", en: "Faster ADS, move +2%, recoil +5%" }, mods: { adsTime: -1, move: 1.02, recoilV: 1.05 } },
  stock_cheek: { slot: "stock", tier: "uncommon", name: { ja: "チークライザー", en: "Cheek Riser" }, desc: { ja: "ADS 拡散 -20%、ADS 低速化", en: "ADS spread -20%, slower ADS" }, mods: { adsSpread: 0.8, adsTime: 1 } },
  // トリガー
  trigger_hair: { slot: "trigger", tier: "common", name: { ja: "ヘアトリガー", en: "Hair Trigger" }, desc: { ja: "セミオート・バーストの連射上限 +25%", en: "Semi/burst fire rate cap +25%" }, mods: { semiRate: 1.25, hipSpread: 1.05 } },
  trigger_match: { slot: "trigger", tier: "uncommon", name: { ja: "マッチトリガー", en: "Match Trigger" }, desc: { ja: "ADS 拡散 -25%、連射の広がり +10%", en: "ADS spread -25%, bloom +10%" }, mods: { adsSpread: 0.75, bloom: 1.1 } },
  trigger_rapid: { slot: "trigger", tier: "rare", name: { ja: "ラピッドファイアキット", en: "Rapid-Fire Kit" }, desc: { ja: "連射速度 +10%、反動 +10%、連射の広がり +15%", en: "Fire rate +10%, recoil +10%, bloom +15%" }, mods: { rpm: 1.1, recoilV: 1.1, bloom: 1.15 } },
  // 弾薬改造
  ammo_hollow: { slot: "ammo", tier: "common", name: { ja: "ホローポイント", en: "Hollow Point" }, desc: { ja: "防具なしに +20%、防具ありに -30%、貫通 -1", en: "+20% vs unarmored, -30% vs armored, pen -1" }, mods: { vsUnarmored: 1.2, vsArmored: 0.7, penAdd: -1 } },
  ammo_subsonic: { slot: "ammo", tier: "uncommon", name: { ja: "亜音速弾", en: "Subsonic" }, desc: { ja: "弾の破裂音が消え、サプレッサーと組むと遠くに銃声が届かない。射程 -10%", en: "No supersonic crack; with a suppressor nobody far hears you. Range -10%" }, mods: { subsonic: true, range: 0.9, dmg: 0.95 } },
  ammo_frangible: { slot: "ammo", tier: "uncommon", name: { ja: "フランジブル弾", en: "Frangible" }, desc: { ja: "貫通・跳弾なし。近距離のダメージ +10%", en: "No penetration or ricochet. +10% close-range damage" }, mods: { penSet: 0, noRicochet: true, dmg: 1.1, range: 0.8 } },
  ammo_explosive: { slot: "ammo", tier: "legendary", name: { ja: "炸裂弾", en: "Explosive Rounds" }, desc: { ja: "命中点で小さく炸裂する。ダメージ -20%", en: "Small blast on impact. Damage -20%" }, mods: { explosive: true, dmg: 0.8 } },

  // ======================= 2.3 で追加 =======================
  optic_micro: { slot: "optic", tier: "common", optic: "reddot", name: { ja: "マイクロドット", en: "Micro Dot" }, desc: { ja: "超小型のドットサイト。ADS が速く移動 +1%", en: "Tiny red dot. Faster ADS, move +1%" }, mods: { adsTime: -1, move: 1.01 }, only: ["handgun", "machine_pistol", "smg", "carbine", "shotgun"] },
  optic_thermal_compact: { slot: "optic", tier: "rare", optic: "thermal", name: { ja: "小型サーマル", en: "Compact Thermal" }, desc: { ja: "軽いサーマル。ADS が速いが ADS 拡散 +10%", en: "Light thermal. Faster ADS, ADS spread +10%" }, mods: { adsTime: -1, adsSpread: 1.1 } },
  muzzle_linear: { slot: "muzzle", tier: "uncommon", name: { ja: "リニアコンペンセイター", en: "Linear Compensator" }, desc: { ja: "爆風を前に流す。反動 -12%、閃光なし", en: "Pushes blast forward. Recoil -12%, no flash" }, mods: { recoilV: 0.88, recoilH: 0.88, flash: false } },
  muzzle_tank_brake: { slot: "muzzle", tier: "rare", name: { ja: "大型マズルブレーキ", en: "Tank Brake" }, desc: { ja: "縦反動 -30%、横反動 -20%、腰だめ拡散 +10%", en: "Vertical recoil -30%, horizontal -20%, hip spread +10%" }, mods: { recoilV: 0.7, recoilH: 0.8, hipSpread: 1.1 }, only: ["battle", "dmr", "sniper", "lmg", "heavy"] },
  grip_stubby: { slot: "underbarrel", tier: "common", name: { ja: "スタビーグリップ", en: "Stubby Grip" }, desc: { ja: "腰だめ拡散 -15%、横反動 -10%", en: "Hip spread -15%, horizontal recoil -10%" }, mods: { hipSpread: 0.85, recoilH: 0.9 } },
  grip_handstop: { slot: "underbarrel", tier: "common", name: { ja: "ハンドストップ", en: "Handstop" }, desc: { ja: "ADS 高速化、横反動 -10%", en: "Faster ADS, horizontal recoil -10%" }, mods: { adsTime: -1, recoilH: 0.9 } },
  grip_heavy: { slot: "underbarrel", tier: "uncommon", name: { ja: "ヘビーグリップ", en: "Heavy Grip" }, desc: { ja: "縦反動 -30%、ADS 低速化、移動 -3%", en: "Vertical recoil -30%, slower ADS, move -3%" }, mods: { recoilV: 0.7, adsTime: 1, move: 0.97 } },
  mag_polymer: { slot: "mag", tier: "common", name: { ja: "ポリマーマガジン", en: "Polymer Mag" }, desc: { ja: "装弾数 +20%、リロード -10%", en: "Capacity +20%, reload -10%" }, mods: { mag: 1.2, reload: 0.9 }, only: ["handgun", "machine_pistol", "smg", "carbine", "assault", "battle", "dmr"] },
  mag_casket: { slot: "mag", tier: "uncommon", name: { ja: "4 列マガジン", en: "Casket Mag" }, desc: { ja: "装弾数 +80%、リロード +25%、移動 -3%", en: "Capacity +80%, reload +25%, move -3%" }, mods: { mag: 1.8, reload: 1.25, move: 0.97 }, only: ["machine_pistol", "smg", "carbine", "assault"] },
  laser_ir: { slot: "laser", tier: "uncommon", name: { ja: "赤外線レーザー", en: "IR Laser" }, desc: { ja: "見えない光で腰だめ拡散 -25%（照準点は出ない）", en: "Invisible beam: hip spread -25% (no dot)" }, mods: { hipSpread: 0.75 } },
  stock_precision: { slot: "stock", tier: "rare", name: { ja: "精密ストック", en: "Precision Stock" }, desc: { ja: "ADS 拡散 -15%、縦反動 -10%、ADS 低速化", en: "ADS spread -15%, recoil -10%, slower ADS" }, mods: { adsSpread: 0.85, recoilV: 0.9, adsTime: 1, move: 0.98 }, only: ["battle", "dmr", "sniper"] },
  stock_none: { slot: "stock", tier: "common", name: { ja: "ストック取り外し", en: "No Stock" }, desc: { ja: "移動 +6%、ADS 大幅高速化、縦反動 +30%", en: "Move +6%, much faster ADS, recoil +30%" }, mods: { move: 1.06, adsTime: -2, recoilV: 1.3, hipSpread: 0.9 } },
  barrel_ported: { slot: "barrel", tier: "uncommon", name: { ja: "ポーテッドバレル", en: "Ported Barrel" }, desc: { ja: "反動 -12%、射程 -5%", en: "Recoil -12%, range -5%" }, mods: { recoilV: 0.88, recoilH: 0.9, range: 0.95 } },
  barrel_match: { slot: "barrel", tier: "rare", name: { ja: "マッチバレル", en: "Match Barrel" }, desc: { ja: "射程 +10%、ADS 拡散 -15%", en: "Range +10%, ADS spread -15%" }, mods: { range: 1.1, adsSpread: 0.85, move: 0.99 } },
  trigger_twostage: { slot: "trigger", tier: "uncommon", name: { ja: "二段トリガー", en: "Two-Stage Trigger" }, desc: { ja: "ADS 拡散 -15%、セミオートの連射上限 -10%", en: "ADS spread -15%, semi fire rate cap -10%" }, mods: { adsSpread: 0.85, semiRate: 0.9 } },
  ammo_ap_core: { slot: "ammo", tier: "rare", name: { ja: "徹甲芯弾", en: "AP Core" }, desc: { ja: "貫通 +1、防具ありに +15%、ダメージ -8%", en: "Pen +1, +15% vs armored, damage -8%" }, mods: { penAdd: 1, vsArmored: 1.15, dmg: 0.92 } },
  ammo_match: { slot: "ammo", tier: "uncommon", name: { ja: "マッチグレード弾", en: "Match Grade" }, desc: { ja: "ADS 拡散 -12%、射程 +8%", en: "ADS spread -12%, range +8%" }, mods: { adsSpread: 0.88, range: 1.08 } },
};
