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

注意：BDS の試験用コピーだけ `@minecraft/server-gametest`（ベータ）に依存させます。配布するパックは安定版の API だけです。バニラのゾンビは 40 ブロックより遠いと出した直後に消えるので、的は 40 ブロック以内に置きます。
