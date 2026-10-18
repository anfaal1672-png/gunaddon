"""ARSENAL CORE 生成：武器（銃・見た目違い ID・迷彩・近接武器）"""
import copy  # noqa: F401
import json  # noqa: F401
import os  # noqa: F401
import sys  # noqa: F401

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import modelgen  # noqa: E402,F401
import riggen  # noqa: E402,F401
from texgen import textures as tx  # noqa: E402,F401
from texgen import icons2 as ic  # noqa: E402
from gen.common import NS, ITEM_FMT, BLOCK_FMT, ENTITY_FMT, wjson, wpng, item_json, is_scoped  # noqa: E402,F401


class WeaponsMixin:
    def _gun_item(self, ident, icon, wid, w, tier, dur, hidden=False, extra_tags=()):
        item = item_json(
            ident, icon, f"item.arsenal.{wid}.name", "equipment" if not hidden else "none", 1,
            extra={
                "minecraft:durability": {"max_durability": dur, "damage_chance": {"min": 0, "max": 0}},
                "minecraft:use_modifiers": {"use_duration": 3600, "movement_modifier": 1.0, "emit_vibrations": False},
                "minecraft:allow_off_hand": False,
                "minecraft:can_destroy_in_creative": False,
            },
            tags=[f"{NS}:firearm", f"{NS}:w_{wid}", f"{NS}:cat_{w['cat']}", *extra_tags],
            rarity=tier["rarity"], hand=True,
        )
        if hidden:
            item["minecraft:item"]["description"]["menu_category"] = {"category": "none", "is_hidden_in_commands": False}
        return item

    def _attachable(self, ident, wid, geo, texture):
        return {
            "format_version": "1.10.0",
            "minecraft:attachable": {
                "description": {
                    "identifier": ident,
                    "materials": {"default": "entity_alphatest", "enchanted": "entity_alphatest_glint"},
                    "textures": {"default": texture, "enchanted": "textures/misc/enchanted_item_glint"},
                    "geometry": {"default": geo},
                    "animations": {"tp": f"animation.arsenal.{wid}.tp", "fp": f"animation.arsenal.{wid}.fp"},
                    "scripts": {"animate": [{"tp": "c.is_first_person == 0.0"}, {"fp": "c.is_first_person == 1.0"}]},
                    "render_controllers": ["controller.render.item_default"],
                }
            },
        }

    def weapons(self):
        W = self.d["WEAPONS"]
        T = self.d["TIERS"]
        C = self.d["CATEGORIES"]
        LOOK = self.d["LOOK"]
        CAMOS = self.d["CAMOS"]
        anims_attach = {}
        anims_player = {}
        self.variant_count = 0
        # 迷彩のテクスチャ（全武器で共有）
        camo_tiles = {}
        for cid, camo in CAMOS.items():
            img, tiles = ic.camo_atlas(cid, camo)
            wpng(f"{self.rp}/textures/entity/arsenal/camo/{cid}.png", img)
            wpng(f"{self.rp}/textures/ui/arsenal/camo_{cid}.png", ic.camo_swatch(cid, camo))
            camo_tiles[cid] = tiles
            self.Lname(f"arsenal.camo.{cid}", camo["name"])
        for wid, w in W.items():
            look = LOOK[wid]
            g = modelgen.build_weapon(wid, w, look["base"])
            self.guns[wid] = g
            tier = T[w["tier"]]
            tex, tiles = tx.weapon_texture(wid, w, tier["accent"])
            tex_path = f"textures/entity/arsenal/weapons/{wid}"
            wpng(f"{self.rp}/{tex_path}.png", tex)
            icon = tx.render_side_icon(g, tiles)
            wpng(f"{self.rp}/textures/items/arsenal/weapons/{wid}.png", icon)
            self.item_textures[f"arsenal_{wid}"] = f"textures/items/arsenal/weapons/{wid}"
            wjson(f"{self.rp}/models/entity/arsenal/weapons/{wid}.geo.json", modelgen.weapon_geometry(wid, g))
            scoped = is_scoped(w)
            anims_attach.update(riggen.attachable_animations(wid, g, w["cat"], scoped))
            pose = C[w["cat"]]["pose"]
            anims_player.update(riggen.hold_animation(wid, pose))
            anims_player.update(riggen.ads_animation(wid, riggen.ads_arm_offset(g, w["cat"], False), w.get("ads", 4) / 20.0))
            wjson(f"{self.rp}/attachables/arsenal/{wid}.json", self._attachable(f"{NS}:{wid}", wid, f"geometry.arsenal.{wid}", tex_path))
            dur = C[w["cat"]]["durability"]
            wjson(f"{self.bp}/items/weapons/{wid}.json", self._gun_item(f"{NS}:{wid}", f"arsenal_{wid}", wid, w, tier, dur))
            self.Lname(f"item.arsenal.{wid}.name", w["name"])
            self.Lname(f"arsenal.desc.{wid}", w["desc"])
            # ---- 光学の見た目違い（__o<グループ>）----
            for grp in look["groups"]:
                vid = f"{wid}__o{grp}"
                gv = modelgen.build_weapon(wid, w, grp)
                wjson(f"{self.rp}/models/entity/arsenal/weapons/{vid}.geo.json", modelgen.weapon_geometry(vid, gv))
                wpng(f"{self.rp}/textures/items/arsenal/weapons/{vid}.png", tx.render_side_icon(gv, tiles))
                self.item_textures[f"arsenal_{vid}"] = f"textures/items/arsenal/weapons/{vid}"
                wjson(f"{self.rp}/attachables/arsenal/variants/{vid}.json", self._attachable(f"{NS}:{vid}", wid, f"geometry.arsenal.{vid}", tex_path))
                wjson(f"{self.bp}/items/weapons/variants/{vid}.json", self._gun_item(f"{NS}:{vid}", f"arsenal_{vid}", wid, w, tier, dur, hidden=True, extra_tags=(f"{NS}:variant",)))
                anims_player.update(riggen.ads_animation(f"{wid}.o{grp}", riggen.ads_arm_offset(gv, w["cat"], False), w.get("ads", 4) / 20.0))
                self.variant_count += 1
            # ---- 迷彩（__c<n>。光学の見た目は既定のまま）----
            for cid in CAMOS:
                vid = f"{wid}__{cid}"
                wpng(f"{self.rp}/textures/items/arsenal/weapons/{vid}.png", tx.render_side_icon(g, camo_tiles[cid]))
                self.item_textures[f"arsenal_{vid}"] = f"textures/items/arsenal/weapons/{vid}"
                wjson(f"{self.rp}/attachables/arsenal/variants/{vid}.json", self._attachable(f"{NS}:{vid}", wid, f"geometry.arsenal.{wid}", f"textures/entity/arsenal/camo/{cid}"))
                wjson(f"{self.bp}/items/weapons/variants/{vid}.json", self._gun_item(f"{NS}:{vid}", f"arsenal_{vid}", wid, w, tier, dur, hidden=True, extra_tags=(f"{NS}:variant", f"{NS}:camo")))
                self.variant_count += 1
        wjson(f"{self.rp}/animations/arsenal_weapons.animation.json", {"format_version": "1.10.0", "animations": anims_attach})
        for cid, c in C.items():
            self.Lname(f"arsenal.cat.{cid}", c["name"])
        for tid2, tier2 in T.items():
            self.Lname(f"arsenal.tier.{tid2}", tier2["name"])
        # プレイヤー用アニメーション
        reload_anims = {}
        for wid, w in W.items():
            style = self.reload_style(w)
            for kind in ("tac", "empty"):
                ticks = w["reload"][kind]
                if w.get("single"):
                    ticks = w["single"]["start"] + w["single"]["per"] * 2 + w["single"]["end"]
                key = f"animation.arsenal.reload.{style}_{ticks}"
                reload_anims[key] = riggen.reload_animation(ticks, style)
            if w.get("single"):
                s = w["single"]
                key = f"animation.arsenal.reload.shell_{s['per']}"
                reload_anims[key] = riggen.reload_animation(s["per"], "shell")
        anims_player.update(riggen.kick_animations())
        anims_player.update(reload_anims)
        anims_player.update(riggen.misc_animations())
        anims_player.update(riggen.sprint_animations(C))
        anims_player.update(riggen.ads_scope_animation())
        anims_player.update(riggen.fp_offset_animations())
        anims_player.update(riggen.melee_animations())
        wjson(f"{self.rp}/animations/arsenal_player.animation.json", {"format_version": "1.10.0", "animations": anims_player})
        self.log(f"  weapons: {len(W)} + variants {self.variant_count}  (player anims {len(anims_player)})")

    @staticmethod
    def reload_style(w):
        if w.get("ammo") == "cell":
            return "cell"
        if w["model"]["type"] in ("double", "launcher", "mortar") and not w.get("single"):
            return "break"
        if w.get("bolt"):
            return "bolt"
        return "mag"

    # -------------------- 近接武器 --------------------

    def melee(self):
        M = self.d["MELEE"]
        T = self.d["TIERS"]
        for mid, m in M.items():
            wpng(f"{self.rp}/textures/items/arsenal/melee/{mid}.png", ic.melee_icon(mid, m))
            self.item_textures[f"arsenal_{mid}"] = f"textures/items/arsenal/melee/{mid}"
            extra = {
                "minecraft:damage": {"value": int(round(m["dmg"]))},
                "minecraft:durability": {"max_durability": m["durability"], "damage_chance": {"min": 60, "max": 100}},
                "minecraft:can_destroy_in_creative": False,
                "minecraft:use_modifiers": {"use_duration": 3600, "movement_modifier": 1.0, "emit_vibrations": False},
                "minecraft:swing_duration": {"value": 0.25 if m["dmg"] < 8 else 0.4},
                "minecraft:enchantable": {"slot": "sword", "value": 10},
                f"{NS}:melee": {},
            }
            if m.get("special") in ("spring",):
                extra["minecraft:cooldown"] = {"category": f"{NS}_spring", "duration": m.get("cooldown", 100) / 20}
            item = item_json(f"{NS}:{mid}", f"arsenal_{mid}", f"item.arsenal.{mid}.name", "equipment", 1, extra=extra,
                             tags=[f"{NS}:melee", f"{NS}:m_{mid}", "minecraft:is_sword"], rarity=T[m["tier"]]["rarity"], hand=True)
            wjson(f"{self.bp}/items/melee/{mid}.json", item)
            self.Lname(f"item.arsenal.{mid}.name", m["name"])
            self.Lname(f"arsenal.desc.{mid}", m["desc"])
        self.log(f"  melee: {len(M)}")
