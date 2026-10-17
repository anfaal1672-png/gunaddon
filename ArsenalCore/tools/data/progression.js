// ARSENAL CORE データ定義（tools/data/）。ランタイムにはビルド時に 1 ファイル（BP/scripts/config/weapons.data.js）へまとめて出力する。
// 進行（2.0 で追加）：武器経験値・武器レベル・迷彩・階級・チャレンジ・統計

// ---------------------------------------------------------------------------
//  武器レベル（1〜30）
// ---------------------------------------------------------------------------
export const WEAPON_MAX_LEVEL = 30;

/**
 * レベル lv から lv+1 に上がるのに必要な経験値
 * @param {number} lv
 * @returns {number}
 */
export function weaponXpToNext(lv) {
  return Math.round(80 + lv * 35 + lv * lv * 2.5);
}

/** 1〜30 の累計必要経験値（index = レベル。1 は 0） */
export const WEAPON_XP_TABLE = (() => {
  const t = [0, 0];
  for (let lv = 1; lv < WEAPON_MAX_LEVEL; lv++) t.push(t[lv] + weaponXpToNext(lv));
  return t;
})();

export const WEAPON_XP = {
  kill: 50,
  headshot: 25,
  assist: 15,
  longshot: 20,
  hit: 1,          // 命中 1 回（1 マガジンあたり上限 10）
  hitCapPerMag: 10,
  bossKill: 400,
};

/** アタッチメントの作成に必要な武器レベル（ティア別。ワールド設定 progressionLocks が ON のとき） */
export const ATTACHMENT_UNLOCK = { common: 1, uncommon: 4, rare: 10, legendary: 99 };

// ---------------------------------------------------------------------------
//  迷彩（銃のみ。見た目違い ID arsenal:<id>__c<n> で表示する）
//  kind … "solid"（単色）| "woodland"（ノイズ）| "digital"（ディジタル）| "tiger"（虎縞）| "gold" | "diamond"
// ---------------------------------------------------------------------------
export const CAMOS = {
  c1: { name: { ja: "オリーブ", en: "Olive Drab" }, kind: "solid", colors: [[92, 100, 64], [70, 76, 48]], level: 4 },
  c2: { name: { ja: "サンド", en: "Sand" }, kind: "solid", colors: [[196, 170, 120], [160, 136, 92]], level: 7 },
  c3: { name: { ja: "ミッドナイト", en: "Midnight" }, kind: "solid", colors: [[40, 44, 64], [26, 28, 40]], level: 10 },
  c4: { name: { ja: "ウッドランド", en: "Woodland" }, kind: "woodland", colors: [[70, 90, 48], [110, 92, 60], [36, 40, 30], [130, 128, 84]], level: 13 },
  c5: { name: { ja: "ディジタル", en: "Digital" }, kind: "digital", colors: [[128, 130, 136], [92, 96, 104], [60, 62, 70], [168, 170, 172]], level: 17 },
  c6: { name: { ja: "タイガー", en: "Tiger Stripe" }, kind: "tiger", colors: [[176, 120, 50], [40, 34, 28], [120, 90, 44]], level: 21 },
  c7: { name: { ja: "ゴールド", en: "Gold" }, kind: "gold", colors: [[236, 186, 60], [180, 130, 30], [255, 232, 140]], level: 26 },
  c8: { name: { ja: "ダイヤモンド", en: "Diamond" }, kind: "diamond", colors: [[120, 230, 236], [70, 180, 200], [220, 255, 255]], level: 30 },
};

// ---------------------------------------------------------------------------
//  階級（1〜50）
// ---------------------------------------------------------------------------
export const RANK_MAX = 50;

/**
 * 階級 r から r+1 に必要な経験値
 * @param {number} r
 * @returns {number}
 */
export function rankXpToNext(r) {
  return Math.round(300 + r * 90 + r * r * 6);
}

export const RANK_XP_TABLE = (() => {
  const t = [0, 0];
  for (let r = 1; r < RANK_MAX; r++) t.push(t[r] + rankXpToNext(r));
  return t;
})();

/** 称号（from の階級から） */
export const RANK_TITLES = [
  { from: 1, name: { ja: "新兵", en: "Recruit" } },
  { from: 3, name: { ja: "二等兵", en: "Private" } },
  { from: 6, name: { ja: "一等兵", en: "Private First Class" } },
  { from: 9, name: { ja: "上等兵", en: "Specialist" } },
  { from: 12, name: { ja: "伍長", en: "Corporal" } },
  { from: 15, name: { ja: "軍曹", en: "Sergeant" } },
  { from: 19, name: { ja: "曹長", en: "Master Sergeant" } },
  { from: 23, name: { ja: "准尉", en: "Warrant Officer" } },
  { from: 27, name: { ja: "少尉", en: "Second Lieutenant" } },
  { from: 31, name: { ja: "中尉", en: "Lieutenant" } },
  { from: 35, name: { ja: "大尉", en: "Captain" } },
  { from: 39, name: { ja: "少佐", en: "Major" } },
  { from: 43, name: { ja: "中佐", en: "Lieutenant Colonel" } },
  { from: 47, name: { ja: "大佐", en: "Colonel" } },
  { from: 50, name: { ja: "将軍", en: "General" } },
];

/** 階級グリフ（名前の横に付ける。10 段階。glyph_E1 ページのコード位置） */
export const RANK_GLYPHS = [
  { from: 1, code: 0 }, { from: 6, code: 1 }, { from: 12, code: 2 }, { from: 15, code: 3 }, { from: 23, code: 4 },
  { from: 27, code: 5 }, { from: 35, code: 6 }, { from: 39, code: 7 }, { from: 47, code: 8 }, { from: 50, code: 9 },
];

/** 階級経験値の源 */
export const RANK_XP = { kill: 20, headshot: 10, pvpKill: 40, challengeDaily: 300, challengeWeekly: 1200, matchWin: 250, matchPlay: 80, wave: 30, structureClear: 150 };

// ---------------------------------------------------------------------------
//  チャレンジ：デイリー 3・ウィークリー 3。日（週）の番号とプレイヤー ID で選ぶ
//  stat … 統計のどの値の「増分」を数えるか。filter … 条件
// ---------------------------------------------------------------------------
export const CHALLENGES = {
  daily: [
    { id: "d_kills", name: { ja: "敵を {n} 体倒す", en: "Defeat {n} enemies" }, stat: "kills", n: 25, credits: 120, xp: 300 },
    { id: "d_heads", name: { ja: "ヘッドショットで {n} 体倒す", en: "Get {n} headshot kills" }, stat: "headKills", n: 8, credits: 140, xp: 300 },
    { id: "d_smg", name: { ja: "SMG で {n} 体倒す", en: "{n} kills with SMGs" }, stat: "kills", filter: { cat: "smg" }, n: 12, credits: 120, xp: 300 },
    { id: "d_ar", name: { ja: "アサルトライフルで {n} 体倒す", en: "{n} kills with assault rifles" }, stat: "kills", filter: { cat: "assault" }, n: 12, credits: 120, xp: 300 },
    { id: "d_shotgun", name: { ja: "ショットガンで {n} 体倒す", en: "{n} kills with shotguns" }, stat: "kills", filter: { cat: "shotgun" }, n: 10, credits: 120, xp: 300 },
    { id: "d_long", name: { ja: "50 ブロック以上の距離で {n} 体倒す", en: "{n} kills from 50+ blocks" }, stat: "longKills", n: 4, credits: 160, xp: 300 },
    { id: "d_melee", name: { ja: "近接で {n} 体倒す", en: "{n} melee kills" }, stat: "meleeKills", n: 5, credits: 140, xp: 300 },
    { id: "d_explosive", name: { ja: "爆発物で {n} 体倒す", en: "{n} explosive kills" }, stat: "explosiveKills", n: 6, credits: 140, xp: 300 },
    { id: "d_heal", name: { ja: "医療品を {n} 回使う", en: "Use {n} medical items" }, stat: "medsUsed", n: 5, credits: 100, xp: 300 },
    { id: "d_hollow", name: { ja: "ホロウを {n} 体倒す", en: "Defeat {n} Hollow" }, stat: "kills", filter: { faction: "hollow" }, n: 15, credits: 130, xp: 300 },
  ],
  weekly: [
    { id: "w_kills", name: { ja: "敵を {n} 体倒す", en: "Defeat {n} enemies" }, stat: "kills", n: 250, credits: 800, xp: 1200 },
    { id: "w_heads", name: { ja: "ヘッドショットで {n} 体倒す", en: "{n} headshot kills" }, stat: "headKills", n: 80, credits: 900, xp: 1200 },
    { id: "w_struct", name: { ja: "構造物を {n} か所制圧する", en: "Clear {n} structures" }, stat: "structuresCleared", n: 3, credits: 900, xp: 1200 },
    { id: "w_wave", name: { ja: "ホードで通算 {n} ウェーブ生き残る", en: "Survive {n} Horde waves" }, stat: "wavesSurvived", n: 20, credits: 900, xp: 1200 },
    { id: "w_match", name: { ja: "ゲームモードで {n} 回勝つ", en: "Win {n} matches" }, stat: "matchWins", n: 3, credits: 1000, xp: 1200 },
    { id: "w_sniper", name: { ja: "スナイパーで {n} 体倒す", en: "{n} kills with sniper rifles" }, stat: "kills", filter: { cat: "sniper" }, n: 60, credits: 800, xp: 1200 },
    { id: "w_legion", name: { ja: "レギオンを {n} 体倒す", en: "Defeat {n} Legion machines" }, stat: "kills", filter: { faction: "legion" }, n: 60, credits: 850, xp: 1200 },
    { id: "w_streak", name: { ja: "キルストリークを {n} 回使う", en: "Call in {n} killstreaks" }, stat: "streaksUsed", n: 8, credits: 800, xp: 1200 },
  ],
  perPeriod: 3,
};

// ---------------------------------------------------------------------------
//  統計（プレイヤーのダイナミックプロパティ a:stats。分割保存・バージョン付き）
// ---------------------------------------------------------------------------
export const STAT_KEYS = [
  "kills", "deaths", "headKills", "shots", "hits", "headHits", "longest", "meleeKills", "explosiveKills", "longKills",
  "medsUsed", "structuresCleared", "wavesSurvived", "matchWins", "matchesPlayed", "streaksUsed", "bossKills", "creditsEarned",
];

/** 1 つのダイナミックプロパティに入れる JSON の上限（文字数）。超えたら a:prog.1, a:prog.2 … に分ける */
export const SAVE_CHUNK = 30000;
export const SAVE_VERSION = 1;
