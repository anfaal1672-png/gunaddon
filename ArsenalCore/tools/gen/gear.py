"""ARSENAL CORE 生成：医療品・設置物・銃座・乗り物のアイテム"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import modelgen2  # noqa: E402
from texgen import textures as tx  # noqa: E402
from texgen import icons2 as ic  # noqa: E402
from texgen.iso import render_iso_icon  # noqa: E402
from gen.common import NS, wjson, wpng, item_json  # noqa: E402

# 設置物・乗り物の見た目の色（エンティティのテクスチャとアイコンで共通）
GEAR_PALETTES = {
    "sentry": {"main": (110, 120, 136), "main_dark": (60, 64, 72), "furniture": (92, 100, 70)},
    "shield_wall": {"main": (70, 76, 86), "main_dark": (40, 42, 48)},
    "claymore": {"main": (92, 100, 70), "main_dark": (60, 66, 44)},
    "ammo_station": {"main": (92, 100, 70), "main_dark": (56, 62, 40)},
    "med_station": {"main": (230, 230, 222), "main_dark": (120, 124, 130), "white": (236, 236, 230)},
    "mortar_emplacement": {"main": (92, 100, 70), "main_dark": (48, 50, 44)},
    "recon_drone": {"main": (60, 64, 72), "main_dark": (36, 38, 42)},
    "hmg_nest": {"main": (54, 56, 60), "main_dark": (36, 38, 42), "furniture": (170, 150, 110)},
    "aa_gun": {"main": (92, 100, 70), "main_dark": (56, 62, 40)},
    "at_post": {"main": (92, 100, 70), "main_dark": (56, 62, 40)},
    "buggy": {"main": (176, 152, 110), "main_dark": (80, 76, 66), "furniture": (120, 100, 70), "accent": (230, 170, 30)},
    "gl_post": {"main": (92, 100, 70), "main_dark": (56, 62, 40)},
    "apc": {"main": (88, 98, 70), "main_dark": (52, 58, 42), "furniture": (70, 76, 56), "accent": (230, 170, 30)},
    "supply_crate": {"main": (150, 110, 60), "main_dark": (100, 72, 40), "furniture": (160, 116, 64), "white": (236, 236, 230), "accent": (230, 60, 50)},
}


class GearMixin:
    def gear_items(self):
        T = self.d["TIERS"]
        # 医療品
        for mid, m in self.d["MEDICAL"].items():
            wpng(f"{self.rp}/textures/items/arsenal/medical/{mid}.png", ic.medical_icon(mid))
            self.item_textures[f"arsenal_{mid}"] = f"textures/items/arsenal/medical/{mid}"
            extra = {
                "minecraft:use_modifiers": {"use_duration": round(m["use"] / 20, 2), "movement_modifier": 0.6, "emit_vibrations": False},
                "minecraft:use_animation": "brush" if mid in ("bandage", "medkit", "armor_plate") else "eat",
                f"{NS}:gear": {},
            }
            if mid == "defibrillator":
                extra["minecraft:interact_button"] = True
                extra["minecraft:use_modifiers"] = {"use_duration": 3600, "movement_modifier": 0.6, "emit_vibrations": False}
            stack = 1 if mid == "defibrillator" else 16
            item = item_json(f"{NS}:{mid}", f"arsenal_{mid}", f"item.arsenal.{mid}.name", "equipment", stack, extra=extra,
                             tags=[f"{NS}:medical"], rarity=T[m["tier"]]["rarity"])
            wjson(f"{self.bp}/items/gear/{mid}.json", item)
            self.Lname(f"item.arsenal.{mid}.name", m["name"])
            self.Lname(f"arsenal.desc.{mid}", m["desc"])
        # 設置物（地面に向けて使うと設置）
        for did, dd in self.d["DEPLOYABLES"].items():
            kind = dd.get("entity") or did
            if dd.get("offhand"):
                wpng(f"{self.rp}/textures/items/arsenal/gear/{did}.png", self._riot_shield_icon())
            else:
                m, _ = modelgen2.entity_model(kind, did)
                _, tiles = tx.atlas_tiles(GEAR_PALETTES.get(kind, {}), "gear:" + kind)
                wpng(f"{self.rp}/textures/items/arsenal/gear/{did}.png", render_iso_icon(m.all_cubes(), tiles, 32))
            self.item_textures[f"arsenal_{did}"] = f"textures/items/arsenal/gear/{did}"
            extra = {f"{NS}:gear": {}}
            stack = 4
            if dd.get("offhand"):
                extra = {
                    "minecraft:allow_off_hand": True,
                    "minecraft:durability": {"max_durability": dd.get("durability", 600)},
                    f"{NS}:gear": {},
                }
                stack = 1
            elif kind == "recon_drone":
                extra["minecraft:use_modifiers"] = {"use_duration": 3600, "movement_modifier": 1.0, "emit_vibrations": False}
                stack = 1
            item = item_json(f"{NS}:{did}", f"arsenal_{did}", f"item.arsenal.{did}.name", "equipment", stack, extra=extra,
                             tags=[f"{NS}:deployable"], rarity=T[dd["tier"]]["rarity"])
            wjson(f"{self.bp}/items/gear/{did}.json", item)
            self.Lname(f"item.arsenal.{did}.name", dd["name"])
            self.Lname(f"arsenal.desc.{did}", dd["desc"])
        # 銃座・乗り物（地面に向けて使うと設置）
        for vid, v in self.d["VEHICLES"].items():
            m, _ = modelgen2.entity_model(vid, vid)
            _, tiles = tx.atlas_tiles(GEAR_PALETTES.get(vid, {}), "gear:" + vid)
            wpng(f"{self.rp}/textures/items/arsenal/gear/{vid}.png", render_iso_icon(m.all_cubes(), tiles, 32))
            self.item_textures[f"arsenal_{vid}"] = f"textures/items/arsenal/gear/{vid}"
            item = item_json(f"{NS}:{vid}", f"arsenal_{vid}", f"item.arsenal.{vid}.name", "equipment", 1, extra={f"{NS}:gear": {}},
                             tags=[f"{NS}:vehicle"], rarity=T[v["tier"]]["rarity"])
            wjson(f"{self.bp}/items/gear/{vid}.json", item)
            self.Lname(f"item.arsenal.{vid}.name", v["name"])
            self.Lname(f"arsenal.desc.{vid}", v["desc"])
        # キルストリークのアイコン（フォーム用）
        for kid, k in self.d["KILLSTREAKS"].items():
            wpng(f"{self.rp}/textures/ui/arsenal/ks_{kid}.png", ic.killstreak_icon(kid))
            self.Lname(f"arsenal.ks.{kid}", k["name"])
            self.Lname(f"arsenal.ks.{kid}.desc", k["desc"])
        self.log(f"  gear: medical {len(self.d['MEDICAL'])}, deployables {len(self.d['DEPLOYABLES'])}, vehicles {len(self.d['VEHICLES'])}")

    @staticmethod
    def _riot_shield_icon():
        from PIL import ImageDraw
        img = tx.new_icon()
        d = ImageDraw.Draw(img)
        d.rounded_rectangle([6, 2, 26, 30], 3, fill=(60, 66, 76, 255))
        d.rounded_rectangle([8, 4, 24, 28], 2, fill=(84, 92, 104, 255))
        d.rectangle([10, 7, 22, 11], fill=(90, 150, 210, 255))
        d.rectangle([8, 18, 24, 20], fill=(230, 230, 222, 255))
        return tx.outline(img)
