// ARSENAL CORE データ定義（tools/data/）。ランタイムにはビルド時に 1 ファイル（BP/scripts/config/weapons.data.js）へまとめて出力する。
// 基本定数・ティア・カテゴリ・素材・道具・既定設定・着弾と貫通

export const NS = "arsenal";
export const ADDON_VERSION = [2, 3, 0];
/** アイテムに書く形式のバージョン（a:v）。1.0 系のアイテムは 1 とみなして移行する */
export const ITEM_FORMAT = 2;
export const MIN_ENGINE = [1, 26, 50];
export const SCRIPT_MODULES = { server: "2.10.0", ui: "2.2.0" };

// ---------------------------------------------------------------------------
//  ティア（入手難度）
// ---------------------------------------------------------------------------
export const TIERS = {
  common: { order: 0, color: "§f", rarity: "common", name: { ja: "コモン", en: "Common" }, accent: [196, 200, 206] },
  uncommon: { order: 1, color: "§a", rarity: "uncommon", name: { ja: "アンコモン", en: "Uncommon" }, accent: [86, 196, 92] },
  rare: { order: 2, color: "§b", rarity: "rare", name: { ja: "レア", en: "Rare" }, accent: [70, 160, 236] },
  legendary: { order: 3, color: "§6", rarity: "epic", name: { ja: "レジェンダリー", en: "Legendary" }, accent: [242, 176, 48] },
};

// ---------------------------------------------------------------------------
//  カテゴリ
// ---------------------------------------------------------------------------
// bullet：弾が飛んで落ちる（弾速 ブロック/tick・重力 ブロック/tick²）。ヒットスキャンの銃に使う。
//   実銃より遅めにして、マイクラの交戦距離（20〜100 ブロック）でも偏差と落下が分かるようにしている
//   （例：アサルト 12 ブロック/tick は 60 ブロック先まで 5 tick、そのあいだに約 0.25 ブロック落ち、走る相手は約 1.4 ブロック動く）
// ready：走るのをやめて（または走りながら引き金を引いて）から撃てるまでの tick。重い銃ほど構えるのに時間がかかる
export const CATEGORIES = {
  handgun: { order: 0, name: { ja: "ハンドガン", en: "Handguns" }, pose: "pistol", durability: 1500, costMul: 0.6, bullet: { speed: 7, gravity: 0.03 }, ready: 3 },
  machine_pistol: { order: 1, name: { ja: "マシンピストル", en: "Machine Pistols" }, pose: "pistol", durability: 2000, costMul: 0.75, bullet: { speed: 7.5, gravity: 0.03 }, ready: 3 },
  smg: { order: 2, name: { ja: "サブマシンガン", en: "SMGs" }, pose: "rifle", durability: 2600, costMul: 0.85, bullet: { speed: 8, gravity: 0.028 }, ready: 4 },
  carbine: { order: 3, name: { ja: "カービン", en: "Carbines" }, pose: "rifle", durability: 2800, costMul: 0.9, bullet: { speed: 11, gravity: 0.022 }, ready: 5 },
  assault: { order: 4, name: { ja: "アサルトライフル", en: "Assault Rifles" }, pose: "rifle", durability: 3000, costMul: 1.0, bullet: { speed: 12, gravity: 0.02 }, ready: 6 },
  battle: { order: 5, name: { ja: "バトルライフル", en: "Battle Rifles" }, pose: "rifle", durability: 2600, costMul: 1.1, bullet: { speed: 14, gravity: 0.018 }, ready: 7 },
  dmr: { order: 6, name: { ja: "マークスマンライフル", en: "Marksman Rifles" }, pose: "rifle", durability: 1800, costMul: 1.15, bullet: { speed: 16, gravity: 0.016 }, ready: 7 },
  sniper: { order: 7, name: { ja: "スナイパーライフル", en: "Sniper Rifles" }, pose: "rifle", durability: 900, costMul: 1.3, ready: 9 },
  shotgun: { order: 8, name: { ja: "ショットガン", en: "Shotguns" }, pose: "rifle", durability: 1100, costMul: 0.9, bullet: { speed: 7, gravity: 0.04 }, ready: 6 },
  lmg: { order: 9, name: { ja: "ライトマシンガン", en: "LMGs" }, pose: "rifle", durability: 5000, costMul: 1.4, bullet: { speed: 12, gravity: 0.02 }, ready: 10 },
  heavy: { order: 10, name: { ja: "重火器", en: "Heavy Weapons" }, pose: "rifle", durability: 4000, costMul: 1.6, bullet: { speed: 12, gravity: 0.02 }, ready: 11 },
  launcher: { order: 11, name: { ja: "ランチャー", en: "Launchers" }, pose: "rifle", durability: 260, costMul: 1.5, ready: 10 },
  special: { order: 12, name: { ja: "特殊・エネルギー", en: "Special & Energy" }, pose: "rifle", durability: 1600, costMul: 1.4, ready: 6 },
  melee: { order: 13, name: { ja: "近接武器", en: "Melee" }, pose: "melee", durability: 600, costMul: 0.5, ready: 0 },
};

// ---------------------------------------------------------------------------
//  素材
// ---------------------------------------------------------------------------
export const MATERIALS = {
  steel_ingot: { name: { ja: "鋼鉄インゴット", en: "Steel Ingot" }, desc: { ja: "鉄と石炭から作る頑丈な金属", en: "Iron hardened with coal" } },
  precision_parts: { name: { ja: "精密部品", en: "Precision Parts" }, desc: { ja: "銃の機関部に使う部品", en: "Parts for firearm actions" } },
  polymer: { name: { ja: "高分子素材", en: "Polymer" }, desc: { ja: "軽量なフレーム素材", en: "Lightweight frame material" } },
  energy_core: { name: { ja: "エネルギーコア", en: "Energy Core" }, desc: { ja: "エネルギー兵器の心臓部", en: "The heart of energy weapons" } },
};

// ---------------------------------------------------------------------------
//  その他のアイテム
// ---------------------------------------------------------------------------
export const TOOLS = {
  field_manual: { name: { ja: "野戦マニュアル", en: "Field Manual" }, desc: { ja: "使用して設定・図鑑・操作ガイドを開く", en: "Use to open settings, codex and guide" }, cost: { "minecraft:book": 1, "minecraft:iron_nugget": 1 } },
  detonator: { name: { ja: "起爆装置", en: "Detonator" }, desc: { ja: "設置した C4 をすべて起爆", en: "Detonates all your C4" }, cost: { "minecraft:redstone_torch": 1, "arsenal:precision_parts": 1, "arsenal:polymer": 1 } },
  repair_kit: { name: { ja: "ガンスミスキット", en: "Gunsmith Kit" }, desc: { ja: "持っている武器の耐久を 35% 回復", en: "Repairs the held weapon by 35%" }, cost: { "arsenal:steel_ingot": 2, "arsenal:precision_parts": 1, "minecraft:slime_ball": 1 } },
  target_dummy: { name: { ja: "射撃練習ターゲット", en: "Training Target" }, desc: { ja: "設置するとダメージと部位を表示する的になる", en: "Shows damage and hit zone. Sneak-hit to pick up" }, cost: { "minecraft:hay_block": 1, "minecraft:stick": 3, "minecraft:target": 1 } },
  // ---- 2.0 で追加 ----
  arena_tool: { name: { ja: "アリーナツール", en: "Arena Tool" }, desc: { ja: "（OP）アリーナの登録とゲームモードの開始", en: "(OP) Set up arenas and start matches" }, cost: { "minecraft:compass": 1, "arsenal:precision_parts": 1 } },
  streak_terminal: { name: { ja: "ストリーク端末", en: "Streak Terminal" }, desc: { ja: "解放したキルストリークを選んで使う", en: "Pick and call in your unlocked killstreaks" }, cost: { "minecraft:redstone": 4, "arsenal:precision_parts": 1, "minecraft:glass_pane": 1 } },
  warlord_banner: { name: { ja: "ウォーロードの軍旗", en: "Warlord's Banner" }, desc: { ja: "使用するとレイダーの首領ウォーロードを呼び出す", en: "Use to summon the Raider Warlord" }, cost: { "minecraft:banner": 1, "minecraft:emerald": 8, "arsenal:steel_ingot": 6, "minecraft:gold_ingot": 4 } },
  legion_core: { name: { ja: "レギオン中枢核", en: "Legion Core" }, desc: { ja: "使用するとジャガーノート・マーク II を起動する", en: "Use to boot the Juggernaut Mk II" }, cost: { "arsenal:energy_core": 2, "minecraft:netherite_scrap": 1, "minecraft:redstone_block": 4 } },
  // ---- 2.3 で追加 ----
  hollow_heart: { name: { ja: "ホロウの心臓", en: "Hollow Heart" }, desc: { ja: "使用するとホロウの母体ホロウ・マザーを呼び覚ます", en: "Use to awaken the Hollow Mother" }, cost: { "minecraft:rotten_flesh": 16, "minecraft:fermented_spider_eye": 2, "minecraft:sculk_catalyst": 1, "minecraft:gold_ingot": 4 } },
};

// ---------------------------------------------------------------------------
//  既定の設定
// ---------------------------------------------------------------------------
export const DEFAULT_WORLD_SETTINGS = {
  damageMul: 1.0,
  headMul: 1.0,
  friendlyFire: false,
  explosionGrief: "gamerule",
  glassBreak: true,
  durability: true,
  creativeInfinite: true,
  raiders: true,
  spawnProtect: 0,
  flashlightBlocks: true,
  killFeed: true,
  autoReload: true,
  // ---- 2.0 で追加 ----
  legion: true,
  hollow: true,
  structures: "normal",
  economy: true,
  progressionLocks: true,
  killstreaks: true,
  downed: false,
  bleeding: true,
  backstabPvp: 2.0,
  aimAssistPvp: false,
  wind: true,
  aiDifficulty: "normal",
  suppression: true,
  bosses: true,
  // ---- 2.1 ----
  bulletTravel: true,
  // ---- 2.2 ----
  magRealism: true,
  limbDamage: true,
};

export const DEFAULT_PLAYER_SETTINGS = {
  adsMode: "hold",
  triggerMode: "hold",
  reloadInput: "double_sneak",
  hudMode: "full",
  hudPos: "actionbar",
  hitmarkers: true,
  damageNumbers: true,
  blood: true,
  aimKick: "light",
  cameraShake: true,
  fovZoom: true,
  fxQuality: "high",
  volume: 1.0,
  trajectory: true,
  // ---- 2.0 で追加 ----
  hudStyle: "hud2",
  hudScale: "normal",
  compass: true,
  damageDir: true,
  suppressionFx: true,
  aimAssist: "off",
  autoFire: false,
  fpOffsetV: 0,
  fpOffsetD: 0,
  showRank: true,
  nvgAuto: true,
  hudLayout: "auto",
};

// 素材ごとの着弾破片の色
export const IMPACT_COLORS = [
  { match: ["grass", "leaves", "moss", "vine", "azalea", "kelp", "fern", "bush"], color: [86, 140, 58] },
  { match: ["dirt", "mud", "podzol", "farmland", "path", "clay", "mycelium"], color: [120, 86, 56] },
  { match: ["sand", "sandstone"], color: [218, 204, 150] },
  { match: ["red_sand", "terracotta"], color: [186, 110, 64] },
  { match: ["log", "planks", "wood", "stem", "hyphae", "bamboo", "barrel", "chest", "fence", "door", "crafting", "bookshelf"], color: [150, 112, 66] },
  { match: ["glass", "ice", "pane"], color: [196, 226, 240] },
  { match: ["snow", "powder_snow", "wool", "quartz", "calcite", "bone"], color: [236, 238, 240] },
  { match: ["iron", "gold", "copper", "anvil", "chain", "bars", "lantern"], color: [210, 210, 196] },
  { match: ["netherrack", "nylium", "crimson", "nether_wart", "magma"], color: [140, 44, 40] },
  { match: ["end_stone", "purpur"], color: [220, 214, 160] },
  { match: ["obsidian", "blackstone", "basalt", "deepslate", "coal", "tuff"], color: [58, 56, 64] },
  { match: ["water"], color: [70, 110, 220] },
];
export const IMPACT_DEFAULT = [130, 130, 130];

// 貫通可能（薄い）ブロックの判定キーワードと必要貫通力
export const PENETRABLE = [
  { match: ["glass", "pane"], cost: 0, breakable: true },
  { match: ["leaves", "vine", "wool", "carpet", "bamboo", "scaffolding", "cobweb", "hay"], cost: 0.5 },
  { match: ["planks", "fence", "door", "trapdoor", "slab", "stairs", "sign", "log", "wood", "barrel", "bookshelf", "chest", "crafting_table"], cost: 1 },
  { match: ["dirt", "sand", "gravel", "snow", "clay", "mud", "grass", "ice", "terracotta"], cost: 1.5 },
  { match: ["stone", "cobble", "brick", "concrete", "deepslate", "andesite", "diorite", "granite", "tuff", "calcite", "blackstone", "netherrack", "quartz", "prismarine", "copper"], cost: 2.5 },
];
export const UNPENETRABLE = ["bedrock", "obsidian", "barrier", "reinforced_deepslate", "command_block", "end_portal_frame", "structure_block", "iron_block", "netherite_block"];
