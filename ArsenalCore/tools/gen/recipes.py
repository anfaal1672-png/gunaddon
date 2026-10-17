"""ARSENAL CORE 生成：作業台レシピ"""
import copy  # noqa: F401
import json  # noqa: F401
import os  # noqa: F401
import sys  # noqa: F401

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import modelgen  # noqa: E402,F401
import riggen  # noqa: E402,F401
from texgen import textures as tx  # noqa: E402,F401
from gen.common import NS, ITEM_FMT, BLOCK_FMT, ENTITY_FMT, wjson, wpng, item_json, is_scoped  # noqa: E402,F401


class RecipesMixin:
    def recipes(self):
        R = []

        def shapeless(rid, ingredients, result, count=1, unlock=None):
            ing = [{"item": k, "count": v} if v > 1 else {"item": k} for k, v in ingredients.items()]
            R.append((rid, {"format_version": "1.20.10", "minecraft:recipe_shapeless": {
                "description": {"identifier": f"{NS}:{rid}"}, "tags": ["crafting_table"], "ingredients": ing,
                "result": {"item": result, "count": count},
                "unlock": [{"item": unlock or list(ingredients.keys())[0]}],
            }}))

        def shaped(rid, pattern, key, result, count=1, unlock=None):
            k2 = {}
            for ch, v in key.items():
                k2[ch] = {"tag": v[4:]} if v.startswith("tag:") else {"item": v}
            R.append((rid, {"format_version": "1.20.10", "minecraft:recipe_shaped": {
                "description": {"identifier": f"{NS}:{rid}"}, "tags": ["crafting_table"], "pattern": pattern, "key": k2,
                "result": {"item": result, "count": count},
                "unlock": [{"item": unlock}] if unlock else [{"item": [v for v in key.values() if not v.startswith("tag:")][0]}],
            }}))

        shapeless("steel_ingot", {"minecraft:iron_ingot": 1, "minecraft:coal": 2}, f"{NS}:steel_ingot")
        shapeless("steel_ingot_charcoal", {"minecraft:iron_ingot": 1, "minecraft:charcoal": 2}, f"{NS}:steel_ingot")
        shaped("precision_parts", [" S ", "RCR", " S "], {"S": f"{NS}:steel_ingot", "R": "minecraft:redstone", "C": "minecraft:copper_ingot"}, f"{NS}:precision_parts", 2, f"{NS}:steel_ingot")
        shapeless("polymer", {"minecraft:slime_ball": 1, "minecraft:dried_kelp": 2}, f"{NS}:polymer", 2)
        shapeless("polymer_honeycomb", {"minecraft:honeycomb": 1, "minecraft:dried_kelp": 2}, f"{NS}:polymer", 2)
        shaped("energy_core", [" A ", "RDR", " A "], {"A": "minecraft:amethyst_shard", "R": "minecraft:redstone_block", "D": "minecraft:diamond"}, f"{NS}:energy_core", 1, "minecraft:amethyst_shard")
        shaped("weapon_bench", ["SPS", "SCS", "III"], {"S": f"{NS}:steel_ingot", "P": f"{NS}:precision_parts", "C": "minecraft:crafting_table", "I": "minecraft:iron_ingot"}, f"{NS}:weapon_bench", 1, "minecraft:crafting_table")
        shaped("ammo_press", ["SRS", "SFS", "SSS"], {"S": f"{NS}:steel_ingot", "R": "minecraft:redstone", "F": "minecraft:furnace"}, f"{NS}:ammo_press", 1, "minecraft:furnace")
        shaped("ammo_crate", ["WSW", "PCP", "WSW"], {"W": "tag:minecraft:planks", "S": f"{NS}:steel_ingot", "P": f"{NS}:polymer", "C": "minecraft:chest"}, f"{NS}:ammo_crate", 1, "minecraft:chest")
        for tid, t in self.d["TOOLS"].items():
            iid = "target_kit" if tid == "target_dummy" else tid
            shapeless(iid, t["cost"], f"{NS}:{iid}")
        for rid, obj in R:
            wjson(f"{self.bp}/recipes/{rid}.json", obj)
        self.log(f"  recipes: {len(R)}")

    # -------------------- エンティティ --------------------
