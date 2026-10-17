# BDS での実機確認（開発用）

JSON UI（画面）以外の挙動は、BDS（Bedrock Dedicated Server、Linux 版）で本物のエンジンを動かして確かめられます。

1. BDS を取得して展開する（Linux 版。ダウンロードの一覧：`https://net-secondary.web.minecraft-services.net/api/v1.0/download/links`）
2. `python3 tools/build.py --no-audio` でパックを作る
3. `BDS_DIR=<展開先> python3 tools/bds/run.py . 5` … 読み込みとコンテンツログのエラーを確認
4. `BDS_DIR=<展開先> DEV_GAMETEST=1 python3 tools/bds/run.py . 3 "time set midnight" "sleep:5" "scriptevent dev:setup" "sleep:2" "scriptevent dev:lead 1" "sleep:8"`
   … シミュレートプレイヤーで撃つ。ログの `[DEVTEST]` 行に結果が出る（初回はワールドが作られたあとにもう一度実行するとベータ API が有効になる）

| シナリオ | 内容 |
|---|---|
| `dev:bullet <距離>` | アサルトライフルで撃ち、命中までの tick とダメージ |
| `dev:lead 0` / `dev:lead 1` | 横に走るゾンビを覗いて 5 発。0 は真っすぐ、1 は弾の到達時間ぶん先を狙う |
| `dev:c4` | C4 をゾンビに貼り、5 秒間に押された距離 |
| `dev:lock` / `dev:lock nolock` | 照準を 5° ずらしてシーカーを撃つ（覗いてロックする／しない） |
| `dev:mags` | 5 発撃ってリロード：薬室の 1 発を足して 31 発、抜いたマガジンの残りが途中のマガジンとして残る |
| `dev:limb` | ゾンビの脚を撃ち、鈍足になるか |
| `dev:ready` | 走るのをやめた直後は撃てず、構え終わってから撃つか |
| `dev:indoor` | 石の小屋の中と外の屋内判定 |
| `dev:spawn23` | 2.3 の新しい敵 6 種・自動擲弾銃座・装甲車を出し、3 秒後に残っているか |
| `dev:mother` | ホロウの心臓でホロウ・マザーを呼び、増援が戦闘中に残るか・撃破後に倒れるか |
| `dev:structure <id>` | 構造物を置いて宝箱を数える（例：`dev:structure checkpoint`） |
| `dev:despawn` / `dev:despawn ai` | 出した敵が勝手に消えないか（`ai` はボスの増援と同じ出し方） |
| `dev:ariadne back` / `window` / `closed` / `swap` | アリアドネ：小屋の中のゾンビを壁越しに覗いてロックし撃つ。裏の穴・正面の端の窓・穴なし・飛行中に穴をふさぐ。ミサイルがブロックの中に入った回数（`inside`）も出す |

注意：BDS の試験用コピーだけ `@minecraft/server-gametest`（ベータ）に依存させます。配布するパックは安定版の API だけです。バニラのゾンビは 40 ブロックより遠いと出した直後に消えるので、的は 40 ブロック以内に置きます。
