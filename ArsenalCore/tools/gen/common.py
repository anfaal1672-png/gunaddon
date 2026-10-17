"""
ARSENAL CORE 生成：共通（書き出し・アイテム JSON の雛形・基底クラス）
weapons.data.js（data.json）からアイテム・アタッチャブル・エンティティ・ブロック・レシピ・
ルートテーブル・パーティクル・サウンド定義・言語ファイル・テクスチャ定義を生成する。
"""
import copy
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import modelgen  # noqa: E402
import riggen  # noqa: E402
from texgen import textures as tx  # noqa: E402

NS = "arsenal"
ITEM_FMT = "1.26.30"
BLOCK_FMT = "1.26.20"
ENTITY_FMT = "1.26.20"


def wjson(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)


def wpng(path, img):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path)


# ---------------------------------------------------------------------------
#  共通：アイテム
# ---------------------------------------------------------------------------
def item_json(ident, icon, name_key, category="equipment", stack=64, extra=None, tags=None, rarity=None, glint=False, hand=False):
    comps = {
        "minecraft:icon": icon,
        "minecraft:display_name": {"value": name_key},
        "minecraft:max_stack_size": stack,
    }
    if hand:
        comps["minecraft:hand_equipped"] = True
    if tags:
        comps["minecraft:tags"] = {"tags": tags}
    if rarity:
        comps["minecraft:rarity"] = rarity
    if glint:
        comps["minecraft:glint"] = True
    if extra:
        comps.update(extra)
    return {
        "format_version": ITEM_FMT,
        "minecraft:item": {
            "description": {"identifier": ident, "menu_category": {"category": category}},
            "components": comps,
        },
    }


def is_scoped(w):
    return w.get("optic") in ("scope4", "scope8") or w["cat"] == "sniper"


# ---------------------------------------------------------------------------
#  メイン生成
# ---------------------------------------------------------------------------


class GenBase:
    def __init__(self, data, bp, rp, log=print):
        self.d = data
        self.bp = bp
        self.rp = rp
        self.log = log
        self.item_textures = {}
        self.lang = {"en_US": {}, "ja_JP": {}}
        self.guns = {}

    # -------------------- 言語 --------------------

    def L(self, key, en, ja=None):
        self.lang["en_US"][key] = en
        self.lang["ja_JP"][key] = ja if ja is not None else en

    def Lname(self, key, name):
        self.L(key, name["en"], name["ja"])

    # -------------------- 武器 --------------------
