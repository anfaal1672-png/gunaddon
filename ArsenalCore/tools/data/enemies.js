// ARSENAL CORE データ定義（tools/data/）。ランタイムにはビルド時に 1 ファイル（BP/scripts/config/weapons.data.js）へまとめて出力する。
// 敵（勢力・敵・ボス・スポーン）
//
// 共通の項目
//  faction   … "raiders" | "legion" | "hollow" | "crow"（3.0）
//  role      … 戦術 AI の役割。"rifle"（撃ち合い）| "sniper"（遠距離に留まる）| "heavy"（制圧射撃）| "leader"（隊長。目標と号令）
//              | "medic"（味方を回復）| "demo"（手榴弾・ロケット）| "melee"（突撃）| "shield"（盾で前進）| "mortar"（間接射撃）
//              | "drone"（飛行・偵察）| "bomber"（接近して自爆）
//  weapon    … 撃つ武器（WEAPONS の ID）。見た目とダメージの基準になる。近接の敵は null
//  damage    … 1 発のダメージ（難易度・ワールド設定の倍率がかかる前）
//  interval  … 攻撃間隔 [最短, 最長]（秒）/ burst … 1 回の攻撃で撃つ弾数 / burstInterval … 連射の間隔（秒）
//  range     … 交戦距離 / sight … 発見距離（ギリースーツでスニーク静止中の相手には 35% になる）
//  armor     … 被弾時の軽減（0〜0.6）。防具を無視する武器（ap）は軽減を下げる
//  model     … 見た目（"raider" | "dog" | "robot" | "shield_bot" | "mortar_bot" | "drone" | "hollow" | "bloater" | "brute"）
//  skin      … テクスチャの作り方（勢力ごとの関数に渡す）
//  spawn     … 自然発生（null なら構造物・召喚・ゲームモードだけ）

export const FACTIONS = {
  raiders: { name: { ja: "レイダーズ", en: "Raiders" }, color: [150, 70, 50], setting: "raiders", family: "arsenal_raider" },
  legion: { name: { ja: "アイアン・レギオン", en: "Iron Legion" }, color: [90, 110, 140], setting: "legion", family: "arsenal_legion" },
  hollow: { name: { ja: "ホロウ", en: "The Hollow" }, color: [110, 140, 80], setting: "hollow", family: "arsenal_hollow" },
  crow: { name: { ja: "ブラッククロウ", en: "Black Crow" }, color: [60, 70, 90], setting: "crow", family: "arsenal_crow" },
};

const RAIDER_BIOMES = ["plains", "desert", "mesa", "savanna"];

// ---------------------------------------------------------------------------
//  レイダーズ（銃を持つ敵勢力）。1.0 系の 5 種は ID と数値を変えない
// ---------------------------------------------------------------------------
export const RAIDERS = {
  raider_gunner: { name: { ja: "レイダー・ガンナー", en: "Raider Gunner" }, weapon: "vx9", health: 22, speed: 0.33, damage: 3, interval: [0.9, 1.4], burst: 1, burstInterval: 0, range: 16, armor: "cloth", color: [120, 96, 70] },
  raider_rifleman: { name: { ja: "レイダー・ライフルマン", en: "Raider Rifleman" }, weapon: "sentinel", health: 26, speed: 0.32, damage: 2.5, interval: [1.6, 2.4], burst: 3, burstInterval: 0.1, range: 22, armor: "vest", color: [84, 96, 70] },
  raider_sniper: { name: { ja: "レイダー・スナイパー", en: "Raider Sniper" }, weapon: "nightjar", health: 20, speed: 0.3, damage: 9, interval: [3.5, 4.5], burst: 1, burstInterval: 0, range: 40, armor: "ghillie", color: [70, 90, 56] },
  raider_heavy: { name: { ja: "レイダー・ヘヴィ", en: "Raider Heavy" }, weapon: "juggernaut", health: 44, speed: 0.26, damage: 2, interval: [2.0, 2.8], burst: 8, burstInterval: 0.08, range: 20, armor: "heavy", color: [60, 60, 64] },
  raider_captain: { name: { ja: "レイダー・キャプテン", en: "Raider Captain" }, weapon: "bastion", health: 60, speed: 0.32, damage: 3.5, interval: [1.4, 2.0], burst: 4, burstInterval: 0.09, range: 24, armor: "captain", color: [120, 40, 40] },
  // ---- 2.0 で追加 ----
  raider_medic: { name: { ja: "レイダー・メディック", en: "Raider Medic" }, weapon: "hornet", health: 22, speed: 0.34, damage: 2, interval: [1.4, 2.0], burst: 3, burstInterval: 0.07, range: 16, armor: "medic", color: [196, 190, 176] },
  raider_demo: { name: { ja: "レイダー・爆破兵", en: "Raider Demolisher" }, weapon: "thumper", health: 28, speed: 0.3, damage: 6, interval: [3.0, 4.0], burst: 1, burstInterval: 0, range: 20, armor: "demo", color: [150, 110, 40] },
  raider_dog: { name: { ja: "レイダーの猟犬", en: "Raider Hound" }, weapon: null, health: 16, speed: 0.4, damage: 4, interval: [0.8, 1.0], burst: 1, burstInterval: 0, range: 2, armor: "dog", color: [92, 74, 58] },
  // ---- 2.3 で追加 ----
  raider_breacher: { name: { ja: "レイダー・ブリーチャー", en: "Raider Breacher" }, weapon: "bulldog", health: 30, speed: 0.34, damage: 7, interval: [1.2, 1.7], burst: 1, burstInterval: 0, range: 9, armor: "breacher", color: [72, 66, 60] },
  raider_scout: { name: { ja: "レイダー・スカウト", en: "Raider Scout" }, weapon: "lynx", health: 18, speed: 0.37, damage: 1.8, interval: [1.0, 1.5], burst: 5, burstInterval: 0.06, range: 18, armor: "scout", color: [150, 130, 96] },
  raider_marksman: { name: { ja: "レイダー・マークスマン", en: "Raider Marksman" }, weapon: "osprey", health: 22, speed: 0.31, damage: 6, interval: [2.2, 3.0], burst: 1, burstInterval: 0, range: 32, armor: "vest", color: [96, 104, 80] },
};

/** 1.0 系の 5 種の AI 上の役割と追加の値（RAIDERS の数値はそのまま） */
const RAIDER_EXTRA = {
  raider_gunner: { role: "rifle", sight: 24, armorValue: 0, model: "raider", tier: 1 },
  raider_rifleman: { role: "rifle", sight: 30, armorValue: 0.1, model: "raider", tier: 1 },
  raider_sniper: { role: "sniper", sight: 48, armorValue: 0, model: "raider", tier: 2 },
  raider_heavy: { role: "heavy", sight: 28, armorValue: 0.3, model: "raider", tier: 2 },
  raider_captain: { role: "leader", sight: 32, armorValue: 0.2, model: "raider", tier: 3 },
  raider_medic: { role: "medic", sight: 26, armorValue: 0.05, model: "raider", tier: 1, heal: 6, healCooldown: 120 },
  raider_demo: { role: "demo", sight: 28, armorValue: 0.15, model: "raider", tier: 2, grenade: "grenade_frag", grenadeCooldown: 160 },
  raider_dog: { role: "melee", sight: 20, armorValue: 0, model: "dog", tier: 1 },
  raider_breacher: { role: "rifle", sight: 22, armorValue: 0.2, model: "raider", tier: 2 },
  raider_scout: { role: "rifle", sight: 34, armorValue: 0, model: "raider", tier: 1 },
  raider_marksman: { role: "sniper", sight: 40, armorValue: 0.1, model: "raider", tier: 2 },
};

const RAIDER_SPAWN = {
  raider_gunner: { weight: 4, herd: [1, 3] },
  raider_rifleman: { weight: 3, herd: [1, 2] },
  raider_sniper: { weight: 2, herd: [1, 1] },
  raider_heavy: { weight: 1, herd: [1, 1] },
  raider_captain: { weight: 1, herd: [1, 1] },
  raider_medic: { weight: 2, herd: [1, 1] },
  raider_demo: { weight: 1, herd: [1, 1] },
  raider_dog: { weight: 2, herd: [1, 2] },
  raider_breacher: { weight: 2, herd: [1, 1] },
  raider_scout: { weight: 3, herd: [1, 2] },
  raider_marksman: { weight: 1, herd: [1, 1] },
};

// ---------------------------------------------------------------------------
//  アイアン・レギオン（機械）。研究所・山岳に出る
// ---------------------------------------------------------------------------
export const LEGION = {
  legion_drone: {
    name: { ja: "レギオン偵察ドローン", en: "Legion Scout Drone" }, weapon: "hornet", health: 14, speed: 0.3, damage: 1.5, interval: [1.2, 1.8], burst: 3, burstInterval: 0.08,
    range: 18, armor: "drone", color: [150, 160, 176], role: "drone", sight: 36, armorValue: 0.1, model: "drone", tier: 1, flying: true, spots: true,
  },
  legion_trooper: {
    name: { ja: "レギオン歩兵ロボット", en: "Legion Trooper" }, weapon: "pulse_rifle", health: 30, speed: 0.3, damage: 2.8, interval: [1.4, 2.0], burst: 3, burstInterval: 0.09,
    range: 24, armor: "trooper", color: [110, 120, 136], role: "rifle", sight: 30, armorValue: 0.25, model: "robot", tier: 1, energy: true,
  },
  legion_shield: {
    name: { ja: "レギオン・シールド兵", en: "Legion Bulwark" }, weapon: "mako", health: 40, speed: 0.26, damage: 2.2, interval: [1.4, 2.0], burst: 4, burstInterval: 0.07,
    range: 16, armor: "shield", color: [96, 104, 120], role: "shield", sight: 28, armorValue: 0.3, model: "shield_bot", tier: 2, frontBlock: 0.85,
  },
  legion_mortar: {
    name: { ja: "レギオン迫撃砲ロボ", en: "Legion Mortar Walker" }, weapon: "mortarman", health: 36, speed: 0.22, damage: 8, interval: [5.0, 6.5], burst: 1, burstInterval: 0,
    range: 48, armor: "mortar", color: [120, 110, 90], role: "mortar", sight: 56, armorValue: 0.35, model: "mortar_bot", tier: 3, minRange: 10,
  },
  // ---- 2.3 で追加 ----
  legion_lancer: {
    name: { ja: "レギオン・ランサー", en: "Legion Lancer" }, weapon: "railspike", health: 28, speed: 0.27, damage: 8, interval: [3.2, 4.2], burst: 1, burstInterval: 0,
    range: 44, armor: "lancer", color: [90, 100, 130], role: "sniper", sight: 52, armorValue: 0.25, model: "robot", tier: 2, energy: true,
  },
  legion_hunter: {
    name: { ja: "レギオン・ハンタードローン", en: "Legion Hunter Drone" }, weapon: "ion_carbine", health: 18, speed: 0.34, damage: 2.2, interval: [1.0, 1.5], burst: 4, burstInterval: 0.07,
    range: 22, armor: "hunter", color: [170, 90, 70], role: "drone", sight: 40, armorValue: 0.15, model: "drone", tier: 2, flying: true, spots: true, energy: true,
  },
};

// ---------------------------------------------------------------------------
//  ホロウ（変異体）。夜の地下・廃墟とホードモード
// ---------------------------------------------------------------------------
export const HOLLOW = {
  hollow_runner: {
    name: { ja: "ホロウ・ランナー", en: "Hollow Runner" }, weapon: null, health: 18, speed: 0.38, damage: 4, interval: [0.7, 0.9], burst: 1, burstInterval: 0,
    range: 2, armor: "runner", color: [120, 150, 90], role: "melee", sight: 28, armorValue: 0, model: "hollow", tier: 1,
  },
  hollow_bloater: {
    name: { ja: "ホロウ・ブローター", en: "Hollow Bloater" }, weapon: null, health: 20, speed: 0.3, damage: 14, interval: [1.0, 1.0], burst: 1, burstInterval: 0,
    range: 2.5, armor: "bloater", color: [150, 160, 70], role: "bomber", sight: 24, armorValue: 0, model: "bloater", tier: 2, blast: 3.5, fuse: 30,
  },
  hollow_brute: {
    name: { ja: "ホロウ・ブルート", en: "Hollow Brute" }, weapon: null, health: 70, speed: 0.27, damage: 9, interval: [1.4, 1.8], burst: 1, burstInterval: 0,
    range: 2.8, armor: "brute", color: [96, 110, 80], role: "melee", sight: 26, armorValue: 0.45, model: "brute", tier: 3, knockback: 1.2,
  },
  // ---- 2.3 で追加 ----
  hollow_crawler: {
    name: { ja: "ホロウ・クローラー", en: "Hollow Crawler" }, weapon: null, health: 12, speed: 0.42, damage: 3, interval: [0.6, 0.8], burst: 1, burstInterval: 0,
    range: 1.8, armor: "crawler", color: [100, 120, 84], role: "melee", sight: 24, armorValue: 0, model: "hollow", tier: 1, scale: 0.8,
  },
};

// ---------------------------------------------------------------------------
//  ブラッククロウ（3.0）：よく訓練された民間軍事会社の精鋭。夜の森・タイガ・ジャングルと自社の施設に出る
//   レイダーより硬く正確。少人数で動き、衛生兵と指揮官が隊を支える
// ---------------------------------------------------------------------------
export const CROW = {
  crow_operator: {
    name: { ja: "クロウ・オペレーター", en: "Crow Operator" }, weapon: "starling", health: 30, speed: 0.33, damage: 3.0, interval: [1.2, 1.8], burst: 3, burstInterval: 0.08,
    range: 26, armor: "crow", color: [44, 48, 56], role: "rifle", sight: 34, armorValue: 0.15, model: "raider", tier: 1,
  },
  crow_breacher: {
    name: { ja: "クロウ・ブリーチャー", en: "Crow Breacher" }, weapon: "blackwing", health: 34, speed: 0.35, damage: 6.5, interval: [1.0, 1.5], burst: 1, burstInterval: 0,
    range: 10, armor: "crow_breacher", color: [40, 42, 48], role: "rifle", sight: 24, armorValue: 0.25, model: "raider", tier: 2,
  },
  crow_marksman: {
    name: { ja: "クロウ・マークスマン", en: "Crow Marksman" }, weapon: "kingfisher", health: 24, speed: 0.3, damage: 10, interval: [3.0, 4.0], burst: 1, burstInterval: 0,
    range: 44, armor: "crow_sniper", color: [48, 54, 50], role: "sniper", sight: 52, armorValue: 0.05, model: "raider", tier: 2,
  },
  crow_gunner: {
    name: { ja: "クロウ・ガンナー", en: "Crow Gunner" }, weapon: "corvid", health: 46, speed: 0.27, damage: 2.4, interval: [1.8, 2.4], burst: 8, burstInterval: 0.07,
    range: 24, armor: "crow_heavy", color: [38, 40, 46], role: "heavy", sight: 30, armorValue: 0.3, model: "raider", tier: 2,
  },
  crow_medic: {
    name: { ja: "クロウ・メディック", en: "Crow Medic" }, weapon: "magpie", health: 26, speed: 0.34, damage: 2.2, interval: [1.2, 1.8], burst: 4, burstInterval: 0.06,
    range: 18, armor: "crow_medic", color: [52, 56, 64], role: "medic", sight: 28, armorValue: 0.1, model: "raider", tier: 1, heal: 7, healCooldown: 110,
  },
  crow_commander: {
    name: { ja: "クロウ・コマンダー", en: "Crow Commander" }, weapon: "rook", health: 64, speed: 0.32, damage: 4.4, interval: [1.4, 2.0], burst: 3, burstInterval: 0.09,
    range: 28, armor: "crow_officer", color: [30, 32, 38], role: "leader", sight: 36, armorValue: 0.25, model: "raider", tier: 3,
  },
};

const CROW_SPAWN = {
  crow_operator: { weight: 3, herd: [1, 2] },
  crow_breacher: { weight: 1, herd: [1, 1] },
  crow_marksman: { weight: 1, herd: [1, 1] },
  crow_gunner: { weight: 1, herd: [1, 1] },
  crow_medic: { weight: 1, herd: [1, 1] },
  crow_commander: { weight: 1, herd: [1, 1] },
};

// ---------------------------------------------------------------------------
//  ボス
//  phases … 体力の割合がこの値を下回ると次の段階へ（段階ごとに行動が増える）
//  parts  … 部位破壊。hp を削り切ると装甲が外れ、その部位の行動が止まる
// ---------------------------------------------------------------------------
export const BOSSES = {
  boss_warlord: {
    faction: "raiders", name: { ja: "ウォーロード", en: "The Warlord" }, weapon: "anvil", health: 400, speed: 0.3, damage: 4, interval: [1.2, 1.6], burst: 5, burstInterval: 0.08,
    range: 28, armor: "warlord", color: [140, 30, 30], role: "leader", sight: 40, armorValue: 0.35, model: "raider", scale: 1.35, tier: 4,
    phases: [1.0, 0.66, 0.33],
    actions: {
      1: ["volley", "grenade"],
      2: ["volley", "grenade", "reinforce"],
      3: ["volley", "grenade", "reinforce", "airstrike", "enrage"],
    },
    reinforce: { ids: ["raider_gunner", "raider_rifleman", "raider_medic"], count: 3, cooldown: 400 },
    airstrike: { shots: 7, spacing: 3, power: 3.0, warn: 50, cooldown: 500 },
    reward: { legendary: 1, credits: 800, xp: 1500 },
    summon: "warlord_banner",
  },
  boss_juggernaut: {
    faction: "legion", name: { ja: "ジャガーノート・マーク II", en: "Juggernaut Mk II" }, weapon: "titan", health: 520, speed: 0.2, damage: 3.5, interval: [1.0, 1.4], burst: 8, burstInterval: 0.06,
    range: 30, armor: "juggernaut", color: [80, 90, 110], role: "heavy", sight: 44, armorValue: 0.5, model: "juggernaut", scale: 1.0, tier: 4,
    phases: [1.0, 0.6, 0.3],
    actions: {
      1: ["rotary", "missiles"],
      2: ["rotary", "missiles", "emp"],
      3: ["rotary", "missiles", "emp", "stomp"],
    },
    parts: {
      left_pod: { name: { ja: "左ミサイルポッド", en: "Left Missile Pod" }, hp: 90, disables: "missiles_left" },
      right_pod: { name: { ja: "右ミサイルポッド", en: "Right Missile Pod" }, hp: 90, disables: "missiles_right" },
      core: { name: { ja: "胸部装甲", en: "Chest Plating" }, hp: 140, disables: "armor" },
    },
    missiles: { count: 4, power: 2.2, speed: 0.9, cooldown: 220, warn: 30 },
    emp: { radius: 10, seconds: 6, cooldown: 400, warn: 40 },
    stomp: { radius: 5, damage: 8, cooldown: 160, warn: 20 },
    reward: { legendary: 1, credits: 1000, xp: 2000 },
    summon: "legion_core",
  },
  // ---- 2.3 で追加 ----
  boss_hollow_mother: {
    faction: "hollow", name: { ja: "ホロウ・マザー", en: "Hollow Mother" }, weapon: null, health: 460, speed: 0.26, damage: 10, interval: [1.2, 1.6], burst: 1, burstInterval: 0,
    range: 3.4, armor: "mother", color: [120, 130, 70], role: "melee", sight: 40, armorValue: 0.4, model: "brute", scale: 1.7, tier: 4, knockback: 1.6,
    phases: [1.0, 0.6, 0.3],
    actions: {
      1: ["stomp", "reinforce"],
      2: ["stomp", "reinforce", "grenade"],
      3: ["stomp", "reinforce", "grenade", "enrage"],
    },
    grenade: "grenade_gas",
    reinforce: { ids: ["hollow_runner", "hollow_crawler"], count: 4, cooldown: 360 }, // ブローターの爆発は味方も巻き込むので群れには混ぜない
    stomp: { radius: 5.5, damage: 9, cooldown: 140, warn: 18 },
    reward: { legendary: 1, credits: 900, xp: 1800 },
    summon: "hollow_heart",
  },
  // ---- 3.0 で追加 ----
  boss_director: {
    faction: "crow", name: { ja: "ディレクター・クロウ", en: "Director Crow" }, weapon: "rook", health: 480, speed: 0.32, damage: 4.2, interval: [1.0, 1.4], burst: 4, burstInterval: 0.08,
    range: 30, armor: "crow_director", color: [28, 28, 34], role: "leader", sight: 44, armorValue: 0.4, model: "raider", scale: 1.3, tier: 4,
    phases: [1.0, 0.6, 0.3],
    actions: {
      1: ["volley", "blink"],
      2: ["volley", "blink", "grenade", "reinforce"],
      3: ["volley", "blink", "grenade", "reinforce", "airstrike", "enrage"],
    },
    grenade: "grenade_flash",
    blink: { range: [7, 10], warn: 16, cooldown: 170 },
    reinforce: { ids: ["crow_operator", "crow_medic", "crow_breacher"], count: 3, cooldown: 420 },
    airstrike: { shots: 6, spacing: 3.2, power: 2.8, warn: 50, cooldown: 520 },
    reward: { legendary: 1, credits: 1100, xp: 2200 },
    summon: "crow_dossier",
  },
};

/** 全勢力の敵（ボスを除く）。AI・生成・図鑑が読む */
function buildEnemies() {
  /** @type {Record<string, any>} */
  const out = {};
  for (const [id, r] of Object.entries(RAIDERS)) {
    const x = /** @type {any} */ (RAIDER_EXTRA)[id];
    const sp = /** @type {any} */ (RAIDER_SPAWN)[id];
    out[id] = {
      ...r, ...x, faction: "raiders", skin: r.armor,
      spawn: { biomes: RAIDER_BIOMES, dark: true, surface: true, weight: sp.weight, herd: sp.herd },
    };
  }
  for (const [id, e] of Object.entries(LEGION)) {
    out[id] = {
      ...e, faction: "legion", skin: e.armor,
      spawn: { biomes: ["mountains", "mountain", "extreme_hills"], dark: false, surface: true, weight: id === "legion_mortar" || id === "legion_lancer" ? 1 : 2, herd: id === "legion_drone" || id === "legion_hunter" ? [1, 2] : [1, 1] },
    };
  }
  for (const [id, e] of Object.entries(CROW)) {
    const sp = /** @type {any} */ (CROW_SPAWN)[id];
    out[id] = {
      ...e, faction: "crow", skin: e.armor,
      spawn: { biomes: ["forest", "taiga", "jungle"], dark: true, surface: true, weight: sp.weight, herd: sp.herd },
    };
  }
  for (const [id, e] of Object.entries(HOLLOW)) {
    out[id] = {
      ...e, faction: "hollow", skin: e.armor,
      spawn: { biomes: [], dark: true, surface: false, underground: true, weight: id === "hollow_runner" ? 5 : id === "hollow_crawler" ? 3 : id === "hollow_bloater" ? 2 : 1, herd: id === "hollow_runner" ? [2, 4] : id === "hollow_crawler" ? [2, 3] : [1, 1] },
    };
  }
  return out;
}

/** @type {Record<string, any>} */
export const ENEMIES = buildEnemies();

/** 難易度（ワールド設定 aiDifficulty）ごとの補正 */
export const AI_DIFFICULTY = {
  easy: { name: { ja: "やさしい", en: "Easy" }, spread: 1.8, damage: 0.7, think: 10, grenade: 0.5, flank: 0.2 },
  normal: { name: { ja: "ふつう", en: "Normal" }, spread: 1.0, damage: 1.0, think: 8, grenade: 1.0, flank: 0.45 },
  hard: { name: { ja: "むずかしい", en: "Hard" }, spread: 0.65, damage: 1.2, think: 6, grenade: 1.3, flank: 0.7 },
  veteran: { name: { ja: "ベテラン", en: "Veteran" }, spread: 0.45, damage: 1.4, think: 5, grenade: 1.6, flank: 0.85 },
};

/** AI の予算（15 章） */
export const AI_BUDGET = {
  thinkPerTick: 8,          // 1 tick に思考する AI の数の上限
  thinkIntervalMin: 5,      // 各 AI の思考間隔（tick）
  thinkIntervalMax: 10,
  coverSearchRadius: 7,     // 遮蔽物を探す半径
  coverSamples: 10,         // 遮蔽の候補の数
  maxActive: 60,            // 1 次元あたりの AI 上限（超えた分は思考しない）
  squadRadius: 16,          // 分隊を組む距離
  suppressBurst: 6,         // 制圧射撃の弾数
};
