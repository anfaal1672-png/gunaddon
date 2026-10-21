// ARSENAL CORE データ定義（tools/data/）。ランタイムにはビルド時に 1 ファイル（BP/scripts/config/weapons.data.js）へまとめて出力する。
// 構造物（2.0 で追加）
//
// 生成の流れ（詳しくは DESIGN_DECISIONS.md「構造物の生成方式」）
//  1. 地物ルール（feature_rules）が、小さな「目印の構造物」（arsenal:site_<id>。目印ブロック 1 個だけ）を地表に置く
//  2. 目印ブロックは 2〜3 秒ごとに近くのプレイヤーを調べ、48 ブロック以内に来たら
//     ワールド設定「構造物の密度」で抽選 → 本体の .mcstructure（arsenal:<id>）を置く → 守備隊と宝箱の中身を起動する
//  3. 設定が OFF・抽選に外れたときは目印を消すだけ（地形は変えない）
//
//  size      … 本体の大きさ [x, y, z]（.mcstructure と一致すること。ビルドで照合）
//  sink      … 地面より下に埋める段数（基礎）
//  biomes    … 地物ルールのバイオームタグ（どれか 1 つ）
//  scatter   … 地物ルールの出現率（1 チャンクあたり、%）。「多め」の値。標準・少なめは抽選で間引く
//  garrison  … 守備隊 [{ id, count, at?: "center" | "edge" | "roof" }]
//  chests    … 宝箱 [{ tier, count }]。位置は構造物の中の宝箱ブロック（生成時に記録）
//  merchant  … 補給係が居る確率

export const STRUCTURE_DENSITY = {
  off: { name: { ja: "なし", en: "Off" }, keep: 0 },
  low: { name: { ja: "少なめ", en: "Low" }, keep: 0.3 },
  normal: { name: { ja: "標準", en: "Normal" }, keep: 0.6 },
  high: { name: { ja: "多め", en: "High" }, keep: 1.0 },
};

export const STRUCTURES = {
  raider_camp: {
    name: { ja: "レイダーの野営地", en: "Raider Camp" },
    desc: { ja: "テントと焚き火を囲む小さな野営地", en: "Tents around a campfire" },
    size: [17, 7, 17], sink: 1, biomes: ["plains", "savanna", "desert", "mesa"], scatter: 0.6,
    garrison: [{ id: "raider_gunner", count: 2 }, { id: "raider_rifleman", count: 1 }, { id: "raider_dog", count: 1 }, { id: "raider_medic", count: 1, at: "center" }],
    chests: [{ tier: "common", count: 2 }, { tier: "uncommon", count: 1 }],
    merchant: 0.0, faction: "raiders",
  },
  outpost: {
    name: { ja: "前哨基地", en: "Forward Outpost" },
    desc: { ja: "見張り台と土嚢の陣地。狙撃兵が高所から見張る", en: "Watchtower and sandbags, with a sniper on top" },
    size: [15, 13, 15], sink: 1, biomes: ["plains", "savanna", "forest", "taiga"], scatter: 0.4,
    garrison: [{ id: "raider_sniper", count: 1, at: "roof" }, { id: "raider_rifleman", count: 2 }, { id: "raider_heavy", count: 1 }, { id: "raider_captain", count: 1, at: "center" }],
    chests: [{ tier: "uncommon", count: 2 }, { tier: "rare", count: 1 }],
    merchant: 0.25, faction: "raiders",
  },
  armory_bunker: {
    name: { ja: "武器庫バンカー", en: "Armory Bunker" },
    desc: { ja: "半地下のコンクリート壕。奥に武器ラック", en: "Half-buried concrete bunker with a weapon rack" },
    size: [15, 8, 19], sink: 4, biomes: ["plains", "forest", "taiga", "savanna", "desert"], scatter: 0.3,
    garrison: [{ id: "raider_heavy", count: 1 }, { id: "raider_demo", count: 1 }, { id: "raider_rifleman", count: 2 }],
    chests: [{ tier: "uncommon", count: 2 }, { tier: "rare", count: 2 }],
    merchant: 0.0, faction: "raiders",
  },
  legion_lab: {
    name: { ja: "レギオン研究所", en: "Legion Laboratory" },
    desc: { ja: "山腹の白い研究棟。機械の兵士が守る", en: "White lab block guarded by machines" },
    size: [21, 11, 21], sink: 2, biomes: ["mountains", "mountain", "extreme_hills"], scatter: 0.35,
    garrison: [{ id: "legion_trooper", count: 3 }, { id: "legion_shield", count: 1 }, { id: "legion_drone", count: 2, at: "roof" }, { id: "legion_mortar", count: 1, at: "edge" }],
    chests: [{ tier: "rare", count: 2 }, { tier: "legendary", count: 1 }],
    merchant: 0.0, faction: "legion",
  },
  crashed_transport: {
    name: { ja: "墜落した輸送機", en: "Crashed Transport" },
    desc: { ja: "胴体の割れた輸送機。積み荷が散らばっている", en: "A broken cargo plane with scattered crates" },
    size: [25, 8, 11], sink: 1, biomes: ["plains", "desert", "savanna", "taiga", "forest"], scatter: 0.25,
    garrison: [{ id: "hollow_runner", count: 3 }, { id: "hollow_bloater", count: 1 }],
    chests: [{ tier: "uncommon", count: 2 }, { tier: "rare", count: 1 }],
    merchant: 0.0, faction: "hollow",
  },
  derelict_port: {
    name: { ja: "廃港", en: "Derelict Port" },
    desc: { ja: "海辺の朽ちた桟橋と倉庫", en: "Rotting pier and warehouse on the shore" },
    size: [23, 10, 17], sink: 2, biomes: ["beach"], scatter: 0.45,
    garrison: [{ id: "raider_gunner", count: 2 }, { id: "raider_rifleman", count: 2 }, { id: "raider_captain", count: 1, at: "center" }],
    chests: [{ tier: "common", count: 1 }, { tier: "uncommon", count: 2 }, { tier: "rare", count: 1 }],
    merchant: 0.5, faction: "raiders",
  },
  hollow_ruin: {
    name: { ja: "変異体の巣", en: "Hollow Nest" },
    desc: { ja: "崩れた地下室。夜になると変異体が湧き出す", en: "Collapsed cellar that spews mutants at night" },
    size: [13, 7, 13], sink: 5, biomes: ["plains", "forest", "taiga", "swamp"], scatter: 0.3,
    garrison: [{ id: "hollow_runner", count: 3 }, { id: "hollow_brute", count: 1, at: "center" }],
    chests: [{ tier: "uncommon", count: 1 }, { tier: "rare", count: 1 }],
    merchant: 0.0, faction: "hollow",
  },
  // ---- 2.3 で追加 ----
  checkpoint: {
    name: { ja: "検問所", en: "Raider Checkpoint" },
    desc: { ja: "道をふさぐ遮断機と見張り小屋。土嚢の陰から撃ってくる", en: "Road barrier and guard hut, held from behind sandbags" },
    size: [19, 8, 13], sink: 1, biomes: ["plains", "savanna", "desert", "taiga"], scatter: 0.4,
    garrison: [{ id: "raider_scout", count: 2 }, { id: "raider_breacher", count: 1, at: "center" }, { id: "raider_marksman", count: 1, at: "roof" }, { id: "raider_dog", count: 1, at: "edge" }],
    chests: [{ tier: "common", count: 1 }, { tier: "uncommon", count: 1 }],
    merchant: 0.15, faction: "raiders",
  },
  radar_station: {
    name: { ja: "レギオン・レーダー基地", en: "Legion Radar Station" },
    desc: { ja: "巨大なレーダー塔と発電機。狙撃ロボとドローンが守る", en: "Radar mast and generators, watched by lancers and drones" },
    size: [17, 16, 17], sink: 1, biomes: ["mountains", "mountain", "extreme_hills", "mesa"], scatter: 0.3,
    garrison: [{ id: "legion_lancer", count: 1, at: "roof" }, { id: "legion_trooper", count: 2 }, { id: "legion_hunter", count: 2, at: "edge" }, { id: "legion_shield", count: 1, at: "center" }],
    chests: [{ tier: "uncommon", count: 1 }, { tier: "rare", count: 2 }],
    merchant: 0.0, faction: "legion",
  },
  infested_farm: {
    name: { ja: "汚染された農場", en: "Infested Farm" },
    desc: { ja: "崩れかけた納屋と枯れた畑。床下を這うものがいる", en: "A rotting barn and dead fields. Something crawls under the floor" },
    size: [19, 10, 15], sink: 1, biomes: ["plains", "forest", "swamp", "taiga"], scatter: 0.35,
    garrison: [{ id: "hollow_crawler", count: 3 }, { id: "hollow_runner", count: 2 }, { id: "hollow_bloater", count: 1, at: "center" }],
    chests: [{ tier: "common", count: 1 }, { tier: "uncommon", count: 1 }, { tier: "rare", count: 1 }],
    merchant: 0.0, faction: "hollow",
  },
  // ---- 3.0 で追加（ブラッククロウ） ----
  crow_compound: {
    name: { ja: "ブラッククロウの前線基地", en: "Black Crow Compound" },
    desc: { ja: "金網で囲まれた指揮所とヘリパッド。精鋭が少人数で守る", en: "Fenced command post and helipad, held by a small elite team" },
    size: [21, 10, 21], sink: 1, biomes: ["forest", "taiga", "jungle", "plains"], scatter: 0.3,
    garrison: [{ id: "crow_operator", count: 2 }, { id: "crow_gunner", count: 1 }, { id: "crow_marksman", count: 1, at: "roof" }, { id: "crow_medic", count: 1 }, { id: "crow_commander", count: 1, at: "center" }],
    chests: [{ tier: "uncommon", count: 1 }, { tier: "rare", count: 2 }],
    merchant: 0.0, faction: "crow",
  },
  crow_relay: {
    name: { ja: "ブラッククロウの通信中継所", en: "Black Crow Relay" },
    desc: { ja: "鉄塔のアンテナと機材小屋。塔の上から狙撃手が見張る", en: "Antenna mast and equipment shed, with a marksman up top" },
    size: [13, 16, 13], sink: 1, biomes: ["forest", "taiga", "mountains", "extreme_hills"], scatter: 0.3,
    garrison: [{ id: "crow_marksman", count: 1, at: "roof" }, { id: "crow_operator", count: 2 }, { id: "crow_breacher", count: 1, at: "center" }],
    chests: [{ tier: "uncommon", count: 1 }, { tier: "rare", count: 1 }],
    merchant: 0.0, faction: "crow",
  },
};

// ---------------------------------------------------------------------------
//  宝箱の中身（ティア別）。スクリプトが起動時に詰める
//  kind … "weapon"（その tier 以下の武器）| "attachment" | "ammo" | "item"（id 指定）| "armor"
// ---------------------------------------------------------------------------
export const LOOT_TIERS = {
  common: {
    rolls: [3, 5],
    entries: [
      { kind: "ammo", weight: 10, count: [8, 20] },
      { kind: "item", id: "arsenal:steel_ingot", weight: 8, count: [1, 3] },
      { kind: "item", id: "arsenal:polymer", weight: 6, count: [1, 2] },
      { kind: "item", id: "arsenal:bandage", weight: 6, count: [1, 3] },
      { kind: "item", id: "arsenal:grenade_frag", weight: 4, count: [1, 2] },
      { kind: "weapon", maxTier: "common", weight: 3 },
      { kind: "attachment", maxTier: "common", weight: 3 },
      { kind: "armor", maxLevel: 1, weight: 2 },
      { kind: "item", id: "minecraft:bread", weight: 5, count: [2, 5] },
    ],
  },
  uncommon: {
    rolls: [4, 6],
    entries: [
      { kind: "ammo", weight: 10, count: [12, 28] },
      { kind: "item", id: "arsenal:precision_parts", weight: 6, count: [1, 2] },
      { kind: "item", id: "arsenal:steel_ingot", weight: 6, count: [2, 4] },
      { kind: "item", id: "arsenal:medkit", weight: 4, count: [1, 1] },
      { kind: "item", id: "arsenal:armor_plate", weight: 5, count: [1, 3] },
      { kind: "item", id: "arsenal:grenade_frag", weight: 4, count: [1, 3] },
      { kind: "item", id: "arsenal:grenade_smoke", weight: 3, count: [1, 2] },
      { kind: "weapon", maxTier: "uncommon", weight: 4 },
      { kind: "attachment", maxTier: "uncommon", weight: 5 },
      { kind: "armor", maxLevel: 2, weight: 3 },
    ],
  },
  rare: {
    rolls: [4, 7],
    entries: [
      { kind: "ammo", weight: 8, count: [16, 32] },
      { kind: "item", id: "arsenal:precision_parts", weight: 6, count: [2, 3] },
      { kind: "item", id: "arsenal:energy_core", weight: 2, count: [1, 1] },
      { kind: "item", id: "arsenal:armor_plate", weight: 5, count: [2, 4] },
      { kind: "item", id: "arsenal:adrenaline", weight: 3, count: [1, 1] },
      { kind: "item", id: "arsenal:c4", weight: 2, count: [1, 2] },
      { kind: "weapon", maxTier: "rare", weight: 5 },
      { kind: "attachment", maxTier: "rare", weight: 6 },
      { kind: "armor", maxLevel: 3, weight: 3 },
    ],
  },
  legendary: {
    rolls: [5, 7],
    entries: [
      { kind: "ammo", weight: 6, count: [24, 40] },
      { kind: "item", id: "arsenal:energy_core", weight: 5, count: [1, 2] },
      { kind: "item", id: "arsenal:precision_parts", weight: 5, count: [2, 4] },
      { kind: "item", id: "arsenal:defibrillator", weight: 2, count: [1, 1] },
      { kind: "weapon", maxTier: "legendary", minTier: "rare", weight: 5 },
      { kind: "attachment", maxTier: "legendary", minTier: "rare", weight: 5 },
      { kind: "armor", maxLevel: 3, minLevel: 3, weight: 3 },
    ],
    guaranteed: { kind: "weapon", maxTier: "legendary", minTier: "legendary" },
  },
};
