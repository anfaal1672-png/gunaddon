"""ARSENAL CORE 生成：仕上げ（テクスチャ定義・パックアイコン・言語）"""
import copy  # noqa: F401
import json  # noqa: F401
import os  # noqa: F401
import sys  # noqa: F401

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import modelgen  # noqa: E402,F401
import riggen  # noqa: E402,F401
from texgen import textures as tx  # noqa: E402,F401
from gen.common import NS, ITEM_FMT, BLOCK_FMT, ENTITY_FMT, wjson, wpng, item_json, is_scoped  # noqa: E402,F401


class FinishMixin:
    def finish_textures(self):
        wjson(f"{self.rp}/textures/item_texture.json", {"resource_pack_name": "arsenal_core", "texture_name": "atlas.items", "texture_data": {k: {"textures": v} for k, v in sorted(self.item_textures.items())}})
        wpng(f"{self.rp}/font/glyph_E1.png", tx.glyph_page())

    def pack_icons(self):
        g = self.guns["tempest"]
        W = self.d["WEAPONS"]
        _, tiles = tx.weapon_texture("tempest", W["tempest"], self.d["TIERS"]["uncommon"]["accent"])
        icon = tx.render_side_icon(g, tiles, size=32)
        wpng(f"{self.bp}/pack_icon.png", tx.pack_icon(icon, "bp"))
        wpng(f"{self.rp}/pack_icon.png", tx.pack_icon(icon, "rp"))

    def write_lang(self, ui_strings):
        for k, (en, ja) in ui_strings.items():
            self.L(k, en, ja)
        for lang in ("en_US", "ja_JP"):
            lines = [f"{k}={v}" for k, v in sorted(self.lang[lang].items())]
            os.makedirs(f"{self.rp}/texts", exist_ok=True)
            with open(f"{self.rp}/texts/{lang}.lang", "w", encoding="utf-8") as f:
                f.write("\n".join(lines) + "\n")
        wjson(f"{self.rp}/texts/languages.json", ["en_US", "ja_JP"])
        # BP のパック名
        bp_lang = {
            "en_US": ["pack.name=ARSENAL CORE [Behavior]", "pack.description=ARSENAL CORE 2.0: 90 weapons, 53 attachments, armor, gear, three enemy factions, bosses, structures, killstreaks and game modes."],
            "ja_JP": ["pack.name=ARSENAL CORE [ビヘイビア]", "pack.description=ARSENAL CORE 2.0：武器90種・アタッチメント53種・防具・装備・3勢力の敵・ボス・構造物・キルストリーク・ゲームモード"],
        }
        rp_lang = {
            "en_US": ["pack.name=ARSENAL CORE [Resources]", "pack.description=3D weapon and armor models, synthesized gunfire, particles, HUD 2.0."],
            "ja_JP": ["pack.name=ARSENAL CORE [リソース]", "pack.description=3D 武器・防具モデル、合成銃声、パーティクル、HUD 2.0"],
        }
        for lang in ("en_US", "ja_JP"):
            os.makedirs(f"{self.bp}/texts", exist_ok=True)
            with open(f"{self.bp}/texts/{lang}.lang", "w", encoding="utf-8") as f:
                f.write("\n".join(bp_lang[lang]) + "\n")
            with open(f"{self.rp}/texts/{lang}.lang", "a", encoding="utf-8") as f:
                f.write("\n".join(rp_lang[lang]) + "\n")
        wjson(f"{self.bp}/texts/languages.json", ["en_US", "ja_JP"])
