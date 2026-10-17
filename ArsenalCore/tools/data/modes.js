// ARSENAL CORE データ定義（tools/data/）。ランタイムにはビルド時に 1 ファイル（BP/scripts/config/weapons.data.js）へまとめて出力する。
// ゲームモード（2.0 で追加）
//
// 共通の流れ：OP がアリーナツールでアリーナ（範囲・スポーン・旗）を登録 → ロビーで参加受付（lobbySecs）
//  → 開始時に参加者のインベントリ・位置・ゲームモード・体力を保存 → 装備セットを配布 → ラウンド
//  → 終了で結果画面 → 保存した状態に戻す。状態はワールドのダイナミックプロパティに保存し、再起動で復旧する
//
//  teams     … 0 なら個人戦
//  scoreLimit / timeLimit（秒）… どちらかに達したら終了
//  respawn   … リスポーンまでの秒数（0 ならすぐ）。null なら復活しない（ホードではウェーブ終了で復活）
//  loadouts  … 選べる装備セット（LOADOUTS の ID）
//  streaks   … キルストリークを使えるか

export const MODES = {
  ffa: {
    name: { ja: "フリー・フォー・オール", en: "Free-for-All" },
    desc: { ja: "全員が敵。先に目標キル数に達した人が勝ち", en: "Everyone for themselves. First to the kill limit wins" },
    teams: 0, minPlayers: 2, scoreLimit: 20, timeLimit: 600, respawn: 3, loadouts: ["assault", "cqb", "marksman", "support"], streaks: true, lobbySecs: 20,
  },
  tdm: {
    name: { ja: "チームデスマッチ", en: "Team Deathmatch" },
    desc: { ja: "2 チームに分かれ、チームのキル数で競う", en: "Two teams race to the kill limit" },
    teams: 2, minPlayers: 2, scoreLimit: 40, timeLimit: 600, respawn: 4, loadouts: ["assault", "cqb", "marksman", "support"], streaks: true, lobbySecs: 20,
  },
  gungame: {
    name: { ja: "ガンゲーム", en: "Gun Game" },
    desc: { ja: "キルごとに武器が変わる。最後の近接武器で倒した人が勝ち", en: "Each kill swaps your gun. Win with the final melee kill" },
    teams: 0, minPlayers: 2, scoreLimit: 0, timeLimit: 900, respawn: 2, loadouts: [], streaks: false, lobbySecs: 20,
    ladder: ["vx9", "wasp", "midge", "hornet", "stinger", "drifter", "sentinel", "tempest", "monsoon", "longbow", "halberd", "kitehawk", "breacher", "thresher", "juggernaut", "nightjar", "falcon", "thumper", "ironclad45", "combat_knife"],
    demoteOnMelee: true,
  },
  horde: {
    name: { ja: "ホード", en: "Horde" },
    desc: { ja: "協力してホロウのウェーブを生き延びる。ウェーブの合間に買い物", en: "Survive waves of Hollow together. Shop between waves" },
    teams: 1, minPlayers: 1, scoreLimit: 0, timeLimit: 0, respawn: null, loadouts: ["assault", "cqb", "marksman", "support"], streaks: true, lobbySecs: 15,
    waves: 15, bossEvery: 5, breakSecs: 25, baseCount: 6, perWave: 3, perPlayer: 0.6, maxAlive: 24,
    boss: { 5: "hollow_brute_pack", 10: "boss_warlord", 15: "boss_juggernaut" },
  },
  koth: {
    name: { ja: "陣取り", en: "King of the Hill" },
    desc: { ja: "丘（旗の位置）を占領し続けたチームにポイント", en: "Hold the hill (flag point) to score" },
    teams: 2, minPlayers: 2, scoreLimit: 150, timeLimit: 720, respawn: 5, loadouts: ["assault", "cqb", "marksman", "support"], streaks: true, lobbySecs: 20,
    hillRadius: 4, hillMoveSecs: 90, pointsPerSec: 1,
  },
};

/** チーム */
export const TEAMS = [
  { id: 0, name: { ja: "アルファ", en: "Alpha" }, color: "§c", rgb: [220, 70, 60] },
  { id: 1, name: { ja: "ブラボー", en: "Bravo" }, color: "§9", rgb: [70, 110, 230] },
];

/**
 * 装備セット。items は [ID, 個数]。弾薬は "@ammo" で主武器の弾（数は個数）。
 * armor は [頭, 胴]。gear は投擲物など
 */
export const LOADOUTS = {
  assault: {
    name: { ja: "突撃兵", en: "Assault" }, primary: "sentinel", secondary: "vx9", melee: "combat_knife",
    attachments: { sentinel: { optic: "optic_reddot", underbarrel: "grip_vertical" } },
    ammo: [["@primary", 180], ["@secondary", 45]], gear: [["arsenal:grenade_frag", 2], ["arsenal:bandage", 2]], armor: ["arsenal:helmet_standard_1", "arsenal:vest_standard_1"], plates: 2,
  },
  cqb: {
    name: { ja: "近接戦闘", en: "Close Quarters" }, primary: "hornet", secondary: "breacher", melee: "machete",
    attachments: { hornet: { optic: "optic_holo", laser: "laser_tactical" } },
    ammo: [["@primary", 200], ["@secondary", 24]], gear: [["arsenal:grenade_flash", 2], ["arsenal:bandage", 2]], armor: ["arsenal:helmet_light_1", "arsenal:vest_light_1"], plates: 1,
  },
  marksman: {
    name: { ja: "狙撃手", en: "Marksman" }, primary: "marksman12", secondary: "wasp", melee: "combat_knife",
    attachments: { marksman12: { optic: "optic_4x" } },
    ammo: [["@primary", 72], ["@secondary", 60]], gear: [["arsenal:grenade_smoke", 1], ["arsenal:claymore", 1], ["arsenal:bandage", 2]], armor: ["arsenal:helmet_light_1", "arsenal:vest_light_1"], plates: 1,
  },
  support: {
    name: { ja: "援護兵", en: "Support" }, primary: "juggernaut", secondary: "vx9", melee: "riot_baton",
    attachments: { juggernaut: { optic: "optic_reddot" } },
    ammo: [["@primary", 300], ["@secondary", 45]], gear: [["arsenal:grenade_frag", 1], ["arsenal:medkit", 1]], armor: ["arsenal:helmet_heavy_1", "arsenal:vest_heavy_1"], plates: 3,
  },
};

/** アリーナの上限 */
export const ARENA_LIMITS = { maxArenas: 8, maxSize: 256, minSize: 12, maxSpawns: 16, maxPlayers: 20 };
