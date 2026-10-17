// ARSENAL CORE データ定義（tools/data/）。ランタイムにはビルド時に 1 ファイル（BP/scripts/config/weapons.data.js）へまとめて出力する。
// HUD 2.0（JSON UI）へのデータ受け渡しの形式。スクリプト（ui/hud2.js）が符号化し、生成スクリプト（gen/ui.py）が復号側の JSON UI を作る。
//
// タイトルの文字列 = HEADER + 固定長のフィールド（ASCII のみ）+ 目印 "§a§r§s§n" + "§" + スコープ表示の番号
//   ・先頭を ASCII の固定長にしているので、JSON UI の ('%.Ns' * #t) で先頭 N 文字を取り出し、
//     「先頭 k+n 文字」から「先頭 k 文字」を引く（- 演算）ことで k 文字目から n 文字を切り出せる
//   ・HEADER は '|' を含み、フィールドの値（英数字と空白）には現れないので、引き算で誤って消えることがない
//   ・目印を含むタイトルは、バニラのタイトル枠ごと隠れる（1.0.2 と同じ）
export const HUD2 = {
  header: "AC2|",
  mark: "§a§r§s§n",
  fields: [
    // 名前・長さ・意味
    { name: "hit", len: 1, doc: "ヒットマーカー 0 なし / 1 命中 / 2 頭 / 3 キル" },
    { name: "dir", len: 1, doc: "被弾方向 0 なし / 1〜8（前・右前・右・右後・後・左後・左・左前）" },
    { name: "xh", len: 1, doc: "クロスヘアの広がり 0〜9 / x 非表示" },
    { name: "ammo", len: 3, doc: "装弾数（右寄せ、空白埋め）/ --- 弾薬なし" },
    { name: "res", len: 4, doc: "予備弾（右寄せ）/ INF 無限" },
    { name: "mode", len: 1, doc: "射撃モード S セミ / A フル / B バースト / C チャージ / D 二連 / U アンダーバレル / M 近接 / - なし" },
    { name: "st", len: 1, doc: "状態 0 なし / R リロード / J ジャム / H 過熱 / L ロック中 / K ロック完了 / B 息止め / E 弾切れ / P スポーン保護 / X 故障" },
    { name: "heat", len: 1, doc: "熱・充電・リロード進行 0〜9" },
    { name: "plate", len: 1, doc: "プレート残り 0〜4 / - ボディアーマーなし" },
    { name: "hp", len: 2, doc: "体力（切り上げ、00〜99）" },
    { name: "hdg", len: 2, doc: "方位 00〜15（22.5° ごと、00 = 南）" },
    { name: "sup", len: 1, doc: "制圧 0〜3" },
    { name: "nvg", len: 1, doc: "暗視の画面効果 0 / 1" },
    { name: "gm", len: 1, doc: "ゲームモード 0 なし / 1 FFA / 2 TDM / 3 ガンゲーム / 4 ホード / 5 陣取り" },
    { name: "sa", len: 4, doc: "得点 A（自分／味方チーム／ウェーブ）" },
    { name: "sb", len: 4, doc: "得点 B（目標／敵チーム／残り敵）" },
    { name: "tm", len: 4, doc: "残り時間 m:ss（右寄せ）" },
    { name: "stk", len: 2, doc: "連続キル" },
    { name: "cr", len: 6, doc: "クレジット（右寄せ）" },
    { name: "ks", len: 1, doc: "キルストリーク使用可能 0 / 1" },
    { name: "rng", len: 4, doc: "測距の距離（右寄せ）/ ---- なし" },
    { name: "wdir", len: 1, doc: "風の向き（視線に対して 8 方向）0〜7 / - なし（狙撃スコープ中のみ）" },
    { name: "wstr", len: 1, doc: "風の強さ 1〜3 / - なし" },
    { name: "sz", len: 1, doc: "HUD の大きさ 0 小 / 1 標準 / 2 大" },
    { name: "lay", len: 1, doc: "配置 0 標準 / 1 高め（スマホの操作ボタンを避ける）/ 2 左寄せ" },
  ],
  /** 送信間隔（変化がなくてもこの tick ごとに再送する。タイトルの表示時間より短く） */
  resendTicks: 10,
  stayTicks: 40,
};

/** フィールドの位置（先頭からのバイト＝文字位置）を付けた表 */
export const HUD2_LAYOUT = (() => {
  let at = HUD2.header.length;
  /** @type {Record<string, {at:number, len:number}>} */
  const out = {};
  for (const f of HUD2.fields) {
    out[f.name] = { at, len: f.len };
    at += f.len;
  }
  return { fields: out, length: at };
})();
