// ARSENAL CORE データ定義（tools/data/）。ランタイムにはビルド時に 1 ファイル（BP/scripts/config/weapons.data.js）へまとめて出力する。
// 武器定義の共通ヘルパ・フィールドの意味

// ---------------------------------------------------------------------------
//  武器
//  dmg … 1 発（1 ペレット）の基礎ダメージ / head … ヘッドショット倍率 / range [有効, 最大] / falloff … 最大射程での倍率
//  spread … { hip, ads, move(加算), bloom(1発ごと), bloomMax, recover(1tickあたり) }
//  recoil … { v: 縦(度), h: 横ブレ幅(度), shake: 画面揺れ }
//  reload … { tac, empty } tick。single … { start, per, end } は 1 発ずつ装填
//  ads … ADS 所要 tick / move … 所持中の移動速度倍率 / pen … 貫通力 / ap … 防具無視率
//  fire … "hitscan" | "ballistic"（弾道落下）| "gl40" | "rocket" | "seeker" | "flare" | "arc" | "cryo" | "rail" | "grapple" | "pulse"
//  modes … "semi" | "auto" | "burstN" | "double"
//  slots … 装着可能なアタッチメント枠 / fixed … 固定パーツ（取り外し不可）
//  sound … 射撃音セット / pitch … 音程補正
//  model … 3D モデル生成パラメータ（tools/modelgen.py が解釈）
// ---------------------------------------------------------------------------
export const R = (hip, ads, move, bloom, bloomMax, recover) => ({ hip, ads, move, bloom, bloomMax, recover });
