"""ARSENAL CORE 生成：アタッチメント・弾薬・投擲物・素材・道具・クリエイティブ分類"""
import copy  # noqa: F401
import json  # noqa: F401
import os  # noqa: F401
import sys  # noqa: F401

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import modelgen  # noqa: E402,F401
import riggen  # noqa: E402,F401
from texgen import textures as tx  # noqa: E402,F401
from gen.common import NS, ITEM_FMT, BLOCK_FMT, ENTITY_FMT, wjson, wpng, item_json, is_scoped  # noqa: E402,F401
from texgen import icons2 as ic  # noqa: E402


class ItemsMixin:
    def attachments(self):
        A = self.d["ATTACHMENTS"]
        T = self.d["TIERS"]
        for aid, a in A.items():
            wpng(f"{self.rp}/textures/items/arsenal/attachments/{aid}.png", ic.attachment_icon_any(aid, a))
            self.item_textures[f"arsenal_{aid}"] = f"textures/items/arsenal/attachments/{aid}"
            item = item_json(f"{NS}:{aid}", f"arsenal_{aid}", f"item.arsenal.{aid}.name", "equipment", 16,
                             tags=[f"{NS}:attachment", f"{NS}:slot_{a['slot']}"], rarity=T[a["tier"]]["rarity"])
            wjson(f"{self.bp}/items/attachments/{aid}.json", item)
            self.Lname(f"item.arsenal.{aid}.name", a["name"])
            self.Lname(f"arsenal.desc.{aid}", a["desc"])
        for sid, s in self.d["ATTACHMENT_SLOTS"].items():
            self.Lname(f"arsenal.slot.{sid}", s["name"])
        for oid, o in self.d["OPTICS"].items():
            self.Lname(f"arsenal.optic.{oid}", o["name"])
        self.log(f"  attachments: {len(A)}")

    # -------------------- 弾薬 --------------------

    def ammo(self):
        items = self.d["ammoItems"]
        for it in items:
            aid = it["id"]
            wpng(f"{self.rp}/textures/items/arsenal/ammo/{aid}.png", ic.ammo_icon_any(it))
            self.item_textures[f"arsenal_{aid}"] = f"textures/items/arsenal/ammo/{aid}"
            item = item_json(f"{NS}:{aid}", f"arsenal_{aid}", f"item.arsenal.{aid}.name", "items", 64,
                             tags=[f"{NS}:ammo", f"{NS}:ammo_{it['family']}"])
            wjson(f"{self.bp}/items/ammo/{aid}.json", item)
            self.Lname(f"item.arsenal.{aid}.name", it["name"])
        for fam, f in self.d["AMMO_FAMILIES"].items():
            self.Lname(f"arsenal.ammo.{fam}", f["name"])
        for vid, v in self.d["AMMO_VARIANTS"].items():
            if vid != "std":
                self.Lname(f"arsenal.variant.{vid}", v["name"])
        self.L("arsenal.variant.std", "Standard", "通常弾")
        for vid, v in self.d["SHELL_VARIANTS"].items():
            self.Lname(f"arsenal.variant.{vid}", v["name"])
        self.log(f"  ammo items: {len(items)}")

    # -------------------- 投擲物・素材・ツール --------------------

    def misc_items(self):
        T = self.d["TIERS"]
        for tid, t in self.d["THROWABLES"].items():
            wpng(f"{self.rp}/textures/items/arsenal/throwables/{tid}.png", ic.throwable_icon_any(tid, t))
            self.item_textures[f"arsenal_{tid}"] = f"textures/items/arsenal/throwables/{tid}"
            extra = {"minecraft:use_modifiers": {"use_duration": 60, "movement_modifier": 1.0, "emit_vibrations": False}}
            if t["kind"] == "mine":
                extra = {f"{NS}:gear": {}}  # ブロックの上面に使うと置く（onUseOn）
            item = item_json(f"{NS}:{tid}", f"arsenal_{tid}", f"item.arsenal.{tid}.name", "equipment", 16,
                             extra=extra, tags=[f"{NS}:throwable"], rarity=T[t["tier"]]["rarity"])
            wjson(f"{self.bp}/items/throwables/{tid}.json", item)
            self.Lname(f"item.arsenal.{tid}.name", t["name"])
            self.Lname(f"arsenal.desc.{tid}", t["desc"])
        for mid, m in self.d["MATERIALS"].items():
            wpng(f"{self.rp}/textures/items/arsenal/materials/{mid}.png", tx.material_icon(mid))
            self.item_textures[f"arsenal_{mid}"] = f"textures/items/arsenal/materials/{mid}"
            item = item_json(f"{NS}:{mid}", f"arsenal_{mid}", f"item.arsenal.{mid}.name", "items", 64,
                             tags=[f"{NS}:material"], glint=(mid == "energy_core"))
            wjson(f"{self.bp}/items/materials/{mid}.json", item)
            self.Lname(f"item.arsenal.{mid}.name", m["name"])
            self.Lname(f"arsenal.desc.{mid}", m["desc"])
        for tid, t in self.d["TOOLS"].items():
            iid = "target_kit" if tid == "target_dummy" else tid
            wpng(f"{self.rp}/textures/items/arsenal/tools/{iid}.png", ic.tool_icon_any(tid))
            self.item_textures[f"arsenal_{iid}"] = f"textures/items/arsenal/tools/{iid}"
            extra = {f"{NS}:tool": {}}
            stack = 1 if tid in ("field_manual", "detonator", "arena_tool", "streak_terminal") else 16
            if tid in ("warlord_banner", "legion_core", "hollow_heart"):
                stack = 4
            if tid == "target_dummy":
                extra = {"minecraft:entity_placer": {"entity": f"{NS}:target_dummy"}}
            item = item_json(f"{NS}:{iid}", f"arsenal_{iid}", f"item.arsenal.{iid}.name", "equipment" if tid != "target_dummy" else "items", stack,
                             extra=extra, tags=[f"{NS}:tool"])
            wjson(f"{self.bp}/items/tools/{iid}.json", item)
            self.Lname(f"item.arsenal.{iid}.name", t["name"])
            self.Lname(f"arsenal.desc.{iid}", t["desc"])

    # -------------------- ブロック --------------------

    def catalog(self):
        W = self.d["WEAPONS"]
        C = self.d["CATEGORIES"]
        groups = []
        for cid, c in sorted(C.items(), key=lambda kv: kv[1]["order"]):
            ids = [f"{NS}:{wid}" for wid, w in W.items() if w["cat"] == cid]
            if cid == "melee":
                ids = [f"{NS}:{mid}" for mid in self.d["MELEE"]]
            gname = f"{NS}:itemGroup.name.{cid}"
            self.Lname(gname, c["name"])
            groups.append({"group_identifier": {"icon": ids[0], "name": gname}, "items": ids})
        att_ids = [f"{NS}:{a}" for a in self.d["ATTACHMENTS"]]
        self.L(f"{NS}:itemGroup.name.attachments", "Weapon Attachments", "アタッチメント")
        groups.append({"group_identifier": {"icon": f"{NS}:optic_4x", "name": f"{NS}:itemGroup.name.attachments"}, "items": att_ids})
        thr = [f"{NS}:{t}" for t in self.d["THROWABLES"]] + [f"{NS}:detonator"]
        self.L(f"{NS}:itemGroup.name.throwables", "Grenades & Explosives", "投擲物・爆発物")
        groups.append({"group_identifier": {"icon": f"{NS}:grenade_frag", "name": f"{NS}:itemGroup.name.throwables"}, "items": thr})
        armor = [f"{NS}:{a}" for a in self.d["ARMOR"]]
        self.L(f"{NS}:itemGroup.name.armor", "Tactical Armor", "戦術防具")
        groups.append({"group_identifier": {"icon": f"{NS}:helmet_standard_2", "name": f"{NS}:itemGroup.name.armor"}, "items": armor})
        med = [f"{NS}:{m}" for m in self.d["MEDICAL"]]
        self.L(f"{NS}:itemGroup.name.medical", "Medical", "医療品")
        groups.append({"group_identifier": {"icon": f"{NS}:medkit", "name": f"{NS}:itemGroup.name.medical"}, "items": med})
        dep = [f"{NS}:{m}" for m in self.d["DEPLOYABLES"]] + [f"{NS}:{v}" for v in self.d["VEHICLES"]]
        self.L(f"{NS}:itemGroup.name.deployables", "Deployables & Vehicles", "設置物・銃座・乗り物")
        groups.append({"group_identifier": {"icon": f"{NS}:sentry_turret", "name": f"{NS}:itemGroup.name.deployables"}, "items": dep})
        tools = [f"{NS}:field_manual", f"{NS}:repair_kit", f"{NS}:streak_terminal", f"{NS}:arena_tool", f"{NS}:warlord_banner", f"{NS}:legion_core", f"{NS}:hollow_heart"]
        groups.append({"items": tools})
        ammo_ids = [f"{NS}:{a['id']}" for a in self.d["ammoItems"]]
        self.L(f"{NS}:itemGroup.name.ammo", "Ammunition", "弾薬")
        mats = [f"{NS}:{m}" for m in self.d["MATERIALS"]]
        self.L(f"{NS}:itemGroup.name.materials", "Arsenal Materials", "兵器素材")
        blocks = [f"{NS}:weapon_bench", f"{NS}:ammo_press", f"{NS}:ammo_crate", f"{NS}:target_kit"]
        self.L(f"{NS}:itemGroup.name.stations", "Arsenal Stations", "兵器設備")
        cat = {"format_version": "1.26.50", "minecraft:crafting_items_catalog": {"categories": [
            {"category_name": "equipment", "groups": groups},
            {"category_name": "items", "groups": [
                {"group_identifier": {"icon": f"{NS}:ammo_medium", "name": f"{NS}:itemGroup.name.ammo"}, "items": ammo_ids},
                {"group_identifier": {"icon": f"{NS}:steel_ingot", "name": f"{NS}:itemGroup.name.materials"}, "items": mats},
                {"group_identifier": {"icon": f"{NS}:weapon_bench", "name": f"{NS}:itemGroup.name.stations"}, "items": blocks},
            ]},
        ]}}
        wjson(f"{self.bp}/item_catalog/crafting_item_catalog.json", cat)

    # -------------------- パーティクル --------------------
