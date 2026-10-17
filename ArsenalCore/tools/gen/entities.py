"""ARSENAL CORE 生成：エンティティ"""
import copy  # noqa: F401
import json  # noqa: F401
import os  # noqa: F401
import sys  # noqa: F401

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import modelgen  # noqa: E402,F401
import riggen  # noqa: E402,F401
from texgen import textures as tx  # noqa: E402,F401
from gen.common import NS, ITEM_FMT, BLOCK_FMT, ENTITY_FMT, wjson, wpng, item_json, is_scoped  # noqa: E402,F401


class EntitiesMixin:
    def entities(self):
        # 弾体（スクリプト駆動の見た目用エンティティ）
        kinds = modelgen.PROJECTILE_KINDS
        proj = {
            "format_version": ENTITY_FMT,
            "minecraft:entity": {
                "description": {
                    "identifier": f"{NS}:projectile", "is_spawnable": False, "is_summonable": True, "is_experimental": False,
                    "properties": {f"{NS}:kind": {"type": "int", "range": [0, len(kinds) - 1], "default": 0, "client_sync": True}},
                },
                "components": {
                    "minecraft:type_family": {"family": ["arsenal_fx", "inanimate"]},
                    "minecraft:collision_box": {"width": 0.25, "height": 0.25},
                    "minecraft:physics": {"has_gravity": False, "has_collision": False},
                    "minecraft:damage_sensor": {"triggers": [{"cause": "all", "deals_damage": "no"}]},
                    "minecraft:health": {"value": 1, "max": 1},
                    "minecraft:knockback_resistance": {"value": 1.0},
                    "minecraft:fire_immune": {},
                    "minecraft:conditional_bandwidth_optimization": {"default_values": {"max_optimized_distance": 80.0, "max_dropped_ticks": 2, "use_motion_prediction_hints": True}},
                },
            },
        }
        wjson(f"{self.bp}/entities/projectile.json", proj)
        wjson(f"{self.rp}/models/entity/arsenal/projectiles.geo.json", modelgen.projectile_geometry())
        wpng(f"{self.rp}/textures/entity/arsenal/projectiles.png", tx.projectile_texture())
        geos = {k: f"geometry.arsenal.proj_{k}" for k in kinds}
        client = {
            "format_version": "1.10.0",
            "minecraft:client_entity": {
                "description": {
                    "identifier": f"{NS}:projectile",
                    "materials": {"default": "entity_alphatest"},
                    "textures": {"default": "textures/entity/arsenal/projectiles"},
                    "geometry": geos,
                    "animations": {"orient": "animation.arsenal.proj.orient", "spin": "animation.arsenal.proj.spin"},
                    "scripts": {"animate": [
                        {"orient": " || ".join(f"q.property('arsenal:kind') == {kinds.index(k)}" for k in modelgen.PROJECTILE_ORIENT)},
                        {"spin": " || ".join(f"q.property('arsenal:kind') == {kinds.index(k)}" for k in modelgen.PROJECTILE_SPIN)},
                    ]},
                    "render_controllers": ["controller.render.arsenal.projectile"],
                }
            },
        }
        wjson(f"{self.rp}/entity/arsenal/projectile.entity.json", client)
        rc = {
            "format_version": "1.10.0",
            "render_controllers": {
                "controller.render.arsenal.projectile": {
                    "arrays": {"geometries": {"Array.geos": [f"Geometry.{k}" for k in kinds]}},
                    "geometry": "Array.geos[q.property('arsenal:kind')]",
                    "materials": [{"*": "Material.default"}],
                    "textures": ["Texture.default"],
                },
                "controller.render.arsenal.simple": {
                    "geometry": "Geometry.default", "materials": [{"*": "Material.default"}], "textures": ["Texture.default"],
                },
            },
        }
        wjson(f"{self.rp}/render_controllers/arsenal.render_controllers.json", rc)

        # 訓練用ターゲット
        dummy = {
            "format_version": ENTITY_FMT,
            "minecraft:entity": {
                "description": {"identifier": f"{NS}:target_dummy", "is_spawnable": True, "is_summonable": True, "is_experimental": False},
                "components": {
                    "minecraft:type_family": {"family": ["arsenal_target", "inanimate"]},
                    "minecraft:collision_box": {"width": 0.8, "height": 1.95},
                    "minecraft:health": {"value": 1000, "max": 1000},
                    "minecraft:physics": {},
                    "minecraft:knockback_resistance": {"value": 1.0},
                    "minecraft:damage_sensor": {"triggers": [{"cause": "all", "deals_damage": "no"}]},
                    "minecraft:fire_immune": {},
                    "minecraft:nameable": {"always_show": True, "allow_name_tag_renaming": False},
                    "minecraft:persistent": {},
                    "minecraft:loot": {"table": "loot_tables/entities/arsenal_target_dummy.json"},
                },
            },
        }
        wjson(f"{self.bp}/entities/target_dummy.json", dummy)
        wjson(f"{self.bp}/loot_tables/entities/arsenal_target_dummy.json", {"pools": [{"rolls": 1, "entries": [{"type": "item", "name": f"{NS}:target_kit", "weight": 1}]}]})
        wjson(f"{self.rp}/models/entity/arsenal/target_dummy.geo.json", modelgen.dummy_geometry())
        wpng(f"{self.rp}/textures/entity/arsenal/target_dummy.png", tx.dummy_texture())
        wjson(f"{self.rp}/entity/arsenal/target_dummy.entity.json", {
            "format_version": "1.10.0",
            "minecraft:client_entity": {"description": {
                "identifier": f"{NS}:target_dummy",
                "materials": {"default": "entity_alphatest"},
                "textures": {"default": "textures/entity/arsenal/target_dummy"},
                "geometry": {"default": "geometry.arsenal.target_dummy"},
                "render_controllers": ["controller.render.arsenal.simple"],
                "spawn_egg": {"base_color": "#e6e2d4", "overlay_color": "#c02828"},
            }},
        })
        self.L(f"entity.{NS}:target_dummy.name", "Training Target", "射撃練習ターゲット")
        self.L(f"item.spawn_egg.entity.{NS}:target_dummy.name", "Spawn Training Target", "射撃練習ターゲットを出現させる")

        # レイダー（1.0 系の人型）のジオメトリ。敵そのものは entities2 が作る
        wjson(f"{self.rp}/models/entity/arsenal/raider.geo.json", modelgen.raider_geometry())
        # 1.0.2 の敵弾（保存済みのワールドに飛んでいる途中の弾があっても壊れないよう、定義だけ残す。ダメージなし）
        for rid in self.d["RAIDERS"]:
            self.legacy_bullet(rid)

        # 弾体・その他アニメーション
        wjson(f"{self.rp}/animations/arsenal_entities.animation.json", {"format_version": "1.10.0", "animations": {
            **riggen.raider_animations(),
            "animation.arsenal.proj.orient": {"loop": True, "bones": {"body": {"rotation": ["q.body_x_rotation", 0, 0]}}},
            "animation.arsenal.proj.spin": {"loop": True, "bones": {"body": {"rotation": ["q.life_time * 720.0", "q.life_time * 240.0", 0]}}},
            "animation.arsenal.bullet.scale": {"loop": True, "bones": {"body": {"scale": 0.6}}},
        }})
        self.log("  entities: projectile, target_dummy, legacy bullets")

    def legacy_bullet(self, rid):
        bullet_id = f"{NS}:{rid}_bullet"
        bullet = {"format_version": ENTITY_FMT, "minecraft:entity": {
            "description": {"identifier": bullet_id, "is_spawnable": False, "is_summonable": True, "is_experimental": False},
            "components": {
                "minecraft:type_family": {"family": ["projectile", "arsenal_bullet"]},
                "minecraft:collision_box": {"width": 0.15, "height": 0.15},
                "minecraft:physics": {},
                "minecraft:projectile": {
                    "on_hit": {"remove_on_hit": {}},
                    "power": 4.0, "gravity": 0.0, "inertia": 1.0, "uncertainty_base": 0.0, "uncertainty_multiplier": 0.0,
                    "anchor": "eye_height", "offset": [0, -0.2, 0],
                },
            },
        }}
        wjson(f"{self.bp}/entities/legacy/{rid}_bullet.json", bullet)
        wjson(f"{self.rp}/entity/arsenal/legacy/{rid}_bullet.entity.json", {"format_version": "1.10.0", "minecraft:client_entity": {"description": {
            "identifier": bullet_id,
            "materials": {"default": "entity_alphatest"},
            "textures": {"default": "textures/entity/arsenal/projectiles"},
            "geometry": {"default": "geometry.arsenal.proj_flare"},
            "animations": {"scale": "animation.arsenal.bullet.scale"},
            "scripts": {"animate": ["scale"]},
            "render_controllers": ["controller.render.arsenal.simple"],
        }}})

    # -------------------- 構造物ルート --------------------
