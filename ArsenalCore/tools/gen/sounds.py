"""ARSENAL CORE 生成：サウンド定義"""
import copy  # noqa: F401
import json  # noqa: F401
import os  # noqa: F401
import sys  # noqa: F401

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import modelgen  # noqa: E402,F401
import riggen  # noqa: E402,F401
from texgen import textures as tx  # noqa: E402,F401
from gen.common import NS, ITEM_FMT, BLOCK_FMT, ENTITY_FMT, wjson, wpng, item_json, is_scoped  # noqa: E402,F401


class SoundsMixin:
    def sounds(self, sound_files):
        files = set(sound_files)
        defs = {}

        def add(event, prefix, category="player", mn=2.0, mx=48.0, volume=1.0, stream=False):
            variants = sorted(f for f in files if f == prefix or (f.startswith(prefix + "_") and f[len(prefix) + 1:].isdigit()))
            if not variants:
                raise RuntimeError(f"no sound files for {event} ({prefix})")
            defs[event] = {"category": category, "min_distance": mn, "max_distance": mx,
                           "sounds": [{"name": f"sounds/arsenal/{v}", "volume": volume, "load_on_low_memory": True} for v in variants]}

        import audiogen
        for prof in audiogen.GUN_PROFILES:
            add(f"arsenal.fire.{prof}", f"fire/{prof}", mx=64.0)
            add(f"arsenal.far.{prof}", f"fire/{prof}_far".replace("_far", "_far"), mn=16.0, mx=256.0)
        for s in ("suppressed", "suppressed_heavy", "launcher", "rocket", "energy", "arc", "cryo", "rail", "grapple", "flare"):
            add(f"arsenal.fire.{s}", f"fire/{s}", mx=40.0 if s.startswith("suppressed") else 64.0)
        for m in ("mag_out", "mag_in", "bolt_back", "bolt_forward", "shell_insert", "pump", "break_open", "break_close", "belt", "heavy_load", "revolver_spin", "dry_fire", "mode_switch", "equip", "jam", "cell_out", "cell_in"):
            add(f"arsenal.mech.{m}", f"mech/{m}", mx=16.0)
        for fx in ("hit", "headshot", "kill", "lock_beep", "lock_on", "charge", "heat_vent", "overheat", "grenade_pin", "bounce", "flash_ring", "breath_in", "breath_out", "craft", "repair", "c4_beep", "mine_arm", "spin_up", "spin_down", "casing"):
            cat = "ui" if fx in ("hit", "headshot", "kill", "lock_beep", "lock_on") else "player"
            add(f"arsenal.fx.{fx}", f"fx/{fx}", category=cat, mx=16.0)
        for fx in ("explosion", "explosion_far", "flash_bang", "smoke", "glass", "fire", "impact_block", "impact_flesh", "ricochet", "whizz", "crack"):
            mx = {"explosion": 96.0, "explosion_far": 320.0, "flash_bang": 64.0}.get(fx, 24.0)
            add(f"arsenal.fx.{fx}", f"fx/{fx}", category="neutral" if fx.startswith("impact") else "player", mn=4.0 if mx > 60 else 1.0, mx=mx)
        # ---- 2.0 ----
        for prof in audiogen.GUN_PROFILES:
            add(f"arsenal.in.{prof}", f"fire/{prof}_in", mx=48.0)
        for s2 in ("flamer", "beam", "gravity", "plasma", "needle", "sonic", "mortar"):
            add(f"arsenal.fire.{s2}", f"fire/{s2}", mx=48.0)
        groups = {
            "melee": ["swing", "swing_heavy", "hit", "hit_metal", "zap", "throw"],
            "armor": ["plate_hit", "plate_break", "plate_insert", "helmet_ping"],
            "vehicle": ["engine", "engine_rev", "horn"],
            "boss": ["warlord_roar", "juggernaut_roar", "servo", "stomp", "emp_charge", "emp_blast"],
            "ui": ["buy", "sell", "levelup", "rankup", "challenge", "streak_ready", "radio", "error"],
            "world": ["jet", "drop_whistle", "klaxon", "wave_horn", "gunship", "drone", "sonar"],
            "gear": ["heal", "adrenaline", "defib", "emp", "deploy", "beep", "claymore"],
        }
        for grp, names in groups.items():
            for nm in names:
                far = grp in ("world", "boss")
                cat = "ui" if grp == "ui" else "hostile" if grp == "boss" else "player"
                add(f"arsenal.{grp}.{nm}", f"{grp}/{nm}", category=cat, mn=4.0 if far else 1.0, mx=160.0 if nm in ("jet", "gunship", "wave_horn", "klaxon") else (64.0 if far else 24.0))
        wjson(f"{self.rp}/sounds/sound_definitions.json", {"format_version": "1.20.20", "sound_definitions": defs})
        # エンティティ音（バニラの効果音を流用）
        ent = {}
        for eid, e in self.d["ENEMIES"].items():
            fac = e.get("faction")
            if e.get("model") == "dog":
                ev = {"ambient": "mob.wolf.growl", "hurt": "mob.wolf.hurt", "death": "mob.wolf.death"}
            elif fac == "legion":
                ev = {"hurt": "mob.irongolem.hit", "death": "mob.irongolem.death", "step": "mob.irongolem.walk"}
            elif fac == "hollow":
                ev = {"ambient": "mob.zombie.say", "hurt": "mob.zombie.hurt", "death": "mob.zombie.death"}
            else:
                ev = {"ambient": "mob.pillager.idle", "hurt": "mob.pillager.hurt", "death": "mob.pillager.death"}
            ent[f"{NS}:{eid}"] = {"volume": 1.0, "pitch": [0.9, 1.1] if fac != "hollow" else [0.6, 0.8], "events": ev}
        ent[f"{NS}:boss_warlord"] = {"volume": 1.0, "pitch": [0.8, 0.9], "events": {"ambient": "mob.pillager.idle", "hurt": "mob.pillager.hurt", "death": "mob.ravager.death"}}
        ent[f"{NS}:boss_juggernaut"] = {"volume": 1.2, "pitch": [0.6, 0.7], "events": {"hurt": "mob.irongolem.hit", "death": "mob.irongolem.death", "step": "mob.irongolem.walk"}}
        ent[f"{NS}:quartermaster"] = {"volume": 1.0, "pitch": [0.9, 1.0], "events": {"ambient": "mob.villager.idle", "hurt": "mob.villager.hit", "death": "mob.villager.death"}}
        wjson(f"{self.rp}/sounds.json", {"entity_sounds": {"entities": ent}})
        self.sound_events = sorted(defs)
        self.log(f"  sound events: {len(defs)}")
