"""ARSENAL CORE 生成：ブロック"""
import copy  # noqa: F401
import json  # noqa: F401
import os  # noqa: F401
import sys  # noqa: F401

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import modelgen  # noqa: E402,F401
import riggen  # noqa: E402,F401
from texgen import textures as tx  # noqa: E402,F401
from gen.common import NS, ITEM_FMT, BLOCK_FMT, ENTITY_FMT, wjson, wpng, item_json, is_scoped  # noqa: E402,F401


class BlocksMixin:
    def blocks(self):
        tex = tx.block_textures()
        terrain = {}
        for k, img in tex.items():
            wpng(f"{self.rp}/textures/blocks/arsenal/{k}.png", img)
            terrain[k] = {"textures": f"textures/blocks/arsenal/{k}"}
        defs = {
            "weapon_bench": ("arsenal_bench_top", "arsenal_bench_side", "arsenal_bench_bottom", "bench", {"en": "Weapon Bench", "ja": "兵器作業台"}, "#4c5440", 3.0),
            "ammo_press": ("arsenal_press_top", "arsenal_press_side", "arsenal_bench_bottom", "press", {"en": "Ammo Press", "ja": "弾薬製造機"}, "#786c58", 3.0),
            "ammo_crate": ("arsenal_crate_top", "arsenal_crate_side", "arsenal_crate_top", "crate", {"en": "Ammo Crate", "ja": "弾薬箱"}, "#546040", 1.5),
        }
        blocks_json = {"format_version": "1.21.40"}
        for bid, (top, side, bot, kind, name, color, hard) in defs.items():
            block = {
                "format_version": BLOCK_FMT,
                "minecraft:block": {
                    "description": {"identifier": f"{NS}:{bid}", "menu_category": {"category": "items"}},
                    "components": {
                        "minecraft:geometry": "minecraft:geometry.full_block",
                        "minecraft:material_instances": {
                            "*": {"texture": side, "render_method": "opaque"},
                            "up": {"texture": top, "render_method": "opaque"},
                            "down": {"texture": bot, "render_method": "opaque"},
                        },
                        "minecraft:destructible_by_mining": {"seconds_to_destroy": hard},
                        "minecraft:destructible_by_explosion": {"explosion_resistance": 15},
                        "minecraft:map_color": color,
                        f"{NS}:station": {"kind": kind},
                    },
                },
            }
            wjson(f"{self.bp}/blocks/{bid}.json", block)
            self.Lname(f"tile.{NS}:{bid}.name", name)
            blocks_json[f"{NS}:{bid}"] = {"sound": "metal" if kind != "crate" else "wood"}
        # 2.0：構造物の目印（見えない・触れない）。site_marker は近くにプレイヤーが来たら構造物を展開する
        from PIL import Image
        wpng(f"{self.rp}/textures/blocks/arsenal/arsenal_invisible.png", Image.new("RGBA", (16, 16), (0, 0, 0, 0)))
        terrain["arsenal_invisible"] = {"textures": "textures/blocks/arsenal/arsenal_invisible"}
        n_kinds = max(1, len(self.d["STRUCTURES"]))
        for bid, states, extra in (
            ("site_marker", {f"{NS}:kind": {"values": {"min": 0, "max": n_kinds - 1}}},
             {"minecraft:tick": {"interval_range": [40, 60], "looping": True}, f"{NS}:site": {}}),
            ("spawn_marker", {f"{NS}:role": {"values": {"min": 0, "max": 3}}}, {}),
        ):
            block = {
                "format_version": BLOCK_FMT,
                "minecraft:block": {
                    "description": {"identifier": f"{NS}:{bid}", "menu_category": {"category": "none", "is_hidden_in_commands": True}, "states": states},
                    "components": {
                        "minecraft:geometry": "minecraft:geometry.full_block",
                        "minecraft:material_instances": {"*": {"texture": "arsenal_invisible", "render_method": "alpha_test"}},
                        "minecraft:collision_box": False,
                        "minecraft:selection_box": False,
                        "minecraft:light_dampening": 0,
                        "minecraft:destructible_by_explosion": False,
                        "minecraft:destructible_by_mining": False,
                        "minecraft:loot": "loot_tables/empty.json",
                        **extra,
                    },
                },
            }
            wjson(f"{self.bp}/blocks/{bid}.json", block)
            self.L(f"tile.{NS}:{bid}.name", "ARSENAL site marker" if bid == "site_marker" else "ARSENAL spawn marker",
                   "ARSENAL 構造物の目印" if bid == "site_marker" else "ARSENAL 出現位置の目印")
            blocks_json[f"{NS}:{bid}"] = {"sound": "stone"}
        wjson(f"{self.bp}/loot_tables/empty.json", {"pools": []})
        wjson(f"{self.rp}/blocks.json", blocks_json)
        wjson(f"{self.rp}/textures/terrain_texture.json", {
            "resource_pack_name": "arsenal_core", "texture_name": "atlas.terrain", "padding": 8, "num_mip_levels": 4,
            "texture_data": terrain,
        })

    # -------------------- レシピ（作業台で作る基本素材・設備） --------------------
