"""
ARSENAL CORE — リグ計算とアニメーション生成

Bedrock のボーン変換を Blockbench と同じ規約で再現し、
「一人称／三人称で銃口が視線方向を向く」ための銃ボーンの回転・位置を逆算する。

規約（Blockbench の Bedrock 形式に準拠）
  ・ジオメトリの x は反転（bb_x = -bedrock_x）
  ・ボーン回転 (rx, ry, rz) → bb オイラー (-rx, -ry, rz)、順序 ZYX（R = Rz·Ry·Rx）
  ・アニメーション位置 (px, py, pz) → bb オフセット (-px, py, pz)
  ・一人称の腕ポーズは Bedrock Wiki の Attachable ガイド（rightArm 回転 [95,-45,115]、位置 [13.5,-10,12]）
  ・一人称カメラは bb 空間で +Z を向く（first_person.base_pose で頭が 180° 回るため）
"""
import math
import numpy as np


def Rx(a):
    a = math.radians(a); c, s = math.cos(a), math.sin(a)
    return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])


def Ry(a):
    a = math.radians(a); c, s = math.cos(a), math.sin(a)
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])


def Rz(a):
    a = math.radians(a); c, s = math.cos(a), math.sin(a)
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])


def rot_bedrock(r):
    """Bedrock の回転値 → bb 回転行列"""
    return Rz(r[2]) @ Ry(-r[1]) @ Rx(-r[0])


def euler_zyx(R):
    """R = Rz(z)·Ry(y)·Rx(x) を分解（度）"""
    sy = -R[2][0]
    sy = max(-1.0, min(1.0, sy))
    y = math.asin(sy)
    if abs(math.cos(y)) > 1e-6:
        x = math.atan2(R[2][1], R[2][2])
        z = math.atan2(R[1][0], R[0][0])
    else:
        x = math.atan2(-R[1][2], R[1][1])
        z = 0.0
    return math.degrees(x), math.degrees(y), math.degrees(z)


def bb_to_bedrock_rot(R):
    x, y, z = euler_zyx(R)
    return [round(-x, 3), round(-y, 3), round(z, 3)]


def bb_vec_to_bedrock_pos(v):
    return [round(-float(v[0]), 3), round(float(v[1]), 3), round(float(v[2]), 3)]


SKELETON = {
    "root": (None, (0, 0, 0)),
    "waist": ("root", (0, 12, 0)),
    "body": ("waist", (0, 24, 0)),
    "rightArm": ("body", (-5, 22, 0)),
    "rightItem": ("rightArm", (-6, 15, 1)),
}


def bb(p):
    return np.array([-p[0], p[1], p[2]], dtype=float)


def world(bone, anims):
    """ボーンのワールド変換 (R, t)。t はボーンピボットのワールド位置"""
    chain = []
    b = bone
    while b:
        chain.append(b)
        b = SKELETON[b][0]
    chain.reverse()
    R = np.eye(3)
    t = np.zeros(3)
    prev_piv = np.zeros(3)
    for name in chain:
        piv = bb(SKELETON[name][1])
        a = anims.get(name, {})
        pos = np.array(a.get("pos", (0, 0, 0)), dtype=float)
        pos_bb = np.array([-pos[0], pos[1], pos[2]])
        rot = a.get("rot", (0, 0, 0))
        local_t = piv - prev_piv + pos_bb
        t = t + R @ local_t
        R = R @ rot_bedrock(rot)
        prev_piv = piv
    return R, t


FP_GUIDE = {"rightArm": {"rot": (95, -45, 115), "pos": (13.5, -10, 12)}, "rightItem": {"pos": (0, 0, -1)}}
TP_AIM = {"rightArm": {"rot": (-90, 0, 0)}}

# 一人称カメラ（bb 空間）
CAM = np.array([0.0, 24.0, 0.0])
CAM_RIGHT = np.array([-1.0, 0.0, 0.0])
CAM_UP = np.array([0.0, 1.0, 0.0])
CAM_FWD = np.array([0.0, 0.0, 1.0])

# カテゴリ別の腰だめ位置補正（カメラ座標：右, 上, 前）
HIP_NUDGE = {
    "handgun": (-3.0, 1.0, -1.0),
    "smg": (-1.5, 0.5, 0.0),
    "assault": (-1.0, 0.0, 0.5),
    "battle": (-1.0, 0.0, 0.5),
    "dmr": (-1.0, 0.0, 0.5),
    "sniper": (-1.0, -0.3, 0.8),
    "shotgun": (-1.0, 0.0, 0.5),
    "lmg": (-0.5, -0.8, 0.5),
    "launcher": (-0.5, -0.3, 0.5),
    "special": (-1.0, 0.0, 0.5),
}


def solve(anims, R_des, w_des):
    R_ri, t_ri = world("rightItem", anims)
    R_g = R_ri.T @ R_des
    a = R_ri.T @ (w_des - t_ri)
    return bb_to_bedrock_rot(R_g), bb_vec_to_bedrock_pos(a)


def solve_tp():
    R_ri, t_ri = world("rightItem", TP_AIM)
    return solve(TP_AIM, np.eye(3), t_ri + np.array([0.0, 0.5, 0.0]))


def fp_hand():
    return world("rightItem", FP_GUIDE)[1]


def solve_fp(cat):
    R_des = Ry(180)
    hand = fp_hand()
    n = HIP_NUDGE.get(cat, (0, 0, 0))
    w = hand + CAM_RIGHT * n[0] + CAM_UP * n[1] + CAM_FWD * n[2]
    rot, pos = solve(FP_GUIDE, R_des, w)
    return rot, pos, w


def ads_arm_offset(g, cat, scoped):
    """一人称 ADS 時に腕（＝銃）を動かす量（body 空間の bb ベクトル → Bedrock アニメ位置）"""
    if scoped:
        return [0.0, -26.0, 0.0]
    _, _, w_hip = solve_fp(cat)
    rear_sight_f = g.rear if cat == "handgun" else max(g.rear, -6.0)
    z = max(8.0, 7.0 - rear_sight_f)
    z = min(z, 16.0)
    w_ads = CAM + np.array([0.0, -g.sight_y, z])
    d = w_ads - w_hip
    return bb_vec_to_bedrock_pos(d)


# ---------------------------------------------------------------------------
#  アニメーション JSON
# ---------------------------------------------------------------------------
def _v(x):
    return round(float(x), 3)


def attachable_animations(wid, g, cat, scoped):
    tp_rot, tp_pos = solve_tp()
    fp_rot, fp_pos, _ = solve_fp(cat)
    return {
        f"animation.arsenal.{wid}.tp": {
            "loop": True,
            "bones": {"arsenal_gun": {"rotation": tp_rot, "position": tp_pos}},
        },
        f"animation.arsenal.{wid}.fp": {
            "loop": True,
            "bones": {"arsenal_gun": {"rotation": fp_rot, "position": fp_pos}},
        },
    }


def ads_animation(wid, ads_off, seconds):
    """一人称 ADS：照準線（アイアンサイト／ドット）を画面中央へ。スクリプトが ADS 中だけ再生する"""
    dx, dy, dz = ads_off
    T = round(max(0.08, seconds), 3)
    fp = lambda x: f"variable.is_first_person ? {_v(x)} : 0.0"  # noqa: E731
    return {
        f"animation.arsenal.ads.{wid}": {
            "loop": "hold_on_last_frame",
            "animation_length": T,
            "bones": {"rightarm": {"position": {
                "0.0": [0, 0, 0],
                str(round(T * 0.6, 3)): [fp(dx * 0.85), fp(dy * 0.85), fp(dz * 0.85)],
                str(T): [fp(dx), fp(dy), fp(dz)],
            }}},
        }
    }


def ads_scope_animation():
    """倍率スコープ：覗いている間は銃を画面の下へ下ろす（全画面のスコープ表示と重ならないように）"""
    fp = lambda x: f"variable.is_first_person ? {_v(x)} : 0.0"  # noqa: E731
    return {
        "animation.arsenal.ads_scope": {
            "loop": "hold_on_last_frame",
            "animation_length": 0.15,
            "bones": {"rightarm": {"position": {"0.0": [0, 0, 0], "0.15": [0, fp(-26.0), fp(-4.0)]}}},
        }
    }


def hold_animation(wid, pose):
    """プレイヤーに再生する保持ポーズ（三人称の構え）。一人称の ADS は ads_animation が担当"""
    if pose == "pistol":
        left_rot = [
            "variable.is_first_person ? 0.0 : (q.is_swimming ? 0.0 : -88.0 + q.target_x_rotation - q.is_sneaking * 27.0 - this)",
            "variable.is_first_person ? 0.0 : (q.is_swimming ? 0.0 : 36.0 + math.clamp(q.target_y_rotation, -45.0, 5.0) - this)",
            "variable.is_first_person ? 0.0 : -this",
        ]
    else:
        left_rot = [
            "variable.is_first_person ? 0.0 : (q.is_swimming ? 0.0 : -93.0 + q.target_x_rotation - q.is_sneaking * 27.0 - this)",
            "variable.is_first_person ? 0.0 : (q.is_swimming ? 0.0 : 42.0 + math.clamp(q.target_y_rotation, -45.0, 5.0) - this)",
            "variable.is_first_person ? 0.0 : (q.is_sneaking * -15.0 - this)",
        ]
    right_rot = [
        "variable.is_first_person ? 0.0 : (q.is_swimming ? 0.0 : -90.0 + q.target_x_rotation - q.is_sneaking * 27.0 - this)",
        "variable.is_first_person ? 0.0 : (q.is_swimming ? 0.0 : math.clamp(q.target_y_rotation, -60.0, 45.0) - this)",
        "variable.is_first_person ? 0.0 : -this",
    ]
    return {
        f"animation.arsenal.hold.{wid}": {
            "loop": True,
            "bones": {
                "rightarm": {"rotation": right_rot},
                "leftarm": {"rotation": left_rot},
            },
        }
    }


def kick_animations():
    out = {}
    for name, k in (("light", 1.0), ("medium", 1.8), ("heavy", 3.0), ("massive", 4.6)):
        L = 0.06 + k * 0.03
        out[f"animation.arsenal.kick.{name}"] = {
            "animation_length": L,
            "bones": {
                "rightarm": {
                    "rotation": {
                        "0.0": [0, 0, 0],
                        str(round(L * 0.25, 3)): ["variable.is_first_person ? 0.0 : %s" % _v(-3.0 * k), 0, 0],
                        str(round(L, 3)): [0, 0, 0],
                    },
                    "position": {
                        "0.0": [0, 0, 0],
                        str(round(L * 0.25, 3)): [0, "variable.is_first_person ? %s : 0.0" % _v(0.35 * k), "variable.is_first_person ? %s : %s" % (_v(-0.9 * k), _v(0.5 * k))],
                        str(round(L, 3)): [0, 0, 0],
                    },
                },
                "leftarm": {
                    "rotation": {
                        "0.0": [0, 0, 0],
                        str(round(L * 0.25, 3)): ["variable.is_first_person ? 0.0 : %s" % _v(-3.0 * k), 0, 0],
                        str(round(L, 3)): [0, 0, 0],
                    }
                },
            },
        }
    return out


def reload_animation(ticks, style):
    """リロード動作。style: mag / shell / bolt / break / cell"""
    T = max(0.3, ticks / 20.0)
    a, b, c = round(T * 0.18, 3), round(T * 0.55, 3), round(T * 0.85, 3)
    fp_down = -3.5 if style != "shell" else -2.0
    rot_tp = -28.0 if style != "break" else -40.0
    right = {
        "rotation": {
            "0.0": [0, 0, 0],
            str(a): [f"variable.is_first_person ? 0.0 : {rot_tp}", 0, f"variable.is_first_person ? 0.0 : 12.0"],
            str(b): [f"variable.is_first_person ? 0.0 : {rot_tp * 0.8}", 0, f"variable.is_first_person ? 0.0 : 10.0"],
            str(c): [f"variable.is_first_person ? 0.0 : {rot_tp * 0.4}", 0, 0],
            str(round(T, 3)): [0, 0, 0],
        },
        "position": {
            "0.0": [0, 0, 0],
            str(a): ["variable.is_first_person ? 1.5 : 0.0", f"variable.is_first_person ? {fp_down} : 0.0", "variable.is_first_person ? -1.5 : 0.0"],
            str(b): ["variable.is_first_person ? 1.2 : 0.0", f"variable.is_first_person ? {fp_down * 0.9} : 0.0", "variable.is_first_person ? -1.2 : 0.0"],
            str(c): ["variable.is_first_person ? 0.3 : 0.0", f"variable.is_first_person ? {fp_down * 0.2} : 0.0", 0],
            str(round(T, 3)): [0, 0, 0],
        },
    }
    left = {
        "rotation": {
            "0.0": [0, 0, 0],
            str(a): ["variable.is_first_person ? 0.0 : 35.0", 0, "variable.is_first_person ? 0.0 : -10.0"],
            str(b): ["variable.is_first_person ? 0.0 : 10.0", 0, 0],
            str(c): ["variable.is_first_person ? 0.0 : 25.0", 0, 0],
            str(round(T, 3)): [0, 0, 0],
        }
    }
    return {"animation_length": T, "bones": {"rightarm": right, "leftarm": left}}


def misc_animations():
    return {
        "animation.arsenal.none": {"animation_length": 0.05, "bones": {"rightarm": {"rotation": [0, 0, 0]}}},
        "animation.arsenal.bolt": {
            "animation_length": 0.8,
            "bones": {"rightarm": {
                "position": {"0.0": [0, 0, 0], "0.2": ["variable.is_first_person ? -0.8 : 0.0", "variable.is_first_person ? -1.2 : 0.0", "variable.is_first_person ? -1.0 : 0.0"],
                             "0.5": ["variable.is_first_person ? -0.6 : 0.0", "variable.is_first_person ? -1.0 : 0.0", "variable.is_first_person ? -0.4 : 0.0"], "0.8": [0, 0, 0]},
                "rotation": {"0.0": [0, 0, 0], "0.25": ["variable.is_first_person ? 0.0 : -8.0", 0, "variable.is_first_person ? 0.0 : 8.0"], "0.8": [0, 0, 0]},
            }},
        },
        "animation.arsenal.pump": {
            "animation_length": 0.5,
            "bones": {"rightarm": {
                "position": {"0.0": [0, 0, 0], "0.15": [0, "variable.is_first_person ? -0.8 : 0.0", "variable.is_first_person ? -1.4 : 0.0"], "0.5": [0, 0, 0]},
            }, "leftarm": {"position": {"0.0": [0, 0, 0], "0.15": [0, 0, "variable.is_first_person ? 0.0 : 2.0"], "0.5": [0, 0, 0]}}},
        },
        "animation.arsenal.throw": {
            "animation_length": 0.45,
            "bones": {"rightarm": {
                "rotation": {"0.0": [0, 0, 0], "0.1": ["variable.is_first_person ? 0.0 : -150.0", 0, 0], "0.3": ["variable.is_first_person ? 0.0 : -40.0", 0, 0], "0.45": [0, 0, 0]},
                "position": {"0.0": [0, 0, 0], "0.1": [0, "variable.is_first_person ? -2.0 : 0.0", "variable.is_first_person ? -3.0 : 0.0"], "0.3": [0, "variable.is_first_person ? 1.0 : 0.0", "variable.is_first_person ? 3.0 : 0.0"], "0.45": [0, 0, 0]},
            }},
        },
        "animation.arsenal.inspect": {
            "animation_length": 1.6,
            "bones": {"rightarm": {
                "position": {"0.0": [0, 0, 0], "0.3": ["variable.is_first_person ? 3.0 : 0.0", "variable.is_first_person ? 1.5 : 0.0", "variable.is_first_person ? -1.0 : 0.0"], "1.2": ["variable.is_first_person ? 3.0 : 0.0", "variable.is_first_person ? 1.5 : 0.0", "variable.is_first_person ? -1.0 : 0.0"], "1.6": [0, 0, 0]},
            }},
        },
    }


# ---------------------------------------------------------------------------
#  レイダー用（クライアントエンティティ）アニメーション
# ---------------------------------------------------------------------------
def raider_animations():
    return {
        "animation.arsenal.raider.look": {
            "loop": True,
            "bones": {"head": {"rotation": ["q.target_x_rotation", "q.target_y_rotation", 0]}},
        },
        "animation.arsenal.raider.walk": {
            "loop": True,
            "bones": {
                "leftleg": {"rotation": ["math.cos(q.anim_time * 38.17 * 13.0) * 40.0 * math.min(1.0, q.modified_move_speed * 3.0)", 0, 0]},
                "rightleg": {"rotation": ["-math.cos(q.anim_time * 38.17 * 13.0) * 40.0 * math.min(1.0, q.modified_move_speed * 3.0)", 0, 0]},
            },
        },
        "animation.arsenal.raider.aim": {
            "loop": True,
            "bones": {
                "rightarm": {"rotation": ["-90.0 + q.target_x_rotation", "math.clamp(q.target_y_rotation, -60.0, 45.0)", 0]},
                "leftarm": {"rotation": ["-93.0 + q.target_x_rotation", "42.0 + math.clamp(q.target_y_rotation, -45.0, 5.0)", 0]},
            },
        },
        "animation.arsenal.raider.idle": {
            "loop": True,
            "bones": {
                "rightarm": {"rotation": ["-35.0 + math.sin(q.life_time * 60.0) * 2.0", -20.0, 0]},
                "leftarm": {"rotation": ["-40.0 + math.sin(q.life_time * 60.0) * 2.0", 35.0, 0]},
            },
        },
        "animation.arsenal.dummy.wobble": {
            "animation_length": 0.6,
            "bones": {"body": {"rotation": {"0.0": [0, 0, 0], "0.08": [-9.0, 0, 5.0], "0.22": [6.0, 0, -3.0], "0.4": [-2.5, 0, 1.2], "0.6": [0, 0, 0]}}},
        },
    }


# ---------------------------------------------------------------------------
#  2.0：一人称の位置調整・近接
# ---------------------------------------------------------------------------
FP_STEPS = (-2, -1, 0, 1, 2)
FP_STEP_PX = 0.9


def fp_step_name(n):
    return "0" if n == 0 else (f"p{n}" if n > 0 else f"m{-n}")


def fp_offset_animations():
    """個人設定「一人称の銃の位置（上下・前後 各 5 段階）」用。一人称のときだけ右腕（＝銃）と左腕を動かす。
    スクリプトが設定値に応じて animation.arsenal.fpoff.v<段階>_d<段階> を再生し続ける"""
    out = {}
    for v in FP_STEPS:
        for d in FP_STEPS:
            if v == 0 and d == 0:
                continue
            dy = v * FP_STEP_PX
            dz = d * FP_STEP_PX
            pos = [0, f"variable.is_first_person ? {_v(dy)} : 0.0", f"variable.is_first_person ? {_v(dz)} : 0.0"]
            out[f"animation.arsenal.fpoff.v{fp_step_name(v)}_d{fp_step_name(d)}"] = {
                "loop": True,
                "bones": {"rightarm": {"position": pos}, "leftarm": {"position": pos}},
            }
    return out


def melee_animations():
    fp = lambda x: f"variable.is_first_person ? {_v(x)} : 0.0"  # noqa: E731
    tp = lambda x: f"variable.is_first_person ? 0.0 : {_v(x)}"  # noqa: E731
    return {
        # 強攻撃（振りかぶって斬り下ろす）
        "animation.arsenal.melee.heavy": {
            "animation_length": 0.5,
            "bones": {"rightarm": {
                "rotation": {"0.0": [0, 0, 0], "0.15": [tp(-160.0), 0, tp(20.0)], "0.3": [tp(-20.0), 0, tp(-10.0)], "0.5": [0, 0, 0]},
                "position": {"0.0": [0, 0, 0], "0.15": [fp(1.0), fp(3.0), fp(-2.0)], "0.3": [fp(-1.0), fp(-2.5), fp(3.0)], "0.5": [0, 0, 0]},
            }},
        },
        # 刺突（ナイフ・銃剣）
        "animation.arsenal.melee.stab": {
            "animation_length": 0.3,
            "bones": {"rightarm": {
                "rotation": {"0.0": [0, 0, 0], "0.1": [tp(-100.0), 0, 0], "0.3": [0, 0, 0]},
                "position": {"0.0": [0, 0, 0], "0.1": [0, fp(0.5), fp(4.0)], "0.3": [0, 0, 0]},
            }},
        },
        # 銃床打撃（銃を持ったまま殴る）
        "animation.arsenal.melee.butt": {
            "animation_length": 0.35,
            "bones": {"rightarm": {
                "rotation": {"0.0": [0, 0, 0], "0.1": [tp(-60.0), tp(-30.0), 0], "0.35": [0, 0, 0]},
                "position": {"0.0": [0, 0, 0], "0.1": [fp(-2.0), fp(1.0), fp(3.0)], "0.35": [0, 0, 0]},
            }},
            "loop": False,
        },
    }
