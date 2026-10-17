"""
ARSENAL CORE — 3D モデル生成（2.0）：防具・敵・ボス・設置物・銃座・乗り物・補給箱
すべて 64x64 の素材アトラス（modelgen.MAT のタイル）を使い、Blockbench 互換の format 1.16.0 で出力する。

座標は Bedrock のモデル空間をそのまま使う（x = 左、y = 上、z = 後ろ。モデルの正面は -z）。
"""
import math
import random

from modelgen import Cube, Gun, cube_to_bedrock, TEX_SIZE, PLAYER_SKELETON


# ---------------------------------------------------------------------------
#  共通
# ---------------------------------------------------------------------------
class Model:
    """ボーンごとに Cube を集める入れ物"""

    def __init__(self, key):
        self.key = key
        self.bones = []  # (name, parent, pivot, [Cube])
        self._by = {}
        self.n = 0

    def bone(self, name, parent=None, pivot=(0, 0, 0)):
        if name not in self._by:
            b = {"name": name, "parent": parent, "pivot": list(pivot), "cubes": []}
            self.bones.append(b)
            self._by[name] = b
        return name

    def box(self, bone, x, y, z, sx, sy, sz, mat, rot=None, piv=None):
        """(x, y, z) は最小角。rot は Bedrock の回転（度）、piv は回転の中心（モデル座標）"""
        c = Cube(x, x + sx, y, y + sy, -(z + sz), -z, mat,
                 rot=rot, piv=((piv[0], piv[1], -piv[2]) if piv else None))
        self._by[bone]["cubes"].append(c)
        return c

    def cbox(self, bone, cx, cy, cz, sx, sy, sz, mat, rot=None, piv=None):
        """中心と大きさで置く"""
        return self.box(bone, cx - sx / 2, cy - sy / 2, cz - sz / 2, sx, sy, sz, mat, rot, piv)

    def all_cubes(self):
        out = []
        for b in self.bones:
            out.extend(b["cubes"])
        return out

    def geometry(self, ident, vb=(2, 3, 1.5)):
        bones = []
        for b in self.bones:
            bb = {"name": b["name"], "pivot": b["pivot"]}
            if b["parent"]:
                bb["parent"] = b["parent"]
            cubes = [cube_to_bedrock(c, (0, 0, 0), f"{self.key}:{b['name']}:{i}") for i, c in enumerate(b["cubes"])]
            if cubes:
                bb["cubes"] = cubes
            bones.append(bb)
        return {"format_version": "1.16.0", "minecraft:geometry": [{
            "description": {"identifier": ident, "texture_width": TEX_SIZE, "texture_height": TEX_SIZE,
                            "visible_bounds_width": vb[0], "visible_bounds_height": vb[1], "visible_bounds_offset": [0, vb[2], 0]},
            "bones": bones,
        }]}

    def as_gun(self):
        """アイコン描画（texgen の側面レンダラー）用に Gun に詰め替える"""
        g = Gun()
        g.cubes = self.all_cubes()
        return g


def _rng(key):
    return random.Random(key)


# ---------------------------------------------------------------------------
#  防具（プレイヤーに付くアタッチャブル。骨格はプレイヤーと同じ名前）
# ---------------------------------------------------------------------------
HEAD_Y = 24.0


def _armor_skeleton(m):
    for b in PLAYER_SKELETON:
        m.bone(b["name"], b.get("parent"), b["pivot"])


def helmet_model(aid, a):
    """ヘルメット。系統ごとに形を変え、段階が上がるほど装甲を足す"""
    m = Model(aid)
    _armor_skeleton(m)
    m.bone("arsenal_helm", "head", (0, HEAD_Y, 0))
    fam = a["family"]
    lv = a["level"]
    mdl = a.get("model", {})
    if mdl.get("kind") == "mask":
        # ガスマスク：顔の前面・フィルター缶・ベルト
        m.box("arsenal_helm", -3.6, 24.4, -4.6, 7.2, 5.2, 1.0, "rubber")
        m.box("arsenal_helm", -3.0, 27.0, -4.9, 2.6, 1.8, 0.4, "lens")
        m.box("arsenal_helm", 0.4, 27.0, -4.9, 2.6, 1.8, 0.4, "lens")
        m.box("arsenal_helm", -1.3, 23.4, -6.2, 2.6, 2.6, 1.8, "main_dark")
        m.box("arsenal_helm", -1.5, 23.2, -7.0, 3.0, 3.0, 0.8, "warning")
        m.box("arsenal_helm", -4.4, 27.2, -4.2, 8.8, 0.8, 8.6, "rubber")
        return m
    # 基本の帽体
    top = HEAD_Y + 8.0
    if fam == "light":
        m.box("arsenal_helm", -4.4, top - 3.2, -4.4, 8.8, 3.6, 8.8, "main")
        m.box("arsenal_helm", -4.6, top - 3.6, -4.9, 9.2, 0.6, 4.0, "main_dark")  # つば
        m.box("arsenal_helm", -3.0, top + 0.4, -3.0, 6.0, 0.4, 6.0, "main")
    elif fam == "standard":
        m.box("arsenal_helm", -4.6, top - 4.0, -4.6, 9.2, 4.6, 9.2, "main")
        m.box("arsenal_helm", -4.9, top - 4.4, -4.9, 9.8, 0.8, 9.8, "main_dark")  # 縁
        m.box("arsenal_helm", -3.6, top + 0.6, -3.6, 7.2, 0.6, 7.2, "main")
        # ゴーグル
        m.box("arsenal_helm", -4.0, top - 2.6, -5.1, 8.0, 1.4, 0.6, "lens")
        m.box("arsenal_helm", -4.7, top - 2.4, -4.7, 9.4, 1.0, 9.4, "rubber")
    elif fam == "heavy":
        m.box("arsenal_helm", -4.8, HEAD_Y - 0.4, -4.8, 9.6, 9.0, 9.6, "main")
        m.box("arsenal_helm", -4.2, HEAD_Y + 2.6, -5.3, 8.4, 3.0, 0.6, "lens")  # 防弾バイザー
        m.box("arsenal_helm", -4.9, HEAD_Y + 5.6, -5.2, 9.8, 0.8, 1.0, "main_dark")
        m.box("arsenal_helm", -3.6, top + 0.6, -3.6, 7.2, 0.8, 7.2, "main_dark")
        m.box("arsenal_helm", -5.1, HEAD_Y + 1.0, -2.0, 0.4, 4.0, 4.0, "metal_dark")
        m.box("arsenal_helm", 4.7, HEAD_Y + 1.0, -2.0, 0.4, 4.0, 4.0, "metal_dark")
    else:  # specops：ハイカット＋耳当て＋レール
        m.box("arsenal_helm", -4.5, top - 3.8, -4.5, 9.0, 4.4, 9.0, "main")
        m.box("arsenal_helm", -3.6, top + 0.6, -3.6, 7.2, 0.5, 7.2, "main")
        m.box("arsenal_helm", -5.2, HEAD_Y + 2.0, -1.8, 1.0, 3.2, 3.6, "rubber")
        m.box("arsenal_helm", 4.2, HEAD_Y + 2.0, -1.8, 1.0, 3.2, 3.6, "rubber")
        m.box("arsenal_helm", -4.8, top - 3.0, -2.0, 0.4, 1.0, 5.0, "rail")
        m.box("arsenal_helm", 4.4, top - 3.0, -2.0, 0.4, 1.0, 5.0, "rail")
        m.box("arsenal_helm", -1.2, top - 3.4, -5.0, 2.4, 1.6, 0.6, "metal_dark")  # マウント
    # 段階ごとの追加装甲
    if lv >= 2:
        m.box("arsenal_helm", -4.95, top - 2.2, 3.5, 9.9, 2.0, 1.4, "main_dark")  # 後頭部
        m.box("arsenal_helm", -1.0, top - 0.2, -4.8, 2.0, 0.8, 1.2, "accent")
    if lv >= 3:
        m.box("arsenal_helm", -5.1, top - 3.6, -2.8, 0.6, 3.0, 5.6, "metal_dark")
        m.box("arsenal_helm", 4.5, top - 3.6, -2.8, 0.6, 3.0, 5.6, "metal_dark")
        m.box("arsenal_helm", -4.0, top + 0.5, -1.0, 8.0, 0.8, 2.0, "accent")
    # 暗視ゴーグル
    if mdl.get("nvg"):
        m.box("arsenal_helm", -1.4, top - 3.2, -6.0, 2.8, 1.8, 1.4, "metal_dark")
        m.box("arsenal_helm", -3.2, top - 4.8, -7.2, 2.4, 2.4, 2.6, "main_dark")
        m.box("arsenal_helm", 0.8, top - 4.8, -7.2, 2.4, 2.4, 2.6, "main_dark")
        m.box("arsenal_helm", -2.9, top - 4.5, -7.4, 1.8, 1.8, 0.3, "glow")
        m.box("arsenal_helm", 1.1, top - 4.5, -7.4, 1.8, 1.8, 0.3, "glow")
        m.box("arsenal_helm", -2.0, top - 2.6, 4.2, 4.0, 2.2, 1.4, "rubber")  # 電池
    return m


def vest_model(aid, a):
    """ボディアーマー（プレートキャリア）。重装は肩当て、特殊部隊は無線機を付ける"""
    m = Model(aid)
    _armor_skeleton(m)
    m.bone("arsenal_vest", "body", (0, 24, 0))
    m.bone("arsenal_rpad", "rightArm", (-5, 22, 0))
    m.bone("arsenal_lpad", "leftArm", (5, 22, 0))
    fam = a["family"]
    lv = a["level"]
    mdl = a.get("model", {})
    if mdl.get("kind") == "ghillie":
        rng = _rng(aid)
        m.box("arsenal_vest", -4.4, 12.0, -2.4, 8.8, 12.4, 4.8, "main")
        for i in range(34):
            x = rng.uniform(-4.6, 3.6)
            y = rng.uniform(11.0, 23.5)
            z = rng.choice((-2.9, 2.2))
            m.box("arsenal_vest", x, y, z, rng.uniform(0.6, 1.4), rng.uniform(1.2, 3.0), 0.7, rng.choice(("main", "main_dark", "furniture", "accent")))
        for bone, x0 in (("arsenal_rpad", -8.5), ("arsenal_lpad", 3.5)):
            m.box(bone, x0, 11.0, -2.5, 5.0, 12.5, 5.0, "main")
            for i in range(10):
                m.box(bone, x0 + rng.uniform(-0.4, 4.0), rng.uniform(10.5, 22.0), rng.choice((-2.9, 2.3)), 1.0, rng.uniform(1.5, 2.5), 0.6, rng.choice(("main_dark", "furniture")))
        return m
    thick = {"light": 0.9, "standard": 1.2, "heavy": 1.6, "specops": 1.1}[fam]
    # 前後のプレート
    m.box("arsenal_vest", -4.3, 14.0, -2.2 - thick, 8.6, 9.6, thick, "main")
    m.box("arsenal_vest", -4.3, 14.0, 2.2, 8.6, 9.6, thick, "main")
    # 脇のカマーバンド
    m.box("arsenal_vest", -4.5, 14.0, -2.3, 0.5, 5.0, 4.6, "main_dark")
    m.box("arsenal_vest", 4.0, 14.0, -2.3, 0.5, 5.0, 4.6, "main_dark")
    # 肩ベルト
    m.box("arsenal_vest", -3.6, 23.4, -2.4, 2.0, 0.7, 4.8, "main_dark")
    m.box("arsenal_vest", 1.6, 23.4, -2.4, 2.0, 0.7, 4.8, "main_dark")
    # マガジンポーチ
    pouches = 3 if fam != "light" else 2
    for i in range(pouches):
        x = -3.6 + i * (7.2 / pouches)
        m.box("arsenal_vest", x + 0.2, 14.2, -3.4 - thick, 7.2 / pouches - 0.4, 3.4, 1.2, "furniture")
        m.box("arsenal_vest", x + 0.3, 17.4, -3.5 - thick, 7.2 / pouches - 0.6, 0.6, 1.3, "main_dark")
    m.box("arsenal_vest", -3.0, 20.6, -2.4 - thick, 6.0, 0.5, 0.3, "accent")
    if fam == "heavy":
        # 襟と肩当て
        m.box("arsenal_vest", -4.6, 23.0, -2.8, 9.2, 1.4, 5.6, "main")
        m.box("arsenal_rpad", -9.0, 18.0, -2.6, 5.2, 4.8, 5.2, "main")
        m.box("arsenal_lpad", 3.8, 18.0, -2.6, 5.2, 4.8, 5.2, "main")
        m.box("arsenal_vest", -4.4, 11.2, -3.0, 8.8, 2.8, 1.0, "main_dark")  # 股当て
    elif fam == "specops":
        m.box("arsenal_vest", 1.0, 16.0, 2.2 + thick, 3.0, 5.0, 1.6, "main_dark")  # 無線機
        m.box("arsenal_vest", 2.4, 21.0, 2.6 + thick, 0.4, 6.0, 0.4, "rubber")      # アンテナ
        m.box("arsenal_vest", -4.0, 18.6, -2.9 - thick, 2.6, 2.0, 0.8, "warning")  # IR パッチ
    if lv >= 2:
        m.box("arsenal_vest", -2.4, 15.0, 3.2 + thick * 0.5, 4.8, 4.4, 1.4, "furniture")  # 背面ポーチ
    if lv >= 3:
        m.box("arsenal_vest", -4.6, 21.2, -2.6 - thick, 9.2, 1.0, 0.6, "metal_dark")
        m.box("arsenal_rpad", -8.8, 20.0, -2.4, 4.6, 2.6, 4.8, "main_dark")
        m.box("arsenal_lpad", 4.2, 20.0, -2.4, 4.6, 2.6, 4.8, "main_dark")
    return m


def armor_model(aid, a):
    return helmet_model(aid, a) if a["slot"] == "head" else vest_model(aid, a)


# ---------------------------------------------------------------------------
#  人型（ロボット・変異体）：レイダーと同じ骨格名にして、レイダーのアニメーションをそのまま使う
# ---------------------------------------------------------------------------
def _humanoid_bones(m, scale=1.0):
    s = scale
    m.bone("root", None, (0, 0, 0))
    m.bone("waist", "root", (0, 12 * s, 0))
    m.bone("body", "waist", (0, 24 * s, 0))
    m.bone("head", "body", (0, 24 * s, 0))
    m.bone("leftArm", "body", (5 * s, 22 * s, 0))
    m.bone("leftItem", "leftArm", (6 * s, 15 * s, 1 * s))
    m.bone("rightArm", "body", (-5 * s, 22 * s, 0))
    m.bone("rightItem", "rightArm", (-6 * s, 15 * s, 1 * s))
    m.bone("leftLeg", "root", (1.9 * s, 12 * s, 0))
    m.bone("rightLeg", "root", (-1.9 * s, 12 * s, 0))


def robot_model(key, heavy=False):
    """レギオン歩兵ロボット：角ばった装甲・単眼・背中の放熱板"""
    m = Model(key)
    _humanoid_bones(m)
    m.box("body", -4.2, 12.5, -2.4, 8.4, 11.5, 4.8, "main")
    m.box("body", -3.6, 17.0, -2.9, 7.2, 6.4, 0.6, "main_dark")
    m.box("body", -1.2, 19.0, -3.1, 2.4, 2.4, 0.3, "glow")  # 胸の動力炉
    m.box("body", -3.0, 14.0, 2.4, 6.0, 8.0, 1.6, "metal_dark")  # 背面
    for i in range(3):
        m.box("body", -2.6 + i * 2.2, 22.0, 2.6, 1.0, 3.0, 1.0, "metal_light")
    m.box("head", -3.2, 24.0, -3.4, 6.4, 5.6, 6.4, "main")
    m.box("head", -2.6, 26.2, -3.8, 5.2, 1.6, 0.5, "main_dark")
    m.box("head", -0.9, 26.5, -4.0, 1.8, 1.0, 0.3, "glow")  # 単眼
    m.box("head", 2.6, 28.0, -0.6, 0.6, 3.0, 0.6, "metal_light")  # アンテナ
    for bone, x0 in (("rightArm", -8.0), ("leftArm", 4.0)):
        m.box(bone, x0, 12.0, -2.0, 4.0, 12.0, 4.0, "metal_dark")
        m.box(bone, x0 - 0.4, 19.0, -2.4, 4.8, 5.0, 4.8, "main")
    for bone, x0 in (("rightLeg", -3.9), ("leftLeg", -0.1)):
        m.box(bone, x0, 0.0, -2.2, 4.0, 12.0, 4.4, "metal_dark")
        m.box(bone, x0 - 0.2, 4.0, -2.6, 4.4, 4.0, 1.0, "main")
        m.box(bone, x0 - 0.2, 0.0, -3.0, 4.4, 1.4, 5.2, "main_dark")
    return m


def shield_bot_model(key):
    """シールド兵：大型の盾を左腕に持つ重装ロボット"""
    m = robot_model(key)
    m.bone("shield", "leftArm", (5, 22, 0))
    m.box("shield", 5.0, 4.0, -9.0, 1.2, 20.0, 12.0, "main")
    m.box("shield", 5.1, 16.0, -7.0, 1.2, 3.0, 8.0, "lens")  # 覗き窓
    m.box("shield", 4.8, 5.0, -9.4, 1.6, 1.0, 12.8, "warning")
    m.box("shield", 4.8, 22.6, -9.4, 1.6, 1.0, 12.8, "warning")
    return m


def mortar_bot_model(key):
    """迫撃砲ロボ：4 本脚の台車に砲身を背負う"""
    m = Model(key)
    m.bone("root", None, (0, 0, 0))
    m.bone("body", "root", (0, 10, 0))
    m.bone("head", "body", (0, 16, -4))
    m.bone("tube", "body", (0, 16, 2))
    for i, (x, z) in enumerate(((-5, -5), (3, -5), (-5, 3), (3, 3))):
        name = f"leg{i}"
        m.bone(name, "root", (x + 1, 10, z + 1))
        m.box(name, x, 0, z, 2, 10, 2, "metal_dark")
        m.box(name, x - 0.5, 0, z - 0.5, 3, 1.2, 3, "main_dark")
    m.box("body", -6.0, 9.0, -6.0, 12.0, 6.0, 12.0, "main")
    m.box("body", -5.0, 15.0, -5.0, 10.0, 1.2, 10.0, "main_dark")
    m.box("head", -2.5, 11.0, -8.6, 5.0, 3.6, 3.0, "main_dark")
    m.box("head", -1.0, 12.2, -8.9, 2.0, 1.0, 0.4, "glow")
    m.box("tube", -1.8, 15.5, -1.0, 3.6, 3.6, 12.0, "metal_dark", rot=(-50, 0, 0), piv=(0, 16, 2))
    m.box("tube", -2.1, 15.2, 9.0, 4.2, 4.2, 1.6, "main", rot=(-50, 0, 0), piv=(0, 16, 2))
    m.box("body", 3.0, 15.0, 1.0, 2.6, 2.6, 4.0, "warning")  # 砲弾ラック
    return m


def drone_model(key, recon=False):
    """偵察ドローン（敵）／偵察ドローン（プレイヤーの設置物）：4 ローター"""
    m = Model(key)
    m.bone("root", None, (0, 0, 0))
    m.bone("body", "root", (0, 4, 0))
    m.box("body", -3.0, 2.0, -3.0, 6.0, 2.4, 6.0, "main")
    m.box("body", -1.0, 1.0, -3.6, 2.0, 1.6, 1.4, "main_dark")
    m.box("body", -0.5, 1.3, -3.8, 1.0, 1.0, 0.3, "lens" if recon else "glow")
    if not recon:
        m.box("body", -0.5, 0.2, -2.0, 1.0, 1.2, 4.0, "metal_dark")  # 銃身
    for i, (x, z) in enumerate(((-6, -6), (4, -6), (-6, 4), (4, 4))):
        arm = f"arm{i}"
        m.bone(arm, "body", (x + 1, 3, z + 1))
        m.box(arm, min(x + 1, 0), 3.0, min(z + 1, 0) + (0.4 if z > 0 else 0), abs(x + 1), 0.6, 0.6, "metal_dark")
        rot = f"rotor{i}"
        m.bone(rot, "body", (x + 1, 4, z + 1))
        m.box(rot, x - 1.0, 4.0, z + 0.7, 4.0, 0.2, 0.6, "metal_light")
        m.box(rot, x + 0.7, 4.0, z - 1.0, 0.6, 0.2, 4.0, "metal_light")
        m.box(arm, x + 0.3, 3.0, z + 0.3, 1.4, 1.2, 1.4, "main_dark")
    return m


def dog_model(key):
    """レイダーの猟犬"""
    m = Model(key)
    m.bone("root", None, (0, 0, 0))
    m.bone("body", "root", (0, 8, 0))
    m.bone("head", "body", (0, 10, -5))
    m.bone("tail", "body", (0, 10, 5))
    m.box("body", -2.5, 6.0, -5.0, 5.0, 5.0, 10.0, "main")
    m.box("body", -2.7, 8.5, -5.2, 5.4, 2.8, 4.0, "main_dark")  # 首輪・ハーネス
    m.box("body", -2.8, 7.0, -1.0, 5.6, 3.6, 3.0, "furniture")
    m.box("head", -2.0, 8.0, -9.0, 4.0, 4.0, 4.0, "main")
    m.box("head", -1.2, 8.0, -11.0, 2.4, 2.2, 2.0, "main_dark")  # 鼻先
    m.box("head", -2.0, 12.0, -7.0, 1.2, 1.6, 1.0, "main_dark")
    m.box("head", 0.8, 12.0, -7.0, 1.2, 1.6, 1.0, "main_dark")
    m.box("head", -1.6, 10.4, -9.1, 0.8, 0.6, 0.2, "warning")
    m.box("head", 0.8, 10.4, -9.1, 0.8, 0.6, 0.2, "warning")
    m.box("tail", -0.5, 9.0, 5.0, 1.0, 1.0, 4.0, "main", rot=(30, 0, 0), piv=(0, 10, 5))
    for i, (x, z) in enumerate(((-2.3, -4.2), (0.7, -4.2), (-2.3, 2.6), (0.7, 2.6))):
        leg = ("legFL", "legFR", "legBL", "legBR")[i]
        m.bone(leg, "root", (x + 0.8, 6, z + 0.8))
        m.box(leg, x, 0, z, 1.6, 6.5, 1.6, "main")
    return m


def hollow_model(key, kind="runner"):
    """変異体。runner は細身、bloater は膨れた腹、brute は巨大な腕"""
    m = Model(key)
    _humanoid_bones(m)
    if kind == "bloater":
        m.box("body", -5.5, 11.0, -4.5, 11.0, 12.0, 9.0, "main")
        rng = _rng(key)
        for i in range(8):
            m.box("body", rng.uniform(-5.8, 4.0), rng.uniform(11.5, 21.0), rng.choice((-4.9, 3.9)), rng.uniform(1.2, 2.4), rng.uniform(1.2, 2.4), 1.0, "glow")
        m.box("head", -3.5, 23.0, -3.8, 7.0, 6.5, 7.0, "main_dark")
        m.box("head", -2.4, 25.0, -4.0, 1.2, 1.2, 0.3, "warning")
        m.box("head", 1.2, 25.0, -4.0, 1.2, 1.2, 0.3, "warning")
        for bone, x0 in (("rightArm", -9.0), ("leftArm", 5.0)):
            m.box(bone, x0, 12.0, -2.0, 4.0, 11.0, 4.0, "main")
        for bone, x0 in (("rightLeg", -4.2), ("leftLeg", 0.2)):
            m.box(bone, x0, 0.0, -2.2, 4.0, 11.0, 4.4, "main_dark")
        return m
    if kind == "brute":
        m.box("body", -6.0, 12.0, -3.5, 12.0, 13.0, 7.0, "main")
        m.box("body", -5.0, 16.0, -4.2, 10.0, 7.0, 0.8, "metal_dark")  # 甲殻
        m.box("body", -5.6, 24.0, 0.0, 11.2, 3.0, 4.0, "main_dark")  # 盛り上がった背
        m.box("head", -3.2, 22.5, -5.0, 6.4, 6.0, 6.0, "main_dark")
        m.box("head", -2.4, 24.6, -5.3, 1.4, 1.0, 0.4, "warning")
        m.box("head", 1.0, 24.6, -5.3, 1.4, 1.0, 0.4, "warning")
        for bone, x0 in (("rightArm", -11.0), ("leftArm", 5.0)):
            m.box(bone, x0, 6.0, -3.0, 6.0, 18.0, 6.0, "main")
            m.box(bone, x0 - 0.3, 5.0, -3.3, 6.6, 5.0, 6.6, "metal_dark")  # 骨の拳
        for bone, x0 in (("rightLeg", -4.6), ("leftLeg", 0.6)):
            m.box(bone, x0, 0.0, -2.5, 4.0, 12.0, 5.0, "main_dark")
        return m
    # runner
    m.box("body", -3.6, 12.0, -1.8, 7.2, 12.0, 3.6, "main")
    m.box("body", -3.8, 18.0, -2.0, 7.6, 1.0, 4.0, "main_dark")  # あばら
    m.box("body", -3.8, 15.5, -2.0, 7.6, 1.0, 4.0, "main_dark")
    m.box("head", -3.2, 24.0, -3.2, 6.4, 7.0, 6.4, "main")
    m.box("head", -2.4, 27.0, -3.5, 1.4, 1.2, 0.4, "glow")
    m.box("head", 1.0, 27.0, -3.5, 1.4, 1.2, 0.4, "glow")
    m.box("head", -2.0, 24.6, -3.6, 4.0, 1.2, 0.4, "main_dark")  # 口
    for bone, x0 in (("rightArm", -7.0), ("leftArm", 4.0)):
        m.box(bone, x0, 10.0, -1.5, 3.0, 14.0, 3.0, "main")
        m.box(bone, x0 - 0.2, 9.0, -1.8, 3.4, 1.4, 3.6, "metal_light")  # 爪
    for bone, x0 in (("rightLeg", -3.4), ("leftLeg", 0.4)):
        m.box(bone, x0, 0.0, -1.5, 3.0, 12.0, 3.0, "main_dark")
    return m


def juggernaut_model(key):
    """ジャガーノート・マーク II：巨大な二足歩行兵器。左右のミサイルポッドと胸部装甲は壊せる"""
    m = Model(key)
    S = 1.6
    _humanoid_bones(m, S)
    m.bone("left_pod", "body", (8 * S, 24 * S, 0))
    m.bone("right_pod", "body", (-8 * S, 24 * S, 0))
    m.bone("core", "body", (0, 20 * S, -3 * S))
    m.box("body", -6.5 * S, 12 * S, -3.5 * S, 13 * S, 13 * S, 7 * S, "main")
    m.box("body", -5.5 * S, 14 * S, 3.5 * S, 11 * S, 9 * S, 2 * S, "metal_dark")
    m.box("core", -4.5 * S, 15 * S, -4.6 * S, 9 * S, 8 * S, 1.2 * S, "main_dark")
    m.box("core", -1.5 * S, 18 * S, -4.9 * S, 3 * S, 3 * S, 0.4 * S, "glow")
    m.box("head", -3 * S, 24.5 * S, -4.5 * S, 6 * S, 4.5 * S, 6 * S, "main")
    m.box("head", -2.4 * S, 26 * S, -4.9 * S, 4.8 * S, 1.2 * S, 0.5 * S, "glow")
    for pod, x0 in (("left_pod", 6.4), ("right_pod", -11.4)):
        m.box(pod, x0 * S, 22 * S, -3 * S, 5 * S, 5 * S, 6 * S, "main_dark")
        for i in range(2):
            for j in range(2):
                m.box(pod, (x0 + 0.6 + i * 2.2) * S, (22.6 + j * 2.2) * S, -3.3 * S, 1.6 * S, 1.6 * S, 0.4 * S, "warning")
    for bone, x0 in (("rightArm", -10.5), ("leftArm", 6.5)):
        m.box(bone, x0 * S, 8 * S, -2.5 * S, 4 * S, 15 * S, 5 * S, "metal_dark")
        m.box(bone, (x0 - 0.5) * S, 18 * S, -3 * S, 5 * S, 6 * S, 6 * S, "main")
    # 右腕のガトリング
    m.box("rightArm", -10 * S, 7 * S, -10 * S, 3 * S, 3 * S, 9 * S, "metal_dark")
    m.box("rightArm", -10.3 * S, 6.7 * S, -11 * S, 3.6 * S, 3.6 * S, 1 * S, "main_dark")
    for bone, x0 in (("rightLeg", -5.5), ("leftLeg", 0.5)):
        m.box(bone, x0 * S, 0, -3 * S, 5 * S, 12 * S, 6 * S, "main")
        m.box(bone, (x0 - 0.5) * S, 0, -4.5 * S, 6 * S, 2 * S, 8 * S, "main_dark")
    return m


# ---------------------------------------------------------------------------
#  設置物・銃座・乗り物
# ---------------------------------------------------------------------------
def sentry_model(key):
    m = Model(key)
    m.bone("root", None, (0, 0, 0))
    m.bone("base", "root", (0, 0, 0))
    m.bone("head", "base", (0, 10, 0))
    for i in range(3):
        a = math.radians(i * 120)
        x, z = math.sin(a) * 4.5, math.cos(a) * 4.5
        m.box("base", x - 0.5, 0, z - 0.5, 1.0, 9.0, 1.0, "metal_dark", rot=(0, 0, 0))
        m.box("base", x - 1.0, 0, z - 1.0, 2.0, 0.6, 2.0, "rubber")
    m.box("base", -2.0, 7.5, -2.0, 4.0, 2.5, 4.0, "main_dark")
    m.box("head", -3.0, 10.0, -3.5, 6.0, 5.0, 7.0, "main")
    m.box("head", -2.4, 12.0, -3.9, 4.8, 1.6, 0.5, "lens")
    m.box("head", -0.7, 11.2, -12.0, 1.4, 1.4, 8.6, "metal_dark")
    m.box("head", -1.0, 10.9, -12.6, 2.0, 2.0, 0.8, "main_dark")
    m.box("head", 3.0, 10.4, -2.0, 2.4, 3.6, 4.0, "mag")  # 弾倉
    m.box("head", -3.2, 14.9, -1.0, 6.4, 0.5, 3.0, "accent")
    return m


def shield_wall_model(key):
    m = Model(key)
    m.bone("root", None, (0, 0, 0))
    m.box("root", -12.0, 0.0, -1.0, 24.0, 22.0, 2.0, "main")
    m.box("root", -12.4, 0.0, -1.4, 0.8, 22.4, 2.8, "metal_dark")
    m.box("root", 11.6, 0.0, -1.4, 0.8, 22.4, 2.8, "metal_dark")
    m.box("root", -12.4, 21.8, -1.4, 24.8, 0.8, 2.8, "metal_dark")
    m.box("root", -4.0, 14.0, -1.3, 8.0, 3.0, 2.6, "lens")
    m.box("root", -10.0, 4.0, -1.2, 20.0, 1.0, 2.4, "warning")
    m.box("root", -11.0, 0.0, 1.0, 2.0, 6.0, 6.0, "metal_dark", rot=(-30, 0, 0), piv=(0, 6, 1))
    m.box("root", 9.0, 0.0, 1.0, 2.0, 6.0, 6.0, "metal_dark", rot=(-30, 0, 0), piv=(0, 6, 1))
    return m


def claymore_model(key):
    m = Model(key)
    m.bone("root", None, (0, 0, 0))
    m.box("root", -3.5, 1.5, -0.8, 7.0, 4.0, 1.6, "main")
    m.box("root", -3.2, 5.5, -0.5, 6.4, 0.5, 1.0, "main_dark")
    m.box("root", -0.4, 6.0, -0.2, 0.8, 0.8, 0.4, "glow")
    for x in (-3.0, 2.4):
        m.box("root", x, 0.0, -0.6, 0.6, 1.8, 0.6, "metal_dark", rot=(20, 0, 0), piv=(x, 1.5, 0))
        m.box("root", x, 0.0, 0.2, 0.6, 1.8, 0.6, "metal_dark", rot=(-20, 0, 0), piv=(x, 1.5, 0))
    return m


def station_model(key, med=False):
    m = Model(key)
    m.bone("root", None, (0, 0, 0))
    m.bone("lid", "root", (0, 10, 5))
    m.box("root", -7.0, 0.0, -5.0, 14.0, 10.0, 10.0, "white" if med else "main")
    m.box("root", -7.3, 0.0, -5.3, 14.6, 1.0, 10.6, "metal_dark")
    m.box("root", -7.3, 4.5, -5.3, 14.6, 0.8, 10.6, "main_dark")
    m.box("lid", -7.2, 10.0, -5.2, 14.4, 2.0, 10.4, "main_dark" if not med else "white")
    if med:
        m.box("root", -1.0, 3.0, -5.4, 2.0, 6.0, 0.4, "warning")
        m.box("root", -3.0, 5.0, -5.4, 6.0, 2.0, 0.4, "warning")
        m.box("lid", -1.0, 12.0, -1.0, 2.0, 1.5, 2.0, "glow")
    else:
        for i in range(4):
            m.box("lid", -5.5 + i * 3.0, 12.0, -2.0, 1.4, 2.4, 1.4, "brass")
        m.box("root", -6.0, 6.0, -5.4, 12.0, 2.0, 0.4, "warning")
    return m


def mortar_emplacement_model(key):
    m = Model(key)
    m.bone("root", None, (0, 0, 0))
    m.bone("tube", "root", (0, 2, 2))
    m.box("root", -6.0, 0.0, -1.0, 12.0, 1.4, 8.0, "metal_dark")
    m.box("root", -5.0, 1.4, 0.0, 10.0, 0.6, 6.0, "main_dark")
    m.box("tube", -1.8, 2.0, -12.0, 3.6, 3.6, 16.0, "main", rot=(-55, 0, 0), piv=(0, 2, 2))
    m.box("tube", -2.1, 1.7, -13.0, 4.2, 4.2, 1.4, "metal_dark", rot=(-55, 0, 0), piv=(0, 2, 2))
    m.box("root", -3.2, 0.0, -9.0, 0.8, 10.0, 0.8, "metal_dark", rot=(0, 0, 18), piv=(-3, 0, -9))
    m.box("root", 2.4, 0.0, -9.0, 0.8, 10.0, 0.8, "metal_dark", rot=(0, 0, -18), piv=(3, 0, -9))
    m.box("root", -3.0, 8.0, -9.2, 6.0, 1.0, 1.2, "main_dark")
    m.box("root", 3.0, 7.0, -8.0, 2.0, 2.0, 2.0, "lens")  # 照準器
    return m


def _sandbags(m, bone, r=12, h=2):
    rng = _rng(m.key + "sb")
    for layer in range(h):
        n = 10
        for i in range(n):
            a = math.radians(-100 + i * 200 / (n - 1))
            x, z = math.sin(a) * r, -math.cos(a) * r
            m.cbox(bone, x, 1.5 + layer * 3.0, z, 7.0, 3.0, 4.0, rng.choice(("furniture", "main", "furniture")), rot=(0, -math.degrees(a), 0), piv=(x, 1.5 + layer * 3.0, z))


def hmg_nest_model(key):
    m = Model(key)
    m.bone("root", None, (0, 0, 0))
    m.bone("bags", "root", (0, 0, 0))
    m.bone("mount", "root", (0, 8, -6))
    m.bone("gun", "mount", (0, 14, -6))
    _sandbags(m, "bags", r=13, h=2)
    m.box("mount", -0.8, 0.0, -6.8, 1.6, 13.0, 1.6, "metal_dark")
    m.box("mount", -4.0, 0.0, -10.0, 8.0, 1.0, 8.0, "metal_dark")
    m.box("gun", -2.0, 12.5, -12.0, 4.0, 4.0, 12.0, "main")
    m.box("gun", -0.8, 13.7, -30.0, 1.6, 1.6, 18.0, "metal_dark")
    m.box("gun", -1.4, 13.1, -26.0, 2.8, 2.8, 8.0, "main_dark")
    m.box("gun", -1.6, 13.0, -31.0, 3.2, 3.2, 1.2, "metal_light")
    m.box("gun", 2.0, 11.0, -9.0, 3.0, 4.0, 5.0, "mag")
    m.box("gun", -2.4, 12.0, -0.5, 1.2, 4.0, 1.2, "grip")
    m.box("gun", 1.2, 12.0, -0.5, 1.2, 4.0, 1.2, "grip")
    m.box("gun", -1.2, 16.5, -8.0, 2.4, 1.8, 1.0, "main_dark")
    return m


def aa_gun_model(key):
    m = Model(key)
    m.bone("root", None, (0, 0, 0))
    m.bone("turret", "root", (0, 6, 0))
    m.bone("guns", "turret", (0, 16, -2))
    m.box("root", -9.0, 0.0, -9.0, 18.0, 3.0, 18.0, "metal_dark")
    m.box("root", -7.0, 3.0, -7.0, 14.0, 3.0, 14.0, "main_dark")
    m.box("turret", -6.0, 6.0, -5.0, 12.0, 8.0, 10.0, "main")
    m.box("turret", -8.0, 6.0, -1.0, 2.0, 12.0, 4.0, "main_dark")
    m.box("turret", 6.0, 6.0, -1.0, 2.0, 12.0, 4.0, "main_dark")
    m.box("turret", -2.0, 6.0, 5.0, 4.0, 6.0, 4.0, "rubber")  # 座席
    for x in (-5.0, 3.0):
        m.box("guns", x, 14.5, -30.0, 2.0, 2.0, 26.0, "metal_dark")
        m.box("guns", x - 0.6, 13.9, -12.0, 3.2, 3.2, 10.0, "main")
        m.box("guns", x - 0.4, 14.1, -31.0, 2.8, 2.8, 1.4, "warning")
    m.box("guns", -3.0, 13.0, -6.0, 6.0, 5.0, 8.0, "main_dark")
    m.box("guns", -1.0, 18.0, -4.0, 2.0, 3.0, 2.0, "lens")
    return m


def at_post_model(key):
    m = Model(key)
    m.bone("root", None, (0, 0, 0))
    m.bone("tube", "root", (0, 14, -2))
    for i in range(3):
        a = math.radians(i * 120 + 60)
        x, z = math.sin(a) * 6.0, math.cos(a) * 6.0
        m.box("root", x - 0.5, 0, z - 0.5, 1.0, 12.0, 1.0, "metal_dark")
    m.box("root", -2.5, 10.0, -2.5, 5.0, 3.0, 5.0, "main_dark")
    m.box("tube", -2.5, 12.5, -22.0, 5.0, 5.0, 30.0, "main")
    m.box("tube", -2.9, 12.1, -23.0, 5.8, 5.8, 1.6, "warning")
    m.box("tube", -2.9, 12.1, 7.0, 5.8, 5.8, 1.6, "main_dark")
    m.box("tube", 2.5, 15.5, -6.0, 3.0, 3.0, 6.0, "main_dark")  # 照準装置
    m.box("tube", 5.4, 16.0, -6.1, 0.3, 2.0, 2.0, "lens")
    m.box("tube", -1.0, 8.0, 0.0, 2.0, 4.5, 1.6, "grip")
    return m


def buggy_model(key):
    """軽装甲バギー：車体・ロールケージ・4 輪（回転ボーン）・後部の機関銃座"""
    m = Model(key)
    m.bone("root", None, (0, 0, 0))
    m.bone("chassis", "root", (0, 8, 0))
    m.bone("gun", "chassis", (0, 30, 14))
    wheels = (("wheel_fl", -13, -16), ("wheel_fr", 13, -16), ("wheel_bl", -13, 16), ("wheel_br", 13, 16))
    for name, x, z in wheels:
        m.bone(name, "root", (x, 6, z))
        m.box(name, x - 2.5, 0.0, z - 6.0, 5.0, 12.0, 12.0, "rubber")
        m.box(name, x - 2.7, 3.5, z - 2.5, 5.4, 5.0, 5.0, "metal_light")
    m.box("chassis", -11.0, 6.0, -26.0, 22.0, 7.0, 50.0, "main")
    m.box("chassis", -12.0, 5.0, -28.0, 24.0, 4.0, 6.0, "metal_dark")  # 前バンパー
    m.box("chassis", -10.0, 13.0, -26.0, 20.0, 5.0, 14.0, "main_dark")  # ボンネット
    m.box("chassis", -8.0, 13.0, -6.0, 16.0, 3.0, 12.0, "rubber")  # 座席
    m.box("chassis", -8.0, 16.0, 4.0, 16.0, 7.0, 3.0, "rubber")
    # ロールケージ
    for x in (-10.5, 9.5):
        m.box("chassis", x, 13.0, -10.0, 1.0, 16.0, 1.0, "metal_dark")
        m.box("chassis", x, 13.0, 10.0, 1.0, 16.0, 1.0, "metal_dark")
        m.box("chassis", x, 28.0, -10.0, 1.0, 1.0, 21.0, "metal_dark")
    m.box("chassis", -10.5, 28.0, -10.0, 21.0, 1.0, 1.0, "metal_dark")
    m.box("chassis", -10.5, 28.0, 10.0, 21.0, 1.0, 1.0, "metal_dark")
    m.box("chassis", -9.0, 18.0, -11.0, 18.0, 8.0, 0.6, "lens")  # フロントガラス
    m.box("chassis", -12.0, 12.5, -18.0, 1.0, 2.0, 36.0, "accent")
    m.box("chassis", 11.0, 12.5, -18.0, 1.0, 2.0, 36.0, "accent")
    m.box("chassis", -3.0, 13.0, -27.2, 2.0, 2.0, 0.6, "glow")  # ライト
    m.box("chassis", 1.0, 13.0, -27.2, 2.0, 2.0, 0.6, "glow")
    m.box("chassis", -6.0, 13.0, 12.0, 12.0, 8.0, 10.0, "furniture")  # 後部の荷台
    m.box("chassis", 7.0, 13.0, 16.0, 3.0, 5.0, 6.0, "warning")  # 燃料缶
    # 機関銃座
    m.box("gun", -0.6, 21.0, 13.4, 1.2, 9.0, 1.2, "metal_dark")
    m.box("gun", -1.8, 29.5, 4.0, 3.6, 3.2, 12.0, "main_dark")
    m.box("gun", -0.6, 30.5, -10.0, 1.2, 1.2, 14.0, "metal_dark")
    m.box("gun", 1.8, 28.0, 6.0, 2.6, 3.0, 4.0, "mag")
    m.box("gun", -4.0, 28.0, 3.0, 8.0, 6.0, 0.6, "metal_dark")  # 防盾
    return m


def supply_crate_model(key):
    m = Model(key)
    m.bone("root", None, (0, 0, 0))
    m.bone("chute", "root", (0, 16, 0))
    m.box("root", -8.0, 0.0, -8.0, 16.0, 14.0, 16.0, "furniture")
    m.box("root", -8.3, 0.0, -8.3, 16.6, 1.5, 16.6, "metal_dark")
    m.box("root", -8.3, 12.5, -8.3, 16.6, 1.5, 16.6, "metal_dark")
    m.box("root", -8.4, 4.0, -8.4, 16.8, 2.0, 16.8, "warning")
    m.box("root", -2.0, 14.0, -2.0, 4.0, 1.0, 4.0, "glow")
    # 落下傘（落下中だけ表示）
    for i in range(4):
        a = math.radians(i * 90 + 45)
        x, z = math.sin(a) * 6.0, math.cos(a) * 6.0
        m.box("chute", x * 0.5 - 0.2, 14.0, z * 0.5 - 0.2, 0.4, 16.0, 0.4, "white", rot=(math.degrees(math.atan2(z, 16)) * 0.9, 0, -math.degrees(math.atan2(x, 16)) * 0.9), piv=(x * 0.5, 14.0, z * 0.5))
    m.box("chute", -16.0, 30.0, -16.0, 32.0, 3.0, 32.0, "white")
    m.box("chute", -12.0, 33.0, -12.0, 24.0, 2.0, 24.0, "accent")
    return m


def quartermaster_model(key):
    """補給係（NPC）：レイダーと同じ人型に帽子と背嚢"""
    m = Model(key)
    _humanoid_bones(m)
    m.box("body", -4.0, 12.0, -2.0, 8.0, 12.0, 4.0, "main")
    m.box("body", -4.2, 12.0, -2.2, 8.4, 3.0, 4.4, "furniture")
    m.box("body", -3.5, 14.0, 2.0, 7.0, 9.0, 3.5, "furniture")  # 背嚢
    m.box("head", -4.0, 24.0, -4.0, 8.0, 8.0, 8.0, "white")
    m.box("head", -4.6, 31.0, -5.6, 9.2, 1.2, 10.2, "main")   # 帽子のつば
    m.box("head", -4.1, 31.8, -4.1, 8.2, 2.4, 8.2, "main")
    m.box("head", -2.6, 27.0, -4.1, 1.4, 1.2, 0.2, "rubber")
    m.box("head", 1.2, 27.0, -4.1, 1.4, 1.2, 0.2, "rubber")
    m.box("head", -2.0, 25.2, -4.1, 4.0, 0.6, 0.2, "main_dark")
    for bone, x0 in (("rightArm", -8.0), ("leftArm", 4.0)):
        m.box(bone, x0, 12.0, -2.0, 4.0, 12.0, 4.0, "main")
        m.box(bone, x0, 12.0, -2.0, 4.0, 3.0, 4.0, "white")
    for bone, x0 in (("rightLeg", -3.9), ("leftLeg", -0.1)):
        m.box(bone, x0, 0.0, -2.0, 4.0, 12.0, 4.0, "main_dark")
        m.box(bone, x0, 0.0, -2.2, 4.0, 2.0, 4.4, "rubber")
    return m


def empty_model(key):
    m = Model(key)
    m.bone("root", None, (0, 0, 0))
    return m


# エンティティ ID → (モデル関数, 見える範囲)
def entity_model(kind, key):
    table = {
        "robot": (lambda: robot_model(key), (2, 3, 1.5)),
        "shield_bot": (lambda: shield_bot_model(key), (3, 3, 1.5)),
        "mortar_bot": (lambda: mortar_bot_model(key), (3, 3, 1.0)),
        "drone": (lambda: drone_model(key), (2, 1, 0.3)),
        "recon_drone": (lambda: drone_model(key, recon=True), (2, 1, 0.3)),
        "dog": (lambda: dog_model(key), (2, 2, 0.6)),
        "hollow": (lambda: hollow_model(key, "runner"), (2, 3, 1.5)),
        "bloater": (lambda: hollow_model(key, "bloater"), (3, 3, 1.5)),
        "brute": (lambda: hollow_model(key, "brute"), (4, 4, 2.0)),
        "juggernaut": (lambda: juggernaut_model(key), (5, 5, 2.5)),
        "sentry": (lambda: sentry_model(key), (2, 2, 0.6)),
        "shield_wall": (lambda: shield_wall_model(key), (3, 2, 0.7)),
        "claymore": (lambda: claymore_model(key), (1, 1, 0.2)),
        "ammo_station": (lambda: station_model(key), (2, 1, 0.4)),
        "med_station": (lambda: station_model(key, med=True), (2, 1, 0.4)),
        "mortar_emplacement": (lambda: mortar_emplacement_model(key), (2, 2, 0.6)),
        "hmg_nest": (lambda: hmg_nest_model(key), (5, 3, 0.8)),
        "aa_gun": (lambda: aa_gun_model(key), (5, 3, 1.0)),
        "at_post": (lambda: at_post_model(key), (4, 3, 0.8)),
        "buggy": (lambda: buggy_model(key), (6, 4, 1.2)),
        "supply_crate": (lambda: supply_crate_model(key), (4, 4, 1.2)),
        "quartermaster": (lambda: quartermaster_model(key), (2, 3, 1.5)),
        "empty": (lambda: empty_model(key), (1, 1, 0.5)),
    }
    fn, vb = table[kind]
    return fn(), vb
