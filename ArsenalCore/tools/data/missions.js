// ARSENAL CORE データ定義（tools/data/）。ランタイムにはビルド時に 1 ファイル（BP/scripts/config/weapons.data.js）へまとめて出力する。
// ミッション（3.0）：依頼（いつでも受けられる単発の任務）とキャンペーン（順番に進む 12 話の物語）
//
//  任務は 1 人 1 つだけ。受けると目標地点（55〜85 ブロック先）が決まり、近づいたときに敵を出す（遠くでは何も動かさない）
//  type … sweep 掃討（敵を全滅）/ intel 回収（地点に立って情報を集め、離脱）/ defend 防衛（地点を守ってウェーブを退ける）
//         bounty 賞金首（強化された隊長を倒す）/ boss ボス戦（キャンペーンのみ）
//  credits・xp は基本の報酬。依頼は階級に応じて増える（MISSION_RULES.rankScale）。loot … 報酬の補給品のティア

export const MISSION_TYPES = {
  sweep: {
    name: { ja: "掃討", en: "Sweep" },
    desc: { ja: "指定地点の敵部隊を全滅させる", en: "Wipe out the enemy squad at the marked point" },
    credits: 300, xp: 400, loot: "uncommon", count: [4, 6],
  },
  intel: {
    name: { ja: "情報回収", en: "Intel Grab" },
    desc: { ja: "地点の近くに立って情報を回収し、増援が来る前に離脱する", en: "Stand at the point to download the intel, then get clear" },
    credits: 350, xp: 450, loot: "rare", count: [3, 4], hold: 6, holdRadius: 3.5, extract: 45, reinforce: 3,
  },
  defend: {
    name: { ja: "拠点防衛", en: "Hold the Line" },
    desc: { ja: "地点を守り、押し寄せる敵のウェーブを退ける", en: "Hold the point against incoming waves" },
    credits: 400, xp: 500, loot: "rare", count: [3, 4], waves: 3, radius: 12, waveGap: 8, spawnDist: [20, 26],
  },
  bounty: {
    name: { ja: "賞金首", en: "Bounty" },
    desc: { ja: "護衛に守られた強化個体を仕留める", en: "Take down a hardened target and its escort" },
    credits: 450, xp: 550, loot: "rare", count: [2, 3], boost: 3, resist: 0,
  },
  boss: {
    name: { ja: "ボス戦", en: "Boss Fight" },
    desc: { ja: "敵の切り札を撃破する", en: "Destroy the enemy's trump card" },
    credits: 0, xp: 0, loot: "legendary", count: [0, 0],
  },
};

/** 依頼に出る任務の種類（ボス戦は出ない） */
export const CONTRACT_TYPES = ["sweep", "intel", "defend", "bounty"];

export const MISSION_RULES = {
  /** 目標地点までの距離 [最小, 最大] */
  distance: [55, 85],
  /** この距離まで近づいたら敵を出す（敵が見えて戦える距離。チャンクの読み込みも待つ） */
  spawnNear: 52,
  /** 依頼の数 */
  offers: 3,
  /** 依頼の報酬は 1 + 階級 × この値 倍 */
  rankScale: 0.03,
  /** 階級がこの値ごとに敵が 1 体増える */
  rankPerExtra: 12,
  /** 階級による敵の強さ：この階級以上で tier 2 / tier 3 の敵が混ざる */
  tier2From: 6,
  tier3From: 18,
  /** 中止したあと次を受けられるまで（秒） */
  abandonCooldown: 20,
};

/** 依頼に出る勢力（ワールド設定で OFF の勢力は除く） */
export const CONTRACT_FACTIONS = ["raiders", "legion", "hollow"];

// ---------------------------------------------------------------------------
//  キャンペーン「オペレーション・アーセナル」
//   enemies … [敵 ID, 数] の組。boss … ボス戦の相手 / target … 賞金首の相手
//   rank    … 推奨階級（表示だけ。受けられないことはない）
// ---------------------------------------------------------------------------
export const CAMPAIGN_CHAPTERS = [
  { name: { ja: "第 1 章　荒野の略奪者", en: "Chapter 1: Wasteland Raiders" } },
  { name: { ja: "第 2 章　鉄の軍団", en: "Chapter 2: The Iron Legion" } },
  { name: { ja: "第 3 章　深淵より", en: "Chapter 3: From the Deep" } },
];

export const CAMPAIGN = [
  {
    id: "c01", chapter: 0, type: "sweep", faction: "raiders", rank: 1, credits: 250, xp: 350, loot: "uncommon",
    enemies: [["raider_gunner", 2], ["raider_rifleman", 1], ["raider_dog", 1]],
    title: { ja: "最初の一歩", en: "First Steps" },
    brief: { ja: "近くの道でレイダーの斥候隊が旅人を襲っている。腕試しだ。全員片付けてこい。", en: "A Raider patrol is preying on travellers nearby. Consider it your test. Clear them out." },
  },
  {
    id: "c02", chapter: 0, type: "intel", faction: "raiders", rank: 2, credits: 300, xp: 450, loot: "uncommon",
    enemies: [["raider_rifleman", 2], ["raider_scout", 1]],
    title: { ja: "盗まれた地図", en: "The Stolen Map" },
    brief: { ja: "レイダーが補給路の地図を手に入れた。野営地へ忍び込み、地図の写しを回収して離脱しろ。", en: "The Raiders got hold of our supply-route maps. Slip into their camp, copy the maps and get out." },
  },
  {
    id: "c03", chapter: 0, type: "bounty", faction: "raiders", rank: 4, credits: 400, xp: 600, loot: "rare",
    enemies: [["raider_rifleman", 2], ["raider_medic", 1]], target: "raider_captain",
    title: { ja: "赤い隊長", en: "The Red Captain" },
    brief: { ja: "略奪を指揮している隊長の居場所が割れた。護衛ごと仕留めろ。衛生兵から先に倒すと楽になる。", en: "We found the captain running the raids. Take him down with his escort. Drop the medic first." },
  },
  {
    id: "c04", chapter: 0, type: "boss", faction: "raiders", rank: 6, credits: 900, xp: 1400, loot: "rare",
    enemies: [], boss: "boss_warlord",
    title: { ja: "ウォーロード", en: "The Warlord" },
    brief: { ja: "隊長を失ったレイダーズの首領、ウォーロードが自ら出てきた。予兆を見たら走れ。ここで終わらせる。", en: "With the captain gone, the Warlord himself takes the field. When you see the warning, move. End this here." },
  },
  {
    id: "c05", chapter: 1, type: "defend", faction: "legion", rank: 8, credits: 550, xp: 800, loot: "rare",
    enemies: [["legion_trooper", 3], ["legion_drone", 1]],
    title: { ja: "鉄の足音", en: "Iron Footsteps" },
    brief: { ja: "レギオンの機械兵が谷へ降りてきた。中継点を守り、3 回の攻勢を退けろ。", en: "Legion machines are marching into the valley. Hold the relay point through three assaults." },
  },
  {
    id: "c06", chapter: 1, type: "intel", faction: "legion", rank: 10, credits: 600, xp: 900, loot: "rare",
    enemies: [["legion_trooper", 2], ["legion_shield", 1], ["legion_drone", 1]],
    title: { ja: "設計図", en: "Blueprints" },
    brief: { ja: "レギオンの前線端末に新型兵器の設計図がある。シールド兵の正面は撃っても通らない、回り込め。", en: "A Legion field terminal holds blueprints for a new weapon. Bulwarks block from the front: flank them." },
  },
  {
    id: "c07", chapter: 1, type: "sweep", faction: "legion", rank: 12, credits: 650, xp: 1000, loot: "rare",
    enemies: [["legion_trooper", 2], ["legion_lancer", 1], ["legion_hunter", 2], ["legion_mortar", 1]],
    title: { ja: "砲兵陣地", en: "Artillery Nest" },
    brief: { ja: "迫撃砲ロボが味方の陣地を砲撃している。近づけば撃てない。距離を詰めて陣地ごと潰せ。", en: "A mortar walker is shelling our lines. It can't hit you up close. Close in and crush the nest." },
  },
  {
    id: "c08", chapter: 1, type: "boss", faction: "legion", rank: 14, credits: 1200, xp: 1800, loot: "legendary",
    enemies: [], boss: "boss_juggernaut",
    title: { ja: "ジャガーノート", en: "Juggernaut" },
    brief: { ja: "設計図の正体はジャガーノート・マーク II。左右のミサイルポッドと胸の装甲を壊せば止められる。", en: "The blueprints were for the Juggernaut Mk II. Break its missile pods and chest plate to stop it." },
  },
  {
    id: "c09", chapter: 2, type: "defend", faction: "hollow", rank: 16, credits: 700, xp: 1100, loot: "rare",
    enemies: [["hollow_runner", 3], ["hollow_crawler", 2], ["hollow_bloater", 1]],
    title: { ja: "夜明けまで", en: "Until Dawn" },
    brief: { ja: "地下から変異体が溢れ出した。避難所を守れ。膨れた奴（ブローター）は近づく前に撃て。", en: "The Hollow are pouring out of the ground. Hold the shelter. Shoot the bloaters before they reach you." },
  },
  {
    id: "c10", chapter: 2, type: "sweep", faction: "hollow", rank: 18, credits: 750, xp: 1200, loot: "rare",
    enemies: [["hollow_runner", 4], ["hollow_brute", 1], ["hollow_crawler", 2]],
    title: { ja: "巣の掃除", en: "Nest Cleaning" },
    brief: { ja: "変異体の巣の一つを見つけた。ブルートは硬い。爆発物と散弾を持っていけ。", en: "We found one of their nests. Brutes are tough: bring explosives and shotguns." },
  },
  {
    id: "c11", chapter: 2, type: "bounty", faction: "hollow", rank: 20, credits: 850, xp: 1400, loot: "legendary",
    enemies: [["hollow_runner", 3], ["hollow_bloater", 1]], target: "hollow_brute",
    title: { ja: "群れの長", en: "Pack Leader" },
    brief: { ja: "ひときわ大きなブルートが群れを率いている。これを倒せば母体への道が開く。", en: "An enormous brute leads the swarm. Kill it and the way to their mother opens." },
  },
  {
    id: "c12", chapter: 2, type: "boss", faction: "hollow", rank: 22, credits: 2000, xp: 3000, loot: "legendary",
    enemies: [], boss: "boss_hollow_mother",
    title: { ja: "オペレーション・アーセナル", en: "Operation Arsenal" },
    brief: { ja: "すべての変異体を生む母体が地表へ出てくる。これが最後の作戦だ。持てる力を全部使え。", en: "The mother of all Hollow is surfacing. This is the final operation. Use everything you have." },
  },
];
