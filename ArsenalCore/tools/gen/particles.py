"""ARSENAL CORE 生成：パーティクル"""
import copy  # noqa: F401
import json  # noqa: F401
import os  # noqa: F401
import sys  # noqa: F401

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import modelgen  # noqa: E402,F401
import riggen  # noqa: E402,F401
from texgen import textures as tx  # noqa: E402,F401
from gen.common import NS, ITEM_FMT, BLOCK_FMT, ENTITY_FMT, wjson, wpng, item_json, is_scoped  # noqa: E402,F401


class ParticlesMixin:
    def particles(self):
        P = {}
        TEX = "textures/particle/arsenal_particles"

        def uv(cell, frames=None):
            cx, cy = tx.PARTICLE_CELLS[cell]
            u = {"texture_width": 64, "texture_height": 64, "uv": [cx * 8, cy * 8], "uv_size": [8, 8]}
            if frames:
                u = {"texture_width": 64, "texture_height": 64, "flipbook": {"base_UV": [cx * 8, cy * 8], "size_UV": [8, 8], "step_UV": [8, 0], "frames_per_second": frames[1], "max_frame": frames[0], "stretch_to_lifetime": True, "loop": False}}
            return u

        def eff(pid, material, comps):
            P[pid] = {"format_version": "1.26.10", "particle_effect": {
                "description": {"identifier": f"{NS}:{pid}", "basic_render_parameters": {"material": material, "texture": TEX}},
                "components": comps}}

        eff("muzzle_flash", "particles_blend", {
            "minecraft:emitter_rate_instant": {"num_particles": 3},
            "minecraft:emitter_lifetime_once": {"active_time": 0.05},
            "minecraft:emitter_shape_point": {"direction": ["math.random(-1,1)", "math.random(-1,1)", "math.random(-1,1)"]},
            "minecraft:particle_lifetime_expression": {"max_lifetime": 0.07},
            "minecraft:particle_initial_speed": 0.3,
            "minecraft:particle_initial_spin": {"rotation": "math.random(0, 360)"},
            "minecraft:particle_motion_dynamic": {},
            "minecraft:particle_appearance_billboard": {"size": ["(v.size ?? 0.25) * (1.0 - v.particle_age / v.particle_lifetime * 0.5) * math.random(0.8, 1.2)", "(v.size ?? 0.25) * (1.0 - v.particle_age / v.particle_lifetime * 0.5) * math.random(0.8, 1.2)"], "facing_camera_mode": "rotate_xyz", "uv": uv("flash")},
            "minecraft:particle_appearance_tinting": {"color": [1.0, "math.random(0.75, 0.9)", "math.random(0.35, 0.5)", 1.0]},
        })
        eff("muzzle_smoke", "particles_blend", {
            "minecraft:emitter_rate_instant": {"num_particles": 4},
            "minecraft:emitter_lifetime_once": {"active_time": 0.05},
            "minecraft:emitter_shape_sphere": {"radius": 0.05, "direction": "outwards"},
            "minecraft:particle_lifetime_expression": {"max_lifetime": "math.random(0.4, 0.8)"},
            "minecraft:particle_initial_speed": "math.random(0.2, 0.6)",
            "minecraft:particle_motion_dynamic": {"linear_acceleration": [0, 0.35, 0], "linear_drag_coefficient": 2.2},
            "minecraft:particle_appearance_billboard": {"size": ["0.06 + v.particle_age * 0.25", "0.06 + v.particle_age * 0.25"], "facing_camera_mode": "rotate_xyz", "uv": uv("smoke0", (4, 6))},
            "minecraft:particle_appearance_tinting": {"color": [0.75, 0.75, 0.75, "0.45 * (1.0 - v.particle_age / v.particle_lifetime)"]},
            "minecraft:particle_appearance_lighting": {},
        })
        # 曳光：光る筋（ライティング無しで常に明るい）。長さは速さに比例（最大 約 5 ブロック）
        eff("tracer", "particles_blend", {
            "minecraft:emitter_rate_instant": {"num_particles": 1},
            "minecraft:emitter_lifetime_once": {"active_time": 0.01},
            "minecraft:emitter_shape_point": {"direction": ["v.tracer.direction_x", "v.tracer.direction_y", "v.tracer.direction_z"]},
            "minecraft:particle_lifetime_expression": {"max_lifetime": "math.max(0.05, v.life ?? 0.2)"},
            "minecraft:particle_initial_speed": "v.tracer.speed",
            "minecraft:particle_motion_dynamic": {},
            "minecraft:particle_appearance_billboard": {"size": ["v.width ?? 0.05", "math.min(2.5, v.tracer.speed * 0.018)"], "facing_camera_mode": "lookat_direction",
                                                        "direction": {"mode": "derive_from_velocity", "min_speed_threshold": 0.01}, "uv": uv("tracer")},
            "minecraft:particle_appearance_tinting": {"color": ["v.color.r", "v.color.g", "v.color.b", 1.0]},
        })
        # 弾道に一瞬残る細い光の線（射線が分かるように）
        eff("tracer_trail", "particles_blend", {
            "minecraft:emitter_rate_instant": {"num_particles": 1},
            "minecraft:emitter_lifetime_once": {"active_time": 0.01},
            "minecraft:emitter_shape_point": {"direction": ["v.tracer.direction_x", "v.tracer.direction_y", "v.tracer.direction_z"]},
            "minecraft:particle_lifetime_expression": {"max_lifetime": 0.22},
            "minecraft:particle_initial_speed": 0.001,
            "minecraft:particle_motion_dynamic": {},
            "minecraft:particle_appearance_billboard": {"size": ["(v.width ?? 0.05) * 0.35", "v.len ?? 1.0"], "facing_camera_mode": "lookat_direction",
                                                        "direction": {"mode": "custom", "custom_direction": ["v.tracer.direction_x", "v.tracer.direction_y", "v.tracer.direction_z"]}, "uv": uv("soft")},
            "minecraft:particle_appearance_tinting": {"color": ["v.color.r", "v.color.g", "v.color.b", "0.55 * (1.0 - v.particle_age / v.particle_lifetime)"]},
        })
        eff("impact_debris", "particles_alpha", {
            "minecraft:emitter_rate_instant": {"num_particles": "v.count ?? 6"},
            "minecraft:emitter_lifetime_once": {"active_time": 0.05},
            "minecraft:emitter_shape_point": {"direction": ["v.normal.x + math.random(-0.6,0.6)", "v.normal.y + math.random(-0.2,0.8)", "v.normal.z + math.random(-0.6,0.6)"]},
            "minecraft:particle_lifetime_expression": {"max_lifetime": "math.random(0.4, 0.9)"},
            "minecraft:particle_initial_speed": "math.random(2.5, 5.5)",
            "minecraft:particle_motion_dynamic": {"linear_acceleration": [0, -18, 0], "linear_drag_coefficient": 1.0},
            "minecraft:particle_motion_collision": {"coefficient_of_restitution": 0.2, "collision_radius": 0.04, "collision_drag": 4.0},
            "minecraft:particle_appearance_billboard": {"size": [0.045, 0.045], "facing_camera_mode": "rotate_xyz", "uv": uv("debris")},
            "minecraft:particle_appearance_tinting": {"color": ["v.color.r", "v.color.g", "v.color.b", 1.0]},
            "minecraft:particle_appearance_lighting": {},
        })
        eff("impact_dust", "particles_blend", {
            "minecraft:emitter_rate_instant": {"num_particles": 3},
            "minecraft:emitter_lifetime_once": {"active_time": 0.05},
            "minecraft:emitter_shape_point": {"direction": ["v.normal.x + math.random(-0.5,0.5)", "v.normal.y + math.random(-0.5,0.5)", "v.normal.z + math.random(-0.5,0.5)"]},
            "minecraft:particle_lifetime_expression": {"max_lifetime": "math.random(0.5, 1.0)"},
            "minecraft:particle_initial_speed": "math.random(0.6, 1.4)",
            "minecraft:particle_motion_dynamic": {"linear_drag_coefficient": 3.0, "linear_acceleration": [0, 0.2, 0]},
            "minecraft:particle_appearance_billboard": {"size": ["0.08 + v.particle_age * 0.3", "0.08 + v.particle_age * 0.3"], "facing_camera_mode": "rotate_xyz", "uv": uv("smoke1")},
            "minecraft:particle_appearance_tinting": {"color": ["v.color.r", "v.color.g", "v.color.b", "0.6 * (1.0 - v.particle_age / v.particle_lifetime)"]},
            "minecraft:particle_appearance_lighting": {},
        })
        eff("impact_spark", "particles_blend", {
            "minecraft:emitter_rate_instant": {"num_particles": "math.random_integer(3, 6)"},
            "minecraft:emitter_lifetime_once": {"active_time": 0.05},
            "minecraft:emitter_shape_point": {"direction": ["math.random(-1,1)", "math.random(-0.2,1)", "math.random(-1,1)"]},
            "minecraft:particle_lifetime_expression": {"max_lifetime": "math.random(0.1, 0.3)"},
            "minecraft:particle_initial_speed": "math.random(3, 7)",
            "minecraft:particle_motion_dynamic": {"linear_acceleration": [0, -12, 0]},
            "minecraft:particle_appearance_billboard": {"size": [0.02, 0.09], "facing_camera_mode": "lookat_direction", "direction": {"mode": "derive_from_velocity"}, "uv": uv("spark")},
            "minecraft:particle_appearance_tinting": {"color": [1.0, 0.85, 0.45, 1.0]},
        })
        eff("blood", "particles_alpha", {
            "minecraft:emitter_rate_instant": {"num_particles": "math.random_integer(5, 9)"},
            "minecraft:emitter_lifetime_once": {"active_time": 0.05},
            "minecraft:emitter_shape_sphere": {"radius": 0.1, "direction": "outwards"},
            "minecraft:particle_lifetime_expression": {"max_lifetime": "math.random(0.3, 0.7)"},
            "minecraft:particle_initial_speed": "math.random(1.0, 2.5)",
            "minecraft:particle_motion_dynamic": {"linear_acceleration": [0, -12, 0]},
            "minecraft:particle_motion_collision": {"collision_radius": 0.03, "expire_on_contact": True},
            "minecraft:particle_appearance_billboard": {"size": ["math.random(0.04, 0.08)", "math.random(0.04, 0.08)"], "facing_camera_mode": "rotate_xyz", "uv": uv("drop")},
            "minecraft:particle_appearance_tinting": {"color": [0.6, 0.02, 0.02, 1.0]},
            "minecraft:particle_appearance_lighting": {},
        })
        eff("casing", "particles_alpha", {
            "minecraft:emitter_rate_instant": {"num_particles": 1},
            "minecraft:emitter_lifetime_once": {"active_time": 0.01},
            "minecraft:emitter_shape_point": {"direction": ["v.eject.direction_x", "v.eject.direction_y", "v.eject.direction_z"]},
            "minecraft:particle_lifetime_expression": {"max_lifetime": 1.2},
            "minecraft:particle_initial_speed": "v.eject.speed",
            "minecraft:particle_initial_spin": {"rotation": "math.random(0,360)", "rotation_rate": 900},
            "minecraft:particle_motion_dynamic": {"linear_acceleration": [0, -16, 0], "rotation_drag_coefficient": 1.0},
            "minecraft:particle_motion_collision": {"coefficient_of_restitution": 0.35, "collision_radius": 0.03, "collision_drag": 6.0},
            "minecraft:particle_appearance_billboard": {"size": [0.05, 0.05], "facing_camera_mode": "rotate_xyz", "uv": uv("casing")},
            "minecraft:particle_appearance_lighting": {},
        })
        eff("shell_casing", "particles_alpha", {
            "minecraft:emitter_rate_instant": {"num_particles": 1},
            "minecraft:emitter_lifetime_once": {"active_time": 0.01},
            "minecraft:emitter_shape_point": {"direction": ["v.eject.direction_x", "v.eject.direction_y", "v.eject.direction_z"]},
            "minecraft:particle_lifetime_expression": {"max_lifetime": 1.5},
            "minecraft:particle_initial_speed": "v.eject.speed",
            "minecraft:particle_initial_spin": {"rotation": "math.random(0,360)", "rotation_rate": 600},
            "minecraft:particle_motion_dynamic": {"linear_acceleration": [0, -16, 0]},
            "minecraft:particle_motion_collision": {"coefficient_of_restitution": 0.3, "collision_radius": 0.05, "collision_drag": 6.0},
            "minecraft:particle_appearance_billboard": {"size": [0.08, 0.08], "facing_camera_mode": "rotate_xyz", "uv": uv("shell")},
            "minecraft:particle_appearance_lighting": {},
        })
        eff("laser_dot", "particles_blend", {
            "minecraft:emitter_rate_instant": {"num_particles": 1},
            "minecraft:emitter_lifetime_once": {"active_time": 0.01},
            "minecraft:emitter_shape_point": {},
            "minecraft:particle_lifetime_expression": {"max_lifetime": 0.14},
            "minecraft:particle_appearance_billboard": {"size": [0.06, 0.06], "facing_camera_mode": "rotate_xyz", "uv": uv("dot")},
            "minecraft:particle_appearance_tinting": {"color": [1.0, 0.1, 0.1, 1.0]},
        })
        eff("explosion", "particles_blend", {
            "minecraft:emitter_rate_instant": {"num_particles": "12 + (v.power ?? 3) * 6"},
            "minecraft:emitter_lifetime_once": {"active_time": 0.05},
            "minecraft:emitter_shape_sphere": {"radius": "(v.power ?? 3) * 0.25", "direction": "outwards"},
            "minecraft:particle_lifetime_expression": {"max_lifetime": "math.random(0.25, 0.55)"},
            "minecraft:particle_initial_speed": "math.random(2, 5) * (v.power ?? 3) * 0.5",
            "minecraft:particle_motion_dynamic": {"linear_drag_coefficient": 4.0},
            "minecraft:particle_appearance_billboard": {"size": ["(0.6 + v.particle_age * 2.0) * (v.power ?? 3) * 0.25", "(0.6 + v.particle_age * 2.0) * (v.power ?? 3) * 0.25"], "facing_camera_mode": "rotate_xyz", "uv": uv("flame0", (4, 10))},
            "minecraft:particle_appearance_tinting": {"color": {"gradient": {"0.0": [1.0, 0.95, 0.7, 1.0], "0.4": [1.0, 0.55, 0.15, 1.0], "1.0": [0.3, 0.1, 0.05, 0.0]}, "interpolant": "v.particle_age / v.particle_lifetime"}},
        })
        eff("explosion_smoke", "particles_blend", {
            "minecraft:emitter_rate_instant": {"num_particles": "10 + (v.power ?? 3) * 4"},
            "minecraft:emitter_lifetime_once": {"active_time": 0.05},
            "minecraft:emitter_shape_sphere": {"radius": "(v.power ?? 3) * 0.3", "direction": "outwards"},
            "minecraft:particle_lifetime_expression": {"max_lifetime": "math.random(1.5, 3.0)"},
            "minecraft:particle_initial_speed": "math.random(1, 3) * (v.power ?? 3) * 0.4",
            "minecraft:particle_motion_dynamic": {"linear_drag_coefficient": 2.0, "linear_acceleration": [0, 0.8, 0]},
            "minecraft:particle_appearance_billboard": {"size": ["(0.5 + v.particle_age * 0.8) * (v.power ?? 3) * 0.3", "(0.5 + v.particle_age * 0.8) * (v.power ?? 3) * 0.3"], "facing_camera_mode": "rotate_xyz", "uv": uv("smoke0", (4, 2))},
            "minecraft:particle_appearance_tinting": {"color": [0.22, 0.21, 0.2, "0.85 * (1.0 - v.particle_age / v.particle_lifetime)"]},
            "minecraft:particle_appearance_lighting": {},
        })
        eff("smoke_cloud", "particles_blend", {
            "minecraft:emitter_rate_steady": {"spawn_rate": 26, "max_particles": 260},
            "minecraft:emitter_lifetime_once": {"active_time": "v.duration ?? 15"},
            "minecraft:emitter_shape_sphere": {"radius": "v.radius ?? 5", "surface_only": False, "direction": "outwards"},
            "minecraft:particle_lifetime_expression": {"max_lifetime": "math.random(3.0, 5.0)"},
            "minecraft:particle_initial_speed": "math.random(0.05, 0.3)",
            "minecraft:particle_motion_dynamic": {"linear_drag_coefficient": 0.6, "linear_acceleration": [0, 0.05, 0]},
            "minecraft:particle_appearance_billboard": {"size": ["1.4 + v.particle_age * 0.25", "1.4 + v.particle_age * 0.25"], "facing_camera_mode": "rotate_xyz", "uv": uv("smoke2")},
            "minecraft:particle_appearance_tinting": {"color": [0.78, 0.8, 0.8, "math.min(1.0, v.particle_age * 2.0) * (1.0 - v.particle_age / v.particle_lifetime) * 0.95"]},
            "minecraft:particle_appearance_lighting": {},
        })
        eff("rocket_trail", "particles_blend", {
            "minecraft:emitter_rate_instant": {"num_particles": 3},
            "minecraft:emitter_lifetime_once": {"active_time": 0.05},
            "minecraft:emitter_shape_sphere": {"radius": 0.08, "direction": "outwards"},
            "minecraft:particle_lifetime_expression": {"max_lifetime": "math.random(0.8, 1.6)"},
            "minecraft:particle_initial_speed": 0.2,
            "minecraft:particle_motion_dynamic": {"linear_drag_coefficient": 1.5, "linear_acceleration": [0, 0.3, 0]},
            "minecraft:particle_appearance_billboard": {"size": ["0.15 + v.particle_age * 0.35", "0.15 + v.particle_age * 0.35"], "facing_camera_mode": "rotate_xyz", "uv": uv("smoke1")},
            "minecraft:particle_appearance_tinting": {"color": {"gradient": {"0.0": [1.0, 0.8, 0.4, 1.0], "0.1": [0.8, 0.8, 0.8, 0.7], "1.0": [0.6, 0.6, 0.6, 0.0]}, "interpolant": "v.particle_age / v.particle_lifetime"}},
        })
        # 照明弾：芯の強い光・周りの大きな光のにじみ・尾を引く火の粉・煙
        eff("flare_glow", "particles_blend", {
            "minecraft:emitter_rate_instant": {"num_particles": 3},
            "minecraft:emitter_lifetime_once": {"active_time": 0.05},
            "minecraft:emitter_shape_sphere": {"radius": 0.08, "direction": "outwards"},
            "minecraft:particle_lifetime_expression": {"max_lifetime": "math.random(0.25, 0.5)"},
            "minecraft:particle_initial_speed": 0.4,
            "minecraft:particle_motion_dynamic": {"linear_acceleration": [0, 0.8, 0]},
            "minecraft:particle_appearance_billboard": {"size": ["0.45 * (1.0 - v.particle_age / v.particle_lifetime * 0.6)", "0.45 * (1.0 - v.particle_age / v.particle_lifetime * 0.6)"], "facing_camera_mode": "rotate_xyz", "uv": uv("soft")},
            "minecraft:particle_appearance_tinting": {"color": [1.0, "math.random(0.35, 0.55)", "math.random(0.15, 0.3)", 1.0]},
        })
        eff("flare_halo", "particles_blend", {
            "minecraft:emitter_rate_instant": {"num_particles": 1},
            "minecraft:emitter_lifetime_once": {"active_time": 0.01},
            "minecraft:emitter_shape_point": {},
            "minecraft:particle_lifetime_expression": {"max_lifetime": 0.35},
            "minecraft:particle_appearance_billboard": {"size": [1.6, 1.6], "facing_camera_mode": "rotate_xyz", "uv": uv("soft")},
            "minecraft:particle_appearance_tinting": {"color": [1.0, 0.35, 0.2, "0.45 * (1.0 - v.particle_age / v.particle_lifetime)"]},
        })
        eff("flare_trail", "particles_blend", {
            "minecraft:emitter_rate_instant": {"num_particles": 4},
            "minecraft:emitter_lifetime_once": {"active_time": 0.05},
            "minecraft:emitter_shape_sphere": {"radius": 0.12, "direction": "outwards"},
            "minecraft:particle_lifetime_expression": {"max_lifetime": "math.random(0.5, 1.0)"},
            "minecraft:particle_initial_speed": "math.random(0.1, 0.5)",
            "minecraft:particle_motion_dynamic": {"linear_acceleration": [0, -1.5, 0], "linear_drag_coefficient": 1.2},
            "minecraft:particle_appearance_billboard": {"size": ["0.08 * (1.0 - v.particle_age / v.particle_lifetime)", "0.08 * (1.0 - v.particle_age / v.particle_lifetime)"], "facing_camera_mode": "rotate_xyz", "uv": uv("soft")},
            "minecraft:particle_appearance_tinting": {"color": [1.0, "math.random(0.4, 0.7)", 0.2, 1.0]},
        })
        eff("flare_smoke", "particles_blend", {
            "minecraft:emitter_rate_instant": {"num_particles": 2},
            "minecraft:emitter_lifetime_once": {"active_time": 0.05},
            "minecraft:emitter_shape_sphere": {"radius": 0.1, "direction": "outwards"},
            "minecraft:particle_lifetime_expression": {"max_lifetime": "math.random(1.5, 2.5)"},
            "minecraft:particle_initial_speed": 0.2,
            "minecraft:particle_motion_dynamic": {"linear_acceleration": [0, 0.6, 0], "linear_drag_coefficient": 0.8},
            "minecraft:particle_appearance_billboard": {"size": ["0.2 + v.particle_age * 0.3", "0.2 + v.particle_age * 0.3"], "facing_camera_mode": "rotate_xyz", "uv": uv("smoke1")},
            "minecraft:particle_appearance_tinting": {"color": [0.95, 0.75, 0.7, "0.5 * (1.0 - v.particle_age / v.particle_lifetime)"]},
            "minecraft:particle_appearance_lighting": {},
        })
        # 40mm の飛翔：明るい芯と薄い煙で弾道を見せる
        eff("shell_trail", "particles_blend", {
            "minecraft:emitter_rate_instant": {"num_particles": 2},
            "minecraft:emitter_lifetime_once": {"active_time": 0.05},
            "minecraft:emitter_shape_sphere": {"radius": 0.05, "direction": "outwards"},
            "minecraft:particle_lifetime_expression": {"max_lifetime": "math.random(0.3, 0.6)"},
            "minecraft:particle_initial_speed": 0.05,
            "minecraft:particle_appearance_billboard": {"size": ["0.12 * (1.0 - v.particle_age / v.particle_lifetime)", "0.12 * (1.0 - v.particle_age / v.particle_lifetime)"], "facing_camera_mode": "rotate_xyz", "uv": uv("soft")},
            "minecraft:particle_appearance_tinting": {"color": [1.0, 0.8, 0.45, "1.0 - v.particle_age / v.particle_lifetime"]},
        })
        eff("arc_spark", "particles_blend", {
            "minecraft:emitter_rate_instant": {"num_particles": 2},
            "minecraft:emitter_lifetime_once": {"active_time": 0.01},
            "minecraft:emitter_shape_sphere": {"radius": 0.12, "direction": "outwards"},
            "minecraft:particle_lifetime_expression": {"max_lifetime": "math.random(0.08, 0.2)"},
            "minecraft:particle_initial_speed": 0.5,
            "minecraft:particle_initial_spin": {"rotation": "math.random(0,360)"},
            "minecraft:particle_appearance_billboard": {"size": [0.18, 0.18], "facing_camera_mode": "rotate_xyz", "uv": uv("bolt")},
            "minecraft:particle_appearance_tinting": {"color": ["v.color.r", "v.color.g", "v.color.b", 1.0]},
        })
        eff("frost", "particles_blend", {
            "minecraft:emitter_rate_instant": {"num_particles": 10},
            "minecraft:emitter_lifetime_once": {"active_time": 0.05},
            "minecraft:emitter_shape_sphere": {"radius": 0.4, "direction": "outwards"},
            "minecraft:particle_lifetime_expression": {"max_lifetime": "math.random(0.6, 1.2)"},
            "minecraft:particle_initial_speed": "math.random(0.3, 1.2)",
            "minecraft:particle_initial_spin": {"rotation": "math.random(0,360)", "rotation_rate": 90},
            "minecraft:particle_motion_dynamic": {"linear_acceleration": [0, -1.5, 0], "linear_drag_coefficient": 1.5},
            "minecraft:particle_appearance_billboard": {"size": [0.1, 0.1], "facing_camera_mode": "rotate_xyz", "uv": uv("flake")},
            "minecraft:particle_appearance_tinting": {"color": [0.7, 0.92, 1.0, "1.0 - v.particle_age / v.particle_lifetime"]},
        })
        eff("flame", "particles_blend", {
            "minecraft:emitter_rate_instant": {"num_particles": 14},
            "minecraft:emitter_lifetime_once": {"active_time": 0.05},
            "minecraft:emitter_shape_point": {"direction": ["v.aim.direction_x + math.random(-0.12, 0.12)", "v.aim.direction_y + math.random(-0.12, 0.12)", "v.aim.direction_z + math.random(-0.12, 0.12)"]},
            "minecraft:particle_lifetime_expression": {"max_lifetime": "math.random(0.35, 0.6)"},
            "minecraft:particle_initial_speed": "v.aim.speed * math.random(0.6, 1.0)",
            "minecraft:particle_motion_dynamic": {"linear_drag_coefficient": 2.2, "linear_acceleration": [0, 1.5, 0]},
            "minecraft:particle_motion_collision": {"collision_radius": 0.1, "expire_on_contact": True},
            "minecraft:particle_appearance_billboard": {"size": ["0.12 + v.particle_age * 0.9", "0.12 + v.particle_age * 0.9"], "facing_camera_mode": "rotate_xyz", "uv": uv("flame0", (4, 8))},
            "minecraft:particle_appearance_tinting": {"color": {"gradient": {"0.0": [1.0, 0.9, 0.6, 1.0], "0.5": [1.0, 0.45, 0.1, 0.9], "1.0": [0.3, 0.1, 0.05, 0.0]}, "interpolant": "v.particle_age / v.particle_lifetime"}},
        })
        eff("fire_patch", "particles_blend", {
            "minecraft:emitter_rate_steady": {"spawn_rate": 30, "max_particles": 120},
            "minecraft:emitter_lifetime_once": {"active_time": "v.duration ?? 8"},
            "minecraft:emitter_shape_disc": {"radius": "v.radius ?? 2.5", "plane_normal": "y", "direction": [0, 1, 0]},
            "minecraft:particle_lifetime_expression": {"max_lifetime": "math.random(0.4, 0.9)"},
            "minecraft:particle_initial_speed": "math.random(0.5, 1.5)",
            "minecraft:particle_motion_dynamic": {"linear_acceleration": [0, 1.5, 0]},
            "minecraft:particle_appearance_billboard": {"size": ["0.25 * (1.0 - v.particle_age / v.particle_lifetime * 0.6)", "0.3 * (1.0 - v.particle_age / v.particle_lifetime * 0.6)"], "facing_camera_mode": "lookat_y", "uv": uv("flame0", (4, 8))},
            "minecraft:particle_appearance_tinting": {"color": {"gradient": {"0.0": [1.0, 0.8, 0.4, 1.0], "1.0": [0.8, 0.2, 0.05, 0.0]}, "interpolant": "v.particle_age / v.particle_lifetime"}},
        })
        eff("trajectory", "particles_blend", {
            "minecraft:emitter_rate_instant": {"num_particles": 1},
            "minecraft:emitter_lifetime_once": {"active_time": 0.01},
            "minecraft:emitter_shape_point": {},
            "minecraft:particle_lifetime_expression": {"max_lifetime": 0.22},
            "minecraft:particle_appearance_billboard": {"size": [0.05, 0.05], "facing_camera_mode": "rotate_xyz", "uv": uv("dot")},
            "minecraft:particle_appearance_tinting": {"color": [1.0, 0.85, 0.3, 0.9]},
        })
        eff("rope", "particles_alpha", {
            "minecraft:emitter_rate_instant": {"num_particles": 1},
            "minecraft:emitter_lifetime_once": {"active_time": 0.01},
            "minecraft:emitter_shape_point": {},
            "minecraft:particle_lifetime_expression": {"max_lifetime": 0.1},
            "minecraft:particle_appearance_billboard": {"size": [0.035, 0.035], "facing_camera_mode": "rotate_xyz", "uv": uv("square")},
            "minecraft:particle_appearance_tinting": {"color": [0.35, 0.28, 0.2, 1.0]},
            "minecraft:particle_appearance_lighting": {},
        })
        eff("steam", "particles_blend", {
            "minecraft:emitter_rate_instant": {"num_particles": 6},
            "minecraft:emitter_lifetime_once": {"active_time": 0.05},
            "minecraft:emitter_shape_sphere": {"radius": 0.1, "direction": "outwards"},
            "minecraft:particle_lifetime_expression": {"max_lifetime": "math.random(0.5, 1.0)"},
            "minecraft:particle_initial_speed": "math.random(0.5, 1.2)",
            "minecraft:particle_motion_dynamic": {"linear_acceleration": [0, 1.2, 0], "linear_drag_coefficient": 2.0},
            "minecraft:particle_appearance_billboard": {"size": ["0.1 + v.particle_age * 0.3", "0.1 + v.particle_age * 0.3"], "facing_camera_mode": "rotate_xyz", "uv": uv("smoke3")},
            "minecraft:particle_appearance_tinting": {"color": [0.95, 0.95, 0.95, "0.6 * (1.0 - v.particle_age / v.particle_lifetime)"]},
        })
        eff("energy_ring", "particles_blend", {
            "minecraft:emitter_rate_instant": {"num_particles": 1},
            "minecraft:emitter_lifetime_once": {"active_time": 0.01},
            "minecraft:emitter_shape_point": {},
            "minecraft:particle_lifetime_expression": {"max_lifetime": 0.25},
            "minecraft:particle_appearance_billboard": {"size": ["0.1 + v.particle_age * 3.0", "0.1 + v.particle_age * 3.0"], "facing_camera_mode": "rotate_xyz", "uv": uv("ring")},
            "minecraft:particle_appearance_tinting": {"color": ["v.color.r", "v.color.g", "v.color.b", "1.0 - v.particle_age / v.particle_lifetime"]},
        })
        eff("blink", "particles_blend", {
            "minecraft:emitter_rate_instant": {"num_particles": 1},
            "minecraft:emitter_lifetime_once": {"active_time": 0.01},
            "minecraft:emitter_shape_point": {},
            "minecraft:particle_lifetime_expression": {"max_lifetime": 0.18},
            "minecraft:particle_appearance_billboard": {"size": [0.1, 0.1], "facing_camera_mode": "rotate_xyz", "uv": uv("soft")},
            "minecraft:particle_appearance_tinting": {"color": [1.0, 0.1, 0.1, 1.0]},
        })
        eff("lock_marker", "particles_blend", {
            "minecraft:emitter_rate_instant": {"num_particles": 1},
            "minecraft:emitter_lifetime_once": {"active_time": 0.01},
            "minecraft:emitter_shape_point": {},
            "minecraft:particle_lifetime_expression": {"max_lifetime": 0.12},
            "minecraft:particle_appearance_billboard": {"size": [0.6, 0.6], "facing_camera_mode": "rotate_xyz", "uv": uv("hex")},
            "minecraft:particle_appearance_tinting": {"color": [1.0, "v.locked ?? 0.2", 0.1, 1.0]},
        })
        eff("scope_glint", "particles_blend", {
            "minecraft:emitter_rate_instant": {"num_particles": 1},
            "minecraft:emitter_lifetime_once": {"active_time": 0.01},
            "minecraft:emitter_shape_point": {},
            "minecraft:particle_lifetime_expression": {"max_lifetime": 0.2},
            "minecraft:particle_appearance_billboard": {"size": [0.3, 0.3], "facing_camera_mode": "rotate_xyz", "uv": uv("star")},
            "minecraft:particle_appearance_tinting": {"color": [1.0, 1.0, 0.9, 1.0]},
        })
        eff("flash_burst", "particles_blend", {
            "minecraft:emitter_rate_instant": {"num_particles": 1},
            "minecraft:emitter_lifetime_once": {"active_time": 0.01},
            "minecraft:emitter_shape_point": {},
            "minecraft:particle_lifetime_expression": {"max_lifetime": 0.3},
            "minecraft:particle_appearance_billboard": {"size": ["3.0 + v.particle_age * 6.0", "3.0 + v.particle_age * 6.0"], "facing_camera_mode": "rotate_xyz", "uv": uv("flash")},
            "minecraft:particle_appearance_tinting": {"color": [1.0, 1.0, 1.0, "1.0 - v.particle_age / v.particle_lifetime"]},
        })
        eff("rail_beam", "particles_blend", {
            "minecraft:emitter_rate_instant": {"num_particles": 1},
            "minecraft:emitter_lifetime_once": {"active_time": 0.01},
            "minecraft:emitter_shape_point": {"direction": ["v.tracer.direction_x", "v.tracer.direction_y", "v.tracer.direction_z"]},
            "minecraft:particle_lifetime_expression": {"max_lifetime": 0.35},
            "minecraft:particle_initial_speed": 0.01,
            "minecraft:particle_appearance_billboard": {"size": ["0.09 * (1.0 - v.particle_age / v.particle_lifetime)", "0.55"], "facing_camera_mode": "lookat_direction", "direction": {"mode": "custom", "custom_direction": ["v.tracer.direction_x", "v.tracer.direction_y", "v.tracer.direction_z"]}, "uv": uv("soft")},
            "minecraft:particle_appearance_tinting": {"color": ["v.color.r", "v.color.g", "v.color.b", 1.0]},
        })
        # ---- 2.0 ----
        eff("gas_cloud", "particles_blend", {
            "minecraft:emitter_rate_steady": {"spawn_rate": 22, "max_particles": 220},
            "minecraft:emitter_lifetime_once": {"active_time": "v.duration ?? 12"},
            "minecraft:emitter_shape_sphere": {"radius": "v.radius ?? 4", "surface_only": False, "direction": "outwards"},
            "minecraft:particle_lifetime_expression": {"max_lifetime": "math.random(2.5, 4.0)"},
            "minecraft:particle_initial_speed": "math.random(0.05, 0.25)",
            "minecraft:particle_motion_dynamic": {"linear_drag_coefficient": 0.6, "linear_acceleration": [0, -0.02, 0]},
            "minecraft:particle_appearance_billboard": {"size": ["1.1 + v.particle_age * 0.25", "1.1 + v.particle_age * 0.25"], "facing_camera_mode": "rotate_xyz", "uv": uv("smoke2")},
            "minecraft:particle_appearance_tinting": {"color": [0.55, 0.78, 0.25, "math.min(1.0, v.particle_age * 2.0) * (1.0 - v.particle_age / v.particle_lifetime) * 0.8"]},
            "minecraft:particle_appearance_lighting": {},
        })
        eff("emp_wave", "particles_blend", {
            "minecraft:emitter_rate_instant": {"num_particles": 3},
            "minecraft:emitter_lifetime_once": {"active_time": 0.05},
            "minecraft:emitter_shape_point": {},
            "minecraft:particle_lifetime_expression": {"max_lifetime": 0.6},
            "minecraft:particle_appearance_billboard": {"size": ["(v.radius ?? 8) * 2.0 * v.particle_age / v.particle_lifetime", "(v.radius ?? 8) * 2.0 * v.particle_age / v.particle_lifetime"], "facing_camera_mode": "emitter_transform_xz", "uv": uv("ring")},
            "minecraft:particle_appearance_tinting": {"color": [0.45, 0.75, 1.0, "1.0 - v.particle_age / v.particle_lifetime"]},
        })
        eff("target_marker", "particles_blend", {
            "minecraft:emitter_rate_instant": {"num_particles": 1},
            "minecraft:emitter_lifetime_once": {"active_time": 0.01},
            "minecraft:emitter_shape_point": {},
            "minecraft:particle_lifetime_expression": {"max_lifetime": 0.5},
            "minecraft:particle_appearance_billboard": {"size": ["(v.radius ?? 2) * (0.6 + 0.4 * math.sin(v.particle_age * 720.0))", "(v.radius ?? 2) * (0.6 + 0.4 * math.sin(v.particle_age * 720.0))"], "facing_camera_mode": "emitter_transform_xz", "uv": uv("ring")},
            "minecraft:particle_appearance_tinting": {"color": [1.0, 0.2, 0.15, "0.9 * (1.0 - v.particle_age / v.particle_lifetime)"]},
        })
        eff("signal_smoke", "particles_blend", {
            "minecraft:emitter_rate_steady": {"spawn_rate": 10, "max_particles": 80},
            "minecraft:emitter_lifetime_once": {"active_time": "v.duration ?? 4"},
            "minecraft:emitter_shape_point": {"direction": ["math.random(-0.2,0.2)", 1, "math.random(-0.2,0.2)"]},
            "minecraft:particle_lifetime_expression": {"max_lifetime": "math.random(2.0, 3.0)"},
            "minecraft:particle_initial_speed": "math.random(1.0, 1.8)",
            "minecraft:particle_motion_dynamic": {"linear_drag_coefficient": 0.8},
            "minecraft:particle_appearance_billboard": {"size": ["0.3 + v.particle_age * 0.6", "0.3 + v.particle_age * 0.6"], "facing_camera_mode": "rotate_xyz", "uv": uv("smoke1")},
            "minecraft:particle_appearance_tinting": {"color": [0.95, 0.2, 0.15, "0.85 * (1.0 - v.particle_age / v.particle_lifetime)"]},
        })
        eff("gravity_swirl", "particles_blend", {
            "minecraft:emitter_rate_instant": {"num_particles": 16},
            "minecraft:emitter_lifetime_once": {"active_time": 0.05},
            "minecraft:emitter_shape_sphere": {"radius": "v.radius ?? 3", "surface_only": True, "direction": "inwards"},
            "minecraft:particle_lifetime_expression": {"max_lifetime": 0.5},
            "minecraft:particle_initial_speed": "(v.radius ?? 3) * 2.0",
            "minecraft:particle_motion_dynamic": {},
            "minecraft:particle_appearance_billboard": {"size": [0.08, 0.2], "facing_camera_mode": "lookat_direction", "direction": {"mode": "derive_from_velocity"}, "uv": uv("soft")},
            "minecraft:particle_appearance_tinting": {"color": [0.7, 0.5, 1.0, "1.0 - v.particle_age / v.particle_lifetime"]},
        })
        eff("plasma_glow", "particles_blend", {
            "minecraft:emitter_rate_instant": {"num_particles": 2},
            "minecraft:emitter_lifetime_once": {"active_time": 0.05},
            "minecraft:emitter_shape_sphere": {"radius": 0.06, "direction": "outwards"},
            "minecraft:particle_lifetime_expression": {"max_lifetime": "math.random(0.2, 0.4)"},
            "minecraft:particle_initial_speed": 0.3,
            "minecraft:particle_motion_dynamic": {"linear_drag_coefficient": 2.0},
            "minecraft:particle_appearance_billboard": {"size": ["0.22 * (1.0 - v.particle_age / v.particle_lifetime)", "0.22 * (1.0 - v.particle_age / v.particle_lifetime)"], "facing_camera_mode": "rotate_xyz", "uv": uv("soft")},
            "minecraft:particle_appearance_tinting": {"color": ["v.color.r", "v.color.g", "v.color.b", 1.0]},
        })
        eff("heal", "particles_blend", {
            "minecraft:emitter_rate_instant": {"num_particles": 5},
            "minecraft:emitter_lifetime_once": {"active_time": 0.05},
            "minecraft:emitter_shape_box": {"half_dimensions": [0.4, 0.6, 0.4], "direction": [0, 1, 0]},
            "minecraft:particle_lifetime_expression": {"max_lifetime": "math.random(0.6, 1.0)"},
            "minecraft:particle_initial_speed": "math.random(0.4, 0.9)",
            "minecraft:particle_motion_dynamic": {"linear_drag_coefficient": 1.5},
            "minecraft:particle_appearance_billboard": {"size": [0.12, 0.12], "facing_camera_mode": "rotate_xyz", "uv": uv("cross")},
            "minecraft:particle_appearance_tinting": {"color": [0.3, 1.0, 0.4, "1.0 - v.particle_age / v.particle_lifetime"]},
        })
        eff("telegraph", "particles_blend", {
            "minecraft:emitter_rate_instant": {"num_particles": 1},
            "minecraft:emitter_lifetime_once": {"active_time": 0.01},
            "minecraft:emitter_shape_point": {},
            "minecraft:particle_lifetime_expression": {"max_lifetime": 0.4},
            "minecraft:particle_appearance_billboard": {"size": ["1.2 + v.particle_age * 3.0", "1.2 + v.particle_age * 3.0"], "facing_camera_mode": "rotate_xyz", "uv": uv("soft")},
            "minecraft:particle_appearance_tinting": {"color": [1.0, 0.15, 0.1, "0.8 * (1.0 - v.particle_age / v.particle_lifetime)"]},
        })
        eff("exhaust", "particles_blend", {
            "minecraft:emitter_rate_instant": {"num_particles": 2},
            "minecraft:emitter_lifetime_once": {"active_time": 0.05},
            "minecraft:emitter_shape_point": {"direction": ["math.random(-0.3,0.3)", 0.5, "math.random(-0.3,0.3)"]},
            "minecraft:particle_lifetime_expression": {"max_lifetime": "math.random(0.5, 0.9)"},
            "minecraft:particle_initial_speed": 0.6,
            "minecraft:particle_motion_dynamic": {"linear_drag_coefficient": 1.8, "linear_acceleration": [0, 0.5, 0]},
            "minecraft:particle_appearance_billboard": {"size": ["0.1 + v.particle_age * 0.4", "0.1 + v.particle_age * 0.4"], "facing_camera_mode": "rotate_xyz", "uv": uv("smoke0", (4, 6))},
            "minecraft:particle_appearance_tinting": {"color": [0.3, 0.3, 0.32, "0.6 * (1.0 - v.particle_age / v.particle_lifetime)"]},
            "minecraft:particle_appearance_lighting": {},
        })
        eff("ichor", "particles_alpha", {
            "minecraft:emitter_rate_instant": {"num_particles": "math.random_integer(5, 9)"},
            "minecraft:emitter_lifetime_once": {"active_time": 0.05},
            "minecraft:emitter_shape_sphere": {"radius": 0.1, "direction": "outwards"},
            "minecraft:particle_lifetime_expression": {"max_lifetime": "math.random(0.3, 0.7)"},
            "minecraft:particle_initial_speed": "math.random(1.0, 2.5)",
            "minecraft:particle_motion_dynamic": {"linear_acceleration": [0, -12, 0]},
            "minecraft:particle_motion_collision": {"collision_radius": 0.03, "expire_on_contact": True},
            "minecraft:particle_appearance_billboard": {"size": ["math.random(0.04, 0.08)", "math.random(0.04, 0.08)"], "facing_camera_mode": "rotate_xyz", "uv": uv("drop")},
            "minecraft:particle_appearance_tinting": {"color": [0.45, 0.7, 0.1, 1.0]},
            "minecraft:particle_appearance_lighting": {},
        })
        eff("sonic_ring", "particles_blend", {
            "minecraft:emitter_rate_instant": {"num_particles": 1},
            "minecraft:emitter_lifetime_once": {"active_time": 0.01},
            "minecraft:emitter_shape_point": {"direction": ["v.tracer.direction_x", "v.tracer.direction_y", "v.tracer.direction_z"]},
            "minecraft:particle_lifetime_expression": {"max_lifetime": 0.35},
            "minecraft:particle_initial_speed": "v.tracer.speed",
            "minecraft:particle_motion_dynamic": {},
            "minecraft:particle_appearance_billboard": {"size": ["0.4 + v.particle_age * 8.0", "0.4 + v.particle_age * 8.0"], "facing_camera_mode": "lookat_direction", "direction": {"mode": "derive_from_velocity", "min_speed_threshold": 0.01}, "uv": uv("ring")},
            "minecraft:particle_appearance_tinting": {"color": [0.7, 0.9, 1.0, "0.8 * (1.0 - v.particle_age / v.particle_lifetime)"]},
        })
        for pid, obj in P.items():
            wjson(f"{self.rp}/particles/arsenal/{pid}.json", obj)
        wpng(f"{self.rp}/textures/particle/arsenal_particles.png", tx.particle_atlas())
        self.particle_ids = [f"{NS}:{p}" for p in P]
        self.log(f"  particles: {len(P)}")

    # -------------------- サウンド --------------------
