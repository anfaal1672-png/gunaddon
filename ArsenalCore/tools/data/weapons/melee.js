// ARSENAL CORE データ定義（tools/data/）。ランタイムにはビルド時に 1 ファイル（BP/scripts/config/weapons.data.js）へまとめて出力する。
// 近接武器（2.0 で追加）。銃とは別の表（MELEE）で持ち、見た目はバニラの剣と同じ手持ち表示（2D を立体化）にする。
//  dmg … 1 撃のダメージ / backstab … 背後からの倍率（プレイヤーにはワールド設定の倍率上限がかかる）
//  special … "throw"（使用で投げる）| "breach"（ドアを壊す）| "stun"（鈍足・弱体）| "spring"（刃を射出）| "vibro"（防具無視・炎）
export const MELEE = {
  combat_knife: {
    cat: "melee", tier: "common", name: { ja: "コンバットナイフ", en: "Combat Knife" },
    desc: { ja: "素早い刺突。背後からは一撃。使用で投げられる", en: "Quick stabs, lethal from behind. Use to throw" },
    dmg: 6, backstab: 5.0, durability: 400, special: "throw", throwDmg: 9, reach: 3.0, move: 1.1,
  },
  machete: {
    cat: "melee", tier: "common", name: { ja: "マチェット", en: "Machete" },
    desc: { ja: "重い刃で薙ぎ払う。周りの敵にも少し当たる", en: "Heavy blade that sweeps nearby foes" },
    dmg: 7, backstab: 3.0, durability: 500, special: "sweep", reach: 3.0, move: 1.05,
  },
  breaching_axe: {
    cat: "melee", tier: "uncommon", name: { ja: "ブリーチングアックス", en: "Breaching Axe" },
    desc: { ja: "ドアや柵に向けて使うと一撃で破壊する突入用の斧", en: "Use on doors, trapdoors and fences to smash them" },
    dmg: 8, backstab: 2.5, durability: 600, special: "breach", reach: 3.0, move: 1.0,
  },
  riot_baton: {
    cat: "melee", tier: "uncommon", name: { ja: "ライオットバトン", en: "Riot Baton" },
    desc: { ja: "電撃付きの警棒。当てた相手を 2 秒間スタンさせる", en: "Shock baton: stuns for 2 seconds" },
    dmg: 5, backstab: 2.0, durability: 800, special: "stun", reach: 3.0, move: 1.05,
  },
  spring_knife: {
    cat: "melee", tier: "rare", name: { ja: "スプリングナイフ", en: "Spring Knife" },
    desc: { ja: "使用で刃を射出（10 ダメージ）。刃が戻るまで 5 秒", en: "Use to launch the blade (10 dmg). 5s to re-arm" },
    dmg: 6, backstab: 5.0, durability: 400, special: "spring", throwDmg: 10, cooldown: 100, reach: 3.0, move: 1.1,
  },
  vibro_blade: {
    cat: "melee", tier: "legendary", name: { ja: "ヴァイブロブレード", en: "Vibro-blade" },
    desc: { ja: "高周波の刃。防具の半分を無視し、斬った相手を燃やす", en: "High-frequency blade: ignores half of armor, ignites" },
    dmg: 11, backstab: 3.0, durability: 1500, special: "vibro", ap: 0.5, fireSecs: 3, reach: 3.2, move: 1.08,
  },

  // ---- 2.3 で追加 ----
  tomahawk: {
    cat: "melee", tier: "uncommon", name: { ja: "トマホーク", en: "Tomahawk" },
    desc: { ja: "片手斧。スニークしながら使うと投げられる（11 ダメージ）", en: "Hatchet. Sneak + use to throw it (11 dmg)" },
    dmg: 7, backstab: 3.0, durability: 600, special: "throw", throwDmg: 11, reach: 3.0, move: 1.06,
  },
  war_hammer: {
    cat: "melee", tier: "rare", name: { ja: "ウォーハンマー", en: "War Hammer" },
    desc: { ja: "重い戦鎚。当てた相手をよろめかせる。振りは遅い", en: "Heavy hammer that staggers. Slow to swing" },
    dmg: 10, backstab: 2.0, durability: 900, special: "stun", reach: 3.1, move: 0.95,
  },
  kukri: {
    cat: "melee", tier: "common", name: { ja: "ククリ", en: "Kukri" },
    desc: { ja: "内反りの山刀。素早く振れて周りの敵にも当たる", en: "Recurved blade: fast sweeping cuts" },
    dmg: 6.5, backstab: 4.0, durability: 500, special: "sweep", reach: 2.9, move: 1.1,
  },
  katana: {
    cat: "melee", tier: "rare", name: { ja: "カタナ", en: "Katana" },
    desc: { ja: "長い刀。間合いが広く、薙ぎ払いで周りの敵も斬る", en: "Long blade with extra reach that sweeps" },
    dmg: 8.5, backstab: 3.5, durability: 800, special: "sweep", reach: 3.5, move: 1.04,
  },
};
