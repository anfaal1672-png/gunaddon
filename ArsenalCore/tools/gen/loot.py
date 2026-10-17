"""ARSENAL CORE 生成：構造物ルート"""
import copy  # noqa: F401
import json  # noqa: F401
import os  # noqa: F401
import sys  # noqa: F401

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import modelgen  # noqa: E402,F401
import riggen  # noqa: E402,F401
from texgen import textures as tx  # noqa: E402,F401
from gen.common import NS, ITEM_FMT, BLOCK_FMT, ENTITY_FMT, wjson, wpng, item_json, is_scoped  # noqa: E402,F401


class LootMixin:
    def loot(self, vanilla_loot_dir):
        W = self.d["WEAPONS"]
        by_tier = {}
        for wid, w in W.items():
            by_tier.setdefault(w["tier"], []).append(wid)
        A = self.d["ATTACHMENTS"]
        att_by_tier = {}
        for aid, a in A.items():
            att_by_tier.setdefault(a["tier"], []).append(aid)

        def gun_entries(tiers, weight):
            out = []
            for t, wgt in tiers.items():
                for wid in by_tier.get(t, []):
                    out.append({"type": "item", "name": f"{NS}:{wid}", "weight": wgt * weight,
                                "functions": [{"function": "set_damage", "damage": {"min": 0.35, "max": 0.9}}]})
            return out

        def ammo_entries(n=(6, 20)):
            out = []
            for fam in ("light", "medium", "heavy", "magnum"):
                out.append({"type": "item", "name": f"{NS}:ammo_{fam}", "weight": 6, "functions": [{"function": "set_count", "count": {"min": n[0], "max": n[1]}}]})
            out.append({"type": "item", "name": f"{NS}:shell_buck", "weight": 4, "functions": [{"function": "set_count", "count": {"min": 4, "max": 10}}]})
            out.append({"type": "item", "name": f"{NS}:ammo_precision", "weight": 2, "functions": [{"function": "set_count", "count": {"min": 2, "max": 6}}]})
            return out

        def mats():
            return [
                {"type": "item", "name": f"{NS}:steel_ingot", "weight": 8, "functions": [{"function": "set_count", "count": {"min": 1, "max": 4}}]},
                {"type": "item", "name": f"{NS}:precision_parts", "weight": 5, "functions": [{"function": "set_count", "count": {"min": 1, "max": 3}}]},
                {"type": "item", "name": f"{NS}:polymer", "weight": 5, "functions": [{"function": "set_count", "count": {"min": 1, "max": 3}}]},
            ]

        def atts(tiers):
            out = []
            for t, wgt in tiers.items():
                for aid in att_by_tier.get(t, []):
                    out.append({"type": "item", "name": f"{NS}:{aid}", "weight": wgt})
            return out

        def throws(n=1):
            return [{"type": "item", "name": f"{NS}:{tid}", "weight": 3, "functions": [{"function": "set_count", "count": {"min": 1, "max": n}}]} for tid in ("grenade_frag", "grenade_smoke", "grenade_flash", "molotov")]

        plan = {
            "abandoned_mineshaft": [
                {"rolls": {"min": 0, "max": 1}, "entries": gun_entries({"common": 3, "uncommon": 1}, 1) + [{"type": "empty", "weight": 40}]},
                {"rolls": {"min": 1, "max": 2}, "entries": ammo_entries() + mats() + [{"type": "empty", "weight": 20}]},
            ],
            "simple_dungeon": [
                {"rolls": {"min": 0, "max": 1}, "entries": gun_entries({"common": 3, "uncommon": 1}, 1) + [{"type": "empty", "weight": 30}]},
                {"rolls": {"min": 1, "max": 2}, "entries": ammo_entries() + throws(2) + [{"type": "empty", "weight": 10}]},
            ],
            "pillager_outpost": [
                {"rolls": 1, "entries": gun_entries({"uncommon": 3, "rare": 1}, 1) + [{"type": "empty", "weight": 12}]},
                {"rolls": {"min": 1, "max": 2}, "entries": atts({"common": 3, "uncommon": 2}) + throws(3) + [{"type": "empty", "weight": 8}]},
                {"rolls": {"min": 1, "max": 3}, "entries": ammo_entries((8, 24))},
            ],
            "ancient_city": [
                {"rolls": {"min": 0, "max": 1}, "entries": gun_entries({"rare": 2, "legendary": 1}, 1) + [{"type": "empty", "weight": 20}]},
                {"rolls": {"min": 0, "max": 2}, "entries": [
                    {"type": "item", "name": f"{NS}:energy_cell", "weight": 5, "functions": [{"function": "set_count", "count": {"min": 2, "max": 8}}]},
                    {"type": "item", "name": f"{NS}:energy_core", "weight": 2},
                ] + atts({"rare": 2}) + [{"type": "empty", "weight": 8}]},
            ],
            "bastion_treasure": [
                {"rolls": 1, "entries": gun_entries({"rare": 2, "legendary": 1}, 1) + [{"type": "empty", "weight": 6}]},
                {"rolls": {"min": 1, "max": 2}, "entries": atts({"uncommon": 2, "rare": 3}) + [{"type": "item", "name": f"{NS}:ammo_rocket", "weight": 3, "functions": [{"function": "set_count", "count": {"min": 1, "max": 3}}]}]},
            ],
            "bastion_other": [
                {"rolls": {"min": 0, "max": 1}, "entries": gun_entries({"uncommon": 2, "rare": 1}, 1) + [{"type": "empty", "weight": 16}]},
                {"rolls": {"min": 1, "max": 2}, "entries": ammo_entries((6, 18)) + mats()},
            ],
            "shipwreck": [
                {"rolls": {"min": 0, "max": 1}, "entries": [{"type": "item", "name": f"{NS}:flare_pistol", "weight": 3}, {"type": "item", "name": f"{NS}:flare_shell", "weight": 4, "functions": [{"function": "set_count", "count": {"min": 2, "max": 6}}]}] + gun_entries({"common": 1}, 1) + [{"type": "empty", "weight": 14}]},
            ],
            "shipwrecksupply": [
                {"rolls": {"min": 1, "max": 2}, "entries": ammo_entries() + mats() + [{"type": "empty", "weight": 12}]},
            ],
            "shipwrecktreasure": [
                {"rolls": {"min": 0, "max": 1}, "entries": gun_entries({"uncommon": 2, "rare": 1}, 1) + atts({"uncommon": 1}) + [{"type": "empty", "weight": 10}]},
            ],
        }
        n = 0
        for table, pools in plan.items():
            src = os.path.join(vanilla_loot_dir, f"{table}.json")
            with open(src, encoding="utf-8") as f:
                import jsonc
                base = jsonc.loads(f.read())
            base = copy.deepcopy(base)
            base.setdefault("pools", []).extend(pools)
            wjson(f"{self.bp}/loot_tables/chests/{table}.json", base)
            n += 1
        self.log(f"  loot tables (vanilla + arsenal pools): {n}")

    # -------------------- クリエイティブ分類 --------------------
