"""公式 JSON スキーマ（Mojang/bedrock-samples 1.26.50）による検証と Molang・アニメーションの静的チェック。

ゲームのコンテンツログで出るエラー（スキーマ外コンポーネント、Molang の `??` 誤用、
空の bones）をビルド時に検出するためのもの。
"""
import json
import os
import re
from urllib.parse import unquote

from jsonschema import Draft7Validator
from referencing import Registry, Resource

SCHEMA_ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "schemas")

# BP のフォルダ → (スキーマのカテゴリ, ルート文書ファイル名, JSON 内のキー)
KINDS = {
    "entities": ("server/entity", "ActorDocument.json", "minecraft:entity"),
    "items": ("server/item", "ItemDocument.json", "minecraft:item"),
    "blocks": ("server/block", "Blocks.json", "minecraft:block"),
}


def _ver(s):
    try:
        return tuple(int(x) for x in s.split("."))
    except ValueError:
        return None


def _pick_version(category, fmt):
    """ファイルの format_version 以下で最も新しいスキーマのバージョンを選ぶ"""
    base = os.path.join(SCHEMA_ROOT, category)
    want = _ver(fmt) or (99,)
    best = None
    for d in os.listdir(base):
        v = _ver(d)
        if v and v <= want and (best is None or v > best[0]):
            best = (v, d)
    return best[1] if best else None


def _relax(node):
    """公式スキーマには同じ値が複数の分岐に当てはまる oneOf（フィルターの配列など）があり、
    厳密な oneOf だと正しい JSON も弾いてしまう。ゲームの読み込みに合わせて anyOf として扱う。"""
    if isinstance(node, dict):
        return {("anyOf" if k == "oneOf" else k): _relax(v) for k, v in node.items()}
    if isinstance(node, list):
        return [_relax(v) for v in node]
    return node


def _retrieve(uri):
    path = unquote(uri.split("#", 1)[0]).lstrip("/")
    with open(os.path.join(SCHEMA_ROOT, path), encoding="utf-8") as f:
        return Resource.from_contents(_relax(json.load(f)))


_registry = Registry(retrieve=_retrieve)
_Validator = Draft7Validator
_validators = {}


def _validator(category, version, root):
    key = (category, version, root)
    if key not in _validators:
        uri = f"/{category}/{version}/{root}"
        schema = _registry.get_or_retrieve(uri).value.contents
        _validators[key] = _Validator(schema, registry=_registry)
    return _validators[key]


def _entity_component_names(version):
    with open(os.path.join(SCHEMA_ROOT, "server/entity", version, "Entity component definitions.json"), encoding="utf-8") as f:
        d = json.load(f)
    return set(d.get("properties", {})), [re.compile(k) for k in d.get("patternProperties", {})]


def _unknown_components(version, ent):
    """スキーマは未知のキーを許してしまうため、コンポーネント名は一覧と突き合わせる"""
    names, pats = _entity_component_names(version)
    groups = [ent.get("components", {})] + list(ent.get("component_groups", {}).values())
    bad = []
    for g in groups:
        for c in g:
            if c not in names and not any(p.search(c) for p in pats):
                bad.append(c)
    return sorted(set(bad))


def validate_bp(bp_dir, rel, load=None):
    """BP の entities/items/blocks を公式スキーマで検証。戻り値: (件数, エラー一覧)"""
    load = load or (lambda p: json.load(open(p, encoding="utf-8")))
    errs, n = [], 0
    for folder, (category, root, key) in KINDS.items():
        base = os.path.join(bp_dir, folder)
        if not os.path.isdir(base):
            continue
        for d, _, fs in os.walk(base):
            for f in sorted(fs):
                if not f.endswith(".json"):
                    continue
                p = os.path.join(d, f)
                doc = load(p)
                ver = _pick_version(category, doc.get("format_version", ""))
                if not ver or key not in doc:
                    errs.append(f"{rel(p)}: スキーマ／キー {key} が見つからない")
                    continue
                n += 1
                if folder == "entities":
                    errs += [f"{rel(p)} [{ver}] {c}: スキーマに存在しないコンポーネント" for c in _unknown_components(ver, doc[key])]
                v = _validator(category, ver, root)
                for e in sorted(v.iter_errors(doc[key]), key=lambda e: list(e.absolute_path)):
                    where = "/".join(str(x) for x in e.absolute_path)
                    errs.append(f"{rel(p)} [{ver}] {where}: {e.message[:160]}")
    return n, errs


_NULLISH = re.compile(r"([A-Za-z_][\w.]*|\))\s*\?\?")
_DIRECT_VAR = re.compile(r"(v|variable|t|temp|c|context)\.\w+")


def _strings(node, path=""):
    if isinstance(node, str):
        yield path, node
    elif isinstance(node, dict):
        for k, v in node.items():
            yield from _strings(v, f"{path}/{k}")
    elif isinstance(node, list):
        for i, v in enumerate(node):
            yield from _strings(v, f"{path}/{i}")


def lint_molang(parsed, rel):
    """`??` の左辺は変数そのもの（v.name）でなければならない（v.color.r ?? 1 や (a) ?? b はエラー）"""
    errs, n = [], 0
    for p, doc in parsed.items():
        for path, s in _strings(doc):
            for m in _NULLISH.finditer(s):
                n += 1
                if not _DIRECT_VAR.fullmatch(m.group(1)):
                    errs.append(f"{rel(p)} {path}: '{m.group(1)} ??' — 左辺が直接の変数ではない")
    return n, errs


def check_animations(parsed, rel):
    """アニメーションの bones は空にできない（Required child ... not found）"""
    errs, n = [], 0
    for p, doc in parsed.items():
        anims = doc.get("animations") if isinstance(doc, dict) else None
        if not isinstance(anims, dict) or "animation_controllers" in doc:
            continue
        for name, a in anims.items():
            n += 1
            if not isinstance(a, dict):
                continue
            if "bones" in a and not a["bones"]:
                errs.append(f"{rel(p)}: {name} の bones が空")
            if not any(k in a for k in ("bones", "particle_effects", "sound_effects", "timeline")):
                errs.append(f"{rel(p)}: {name} に中身がない")
    return n, errs


def validate_particles(rp_dir, rel):
    """RP のパーティクルを公式スキーマ（client/particles）で検証し、未知のコンポーネント名も検出"""
    errs, n = [], 0
    base = os.path.join(rp_dir, "particles")
    comp_file = None
    for d, _, fs in os.walk(base):
        for f in sorted(fs):
            if not f.endswith(".json"):
                continue
            p = os.path.join(d, f)
            doc = json.load(open(p, encoding="utf-8"))
            ver = _pick_version("client/particles", doc.get("format_version", ""))
            if not ver or "particle_effect" not in doc:
                errs.append(f"{rel(p)}: スキーマ／particle_effect が見つからない")
                continue
            n += 1
            v = _validator("client/particles", ver, "Particle Effect Data.json")
            for e in v.iter_errors(doc["particle_effect"]):
                where = "/".join(str(x) for x in e.absolute_path)
                errs.append(f"{rel(p)} [{ver}] {where}: {e.message[:160]}")
            comp_file = os.path.join(SCHEMA_ROOT, "client/particles", ver, "particle_effect component.json")
            known = set(json.load(open(comp_file, encoding="utf-8")).get("properties", {}))
            for c in doc["particle_effect"].get("components", {}):
                if c not in known:
                    errs.append(f"{rel(p)} [{ver}] {c}: スキーマに存在しないコンポーネント")
            mat = doc["particle_effect"].get("description", {}).get("basic_render_parameters", {}).get("material")
            # particles_add は加算合成（光る）。Microsoft の material files の説明にある（3.0.0 で ArsenalOverhaul の発射炎などが使う）
            if mat not in ("particles_alpha", "particles_blend", "particles_opaque", "particles_add"):
                errs.append(f"{rel(p)}: バニラに無いマテリアル {mat}")
    return n, errs


def check_hud_ui(rp_dir, rel, script_mark):
    """ui/hud_screen.json：テクスチャの実在、スクリプトの印との一致、modifications の形"""
    p = os.path.join(rp_dir, "ui", "hud_screen.json")
    if not os.path.exists(p):
        return 0, [f"{rel(p)} がない"]
    ui = json.load(open(p, encoding="utf-8"))
    errs, n = [], 0
    if ui.get("namespace") != "hud":
        errs.append("namespace が hud ではない")

    def walk(node):
        if isinstance(node, dict):
            yield node
            for v in node.values():
                yield from walk(v)
        elif isinstance(node, list):
            for v in node:
                yield from walk(v)

    marks = set()
    # HUD 2.0 の部分はフィールドの切り出し式なので、ここでは除く（build.py の 24 番で往復テスト）
    ui_scope = {k: v for k, v in ui.items() if k != "arsenal_hud2_root"}
    for node in walk(ui_scope):
        t = node.get("texture")
        if isinstance(t, str) and t.startswith("textures/ui/arsenal/"):
            n += 1
            if not os.path.exists(os.path.join(rp_dir, t + ".png")):
                errs.append(f"テクスチャがない: {t}")
        sp = node.get("source_property_name")
        if isinstance(sp, str):
            marks.update(re.findall(r"'([^']*)'", sp))
        if "array_name" in node:
            if node.get("operation") not in ("insert_back", "insert_front", "insert_after", "insert_before", "move_back", "move_front", "move_after", "move_before", "swap", "replace", "remove"):
                errs.append(f"不明な modifications の操作: {node.get('operation')}")
    if not marks or any(not m.startswith(script_mark) for m in marks):
        errs.append(f"HUD の印がスクリプトと一致しない: {sorted(marks)} / {script_mark}")
    return n, errs
