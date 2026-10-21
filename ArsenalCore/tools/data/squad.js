// ARSENAL CORE データ定義（tools/data/）。ランタイムにはビルド時に 1 ファイル（BP/scripts/config/weapons.data.js）へまとめて出力する。
// 分隊（3.0）：クレジットで雇う味方の兵士。持ち主について行き、敵勢力と敵対 mob を撃つ。プレイヤーは撃たない
//
//  weapon … 見た目と弾の基準（WEAPONS の ID）/ damage … 1 発のダメージ / interval・burst・burstInterval … 攻撃の間隔と連射
//  range  … 交戦距離 / sight … 発見距離 / health・speed … 体力・移動速度 / cost … 雇うのに必要なクレジット
//  heal   … 衛生兵：持ち主の体力が減っていれば every tick ごとに amount 回復

export const SQUAD = {
  squad_rifleman: {
    name: { ja: "分隊ライフルマン", en: "Squad Rifleman" }, desc: { ja: "バランスのよい小銃手", en: "Well-rounded rifleman" },
    weapon: "sentinel", health: 40, speed: 0.32, damage: 3.0, interval: [0.6, 1.0], burst: 3, burstInterval: 0.1, range: 26, sight: 30,
    armor: "vest", color: [70, 96, 74], cost: 400,
  },
  squad_gunner: {
    name: { ja: "分隊機関銃手", en: "Squad Gunner" }, desc: { ja: "弾幕で敵を押さえる。足は遅い", en: "Suppresses with long bursts. Slow" },
    weapon: "juggernaut", health: 50, speed: 0.27, damage: 2.2, interval: [1.4, 2.0], burst: 7, burstInterval: 0.08, range: 24, sight: 28,
    armor: "heavy", color: [64, 78, 64], cost: 600,
  },
  squad_marksman: {
    name: { ja: "分隊選抜射手", en: "Squad Marksman" }, desc: { ja: "遠くの敵を 1 発ずつ正確に撃つ", en: "Precise single shots at long range" },
    weapon: "osprey", health: 34, speed: 0.31, damage: 7.5, interval: [1.6, 2.2], burst: 1, burstInterval: 0, range: 40, sight: 46,
    armor: "ghillie", color: [84, 100, 70], cost: 600,
  },
  squad_medic: {
    name: { ja: "分隊衛生兵", en: "Squad Medic" }, desc: { ja: "持ち主の傷を手当てする（6 秒ごとに 4 回復）", en: "Patches you up (4 HP every 6 s)" },
    weapon: "hornet", health: 36, speed: 0.34, damage: 2.0, interval: [1.0, 1.5], burst: 3, burstInterval: 0.07, range: 18, sight: 26,
    armor: "medic", color: [180, 186, 176], cost: 500, heal: { amount: 4, every: 120, below: 0.8 },
  },
};

/** 同時に連れて歩ける人数 */
export const SQUAD_MAX = 2;
/** 持ち主からこれ以上離れたら追いかける / これ以上ならそばへ瞬間移動する（ブロック） */
export const SQUAD_FOLLOW = { near: 4, far: 7, teleport: 40 };
