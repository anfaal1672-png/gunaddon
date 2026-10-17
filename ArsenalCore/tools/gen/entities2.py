"""ARSENAL CORE 生成：2.0 のエンティティ（3 勢力の敵・ボス・設置物・銃座・乗り物・補給箱・補給係・AI の道しるべ・保管庫）"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import modelgen  # noqa: E402
import modelgen2  # noqa: E402
from texgen import textures as tx  # noqa: E402
from gen.common import NS, ENTITY_FMT, wjson, wpng  # noqa: E402
from gen.gear import GEAR_PALETTES  # noqa: E402

# 見た目ごとの当たり判定
HITBOX = {
    "raider": (0.6, 1.9), "robot": (0.7, 1.95), "shield_bot": (0.9, 1.95), "mortar_bot": (1.1, 1.3), "drone": (0.8, 0.5),
    "dog": (0.6, 0.85), "hollow": (0.6, 1.95), "bloater": (0.9, 1.9), "brute": (1.2, 2.3), "juggernaut": (1.6, 3.2),
}
ROBOTS = {"robot", "shield_bot", "mortar_bot", "drone", "juggernaut"}
ARMED_ROLES = {"rifle", "sniper", "heavy", "leader", "medic", "demo", "shield", "drone", "mortar"}

# 勢力ごとの素材アトラスの色
FACTION_PAL = {
    "legion": {"main": (150, 158, 170), "main_dark": (70, 76, 88), "furniture": (110, 118, 132), "accent": (255, 110, 60), "glow": (255, 120, 60)},
    "hollow": {"main": (118, 140, 96), "main_dark": (72, 84, 58), "furniture": (96, 110, 76), "accent": (180, 210, 90), "glow": (170, 255, 90)},
    "raiders": {"main": (120, 96, 70), "main_dark": (60, 50, 40), "furniture": (92, 80, 60), "accent": (200, 60, 40)},
}


def _targets(extra_families=()):
    fams = ["player", "irongolem", "villager", "arsenal_player_deployable", *extra_families]
    return [{"filters": {"any_of": [{"test": "is_family", "subject": "other", "value": f} for f in fams]}, "max_dist": 64}]


class Entities2Mixin:
    # ------------------------------------------------------------------
    #  敵（共通）
    # ------------------------------------------------------------------
    def enemy_entity(self, eid, e, boss=False):
        fac = e["faction"] if "faction" in e else "raiders"
        fam_id = self.d["FACTIONS"][fac]["family"]
        model = e.get("model", "raider")
        role = e["role"]
        armed = role in ARMED_ROLES and e.get("weapon") is not None
        w, h = HITBOX.get(model, (0.6, 1.9))
        scale = e.get("scale", 1.0)
        families = ["arsenal_enemy", fam_id, "monster", "mob"]
        if model in ROBOTS:
            families.append("arsenal_robot")
        if e.get("flying"):
            families.append("arsenal_flying")
        if boss:
            families.append("arsenal_boss")
        comps = {
            "minecraft:type_family": {"family": families},
            "minecraft:collision_box": {"width": w, "height": h},
            "minecraft:health": {"value": e["health"], "max": e["health"]},
            "minecraft:movement": {"value": e["speed"]},
            "minecraft:physics": {} if not e.get("flying") else {"has_gravity": False},
            "minecraft:pushable_by_entity": {},
            "minecraft:pushable_by_block": {},
            "minecraft:breathable": {"total_supply": 15, "suffocate_time": 0, "breathes_water": model in ROBOTS},
            "minecraft:nameable": {},
            "minecraft:follow_range": {"value": max(32, int(e.get("sight", e["range"])) + 16)},
            "minecraft:is_hidden_when_invisible": {},
            "minecraft:conditional_bandwidth_optimization": {},
            "minecraft:hurt_on_condition": {"damage_conditions": [{"cause": "lava", "damage_per_tick": 4, "filters": {"test": "in_lava", "subject": "self", "operator": "==", "value": True}}]},
            "minecraft:experience_reward": {"on_death": "q.last_hit_by_player ? %d + math.die_roll(1, 1, 4) : 0" % (4 + 4 * e.get("tier", 1) if not boss else 120)},
            "minecraft:loot": {"table": f"loot_tables/entities/arsenal_{eid}.json"},
            "minecraft:behavior.float": {"priority": 0},
            "minecraft:behavior.look_at_player": {"priority": 8, "look_distance": 8},
            "minecraft:behavior.random_look_around": {"priority": 9},
        }
        if e.get("flying"):
            comps["minecraft:movement.hover"] = {}
            comps["minecraft:navigation.hover"] = {"can_path_over_water": True, "can_sink": False, "can_pass_doors": False, "avoid_damage_blocks": True}
            comps["minecraft:can_fly"] = {}
            comps["minecraft:behavior.random_hover"] = {"priority": 7, "xz_dist": 8, "y_dist": 4, "y_offset": -1, "interval": 1, "hover_height": {"min": 3, "max": 6}}
        else:
            comps["minecraft:movement.basic"] = {}
            comps["minecraft:jump.static"] = {}
            comps["minecraft:navigation.walk"] = {"can_path_over_water": True, "avoid_damage_blocks": True, "can_open_doors": False}
        if model in ("brute", "juggernaut", "shield_bot", "mortar_bot") or boss:
            comps["minecraft:knockback_resistance"] = {"value": 0.8 if not boss else 1.0}
        if scale != 1.0:
            comps["minecraft:scale"] = {"value": scale}
        if boss:
            comps["minecraft:boss"] = {"should_darken_sky": False, "hud_range": 48, "name": e["name"]["en"]}
            comps["minecraft:fire_immune"] = {}
        if armed:
            comps["minecraft:shooter"] = {"def": f"{NS}:ai_shot"}
            comps["minecraft:equipment"] = {"table": f"loot_tables/entities/arsenal_{eid}_gear.json",
                                            "slot_drop_chance": [{"slot": "slot.weapon.mainhand", "drop_chance": 0.035 if e.get("tier", 1) < 3 else 0.25}]}
        else:
            comps["minecraft:attack"] = {"damage": e["damage"]}
        groups = {
            "arsenal:targeting": {
                "minecraft:behavior.hurt_by_target": {"priority": 1, "entity_types": {"filters": {"test": "is_family", "subject": "other", "operator": "!=", "value": "arsenal_enemy"}, "max_dist": 48}},
                "minecraft:behavior.nearest_attackable_target": {"priority": 2, "must_see": True, "reselect_targets": True, "within_radius": float(e.get("sight", e["range"] + 8)), "entity_types": _targets()},
            },
            "arsenal:despawn": {"minecraft:despawn": {"despawn_from_distance": {}}},
            "arsenal:persist": {"minecraft:persistent": {}},
        }
        if armed:
            rng = {"attack_interval_min": e["interval"][0], "attack_interval_max": e["interval"][1], "attack_radius": float(e["range"]),
                   "burst_shots": e["burst"], "burst_interval": max(0.05, e["burstInterval"]) if e["burst"] > 1 else 0.05,
                   "charge_charged_trigger": 0.0, "charge_shoot_trigger": 0.0}
            if e.get("minRange"):
                rng["attack_radius_min"] = float(e["minRange"])
            groups["arsenal:engage"] = {
                "minecraft:behavior.ranged_attack": {"priority": 3, "speed_multiplier": 1.0, **rng},
                "minecraft:behavior.random_stroll": {"priority": 6, "speed_multiplier": 0.8},
            }
            groups["arsenal:hold"] = {
                "minecraft:behavior.ranged_attack": {"priority": 3, "speed_multiplier": 0.0, **rng},
            }
            groups["arsenal:move"] = {
                "minecraft:behavior.nearest_attackable_target": {"priority": 0, "must_see": False, "reselect_targets": True, "within_radius": 24.0,
                                                                 "entity_types": [{"filters": {"test": "is_family", "subject": "other", "value": "arsenal_waypoint"}, "max_dist": 24}]},
                "minecraft:behavior.melee_attack": {"priority": 1, "speed_multiplier": 1.3, "track_target": True, "require_complete_path": False},
                "minecraft:attack": {"damage": 0},
            }
        else:
            speed = 1.35 if model in ("hollow", "dog") else 1.15
            groups["arsenal:engage"] = {
                "minecraft:behavior.melee_attack": {"priority": 3, "speed_multiplier": speed, "track_target": True, "require_complete_path": False, "cooldown_time": e["interval"][0]},
                "minecraft:behavior.random_stroll": {"priority": 6, "speed_multiplier": 0.9},
            }
            if model == "dog":
                groups["arsenal:engage"]["minecraft:behavior.leap_at_target"] = {"priority": 2, "yd": 0.4, "must_be_on_ground": True}
            groups["arsenal:hold"] = dict(groups["arsenal:engage"])
            groups["arsenal:move"] = dict(groups["arsenal:engage"])
        start = ["arsenal:targeting", "arsenal:engage", "arsenal:persist" if boss else "arsenal:despawn"]
        events = {
            "minecraft:entity_spawned": {"add": {"component_groups": start}},
            f"{NS}:init": {"add": {"component_groups": start}},
            f"{NS}:ai_engage": {"remove": {"component_groups": ["arsenal:hold", "arsenal:move"]}, "add": {"component_groups": ["arsenal:engage", "arsenal:targeting"]}},
            f"{NS}:ai_hold": {"remove": {"component_groups": ["arsenal:engage", "arsenal:move"]}, "add": {"component_groups": ["arsenal:hold", "arsenal:targeting"]}},
            f"{NS}:ai_move": {"remove": {"component_groups": ["arsenal:engage", "arsenal:hold", "arsenal:targeting"]}, "add": {"component_groups": ["arsenal:move"]}},
            f"{NS}:persist": {"remove": {"component_groups": ["arsenal:despawn"]}, "add": {"component_groups": ["arsenal:persist"]}},
        }
        props = {}
        if model == "bloater":
            props[f"{NS}:fuse"] = {"type": "bool", "default": False, "client_sync": True}
        if model == "juggernaut":
            for p in ("pod_l", "pod_r", "core"):
                props[f"{NS}:{p}"] = {"type": "bool", "default": True, "client_sync": True}
        desc = {"identifier": f"{NS}:{eid}", "is_spawnable": True, "is_summonable": True, "is_experimental": False, "spawn_category": "monster"}
        if props:
            desc["properties"] = props
        ent = {"format_version": ENTITY_FMT, "minecraft:entity": {"description": desc, "components": comps, "component_groups": groups, "events": events}}
        wjson(f"{self.bp}/entities/enemies/{eid}.json", ent)
        self._enemy_client(eid, e, model, fac, boss)
        self._enemy_loot(eid, e, armed, boss)
        if e.get("spawn") and not boss:
            self._enemy_spawn_rule(eid, e)
        self.Lname(f"entity.{NS}:{eid}.name", e["name"])
        self.L(f"item.spawn_egg.entity.{NS}:{eid}.name", f"Spawn {e['name']['en']}", f"{e['name']['ja']}を出現させる")

    def _enemy_client(self, eid, e, model, fac, boss):
        color = e.get("color", [120, 120, 120])
        tex_path = f"textures/entity/arsenal/enemies/{eid}"
        anims = {}
        scripts = []
        rc = "controller.render.arsenal.simple"
        attachables = False
        if model == "raider":
            wpng(f"{self.rp}/{tex_path}.png", tx.raider_skin(e.get("skin", e.get("armor", "cloth")), color))
            geo = "geometry.arsenal.raider"
            anims = {"look": "animation.arsenal.raider.look", "walk": "animation.arsenal.raider.walk", "aim": "animation.arsenal.raider.aim", "idle": "animation.arsenal.raider.idle"}
            scripts = ["look", "walk", {"aim": "q.has_target"}, {"idle": "!q.has_target"}]
            attachables = True
        else:
            m, vb = modelgen2.entity_model(model, eid)
            pal = dict(FACTION_PAL[fac])
            if model == "juggernaut":
                pal.update({"main": (96, 104, 118), "main_dark": (48, 52, 60)})
            img, _ = tx.atlas_tiles(pal, "enemy:" + eid)
            wpng(f"{self.rp}/{tex_path}.png", img)
            geo = f"geometry.arsenal.{eid}"
            wjson(f"{self.rp}/models/entity/arsenal/enemies/{eid}.geo.json", m.geometry(geo, vb))
            if model in ("robot", "shield_bot", "juggernaut"):
                anims = {"look": "animation.arsenal.raider.look", "walk": "animation.arsenal.raider.walk", "aim": "animation.arsenal.raider.aim", "idle": "animation.arsenal.raider.idle"}
                scripts = ["look", "walk", {"aim": "q.has_target"}, {"idle": "!q.has_target"}]
                attachables = model != "juggernaut"
                if model == "shield_bot":
                    anims["aim"] = "animation.arsenal.robot.shield_aim"
                if model == "juggernaut":
                    rc = "controller.render.arsenal.juggernaut"
            elif model in ("hollow", "bloater", "brute"):
                anims = {"look": "animation.arsenal.raider.look", "walk": "animation.arsenal.raider.walk", "reach": "animation.arsenal.hollow.reach"}
                scripts = ["look", "walk", "reach"]
                if model == "bloater":
                    anims["swell"] = "animation.arsenal.hollow.swell"
                    scripts.append({"swell": f"q.property('{NS}:fuse')"})
            elif model == "dog":
                anims = {"walk": "animation.arsenal.dog.walk", "look": "animation.arsenal.dog.look"}
                scripts = ["walk", "look"]
            elif model == "drone":
                anims = {"spin": "animation.arsenal.drone.spin", "tilt": "animation.arsenal.drone.tilt"}
                scripts = ["spin", "tilt"]
            elif model == "mortar_bot":
                anims = {"walk": "animation.arsenal.walker.walk", "look": "animation.arsenal.walker.look"}
                scripts = ["walk", "look"]
        desc = {
            "identifier": f"{NS}:{eid}",
            "materials": {"default": "entity_alphatest"},
            "textures": {"default": tex_path},
            "geometry": {"default": geo},
            "render_controllers": [rc],
            "spawn_egg": {"base_color": "#%02x%02x%02x" % tuple(color), "overlay_color": "#1e1e22" if fac != "legion" else "#ff7040"},
        }
        if anims:
            desc["animations"] = anims
            desc["scripts"] = {"animate": scripts}
        if attachables:
            desc["enable_attachables"] = True
        wjson(f"{self.rp}/entity/arsenal/enemies/{eid}.entity.json", {"format_version": "1.10.0", "minecraft:client_entity": {"description": desc}})

    def _enemy_loot(self, eid, e, armed, boss):
        W = self.d["WEAPONS"]
        if armed:
            wjson(f"{self.bp}/loot_tables/entities/arsenal_{eid}_gear.json", {"pools": [{"rolls": 1, "entries": [{"type": "item", "name": f"{NS}:{e['weapon']}", "weight": 1}]}]})
        pools = []
        if armed:
            fam = W[e["weapon"]]["ammo"]
            ammo_item = {"light": "ammo_light", "medium": "ammo_medium", "heavy": "ammo_heavy", "magnum": "ammo_magnum", "precision": "ammo_precision",
                         "shell": "shell_buck", "cell": "energy_cell", "gl40": "ammo_40mm", "mortar": "mortar_shell"}.get(fam, "ammo_light")
            cnt = (4, 14) if fam not in ("gl40", "mortar", "cell") else (1, 3)
            pools.append({"rolls": 1, "entries": [{"type": "item", "name": f"{NS}:{ammo_item}", "weight": 1, "functions": [{"function": "set_count", "count": {"min": cnt[0], "max": cnt[1]}}, {"function": "looting_enchant", "count": {"min": 0, "max": 2}}]}]})
        fac = e.get("faction", "raiders")
        mats = [
            {"type": "item", "name": f"{NS}:steel_ingot", "weight": 6, "functions": [{"function": "set_count", "count": {"min": 1, "max": 2}}]},
            {"type": "item", "name": f"{NS}:precision_parts", "weight": 3 if fac != "legion" else 6},
            {"type": "item", "name": f"{NS}:polymer", "weight": 3},
            {"type": "item", "name": f"{NS}:bandage", "weight": 2},
            {"type": "empty", "weight": 10},
        ]
        if fac == "legion":
            mats.append({"type": "item", "name": f"{NS}:energy_cell", "weight": 4, "functions": [{"function": "set_count", "count": {"min": 1, "max": 3}}]})
            mats.append({"type": "item", "name": f"{NS}:energy_core", "weight": 1})
        if fac == "hollow":
            mats.append({"type": "item", "name": "minecraft:rotten_flesh", "weight": 6, "functions": [{"function": "set_count", "count": {"min": 1, "max": 2}}]})
            mats.append({"type": "item", "name": f"{NS}:armor_plate", "weight": 1})
        if not armed and eid == "raider_dog":
            mats.append({"type": "item", "name": "minecraft:bone", "weight": 5})
        pools.append({"rolls": 1, "entries": mats})
        if e.get("tier", 1) >= 3 or boss:
            pools.append({"rolls": 1, "entries": [
                {"type": "item", "name": f"{NS}:optic_4x", "weight": 3},
                {"type": "item", "name": f"{NS}:mag_quick", "weight": 3},
                {"type": "item", "name": f"{NS}:muzzle_suppressor", "weight": 3},
                {"type": "item", "name": f"{NS}:armor_plate", "weight": 3, "functions": [{"function": "set_count", "count": {"min": 1, "max": 2}}]},
                {"type": "item", "name": f"{NS}:energy_core", "weight": 2},
            ]})
        wjson(f"{self.bp}/loot_tables/entities/arsenal_{eid}.json", {"pools": pools})

    def _enemy_spawn_rule(self, eid, e):
        sp = e["spawn"]
        cond = {
            "minecraft:difficulty_filter": {"min": "easy", "max": "hard"},
            "minecraft:weight": {"default": sp["weight"]},
            "minecraft:herd": {"min_size": sp["herd"][0], "max_size": sp["herd"][1]},
        }
        if sp.get("underground"):
            cond["minecraft:spawns_underground"] = {}
            cond["minecraft:brightness_filter"] = {"min": 0, "max": 7, "adjust_for_weather": False}
            cond["minecraft:density_limit"] = {"underground": 4}
            cond["minecraft:height_filter"] = {"min": -48, "max": 50}
        else:
            cond["minecraft:spawns_on_surface"] = {}
            if sp.get("dark"):
                cond["minecraft:brightness_filter"] = {"min": 0, "max": 7, "adjust_for_weather": True}
            cond["minecraft:density_limit"] = {"surface": 2}
        if sp.get("biomes"):
            cond["minecraft:biome_filter"] = {"any_of": [{"test": "has_biome_tag", "operator": "==", "value": b} for b in sp["biomes"]]}
        else:
            cond["minecraft:biome_filter"] = {"test": "has_biome_tag", "operator": "==", "value": "overworld"}
        wjson(f"{self.bp}/spawn_rules/{eid}.json", {"format_version": "1.8.0", "minecraft:spawn_rules": {
            "description": {"identifier": f"{NS}:{eid}", "population_control": "monster"},
            "conditions": [cond],
        }})

    # ------------------------------------------------------------------
    #  すべての 2.0 エンティティ
    # ------------------------------------------------------------------
    def entities2(self):
        for eid, e in self.d["ENEMIES"].items():
            self.enemy_entity(eid, e)
        for bid, b in self.d["BOSSES"].items():
            self.enemy_entity(bid, b, boss=True)
        self._ai_shot()
        self._waypoint()
        self._deployables()
        self._vehicles()
        self._supply_crate()
        self._quartermaster()
        self._storage()
        wjson(f"{self.rp}/animations/arsenal_entities2.animation.json", {"format_version": "1.10.0", "animations": self._anims2()})
        wjson(f"{self.rp}/render_controllers/arsenal2.render_controllers.json", {"format_version": "1.10.0", "render_controllers": {
            "controller.render.arsenal.juggernaut": {
                "geometry": "Geometry.default", "materials": [{"*": "Material.default"}], "textures": ["Texture.default"],
                "part_visibility": [{"*": True}, {"left_pod": f"q.property('{NS}:pod_l')"}, {"right_pod": f"q.property('{NS}:pod_r')"}, {"core": f"q.property('{NS}:core')"}],
            },
            "controller.render.arsenal.crate": {
                "geometry": "Geometry.default", "materials": [{"*": "Material.default"}], "textures": ["Texture.default"],
                "part_visibility": [{"*": True}, {"chute": f"!q.property('{NS}:landed')"}],
            },
        }})
        n = len(self.d["ENEMIES"]) + len(self.d["BOSSES"])
        self.log(f"  entities 2.0: enemies {len(self.d['ENEMIES'])} + bosses {len(self.d['BOSSES'])}, deployables, vehicles, crate, npc ({n} enemy defs)")

    def _simple_client(self, ident, geo_id, tex_path, anims=None, scripts=None, rc="controller.render.arsenal.simple", egg=None, material="entity_alphatest"):
        desc = {
            "identifier": ident,
            "materials": {"default": material},
            "textures": {"default": tex_path},
            "geometry": {"default": geo_id},
            "render_controllers": [rc],
        }
        if anims:
            desc["animations"] = anims
            desc["scripts"] = {"animate": scripts or list(anims)}
        if egg:
            desc["spawn_egg"] = {"base_color": egg[0], "overlay_color": egg[1]}
        wjson(f"{self.rp}/entity/arsenal/{ident.split(':')[1]}.entity.json", {"format_version": "1.10.0", "minecraft:client_entity": {"description": desc}})

    def _model_and_texture(self, kind, key, pal):
        m, vb = modelgen2.entity_model(kind, key)
        geo = f"geometry.arsenal.{key}"
        wjson(f"{self.rp}/models/entity/arsenal/gear/{key}.geo.json", m.geometry(geo, vb))
        img, _ = tx.atlas_tiles(pal, "gear:" + kind)
        path = f"textures/entity/arsenal/gear/{key}"
        wpng(f"{self.rp}/{path}.png", img)
        return geo, path

    def _ai_shot(self):
        """敵の射撃の合図（エンジンの射撃 AI が撃つと、スクリプトが即座に消して弾道計算で撃ち直す）"""
        ent = {"format_version": ENTITY_FMT, "minecraft:entity": {
            "description": {"identifier": f"{NS}:ai_shot", "is_spawnable": False, "is_summonable": True, "is_experimental": False},
            "components": {
                "minecraft:type_family": {"family": ["projectile", "arsenal_fx"]},
                "minecraft:collision_box": {"width": 0.1, "height": 0.1},
                "minecraft:physics": {},
                "minecraft:projectile": {
                    "on_hit": {"remove_on_hit": {}},
                    "power": 3.0, "gravity": 0.0, "inertia": 1.0, "uncertainty_base": 0.0, "uncertainty_multiplier": 0.0,
                    "anchor": "eye_height", "offset": [0, -0.2, 0],
                },
            },
        }}
        wjson(f"{self.bp}/entities/ai_shot.json", ent)
        self._simple_client(f"{NS}:ai_shot", "geometry.arsenal.proj_flare", "textures/entity/arsenal/projectiles",
                            anims={"scale": "animation.arsenal.bullet.scale"})

    def _waypoint(self):
        """AI の移動先の道しるべ（見えない。15 秒で自然に消える）"""
        ent = {"format_version": ENTITY_FMT, "minecraft:entity": {
            "description": {"identifier": f"{NS}:waypoint", "is_spawnable": False, "is_summonable": True, "is_experimental": False},
            "components": {
                "minecraft:type_family": {"family": ["arsenal_waypoint", "inanimate", "arsenal_fx"]},
                "minecraft:collision_box": {"width": 0.3, "height": 0.3},
                "minecraft:physics": {"has_gravity": False, "has_collision": False},
                "minecraft:health": {"value": 1, "max": 1},
                "minecraft:damage_sensor": {"triggers": [{"cause": "all", "deals_damage": "no"}]},
                "minecraft:knockback_resistance": {"value": 1.0},
                "minecraft:fire_immune": {},
                "minecraft:timer": {"looping": False, "time": 15, "time_down_event": {"event": f"{NS}:expire"}},
            },
            "component_groups": {"arsenal:gone": {"minecraft:instant_despawn": {}}},
            "events": {f"{NS}:expire": {"add": {"component_groups": ["arsenal:gone"]}}},
        }}
        wjson(f"{self.bp}/entities/waypoint.json", ent)
        m = modelgen2.empty_model("waypoint")
        wjson(f"{self.rp}/models/entity/arsenal/waypoint.geo.json", m.geometry("geometry.arsenal.empty", (1, 1, 0.5)))
        self._simple_client(f"{NS}:waypoint", "geometry.arsenal.empty", "textures/entity/arsenal/projectiles")

    def _deployables(self):
        for did, dd in self.d["DEPLOYABLES"].items():
            kind = dd.get("entity")
            if not kind:
                continue
            geo, tex = self._model_and_texture(kind, kind, GEAR_PALETTES.get(kind, {}))
            box = {"sentry": (0.9, 1.0), "shield_wall": (1.6, 1.4), "claymore": (0.5, 0.4), "ammo_station": (0.9, 0.8), "med_station": (0.9, 0.8),
                   "mortar_emplacement": (0.9, 0.8), "recon_drone": (0.6, 0.35)}[kind]
            families = ["arsenal_deployable", "arsenal_player_deployable", f"arsenal_{kind}"]
            if kind in ("sentry", "recon_drone"):
                families.append("arsenal_robot")
            comps = {
                "minecraft:type_family": {"family": families},
                "minecraft:collision_box": {"width": box[0], "height": box[1]},
                "minecraft:health": {"value": dd["health"], "max": dd["health"]},
                "minecraft:physics": {"has_gravity": kind != "recon_drone"},
                "minecraft:knockback_resistance": {"value": 1.0},
                "minecraft:persistent": {},
                "minecraft:nameable": {"always_show": False, "allow_name_tag_renaming": False},
                "minecraft:fire_immune": {},
                "minecraft:conditional_bandwidth_optimization": {},
            }
            if kind == "shield_wall":
                comps["minecraft:is_collidable"] = {}
            props = {}
            if kind in ("sentry", "mortar_emplacement"):
                props[f"{NS}:pitch"] = {"type": "int", "range": [-60, 80], "default": 0, "client_sync": True}
            desc = {"identifier": f"{NS}:{kind}", "is_spawnable": False, "is_summonable": True, "is_experimental": False}
            if props:
                desc["properties"] = props
            wjson(f"{self.bp}/entities/gear/{kind}.json", {"format_version": ENTITY_FMT, "minecraft:entity": {"description": desc, "components": comps}})
            anims = None
            if kind == "sentry":
                anims = {"aim": "animation.arsenal.sentry.aim"}
            elif kind == "recon_drone":
                anims = {"spin": "animation.arsenal.drone.spin"}
            self._simple_client(f"{NS}:{kind}", geo, tex, anims=anims)
            self.L(f"entity.{NS}:{kind}.name", dd["name"]["en"], dd["name"]["ja"])

    def _vehicles(self):
        for vid, v in self.d["VEHICLES"].items():
            geo, tex = self._model_and_texture(vid, vid, GEAR_PALETTES.get(vid, {}))
            is_car = v["kind"] == "vehicle"
            seats = [{"position": [0.0, 0.55, 0.9], "min_rider_count": 0, "max_rider_count": 1, "lock_rider_rotation": 0}]
            if is_car:
                seats = [
                    {"position": [0.0, 0.75, -0.1], "min_rider_count": 0, "max_rider_count": 2},
                    {"position": [0.0, 1.35, 0.95], "min_rider_count": 1, "max_rider_count": 2, "lock_rider_rotation": 0},
                ]
                if vid == "apc":
                    seats[1]["position"] = [0.0, 1.9, 0.25]
            comps = {
                "minecraft:type_family": {"family": ["arsenal_deployable", "arsenal_player_deployable", "arsenal_vehicle", f"arsenal_{vid}"]},
                "minecraft:collision_box": {"width": 1.6 if not is_car else 2.4, "height": 1.2 if not is_car else 1.8},
                "minecraft:health": {"value": v["health"], "max": v["health"]},
                "minecraft:physics": {},
                "minecraft:knockback_resistance": {"value": 1.0},
                "minecraft:persistent": {},
                "minecraft:fire_immune": {},
                "minecraft:is_collidable": {},
                "minecraft:rideable": {
                    "seat_count": len(seats), "family_types": ["player"], "interact_text": "action.interact.mount",
                    "pull_in_entities": False, "crouching_skip_interact": True, "seats": seats,
                    **({"controlling_seat": 0} if is_car else {}),
                },
                "minecraft:conditional_bandwidth_optimization": {},
            }
            props = {f"{NS}:pitch": {"type": "int", "range": [-60, 80], "default": 0, "client_sync": True}}
            if is_car:
                comps["minecraft:input_ground_controlled"] = {}
                comps["minecraft:movement"] = {"value": v["speed"]}
                comps["minecraft:movement.basic"] = {}
                comps["minecraft:jump.static"] = {}
                comps["minecraft:navigation.walk"] = {"avoid_water": True}
                comps["minecraft:variable_max_auto_step"] = {"base_value": 1.0625, "jump_prevented_value": 1.0625}
            wjson(f"{self.bp}/entities/gear/{vid}.json", {"format_version": ENTITY_FMT, "minecraft:entity": {
                "description": {"identifier": f"{NS}:{vid}", "is_spawnable": False, "is_summonable": True, "is_experimental": False, "properties": props},
                "components": comps,
            }})
            anims = {"aim": f"animation.arsenal.{vid}.aim"}
            scripts = ["aim"]
            if is_car:
                anims["wheels"] = "animation.arsenal.buggy.wheels"
                scripts.append("wheels")
            self._simple_client(f"{NS}:{vid}", geo, tex, anims=anims, scripts=scripts)
            self.L(f"entity.{NS}:{vid}.name", v["name"]["en"], v["name"]["ja"])

    def _supply_crate(self):
        geo, tex = self._model_and_texture("supply_crate", "supply_crate", GEAR_PALETTES["supply_crate"])
        wjson(f"{self.bp}/entities/gear/supply_crate.json", {"format_version": ENTITY_FMT, "minecraft:entity": {
            "description": {"identifier": f"{NS}:supply_crate", "is_spawnable": False, "is_summonable": True, "is_experimental": False,
                            "properties": {f"{NS}:landed": {"type": "bool", "default": False, "client_sync": True}}},
            "components": {
                "minecraft:type_family": {"family": ["arsenal_crate", "inanimate"]},
                "minecraft:collision_box": {"width": 1.0, "height": 1.0},
                "minecraft:health": {"value": 1, "max": 1},
                "minecraft:damage_sensor": {"triggers": [{"cause": "all", "deals_damage": "no"}]},
                "minecraft:physics": {},
                "minecraft:knockback_resistance": {"value": 1.0},
                "minecraft:persistent": {},
                "minecraft:fire_immune": {},
            },
        }})
        self._simple_client(f"{NS}:supply_crate", geo, tex, rc="controller.render.arsenal.crate")
        self.L(f"entity.{NS}:supply_crate.name", "Supply Crate", "補給箱")

    def _quartermaster(self):
        geo, tex = self._model_and_texture("quartermaster", "quartermaster", {"main": (92, 100, 70), "main_dark": (48, 50, 44), "furniture": (150, 116, 70), "white": (190, 146, 110)})
        wjson(f"{self.bp}/entities/quartermaster.json", {"format_version": ENTITY_FMT, "minecraft:entity": {
            "description": {"identifier": f"{NS}:quartermaster", "is_spawnable": True, "is_summonable": True, "is_experimental": False},
            "components": {
                "minecraft:type_family": {"family": ["arsenal_npc", "mob"]},
                "minecraft:collision_box": {"width": 0.6, "height": 1.9},
                "minecraft:health": {"value": 40, "max": 40},
                "minecraft:movement": {"value": 0.22},
                "minecraft:movement.basic": {},
                "minecraft:jump.static": {},
                "minecraft:navigation.walk": {"avoid_water": True, "can_open_doors": True},
                "minecraft:physics": {},
                "minecraft:pushable_by_entity": {},
                "minecraft:pushable_by_block": {},
                "minecraft:breathable": {"total_supply": 15, "suffocate_time": 0},
                "minecraft:nameable": {"always_show": True, "allow_name_tag_renaming": False},
                "minecraft:persistent": {},
                "minecraft:damage_sensor": {"triggers": [{"on_damage": {"filters": {"test": "is_family", "subject": "other", "value": "player"}}, "deals_damage": "no"}]},
                "minecraft:behavior.float": {"priority": 0},
                "minecraft:behavior.avoid_mob_type": {"priority": 1, "entity_types": [{"filters": {"test": "is_family", "subject": "other", "value": "monster"}, "max_dist": 8, "walk_speed_multiplier": 1.0, "sprint_speed_multiplier": 1.3}]},
                "minecraft:behavior.look_at_player": {"priority": 3, "look_distance": 8, "probability": 0.5},
                "minecraft:behavior.random_stroll": {"priority": 6, "speed_multiplier": 0.6, "xz_dist": 4},
                "minecraft:behavior.random_look_around": {"priority": 7},
                "minecraft:interact": {"interactions": [{"interact_text": "action.interact.trade", "on_interact": {"filters": {"test": "is_family", "subject": "other", "value": "player"}}}]},
                "minecraft:conditional_bandwidth_optimization": {},
            },
        }})
        self._simple_client(f"{NS}:quartermaster", geo, tex,
                            anims={"look": "animation.arsenal.raider.look", "walk": "animation.arsenal.raider.walk", "idle": "animation.arsenal.raider.idle"},
                            egg=("#5c6446", "#e6aa1e"))
        self.L(f"entity.{NS}:quartermaster.name", "Quartermaster", "補給係")
        self.L(f"item.spawn_egg.entity.{NS}:quartermaster.name", "Spawn Quartermaster", "補給係を出現させる")
        wjson(f"{self.bp}/spawn_rules/quartermaster.json", {"format_version": "1.8.0", "minecraft:spawn_rules": {
            "description": {"identifier": f"{NS}:quartermaster", "population_control": "creature"},
            "conditions": [{
                "minecraft:spawns_on_surface": {},
                "minecraft:brightness_filter": {"min": 9, "max": 15, "adjust_for_weather": False},
                "minecraft:weight": {"default": 1},
                "minecraft:herd": {"min_size": 1, "max_size": 1},
                "minecraft:density_limit": {"surface": 1},
                "minecraft:biome_filter": {"any_of": [{"test": "has_biome_tag", "operator": "==", "value": b} for b in ("plains", "savanna", "desert", "taiga")]},
            }],
        }})

    def _storage(self):
        """ゲームモード中にプレイヤーの持ち物を預かる見えない保管庫"""
        wjson(f"{self.bp}/entities/storage.json", {"format_version": ENTITY_FMT, "minecraft:entity": {
            "description": {"identifier": f"{NS}:storage", "is_spawnable": False, "is_summonable": True, "is_experimental": False},
            "components": {
                "minecraft:type_family": {"family": ["arsenal_storage", "inanimate", "arsenal_fx"]},
                "minecraft:collision_box": {"width": 0.2, "height": 0.2},
                "minecraft:health": {"value": 1, "max": 1},
                "minecraft:damage_sensor": {"triggers": [{"cause": "all", "deals_damage": "no"}]},
                "minecraft:physics": {"has_gravity": False, "has_collision": False},
                "minecraft:knockback_resistance": {"value": 1.0},
                "minecraft:persistent": {},
                "minecraft:fire_immune": {},
                "minecraft:inventory": {"container_type": "inventory", "inventory_size": 54, "private": True},
            },
        }})
        self._simple_client(f"{NS}:storage", "geometry.arsenal.empty", "textures/entity/arsenal/projectiles")

    def _anims2(self):
        a = {
            "animation.arsenal.robot.shield_aim": {"loop": True, "bones": {
                "rightArm": {"rotation": ["-90.0 + q.target_x_rotation", "math.clamp(q.target_y_rotation, -60.0, 45.0)", 0]},
                "leftArm": {"rotation": [-60.0, 20.0, 0]},
            }},
            "animation.arsenal.hollow.reach": {"loop": True, "bones": {
                "rightArm": {"rotation": ["-80.0 + math.sin(q.life_time * 400.0) * 6.0", 0, 0]},
                "leftArm": {"rotation": ["-80.0 - math.sin(q.life_time * 400.0) * 6.0", 0, 0]},
            }},
            "animation.arsenal.hollow.swell": {"loop": True, "bones": {"body": {"scale": ["1.0 + math.sin(q.life_time * 1400.0) * 0.08", "1.0 + math.sin(q.life_time * 1400.0) * 0.05", "1.0 + math.sin(q.life_time * 1400.0) * 0.08"]}}},
            "animation.arsenal.dog.walk": {"loop": True, "bones": {
                "legFL": {"rotation": ["math.cos(q.anim_time * 800.0) * 40.0 * math.min(1.0, q.modified_move_speed * 3.0)", 0, 0]},
                "legBR": {"rotation": ["math.cos(q.anim_time * 800.0) * 40.0 * math.min(1.0, q.modified_move_speed * 3.0)", 0, 0]},
                "legFR": {"rotation": ["-math.cos(q.anim_time * 800.0) * 40.0 * math.min(1.0, q.modified_move_speed * 3.0)", 0, 0]},
                "legBL": {"rotation": ["-math.cos(q.anim_time * 800.0) * 40.0 * math.min(1.0, q.modified_move_speed * 3.0)", 0, 0]},
                "tail": {"rotation": [0, "math.sin(q.life_time * 600.0) * 20.0", 0]},
            }},
            "animation.arsenal.dog.look": {"loop": True, "bones": {"head": {"rotation": ["q.target_x_rotation", "q.target_y_rotation", 0]}}},
            "animation.arsenal.drone.spin": {"loop": True, "bones": {f"rotor{i}": {"rotation": [0, "q.life_time * 1440.0", 0]} for i in range(4)}},
            "animation.arsenal.drone.tilt": {"loop": True, "bones": {"body": {"rotation": ["math.min(15.0, q.modified_move_speed * 60.0)", 0, 0], "position": [0, "math.sin(q.life_time * 180.0) * 0.6", 0]}}},
            "animation.arsenal.walker.walk": {"loop": True, "bones": {
                "leg0": {"rotation": ["math.cos(q.anim_time * 500.0) * 25.0 * math.min(1.0, q.modified_move_speed * 3.0)", 0, 0]},
                "leg3": {"rotation": ["math.cos(q.anim_time * 500.0) * 25.0 * math.min(1.0, q.modified_move_speed * 3.0)", 0, 0]},
                "leg1": {"rotation": ["-math.cos(q.anim_time * 500.0) * 25.0 * math.min(1.0, q.modified_move_speed * 3.0)", 0, 0]},
                "leg2": {"rotation": ["-math.cos(q.anim_time * 500.0) * 25.0 * math.min(1.0, q.modified_move_speed * 3.0)", 0, 0]},
            }},
            "animation.arsenal.walker.look": {"loop": True, "bones": {"head": {"rotation": ["q.target_x_rotation * 0.5", "q.target_y_rotation", 0]}}},
            "animation.arsenal.sentry.aim": {"loop": True, "bones": {"head": {"rotation": [f"-q.property('{NS}:pitch')", 0, 0]}}},
            "animation.arsenal.buggy.wheels": {"loop": True, "bones": {w: {"rotation": ["q.modified_distance_moved * -90.0", 0, 0]} for w in ("wheel_fl", "wheel_fr", "wheel_bl", "wheel_br")}},
        }
        for vid in self.d["VEHICLES"]:
            bone = {"hmg_nest": "gun", "aa_gun": "guns", "at_post": "tube", "buggy": "gun", "gl_post": "gun", "apc": "gun"}[vid]
            a[f"animation.arsenal.{vid}.aim"] = {"loop": True, "bones": {bone: {"rotation": [f"-q.property('{NS}:pitch')", 0, 0]}}}
        return a
