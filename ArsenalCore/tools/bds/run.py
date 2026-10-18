"""BDS（Bedrock Dedicated Server）をアドオン入りで起動し、コンソールにコマンドを流してログを返す（実機での確認用）

  BDS_DIR=<bedrock_server のあるフォルダ> python3 tools/bds/run.py <ArsenalCore ルート> <待ち秒> [コマンド... | sleep:秒]

  DEV_DEBUG=<出力ディレクトリ> … tools/bds/debugclient.mjs を待ち受けで起動し、BDS から script debugger connect でつなぐ。
                   例外のたびに止めてスタックと変数を記録し（exceptions.json）、診断の値（stats.tsv）を集める。
                   DEV_PROFILE="開始秒,終了秒" で CPU プロファイル（capture.cpuprofile）も取る
  DEV_GAMETEST=1 … BDS に置くコピーだけ @minecraft/server-gametest に依存させ、tools/bds/scenarios.js を読み込む
                   （ワールドの「ベータ API」も有効にする）。シミュレートプレイヤーで撃つ・投げる・ロックオンを再現できる。
                   例：scriptevent dev:setup → dev:bullet 10 / dev:lead 1 / dev:c4 / dev:lock
  配布物（ArsenalCore_BP / RP）は書き換えない。
"""
import json, os, shutil, subprocess, sys, time, threading
SRV = os.environ.get("BDS_DIR") or sys.exit("BDS_DIR を指定してください")
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import nbt  # noqa: E402
root, wait = sys.argv[1], float(sys.argv[2])
cmds = sys.argv[3:]
props = open(os.path.join(SRV, "server.properties")).read().splitlines()
want = {"content-log-console-output-enabled": "true", "content-log-level": "verbose", "allow-cheats": "true",
        "level-name": "arsenal_test", "online-mode": "false", "allow-list": "false", "enable-lan-visibility": "false",
        "level-seed": "12345", "view-distance": "10", "tick-distance": "4"}
if os.environ.get("DEV_DEBUG"):
    want["allow-outbound-script-debugging"] = "true"
out = []
for line in props:
    k = line.split("=", 1)[0]
    out.append(f"{k}={want.pop(k)}" if k in want else line)
out += [f"{k}={v}" for k, v in want.items()]
open(os.path.join(SRV, "server.properties"), "w").write("\n".join(out) + "\n")
packs = []
for kind, src, dstdir in (("bp", "ArsenalCore_BP", "behavior_packs"), ("rp", "ArsenalCore_RP", "resource_packs")):
    dst = os.path.join(SRV, dstdir, "ArsenalCore_" + kind.upper())
    shutil.rmtree(dst, ignore_errors=True)
    shutil.copytree(os.path.join(root, src), dst)
    m = json.load(open(os.path.join(dst, "manifest.json")))
    if kind == "bp" and os.environ.get("DEV_GAMETEST"):
        # 試験用のコピーだけ：シミュレートプレイヤーをアドオンのスクリプトから扱えるよう gametest に依存させる
        m["dependencies"].append({"module_name": "@minecraft/server-gametest", "version": "1.0.0-beta"})
        json.dump(m, open(os.path.join(dst, "manifest.json"), "w"))
        inj = os.environ.get("DEV_INJECT") or os.path.join(HERE, "scenarios.js")
        if inj:
            shutil.copy(inj, os.path.join(dst, "scripts", "devtest.js"))
            # 通し試験（tools/bds/fulltest.js）も一緒に置き、devtest から読み込む
            shutil.copy(os.path.join(HERE, "fulltest.js"), os.path.join(dst, "scripts", "fulltest.js"))
            with open(os.path.join(dst, "scripts", "main.js"), "a") as f:
                f.write('\nimport "./devtest.js";\n')
    packs.append((kind, m["header"]["uuid"], m["header"]["version"]))
extra = os.environ.get("EXTRA_BP")
if extra:
    dst = os.path.join(SRV, "behavior_packs", os.path.basename(extra))
    shutil.rmtree(dst, ignore_errors=True)
    shutil.copytree(extra, dst)
    m = json.load(open(os.path.join(dst, "manifest.json")))
    packs.append(("bp", m["header"]["uuid"], m["header"]["version"]))
world = os.path.join(SRV, "worlds", "arsenal_test")
os.makedirs(world, exist_ok=True)
for kind, fn in (("bp", "world_behavior_packs.json"), ("rp", "world_resource_packs.json")):
    json.dump([{"pack_id": u, "version": v} for k, u, v in packs if k == kind], open(os.path.join(world, fn), "w"))
lvl = os.path.join(world, "level.dat")
if os.environ.get("DEV_GAMETEST") and os.path.exists(lvl):
    ver, name, root_ = nbt.load(lvl)
    root_["experiments"] = (10, {"experiments_ever_used": (1, 1), "saved_with_toggled_experiments": (1, 1), "gametest": (1, 1)})
    root_["cheatsEnabled"] = (1, 1)
    nbt.save(lvl, ver, name, root_)
env = dict(os.environ, LD_LIBRARY_PATH=SRV)
p = subprocess.Popen(["./bedrock_server"], cwd=SRV, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, env=env, bufsize=1)
lines = []
started = threading.Event()
def reader():
    for ln in p.stdout:
        lines.append(ln.rstrip())
        if "Server started" in ln:
            started.set()
threading.Thread(target=reader, daemon=True).start()
started.wait(120)
time.sleep(2)
client = None
if os.environ.get("DEV_DEBUG"):
    uuid = next(m["uuid"] for m in json.load(open(os.path.join(root, "ArsenalCore_BP", "manifest.json")))["modules"] if m["type"] == "script")
    total = wait + sum(float(c[6:]) if c.startswith("sleep:") else 0.5 for c in cmds) + 2
    prof = (os.environ.get("DEV_PROFILE") or "").split(",") if os.environ.get("DEV_PROFILE") else []
    client = subprocess.Popen(["node", os.path.join(HERE, "debugclient.mjs"), "19144", uuid, os.environ["DEV_DEBUG"], str(total), *prof])
    time.sleep(1.5)
    p.stdin.write("script debugger connect localhost 19144\n"); p.stdin.flush()
    time.sleep(3)
for c in cmds:
    if c.startswith("sleep:"):
        time.sleep(float(c[6:])); continue
    p.stdin.write(c + "\n"); p.stdin.flush(); time.sleep(0.5)
time.sleep(wait)
if client:
    try:
        client.wait(30)
    except subprocess.TimeoutExpired:
        client.kill()
p.stdin.write("stop\n"); p.stdin.flush()
try:
    p.wait(60)
except subprocess.TimeoutExpired:
    p.kill()
print("\n".join(lines))
