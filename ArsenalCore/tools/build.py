#!/usr/bin/env python3
"""
ARSENAL CORE — ビルド・検証・パッケージング

  python3 tools/build.py            … 生成 → 検証 → .mcaddon 作成
  python3 tools/build.py --no-audio … 効果音の再合成を省略（既存の .ogg を再利用）

生成物:
  ArsenalCore_BP/  ArsenalCore_RP/  ArsenalCore.mcaddon  docs/WEAPON_STATS.md
"""
import json
import os
import re
import shutil
import subprocess
import sys
import uuid
import zipfile

TOOLS = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(TOOLS)
sys.path.insert(0, TOOLS)

import contentgen  # noqa: E402
import audiogen  # noqa: E402
import lang_ui  # noqa: E402
import lang_ui2  # noqa: E402
import checks2  # noqa: E402
import docsgen  # noqa: E402
import schemacheck  # noqa: E402

BP = os.path.join(ROOT, "ArsenalCore_BP")
RP = os.path.join(ROOT, "ArsenalCore_RP")
SRC_SCRIPTS = os.path.join(ROOT, "src", "scripts")
UUID_NS = uuid.UUID("6f3c1a52-8a1e-4c55-9d1a-2b7e4c0a5a11")

TRADEMARKS = [
    # メーカー・ブランド
    "glock", "colt", "beretta", "kalashnikov", "barrett", "remington", "mossberg", "benelli", "heckler", "koch", "sig sauer", "sauer",
    "magpul", "steyr", "fn herstal", "ruger", "smith & wesson", "smith and wesson", "walther", "springfield armory", "kriss", "taurus",
    "bushmaster", "daniel defense", "noveske", "aimpoint", "eotech", "trijicon", "leupold", "surefire", "streamlight", "browning",
    "winchester", "savage arms", "marlin", "kimber", "sako", "tikka", "accuracy international", "mcmillan", "desert tech",
    "knight's armament", "larue", "lewis machine", "izhmash", "norinco", "zastava", "nexter", "valmet", "keltec", "kel-tec",
    "hi-point", "magnum research", "cheytac", "milkor", "pindad", "daewoo precision", "howa", "tula arms", "molot", "czech small arms",
    "israel weapon industries", "saab bofors", "raytheon", "lockheed", "general dynamics", "dillon aero",
    # 実在の銃・装備の名前
    "ak-47", "ak47", "ak-74", "akm", "m4a1", "ar-15", "ar15", "scar-l", "scar-h", "scar-", "mp5", "mp7", "ump45", "uzi", "desert eagle",
    "minigun", "m16", "m249", "m240", "m60", "mg42", "mg34", "famas", "steyr aug", "fn fal", "fn mag", "p90", "five-seven", "fiveseven",
    "m1911", "thompson", "tommy gun", "dragunov", "m82", "m107", "rpg-7", "javelin", "stinger missile", "at4", "carl gustaf", "m203",
    "m320", "mk 19", "hk416", "g36", "hk g3", "tavor", "galil", "negev", "jericho 941", "svd", "vss vintorez", "as val", "pkm", "rpk",
    "m1 garand", "m14 ebr", "minimi", "awm", "awp", "l96", "tac-50", "scorpion evo", "mac-10", "tec-9", "skorpion", "spas-12", "aa-12",
    "saiga", "ksg", "derringer", "sten gun", "bren gun", "lee-enfield", "mauser", "luger", "makarov", "tokarev", "nagant", "mosin",
    "ppsh", "kar98", "stg 44", "mp40", "honey badger", "m4 carbine", "m27 iar", "qbz-95", "type 56", "vector smg", "kriss vector",
    "browning automatic rifle", "m249 saw", "m1 carbine", "benelli m4", "remington 870", "mossberg 500", "glock 17", "beretta m9",
    "sig p320", "hk usp", "walther ppk", "colt python", "smith & wesson model 29", "barrett m82", "acog", "holosun",
    # ゲーム作品
    "call of duty", "modern warfare", "black ops", "battlefield", "fortnite", "valorant", "counter-strike", "csgo", "cs:go",
    "apex legends", "rainbow six", "escape from tarkov", "tarkov", "pubg", "playerunknown", "halo infinite", "halo reach", "overwatch",
    "borderlands", "titanfall", "warzone", "ghost recon", "splinter cell", "metal gear", "far cry", "crysis", "half-life",
    "payday 2", "arma 3", "insurgency sandstorm", "hell let loose", "dayz", "destiny 2", "the division", "gears of war",
]


def log(msg):
    print(msg, flush=True)


def export_data():
    out = subprocess.run(["node", os.path.join(TOOLS, "export_data.mjs")], capture_output=True, text=True, cwd=TOOLS, check=True)
    return json.loads(out.stdout)


def uid(name):
    return str(uuid.uuid5(UUID_NS, name))


def manifests(data):
    ver = data["ADDON_VERSION"]
    eng = data["MIN_ENGINE"]
    mods = data["SCRIPT_MODULES"]
    bp = {
        "format_version": 2,
        "header": {"name": "pack.name", "description": "pack.description", "uuid": uid("bp.header"), "version": ver, "min_engine_version": eng},
        "modules": [
            {"type": "data", "uuid": uid("bp.data"), "version": ver},
            {"type": "script", "language": "javascript", "uuid": uid("bp.script"), "entry": "scripts/main.js", "version": ver},
        ],
        "dependencies": [
            {"uuid": uid("rp.header"), "version": ver},
            {"module_name": "@minecraft/server", "version": mods["server"]},
            {"module_name": "@minecraft/server-ui", "version": mods["ui"]},
        ],
        "metadata": {"authors": ["ARSENAL CORE"], "license": "All rights reserved", "product_type": "addon", "generated_with": {"arsenal_core_build": [".".join(map(str, ver))]}},
    }
    rp = {
        "format_version": 2,
        "header": {"name": "pack.name", "description": "pack.description", "uuid": uid("rp.header"), "version": ver, "min_engine_version": eng},
        "modules": [{"type": "resources", "uuid": uid("rp.resources"), "version": ver}],
        "dependencies": [{"uuid": uid("bp.header"), "version": ver}],
        "metadata": {"authors": ["ARSENAL CORE"], "license": "All rights reserved", "product_type": "addon"},
    }
    contentgen.wjson(os.path.join(BP, "manifest.json"), bp)
    contentgen.wjson(os.path.join(RP, "manifest.json"), rp)


def copy_scripts():
    """tools/data/ をランタイム用の 1 ファイルにまとめて src と BP の両方へ置く"""
    bundle = os.path.join(SRC_SCRIPTS, "config", "weapons.data.js")
    subprocess.run(["node", os.path.join(TOOLS, "export_data.mjs"), "--bundle", bundle], check=True, cwd=TOOLS)
    dst = os.path.join(BP, "scripts")
    if os.path.exists(dst):
        shutil.rmtree(dst)
    shutil.copytree(SRC_SCRIPTS, dst)


def stats_markdown(data):
    W = data["WEAPONS"]
    C = data["CATEGORIES"]
    T = data["TIERS"]
    lines = ["# ARSENAL CORE 2.0 — 武器ステータス表（自動生成）", "",
             f"銃 {len(W)} 挺＋近接武器 {len(data['MELEE'])} 本＝{len(W) + len(data['MELEE'])} 種。`tools/build.py` がデータ（`tools/data/`）から生成します。", "",
             "TTK は無防備のプレイヤー（体力 20・防具なし）を有効射程内で倒すのに必要な時間（秒）。散弾は 8 割命中で計算。防具・プレートがあると長くなります（下の「防具と TTK」）。", ""]
    for cid, c in sorted(C.items(), key=lambda kv: kv[1]["order"]):
        lines.append(f"## {c['name']['ja']}（{c['name']['en']}）")
        lines.append("")
        lines.append("| 武器 | ティア | 弾薬 | 装弾 | RPM | ダメージ | 頭 | 射程 | 拡散(腰/ADS) | 反動 | リロード(秒) | 機動 | 貫通 | 体TTK | 頭TTK | 作成 |")
        lines.append("|---|---|---|---:|---:|---:|---:|---|---|---:|---|---:|---:|---:|---:|---|")
        for wid, w in W.items():
            if w["cat"] != cid:
                continue
            pel = w.get("pellets", 1)
            dmg = w["dmg"] * pel * (0.8 if pel > 1 else 1)
            stk = max(1, -(-20 // dmg)) if dmg > 0 else 99
            stkh = max(1, -(-20 // (dmg * w["head"]))) if dmg > 0 else 99
            rpm = w["rpm"]
            mode0 = w["modes"][0]
            if mode0.startswith("burst"):
                n = int(mode0[5:])
                br = w.get("burstRpm", rpm)
                bd = w.get("burstDelay", 5)
                def ttk(s):
                    s = int(s)
                    full = (s - 1) // n
                    rem = (s - 1) % n
                    return (full * ((n - 1) * 1200 / br + bd) + rem * 1200 / br) / 20
                tb, th = ttk(stk), ttk(stkh)
            elif mode0 == "double":
                tb, th = 0.0, 0.0
            else:
                tb = (stk - 1) * 60 / rpm
                th = (stkh - 1) * 60 / rpm
            rec = data["weaponRecipes"][wid]
            craft = "ルート限定" if rec is None else "作業台"
            dmg_s = f"{w['dmg']}×{pel}" if pel > 1 else f"{w['dmg']}"
            fam = data["AMMO_FAMILIES"].get(w["ammo"], {"name": {"ja": "なし"}})["name"]["ja"]
            lines.append(f"| {w['name']['ja']} ({w['name']['en']}) | {T[w['tier']]['name']['ja']} | {fam} | {w['mag']} | {rpm} | {dmg_s} | ×{w['head']} | {w['range'][0]}/{w['range'][1]} | {w['spread']['hip']}°/{w['spread']['ads']}° | {w['recoil']['v']} | {w['reload']['tac']/20:.1f}/{w['reload']['empty']/20:.1f} | {int(w['move']*100)}% | {w['pen']} | {tb:.2f} | {th:.2f} | {craft} |")
        lines.append("")
    lines.append("## アタッチメント")
    lines.append("")
    lines.append("| 名前 | 枠 | ティア | 効果 |")
    lines.append("|---|---|---|---|")
    for aid, a in data["ATTACHMENTS"].items():
        lines.append(f"| {a['name']['ja']} ({a['name']['en']}) | {data['ATTACHMENT_SLOTS'][a['slot']]['name']['ja']} | {T[a['tier']]['name']['ja']} | {a['desc']['ja']} |")
    lines.append("")
    extra = docsgen.extra_sections(data)
    lines += extra
    os.makedirs(os.path.join(ROOT, "docs"), exist_ok=True)
    body = "\n".join(lines)
    with open(os.path.join(ROOT, "docs", "WEAPON_STATS.md"), "w", encoding="utf-8") as f:
        f.write(body)
    readme = docsgen.readme(data, open(os.path.join(TOOLS, "readme_template.md"), encoding="utf-8").read(), TRADEMARKS)
    with open(os.path.join(ROOT, "README.md"), "w", encoding="utf-8") as f:
        f.write(readme)


# ---------------------------------------------------------------------------
#  検証
# ---------------------------------------------------------------------------
class Checker:
    def __init__(self):
        self.errors = []
        self.passed = []

    def ok(self, name):
        self.passed.append(name)
        log(f"  ✔ {name}")

    def fail(self, name, details):
        self.errors.append((name, details))
        log(f"  ✘ {name}")
        for d in details[:25]:
            log(f"      - {d}")


def all_files(base, ext):
    for d, _, fs in os.walk(base):
        for f in fs:
            if f.endswith(ext):
                yield os.path.join(d, f)


def load_lang(path):
    out = {}
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.rstrip("\n")
            if not line or line.startswith("##") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            out[k] = v
    return out


def validate(data, sound_files):
    c = Checker()
    log("検証:")
    # 1. JSON 構文
    bad = []
    parsed = {}
    for base in (BP, RP):
        for p in all_files(base, ".json"):
            try:
                with open(p, encoding="utf-8") as f:
                    parsed[p] = json.load(f)
            except Exception as e:  # noqa: BLE001
                bad.append(f"{os.path.relpath(p, ROOT)}: {e}")
    c.fail("JSON 構文", bad) if bad else c.ok(f"JSON 構文（{len(parsed)} ファイル）")

    # 2. manifest
    bpm = parsed[os.path.join(BP, "manifest.json")]
    rpm = parsed[os.path.join(RP, "manifest.json")]
    uuids = [bpm["header"]["uuid"], rpm["header"]["uuid"]] + [m["uuid"] for m in bpm["modules"] + rpm["modules"]]
    errs = []
    if len(set(uuids)) != len(uuids):
        errs.append("UUID が重複")
    dep_uuids = [d.get("uuid") for d in bpm["dependencies"] if "uuid" in d]
    if rpm["header"]["uuid"] not in dep_uuids:
        errs.append("BP が RP に依存していない")
    if bpm["header"]["uuid"] not in [d.get("uuid") for d in rpm["dependencies"]]:
        errs.append("RP が BP に依存していない")
    mods = {d["module_name"]: d["version"] for d in bpm["dependencies"] if "module_name" in d}
    if mods.get("@minecraft/server") != data["SCRIPT_MODULES"]["server"] or mods.get("@minecraft/server-ui") != data["SCRIPT_MODULES"]["ui"]:
        errs.append("Script API バージョンが定義と不一致")
    pkg = json.load(open(os.path.join(TOOLS, "node_modules", "@minecraft", "server", "package.json")))
    if pkg["version"] != mods.get("@minecraft/server"):
        errs.append(f"型定義 {pkg['version']} と manifest {mods.get('@minecraft/server')} が不一致")
    c.fail("manifest", errs) if errs else c.ok("manifest（UUID 一意・相互依存・Script API 2 モジュール）")

    # 3. 言語キー
    en = load_lang(os.path.join(RP, "texts", "en_US.lang"))
    ja = load_lang(os.path.join(RP, "texts", "ja_JP.lang"))
    missing = []
    for p, obj in parsed.items():
        if "minecraft:item" in obj:
            key = obj["minecraft:item"]["components"].get("minecraft:display_name", {}).get("value")
            if key and (key not in en or key not in ja):
                missing.append(f"{os.path.basename(p)}: {key}")
    # スクリプトの参照キー
    script_keys = set()
    for p in all_files(SRC_SCRIPTS, ".js"):
        src = open(p, encoding="utf-8").read()
        script_keys |= set(re.findall(r'"(arsenal\.(?:ui|mode)\.[a-z0-9_]+)"', src))
    # 効果音のイベント名（arsenal.ui.buy など）は翻訳キーではない
    _sdefs = json.load(open(os.path.join(RP, "sounds", "sound_definitions.json"), encoding="utf-8"))["sound_definitions"]
    script_keys -= set(_sdefs)
    dyn = {
        "arsenal.ui.ads_": ["hold", "toggle"], "arsenal.ui.reload_": ["double_sneak", "manual"], "arsenal.ui.hud_": ["full", "compact", "off"],
        "arsenal.ui.hudpos_": ["actionbar", "title"], "arsenal.ui.kick_": ["off", "light", "full"], "arsenal.ui.fx_": ["low", "medium", "high"],
        "arsenal.ui.grief_": ["gamerule", "on", "off"],
    }
    for pre, vals in dyn.items():
        script_keys |= {pre + v for v in vals}
    script_keys |= {f"arsenal.ui.guide_{i}" for i in range(1, 15)}
    for m in ("semi", "auto", "burst", "double", "charge", "ub"):
        script_keys.add(f"arsenal.mode.{m}")
    for wid, w in data["WEAPONS"].items():
        script_keys |= {f"arsenal.cat.{w['cat']}", f"arsenal.tier.{w['tier']}", f"arsenal.desc.{wid}", f"arsenal.ammo.{w['ammo']}" if w["ammo"] != "none" else "arsenal.ui.on"}
    for s_ in data["ATTACHMENT_SLOTS"]:
        script_keys.add(f"arsenal.slot.{s_}")
    for o in data["OPTICS"]:
        script_keys.add(f"arsenal.optic.{o}")
    for fam, f in data["AMMO_FAMILIES"].items():
        for v in f["variants"]:
            script_keys.add(f"arsenal.variant.{v}")
    for it in data["ammoItems"]:
        for k in it["cost"]:
            if k.startswith("minecraft:"):
                script_keys.add("arsenal.vanilla." + k[10:])
    _costs2 = list(data["MELEE_RECIPES"].values()) + list(data["ARMOR_RECIPES"].values()) + [t["cost"] for t in data["MEDICAL"].values()] + [t["cost"] for t in data["DEPLOYABLES"].values()] + [t["cost"] for t in data["VEHICLES"].values()]
    for r in list(data["weaponRecipes"].values()) + list(data["attachmentRecipes"].values()) + [t["cost"] for t in data["THROWABLES"].values()] + [t["cost"] for t in data["TOOLS"].values()] + _costs2:
        if r:
            for k in r:
                if k.startswith("minecraft:"):
                    script_keys.add("arsenal.vanilla." + k[10:])
    for k in sorted(script_keys):
        if k not in en:
            missing.append(f"en_US: {k}")
        if k not in ja:
            missing.append(f"ja_JP: {k}")
    if set(en) != set(ja):
        missing += [f"ja_JP のみ/en_US のみ: {k}" for k in sorted(set(en) ^ set(ja))]
    c.fail("言語キー", missing) if missing else c.ok(f"言語キー（{len(en)} キー × 2 言語、スクリプト参照 {len(script_keys)} 件）")

    # 4. テクスチャ・ジオメトリ・アタッチャブル参照
    miss = []
    it_tex = parsed[os.path.join(RP, "textures", "item_texture.json")]["texture_data"]
    for k, v in it_tex.items():
        if not os.path.exists(os.path.join(RP, v["textures"] + ".png")):
            miss.append(f"item_texture {k}: {v['textures']}")
    for p, obj in parsed.items():
        if "minecraft:item" in obj:
            icon = obj["minecraft:item"]["components"].get("minecraft:icon")
            if icon and icon not in it_tex:
                miss.append(f"{os.path.basename(p)}: icon {icon}")
    terr = parsed[os.path.join(RP, "textures", "terrain_texture.json")]["texture_data"]
    for p, obj in parsed.items():
        if "minecraft:block" in obj:
            for face, mi in obj["minecraft:block"]["components"]["minecraft:material_instances"].items():
                if mi["texture"] not in terr:
                    miss.append(f"{os.path.basename(p)}: {face} → {mi['texture']}")
    geo_ids = set()
    for p in all_files(os.path.join(RP, "models"), ".json"):
        for g in parsed[p]["minecraft:geometry"]:
            geo_ids.add(g["description"]["identifier"])
    anims = set()
    for p in all_files(os.path.join(RP, "animations"), ".json"):
        anims |= set(parsed[p]["animations"])
    rcs = set()
    for p in all_files(os.path.join(RP, "render_controllers"), ".json"):
        rcs |= set(parsed[p]["render_controllers"])
    rcs.add("controller.render.item_default")
    rcs.add("controller.render.armor")  # バニラの防具の描画（アタッチャブルの防具）
    for p, obj in parsed.items():
        for root in ("minecraft:attachable", "minecraft:client_entity"):
            if root not in obj:
                continue
            desc = obj[root]["description"]
            for tpath in desc.get("textures", {}).values():
                if tpath.startswith("textures/misc/"):
                    continue
                if not os.path.exists(os.path.join(RP, tpath + ".png")):
                    miss.append(f"{os.path.basename(p)}: texture {tpath}")
            for gid in desc.get("geometry", {}).values():
                if gid not in geo_ids:
                    miss.append(f"{os.path.basename(p)}: geometry {gid}")
            for aid in desc.get("animations", {}).values():
                if aid not in anims:
                    miss.append(f"{os.path.basename(p)}: animation {aid}")
            for rc in desc.get("render_controllers", []):
                rc_id = rc if isinstance(rc, str) else list(rc)[0]
                if rc_id not in rcs:
                    miss.append(f"{os.path.basename(p)}: render controller {rc_id}")
    c.fail("テクスチャ・モデル・アニメーション参照", miss) if miss else c.ok(f"テクスチャ・モデル・アニメーション参照（ジオメトリ {len(geo_ids)}、アニメーション {len(anims)}）")

    # 5. 武器ごとの完全性（アイテム・テクスチャ・アタッチャブル・アニメ・言語）
    miss = []
    for wid in data["WEAPONS"]:
        for path in (f"{BP}/items/weapons/{wid}.json", f"{RP}/attachables/arsenal/{wid}.json", f"{RP}/textures/items/arsenal/weapons/{wid}.png",
                     f"{RP}/textures/entity/arsenal/weapons/{wid}.png", f"{RP}/models/entity/arsenal/weapons/{wid}.geo.json"):
            if not os.path.exists(path):
                miss.append(os.path.relpath(path, ROOT))
        for a in (f"animation.arsenal.hold.{wid}", f"animation.arsenal.{wid}.tp", f"animation.arsenal.{wid}.fp"):
            if a not in anims:
                miss.append(a)
        w = data["WEAPONS"][wid]
        style = contentgen.Gen.reload_style(w)
        if w["ammo"] != "none":
            if w.get("single"):
                if f"animation.arsenal.reload.shell_{w['single']['per']}" not in anims:
                    miss.append(f"reload anim for {wid}")
            else:
                for k in ("tac", "empty"):
                    if f"animation.arsenal.reload.{style}_{w['reload'][k]}" not in anims:
                        miss.append(f"reload anim {style}_{w['reload'][k]} for {wid}")
    c.fail("武器ごとの完全性", miss) if miss else c.ok(f"武器ごとの完全性（{len(data['WEAPONS'])} 種 × 8 項目）")

    # 6. スクリプトが参照するサウンド・パーティクル・アニメーション
    sdefs = parsed[os.path.join(RP, "sounds", "sound_definitions.json")]["sound_definitions"]
    pids = set()
    for p in all_files(os.path.join(RP, "particles"), ".json"):
        pids.add(parsed[p]["particle_effect"]["description"]["identifier"])
    miss = []
    for ev, d in sdefs.items():
        for snd in d["sounds"]:
            if not os.path.exists(os.path.join(RP, snd["name"] + ".ogg")):
                miss.append(f"{ev}: {snd['name']}.ogg")
    used_sounds = set()
    used_particles = set()
    used_anims = set()
    for p in all_files(SRC_SCRIPTS, ".js"):
        src = open(p, encoding="utf-8").read()
        used_sounds |= set(re.findall(r'"(arsenal\.(?:fire|far|mech|fx)\.[a-z_]+)"', src))
        used_particles |= set(re.findall(r'(?:emit\([^,()]+,\s*|spawnParticle\()"(arsenal:[a-z_]+)"', src))
        used_anims |= set(re.findall(r'"(animation\.arsenal\.[a-z_.0-9]+)"', src))
    for sset in {w["sound"] for w in data["WEAPONS"].values()} | {"suppressed", "suppressed_heavy", "launcher", "shotgun"}:
        used_sounds.add(f"arsenal.fire.{sset}")
    for s_ in sorted(used_sounds):
        if s_ not in sdefs:
            miss.append(f"sound event {s_}")
    for pid in sorted(used_particles):
        if pid not in pids:
            miss.append(f"particle {pid}")
    for a in sorted(used_anims):
        if a not in anims:
            miss.append(f"animation {a}")
    for k in ("light", "medium", "heavy", "massive"):
        if f"animation.arsenal.kick.{k}" not in anims:
            miss.append(f"kick {k}")
    c.fail("サウンド・パーティクル・アニメーション（スクリプト参照）", miss) if miss else c.ok(f"サウンド・パーティクル・アニメーション（音イベント {len(sdefs)}、音声 {len(sound_files)}、パーティクル {len(pids)}、スクリプト参照 音 {len(used_sounds)}／粒子 {len(used_particles)}／アニメ {len(used_anims)}）")

    # 7. スクリプト構文
    bad = []
    for p in all_files(os.path.join(BP, "scripts"), ".js"):
        r = subprocess.run(["node", "--check", p], capture_output=True, text=True)
        if r.returncode != 0:
            bad.append(f"{os.path.relpath(p, ROOT)}: {r.stderr.strip()[:200]}")
    c.fail("スクリプト構文（node --check）", bad) if bad else c.ok("スクリプト構文（node --check）")

    # 8. 型チェック（公式型定義）
    r = subprocess.run(["npx", "tsc", "-p", "tsconfig.check.json"], capture_output=True, text=True, cwd=TOOLS)
    if r.returncode != 0:
        c.fail("型チェック（@minecraft/server 型定義）", r.stdout.strip().splitlines())
    else:
        c.ok(f"型チェック（@minecraft/server {data['SCRIPT_MODULES']['server']} / server-ui {data['SCRIPT_MODULES']['ui']} の型定義）")

    # 9. 規模
    errs = []
    nw = len(data["WEAPONS"]) + len(data["MELEE"])
    gear_n = len(data["THROWABLES"]) + len(data["MEDICAL"]) + len(data["DEPLOYABLES"]) + len(data["VEHICLES"])
    minimum = [("武器（銃＋近接）", nw, 90), ("近接武器", len(data["MELEE"]), 6), ("アタッチメント", len(data["ATTACHMENTS"]), 50), ("迷彩", len(data["CAMOS"]), 8),
               ("防具", len(data["ARMOR"]), 15), ("装備", gear_n, 24), ("敵", len(data["ENEMIES"]), 14), ("ボス", len(data["BOSSES"]), 2),
               ("構造物", len(data["STRUCTURES"]), 6), ("キルストリーク", len(data["KILLSTREAKS"]), 6), ("ゲームモード", len(data["MODES"]), 4)]
    for name, have, need in minimum:
        if have < need:
            errs.append(f"{name} {have} < {need}")
    c.fail("規模", errs) if errs else c.ok("規模（" + "・".join(f"{n_} {h}" for n_, h, _ in minimum) + f"・弾薬 {len(data['ammoItems'])}）")

    # 10. 商標
    hits = []
    texts = [open(p, encoding="utf-8").read().lower() for p in list(all_files(os.path.join(RP, "texts"), ".lang")) + list(all_files(BP, ".json"))]
    texts.append(json.dumps(data, ensure_ascii=False).lower())
    for tm in TRADEMARKS:
        for tx_ in texts:
            if re.search(r"(?<![a-z0-9])" + re.escape(tm) + r"(?![a-z0-9])", tx_):
                hits.append(tm)
                break
    c.fail("商標チェック", sorted(set(hits))) if hits else c.ok(f"商標チェック（実在の銃名・メーカー名 {len(TRADEMARKS)} 語）")

    # 11. モード定義
    errs = []
    for wid, w in data["WEAPONS"].items():
        for m in w["modes"]:
            if not (m in ("semi", "auto", "double", "charge") or re.fullmatch(r"burst[2-4]", m)):
                errs.append(f"{wid}: {m}")
        if w["modes"][0].startswith("burst") and "burstRpm" not in w:
            errs.append(f"{wid}: burstRpm 未定義")
    c.fail("射撃モード定義", errs) if errs else c.ok("射撃モード定義（セミ／バースト2〜4／フルオート／二連／チャージ）")

    # 12. ランタイム（モック環境でゲームループを実行）
    r = subprocess.run(["node", os.path.join(TOOLS, "test", "run.mjs")], capture_output=True, text=True, cwd=ROOT)
    tail = r.stdout.strip().splitlines()
    summary = tail[-1] if tail else ""
    if r.returncode != 0:
        c.fail("ランタイム（射撃・リロード・投擲・UI・設定・例外）", [l for l in tail if "✘" in l] + [r.stderr.strip()[:300]])
    else:
        c.ok(f"ランタイム（モック環境でゲームループを実行：{summary}）")

    rel = lambda p: os.path.relpath(p, ROOT)  # noqa: E731
    # 13. 公式 JSON スキーマ（エンティティ・アイテム・ブロック）
    n, errs = schemacheck.validate_bp(BP, rel)
    c.fail("公式スキーマ（エンティティ・アイテム・ブロック）", errs) if errs else c.ok(f"公式スキーマ（bedrock-samples 1.26.50 のスキーマで {n} ファイル、未知のコンポーネントも検出）")

    # 14. Molang（`??` の左辺は直接の変数のみ）
    n, errs = schemacheck.lint_molang(parsed, rel)
    c.fail("Molang（?? 演算子）", errs) if errs else c.ok(f"Molang（?? 演算子 {n} 箇所の左辺が直接の変数）")

    # 15. アニメーション（bones が空でない）
    n, errs = schemacheck.check_animations(parsed, rel)
    c.fail("アニメーション定義", errs) if errs else c.ok(f"アニメーション定義（{n} 件、空の bones なし）")

    # 16. パーティクル（公式スキーマ・バニラのマテリアル）
    n, errs = schemacheck.validate_particles(RP, rel)
    c.fail("パーティクル（公式スキーマ）", errs) if errs else c.ok(f"パーティクル（公式スキーマで {n} 件、未知のコンポーネント・マテリアルなし）")

    # 17. HUD（スコープ表示）：テクスチャ・スクリプトの印との一致
    hud_js = open(os.path.join(ROOT, "src", "scripts", "ui", "hud.js"), encoding="utf-8").read()
    m = re.search(r'export const SCOPE_MARK = "([^"]+)"', hud_js)
    n, errs = schemacheck.check_hud_ui(RP, rel, m.group(1) if m else "?")
    c.fail("HUD（スコープ表示）", errs) if errs else c.ok(f"HUD（スコープ表示：テクスチャ {n} 件・スクリプトの印と一致）")

    # ---------------- 2.0 で追加 ----------------
    # 18. 公式スキーマ（地物ルール・スポーンルール）と地物の参照
    n, errs = checks2.check_world_schemas(BP, rel)
    c.fail("公式スキーマ（地物ルール・スポーンルール・地物の参照）", errs) if errs else c.ok(f"公式スキーマ（地物ルール・スポーンルール・地物 {n} 件）")
    # 19. 商標（150 語以上）
    if len(TRADEMARKS) < 150:
        c.fail("商標リストの語数", [f"{len(TRADEMARKS)} 語 < 150"])
    else:
        c.ok(f"商標リスト（{len(TRADEMARKS)} 語。照合は 10 番）")
    # 20. データの整合性
    n, errs = checks2.check_data_integrity(data, BP)
    c.fail("データの整合性（枠・素材・ルート・装備セット・敵・価格）", errs) if errs else c.ok(f"データの整合性（レシピ {n} 件の素材・全武器の枠・ルート・装備セット・敵の武器・価格）")
    # 21. 役割の重複
    n, errs = checks2.check_role_overlap(data)
    c.fail("役割の重複（カテゴリ内の性能の近すぎる武器）", errs) if errs else c.ok(f"役割の重複なし（同カテゴリ {n} 組を比較）")
    # 22. 容量
    vals, errs = checks2.check_capacity(BP, RP, package)
    summ = "・".join(f"{k} {v:.1f}" if isinstance(v, float) else f"{k} {v}" for k, v in vals.items())
    c.fail("容量", errs) if errs else c.ok(f"容量（{summ}）")
    # 23. 構造物の NBT
    n, errs = checks2.check_structures(data, BP, rel)
    c.fail("構造物（NBT の読み戻し・ブロック ID と状態・宝箱の数）", errs) if errs else c.ok(f"構造物（.mcstructure {n} 件を読み戻し、ブロック ID・状態・大きさ・宝箱の数が一致）")
    # 24. HUD 2.0 の往復
    n, errs = checks2.check_hud2_roundtrip(RP, m.group(1) if m else "?")
    c.fail("HUD 2.0（符号化 ↔ JSON UI の式の往復）", errs) if errs else c.ok(f"HUD 2.0（スクリプトの符号化を JSON UI の式で復号：{n} フィールド・表示条件一致）")
    # 25. 言語（2.0 のキーが両言語にあり、日本語が英語のままでない）
    new_keys = set(lang_ui2.UI2) | set(lang_ui2.dynamic(data))
    n, errs = checks2.check_lang_pairs(en, ja, new_keys)
    c.fail("言語（2.0 のキー）", errs) if errs else c.ok(f"言語（2.0 のキー {n} 件が日英そろい、日本語訳あり）")
    # 26. スクリプトの翻訳キー
    n, errs = checks2.check_script_keys(SRC_SCRIPTS, en)
    c.fail("スクリプトの翻訳キー（t()・translate）", errs) if errs else c.ok(f"スクリプトの翻訳キー（{n} 件の参照がすべて言語ファイルにある）")
    # 27. 負荷試験
    summary, errs = checks2.run_perf(ROOT)
    c.fail("負荷試験（プレイヤー 20＋敵 60、600 tick）", errs) if errs else c.ok(f"負荷試験（プレイヤー 20＋敵 60、600 tick：{summary}）")
    return c


def package():
    out = os.path.join(ROOT, "ArsenalCore.mcaddon")
    if os.path.exists(out):
        os.remove(out)
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for base in (BP, RP):
            name = os.path.basename(base)
            for d, _, fs in os.walk(base):
                for f in sorted(fs):
                    p = os.path.join(d, f)
                    z.write(p, os.path.join(name, os.path.relpath(p, base)))
    for base, fn in ((BP, "ArsenalCore_BP.mcpack"), (RP, "ArsenalCore_RP.mcpack")):
        p2 = os.path.join(ROOT, "dist", fn)
        os.makedirs(os.path.dirname(p2), exist_ok=True)
        with zipfile.ZipFile(p2, "w", zipfile.ZIP_DEFLATED) as z:
            for d, _, fs in os.walk(base):
                for f in sorted(fs):
                    p = os.path.join(d, f)
                    z.write(p, os.path.relpath(p, base))
    # ソース一式（tools・BP・RP・src・docs とドキュメント。依存パッケージ・キャッシュ・テストの作業フォルダは除く）
    ver = ".".join(str(x) for x in json.load(open(os.path.join(BP, "manifest.json")))["header"]["version"])
    src_zip = os.path.join(ROOT, "dist", f"ArsenalCore-{ver}-source.zip")
    skip_dirs = {"node_modules", "__pycache__", ".audio_cache", ".run", ".run_perf", ".run_hud", ".git"}
    with zipfile.ZipFile(src_zip, "w", zipfile.ZIP_DEFLATED) as z:
        for top in ("tools", "src", "docs", os.path.basename(BP), os.path.basename(RP)):
            for d, dirs, fs in os.walk(os.path.join(ROOT, top)):
                dirs[:] = [x for x in dirs if x not in skip_dirs]
                for f in sorted(fs):
                    p = os.path.join(d, f)
                    z.write(p, os.path.join("ArsenalCore", os.path.relpath(p, ROOT)))
        for f in ("README.md", "DESIGN_DECISIONS.md", "CHANGELOG.md"):
            if os.path.exists(os.path.join(ROOT, f)):
                z.write(os.path.join(ROOT, f), os.path.join("ArsenalCore", f))
    return out


def main():
    no_audio = "--no-audio" in sys.argv
    log("ARSENAL CORE build")
    data = export_data()
    audio_keep = None
    if no_audio and os.path.exists(os.path.join(RP, "sounds", "arsenal")):
        audio_keep = os.path.join(TOOLS, ".audio_cache")
        if os.path.exists(audio_keep):
            shutil.rmtree(audio_keep)
        shutil.copytree(os.path.join(RP, "sounds", "arsenal"), audio_keep)
    for d in (BP, RP):
        if os.path.exists(d):
            shutil.rmtree(d)
        os.makedirs(d)
    log("生成:")
    g = contentgen.Gen(data, BP, RP, log=log)
    g.weapons()
    g.melee()
    g.attachments()
    g.ammo()
    g.misc_items()
    g.armor()
    g.gear_items()
    g.structures()
    g.blocks()
    g.recipes()
    g.entities()
    g.entities2()
    g.loot(os.path.join(TOOLS, "vanilla", "loot_tables", "chests"))
    g.catalog()
    g.particles()
    g.hud_ui()
    snd_dir = os.path.join(RP, "sounds", "arsenal")
    if audio_keep:
        shutil.copytree(audio_keep, snd_dir)
        sound_files = sorted(os.path.relpath(p, snd_dir)[:-4] for p in all_files(snd_dir, ".ogg"))
        log(f"  sounds: reused {len(sound_files)} files")
    else:
        sound_files = audiogen.generate(snd_dir, log=log)
    g.sounds(sound_files)
    g.finish_textures()
    g.pack_icons()
    strings = lang_ui.all_strings()
    strings.update(lang_ui2.UI2)
    strings.update(lang_ui2.dynamic(data))
    g.write_lang(strings)
    manifests(data)
    copy_scripts()
    stats_markdown(data)
    c = validate(data, sound_files)
    if c.errors:
        log(f"\n✘ 検証エラー {len(c.errors)} 件。パッケージングを中止します。")
        sys.exit(1)
    out = package()
    n_files = sum(1 for base in (BP, RP) for _ in all_files(base, ""))
    size = os.path.getsize(out) / 1024 / 1024
    log(f"\n✔ 検証 {len(c.passed)} 項目すべて合格")
    log(f"✔ {os.path.relpath(out, ROOT)}  ({n_files} ファイル, {size:.1f} MB)")


if __name__ == "__main__":
    main()
