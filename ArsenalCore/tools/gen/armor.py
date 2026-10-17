"""ARSENAL CORE 生成：防具（アイテム・3D アタッチャブル・テクスチャ・アイコン）"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import modelgen2  # noqa: E402
from texgen import textures as tx  # noqa: E402
from texgen.iso import render_iso_icon  # noqa: E402
from gen.common import NS, wjson, wpng, item_json  # noqa: E402


def armor_palette(a, fams, tiers):
    fam = fams[a["family"]]
    pal = {
        "main": tuple(fam["color"]),
        "main_dark": tuple(fam["accent"]),
        "furniture": tuple(max(0, int(c * 0.82)) for c in fam["color"]),
        "accent": tuple(tiers[a["tier"]]["accent"]),
    }
    sp = a.get("special")
    if sp == "gasmask":
        pal.update({"main": (40, 42, 44), "main_dark": (26, 26, 28), "furniture": (60, 62, 64)})
    elif sp == "ghillie":
        pal.update({"main": (86, 104, 56), "main_dark": (62, 76, 40), "furniture": (104, 96, 60), "accent": (70, 90, 46)})
    return pal


class ArmorMixin:
    def armor(self):
        A = self.d["ARMOR"]
        fams = self.d["ARMOR_FAMILIES"]
        tiers = self.d["TIERS"]
        geos = []
        for aid, a in A.items():
            m = modelgen2.armor_model(aid, a)
            img, tiles = tx.atlas_tiles(armor_palette(a, fams, tiers), "armor:" + aid)
            wpng(f"{self.rp}/textures/entity/arsenal/armor/{aid}.png", img)
            cubes = [c for b in m.bones if b["name"].startswith("arsenal") for c in b["cubes"]]
            wpng(f"{self.rp}/textures/items/arsenal/armor/{aid}.png", render_iso_icon(cubes, tiles, 32))
            self.item_textures[f"arsenal_{aid}"] = f"textures/items/arsenal/armor/{aid}"
            geo = m.geometry(f"geometry.arsenal.armor.{aid}", vb=(2, 3, 1.5))
            geos.extend(geo["minecraft:geometry"])
            head = a["slot"] == "head"
            wjson(f"{self.rp}/attachables/arsenal/armor/{aid}.json", {
                "format_version": "1.10.0",
                "minecraft:attachable": {"description": {
                    "identifier": f"{NS}:{aid}",
                    "materials": {"default": "armor", "enchanted": "armor_enchanted"},
                    "textures": {"default": f"textures/entity/arsenal/armor/{aid}", "enchanted": "textures/misc/enchanted_item_glint"},
                    "geometry": {"default": f"geometry.arsenal.armor.{aid}"},
                    "scripts": {"parent_setup": "variable.helmet_layer_visible = 0.0;" if head else "variable.chest_layer_visible = 0.0;"},
                    "render_controllers": ["controller.render.armor"],
                }},
            })
            slot = "slot.armor.head" if head else "slot.armor.chest"
            extra = {
                "minecraft:wearable": {"slot": slot, "protection": int(a["protection"])},
                "minecraft:durability": {"max_durability": a["durability"]},
                "minecraft:enchantable": {"slot": "armor_head" if head else "armor_torso", "value": 10},
                "minecraft:repairable": {"repair_items": [{"items": [f"{NS}:steel_ingot"], "repair_amount": "context.other->q.remaining_durability + 0.25 * context.other->q.max_durability"}]},
            }
            item = item_json(f"{NS}:{aid}", f"arsenal_{aid}", f"item.arsenal.{aid}.name", "equipment", 1, extra=extra,
                             tags=[f"{NS}:armor", f"{NS}:armor_{a['family']}", "minecraft:is_armor"], rarity=tiers[a["tier"]]["rarity"])
            wjson(f"{self.bp}/items/armor/{aid}.json", item)
            self.Lname(f"item.arsenal.{aid}.name", a["name"])
            desc_ja = []
            desc_en = []
            if head:
                desc_ja.append(f"ヘッドショット -{int(a['headProt'] * 100)}%")
                desc_en.append(f"Headshot damage -{int(a['headProt'] * 100)}%")
            if a.get("plates"):
                desc_ja.append(f"プレート {a['plates']} 枚")
                desc_en.append(f"{a['plates']} plate slot(s)")
            if a.get("move", 1.0) < 1.0:
                desc_ja.append(f"移動 {int(round((a['move'] - 1) * 100))}%")
                desc_en.append(f"Move {int(round((a['move'] - 1) * 100))}%")
            sp = a.get("special")
            if sp == "nvg":
                desc_ja.append("暗所で暗視（個人設定・野戦マニュアルで ON/OFF）")
                desc_en.append("Night vision in the dark (toggle in the Field Manual)")
            elif sp == "gasmask":
                desc_ja.append("ガスを無効化")
                desc_en.append("Immune to gas")
            elif sp == "ghillie":
                desc_ja.append("スニークで静止すると敵に見つかりにくい")
                desc_en.append("Hard to spot while sneaking still")
            self.L(f"arsenal.desc.{aid}", " / ".join(desc_en), " / ".join(desc_ja))
        wjson(f"{self.rp}/models/entity/arsenal/armor.geo.json", {"format_version": "1.16.0", "minecraft:geometry": geos})
        for fid, f in fams.items():
            self.Lname(f"arsenal.armorfam.{fid}", f["name"])
        self.log(f"  armor: {len(A)}")
