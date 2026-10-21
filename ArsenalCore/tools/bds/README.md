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
| `dev:hud2` | HUD 2.0 で 60 tick 向きを変え続け、タイトルとサブタイトルが変わった回数を出す（タイトルは変わらず、サブタイトルだけが変わるはず） |
| `dev:ariadne back` / `window` / `closed` / `swap` | アリアドネ：小屋の中のゾンビを壁越しに覗いてロックし撃つ。裏の穴・正面の端の窓・穴なし・飛行中に穴をふさぐ。ミサイルがブロックの中に入った回数（`inside`）も出す |

注意：BDS の試験用コピーだけ `@minecraft/server-gametest`（ベータ）に依存させます。配布するパックは安定版の API だけです。バニラのゾンビは 40 ブロックより遠いと出した直後に消えるので、的は 40 ブロック以内に置きます。

## アドオン全体の通し試験（2.4.2）

`tools/bds/fulltest.js`（`scenarios.js` から読み込む）は、シミュレートプレイヤーでアドオンの中身を全部さわる通し試験です。ステージごとに `scriptevent dev:full <ステージ>` で始め、ログの `[FULL]` 行に `BEGIN` / `FAIL <ステージ> <id> <理由>` / `END fails=<数>` が出ます（`CRASH` は試験そのものの例外）。

| ステージ | 内容 |
|---|---|
| `weapons [開始 終了]` | 全武器を 1 挺ずつ持たせ、覗いて 8.5 ブロック先のゾンビを撃つ。撃てたか（`shot` イベント）・当たったか・リロードできるか |
| `melee` | 近接武器で殴ってダメージが入るか |
| `throw` | 投擲物を投げる・地雷を置く・C4 を起爆する。アイテムが減るか |
| `gear` | 医療品を使う、設置物を置く（砲台は撃つか）、ドローンを飛ばす、銃座・乗り物に乗って撃つ |
| `enemies` | 敵を 1 体ずつ出し、12 秒以内にプレイヤーを攻撃するか、倒せるか |
| `bosses` | ボスを呼ぶアイテムで呼び、段階を進めて倒し、増援が消えるか |
| `structures` | 構造物を置き、守備隊がそろうか |
| `streaks` | キルストリークを全部使う |
| `modes` | アリーナを作り、全モードで 2 人の試合を始めて撃ち合い、終える |
| `misc` | 購入・売却、メニューを開くアイテム、ワールド設定（弾が飛ぶ・マガジン単位・部位）を切った状態で撃つ、HUD の切り替え |
| `diag <武器 id>` | 1 挺を撃ち、1 発ごとに ADS・拡散・視線と的のずれを出す（当たらない武器の調査用） |

例：`BDS_DIR=<展開先> DEV_GAMETEST=1 DEV_DEBUG=out python3 tools/bds/run.py . 3 "time set noon" "gamerule domobspawning false" "sleep:3" "scriptevent dev:full weapons" "sleep:300"`

### デバッガ（Minecraft Bedrock Debugger のプロトコル）

`DEV_DEBUG=<出力ディレクトリ>` を付けると、`tools/bds/debugclient.mjs` が 19144 番で待ち受け、BDS から `script debugger connect localhost 19144` でつなぎます（`server.properties` の `allow-outbound-script-debugging=true`。BDS 側で待ち受ける `listen` は接続がすぐ切られるので使わない）。プロトコルは Mojang の VS Code 拡張「Minecraft Bedrock Debugger」（`Mojang/minecraft-debugger`）と同じもの（長さ 8 桁の 16 進＋改行＋1 行の JSON）。

- `exceptions.json` … 例外のたびにスクリプトを止め、スタック（関数名・行）と一番上のフレームのローカル変数を記録して再開する。`try` で捕まえる例外でも止まるので、「捕まえているが毎回投げている」箇所も見つかる
- `stats.tsv` … エンジンが送る診断の値（`server_tick_timings/script_tick` など、µs）の最大・平均・最後
- `debugger.log` … `console.*` の出力と停止の記録
- `DEV_PROFILE="開始秒,終了秒"` … その間の CPU プロファイル（`capture.cpuprofile`。Chrome DevTools で開ける）。`python3 tools/bds/profsummary.py capture.cpuprofile` で自己時間・累計時間の上位を出す

注意：例外で止まっている間はスクリプトが止まるので、そのあいだの `script_tick` は大きく出る（数百 ms）。負荷を見るときは例外の少ない区間で見る。プロファイルの `World::getAllPlayers` などのネイティブ関数は、待ち時間がそこに数えられていることがある。

`specials`（2.5）… 特殊武器の実機でしか確かめられない動き：ブリンクで壁の手前へ移る、スマートピストルで照準の外の 2 体に当たる、メディックビームで味方（PvP なし）を回復、網と麻酔で動けなくなる、シンギュラリティで近くのゾンビが中心へ寄る、銛で手前へ引き寄せる、衛星砲が 2 秒後に落ちる

`nukes`（2.6）… エイムアシストで照準が敵へ寄る、アルバトロスの巡航ミサイルが上昇して敵に当たる、誘導ミサイルを操縦して足元の敵に当てる、核ミサイルが 10 秒後に落ちて敵を倒す、置いた戦術核が 15 秒後に爆発して近くの敵を倒し、爆風の外の敵は残る（闘技場は山の中なので、ミサイルの落ちる経路の岩を抜く）

`v3`（3.0）… 重装兵のアビリティで被ダメージが減る、分隊を 2 人雇ってゾンビを撃たせる（持ち主は撃たない）、持ち主について来る、「待て」で止まる、解散。依頼（掃討・賞金首）を受けて目標地点へ行くと敵が出て、倒すと完了する（実機の `getTopmostBlock` で地表に出る、賞金首の体力強化と名前）

`facetest` … 石 1 個に 6 方向からレイを撃ち、`getBlockFromRay` の `face` と `faceLocation` を出す（実機では面に垂直な軸がいつも 0。`util/math.js` の `hitPoint` を参照）
