"""ARSENAL CORE 2.0 — ビルド時の追加検証（18〜27）

build.py の validate() から呼ぶ。各関数は (件数や要約, エラー一覧) を返す。
"""
import io
import json
import os
import re
import subprocess
import zipfile

import schemacheck
from gen.structures import nbt_read

TOOLS = os.path.dirname(os.path.abspath(__file__))


# ---------------------------------------------------------------------------
#  18. 公式スキーマ（地物ルール・スポーンルール）と地物の参照
# ---------------------------------------------------------------------------
def check_world_schemas(bp, rel):
    errs = []
    n = 0
    jobs = [
        ("feature_rules", "client_server/world", "Feature%20Rule.json", "minecraft:feature_rules"),
    ]
    # スポーンルール：公開スキーマは新形式（weight が数値）なので、旧形式 1.8.0 は条件名の一覧で確かめる
    legacy = {"minecraft:spawns_on_surface", "minecraft:spawns_underground", "minecraft:spawns_underwater", "minecraft:spawns_lava", "minecraft:brightness_filter",
              "minecraft:difficulty_filter", "minecraft:weight", "minecraft:herd", "minecraft:density_limit", "minecraft:height_filter", "minecraft:biome_filter",
              "minecraft:spawns_on_block_filter", "minecraft:spawns_on_block_prevented_filter", "minecraft:distance_filter", "minecraft:world_age_filter",
              "minecraft:permute_type", "minecraft:spawn_event", "minecraft:delay_filter", "minecraft:player_in_village_filter", "minecraft:disallow_spawns_in_bubble",
              "minecraft:is_persistent", "minecraft:mob_event_filter", "minecraft:spawns_above_block_filter"}
    ents = set()
    for d, _, fs in os.walk(os.path.join(bp, "entities")):
        for f in fs:
            ents.add(json.load(open(os.path.join(d, f), encoding="utf-8"))["minecraft:entity"]["description"]["identifier"])
    sdir = os.path.join(bp, "spawn_rules")
    for f in sorted(os.listdir(sdir)) if os.path.isdir(sdir) else []:
        p = os.path.join(sdir, f)
        doc = json.load(open(p, encoding="utf-8")).get("minecraft:spawn_rules")
        if not doc:
            errs.append(f"{rel(p)}: minecraft:spawn_rules がない")
            continue
        n += 1
        ident = doc["description"]["identifier"]
        if ident not in ents:
            errs.append(f"{rel(p)}: {ident} のエンティティがない")
        if doc["description"].get("population_control") not in ("animal", "water_animal", "monster", "cat", "creature", "ambient", "pillager", "villager"):
            errs.append(f"{rel(p)}: population_control が不正")
        for cond in doc.get("conditions", []):
            for k in cond:
                if k not in legacy:
                    errs.append(f"{rel(p)}: 不明な条件 {k}")
            if "minecraft:weight" not in cond:
                errs.append(f"{rel(p)}: weight がない")
    for folder, cat, root, key in jobs:
        base = os.path.join(bp, folder)
        if not os.path.isdir(base):
            continue
        ver = sorted(os.listdir(os.path.join(schemacheck.SCHEMA_ROOT, cat)))[-1]
        v = schemacheck._validator(cat, ver, root)
        for f in sorted(os.listdir(base)):
            p = os.path.join(base, f)
            doc = json.load(open(p, encoding="utf-8"))
            if key not in doc:
                errs.append(f"{rel(p)}: {key} がない")
                continue
            n += 1
            for e in v.iter_errors(doc[key]):
                errs.append(f"{rel(p)} [{ver}] {'/'.join(str(x) for x in e.absolute_path)}: {e.message[:140]}")
    # 地物：参照する構造物ファイルがあること／地物ルールの places_feature が実在すること
    feats = {}
    fdir = os.path.join(bp, "features")
    for f in sorted(os.listdir(fdir)) if os.path.isdir(fdir) else []:
        p = os.path.join(fdir, f)
        doc = json.load(open(p, encoding="utf-8"))
        for k, body in doc.items():
            if not k.startswith("minecraft:"):
                continue
            ident = body["description"]["identifier"]
            feats[ident] = p
            name = body.get("structure_name")
            if name:
                ns, sid = name.split(":")
                if not os.path.exists(os.path.join(bp, "structures", ns, sid + ".mcstructure")):
                    errs.append(f"{rel(p)}: 構造物 {name} がない")
            n += 1
    rdir = os.path.join(bp, "feature_rules")
    for f in sorted(os.listdir(rdir)) if os.path.isdir(rdir) else []:
        doc = json.load(open(os.path.join(rdir, f), encoding="utf-8"))
        pf = doc["minecraft:feature_rules"]["description"]["places_feature"]
        if pf not in feats:
            errs.append(f"{f}: places_feature {pf} が未定義")
    return n, errs


# ---------------------------------------------------------------------------
#  20. データの整合性
# ---------------------------------------------------------------------------
def _vanilla_items():
    p = os.path.join(TOOLS, "node_modules", "@minecraft", "vanilla-data", "lib", "index.js")
    ids = set()
    if os.path.exists(p):
        ids |= set(re.findall(r'"(minecraft:[a-z0-9_]+)"', open(p, encoding="utf-8").read()))
    blocks = json.load(open(os.path.join(TOOLS, "vanilla", "blocks.json"), encoding="utf-8"))["blocks"]
    ids |= set(blocks)
    return ids


def check_data_integrity(data, bp):
    errs = []
    W, A, NS = data["WEAPONS"], data["ATTACHMENTS"], data["NS"]
    # アイテム ID（BP の items から）
    items = set()
    for d, _, fs in os.walk(os.path.join(bp, "items")):
        for f in fs:
            doc = json.load(open(os.path.join(d, f), encoding="utf-8"))
            items.add(doc["minecraft:item"]["description"]["identifier"])
    blocks = set()
    for d, _, fs in os.walk(os.path.join(bp, "blocks")):
        for f in fs:
            doc = json.load(open(os.path.join(d, f), encoding="utf-8"))
            blocks.add(doc["minecraft:block"]["description"]["identifier"])
    known = items | blocks | _vanilla_items()
    # 全武器の枠にアタッチメントがある
    for wid, w in W.items():
        for slot in w["slots"]:
            if w.get("fixed") and w["fixed"].get(slot):
                continue
            ok = [aid for aid, a in A.items() if a["slot"] == slot and (not a.get("only") or w["cat"] in a["only"])]
            if not ok:
                errs.append(f"{wid}: 枠 {slot} に付くアタッチメントがない")
        for aid in (w.get("fixed") or {}).values():
            if aid not in A:
                errs.append(f"{wid}: 固定アタッチメント {aid} がない")
    # レシピの素材
    recs = []
    recs += [(f"weapon {k}", v) for k, v in data["weaponRecipes"].items() if v]
    recs += [(f"attachment {k}", v) for k, v in data["attachmentRecipes"].items() if v]
    recs += [(f"melee {k}", v) for k, v in data["MELEE_RECIPES"].items() if v]
    recs += [(f"armor {k}", v) for k, v in data["ARMOR_RECIPES"].items() if v]
    for tbl in ("THROWABLES", "MEDICAL", "DEPLOYABLES", "VEHICLES", "TOOLS"):
        recs += [(f"{tbl.lower()} {k}", v.get("cost")) for k, v in data[tbl].items() if v.get("cost")]
    recs += [(f"ammo {a['id']}", a["cost"]) for a in data["ammoItems"]]
    for name, r in recs:
        for mat in r:
            if mat not in known:
                errs.append(f"{name}: 素材 {mat} が存在しない")
    # ルート：宝箱のティア・ルートテーブル
    for tier, t in data["LOOT_TIERS"].items():
        for e in t["entries"] + ([t["guaranteed"]] if t.get("guaranteed") else []):
            if e["kind"] == "item" and e["id"] not in known:
                errs.append(f"loot {tier}: {e['id']} が存在しない")
    for d, _, fs in os.walk(os.path.join(bp, "loot_tables")):
        for f in fs:
            doc = json.load(open(os.path.join(d, f), encoding="utf-8"))
            ours = "entities" in d or f.startswith("arsenal")
            for pool in doc.get("pools", []):
                for en in pool.get("entries", []):
                    # バニラの表の写し（旧名の別名 appleEnchanted など）は ARSENAL の品だけ確かめる
                    if en.get("type") == "item" and (ours or en["name"].startswith("arsenal:")) and en["name"] not in known:
                        errs.append(f"loot_tables/{f}: {en['name']} が存在しない")
    # 構造物の宝箱ティア・守備隊
    for sid, s in data["STRUCTURES"].items():
        for ch in s["chests"]:
            if ch["tier"] not in data["LOOT_TIERS"]:
                errs.append(f"structure {sid}: 宝箱ティア {ch['tier']} がない")
        for g in s["garrison"]:
            if g["id"] not in data["ENEMIES"]:
                errs.append(f"structure {sid}: 敵 {g['id']} がない")
    # モードの装備セット
    for mid, m in data["MODES"].items():
        for lo in m["loadouts"]:
            if lo not in data["LOADOUTS"]:
                errs.append(f"mode {mid}: 装備セット {lo} がない")
        for w in m.get("ladder", []):
            if w not in W and w not in data["MELEE"]:
                errs.append(f"mode {mid}: はしごの武器 {w} がない")
        for wave, b in (m.get("boss") or {}).items():
            if b not in data["BOSSES"] and b != "hollow_brute_pack":
                errs.append(f"mode {mid}: ボス {b} がない")
    for lid, lo in data["LOADOUTS"].items():
        for k in ("primary", "secondary"):
            if lo[k] not in W:
                errs.append(f"loadout {lid}: {lo[k]} がない")
        if lo["melee"] not in data["MELEE"]:
            errs.append(f"loadout {lid}: 近接 {lo['melee']} がない")
        for wid, att in (lo.get("attachments") or {}).items():
            for slot, aid in att.items():
                a = A.get(aid)
                if not a or a["slot"] != slot or slot not in W[wid]["slots"]:
                    errs.append(f"loadout {lid}: {wid} に {aid} は付かない")
        for it, _ in lo["gear"]:
            if it not in known:
                errs.append(f"loadout {lid}: {it} がない")
        for it in lo["armor"]:
            if it not in known:
                errs.append(f"loadout {lid}: 防具 {it} がない")
    # 敵・ボスの武器、ボスの召喚アイテム
    for eid, e in list(data["ENEMIES"].items()) + list(data["BOSSES"].items()):
        if e.get("weapon") and e["weapon"] not in W:
            errs.append(f"enemy {eid}: 武器 {e['weapon']} がない")
    for bid, b in data["BOSSES"].items():
        if f"{NS}:{b['summon']}" not in known:
            errs.append(f"boss {bid}: 召喚アイテム {b['summon']} がない")
    # 価格：店で売るものすべてに値段
    for k in ("weapons", "attachments", "armor", "gear", "materials"):
        pass
    for iid in list(items):
        base = iid.split(":")[1]
        if "__" in base:
            continue
        if iid not in data["PRICES"] and (base in W or base in A or base in data["ARMOR"]):
            errs.append(f"price: {iid} の値段がない")
    return len(recs), errs


# ---------------------------------------------------------------------------
#  21. 役割の重複（カテゴリ内で性能が近すぎる武器）
# ---------------------------------------------------------------------------
def check_role_overlap(data):
    W = data["WEAPONS"]
    errs = []
    keys = [("dmg", lambda w: w["dmg"] * w.get("pellets", 1)), ("rpm", lambda w: w["rpm"]), ("mag", lambda w: w["mag"]),
            ("range", lambda w: w["range"][1]), ("hip", lambda w: w["spread"]["hip"]), ("reload", lambda w: w.get("reload", {}).get("empty", 0) if isinstance(w.get("reload"), dict) else w.get("reload", 0))]
    by_cat = {}
    for wid, w in W.items():
        by_cat.setdefault(w["cat"], []).append(wid)
    pairs = 0
    for cat, ids in by_cat.items():
        for i in range(len(ids)):
            for j in range(i + 1, len(ids)):
                a, b = W[ids[i]], W[ids[j]]
                pairs += 1
                close = 0
                for _, f in keys:
                    va, vb = float(f(a) or 0), float(f(b) or 0)
                    m = max(abs(va), abs(vb), 1e-6)
                    if abs(va - vb) / m <= 0.05:
                        close += 1
                same_modes = a["modes"] == b["modes"] and a.get("fire", "hitscan") == b.get("fire", "hitscan") and a["ammo"] == b["ammo"]
                if close == len(keys) and same_modes:
                    errs.append(f"{cat}: {ids[i]} と {ids[j]} がほぼ同じ性能")
    return pairs, errs


# ---------------------------------------------------------------------------
#  22. 容量
# ---------------------------------------------------------------------------
BUDGET = {"mcaddon_mb": 40.0, "textures_mb": 24.0, "sound_files": 450, "items": 1400, "attachables": 1200, "entities": 120, "files": 9000}


def check_capacity(bp, rp, pack_fn):
    buf = io.BytesIO()
    n_files = 0
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for base in (bp, rp):
            for d, _, fs in os.walk(base):
                for f in fs:
                    p = os.path.join(d, f)
                    z.write(p, os.path.relpath(p, os.path.dirname(base)))
                    n_files += 1
    size = len(buf.getvalue()) / 1024 / 1024
    tex = sum(os.path.getsize(os.path.join(d, f)) for d, _, fs in os.walk(os.path.join(rp, "textures")) for f in fs) / 1024 / 1024
    snd = sum(1 for d, _, fs in os.walk(os.path.join(rp, "sounds")) for f in fs if f.endswith(".ogg"))
    items = sum(1 for d, _, fs in os.walk(os.path.join(bp, "items")) for f in fs)
    atts = sum(1 for d, _, fs in os.walk(os.path.join(rp, "attachables")) for f in fs)
    ents = sum(1 for d, _, fs in os.walk(os.path.join(bp, "entities")) for f in fs)
    vals = {"mcaddon_mb": size, "textures_mb": tex, "sound_files": snd, "items": items, "attachables": atts, "entities": ents, "files": n_files}
    errs = [f"{k}: {vals[k]:.1f} > {BUDGET[k]}" for k in BUDGET if vals[k] > BUDGET[k]]
    return vals, errs


# ---------------------------------------------------------------------------
#  23. 構造物の NBT
# ---------------------------------------------------------------------------
def check_structures(data, bp, rel):
    blocks = json.load(open(os.path.join(TOOLS, "vanilla", "blocks.json"), encoding="utf-8"))
    vb, props = blocks["blocks"], blocks["properties"]
    custom = set()
    for d, _, fs in os.walk(os.path.join(bp, "blocks")):
        for f in fs:
            doc = json.load(open(os.path.join(d, f), encoding="utf-8"))
            b = doc["minecraft:block"]["description"]
            custom.add(b["identifier"])
    errs = []
    n = 0
    sdir = os.path.join(bp, "structures", data["NS"])
    for sid, sd in data["STRUCTURES"].items():
        for name in (sid, f"site_{sid}"):
            p = os.path.join(sdir, name + ".mcstructure")
            if not os.path.exists(p):
                errs.append(f"{name}.mcstructure がない")
                continue
            try:
                root = nbt_read(open(p, "rb").read())
            except Exception as e:  # noqa: BLE001
                errs.append(f"{rel(p)}: NBT を読めない ({e})")
                continue
            n += 1
            size = root["size"]
            want = sd["size"] if name == sid else [1, 1, 1]
            if size != want:
                errs.append(f"{rel(p)}: 大きさ {size} ≠ データ {want}")
            idx = root["structure"]["block_indices"]
            vol = size[0] * size[1] * size[2]
            if len(idx) != 2 or len(idx[0]) != vol or len(idx[1]) != vol:
                errs.append(f"{rel(p)}: block_indices の長さが体積 {vol} と合わない")
            pal = root["structure"]["palette"]["default"]["block_palette"]
            if any(i >= len(pal) or i < -1 for i in idx[0]):
                errs.append(f"{rel(p)}: パレットの範囲外の番号")
            chests = 0
            for i, e in enumerate(pal):
                nm = e["name"]
                if nm.startswith("minecraft:"):
                    if nm not in vb:
                        errs.append(f"{rel(p)}: 存在しないブロック {nm}")
                        continue
                    for k, v in e["states"].items():
                        if k not in vb[nm]:
                            errs.append(f"{rel(p)}: {nm} に状態 {k} はない")
                            continue
                        meta = props[k]
                        vv = bool(v) if meta["type"] == "bool" else v
                        if meta["type"] != "bool" and vv not in meta["values"]:
                            errs.append(f"{rel(p)}: {nm} {k}={v} は無効")
                elif nm not in custom:
                    errs.append(f"{rel(p)}: 未定義のブロック {nm}")
                if nm == "minecraft:chest":
                    chests += sum(1 for x in idx[0] if x == i)
            if name == sid:
                want_ch = sum(c["count"] for c in sd["chests"])
                if chests != want_ch:
                    errs.append(f"{rel(p)}: 宝箱 {chests} ≠ データ {want_ch}")
    return n, errs


# ---------------------------------------------------------------------------
#  24. HUD 2.0 の往復（スクリプトの符号化 ↔ JSON UI の式）
# ---------------------------------------------------------------------------
class _Eval:
    """JSON UI の式（このアドオンが使う範囲：文字列・#変数・'%.Ns' * 文字列・+ - = and or not 括弧）を評価する"""

    TOK = re.compile(r"\s*(?:(\d+)|('(?:[^'])*')|(#[A-Za-z_0-9]+)|(and|or|not)\b|(\(|\)|\+|-|\*|=))")

    def __init__(self, env):
        self.env = env

    def run(self, s):
        self.toks = []
        pos = 0
        while pos < len(s):
            m = self.TOK.match(s, pos)
            if not m or m.end() == pos:
                if s[pos:].strip() == "":
                    break
                raise ValueError(f"字句エラー: {s[pos:pos + 20]}")
            pos = m.end()
            num, lit, var, kw, op = m.groups()
            self.toks.append(("num", int(num)) if num else ("str", lit[1:-1]) if lit is not None else ("var", var) if var else ("kw", kw) if kw else ("op", op))
        self.i = 0
        v = self.or_()
        if self.i != len(self.toks):
            raise ValueError(f"構文エラー: {s}")
        return v

    def peek(self):
        return self.toks[self.i] if self.i < len(self.toks) else (None, None)

    def take(self):
        t = self.toks[self.i]
        self.i += 1
        return t

    def or_(self):
        v = self.and_()
        while self.peek() == ("kw", "or"):
            self.take()
            r = self.and_()
            v = bool(v) or bool(r)
        return v

    def and_(self):
        v = self.not_()
        while self.peek() == ("kw", "and"):
            self.take()
            r = self.not_()
            v = bool(v) and bool(r)
        return v

    def not_(self):
        if self.peek() == ("kw", "not"):
            self.take()
            return not bool(self.not_())
        return self.cmp()

    def cmp(self):
        v = self.add()
        if self.peek() == ("op", "="):
            self.take()
            return v == self.add()
        return v

    def add(self):
        v = self.mul()
        while self.peek()[0] == "op" and self.peek()[1] in "+-":
            op = self.take()[1]
            r = self.mul()
            if op == "+":
                v = (v if isinstance(v, str) else str(v)) + (r if isinstance(r, str) else str(r)) if isinstance(v, str) or isinstance(r, str) else v + r
            else:
                v = v.replace(r, "") if isinstance(v, str) else v - r
        return v

    def mul(self):
        v = self.prim()
        while self.peek() == ("op", "*"):
            self.take()
            r = self.prim()
            m = re.fullmatch(r"%\.(\d+)s", v) if isinstance(v, str) else None
            if not m:
                raise ValueError(f"'%.Ns' 以外の * : {v!r}")
            v = str(r)[: int(m.group(1))]
        return v

    def prim(self):
        k, v = self.take()
        if k == "op" and v == "(":
            r = self.or_()
            if self.take() != ("op", ")"):
                raise ValueError("括弧が閉じていない")
            return r
        if k == "str":
            return v
        if k == "num":
            return v
        if k == "var":
            return self.env[v]
        raise ValueError(f"予期しない {k} {v}")


def _hud2_controls(rp):
    """HUD 2.0 の全コントロール（親の表示条件も含めた条件の並び）"""
    ui = json.load(open(os.path.join(rp, "ui", "hud_screen.json"), encoding="utf-8"))
    out = []

    def own(body, target):
        return next((b["source_property_name"] for b in body.get("bindings", []) if b.get("target_property_name") == target), None)

    def walk(name, body, conds):
        c = own(body, "#visible")
        cs = conds + ([c] if c else [])
        out.append((name, cs, own(body, "#text"), body))
        for ch in body.get("controls", []):
            for n2, b2 in ch.items():
                walk(n2, b2, cs)

    walk("arsenal_hud2_root", ui["arsenal_hud2_root"], [])
    return out


def _visible(ev, conds):
    return all(bool(ev.run(c)) for c in conds)


def check_hud2_roundtrip(rp, mark):
    r = subprocess.run(["node", os.path.join(TOOLS, "test", "hud2_vectors.mjs")], capture_output=True, text=True, cwd=TOOLS)
    if r.returncode != 0:
        return 0, [f"試験ベクトルを作れない: {r.stderr[:300]}"]
    vec = json.loads(r.stdout)
    tex_err = []
    for name, _, _, body in _hud2_controls(rp):
        t = body.get("texture")
        if t and not os.path.exists(os.path.join(rp, t + ".png")):
            tex_err.append(f"{name}: テクスチャがない {t}")
    layout = vec["layout"]["fields"]
    controls = _hud2_controls(rp)
    errs = []
    n = 0
    import sys
    sys.path.insert(0, TOOLS)
    from gen.ui import Hud2Expr
    E = Hud2Expr(vec["layout"], vec["header"])
    for v in vec["vectors"]:
        title = v["encoded"] + mark + "§0"
        ev = _Eval({"#t": title})
        # 各フィールドの切り出しがスクリプトの復号と一致
        for f, spec in layout.items():
            got = ev.run(E.slice(f))
            if got != v["decoded"][f] or got != v["encoded"][spec["at"]:spec["at"] + spec["len"]]:
                errs.append(f"{f}: JSON UI {got!r} ≠ スクリプト {v['decoded'][f]!r}")
            n += 1
        vis = {name: _visible(ev, conds) for name, conds, _, _ in controls}
        d = v["decoded"]
        # 期待：クロスヘアは値が数字なら 1 枚だけ、方位は 1 枚だけ、配置のパネルは 1 つだけ
        xh = [k for k in vis if re.fullmatch(r"xh\d", k) and vis[k]]
        if (d["xh"].isdigit() and xh != [f"xh{d['xh']}"]) or (not d["xh"].isdigit() and xh):
            errs.append(f"クロスヘア {d['xh']!r} → 表示 {xh}")
        cmp_ = [k for k in vis if k.startswith("cmp") and vis[k]]
        if cmp_ != [f"cmp{int(d['hdg'])}"]:
            errs.append(f"方位 {d['hdg']!r} → 表示 {cmp_}")
        panels = [k for k in vis if re.fullmatch(r"l\d_panel", k) and vis[k]]
        bars = [k for k in vis if re.fullmatch(r"l\d_bar\d", k) and vis[k]]
        want_bar = [] if d["heat"] == "0" else [f"l{d['lay']}_bar{d['heat']}"]
        if bars != want_bar:
            errs.append(f"熱 {d['heat']!r} → {bars}")
        if panels != [f"l{d['lay']}_panel"]:
            errs.append(f"配置 {d['lay']!r} → パネル {panels}")
        ammo = [k for k in vis if re.fullmatch(r"l\d_ammo\d", k) and vis[k]]
        want_ammo = [] if d["ammo"] == "---" else [f"l{d['lay']}_ammo{d['sz']}"]
        if ammo != want_ammo:
            errs.append(f"弾数 {d['ammo']!r} 大きさ {d['sz']} → {ammo}")
        # ラベルの文字
        for name, conds, txt, body in controls:
            if not txt or not vis.get(name):
                continue
            got = ev.run(txt)
            if not isinstance(got, str):
                errs.append(f"{name}: 文字でない {got!r}")
        # 目印以外のタイトル（スコープ表示）では HUD 2.0 は一切出ない
    ev2 = _Eval({"#t": mark + "§3"})
    shown = [name for name, conds, _, _ in controls if _visible(ev2, conds)]
    if shown:
        errs.append(f"スコープ表示のタイトルで HUD 2.0 が出る: {shown[:5]}")
    errs += tex_err
    ev3 = _Eval({"#t": ""})
    shown = [name for name, conds, _, _ in controls if _visible(ev3, conds)]
    if shown:
        errs.append(f"空のタイトルで HUD 2.0 が出る: {shown[:5]}")
    return n, errs


# ---------------------------------------------------------------------------
#  25. 言語：日本語と英語の両方があり、日本語が英語のままでない
# ---------------------------------------------------------------------------
SAME_OK = re.compile(r"^[\s\d%s:./+\-×x()§a-z0-9]*$|^(ON|OFF|EMP|HUD|OK|TNT|PvP|PvE|K/D)$", re.I)


def check_lang_pairs(en, ja, new_keys):
    errs = []
    for k in sorted(new_keys):
        if k not in en or k not in ja:
            errs.append(f"{k}: {'en_US' if k not in en else 'ja_JP'} がない")
            continue
        e, j = en[k], ja[k]
        if e == j and re.search(r"[A-Za-z]{4,}", e) and not SAME_OK.match(e):
            # 固有名詞だけの短い名前（例：VX-9）は許す
            if not re.fullmatch(r"[A-Z0-9][A-Za-z0-9\- ]{0,12}", e):
                errs.append(f"{k}: 日本語が英語のまま「{e}」")
    return len(new_keys), errs


# ---------------------------------------------------------------------------
#  26. スクリプトの翻訳キー（t() / translate: の参照がすべて言語ファイルにある）
# ---------------------------------------------------------------------------
def check_script_keys(src, en):
    static, templates = set(), set()
    for d, _, fs in os.walk(src):
        for f in fs:
            if not f.endswith(".js") or f in ("weapons.data.js", "structures.gen.js"):
                continue
            s = open(os.path.join(d, f), encoding="utf-8").read()
            static |= set(re.findall(r'\bt\(\s*"(arsenal\.[a-z0-9_.]+)"', s))
            static |= set(re.findall(r'translate:\s*"(arsenal\.[a-z0-9_.]+)"', s))
            templates |= set(re.findall(r'\bt\(\s*`(arsenal\.[^`]*\$\{[^`]*)`', s))
            templates |= set(re.findall(r'translate:\s*`(arsenal\.[^`]*\$\{[^`]*)`', s))
    errs = [f"{k}: 言語ファイルにない" for k in sorted(static) if k not in en]
    for tpl in sorted(templates):
        rx = re.compile("^" + re.sub(r"\\\$\\\{[^}]*\\\}", "[a-z0-9_.]+", re.escape(tpl)) + "$")
        if not any(rx.match(k) for k in en):
            errs.append(f"{tpl}: 当てはまるキーが 1 つもない")
    return len(static) + len(templates), errs


# ---------------------------------------------------------------------------
#  27. 負荷試験（プレイヤー 20＋敵 60、600 tick）
# ---------------------------------------------------------------------------
def run_perf(root):
    r = subprocess.run(["node", os.path.join(TOOLS, "test", "perf.mjs")], capture_output=True, text=True, cwd=root)
    lines = r.stdout.strip().splitlines()
    summary = [l for l in lines if l.startswith("perf:")]
    return " / ".join(summary), ([l for l in lines if "✘" in l] + [r.stderr[:300]] if r.returncode != 0 else [])
