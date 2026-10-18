"""
ARSENAL CORE — 3D モデル生成
武器・弾体・訓練用ターゲット・レイダーのジオメトリ（Blockbench 互換 format 1.16.0）を手続き的に組み立てる。

座標系（ガンローカル）:
  f  … 前方（銃口方向）の距離。Bedrock モデル空間では z = -f
  y  … 上方向
  x  … Bedrock モデル空間の x（+x が銃の左側、-x が右側）
  原点 … グリップの中心（右手が握る位置 = rightItem のピボット）
"""
import hashlib

# マテリアル（テクスチャのタイル番号。64x64 を 16px タイルで 4x4 分割）
MAT = {
    "main": 0, "main_dark": 1, "furniture": 2, "metal_dark": 3,
    "metal_light": 4, "grip": 5, "rail": 6, "mag": 7,
    "accent": 8, "lens": 9, "glow": 10, "wood": 11,
    "brass": 12, "rubber": 13, "warning": 14, "white": 15,
}
TILE = 16
TEX_SIZE = 64


class Cube:
    __slots__ = ("x0", "x1", "y0", "y1", "f0", "f1", "mat", "rot", "piv", "tag")

    def __init__(self, x0, x1, y0, y1, f0, f1, mat, rot=None, piv=None, tag=None):
        self.x0, self.x1 = min(x0, x1), max(x0, x1)
        self.y0, self.y1 = min(y0, y1), max(y0, y1)
        self.f0, self.f1 = min(f0, f1), max(f0, f1)
        self.mat = mat
        self.rot = rot  # (rx, ry, rz) Bedrock 度
        self.piv = piv  # (x, y, f) ガンローカル
        self.tag = tag


class Gun:
    def __init__(self):
        self.cubes = []
        self.sight_y = 4.0  # 照準線の高さ（ガンローカル y）
        self.front = 10.0  # 銃口の f
        self.rear = -6.0  # 最後端の f
        self.muzzle_y = 3.0

    def box(self, f0, f1, y0, y1, w=2.0, mat="main", xc=0.0, rot=None, piv=None, tag=None):
        c = Cube(xc - w / 2, xc + w / 2, y0, y1, f0, f1, mat, rot, piv, tag)
        self.cubes.append(c)
        return c

    def bounds(self):
        xs = [c.x0 for c in self.cubes] + [c.x1 for c in self.cubes]
        ys = [c.y0 for c in self.cubes] + [c.y1 for c in self.cubes]
        fs = [c.f0 for c in self.cubes] + [c.f1 for c in self.cubes]
        return (min(xs), max(xs), min(ys), max(ys), min(fs), max(fs))


# ---------------------------------------------------------------------------
#  パーツ
# ---------------------------------------------------------------------------
def _grip(g, f=0.0, kind="pistol", tilt=14, h=5.0):
    mat = {"pistol": "grip", "wood": "wood", "rubber": "rubber"}.get(kind, "grip")
    g.box(f - 1.0, f + 1.0, -h / 2 - 0.5, h / 2 - 0.5, 1.6, mat, rot=(tilt, 0, 0), piv=(0, h / 2 - 0.5, f))
    # トリガーガード
    g.box(f + 1.0, f + 3.2, h / 2 - 1.6, h / 2 - 1.2, 0.6, "main_dark")
    g.box(f + 3.0, f + 3.4, h / 2 - 1.6, h / 2 - 0.4, 0.6, "main_dark")
    # トリガー
    g.box(f + 1.6, f + 2.0, h / 2 - 1.4, h / 2 - 0.4, 0.4, "metal_light")


def _iron_sights(g, f_rear, f_front, y):
    g.box(f_rear, f_rear + 0.8, y, y + 0.9, 1.4, "main_dark")
    g.box(f_rear + 0.1, f_rear + 0.7, y + 0.9, y + 1.1, 0.4, "accent")
    g.box(f_front - 0.6, f_front, y, y + 1.1, 0.4, "main_dark")
    g.sight_y = y + 0.9


def _rail(g, f0, f1, y, w=1.4):
    g.box(f0, f1, y, y + 0.5, w, "rail")


def _reddot(g, f, y):
    g.box(f, f + 2.4, y, y + 0.6, 1.4, "main_dark")
    g.box(f + 0.2, f + 0.6, y + 0.6, y + 2.2, 1.6, "main")
    g.box(f + 1.8, f + 2.2, y + 0.6, y + 2.2, 1.6, "main")
    g.box(f + 0.2, f + 2.2, y + 2.0, y + 2.4, 1.6, "main")
    g.box(f + 0.6, f + 0.7, y + 0.8, y + 2.0, 1.2, "lens")
    g.sight_y = y + 1.4


def _scope(g, f, y, length=8.0, power=4):
    d = 1.8 if power <= 4 else 2.2
    g.box(f + 1.0, f + 1.6, y, y + 1.0, 1.0, "main_dark")
    g.box(f + length - 2.6, f + length - 2.0, y, y + 1.0, 1.0, "main_dark")
    # 対物・接眼ベル
    g.box(f, f + 1.4, y + 0.6, y + 0.6 + d + 0.4, d + 0.4, "main_dark")
    g.box(f + length - 1.8, f + length, y + 0.6, y + 0.6 + d + 0.6, d + 0.6, "main_dark")
    # チューブ
    g.box(f + 1.4, f + length - 1.8, y + 0.8, y + 0.8 + d, d - 0.2, "main")
    # ターレット
    g.box(f + length / 2 - 0.6, f + length / 2 + 0.6, y + 0.8 + d, y + 1.4 + d, 0.9, "metal_light")
    g.box(f + length / 2 - 0.6, f + length / 2 + 0.6, y + 1.0, y + 0.8 + d - 0.4, d + 0.6, "metal_light")
    # レンズ
    g.box(f + length - 0.05, f + length + 0.05, y + 0.8, y + 0.8 + d + 0.2, d, "lens")
    g.box(f - 0.05, f + 0.05, y + 0.8, y + 0.6 + d, d - 0.4, "lens")
    g.sight_y = y + 0.8 + d / 2


def _look_kind(m, default):
    """見た目グループ（m["_look"]：0 = アイアン、1 = ドット系、2 = 倍率スコープ系）から、載せるサイトの種類を決める"""
    lk = m.get("_look")
    if lk is None:
        return default
    if lk == 0:
        return default if default in ("iron", "carry") else "iron"
    return "dot" if lk == 1 else "scope"


def _sight(g, m, f_rear, f_front, y, default="iron", carry=None, mount=False, scope_len=None):
    """照準器：アイアンサイト・ドットサイト・倍率スコープを見た目グループに応じて載せる。
    mount … レールの無い銃（拳銃・ショットガンなど）にドット／スコープを載せるときに台座を付ける"""
    kind = _look_kind(m, default)
    if kind in ("dot", "scope") and mount:
        g.box(f_rear + 0.6, f_rear + (5.0 if kind == "scope" else 3.0), y - 0.1, y + 0.4, 1.2, "rail")
        y += 0.4
    if kind == "scope":
        p = m.get("scope") or (2 if mount else 4)
        L = scope_len or (9.0 if p >= 8 else 7.5 if not mount else 6.0)
        _scope(g, f_rear, y, length=L, power=p)
    elif kind == "dot":
        _reddot(g, f_rear + 1.5, y)
    elif kind == "carry" and carry:
        carry()
    else:
        _iron_sights(g, f_rear, f_front, y)


def _muzzle_device(g, f, y, kind="flash"):
    if kind == "brake":
        g.box(f, f + 2.6, y - 1.0, y + 1.0, 2.2, "metal_dark")
        g.box(f + 0.6, f + 1.0, y - 1.05, y + 1.05, 2.3, "metal_light")
        g.box(f + 1.6, f + 2.0, y - 1.05, y + 1.05, 2.3, "metal_light")
        return f + 2.6
    if kind == "comp":
        g.box(f, f + 1.6, y - 0.8, y + 0.8, 1.6, "metal_dark")
        g.box(f + 0.4, f + 1.2, y + 0.5, y + 0.9, 0.8, "metal_light")
        return f + 1.6
    g.box(f, f + 1.2, y - 0.6, y + 0.6, 1.2, "metal_dark")
    return f + 1.2


def _stock(g, f_rear, y_top, kind, h=4.0):
    """f_rear から後方にストックを伸ばす。戻り値は最後端の f"""
    if kind == "none":
        g.box(f_rear - 1.0, f_rear, y_top - h + 1.0, y_top - 0.5, 2.0, "main_dark")
        return f_rear - 1.0
    if kind == "wire":
        g.box(f_rear - 7.0, f_rear, y_top - 1.2, y_top - 0.6, 0.6, "metal_dark", xc=0.7)
        g.box(f_rear - 7.0, f_rear, y_top - 1.2, y_top - 0.6, 0.6, "metal_dark", xc=-0.7)
        g.box(f_rear - 7.6, f_rear - 7.0, y_top - 3.6, y_top - 0.6, 2.0, "rubber")
        return f_rear - 7.6
    if kind == "wood":
        g.box(f_rear - 4.0, f_rear, y_top - 2.8, y_top - 0.4, 2.0, "wood")
        g.box(f_rear - 9.0, f_rear - 4.0, y_top - 4.2, y_top - 0.6, 2.2, "wood", rot=(-6, 0, 0), piv=(0, y_top - 0.6, f_rear - 4.0))
        g.box(f_rear - 9.6, f_rear - 9.0, y_top - 4.6, y_top - 0.4, 2.2, "rubber", rot=(-6, 0, 0), piv=(0, y_top - 0.6, f_rear - 4.0))
        return f_rear - 9.6
    if kind == "skeleton":
        g.box(f_rear - 8.0, f_rear, y_top - 1.0, y_top - 0.2, 1.4, "main")
        g.box(f_rear - 8.0, f_rear - 1.0, y_top - 3.6, y_top - 2.8, 1.4, "main", rot=(8, 0, 0), piv=(0, y_top - 3.0, f_rear - 1.0))
        g.box(f_rear - 8.8, f_rear - 8.0, y_top - 4.0, y_top - 0.2, 2.0, "rubber")
        return f_rear - 8.8
    # fixed
    g.box(f_rear - 2.5, f_rear, y_top - 2.0, y_top - 0.4, 1.6, "main_dark")
    g.box(f_rear - 8.0, f_rear - 2.5, y_top - 3.8, y_top - 0.2, 2.0, "furniture")
    g.box(f_rear - 7.0, f_rear - 3.0, y_top - 0.2, y_top + 0.5, 1.4, "furniture")
    g.box(f_rear - 8.8, f_rear - 8.0, y_top - 4.0, y_top + 0.5, 2.2, "rubber")
    return f_rear - 8.8


def _mag(g, f, y_top, kind, w=1.6):
    if kind == "straight":
        g.box(f, f + 2.0, y_top - 6.5, y_top, w, "mag", rot=(-4, 0, 0), piv=(0, y_top, f))
        g.box(f - 0.1, f + 2.1, y_top - 7.0, y_top - 6.5, w + 0.2, "main_dark", rot=(-4, 0, 0), piv=(0, y_top, f))
    elif kind == "straight_short":
        g.box(f, f + 2.4, y_top - 5.0, y_top, w + 0.2, "mag", rot=(-3, 0, 0), piv=(0, y_top, f))
        g.box(f - 0.1, f + 2.5, y_top - 5.4, y_top - 5.0, w + 0.4, "main_dark", rot=(-3, 0, 0), piv=(0, y_top, f))
    elif kind == "curved":
        g.box(f, f + 2.2, y_top - 3.6, y_top, w, "mag", rot=(-6, 0, 0), piv=(0, y_top, f))
        g.box(f + 0.4, f + 2.6, y_top - 7.0, y_top - 3.4, w, "mag", rot=(-22, 0, 0), piv=(0, y_top - 3.4, f + 0.4))
        g.box(f + 0.3, f + 2.7, y_top - 7.4, y_top - 7.0, w + 0.2, "main_dark", rot=(-22, 0, 0), piv=(0, y_top - 3.4, f + 0.4))
    elif kind == "drum":
        g.box(f - 0.2, f + 2.2, y_top - 2.2, y_top, w, "mag")
        g.box(f - 1.2, f + 3.4, y_top - 6.4, y_top - 2.0, 3.0, "mag")
        g.box(f - 0.6, f + 2.8, y_top - 5.8, y_top - 2.6, 3.4, "main_dark")
    elif kind == "box":
        g.box(f, f + 3.0, y_top - 3.6, y_top, w + 0.6, "mag")
        g.box(f - 0.1, f + 3.1, y_top - 4.0, y_top - 3.6, w + 0.8, "main_dark")
    elif kind == "box_side":
        g.box(f - 0.5, f + 3.5, y_top - 5.0, y_top, 3.0, "mag", xc=0.6)
        g.box(f - 0.4, f + 3.4, y_top - 5.4, y_top - 5.0, 3.2, "main_dark", xc=0.6)
    elif kind == "belt_box":
        g.box(f - 0.6, f + 3.8, y_top - 5.2, y_top - 0.6, 3.2, "mag", xc=0.8)
        g.box(f, f + 0.6, y_top - 0.8, y_top + 0.2, 1.2, "brass", xc=1.2)
    elif kind == "top":
        g.box(f - 4.0, f + 3.0, y_top + 0.1, y_top + 1.0, 2.2, "mag")
    elif kind == "cells":
        g.box(f, f + 2.6, y_top - 3.2, y_top, 2.0, "main_dark")
        g.box(f + 0.4, f + 2.2, y_top - 3.0, y_top - 0.4, 2.1, "glow")


# ---------------------------------------------------------------------------
#  種別ビルダー
# ---------------------------------------------------------------------------
def build_pistol(m):
    g = Gun()
    L = float(m.get("slide", 9))
    h = float(m.get("h", 2.5))
    rear = -2.2
    front = rear + L
    y0 = 1.8  # フレーム上端 = スライド下端
    # フレーム
    g.box(rear + 0.4, front - 1.0, y0 - 1.0, y0, 1.6, "main_dark")
    # スライド
    g.box(rear, front, y0, y0 + h, 1.8, "main")
    g.box(rear + 1.0, rear + 3.2, y0 + h * 0.35, y0 + h - 0.4, 1.85, "main_dark")  # セレーション
    g.box(front - 3.0, front - 1.2, y0 + 0.5, y0 + h - 0.6, 1.85, "metal_light", xc=-0.02)  # エジェクションポート
    # 銃身の先端
    g.box(front, front + 0.3, y0 + 0.6, y0 + 1.4, 0.8, "metal_dark")
    g.muzzle_y = y0 + 1.0
    _grip(g, 0.0, m.get("grip", "pistol"), tilt=16, h=5.0)
    # 下部アクセサリーレール
    g.box(front - 3.2, front - 0.8, y0 - 1.4, y0 - 1.0, 1.2, "rail")
    _sight(g, m, rear + 0.2, front - 0.3, y0 + h, mount=True)
    fend = front + 0.3
    if m.get("compensator"):
        fend = _muzzle_device(g, front, y0 + 1.1, "comp")
        g.muzzle_y = y0 + 1.1
    if m.get("extMag"):
        g.box(-0.9, 0.9, -6.5, -3.0, 1.4, "mag", rot=(16, 0, 0), piv=(0, 1.3, 0))
    else:
        g.box(-0.9, 0.9, -3.4, -2.9, 1.7, "main_dark", rot=(16, 0, 0), piv=(0, 1.3, 0))
    if m.get("stub"):
        g.box(rear - 3.5, rear, y0 - 0.2, y0 + 0.6, 0.8, "metal_dark")
        g.box(rear - 4.1, rear - 3.5, y0 - 2.4, y0 + 0.8, 1.6, "rubber")
    g.box(rear + 0.5, rear + 1.2, y0 + h, y0 + h + 0.3, 1.2, "accent")
    g.front = fend
    g.rear = rear - (4.1 if m.get("stub") else 0.0)
    return g


def build_revolver(m):
    g = Gun()
    L = float(m.get("slide", 12))
    y0 = 1.6
    rear = -2.0
    # フレーム
    g.box(rear, 3.4, y0 - 0.8, y0 + 2.8, 1.6, "main")
    # シリンダー
    g.box(0.8, 3.6, y0 - 0.2, y0 + 2.6, 2.6, "metal_dark")
    g.box(1.0, 3.4, y0 + 0.3, y0 + 2.1, 2.8, "main")
    g.box(1.1, 3.3, y0 - 0.4, y0 + 2.8, 1.2, "main_dark")
    # 銃身＋アンダーラグ
    g.box(3.4, rear + L, y0 + 1.0, y0 + 2.4, 1.3, "main")
    g.box(3.4, rear + L - 0.4, y0 + 0.2, y0 + 1.0, 1.2, "main_dark")
    g.box(3.6, rear + L - 1.0, y0 + 2.4, y0 + 2.8, 0.5, "rail")
    # ハンマー
    g.box(rear - 0.4, rear + 0.4, y0 + 1.8, y0 + 3.2, 0.6, "metal_light", rot=(-20, 0, 0), piv=(0, y0 + 1.8, rear))
    _grip(g, -0.6, "wood", tilt=22, h=5.0)
    _sight(g, m, rear + 0.2, rear + L - 0.4, y0 + 2.8, mount=True)
    g.box(rear + L - 1.2, rear + L - 0.3, y0 + 2.8, y0 + 3.9, 0.4, "accent")
    g.front = rear + L
    g.rear = rear - 0.6
    g.muzzle_y = y0 + 1.7
    return g


def build_flare(m):
    g = Gun()
    y0 = 1.6
    g.box(-2.0, 3.0, y0 - 0.8, y0 + 2.2, 1.8, "main")
    g.box(3.0, 8.5, y0 + 0.2, y0 + 3.2, 3.0, "main")  # 太い銃身
    g.box(8.2, 8.6, y0 + 0.4, y0 + 3.0, 2.6, "metal_dark")
    g.box(3.2, 8.2, y0 + 3.2, y0 + 3.6, 0.8, "warning")
    g.box(-2.4, -1.6, y0 + 1.4, y0 + 2.8, 0.6, "metal_light")
    _grip(g, 0.0, "pistol", tilt=18, h=5.0)
    _sight(g, m, -1.4, 8.2, y0 + 3.2, mount=True)
    g.front = 8.6
    g.rear = -2.4
    g.muzzle_y = y0 + 1.7
    return g


def _rifle_common(g, m, body, h, y0, rear, bullpup=False):
    """レシーバー・ハンドガード・銃身・マズル・サイト類。レシーバー前端 f を返す"""
    front = rear + body
    # レシーバー（上下）
    g.box(rear, front, y0 + h * 0.45, y0 + h, 2.4, "main")
    g.box(rear, front - 0.5, y0, y0 + h * 0.45, 2.3, "main_dark")
    # エジェクションポート（右側 = -x）
    g.box(rear + body * 0.35, rear + body * 0.35 + 2.6, y0 + h * 0.5, y0 + h * 0.85, 0.2, "metal_light", xc=-1.25)
    # チャージングハンドル
    g.box(rear + 0.4, rear + 1.4, y0 + h - 0.6, y0 + h - 0.2, 3.2, "metal_light")
    # アクセントライン
    g.box(rear + 1.0, front - 1.0, y0 + h * 0.45 - 0.3, y0 + h * 0.45, 2.45, "accent")
    return front


def build_rifle(m, sniper=False):
    g = Gun()
    body = float(m.get("body", 12))
    h = float(m.get("h", 4))
    barrel = float(m.get("barrel", 8))
    guard = float(m.get("guard", 7))
    y0 = 1.6
    bullpup = bool(m.get("bullpup"))
    rear = -(body - 3.0) if bullpup else -5.0
    front = _rifle_common(g, m, body, h, y0, rear, bullpup)
    _grip(g, 0.0, "pistol", tilt=14, h=5.0)
    # マガジン
    mag = m.get("mag", "curved")
    mag_f = (rear + 1.5) if bullpup else 2.6
    if mag != "top":
        _mag(g, mag_f, y0 + 0.2, mag)
    else:
        _mag(g, rear + 4.0, y0 + h, "top")
    # ハンドガード
    gy0, gy1 = y0 + 0.3, y0 + h - 0.6
    if guard > 0:
        g.box(front, front + guard, gy0, gy1, 2.2, "furniture" if m.get("finish") == "wood" else "main")
        g.box(front + 0.5, front + guard - 0.5, gy0 - 0.3, gy0, 1.2, "rail")
        g.box(front + 0.8, front + guard - 0.8, gy0 + 0.6, gy1 - 0.6, 2.3, "main_dark")
    by = y0 + h * 0.62
    bstart = front + guard
    g.box(front, bstart + barrel, by - 0.5, by + 0.5, 1.0, "metal_dark")
    # ガスブロック・フロントサイト
    g.box(bstart, bstart + 1.0, by - 0.7, by + 0.9, 1.4, "metal_dark")
    fend = bstart + barrel
    if m.get("intSuppressor"):
        s = float(m["intSuppressor"])
        g.box(front + guard * 0.3, front + guard + s, by - 1.1, by + 1.1, 2.2, "metal_dark")
        g.box(front + guard + s - 0.6, front + guard + s, by - 0.9, by + 0.9, 2.3, "main_dark")
        fend = front + guard + s
    elif m.get("brake"):
        fend = _muzzle_device(g, fend, by, "brake")
    else:
        fend = _muzzle_device(g, fend, by, "flash")
    g.muzzle_y = by
    # 上部レール
    top = y0 + h
    _rail(g, rear + 1.0, front + guard - 0.4, top)
    # ストック
    st = m.get("stock", "fixed")
    back = _stock(g, rear, y0 + h, st, h)
    # 光学
    def carry():
        g.box(rear + 2.0, rear + 8.0, top + 0.5, top + 2.0, 1.2, "main")
        g.box(rear + 2.2, rear + 3.0, top + 0.5, top + 2.4, 1.2, "main_dark")
        g.box(bstart - 0.2, bstart + 0.6, by + 0.9, top + 2.1, 0.5, "main_dark")
        g.sight_y = top + 2.1
    default = "scope" if m.get("scope") else "carry" if m.get("carry") else "iron"
    if _look_kind(m, default) == "scope":
        p = m.get("scope") or 4
        _scope(g, rear + (0.5 if not bullpup else 2.0), top + 0.5, length=9.0 if p >= 8 else 7.5, power=p)
    else:
        _sight(g, m, rear + 1.2, front + guard - 0.6, top + 0.5, default, carry=carry)
    # バイポッド（内蔵）
    if m.get("bipodBuilt"):
        g.box(front + guard - 1.5, front + guard - 0.5, gy0 - 5.0, gy0, 0.5, "metal_dark", xc=0.8, rot=(-18, 0, 0), piv=(0, gy0, front + guard - 1.0))
        g.box(front + guard - 1.5, front + guard - 0.5, gy0 - 5.0, gy0, 0.5, "metal_dark", xc=-0.8, rot=(-18, 0, 0), piv=(0, gy0, front + guard - 1.0))
    if m.get("bolt"):
        g.box(rear + 3.0, rear + 3.6, y0 + h * 0.55, y0 + h * 0.75, 2.2, "metal_light", xc=-2.0)
        g.box(rear + 3.0, rear + 3.8, y0 + h * 0.4, y0 + h * 0.9, 0.9, "metal_light", xc=-2.9)
    g.front = fend
    g.rear = back
    return g


def build_smg(m):
    g = Gun()
    body = float(m.get("body", 12))
    h = float(m.get("h", 3.5))
    barrel = float(m.get("barrel", 4))
    y0 = 1.6
    bullpup = bool(m.get("bullpup"))
    rear = -(body - 4.0) if bullpup else -4.0
    front = _rifle_common(g, m, body, h, y0, rear, bullpup)
    _grip(g, 0.0, "pistol", tilt=12, h=5.0)
    mag = m.get("mag", "straight")
    if mag == "top":
        _mag(g, rear + 4.0, y0 + h, "top")
    elif bullpup:
        _mag(g, rear + 1.2, y0 + 0.2, mag)
    else:
        _mag(g, 2.4, y0 + 0.2, mag)
    by = y0 + h * 0.55
    g.box(front, front + barrel + 0.01, by - 0.45, by + 0.45, 0.9, "metal_dark")
    fend = front + barrel
    if m.get("intSuppressor"):
        s = float(m["intSuppressor"])
        g.box(front - 1.0, front + s, by - 1.1, by + 1.1, 2.2, "metal_dark")
        g.box(front + s - 0.5, front + s, by - 0.9, by + 0.9, 2.3, "main_dark")
        fend = front + s
    else:
        fend = _muzzle_device(g, fend, by, "flash")
    g.muzzle_y = by
    if m.get("foregrip"):
        g.box(front - 2.2, front - 0.8, y0 - 3.5, y0, 1.4, "grip")
    top = y0 + h
    _rail(g, rear + 0.8, front - 0.4, top)
    back = _stock(g, rear, y0 + h, m.get("stock", "fixed"), h)
    if mag == "top" and m.get("_look") in (None, 0):
        _reddot(g, rear + 2.0, top + 1.0) if m.get("_look") is None else _iron_sights(g, rear + 0.8, front - 0.6, top + 1.4)
    elif mag == "top":
        _sight(g, m, rear + 0.8, front - 0.6, top + 1.4, "iron")
    else:
        _sight(g, m, rear + 0.8, front - 0.6, top + 0.5, "iron")
    g.front = fend
    g.rear = back
    return g


def build_sniper(m):
    return build_rifle(m, sniper=True)


def build_shotgun(m):
    g = Gun()
    body = float(m.get("body", 12))
    h = float(m.get("h", 4))
    barrel = float(m.get("barrel", 12))
    y0 = 1.6
    rear = -4.5
    front = rear + body
    g.box(rear, front, y0, y0 + h, 2.4, "main")
    g.box(rear + 3.0, rear + 6.0, y0 + h * 0.4, y0 + h * 0.8, 0.2, "metal_light", xc=-1.25)
    g.box(rear + 0.8, front - 0.8, y0 + h - 0.4, y0 + h, 2.45, "accent")
    _grip(g, 0.0, "pistol", tilt=14, h=5.0)
    by = y0 + h * 0.7
    g.box(front, front + barrel, by - 0.6, by + 0.6, 1.2, "metal_dark")
    g.box(front + barrel - 0.5, front + barrel, by - 0.7, by + 0.7, 1.4, "main_dark")
    g.muzzle_y = by
    if m.get("tube"):
        g.box(front, front + barrel - 2.0, by - 1.8, by - 0.6, 1.2, "metal_dark")
    if m.get("pumpGrip"):
        g.box(front + 1.5, front + 6.5, by - 2.3, by - 0.1, 2.2, "furniture" if m.get("finish") != "wood" else "wood")
        g.box(front + 2.0, front + 6.0, by - 2.4, by - 0.0, 2.3, "grip")
    if m.get("heatShield"):
        g.box(front + 0.5, front + barrel - 1.0, by + 0.5, by + 1.0, 1.6, "metal_light")
        for i in range(4):
            fx = front + 1.5 + i * (barrel - 3.0) / 4
            g.box(fx, fx + 0.6, by + 0.4, by + 1.05, 1.7, "main_dark")
    if m.get("mag") == "box":
        _mag(g, 2.4, y0 + 0.2, "box")
        g.box(front, front + 6.0, y0 + 0.2, y0 + h - 0.8, 2.2, "furniture")
    elif m.get("mag") == "drum":
        _mag(g, 2.0, y0 + 0.2, "drum")
        g.box(front, front + 6.0, y0 + 0.2, y0 + h - 0.8, 2.2, "furniture")
    back = _stock(g, rear, y0 + h, m.get("stock", "fixed"), h)
    _sight(g, m, rear + 0.8, front + barrel - 0.6, y0 + h, mount=True)
    g.front = front + barrel
    g.rear = back
    return g


def build_double(m):
    g = Gun()
    body = float(m.get("body", 8))
    barrel = float(m.get("barrel", 13))
    y0 = 1.6
    rear = -3.0
    front = rear + body
    g.box(rear, front, y0, y0 + 3.2, 2.6, "metal_dark")
    g.box(rear + 0.4, front - 0.4, y0 + 3.2, y0 + 3.6, 1.2, "accent")
    by = y0 + 2.4
    g.box(front, front + barrel, by - 0.8, by + 0.8, 1.4, "metal_dark", xc=0.72)
    g.box(front, front + barrel, by - 0.8, by + 0.8, 1.4, "metal_dark", xc=-0.72)
    g.box(front + 0.5, front + barrel - 0.5, by + 0.7, by + 1.0, 0.6, "rail")
    g.box(front, front + 5.0, by - 2.2, by - 0.8, 2.4, "wood")
    g.box(rear - 0.4, rear + 0.6, y0 + 3.0, y0 + 4.0, 0.8, "metal_light")
    _grip(g, 0.0, "wood", tilt=20, h=4.8)
    back = _stock(g, rear, y0 + 3.4, "wood", 3.6)
    g.box(front + barrel - 0.6, front + barrel - 0.2, by + 1.0, by + 1.5, 0.4, "brass")
    g.sight_y = by + 1.4
    g.muzzle_y = by
    g.front = front + barrel
    g.rear = back
    return g


def build_lmg(m):
    g = build_rifle({**m, "mag": "none"})
    y0 = 1.6
    h = float(m.get("h", 5))
    kind = m.get("mag", "box_side")
    if kind == "belt_box":
        _mag(g, 2.2, y0 + 0.2, "belt_box")
    else:
        _mag(g, 2.2, y0 + 0.2, "box_side")
    # フィードカバー
    body = float(m.get("body", 15))
    g.box(-3.0, -3.0 + body * 0.55, y0 + h, y0 + h + 0.8, 2.6, "main_dark")
    # キャリングハンドル（バレル上）
    g.box(8.0, 11.0, y0 + h + 0.3, y0 + h + 1.6, 0.8, "metal_dark")
    if m.get("shroud"):
        # 放熱用の穴あきシュラウド（重機関銃・チェーンガン）
        guard = float(m.get("guard", 7))
        barrel = float(m.get("barrel", 8))
        f0 = -5.0 + body + guard
        by = y0 + h * 0.62
        g.box(f0 - 0.5, f0 + barrel * 0.8, by - 1.3, by + 1.3, 2.6, "main_dark")
        for i in range(int(barrel * 0.8 // 2)):
            fx = f0 + 0.5 + i * 2.0
            g.box(fx, fx + 0.8, by - 1.35, by + 1.35, 2.7, "metal_dark")
    return g


def build_rotary(m):
    g = Gun()
    y0 = 1.6
    body = float(m.get("body", 14))
    barrel = float(m.get("barrel", 14))
    rear = -5.0
    front = rear + body
    # モーターハウジング
    g.box(rear, front, y0, y0 + 5.0, 3.6, "main")
    g.box(rear + 1.0, front - 1.0, y0 + 5.0, y0 + 5.6, 2.0, "rail")
    g.box(rear + 2.0, rear + 6.0, y0 + 1.0, y0 + 4.0, 3.7, "accent")
    # 回転銃身（6 本）
    import math
    cy = y0 + 2.5
    for i in range(6):
        a = math.radians(i * 60)
        x = math.cos(a) * 1.2
        yy = cy + math.sin(a) * 1.2
        g.box(front, front + barrel, yy - 0.4, yy + 0.4, 0.8, "metal_dark", xc=x)
    g.box(front + 1.0, front + 2.0, cy - 2.0, cy + 2.0, 4.0, "main_dark")
    g.box(front + barrel - 2.0, front + barrel - 1.0, cy - 2.0, cy + 2.0, 4.0, "main_dark")
    g.box(front - 0.5, front + barrel, cy - 0.3, cy + 0.3, 0.6, "metal_light")
    # ベルトボックス
    g.box(-1.0, 4.5, y0 - 5.4, y0 - 0.2, 3.6, "mag", xc=1.0)
    g.box(4.5, 6.0, y0 - 1.6, y0 + 0.2, 0.8, "brass", xc=1.6)
    # ハンドル
    _grip(g, 0.0, "rubber", tilt=10, h=5.0)
    g.box(front - 2.0, front - 0.6, y0 + 5.0, y0 + 7.4, 1.0, "rubber")
    g.box(front - 6.0, front - 0.6, y0 + 7.0, y0 + 7.8, 1.0, "metal_dark")
    g.box(rear - 1.0, rear, y0 + 0.5, y0 + 4.5, 3.0, "main_dark")
    g.sight_y = y0 + 6.2
    g.muzzle_y = cy
    g.front = front + barrel
    g.rear = rear - 1.0
    return g


def build_launcher(m):
    g = Gun()
    y0 = 1.6
    body = float(m.get("body", 9))
    barrel = float(m.get("barrel", 9))
    bore = float(m.get("bore", 3))
    rear = -4.0
    front = rear + body
    g.box(rear, front, y0, y0 + 3.6, 2.4, "main")
    _grip(g, 0.0, "rubber", tilt=14, h=5.0)
    by = y0 + 2.6
    if m.get("cylinder"):
        g.box(front - 1.0, front + 5.0, by - 3.0, by + 3.0, 6.0, "main_dark")
        g.box(front - 0.6, front + 4.6, by - 3.2, by + 3.2, 5.0, "mag")
        g.box(front + 5.0, front + 5.0 + barrel, by - bore / 2 - 0.3, by + bore / 2 + 0.3, bore + 0.6, "metal_dark")
        g.box(front + 5.0, front + 5.0 + barrel, by - bore / 2, by + bore / 2, bore + 0.8, "main")
        g.box(front + 6.0, front + 5.0 + barrel - 1.0, by - bore / 2 - 2.0, by - bore / 2, 1.6, "grip")
        end = front + 5.0 + barrel
    else:
        g.box(front, front + barrel, by - bore / 2 - 0.3, by + bore / 2 + 0.3, bore + 0.6, "metal_dark")
        g.box(front + 0.5, front + barrel - 0.5, by - bore / 2 - 0.35, by + bore / 2 + 0.35, bore + 0.4, "main")
        g.box(front + barrel - 0.6, front + barrel, by - bore / 2 - 0.5, by + bore / 2 + 0.5, bore + 0.9, "warning")
        g.box(front + 1.0, front + barrel - 1.5, by - bore / 2 - 2.2, by - bore / 2 - 0.3, 1.8, "grip")
        end = front + barrel
    g.box(front - 0.5, front + 0.3, y0 + 3.6, y0 + 4.6, 0.8, "metal_light")
    back = _stock(g, rear, y0 + 3.6, m.get("stock", "fixed"), 3.6)
    g.box(front + 1.0, front + 3.0, by + bore / 2 + 0.3, by + bore / 2 + 2.3, 0.4, "metal_light")
    g.box(front + 1.0, front + 1.4, by + bore / 2 + 1.0, by + bore / 2 + 2.2, 1.6, "metal_light")
    g.sight_y = by + bore / 2 + 1.6
    g.muzzle_y = by
    g.front = end
    g.rear = back
    return g


def build_tube(m):
    g = Gun()
    L = float(m.get("body", 26))
    h = float(m.get("h", 5))
    y0 = 1.8
    rear = -12.0
    cy = y0 + h / 2 + 0.5
    if m.get("quad"):
        # 4 連装：2×2 の発射筒を束ねる
        q = h * 0.55
        for dx, dy in ((-q / 2, -q / 2), (q / 2, -q / 2), (-q / 2, q / 2), (q / 2, q / 2)):
            g.box(rear, rear + L, cy + dy - q / 2, cy + dy + q / 2, q, "main", xc=dx)
            g.box(rear + L - 0.6, rear + L + 0.3, cy + dy - q / 2 + 0.3, cy + dy + q / 2 - 0.3, q - 0.6, "metal_dark", xc=dx)
        g.box(rear + 3.0, rear + 4.5, cy - q - 0.3, cy + q + 0.3, 2 * q + 0.6, "main_dark")
        g.box(rear + L - 6.0, rear + L - 4.5, cy - q - 0.3, cy + q + 0.3, 2 * q + 0.6, "accent")
    else:
        g.box(rear, rear + L, cy - h / 2, cy + h / 2, h, "main")
    if not m.get("quad"):
        g.box(rear - 0.5, rear + 1.5, cy - h / 2 - 0.4, cy + h / 2 + 0.4, h + 0.8, "main_dark")
        g.box(rear + L - 1.5, rear + L + 0.5, cy - h / 2 - 0.4, cy + h / 2 + 0.4, h + 0.8, "warning")
        g.box(rear + 4.0, rear + 6.0, cy - h / 2 - 0.1, cy + h / 2 + 0.1, h + 0.2, "accent")
    # グリップ 2 本
    _grip(g, 0.0, "rubber", tilt=10, h=5.0)
    g.box(-1.0, 1.0, y0 - 0.2, cy - h / 2 + 0.01, 1.6, "main_dark")
    g.box(6.0, 7.6, y0 - 4.2, cy - h / 2, 1.4, "grip")
    # 照準器
    g.box(-2.0, 2.0, cy + h / 2, cy + h / 2 + 0.6, 1.2, "rail", xc=1.6)
    g.box(-1.5, 2.5, cy + h / 2 + 0.6, cy + h / 2 + 2.6, 1.8, "main_dark", xc=1.6)
    g.box(2.5, 2.6, cy + h / 2 + 0.8, cy + h / 2 + 2.4, 1.4, "lens", xc=1.6)
    if m.get("seeker"):
        g.box(-4.0, -1.0, cy + h / 2, cy + h / 2 + 1.8, 2.4, "main_dark", xc=-1.4)
        g.box(-1.1, -1.0, cy + h / 2 + 0.2, cy + h / 2 + 1.6, 2.0, "glow", xc=-1.4)
        g.box(rear + L - 6.0, rear + L - 4.0, cy + h / 2, cy + h / 2 + 1.2, 1.0, "metal_light")
    g.sight_y = cy + h / 2 + 1.6
    g.muzzle_y = cy
    g.front = rear + L + 0.5
    g.rear = rear - 0.5
    return g


def build_energy(m):
    g = Gun()
    body = float(m.get("body", 14))
    h = float(m.get("h", 5))
    barrel = float(m.get("barrel", 9))
    y0 = 1.6
    rear = -5.0
    front = rear + body
    # 流線形のシェル
    g.box(rear, front, y0, y0 + h, 2.6, "main")
    g.box(rear + 1.0, front - 1.0, y0 + h, y0 + h + 0.6, 2.0, "main")
    g.box(rear + 2.0, front - 2.0, y0 + h * 0.3, y0 + h * 0.7, 2.7, "glow")
    g.box(rear + 1.0, front, y0 - 0.2, y0 + 0.4, 2.2, "main_dark")
    _grip(g, 0.0, "pistol", tilt=12, h=5.0)
    by = y0 + h * 0.55
    if m.get("lance"):
        g.box(front, front + barrel, by - 0.6, by + 0.6, 1.2, "metal_light")
        g.box(front + 1.0, front + barrel - 1.0, by - 1.2, by + 1.2, 0.6, "glow")
        g.box(front + barrel - 1.0, front + barrel + 1.6, by - 0.4, by + 0.4, 0.8, "glow")
        end = front + barrel + 1.6
    elif m.get("coils"):
        g.box(front, front + barrel, by - 0.5, by + 0.5, 1.0, "metal_dark")
        for i in range(4):
            fx = front + 0.8 + i * 1.6
            g.box(fx, fx + 0.8, by - 1.6, by + 1.6, 3.2, "brass")
        g.box(front + barrel - 0.4, front + barrel + 1.0, by - 1.2, by + 1.2, 2.4, "glow")
        end = front + barrel + 1.0
    elif m.get("rails"):
        g.box(front, front + barrel, by + 0.5, by + 1.3, 2.2, "metal_dark")
        g.box(front, front + barrel, by - 1.3, by - 0.5, 2.2, "metal_dark")
        g.box(front, front + barrel - 0.5, by - 0.5, by + 0.5, 0.8, "glow")
        g.box(front + 2.0, front + 3.0, by - 1.8, by + 1.8, 2.6, "main")
        g.box(front + barrel - 3.0, front + barrel - 2.0, by - 1.8, by + 1.8, 2.6, "main")
        end = front + barrel
    elif m.get("ring"):
        # 重力ガン：先端の輪（4 枚の板で四角い輪を作る）と、中心の核
        g.box(front, front + barrel, by - 0.6, by + 0.6, 1.2, "metal_dark")
        rf = front + barrel
        g.box(rf, rf + 1.2, by + 2.2, by + 3.0, 6.0, "main")
        g.box(rf, rf + 1.2, by - 3.0, by - 2.2, 6.0, "main")
        g.box(rf, rf + 1.2, by - 2.2, by + 2.2, 0.8, "main", xc=2.6)
        g.box(rf, rf + 1.2, by - 2.2, by + 2.2, 0.8, "main", xc=-2.6)
        g.box(rf + 0.2, rf + 1.0, by - 2.3, by + 2.3, 0.3, "glow", xc=2.3)
        g.box(rf + 0.2, rf + 1.0, by - 2.3, by + 2.3, 0.3, "glow", xc=-2.3)
        g.box(rf - 0.5, rf + 0.5, by - 0.8, by + 0.8, 1.6, "glow")
        g.box(front + 0.5, front + barrel - 0.5, by - 1.6, by - 0.6, 0.6, "metal_light", xc=1.0)
        g.box(front + 0.5, front + barrel - 0.5, by - 1.6, by - 0.6, 0.6, "metal_light", xc=-1.0)
        end = rf + 1.2
    elif m.get("needle"):
        # 追尾ニードル：細い針と、結晶の弾倉
        g.box(front, front + barrel, by - 0.35, by + 0.35, 0.7, "metal_light")
        g.box(front + barrel, front + barrel + 2.0, by - 0.2, by + 0.2, 0.4, "glow")
        for i in range(3):
            fx = front + 0.6 + i * 1.8
            g.box(fx, fx + 1.0, by + 0.35, by + 1.6 - i * 0.3, 0.8, "glow")
        g.box(front - 1.0, front + 1.0, by - 1.4, by + 1.4, 2.8, "main_dark")
        end = front + barrel + 2.0
    elif m.get("dish"):
        # 音波砲：パラボラの皿（段々に広がる板）
        g.box(front, front + barrel, by - 0.8, by + 0.8, 1.6, "main_dark")
        df = front + barrel
        for i, (w, hh) in enumerate(((2.4, 2.4), (4.0, 4.0), (5.6, 5.6), (7.0, 7.0))):
            g.box(df + i * 0.8, df + i * 0.8 + 0.8, by - hh / 2, by + hh / 2, w, "main" if i % 2 == 0 else "main_dark")
        g.box(df + 0.4, df + 2.8, by - 0.6, by + 0.6, 1.2, "glow")
        end = df + 3.2
    # ---- 2.5 ----
    elif m.get("disc"):
        # ディスク：銃身の上に回転刃（八角形に近い板）を載せる
        g.box(front, front + barrel, by - 0.6, by + 0.6, 1.2, "metal_dark")
        cx = front + barrel * 0.5
        for w, hh in ((5.0, 1.6), (3.6, 3.0), (1.6, 4.4)):
            g.box(cx - w / 2, cx + w / 2, by + 0.6 + (4.4 - hh) / 2, by + 0.6 + (4.4 - hh) / 2 + hh, 0.5, "metal_light")
        g.box(cx - 0.6, cx + 0.6, by + 2.2, by + 3.4, 0.7, "glow")
        g.box(front + barrel - 0.6, front + barrel + 0.6, by - 1.0, by + 1.0, 2.0, "glow")
        end = front + barrel + 0.6
    elif m.get("orb"):
        # 球：銃口の先に光る核と、それを抱える 3 本の爪
        g.box(front, front + barrel, by - 0.9, by + 0.9, 1.8, "main_dark")
        of = front + barrel
        g.box(of + 0.4, of + 3.2, by - 1.4, by + 1.4, 2.8, "glow")
        g.box(of, of + 3.6, by + 1.6, by + 2.2, 0.8, "main")
        g.box(of, of + 3.6, by - 2.2, by - 1.6, 0.8, "main")
        g.box(of, of + 3.6, by - 0.4, by + 0.4, 0.6, "main", xc=1.9)
        end = of + 3.6
    elif m.get("pods"):
        # ミサイルポッド：前面に 2×3 の発射口
        pf = front + barrel
        g.box(front, pf, by - 2.4, by + 2.4, 4.2, "main")
        for i in range(3):
            for j in (-1, 1):
                g.box(pf - 0.2, pf + 0.4, by - 1.9 + i * 1.4, by - 0.9 + i * 1.4, 1.0, "metal_dark", xc=j * 1.0)
        g.box(pf - 0.4, pf, by - 2.5, by + 2.5, 4.4, "glow")
        end = pf + 0.4
    elif m.get("antenna"):
        # アンテナ：細い銃身と、上に立つ受信アンテナ
        g.box(front, front + barrel, by - 0.6, by + 0.6, 1.2, "metal_dark")
        g.box(front + barrel - 0.6, front + barrel + 0.6, by - 0.8, by + 0.8, 1.6, "glow")
        g.box(front - 2.0, front - 1.4, y0 + h + 0.6, y0 + h + 6.0, 0.6, "metal_light")
        g.box(front - 2.2, front - 1.2, y0 + h + 5.6, y0 + h + 6.4, 0.8, "glow")
        end = front + barrel + 0.6
    elif m.get("prism"):
        # プリズム：先端の三角柱（段々に細くなる板）
        g.box(front, front + barrel, by - 0.7, by + 0.7, 1.4, "metal_dark")
        pf = front + barrel
        for i, w in enumerate((3.0, 2.2, 1.4, 0.6)):
            g.box(pf + i * 0.7, pf + i * 0.7 + 0.7, by - w / 2, by + w / 2, w, "glow" if i % 2 == 0 else "metal_light")
        end = pf + 2.8
    elif m.get("tank"):
        # タンク：銃身の下に円筒のタンク
        g.box(front, front + barrel, by - 0.7, by + 0.7, 1.4, "metal_dark")
        g.box(front - 3.0, front + barrel - 1.0, by - 3.6, by - 1.2, 2.4, "main")
        g.box(front - 2.6, front + barrel - 1.4, by - 3.2, by - 1.6, 2.6, "glow")
        g.box(front + barrel - 0.6, front + barrel + 0.8, by - 1.0, by + 1.0, 2.0, "main_dark")
        end = front + barrel + 0.8
    else:
        g.box(front, front + barrel, by - 0.8, by + 0.8, 1.6, "main_dark")
        g.box(front + 0.5, front + barrel - 0.5, by - 0.9, by + 0.9, 1.0, "glow")
        g.box(front + barrel - 0.8, front + barrel, by - 1.2, by + 1.2, 2.2, "main")
        end = front + barrel
    _mag(g, 2.4, y0 + 0.1, "cells")
    top = y0 + h + 0.6
    _rail(g, rear + 2.0, front - 2.0, top)
    back = _stock(g, rear, y0 + h, m.get("stock", "fixed"), h)
    default = "scope" if m.get("scope") else "dot"
    if _look_kind(m, default) == "scope":
        _scope(g, rear + 1.0, top + 0.5, length=8.5, power=m.get("scope") or 4)
    else:
        _sight(g, m, rear + 1.5, front - 0.6, top + 0.5, default)
    g.muzzle_y = by
    g.front = end
    g.rear = back
    return g


def build_grapple(m):
    g = Gun()
    y0 = 1.6
    g.box(-3.0, 6.0, y0, y0 + 3.4, 2.6, "main")
    g.box(-1.0, 5.0, y0 + 0.4, y0 + 3.0, 3.6, "metal_dark")  # ウインチ
    g.box(-0.5, 4.5, y0 + 0.6, y0 + 2.8, 3.8, "brass")
    g.box(6.0, 10.0, y0 + 1.0, y0 + 2.4, 1.4, "metal_dark")
    # フック
    g.box(10.0, 11.0, y0 + 0.2, y0 + 3.2, 0.8, "metal_light")
    g.box(11.0, 12.4, y0 + 2.6, y0 + 3.2, 0.8, "metal_light")
    g.box(11.0, 12.4, y0 + 0.2, y0 + 0.8, 0.8, "metal_light")
    g.box(12.0, 12.6, y0 + 1.2, y0 + 2.2, 0.8, "metal_light")
    g.box(-3.0, 6.0, y0 + 3.4, y0 + 3.8, 1.0, "warning")
    _grip(g, 0.0, "rubber", tilt=14, h=5.0)
    _iron_sights(g, -2.4, 5.4, y0 + 3.4)
    g.muzzle_y = y0 + 1.7
    g.front = 12.6
    g.rear = -3.0
    return g


def build_flamer(m):
    """火炎放射器：本体・ノズル・点火口（光る）・背面のタンク 2 本"""
    g = Gun()
    y0 = 1.6
    body = float(m.get("body", 14))
    h = float(m.get("h", 4))
    barrel = float(m.get("barrel", 10))
    rear = -5.0
    front = rear + body
    g.box(rear, front, y0, y0 + h, 2.6, "main")
    g.box(rear + 1.0, front - 1.0, y0 + h, y0 + h + 0.5, 1.6, "main_dark")
    g.box(rear + 2.0, front - 2.0, y0 + h * 0.3, y0 + h * 0.6, 2.7, "accent")
    _grip(g, 0.0, "rubber", tilt=12, h=5.0)
    # 前方の保持グリップ
    g.box(front - 3.0, front - 1.6, y0 - 4.0, y0, 1.4, "grip")
    by = y0 + h * 0.55
    # ノズル（段々に細くなる）
    g.box(front, front + barrel * 0.5, by - 1.0, by + 1.0, 2.0, "metal_dark")
    g.box(front + barrel * 0.5, front + barrel, by - 0.7, by + 0.7, 1.4, "metal_dark")
    g.box(front + barrel - 0.6, front + barrel + 0.4, by - 0.9, by + 0.9, 1.8, "metal_light")
    # 点火口
    g.box(front + barrel - 1.6, front + barrel - 0.6, by - 1.6, by - 0.9, 0.8, "glow")
    # 燃料タンク 2 本（本体の下）
    for xc in (0.9, -0.9):
        g.box(rear + 1.0, front - 3.5, y0 - 3.4, y0 - 0.2, 1.7, "warning", xc=xc)
        g.box(rear + 0.6, rear + 1.2, y0 - 3.0, y0 - 0.6, 1.4, "metal_dark", xc=xc)
    # 燃料ホース
    g.box(front - 3.6, front - 0.5, y0 - 1.2, y0 - 0.6, 0.6, "rubber", xc=-1.4)
    # 熱遮蔽板
    g.box(front + 0.5, front + barrel * 0.5, by + 1.0, by + 1.4, 1.8, "metal_light")
    _iron_sights(g, rear + 1.0, front - 0.6, y0 + h + 0.5)
    back = _stock(g, rear, y0 + h, m.get("stock", "none"), h)
    g.muzzle_y = by
    g.front = front + barrel + 0.4
    g.rear = back
    return g


def build_mortar(m):
    """携行迫撃砲：短い砲身・底板・一脚。肩に担いで斜め上に撃つ"""
    g = Gun()
    y0 = 1.8
    L = float(m.get("body", 16))
    h = float(m.get("h", 4))
    rear = -8.0
    cy = y0 + h / 2 + 0.5
    # 砲身
    g.box(rear, rear + L, cy - h / 2, cy + h / 2, h, "main")
    g.box(rear + L - 1.2, rear + L + 0.2, cy - h / 2 - 0.3, cy + h / 2 + 0.3, h + 0.6, "metal_dark")
    g.box(rear + 3.0, rear + 4.0, cy - h / 2 - 0.2, cy + h / 2 + 0.2, h + 0.4, "accent")
    # 底板（後端）
    g.box(rear - 1.2, rear, cy - h / 2 - 2.0, cy + h / 2 + 2.0, h + 4.0, "metal_dark")
    g.box(rear - 1.4, rear - 1.2, cy - h / 2 - 1.2, cy + h / 2 + 1.2, h + 2.4, "rubber")
    # 一脚（下向き）
    g.box(rear + L * 0.55, rear + L * 0.55 + 0.8, cy - h / 2 - 6.0, cy - h / 2, 0.8, "metal_dark", rot=(-20, 0, 0), piv=(0, cy - h / 2, rear + L * 0.55))
    g.box(rear + L * 0.55 - 1.0, rear + L * 0.55 + 1.8, cy - h / 2 - 6.4, cy - h / 2 - 5.8, 2.6, "metal_dark", rot=(-20, 0, 0), piv=(0, cy - h / 2, rear + L * 0.55))
    # 照準器（横付け）と握り
    g.box(-1.0, 2.0, cy + h / 2, cy + h / 2 + 1.8, 1.2, "main_dark", xc=1.8)
    g.box(1.9, 2.0, cy + h / 2 + 0.3, cy + h / 2 + 1.5, 1.0, "lens", xc=1.8)
    _grip(g, 0.0, "rubber", tilt=10, h=5.0)
    g.box(-1.0, 1.0, y0 - 0.2, cy - h / 2 + 0.01, 1.6, "main_dark")
    g.box(4.0, 5.6, y0 - 3.8, cy - h / 2, 1.4, "grip")
    g.sight_y = cy + h / 2 + 1.2
    g.muzzle_y = cy
    g.front = rear + L + 0.2
    g.rear = rear - 1.4
    return g


BUILDERS = {
    "pistol": build_pistol, "revolver": build_revolver, "flare": build_flare,
    "smg": build_smg, "rifle": build_rifle, "sniper": build_sniper,
    "shotgun": build_shotgun, "double": build_double, "lmg": build_lmg,
    "rotary": build_rotary, "launcher": build_launcher, "tube": build_tube,
    "energy": build_energy, "grapple": build_grapple,
    "flamer": build_flamer, "mortar": build_mortar,
}


def build_weapon(wid, w, look=None):
    """look … 見た目グループ（None なら素のモデル）。光学の見た目違い ID のモデルはこれで作る"""
    m = dict(w["model"])
    if look is not None:
        m["_look"] = look
    g = BUILDERS[m["type"]](m)
    return g


# ---------------------------------------------------------------------------
#  Bedrock ジオメトリへの変換
# ---------------------------------------------------------------------------
def _h(s):
    return int(hashlib.md5(s.encode()).hexdigest()[:8], 16)


def _face_uv(mat_idx, w, h, seed):
    tx = (mat_idx % 4) * TILE
    ty = (mat_idx // 4) * TILE
    uw = min(abs(w), TILE)
    uh = min(abs(h), TILE)
    uw = max(uw, 0.25)
    uh = max(uh, 0.25)
    ox = (seed % 97) / 97.0 * (TILE - uw)
    oy = ((seed // 97) % 89) / 89.0 * (TILE - uh)
    return {"uv": [round(tx + ox, 3), round(ty + oy, 3)], "uv_size": [round(uw, 3), round(uh, 3)]}


def cube_to_bedrock(c, pivot, key):
    """ガンローカル Cube → Bedrock cube（pivot は Bedrock モデル座標）"""
    px, py, pz = pivot
    # ガンローカル (x, y, f) → Bedrock (x, y, z=-f)
    ox = px + c.x0
    oy = py + c.y0
    oz = pz - c.f1
    sx = c.x1 - c.x0
    sy = c.y1 - c.y0
    sz = c.f1 - c.f0
    m = MAT[c.mat]
    s = _h(key)
    uv = {
        "north": _face_uv(m, sx, sy, s),
        "south": _face_uv(m, sx, sy, s >> 3),
        "east": _face_uv(m, sz, sy, s >> 5),
        "west": _face_uv(m, sz, sy, s >> 7),
        "up": _face_uv(m, sx, sz, s >> 9),
        "down": _face_uv(m, sx, sz, s >> 11),
    }
    cube = {
        "origin": [round(ox, 4), round(oy, 4), round(oz, 4)],
        "size": [round(sx, 4), round(sy, 4), round(sz, 4)],
        "uv": uv,
    }
    if c.rot:
        pvx, pvy, pvf = c.piv if c.piv else (0, 0, 0)
        cube["pivot"] = [round(px + pvx, 4), round(py + pvy, 4), round(pz - pvf, 4)]
        cube["rotation"] = [c.rot[0], c.rot[1], c.rot[2]]
    return cube


# プレイヤー骨格（Bedrock Wiki の Attachable ガイド準拠）
PLAYER_SKELETON = [
    {"name": "root", "pivot": [0, 0, 0]},
    {"name": "waist", "parent": "root", "pivot": [0, 12, 0]},
    {"name": "body", "parent": "waist", "pivot": [0, 24, 0]},
    {"name": "head", "parent": "body", "pivot": [0, 24, 0]},
    {"name": "leftArm", "parent": "body", "pivot": [5, 22, 0]},
    {"name": "leftItem", "parent": "leftArm", "pivot": [6, 15, 1]},
    {"name": "rightArm", "parent": "body", "pivot": [-5, 22, 0]},
    {"name": "rightItem", "parent": "rightArm", "pivot": [-6, 15, 1]},
]
RIGHT_ITEM_PIVOT = (-6.0, 15.0, 1.0)


def weapon_geometry(wid, g):
    bones = [dict(b) for b in PLAYER_SKELETON]
    cubes = [cube_to_bedrock(c, RIGHT_ITEM_PIVOT, f"{wid}:{i}") for i, c in enumerate(g.cubes)]
    x0, x1, y0, y1, f0, f1 = g.bounds()
    bones.append({"name": "arsenal_gun", "parent": "rightItem", "pivot": list(RIGHT_ITEM_PIVOT), "cubes": cubes})
    ext = max(f1 - f0, y1 - y0) / 16.0
    return {
        "format_version": "1.16.0",
        "minecraft:geometry": [{
            "description": {
                "identifier": f"geometry.arsenal.{wid}",
                "texture_width": TEX_SIZE,
                "texture_height": TEX_SIZE,
                "visible_bounds_width": round(4 + ext * 2, 2),
                "visible_bounds_height": round(4 + ext * 2, 2),
                "visible_bounds_offset": [0, 1.25, 0],
            },
            "bones": bones,
        }],
    }


# ---------------------------------------------------------------------------
#  弾体（投擲物・ロケット等）の見た目
# ---------------------------------------------------------------------------
PROJECTILE_KINDS = ["frag", "impact", "smoke", "flash", "molotov", "sticky", "c4", "mine", "gl40", "rocket", "flare", "hook", "seeker",
                    # 2.0 で追加（番号は既存の後ろに足すだけ。既存の番号は変えない）
                    "knife", "gas", "emp", "cluster", "decoy", "snap", "mortar", "plasma", "needle", "bomblet", "blade", "missile",
                    # 2.6
                    "nuke"]
# 飛ぶ向きに合わせて回す種類（それ以外の投擲物はくるくる回る）
PROJECTILE_ORIENT = ["gl40", "rocket", "flare", "hook", "seeker", "knife", "mortar", "plasma", "needle", "blade", "missile"]
PROJECTILE_SPIN = ["frag", "impact", "smoke", "flash", "molotov", "sticky", "gas", "emp", "cluster", "decoy", "snap", "bomblet"]


def _pbox(cubes, x, y, z, sx, sy, sz, mat, key):
    c = Cube(x, x + sx, y, y + sy, -(z + sz), -z, mat)
    cubes.append(cube_to_bedrock(c, (0, 0, 0), key))


def projectile_geometry():
    geos = []
    for kind in PROJECTILE_KINDS:
        cubes = []
        k = lambda i: f"proj:{kind}:{i}"
        if kind in ("frag", "impact"):
            body = "main" if kind == "frag" else "warning"
            _pbox(cubes, -1.5, 0, -1.5, 3, 3.4, 3, body, k(0))
            _pbox(cubes, -1.8, 0.5, -1.2, 3.6, 2.4, 2.4, "main_dark", k(1))
            _pbox(cubes, -1.2, 0.5, -1.8, 2.4, 2.4, 3.6, "main_dark", k(2))
            _pbox(cubes, -0.6, 3.4, -0.6, 1.2, 1.0, 1.2, "metal_light", k(3))
            _pbox(cubes, 0.6, 2.6, -0.3, 1.4, 1.2, 0.6, "metal_light", k(4))
        elif kind in ("smoke", "flash"):
            _pbox(cubes, -1.3, 0, -1.3, 2.6, 4.2, 2.6, "main" if kind == "smoke" else "white", k(0))
            _pbox(cubes, -1.4, 1.2, -1.4, 2.8, 0.8, 2.8, "accent" if kind == "smoke" else "warning", k(1))
            _pbox(cubes, -0.6, 4.2, -0.6, 1.2, 0.8, 1.2, "metal_light", k(2))
        elif kind == "molotov":
            _pbox(cubes, -1.4, 0, -1.4, 2.8, 3.6, 2.8, "lens", k(0))
            _pbox(cubes, -0.6, 3.6, -0.6, 1.2, 2.0, 1.2, "lens", k(1))
            _pbox(cubes, -0.5, 5.6, -0.5, 1.0, 1.4, 1.0, "white", k(2))
            _pbox(cubes, -0.3, 7.0, -0.3, 0.6, 0.8, 0.6, "warning", k(3))
        elif kind == "sticky":
            _pbox(cubes, -1.5, 0, -1.5, 3, 3, 3, "glow", k(0))
            _pbox(cubes, -1.0, 0.5, -1.0, 2, 2, 2, "main_dark", k(1))
            _pbox(cubes, -0.4, 3.0, -0.4, 0.8, 0.8, 0.8, "warning", k(2))
        elif kind == "c4":
            _pbox(cubes, -2.5, 0, -1.5, 5, 1.6, 3, "white", k(0))
            _pbox(cubes, -1.0, 1.6, -0.8, 2, 0.4, 1.6, "main_dark", k(1))
            _pbox(cubes, -0.3, 2.0, -0.3, 0.6, 0.3, 0.6, "warning", k(2))
            _pbox(cubes, -2.6, 0.4, -1.6, 5.2, 0.4, 3.2, "rubber", k(3))
        elif kind == "mine":
            _pbox(cubes, -3, 0, -3, 6, 1.2, 6, "main", k(0))
            _pbox(cubes, -2, 1.2, -2, 4, 0.6, 4, "main_dark", k(1))
            _pbox(cubes, -0.6, 1.8, -0.6, 1.2, 0.4, 1.2, "warning", k(2))
        elif kind == "gl40":
            _pbox(cubes, -1.2, -1.2, -1.5, 2.4, 2.4, 3.0, "mag", k(0))
            _pbox(cubes, -1.0, -1.0, 1.5, 2.0, 2.0, 1.3, "brass", k(1))
            _pbox(cubes, -1.3, -1.3, -2.0, 2.6, 2.6, 0.6, "warning", k(2))
        elif kind in ("rocket", "seeker"):
            _pbox(cubes, -1.2, -1.2, -4, 2.4, 2.4, 9, "main", k(0))
            _pbox(cubes, -0.8, -0.8, -6, 1.6, 1.6, 2.0, "warning" if kind == "rocket" else "glow", k(1))
            _pbox(cubes, -2.4, -0.2, 3, 4.8, 0.4, 2.0, "main_dark", k(2))
            _pbox(cubes, -0.2, -2.4, 3, 0.4, 4.8, 2.0, "main_dark", k(3))
            _pbox(cubes, -0.9, -0.9, 5, 1.8, 1.8, 0.6, "metal_dark", k(4))
        elif kind == "flare":
            _pbox(cubes, -0.8, -0.8, -0.8, 1.6, 1.6, 1.6, "glow", k(0))
        elif kind == "hook":
            _pbox(cubes, -0.4, -0.4, -2.0, 0.8, 0.8, 4.0, "metal_light", k(0))
            _pbox(cubes, -1.6, -0.3, -1.8, 3.2, 0.6, 0.6, "metal_light", k(1))
            _pbox(cubes, -0.3, -1.6, -1.8, 0.6, 3.2, 0.6, "metal_light", k(2))
        elif kind == "knife":
            _pbox(cubes, -0.3, -0.5, -3.0, 0.6, 1.0, 4.0, "metal_light", k(0))
            _pbox(cubes, -0.4, -0.7, 1.0, 0.8, 1.4, 0.4, "metal_dark", k(1))
            _pbox(cubes, -0.35, -0.45, 1.4, 0.7, 0.9, 2.2, "grip", k(2))
        elif kind in ("gas", "emp", "decoy", "snap"):
            col = {"gas": "glow", "emp": "accent", "decoy": "main", "snap": "warning"}[kind]
            _pbox(cubes, -1.3, 0, -1.3, 2.6, 3.8, 2.6, col, k(0))
            _pbox(cubes, -1.4, 1.0, -1.4, 2.8, 0.7, 2.8, "main_dark", k(1))
            _pbox(cubes, -0.6, 3.8, -0.6, 1.2, 0.8, 1.2, "metal_light", k(2))
            if kind == "emp":
                _pbox(cubes, -0.3, 4.6, -0.3, 0.6, 1.2, 0.6, "lens", k(3))
            if kind == "snap":
                _pbox(cubes, -1.5, 2.2, -0.3, 3.0, 0.6, 0.6, "lens", k(3))
        elif kind == "cluster":
            _pbox(cubes, -1.8, 0, -1.8, 3.6, 3.2, 3.6, "main", k(0))
            for i, (x, z) in enumerate(((-1.9, -1.9), (0.9, -1.9), (-1.9, 0.9), (0.9, 0.9))):
                _pbox(cubes, x, 2.4, z, 1.0, 1.0, 1.0, "warning", k(1 + i))
            _pbox(cubes, -0.6, 3.2, -0.6, 1.2, 0.8, 1.2, "metal_light", k(6))
        elif kind == "bomblet":
            _pbox(cubes, -0.8, -0.8, -0.8, 1.6, 1.6, 1.6, "warning", k(0))
            _pbox(cubes, -0.5, 0.8, -0.5, 1.0, 0.5, 1.0, "main_dark", k(1))
        elif kind == "mortar":
            _pbox(cubes, -1.2, -1.2, -3.5, 2.4, 2.4, 6.0, "main", k(0))
            _pbox(cubes, -0.8, -0.8, -4.6, 1.6, 1.6, 1.1, "warning", k(1))
            _pbox(cubes, -1.6, -0.2, 2.5, 3.2, 0.4, 1.6, "main_dark", k(2))
            _pbox(cubes, -0.2, -1.6, 2.5, 0.4, 3.2, 1.6, "main_dark", k(3))
        elif kind == "plasma":
            _pbox(cubes, -1.0, -1.0, -1.0, 2.0, 2.0, 2.0, "glow", k(0))
            _pbox(cubes, -0.6, -0.6, 1.0, 1.2, 1.2, 1.6, "glow", k(1))
        elif kind == "needle":
            _pbox(cubes, -0.25, -0.25, -2.5, 0.5, 0.5, 4.0, "glow", k(0))
            _pbox(cubes, -0.5, -0.5, 1.5, 1.0, 1.0, 0.6, "accent", k(1))
        elif kind == "blade":
            _pbox(cubes, -0.25, -0.6, -2.4, 0.5, 1.2, 3.6, "metal_light", k(0))
            _pbox(cubes, -0.3, -0.3, 1.2, 0.6, 0.6, 0.6, "metal_dark", k(1))
        elif kind == "missile":
            _pbox(cubes, -1.0, -1.0, -4.5, 2.0, 2.0, 9.0, "white", k(0))
            _pbox(cubes, -0.7, -0.7, -5.8, 1.4, 1.4, 1.3, "warning", k(1))
            _pbox(cubes, -2.0, -0.2, 3.0, 4.0, 0.4, 1.5, "main_dark", k(2))
            _pbox(cubes, -0.2, -2.0, 3.0, 0.4, 4.0, 1.5, "main_dark", k(3))
            _pbox(cubes, -0.8, -0.8, 4.5, 1.6, 1.6, 0.5, "glow", k(4))
        elif kind == "nuke":
            # 戦術核：立てた太い円筒（段で丸みを出す）に黄色の帯と、上の起爆装置
            _pbox(cubes, -3.5, 0, -2.5, 7, 9, 5, "main", k(0))
            _pbox(cubes, -2.5, 0, -3.5, 5, 9, 7, "main", k(1))
            _pbox(cubes, -3.6, 3, -2.6, 7.2, 1.4, 5.2, "warning", k(2))
            _pbox(cubes, -2.6, 3, -3.6, 5.2, 1.4, 7.2, "warning", k(3))
            _pbox(cubes, -2.0, 9, -2.0, 4, 2, 4, "main_dark", k(4))
            _pbox(cubes, -1.2, 11, -1.2, 2.4, 1.2, 2.4, "metal_dark", k(5))
            _pbox(cubes, -0.4, 12.2, -0.4, 0.8, 0.8, 0.8, "glow", k(6))
            _pbox(cubes, -4.0, 0, -0.5, 8, 1.2, 1, "metal_dark", k(7))
            _pbox(cubes, -0.5, 0, -4.0, 1, 1.2, 8, "metal_dark", k(8))
        geos.append({
            "description": {
                "identifier": f"geometry.arsenal.proj_{kind}",
                "texture_width": TEX_SIZE, "texture_height": TEX_SIZE,
                "visible_bounds_width": 1, "visible_bounds_height": 1, "visible_bounds_offset": [0, 0.25, 0],
            },
            "bones": [{"name": "body", "pivot": [0, 0, 0], "cubes": cubes}],
        })
    return {"format_version": "1.16.0", "minecraft:geometry": geos}


# ---------------------------------------------------------------------------
#  訓練用ターゲット
# ---------------------------------------------------------------------------
def dummy_geometry():
    cubes = []
    def add(x, y, z, sx, sy, sz, mat, i, rot=None):
        c = Cube(x, x + sx, y, y + sy, -(z + sz), -z, mat)
        cubes.append(cube_to_bedrock(c, (0, 0, 0), f"dummy:{i}"))
    add(-1, 0, -1, 2, 14, 2, "wood", 0)          # 支柱
    add(-6, 0, -1, 12, 1, 2, "wood", 1)          # 足
    add(-1, 0, -6, 2, 1, 12, "wood", 2)
    add(-4, 13, -2, 8, 12, 4, "furniture", 3)    # 胴
    add(-4.2, 16, -2.2, 8.4, 6, 4.4, "accent", 4)
    add(-3, 25, -3, 6, 6, 6, "white", 5)         # 頭
    add(-1.5, 26.5, -3.3, 3, 3, 0.4, "warning", 6)
    add(-7.5, 21, -1, 3.5, 2, 2, "wood", 7)      # 腕
    add(4, 21, -1, 3.5, 2, 2, "wood", 8)
    return {"format_version": "1.16.0", "minecraft:geometry": [{
        "description": {"identifier": "geometry.arsenal.target_dummy", "texture_width": TEX_SIZE, "texture_height": TEX_SIZE,
                        "visible_bounds_width": 2, "visible_bounds_height": 3, "visible_bounds_offset": [0, 1.5, 0]},
        "bones": [{"name": "root", "pivot": [0, 0, 0]}, {"name": "body", "parent": "root", "pivot": [0, 0, 0], "cubes": cubes}],
    }]}


# ---------------------------------------------------------------------------
#  レイダー（プレイヤーと同じ骨格・64x64 スキンレイアウト）
# ---------------------------------------------------------------------------
def raider_geometry():
    bones = [
        {"name": "root", "pivot": [0, 0, 0]},
        {"name": "waist", "parent": "root", "pivot": [0, 12, 0]},
        {"name": "body", "parent": "waist", "pivot": [0, 24, 0], "cubes": [
            {"origin": [-4, 12, -2], "size": [8, 12, 4], "uv": [16, 16]},
            {"origin": [-4, 12, -2], "size": [8, 12, 4], "uv": [16, 32], "inflate": 0.35},
        ]},
        {"name": "head", "parent": "body", "pivot": [0, 24, 0], "cubes": [
            {"origin": [-4, 24, -4], "size": [8, 8, 8], "uv": [0, 0]},
            {"origin": [-4, 24, -4], "size": [8, 8, 8], "uv": [32, 0], "inflate": 0.6},
        ]},
        {"name": "leftArm", "parent": "body", "pivot": [5, 22, 0], "cubes": [
            {"origin": [4, 12, -2], "size": [4, 12, 4], "uv": [32, 48]},
            {"origin": [4, 12, -2], "size": [4, 12, 4], "uv": [48, 48], "inflate": 0.25},
        ]},
        {"name": "leftItem", "parent": "leftArm", "pivot": [6, 15, 1]},
        {"name": "rightArm", "parent": "body", "pivot": [-5, 22, 0], "cubes": [
            {"origin": [-8, 12, -2], "size": [4, 12, 4], "uv": [40, 16]},
            {"origin": [-8, 12, -2], "size": [4, 12, 4], "uv": [40, 32], "inflate": 0.25},
        ]},
        {"name": "rightItem", "parent": "rightArm", "pivot": [-6, 15, 1]},
        {"name": "leftLeg", "parent": "root", "pivot": [1.9, 12, 0], "cubes": [
            {"origin": [-0.1, 0, -2], "size": [4, 12, 4], "uv": [16, 48]},
            {"origin": [-0.1, 0, -2], "size": [4, 12, 4], "uv": [0, 48], "inflate": 0.25},
        ]},
        {"name": "rightLeg", "parent": "root", "pivot": [-1.9, 12, 0], "cubes": [
            {"origin": [-3.9, 0, -2], "size": [4, 12, 4], "uv": [0, 16]},
            {"origin": [-3.9, 0, -2], "size": [4, 12, 4], "uv": [0, 32], "inflate": 0.25},
        ]},
    ]
    return {"format_version": "1.16.0", "minecraft:geometry": [{
        "description": {"identifier": "geometry.arsenal.raider", "texture_width": 64, "texture_height": 64,
                        "visible_bounds_width": 2, "visible_bounds_height": 3, "visible_bounds_offset": [0, 1.5, 0]},
        "bones": bones,
    }]}
