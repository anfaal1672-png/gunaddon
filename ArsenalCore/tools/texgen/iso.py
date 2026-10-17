"""
ARSENAL CORE — 立体アイコン（斜め上から見た 3/4 ビュー）のレンダラー
防具・設置物・乗り物・補給箱など、側面図では形が分かりにくいもののアイコンに使う。
画家のアルゴリズムで面を奥から描き、面の向きで明暗を付けてから縁取りする。
"""
import math
import numpy as np
from PIL import Image, ImageDraw

from texgen.textures import outline, _clamp


def _rotate(p, rot, piv):
    """Bedrock の回転（度）をピボット中心に適用（X → Y → Z の順。アイコン用の近似）"""
    if not rot:
        return p
    x, y, z = p[0] - piv[0], p[1] - piv[1], p[2] - piv[2]
    rx, ry, rz = (math.radians(a) for a in rot)
    # X
    y, z = y * math.cos(rx) - z * math.sin(rx), y * math.sin(rx) + z * math.cos(rx)
    # Y
    x, z = x * math.cos(ry) + z * math.sin(ry), -x * math.sin(ry) + z * math.cos(ry)
    # Z
    x, y = x * math.cos(rz) - y * math.sin(rz), x * math.sin(rz) + y * math.cos(rz)
    return (x + piv[0], y + piv[1], z + piv[2])


FACES = [
    ((0, 2, 3, 1), (-1, 0, 0)),  # x-
    ((4, 5, 7, 6), (1, 0, 0)),   # x+
    ((0, 1, 5, 4), (0, -1, 0)),  # y-
    ((2, 6, 7, 3), (0, 1, 0)),   # y+
    ((0, 4, 6, 2), (0, 0, -1)),  # z-
    ((1, 3, 7, 5), (0, 0, 1)),   # z+
]


def render_iso_icon(cubes, tiles, size=32, yaw=215.0, pitch=28.0, margin=1):
    """cubes … modelgen.Cube（x, y, f）。モデル座標の z は -f。正面（-z）を左手前に見る"""
    ya, pa = math.radians(yaw), math.radians(pitch)
    cy_, sy_ = math.cos(ya), math.sin(ya)
    cp, sp = math.cos(pa), math.sin(pa)

    def view(p):
        x, y, z = p
        # ヨー（y 軸回り）
        x2 = x * cy_ - z * sy_
        z2 = x * sy_ + z * cy_
        # ピッチ（x 軸回り）
        y3 = y * cp - z2 * sp
        z3 = y * sp + z2 * cp
        return (-x2, -y3, z3)  # 画面 x, 画面 y（下向き）, 奥行き（大きいほど手前）

    light = np.array([0.45, 0.8, -0.4])
    light = light / np.linalg.norm(light)
    polys = []
    for c in cubes:
        xs = (c.x0, c.x1)
        ys = (c.y0, c.y1)
        zs = (-c.f1, -c.f0)
        corners = [(x, y, z) for x in xs for y in ys for z in zs]
        piv = (c.piv[0], c.piv[1], -c.piv[2]) if c.piv else (0.0, 0.0, 0.0)
        corners = [_rotate(p, c.rot, piv) for p in corners]
        vs = [view(p) for p in corners]
        tile = tiles[c.mat]
        avg = tile[:, :, :3].reshape(-1, 3).mean(axis=0)
        for idx, n in FACES:
            n2 = _rotate(n, c.rot, (0, 0, 0))
            vn = view(n2)
            if vn[2] <= 0.0:
                continue
            pts = [vs[i] for i in idx]
            depth = sum(p[2] for p in pts) / 4
            lum = 0.62 + 0.45 * max(0.0, float(np.dot(np.array(n2), light)))
            if n[1] > 0:
                lum += 0.12
            col = tuple(_clamp(v * lum) for v in avg)
            polys.append((depth, [(p[0], p[1]) for p in pts], col))
    if not polys:
        return Image.new("RGBA", (size, size), (0, 0, 0, 0))
    allp = [pt for _, pts, _ in polys for pt in pts]
    minx = min(p[0] for p in allp); maxx = max(p[0] for p in allp)
    miny = min(p[1] for p in allp); maxy = max(p[1] for p in allp)
    scale = min((size - 2 * margin - 1) / max(1e-3, maxx - minx), (size - 2 * margin - 1) / max(1e-3, maxy - miny))
    ox = (size - (maxx - minx) * scale) / 2 - minx * scale
    oy = (size - (maxy - miny) * scale) / 2 - miny * scale
    ss = 4
    S = size * ss
    canvas = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(canvas)
    polys.sort(key=lambda q: q[0])
    for _, pts, col in polys:
        d.polygon([((p[0] * scale + ox) * ss, (p[1] * scale + oy) * ss) for p in pts], fill=(*col, 255))
    small = canvas.resize((size, size), Image.BOX)
    arr = np.array(small)
    arr[:, :, 3] = np.where(arr[:, :, 3] > 100, 255, 0)
    return outline(Image.fromarray(arr, "RGBA"))
