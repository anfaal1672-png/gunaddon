"""
ARSENAL CORE — 手続き的テクスチャ生成（Pillow + numpy）
すべてのテクスチャ・アイコン・グリフ・パックアイコンをコードから生成する。
"""
import math
import random
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

TILE = 16

# ---------------------------------------------------------------------------
#  パレット
# ---------------------------------------------------------------------------
FINISHES = {
    "black": {"main": (52, 54, 58), "main_dark": (34, 35, 38), "furniture": (44, 46, 50)},
    "tan": {"main": (176, 152, 110), "main_dark": (60, 58, 56), "furniture": (160, 136, 96)},
    "od": {"main": (92, 100, 70), "main_dark": (48, 50, 44), "furniture": (80, 88, 60)},
    "arctic": {"main": (206, 210, 212), "main_dark": (70, 74, 80), "furniture": (180, 186, 190)},
    "steel": {"main": (150, 156, 164), "main_dark": (70, 74, 80), "furniture": (112, 78, 48)},
    "wood": {"main": (64, 66, 70), "main_dark": (38, 40, 44), "furniture": (128, 82, 44)},
    "orange": {"main": (220, 110, 40), "main_dark": (70, 60, 56), "furniture": (190, 90, 30)},
    "red": {"main": (140, 40, 36), "main_dark": (40, 36, 36), "furniture": (110, 30, 28)},
    "white": {"main": (226, 228, 232), "main_dark": (60, 64, 72), "furniture": (196, 200, 206)},
}
COMMON = {
    "metal_dark": (40, 42, 46),
    "metal_light": (168, 174, 182),
    "grip": (36, 36, 38),
    "rail": (30, 31, 34),
    "lens": (70, 130, 190),
    "glow": (80, 220, 255),
    "wood": (130, 84, 46),
    "brass": (206, 164, 68),
    "rubber": (26, 26, 28),
    "warning": (230, 170, 30),
    "white": (230, 230, 226),
}
TILE_ORDER = ["main", "main_dark", "furniture", "metal_dark", "metal_light", "grip", "rail", "mag",
              "accent", "lens", "glow", "wood", "brass", "rubber", "warning", "white"]


def _clamp(v):
    return max(0, min(255, int(v)))


def _shade(c, d):
    return tuple(_clamp(x + d) for x in c)


def _mix(a, b, t):
    return tuple(_clamp(a[i] * (1 - t) + b[i] * t) for i in range(3))


def _noise_tile(rng, base, amp=6, speck=0.0, speck_d=12):
    t = np.zeros((TILE, TILE, 4), dtype=np.uint8)
    for y in range(TILE):
        for x in range(TILE):
            d = rng.randint(-amp, amp)
            if speck and rng.random() < speck:
                d += rng.choice([-speck_d, speck_d])
            c = _shade(base, d)
            t[y, x] = (*c, 255)
    return t


def make_tile(kind, color, rng):
    if kind in ("main", "main_dark", "furniture"):
        t = _noise_tile(rng, color, 5, 0.04, 10)
        # 微細な傷
        for _ in range(3):
            x, y = rng.randrange(TILE), rng.randrange(TILE)
            L = rng.randint(2, 5)
            for i in range(L):
                if 0 <= x + i < TILE:
                    t[y, x + i, :3] = _shade(color, 14)
        return t
    if kind == "metal_dark":
        t = _noise_tile(rng, color, 4)
        for y in range(TILE):
            if y % 5 == 1:
                t[y, :, :3] = _shade(color, 14)
        return t
    if kind == "metal_light":
        t = _noise_tile(rng, color, 6, 0.05, 16)
        t[0, :, :3] = _shade(color, 30)
        return t
    if kind == "grip":
        t = _noise_tile(rng, color, 3)
        for y in range(TILE):
            for x in range(TILE):
                if (x + y) % 3 == 0 or (x - y) % 3 == 0:
                    t[y, x, :3] = _shade(color, 12)
        return t
    if kind == "rail":
        t = _noise_tile(rng, color, 3)
        for y in range(TILE):
            for x in range(TILE):
                if x % 2 == 0:
                    t[y, x, :3] = _shade(color, 26)
        return t
    if kind == "mag":
        t = _noise_tile(rng, color, 4)
        for y in range(TILE):
            if y % 4 == 0:
                t[y, :, :3] = _shade(color, -14)
            if y % 4 == 1:
                t[y, :, :3] = _shade(color, 10)
        return t
    if kind == "accent":
        return _noise_tile(rng, color, 4)
    if kind == "lens":
        t = np.zeros((TILE, TILE, 4), dtype=np.uint8)
        for y in range(TILE):
            for x in range(TILE):
                g = (x + y) / (2 * TILE)
                c = _mix((40, 70, 140), (140, 210, 255), g)
                if 3 <= x <= 5 and 3 <= y <= 5:
                    c = (230, 245, 255)
                t[y, x] = (*c, 255)
        return t
    if kind == "glow":
        t = np.zeros((TILE, TILE, 4), dtype=np.uint8)
        for y in range(TILE):
            for x in range(TILE):
                d = abs(x - 7.5) + abs(y - 7.5)
                c = _mix((255, 255, 255), color, min(1.0, d / 10.0))
                t[y, x] = (*c, 255)
        return t
    if kind == "wood":
        t = np.zeros((TILE, TILE, 4), dtype=np.uint8)
        off = [rng.random() * 6 for _ in range(4)]
        for y in range(TILE):
            for x in range(TILE):
                v = math.sin((y + math.sin(x * 0.35 + off[0]) * 1.4) * 1.3 + off[1])
                c = _shade(color, v * 12 + rng.randint(-3, 3))
                t[y, x] = (*c, 255)
        return t
    if kind == "brass":
        t = _noise_tile(rng, color, 6)
        t[:, 0, :3] = _shade(color, 30)
        return t
    if kind == "rubber":
        return _noise_tile(rng, color, 2)
    if kind == "warning":
        t = np.zeros((TILE, TILE, 4), dtype=np.uint8)
        for y in range(TILE):
            for x in range(TILE):
                c = color if ((x + y) // 3) % 2 == 0 else (30, 30, 30)
                t[y, x] = (*c, 255)
        return t
    if kind == "white":
        return _noise_tile(rng, color, 4)
    return _noise_tile(rng, color, 4)


def weapon_palette(w, tier_accent):
    m = w["model"]
    fin = FINISHES.get(m.get("finish", "black"), FINISHES["black"])
    pal = dict(COMMON)
    pal.update(fin)
    pal["mag"] = _shade(fin["main_dark"], 6)
    if m.get("finish") in ("tan", "arctic", "white"):
        pal["mag"] = _shade(fin["main"], -30)
    pal["accent"] = tuple(tier_accent)
    if m.get("glow"):
        pal["glow"] = tuple(m["glow"])
    if m.get("finish") == "wood":
        pal["furniture"] = COMMON["wood"]
    return pal


def weapon_texture(wid, w, tier_accent):
    rng = random.Random(wid)
    pal = weapon_palette(w, tier_accent)
    img = np.zeros((64, 64, 4), dtype=np.uint8)
    tiles = {}
    for i, kind in enumerate(TILE_ORDER):
        base = pal.get(kind, COMMON.get(kind, (128, 128, 128)))
        tk = kind
        if kind == "furniture" and w["model"].get("finish") == "wood":
            tk = "wood"
        t = make_tile(tk, base, rng)
        tiles[kind] = t
        tx, ty = (i % 4) * TILE, (i // 4) * TILE
        img[ty:ty + TILE, tx:tx + TILE] = t
    return Image.fromarray(img, "RGBA"), tiles


# ---------------------------------------------------------------------------
#  アイコン（3D モデルの側面を正射影で描画）
# ---------------------------------------------------------------------------
def _rot_points(c, pts):
    if not c.rot:
        return pts
    rx = math.radians(c.rot[0])
    pv = c.piv or (0, 0, 0)
    out = []
    for (x, y, f) in pts:
        yy, ff = y - pv[1], f - pv[2]
        y2 = yy * math.cos(rx) - ff * math.sin(rx)
        f2 = yy * math.sin(rx) + ff * math.cos(rx)
        out.append((x, y2 + pv[1], f2 + pv[2]))
    return out


def render_side_icon(g, tiles, size=32, margin=1, max_scale=3.0, angle=None):
    """ガンモデルを右側面から描画したピクセルアートアイコン。長物は斜めに配置して画面を有効活用する"""
    x0, x1, y0, y1, f0, f1 = g.bounds()
    L = f1 - f0
    H = y1 - y0
    if angle is None:
        angle = 0.0 if L / max(H, 1) < 2.2 else 38.0
    a = math.radians(angle)
    ca, sa = math.cos(a), math.sin(a)

    def proj(p):
        f, y = p[2], p[1]
        return (f * ca - y * sa, -f * sa - y * ca)

    polys = []
    allp = []
    cubes = sorted(g.cubes, key=lambda c: -(c.x0 + c.x1) / 2)
    for c in cubes:
        corners = [(x, y, f) for x in (c.x0, c.x1) for y in (c.y0, c.y1) for f in (c.f0, c.f1)]
        corners = _rot_points(c, corners)
        pts = _convex_hull([proj(p) for p in corners])
        polys.append((c, pts))
        allp.extend(pts)
    minx = min(p[0] for p in allp); maxx = max(p[0] for p in allp)
    miny = min(p[1] for p in allp); maxy = max(p[1] for p in allp)
    scale = min((size - 2 * margin - 1) / (maxx - minx), (size - 2 * margin - 1) / (maxy - miny), max_scale)
    ox = (size - (maxx - minx) * scale) / 2 - minx * scale
    oy = (size - (maxy - miny) * scale) / 2 - miny * scale
    ss = 4
    S = size * ss
    canvas = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    for c, pts in polys:
        pts2 = [(p[0] * scale + ox, p[1] * scale + oy) for p in pts]
        tile = tiles[c.mat]
        avg = tile[:, :, :3].reshape(-1, 3).mean(axis=0)
        mask = Image.new("L", (S, S), 0)
        ImageDraw.Draw(mask).polygon([(p[0] * ss, p[1] * ss) for p in pts2], fill=255)
        tex = Image.fromarray(np.tile(tile, (size // TILE + 1, size // TILE + 1, 1))[:size, :size], "RGBA").resize((S, S), Image.NEAREST)
        canvas.paste(tex, (0, 0), mask)
        # 上辺ハイライト（射影後の上側の辺）
        m = np.array(mask) > 0
        shifted_up = np.zeros_like(m)
        shifted_up[ss:, :] = m[:-ss, :]
        top_edge = m & ~shifted_up
        shifted_dn = np.zeros_like(m)
        shifted_dn[:-ss, :] = m[ss:, :]
        bot_edge = m & ~shifted_dn
        arr = np.array(canvas)
        hl = np.array([_clamp(v + 40) for v in avg] + [255], dtype=np.uint8)
        sh = np.array([_clamp(v - 34) for v in avg] + [255], dtype=np.uint8)
        arr[top_edge] = hl
        arr[bot_edge] = sh
        canvas = Image.fromarray(arr, "RGBA")
    small = canvas.resize((size, size), Image.NEAREST)
    return outline(small)


def _convex_hull(points):
    pts = sorted(set((round(p[0], 4), round(p[1], 4)) for p in points))
    if len(pts) <= 2:
        return pts
    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lower, upper = [], []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    return lower[:-1] + upper[:-1]


def outline(img, color=(18, 18, 22, 255)):
    a = np.array(img)
    alpha = a[:, :, 3] > 0
    h, w = alpha.shape
    out = a.copy()
    for y in range(h):
        for x in range(w):
            if alpha[y, x]:
                continue
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nx, ny = x + dx, y + dy
                if 0 <= nx < w and 0 <= ny < h and alpha[ny, nx]:
                    out[y, x] = color
                    break
    return Image.fromarray(out, "RGBA")


# ---------------------------------------------------------------------------
#  2D アイコン描画ヘルパ
# ---------------------------------------------------------------------------
def new_icon(size=32):
    return Image.new("RGBA", (size, size), (0, 0, 0, 0))


def rect(d, x0, y0, x1, y1, c, hl=True):
    d.rectangle([x0, y0, x1, y1], fill=c + (255,) if len(c) == 3 else c)
    if hl and y1 > y0:
        d.line([x0, y0, x1, y0], fill=_shade(c[:3], 36) + (255,))
        d.line([x0, y1, x1, y1], fill=_shade(c[:3], -30) + (255,))


def ammo_icon(item):
    img = new_icon()
    d = ImageDraw.Draw(img)
    base = tuple(item["color"])
    shape = item["shape"]
    stripe = tuple(item["stripe"]) if item.get("stripe") else None
    brass = (206, 164, 68)
    tip = (176, 110, 60)
    if shape in ("pistol", "rifle", "rifle_long", "magnum", "sniper"):
        n = {"pistol": 3, "rifle": 3, "rifle_long": 2, "magnum": 2, "sniper": 1}[shape]
        L = {"pistol": 13, "rifle": 20, "rifle_long": 23, "magnum": 16, "sniper": 27}[shape]
        wdt = {"pistol": 5, "rifle": 5, "rifle_long": 6, "magnum": 6, "sniper": 7}[shape]
        for i in range(n):
            x = 5 + i * (22 // max(1, n)) if n > 1 else 12
            ybot = 29 - i * 1
            ytop = ybot - L
            body_top = ytop + int(L * 0.38)
            rect(d, x, body_top, x + wdt - 1, ybot, brass)
            # 弾頭
            d.polygon([(x, body_top), (x + wdt - 1, body_top), (x + wdt - 1, ytop + 3), (x + (wdt - 1) / 2, ytop), (x, ytop + 3)], fill=tip + (255,))
            d.line([x + 1, body_top - 1, x + 1, ytop + 3], fill=_shade(tip, 30) + (255,))
            d.line([x, ybot - 2, x + wdt - 1, ybot - 2], fill=_shade(brass, -40) + (255,))
            if stripe:
                d.line([x, body_top + 2, x + wdt - 1, body_top + 2], fill=stripe + (255,))
                d.line([x, body_top + 3, x + wdt - 1, body_top + 3], fill=stripe + (255,))
                d.polygon([(x, body_top), (x + wdt - 1, body_top), (x + wdt - 1, ytop + 3), (x + (wdt - 1) / 2, ytop), (x, ytop + 3)], fill=_mix(tip, stripe, 0.6) + (255,))
    elif shape == "shell":
        for i in range(2):
            x = 7 + i * 10
            rect(d, x, 8, x + 7, 24, base)
            rect(d, x, 24, x + 7, 29, brass)
            d.line([x + 1, 9, x + 1, 23], fill=_shade(base, 40) + (255,))
            if stripe:
                rect(d, x, 12, x + 7, 13, stripe, hl=False)
    elif shape == "grenade40":
        rect(d, 9, 6, 22, 18, (110, 120, 70))
        rect(d, 9, 18, 22, 28, brass)
        d.ellipse([9, 2, 22, 12], fill=(110, 120, 70, 255))
        rect(d, 9, 15, 22, 16, (230, 170, 30), hl=False)
    elif shape == "rocket":
        d.polygon([(16, 1), (21, 8), (21, 24), (11, 24), (11, 8)], fill=(90, 110, 80, 255))
        rect(d, 11, 24, 21, 28, (50, 52, 56))
        d.polygon([(11, 20), (6, 30), (11, 28)], fill=(50, 52, 56, 255))
        d.polygon([(21, 20), (26, 30), (21, 28)], fill=(50, 52, 56, 255))
        rect(d, 11, 10, 21, 11, (230, 170, 30), hl=False)
        d.line([13, 8, 13, 22], fill=(130, 150, 118, 255))
    elif shape == "cell":
        rect(d, 9, 5, 22, 28, (60, 64, 72))
        rect(d, 11, 8, 20, 25, (60, 200, 230))
        rect(d, 13, 2, 18, 5, (170, 176, 184))
        for y in range(10, 24, 4):
            d.line([12, y, 19, y], fill=(200, 250, 255, 255))
    elif shape == "flare":
        rect(d, 10, 8, 21, 24, (230, 90, 50))
        rect(d, 10, 24, 21, 28, brass)
        rect(d, 10, 11, 21, 12, (250, 220, 120), hl=False)
        d.line([12, 9, 12, 23], fill=(255, 150, 110, 255))
    return outline(img)


def attachment_icon(aid, a):
    img = new_icon()
    d = ImageDraw.Draw(img)
    dk = (48, 50, 54)
    md = (80, 84, 90)
    lt = (160, 166, 172)
    slot = a["slot"]
    if slot == "optic":
        if a.get("optic") in ("reddot", "holo"):
            rect(d, 6, 20, 26, 24, dk)
            rect(d, 8, 9, 24, 20, md)
            rect(d, 11, 11, 21, 18, (60, 110, 170))
            d.point((16, 14), fill=(255, 40, 40, 255) if a["optic"] == "reddot" else (255, 120, 40, 255))
            d.point((15, 14), fill=(200, 30, 30, 255))
            if a["optic"] == "holo":
                d.ellipse([13, 11, 19, 17], outline=(255, 120, 40, 255))
        else:
            big = {"scope2": 0, "scope4": 1, "scope8": 2, "thermal": 1}[a["optic"]]
            rect(d, 3, 12 - big, 29, 19 + big, md)
            rect(d, 2, 10 - big, 7, 21 + big, dk)
            rect(d, 25, 9 - big, 30, 22 + big, dk)
            rect(d, 14, 7 - big, 18, 12 - big, lt)
            rect(d, 9, 20 + big, 12, 25, dk)
            rect(d, 20, 20 + big, 23, 25, dk)
            if a["optic"] == "thermal":
                rect(d, 26, 11, 29, 20, (230, 90, 40), hl=False)
            else:
                rect(d, 27, 11 - big, 29, 20 + big, (70, 130, 190), hl=False)
    elif slot == "muzzle":
        if aid == "muzzle_suppressor":
            rect(d, 3, 12, 28, 20, dk)
            for x in range(6, 27, 5):
                d.line([x, 13, x, 19], fill=md + (255,))
        elif aid == "muzzle_compensator":
            rect(d, 8, 12, 24, 20, md)
            for x in (12, 16, 20):
                rect(d, x, 10, x + 1, 12, dk, hl=False)
        elif aid == "muzzle_brake":
            rect(d, 6, 11, 26, 21, dk)
            rect(d, 11, 10, 13, 22, lt, hl=False)
            rect(d, 18, 10, 20, 22, lt, hl=False)
        elif aid == "muzzle_flash_hider":
            rect(d, 8, 13, 26, 19, dk)
            for x in (14, 18, 22):
                d.line([x, 13, x, 19], fill=(20, 20, 20, 255))
        else:
            d.polygon([(6, 12), (26, 10), (26, 22), (6, 20)], fill=md + (255,))
            rect(d, 4, 13, 7, 19, dk)
    elif slot == "underbarrel":
        if aid == "grip_vertical":
            rect(d, 8, 6, 24, 10, dk)
            rect(d, 13, 10, 19, 28, md)
            for y in range(12, 27, 3):
                d.line([13, y, 19, y], fill=dk + (255,))
        elif aid == "grip_angled":
            rect(d, 4, 8, 28, 12, dk)
            d.polygon([(10, 12), (26, 12), (12, 24), (6, 24)], fill=md + (255,))
        elif aid == "bipod":
            rect(d, 11, 5, 21, 10, dk)
            d.line([13, 10, 5, 28], fill=md + (255,), width=2)
            d.line([19, 10, 27, 28], fill=md + (255,), width=2)
            rect(d, 4, 27, 7, 29, dk, hl=False)
            rect(d, 25, 27, 28, 29, dk, hl=False)
        elif aid == "ub_launcher":
            rect(d, 2, 10, 24, 18, (92, 100, 70))
            rect(d, 24, 9, 29, 19, dk)
            rect(d, 8, 18, 13, 26, dk)
        else:
            rect(d, 2, 11, 28, 16, dk)
            rect(d, 4, 17, 26, 20, dk)
            rect(d, 8, 20, 12, 27, md)
    elif slot == "mag":
        if aid == "mag_drum":
            d.ellipse([5, 8, 27, 30], fill=md + (255,), outline=dk + (255,))
            d.ellipse([11, 14, 21, 24], fill=dk + (255,))
            rect(d, 13, 2, 19, 9, md)
        else:
            L = 26 if aid == "mag_extended" else 20
            d.polygon([(11, 3), (20, 3), (22, 3 + L), (13, 3 + L)], fill=md + (255,))
            for y in range(6, 3 + L, 4):
                d.line([12, y, 21, y], fill=dk + (255,))
            rect(d, 12, 1, 19, 3, (206, 164, 68), hl=False)
            if aid == "mag_quick":
                rect(d, 12, 3 + L, 23, 3 + L + 2, (230, 90, 40))
    elif slot == "laser":
        rect(d, 6, 12, 22, 20, dk)
        rect(d, 22, 13, 26, 19, md)
        if aid == "laser_tactical":
            d.line([26, 16, 31, 16], fill=(255, 40, 40, 255))
            rect(d, 23, 15, 25, 17, (255, 60, 60), hl=False)
        else:
            rect(d, 23, 14, 25, 18, (255, 250, 200), hl=False)
            d.polygon([(26, 14), (31, 10), (31, 22), (26, 18)], fill=(255, 250, 200, 120))
    elif slot == "stock":
        if aid == "stock_light":
            d.line([28, 12, 8, 12], fill=md + (255,), width=2)
            d.line([28, 18, 10, 20], fill=md + (255,), width=2)
            rect(d, 4, 9, 8, 24, dk)
        else:
            d.polygon([(28, 10), (28, 16), (8, 24), (4, 24), (4, 9)], fill=md + (255,))
            rect(d, 2, 8, 5, 25, dk)
    return outline(img)


def throwable_icon(tid, t):
    img = new_icon()
    d = ImageDraw.Draw(img)
    k = t["kind"]
    dk = (48, 50, 54)
    lt = (170, 176, 184)
    if k in ("frag", "impact"):
        col = (86, 98, 64) if k == "frag" else (200, 150, 30)
        d.ellipse([7, 9, 25, 29], fill=col + (255,))
        for y in (14, 19, 24):
            d.line([9, y, 23, y], fill=_shade(col, -30) + (255,))
        for x in (12, 16, 20):
            d.line([x, 10, x, 28], fill=_shade(col, -30) + (255,))
        rect(d, 13, 5, 19, 10, lt)
        d.ellipse([19, 3, 25, 9], outline=lt + (255,))
        d.line([18, 6, 22, 16], fill=lt + (255,))
    elif k in ("smoke", "flash"):
        col = (120, 130, 140) if k == "smoke" else (220, 222, 226)
        rect(d, 10, 8, 22, 29, col)
        rect(d, 10, 13, 22, 15, (80, 180, 90) if k == "smoke" else (230, 170, 30), hl=False)
        rect(d, 13, 4, 19, 8, lt)
        d.line([19, 6, 24, 14], fill=lt + (255,))
    elif k == "molotov":
        d.polygon([(10, 14), (22, 14), (24, 29), (8, 29)], fill=(90, 150, 90, 200))
        rect(d, 13, 6, 19, 14, (90, 150, 90))
        rect(d, 13, 2, 19, 6, (230, 230, 220))
        d.polygon([(14, 2), (18, 2), (16, -2)], fill=(255, 160, 40, 255))
        rect(d, 10, 20, 22, 28, (200, 110, 40), hl=False)
    elif k == "sticky":
        d.ellipse([7, 7, 25, 25], fill=(120, 200, 90, 255))
        d.ellipse([11, 11, 21, 21], fill=dk + (255,))
        rect(d, 15, 3, 17, 7, (230, 170, 30), hl=False)
        for (x, y) in ((6, 16), (26, 16), (16, 26)):
            d.point((x, y), fill=(120, 200, 90, 255))
    elif k == "c4":
        rect(d, 4, 10, 28, 24, (232, 232, 222))
        rect(d, 4, 14, 28, 16, (40, 40, 40), hl=False)
        rect(d, 11, 7, 21, 10, dk)
        d.point((20, 8), fill=(255, 40, 40, 255))
        d.line([6, 24, 4, 29], fill=(200, 40, 40, 255))
        d.line([9, 24, 9, 29], fill=(40, 80, 200, 255))
    elif k == "mine":
        d.ellipse([3, 12, 29, 26], fill=(92, 100, 70, 255))
        d.ellipse([9, 10, 23, 18], fill=(70, 76, 56, 255))
        rect(d, 14, 9, 18, 12, (230, 170, 30), hl=False)
    return outline(img)


def material_icon(mid):
    img = new_icon()
    d = ImageDraw.Draw(img)
    if mid == "steel_ingot":
        d.polygon([(4, 20), (10, 12), (28, 12), (22, 20)], fill=(150, 158, 170, 255))
        d.polygon([(4, 20), (22, 20), (22, 25), (4, 25)], fill=(110, 118, 130, 255))
        d.polygon([(22, 20), (28, 12), (28, 17), (22, 25)], fill=(90, 96, 108, 255))
        d.line([11, 13, 26, 13], fill=(210, 216, 226, 255))
    elif mid == "precision_parts":
        d.ellipse([4, 4, 20, 20], fill=(170, 176, 184, 255))
        d.ellipse([9, 9, 15, 15], fill=(60, 62, 66, 255))
        for i in range(8):
            a = i * math.pi / 4
            x, y = 12 + math.cos(a) * 9, 12 + math.sin(a) * 9
            d.rectangle([x - 1, y - 1, x + 1, y + 1], fill=(170, 176, 184, 255))
        rect(d, 18, 18, 28, 21, (206, 164, 68))
        rect(d, 20, 22, 23, 29, (140, 146, 156))
    elif mid == "polymer":
        d.rounded_rectangle([5, 7, 27, 25], 4, fill=(40, 42, 46, 255))
        d.rounded_rectangle([8, 10, 24, 22], 3, fill=(70, 74, 80, 255))
        d.line([9, 11, 22, 11], fill=(110, 116, 124, 255))
    elif mid == "energy_core":
        d.polygon([(16, 2), (27, 16), (16, 30), (5, 16)], fill=(40, 120, 160, 255))
        d.polygon([(16, 7), (23, 16), (16, 25), (9, 16)], fill=(90, 220, 255, 255))
        d.polygon([(16, 11), (19, 16), (16, 21), (13, 16)], fill=(230, 255, 255, 255))
    return outline(img)


def tool_icon(tid):
    img = new_icon()
    d = ImageDraw.Draw(img)
    if tid == "field_manual":
        rect(d, 6, 4, 26, 28, (74, 88, 60))
        rect(d, 8, 4, 9, 28, (50, 60, 40), hl=False)
        rect(d, 12, 9, 23, 12, (230, 170, 30), hl=False)
        d.ellipse([13, 15, 22, 24], outline=(220, 220, 210, 255))
        d.line([17, 14, 17, 25], fill=(220, 220, 210, 255))
        d.line([12, 19, 23, 19], fill=(220, 220, 210, 255))
        rect(d, 24, 5, 26, 27, (230, 226, 210), hl=False)
    elif tid == "detonator":
        rect(d, 9, 10, 23, 29, (60, 62, 66))
        rect(d, 11, 13, 21, 18, (40, 140, 60))
        d.ellipse([12, 20, 20, 27], fill=(200, 40, 40, 255))
        rect(d, 19, 2, 21, 10, (170, 176, 184), hl=False)
        d.ellipse([18, 0, 22, 4], fill=(255, 60, 60, 255))
    elif tid == "repair_kit":
        rect(d, 4, 10, 28, 27, (170, 50, 40))
        rect(d, 12, 6, 20, 10, (60, 62, 66))
        rect(d, 4, 16, 28, 18, (110, 30, 26), hl=False)
        rect(d, 14, 14, 18, 20, (230, 230, 220), hl=False)
    elif tid == "target_dummy":
        d.ellipse([4, 4, 28, 28], fill=(230, 230, 226, 255))
        d.ellipse([8, 8, 24, 24], fill=(200, 40, 40, 255))
        d.ellipse([12, 12, 20, 20], fill=(230, 230, 226, 255))
        d.ellipse([14, 14, 18, 18], fill=(200, 40, 40, 255))
    return outline(img)


# ---------------------------------------------------------------------------
#  ブロック
# ---------------------------------------------------------------------------
def block_textures():
    rng = random.Random(7)
    out = {}
    # 兵器作業台：上面
    img = Image.new("RGBA", (16, 16))
    a = np.array(_noise_tile(rng, (86, 90, 96), 5, 0.05, 10))
    img = Image.fromarray(a, "RGBA")
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, 15, 15], outline=(40, 42, 46, 255))
    d.rectangle([3, 6, 13, 8], fill=(40, 42, 46, 255))
    d.rectangle([4, 9, 5, 12], fill=(40, 42, 46, 255))
    d.rectangle([11, 3, 12, 5], fill=(206, 164, 68, 255))
    d.point((2, 2), fill=(170, 176, 184, 255))
    d.point((13, 13), fill=(170, 176, 184, 255))
    out["arsenal_bench_top"] = img
    # 側面
    a = np.array(_noise_tile(rng, (74, 80, 60), 4))
    img = Image.fromarray(a, "RGBA")
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, 15, 2], fill=(60, 62, 66, 255))
    d.rectangle([2, 5, 13, 12], fill=(56, 60, 46, 255))
    d.rectangle([2, 5, 13, 12], outline=(40, 42, 36, 255))
    d.line([4, 8, 11, 8], fill=(170, 176, 184, 255))
    d.rectangle([6, 9, 9, 10], fill=(230, 170, 30, 255))
    d.rectangle([0, 15, 15, 15], fill=(40, 42, 36, 255))
    out["arsenal_bench_side"] = img
    # 底面
    out["arsenal_bench_bottom"] = Image.fromarray(np.array(_noise_tile(rng, (60, 62, 66), 4)), "RGBA")
    # 弾薬製造機
    a = np.array(_noise_tile(rng, (120, 110, 90), 5))
    img = Image.fromarray(a, "RGBA")
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, 15, 15], outline=(60, 54, 44, 255))
    d.ellipse([4, 4, 11, 11], fill=(70, 72, 76, 255))
    d.ellipse([6, 6, 9, 9], fill=(206, 164, 68, 255))
    out["arsenal_press_top"] = img
    a = np.array(_noise_tile(rng, (100, 92, 78), 4))
    img = Image.fromarray(a, "RGBA")
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, 15, 15], outline=(60, 54, 44, 255))
    for x in (3, 6, 9, 12):
        d.rectangle([x, 4, x + 1, 11], fill=(206, 164, 68, 255))
        d.rectangle([x, 4, x + 1, 5], fill=(176, 110, 60, 255))
    d.rectangle([2, 12, 13, 13], fill=(60, 54, 44, 255))
    out["arsenal_press_side"] = img
    # 弾薬箱
    a = np.array(_noise_tile(rng, (84, 96, 62), 4))
    img = Image.fromarray(a, "RGBA")
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, 15, 15], outline=(50, 58, 36, 255))
    d.rectangle([0, 7, 15, 8], fill=(50, 58, 36, 255))
    d.rectangle([3, 3, 12, 5], fill=(230, 200, 60, 255))
    d.rectangle([6, 10, 9, 12], fill=(170, 176, 184, 255))
    out["arsenal_crate_side"] = img
    a = np.array(_noise_tile(rng, (84, 96, 62), 4))
    img = Image.fromarray(a, "RGBA")
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, 15, 15], outline=(50, 58, 36, 255))
    d.line([0, 0, 15, 15], fill=(60, 70, 42, 255))
    d.line([15, 0, 0, 15], fill=(60, 70, 42, 255))
    d.rectangle([5, 6, 10, 9], fill=(230, 200, 60, 255))
    out["arsenal_crate_top"] = img
    return out


# ---------------------------------------------------------------------------
#  パーティクル用アトラス（64x64、8x8 のセル）
# ---------------------------------------------------------------------------
PARTICLE_CELLS = {
    "soft": (0, 0), "flash": (1, 0), "spark": (2, 0), "smoke0": (3, 0), "smoke1": (4, 0), "smoke2": (5, 0), "smoke3": (6, 0), "ring": (7, 0),
    "casing": (0, 1), "shell": (1, 1), "square": (2, 1), "tracer": (3, 1), "star": (4, 1), "flake": (5, 1), "bolt": (6, 1), "dot": (7, 1),
    "flame0": (0, 2), "flame1": (1, 2), "flame2": (2, 2), "flame3": (3, 2), "drop": (4, 2), "debris": (5, 2), "hex": (6, 2), "cross": (7, 2),
}


def particle_atlas():
    img = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    px = img.load()
    def cell(name):
        cx, cy = PARTICLE_CELLS[name]
        return cx * 8, cy * 8
    # soft: 放射グラデーション
    ox, oy = cell("soft")
    for y in range(8):
        for x in range(8):
            d = math.hypot(x - 3.5, y - 3.5) / 4.0
            a = _clamp(255 * max(0, 1 - d) ** 1.5)
            px[ox + x, oy + y] = (255, 255, 255, a)
    ox, oy = cell("flash")
    for y in range(8):
        for x in range(8):
            d = math.hypot(x - 3.5, y - 3.5)
            star = max(0, 1 - min(abs(x - 3.5), abs(y - 3.5)) / 1.2) * max(0, 1 - d / 4.5)
            a = max(max(0, 1 - d / 3.0), star)
            px[ox + x, oy + y] = (255, 255, 255, _clamp(255 * a))
    ox, oy = cell("spark")
    for y in range(8):
        for x in range(8):
            d = abs(x - 3.5) + abs(y - 3.5)
            px[ox + x, oy + y] = (255, 255, 255, _clamp(255 * max(0, 1 - d / 3.2)))
    rng = random.Random(3)
    for i in range(4):
        ox, oy = cell(f"smoke{i}")
        r = 3.8 - i * 0.2
        for y in range(8):
            for x in range(8):
                d = math.hypot(x - 3.5, y - 3.5) / r
                n = rng.random() * 0.35
                a = max(0.0, 1 - d - n * (0.5 + i * 0.2))
                px[ox + x, oy + y] = (255, 255, 255, _clamp(210 * a))
    ox, oy = cell("ring")
    for y in range(8):
        for x in range(8):
            d = math.hypot(x - 3.5, y - 3.5)
            a = max(0, 1 - abs(d - 3.0) / 0.9)
            px[ox + x, oy + y] = (255, 255, 255, _clamp(255 * a))
    ox, oy = cell("casing")
    for y in range(8):
        for x in range(8):
            if 2 <= x <= 5 and 1 <= y <= 6:
                c = (220, 176, 80) if x != 2 else (250, 220, 130)
                px[ox + x, oy + y] = (*c, 255)
    ox, oy = cell("shell")
    for y in range(8):
        for x in range(8):
            if 2 <= x <= 5 and 0 <= y <= 7:
                c = (190, 40, 40) if y < 5 else (220, 176, 80)
                px[ox + x, oy + y] = (*c, 255)
    ox, oy = cell("square")
    for y in range(1, 7):
        for x in range(1, 7):
            px[ox + x, oy + y] = (255, 255, 255, 255)
    ox, oy = cell("tracer")
    for y in range(8):
        for x in range(8):
            a = max(0, 1 - abs(y - 3.5) / 2.2) * (0.35 + 0.65 * x / 7)
            px[ox + x, oy + y] = (255, 255, 255, _clamp(255 * a))
    ox, oy = cell("star")
    for y in range(8):
        for x in range(8):
            if x == 3 or y == 3 or x == 4 or y == 4:
                d = max(abs(x - 3.5), abs(y - 3.5))
                px[ox + x, oy + y] = (255, 255, 255, _clamp(255 * (1 - d / 4.2)))
    ox, oy = cell("flake")
    for (x, y) in ((3, 0), (4, 0), (3, 7), (4, 7), (0, 3), (0, 4), (7, 3), (7, 4), (3, 3), (4, 4), (3, 4), (4, 3), (1, 1), (6, 6), (6, 1), (1, 6), (2, 2), (5, 5), (5, 2), (2, 5)):
        px[ox + x, oy + y] = (255, 255, 255, 255)
    ox, oy = cell("bolt")
    pts = [(0, 3), (1, 2), (2, 3), (3, 4), (4, 3), (5, 2), (6, 4), (7, 3)]
    for (x, y) in pts:
        px[ox + x, oy + y] = (255, 255, 255, 255)
        px[ox + x, oy + min(7, y + 1)] = (255, 255, 255, 140)
    ox, oy = cell("dot")
    for y in range(8):
        for x in range(8):
            d = math.hypot(x - 3.5, y - 3.5)
            px[ox + x, oy + y] = (255, 255, 255, _clamp(255 * max(0, 1 - d / 2.2)))
    for i in range(4):
        ox, oy = cell(f"flame{i}")
        for y in range(8):
            for x in range(8):
                w = (8 - y) / 8 * (1.0 - i * 0.12)
                d = abs(x - 3.5) / 3.5
                a = max(0, (1 - d / max(0.25, 1.05 - w * 0.9))) * (0.4 + y / 10)
                px[ox + x, oy + y] = (255, 255, 255, _clamp(255 * min(1, a)))
    ox, oy = cell("drop")
    for y in range(8):
        for x in range(8):
            d = math.hypot(x - 3.5, (y - 4.5) * 1.1)
            a = max(0, 1 - d / 3.0)
            if y < 3 and abs(x - 3.5) > (3 - y) * 0.6:
                a = 0
            px[ox + x, oy + y] = (255, 255, 255, _clamp(255 * min(1, a * 1.8)))
    ox, oy = cell("debris")
    for (x, y) in ((2, 2), (3, 2), (4, 3), (2, 3), (3, 3), (5, 5), (4, 4), (3, 4)):
        px[ox + x, oy + y] = (255, 255, 255, 255)
    ox, oy = cell("hex")
    for y in range(8):
        for x in range(8):
            d = abs(x - 3.5) + abs(y - 3.5) * 0.7
            a = 1.0 if 2.3 < d < 3.4 else 0.0
            px[ox + x, oy + y] = (255, 255, 255, _clamp(255 * a))
    ox, oy = cell("cross")
    for i in range(8):
        px[ox + i, oy + i] = (255, 255, 255, 255)
        px[ox + 7 - i, oy + i] = (255, 255, 255, 255)
    return img


# ---------------------------------------------------------------------------
#  HUD 用グリフ（U+E100〜）
# ---------------------------------------------------------------------------
GLYPHS = ["bullet", "bullet_empty", "semi", "burst", "auto", "hit", "hit_head", "kill",
          "heat", "lock", "reload", "shell", "grenade", "cell", "wrench", "jam",
          "ub", "charge", "rocket", "hook", "dot", "skull", "shield", "flame",
          # 2.0（U+E118〜）
          "credit", "plate", "heart", "knife", "helmet", "star", "flag", "trophy",
          "crate", "bomb", "emp", "gunship", "recon", "sentry", "wave", "streak"]
# 階級グリフ（U+E130〜U+E139）。段階が上がるほど山形・星が増える
RANK_GLYPH_BASE = 48


def glyph_page():
    """glyph_E1.png（256x256、16x16 セル）"""
    img = Image.new("RGBA", (256, 256), (0, 0, 0, 0))
    for i, name in enumerate(GLYPHS):
        cx, cy = (i % 16) * 16, (i // 16) * 16
        g = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
        d = ImageDraw.Draw(g)
        W = (255, 255, 255, 255)
        if name == "bullet":
            d.rectangle([5, 6, 9, 14], fill=(220, 176, 80, 255))
            d.polygon([(5, 6), (9, 6), (9, 4), (7, 1), (5, 4)], fill=(200, 130, 70, 255))
        elif name == "bullet_empty":
            d.rectangle([5, 6, 9, 14], outline=(120, 120, 120, 255))
            d.polygon([(5, 6), (9, 6), (9, 4), (7, 1), (5, 4)], outline=(120, 120, 120, 255))
        elif name == "semi":
            d.rectangle([6, 2, 9, 13], fill=W)
        elif name == "burst":
            for x in (1, 6, 11):
                d.rectangle([x, 3, x + 3, 12], fill=W)
        elif name == "auto":
            for x in (0, 4, 8, 12):
                d.rectangle([x, 3, x + 2, 12], fill=W)
            d.line([0, 14, 14, 14], fill=W)
        elif name == "hit":
            for a, b in (((2, 2), (5, 5)), ((13, 2), (10, 5)), ((2, 13), (5, 10)), ((13, 13), (10, 10))):
                d.line([a, b], fill=W, width=2)
        elif name == "hit_head":
            for a, b in (((2, 2), (6, 6)), ((13, 2), (9, 6)), ((2, 13), (6, 9)), ((13, 13), (9, 9))):
                d.line([a, b], fill=(255, 60, 60, 255), width=2)
        elif name == "kill":
            d.line([2, 2, 13, 13], fill=(255, 60, 60, 255), width=3)
            d.line([13, 2, 2, 13], fill=(255, 60, 60, 255), width=3)
        elif name == "heat":
            d.polygon([(7, 1), (12, 8), (10, 14), (4, 14), (2, 9)], fill=(255, 120, 40, 255))
            d.polygon([(7, 6), (9, 10), (8, 13), (6, 13), (5, 10)], fill=(255, 230, 120, 255))
        elif name == "lock":
            d.rectangle([2, 2, 13, 13], outline=(255, 60, 60, 255), width=2)
            d.rectangle([6, 6, 9, 9], fill=(255, 60, 60, 255))
        elif name == "reload":
            d.arc([2, 2, 13, 13], 30, 330, fill=W, width=2)
            d.polygon([(11, 1), (14, 5), (10, 5)], fill=W)
        elif name == "shell":
            d.rectangle([5, 2, 10, 10], fill=(200, 40, 40, 255))
            d.rectangle([5, 10, 10, 14], fill=(220, 176, 80, 255))
        elif name == "grenade":
            d.ellipse([3, 4, 12, 14], fill=(110, 130, 80, 255))
            d.rectangle([6, 1, 9, 4], fill=(180, 180, 180, 255))
        elif name == "cell":
            d.rectangle([4, 2, 11, 14], fill=(60, 64, 72, 255))
            d.rectangle([5, 4, 10, 12], fill=(80, 220, 255, 255))
        elif name == "wrench":
            d.line([3, 13, 11, 5], fill=(200, 200, 200, 255), width=3)
            d.ellipse([9, 1, 14, 6], outline=(200, 200, 200, 255), width=2)
        elif name == "jam":
            d.polygon([(7, 1), (14, 14), (0, 14)], fill=(255, 200, 40, 255))
            d.rectangle([6, 5, 8, 10], fill=(30, 30, 30, 255))
            d.rectangle([6, 12, 8, 13], fill=(30, 30, 30, 255))
        elif name == "ub":
            d.rectangle([1, 4, 11, 9], fill=W)
            d.rectangle([11, 3, 14, 10], fill=W)
            d.rectangle([4, 9, 6, 14], fill=W)
        elif name == "charge":
            d.polygon([(9, 0), (3, 9), (7, 9), (5, 15), (12, 6), (8, 6)], fill=(90, 200, 255, 255))
        elif name == "rocket":
            d.polygon([(14, 7), (9, 4), (2, 4), (2, 10), (9, 10)], fill=(150, 160, 130, 255))
            d.polygon([(2, 4), (0, 1), (0, 13), (2, 10)], fill=(90, 90, 90, 255))
        elif name == "hook":
            d.arc([3, 5, 12, 14], 0, 180, fill=(200, 200, 200, 255), width=2)
            d.line([12, 9, 12, 1], fill=(200, 200, 200, 255), width=2)
        elif name == "dot":
            d.ellipse([5, 5, 10, 10], fill=W)
        elif name == "skull":
            d.ellipse([2, 1, 13, 11], fill=W)
            d.rectangle([4, 9, 11, 14], fill=W)
            d.ellipse([4, 4, 7, 7], fill=(0, 0, 0, 0))
            d.ellipse([8, 4, 11, 7], fill=(0, 0, 0, 0))
        elif name == "shield":
            d.polygon([(2, 2), (13, 2), (13, 8), (7, 14), (2, 8)], fill=(120, 170, 255, 255))
        elif name == "flame":
            d.polygon([(7, 0), (13, 9), (10, 15), (4, 15), (1, 9)], fill=(255, 110, 30, 255))
        elif name == "credit":
            d.ellipse([2, 2, 13, 13], fill=(236, 190, 60, 255))
            d.ellipse([4, 4, 11, 11], outline=(170, 120, 30, 255))
            d.line([7, 4, 7, 11], fill=(170, 120, 30, 255))
        elif name == "plate":
            d.polygon([(3, 1), (12, 1), (14, 4), (14, 10), (8, 15), (1, 10), (1, 4)], fill=(120, 190, 255, 255))
        elif name == "heart":
            d.polygon([(8, 14), (1, 7), (1, 4), (4, 1), (8, 4), (12, 1), (15, 4), (15, 7)], fill=(230, 50, 50, 255))
        elif name == "knife":
            d.line([2, 13, 13, 2], fill=(220, 224, 230, 255), width=2)
            d.line([2, 13, 5, 10], fill=(60, 60, 64, 255), width=3)
        elif name == "helmet":
            d.pieslice([2, 3, 14, 17], 180, 360, fill=(110, 130, 90, 255))
            d.rectangle([1, 10, 15, 11], fill=(80, 96, 64, 255))
        elif name == "star":
            d.polygon([(8, 1), (10, 6), (15, 6), (11, 9), (13, 15), (8, 11), (3, 15), (5, 9), (1, 6), (6, 6)], fill=(255, 220, 90, 255))
        elif name == "flag":
            d.line([3, 1, 3, 15], fill=W, width=2)
            d.polygon([(4, 2), (14, 4), (4, 8)], fill=(230, 60, 50, 255))
        elif name == "trophy":
            d.rectangle([4, 2, 11, 8], fill=(236, 190, 60, 255))
            d.rectangle([7, 8, 8, 12], fill=(236, 190, 60, 255))
            d.rectangle([4, 12, 11, 14], fill=(236, 190, 60, 255))
        elif name == "crate":
            d.rectangle([2, 4, 13, 14], fill=(160, 116, 64, 255))
            d.line([2, 9, 13, 9], fill=(110, 76, 40, 255))
        elif name == "bomb":
            d.ellipse([2, 4, 12, 14], fill=(50, 52, 56, 255))
            d.line([10, 5, 13, 1], fill=(230, 170, 30, 255), width=2)
        elif name == "emp":
            d.polygon([(9, 0), (3, 9), (7, 9), (5, 15), (12, 6), (8, 6)], fill=(160, 200, 255, 255))
            d.ellipse([0, 0, 15, 15], outline=(90, 150, 255, 255))
        elif name == "gunship":
            d.polygon([(1, 8), (11, 6), (15, 8), (11, 10)], fill=(150, 160, 176, 255))
            d.polygon([(6, 7), (9, 2), (10, 7)], fill=(150, 160, 176, 255))
        elif name == "recon":
            d.ellipse([1, 4, 14, 12], fill=W)
            d.ellipse([5, 5, 10, 11], fill=(40, 120, 200, 255))
        elif name == "sentry":
            d.rectangle([4, 4, 10, 8], fill=(150, 160, 176, 255))
            d.line([10, 6, 15, 6], fill=W)
            d.line([7, 8, 3, 15], fill=W)
            d.line([7, 8, 11, 15], fill=W)
        elif name == "wave":
            for x0 in (1, 6, 11):
                d.arc([x0 - 2, 4, x0 + 4, 12], 180, 360, fill=(120, 200, 90, 255), width=2)
        elif name == "streak":
            d.polygon([(2, 14), (7, 2), (9, 8), (14, 2), (9, 14), (7, 9)], fill=(255, 140, 40, 255))
        img.paste(g, (cx, cy), g)
    # 階級グリフ（10 段階）
    for r in range(10):
        i = RANK_GLYPH_BASE + r
        cx, cy = (i % 16) * 16, (i // 16) * 16
        g = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
        d = ImageDraw.Draw(g)
        gold = (236, 196, 80, 255)
        silver = (210, 214, 222, 255)
        col = silver if r < 5 else gold
        if r < 4:
            for k in range(r + 1):
                y = 12 - k * 3
                d.line([2, y - 3, 8, y, 14, y - 3], fill=col, width=2)
        elif r < 7:
            d.rectangle([2, 3, 13, 12], outline=col, width=2)
            for k in range(r - 3):
                d.rectangle([4 + k * 3, 6, 5 + k * 3, 9], fill=col)
        else:
            n = r - 6
            for k in range(n):
                x = 8 + (k - (n - 1) / 2) * 5
                d.polygon([(x, 2), (x + 1.6, 6), (x + 4, 6), (x + 2, 8.5), (x + 3, 13), (x, 10), (x - 3, 13), (x - 2, 8.5), (x - 4, 6), (x - 1.6, 6)], fill=gold)
        img.paste(g, (cx, cy), g)
    return img


# ---------------------------------------------------------------------------
#  エンティティテクスチャ
# ---------------------------------------------------------------------------
def atlas_from_palette(pal, seed):
    return atlas_tiles(pal, seed)[0]


def atlas_tiles(pal, seed, tile_kinds=None):
    """パレットから 64x64 の素材アトラスと、タイルの辞書（アイコン描画用）を作る。
    tile_kinds … タイルごとの模様の種類の上書き（例：{"main": "camo_woodland"}）"""
    rng = random.Random(seed)
    img = np.zeros((64, 64, 4), dtype=np.uint8)
    tiles = {}
    for i, kind in enumerate(TILE_ORDER):
        base = pal.get(kind, COMMON.get(kind, (128, 128, 128)))
        tk = (tile_kinds or {}).get(kind, kind if kind != "furniture" else "main")
        t = make_tile(tk, base, rng) if not callable(tk) else tk(rng)
        tiles[kind] = t
        tx, ty = (i % 4) * TILE, (i // 4) * TILE
        img[ty:ty + TILE, tx:tx + TILE] = t
    return Image.fromarray(img, "RGBA"), tiles


def projectile_texture():
    pal = dict(COMMON)
    pal.update({"main": (86, 98, 64), "main_dark": (48, 52, 44), "furniture": (80, 88, 60), "mag": (110, 120, 70),
                "accent": (80, 180, 90), "glow": (255, 170, 60), "lens": (110, 170, 110)})
    return atlas_from_palette(pal, "proj")


def dummy_texture():
    pal = dict(COMMON)
    pal.update({"main": (180, 150, 100), "main_dark": (120, 90, 60), "furniture": (206, 178, 120),
                "accent": (200, 40, 40), "white": (236, 234, 226), "warning": (200, 40, 40)})
    img = atlas_from_palette(pal, "dummy")
    # furniture タイルを麻袋風に
    a = np.array(img)
    rng = random.Random(11)
    for y in range(16):
        for x in range(16):
            c = (206, 178, 120)
            d = 10 if (x % 2 == 0) ^ (y % 2 == 0) else -6
            a[y, 32 + x] = (*_shade(c, d + rng.randint(-3, 3)), 255)
    return Image.fromarray(a, "RGBA")


def _paint_box(px, u, v, w, h, dd, fn):
    """Box UV の各面を fn(face, x, y, fw, fh) で塗る"""
    faces = {
        "top": (u + dd, v, w, dd), "bottom": (u + dd + w, v, w, dd),
        "right": (u, v + dd, dd, h), "front": (u + dd, v + dd, w, h),
        "left": (u + dd + w, v + dd, dd, h), "back": (u + 2 * dd + w, v + dd, w, h),
    }
    for face, (fx, fy, fw, fh) in faces.items():
        for y in range(fh):
            for x in range(fw):
                c = fn(face, x, y, fw, fh)
                if c is not None:
                    px[fx + x, fy + y] = c


def raider_skin(kind, color):
    """64x64 プレイヤー互換スキン"""
    rng = random.Random(kind)
    img = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    px = img.load()
    skin = (170, 124, 96)
    base = tuple(color)
    dark = _shade(base, -30)
    boots = (40, 36, 34)
    def n(c, a=5):
        return (*_shade(c, rng.randint(-a, a)), 255)
    # 頭（バラクラバ）
    def head(face, x, y, fw, fh):
        if face == "front":
            if 2 <= y <= 4:
                if x in (1, 2) or x in (5, 6):
                    return (240, 240, 240, 255) if (x in (2, 5)) else (40, 40, 40, 255)
                return n(skin)
            return n((34, 34, 36), 3)
        return n((34, 34, 36), 3)
    _paint_box(px, 0, 0, 8, 8, 8, head)
    # 胴
    def body(face, x, y, fw, fh):
        if y >= 10:
            return n((44, 40, 36))
        return n(base)
    _paint_box(px, 16, 16, 8, 12, 4, body)
    def arm(face, x, y, fw, fh):
        if y >= 10:
            return n((60, 56, 50))
        return n(dark)
    _paint_box(px, 40, 16, 4, 12, 4, arm)
    _paint_box(px, 32, 48, 4, 12, 4, arm)
    def leg(face, x, y, fw, fh):
        if y >= 9:
            return n(boots, 3)
        return n(_shade(base, -18))
    _paint_box(px, 0, 16, 4, 12, 4, leg)
    _paint_box(px, 16, 48, 4, 12, 4, leg)
    # オーバーレイ：装備
    armor = kind
    helmet_c = {"cloth": None, "vest": (70, 80, 56), "ghillie": (76, 96, 50), "heavy": (54, 56, 60), "captain": (120, 36, 36),
                "medic": (230, 230, 222), "demo": (150, 110, 40), "warlord": (60, 20, 20)}.get(armor)
    if helmet_c:
        def helm(face, x, y, fw, fh):
            if face == "bottom":
                return None
            if face in ("front",) and y >= 3:
                if armor == "heavy" and y <= 5:
                    return (30, 30, 30, 255) if y == 4 else n(helmet_c)
                return None
            if face in ("right", "left", "back") and y >= 5:
                return None
            if armor == "ghillie" and rng.random() < 0.3:
                return (*_shade(helmet_c, rng.randint(-25, 25)), 255)
            return n(helmet_c, 6)
        _paint_box(px, 32, 0, 8, 8, 8, helm)
    if armor in ("vest", "heavy", "captain", "ghillie", "medic", "demo", "warlord"):
        vest_c = {"vest": (78, 88, 60), "heavy": (46, 48, 52), "captain": (60, 60, 64), "ghillie": (70, 90, 46),
                  "medic": (200, 196, 184), "demo": (110, 80, 36), "warlord": (40, 30, 30)}[armor]
        def vest(face, x, y, fw, fh):
            if y > 9:
                return None
            if face in ("front", "back"):
                if 3 <= y <= 5 and x % 3 != 2:
                    return n(_shade(vest_c, -18))
                if armor in ("captain", "warlord") and face == "front" and y == 1 and 2 <= x <= 5:
                    return (220, 180, 60, 255)
                if armor == "medic" and face in ("front", "back") and (x == 3 or x == 4) and 1 <= y <= 4:
                    return (200, 40, 40, 255)
                if armor == "medic" and face in ("front", "back") and y in (2, 3) and 2 <= x <= 5:
                    return (200, 40, 40, 255)
                if armor == "demo" and face == "front" and y == 7 and x % 2 == 0:
                    return (230, 170, 30, 255)
                return n(vest_c)
            if face in ("right", "left"):
                return n(vest_c)
            return n(vest_c) if face == "top" else None
        _paint_box(px, 16, 32, 8, 12, 4, vest)
    if armor in ("heavy", "warlord"):
        def pad(face, x, y, fw, fh):
            if y <= 3:
                return n((46, 48, 52))
            return None
        _paint_box(px, 40, 32, 4, 12, 4, pad)
        _paint_box(px, 48, 48, 4, 12, 4, pad)
    if armor == "ghillie":
        def ghil(face, x, y, fw, fh):
            if rng.random() < 0.45:
                return (*_shade((76, 96, 50), rng.randint(-30, 20)), 255)
            return None
        _paint_box(px, 40, 32, 4, 12, 4, ghil)
        _paint_box(px, 48, 48, 4, 12, 4, ghil)
        _paint_box(px, 0, 32, 4, 12, 4, ghil)
        _paint_box(px, 0, 48, 4, 12, 4, ghil)
    return img


# ---------------------------------------------------------------------------
#  パックアイコン（256x256）
# ---------------------------------------------------------------------------
def pack_icon(gun_icon, variant="bp"):
    S = 256
    img = Image.new("RGBA", (S, S), (0, 0, 0, 255))
    px = img.load()
    top = (38, 46, 36) if variant == "bp" else (36, 40, 52)
    bot = (14, 16, 14) if variant == "bp" else (12, 14, 20)
    for y in range(S):
        t = y / (S - 1)
        c = _mix(top, bot, t)
        for x in range(S):
            px[x, y] = (*c, 255)
    d = ImageDraw.Draw(img)
    # 照準線
    ring = (230, 170, 30, 255)
    d.ellipse([28, 28, 228, 228], outline=ring, width=6)
    d.ellipse([98, 98, 158, 158], outline=ring, width=4)
    d.line([128, 12, 128, 70], fill=ring, width=6)
    d.line([128, 186, 128, 244], fill=ring, width=6)
    d.line([12, 128, 70, 128], fill=ring, width=6)
    d.line([186, 128, 244, 128], fill=ring, width=6)
    big = gun_icon.resize((224, 224), Image.NEAREST)
    shadow = Image.new("RGBA", big.size, (0, 0, 0, 0))
    sa = np.array(big)
    sh = np.zeros_like(sa)
    sh[:, :, 3] = (sa[:, :, 3] > 0) * 170
    shadow = Image.fromarray(sh, "RGBA").filter(ImageFilter.GaussianBlur(4))
    img.alpha_composite(shadow, (22, 30))
    img.alpha_composite(big, (16, 16))
    # 帯
    d.rectangle([0, 206, 255, 255], fill=(16, 16, 18, 235))
    d.rectangle([0, 206, 255, 209], fill=ring)
    _pixel_text(d, "ARSENAL CORE", 128, 222, (240, 240, 236, 255), scale=3)
    return img


_FONT5 = {
    "A": ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
    "R": ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
    "S": ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
    "E": ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
    "N": ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
    "L": ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
    "C": ["01110", "10001", "10000", "10000", "10000", "10001", "01110"],
    "O": ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
    " ": ["00000"] * 7,
}


def _pixel_text(d, text, cx, cy, color, scale=3):
    w = len(text) * 6 * scale - scale
    x0 = cx - w // 2
    y0 = cy - (7 * scale) // 2
    for i, ch in enumerate(text):
        rows = _FONT5.get(ch, _FONT5[" "])
        for ry, row in enumerate(rows):
            for rx, bit in enumerate(row):
                if bit == "1":
                    x = x0 + i * 6 * scale + rx * scale
                    y = y0 + ry * scale
                    d.rectangle([x, y, x + scale - 1, y + scale - 1], fill=color)


# ---------------------------------------------------------------------------
#  スコープ・レティクル（HUD に重ねる。ui/hud_screen.json から参照）
# ---------------------------------------------------------------------------
def _scope_base(size, radius_ratio, tint=None):
    """外側が黒、内側が透明の円。縁はぼかしてレンズのケラレを表現"""
    n = size
    yy, xx = np.mgrid[0:n, 0:n].astype(np.float32)
    c = (n - 1) / 2.0
    r = np.hypot(xx - c, yy - c) / (n / 2.0)
    inner = radius_ratio
    edge = 0.035
    a = np.clip((r - inner) / edge, 0.0, 1.0)
    # 縁の内側に薄い暗がり（ケラレ）
    vign = np.clip((r - inner * 0.72) / (inner * 0.28), 0.0, 1.0) ** 2 * 0.35
    alpha = np.maximum(a, vign)
    img = np.zeros((n, n, 4), dtype=np.float32)
    if tint is not None:
        img[..., 0], img[..., 1], img[..., 2] = tint[0], tint[1], tint[2]
        inside = (r < inner).astype(np.float32)
        alpha = np.maximum(alpha, inside * tint[3] / 255.0)
        img[..., :3] = img[..., :3] * (1 - a[..., None])
    img[..., 3] = alpha * 255.0
    return Image.fromarray(np.clip(img, 0, 255).astype(np.uint8), "RGBA")


def _line(d, xy, color, width):
    d.line(xy, fill=color, width=width)


def scope_overlay(kind, size=512):
    """kind: 2x / 4x / 8x / thermal"""
    ratio = {"2x": 0.93, "4x": 0.88, "8x": 0.84, "thermal": 0.86}[kind]
    tint = (60, 255, 140, 38) if kind == "thermal" else None
    img = _scope_base(size, ratio, tint)
    d = ImageDraw.Draw(img)
    c = size / 2
    R = size / 2 * ratio
    black = (8, 8, 10, 255)
    if kind == "2x":
        # 細い十字＋中心の小さな円
        _line(d, [(c - R, c), (c - 14, c)], black, 2)
        _line(d, [(c + 14, c), (c + R, c)], black, 2)
        _line(d, [(c, c + 14), (c, c + R)], black, 2)
        _line(d, [(c, c - R), (c, c - 14)], black, 2)
        d.ellipse([c - 6, c - 6, c + 6, c + 6], outline=(230, 40, 30, 255), width=2)
    elif kind == "4x":
        # デュプレックス：外側が太く、中央が細い
        thick, thin = 9, 2
        gap = R * 0.36
        _line(d, [(c - R, c), (c - gap, c)], black, thick)
        _line(d, [(c + gap, c), (c + R, c)], black, thick)
        _line(d, [(c, c + gap), (c, c + R)], black, thick)
        _line(d, [(c, c - R), (c, c - gap)], black, thick)
        _line(d, [(c - gap, c), (c + gap, c)], black, thin)
        _line(d, [(c, c - gap), (c, c + gap)], black, thin)
        d.ellipse([c - 2.5, c - 2.5, c + 2.5, c + 2.5], fill=(230, 40, 30, 255))
    elif kind == "8x":
        # ミルドット：細い十字に目盛り
        _line(d, [(c - R, c), (c + R, c)], black, 2)
        _line(d, [(c, c - R), (c, c + R)], black, 2)
        step = R / 9
        for i in range(1, 9):
            for sgn in (-1, 1):
                x = c + sgn * i * step
                y = c + sgn * i * step
                rr = 3.2 if i % 2 == 0 else 2.2
                d.ellipse([x - rr, c - rr, x + rr, c + rr], fill=black)
                d.ellipse([c - rr, y - rr, c + rr, y + rr], fill=black)
        # 弾道落下用の下側の短い横線
        for i in (2, 4, 6):
            y = c + i * step
            _line(d, [(c - step * 0.9, y), (c + step * 0.9, y)], black, 2)
        d.ellipse([c - 2, c - 2, c + 2, c + 2], fill=(230, 40, 30, 255))
    else:
        # サーマル：緑の視野に四隅のブラケットと中央の点
        g = (190, 255, 200, 255)
        s = R * 0.12
        for sx in (-1, 1):
            for sy in (-1, 1):
                x0, y0 = c + sx * s * 2.2, c + sy * s * 2.2
                _line(d, [(x0, y0), (x0 - sx * s, y0)], g, 3)
                _line(d, [(x0, y0), (x0, y0 - sy * s)], g, 3)
        d.ellipse([c - 3, c - 3, c + 3, c + 3], fill=g)
        _line(d, [(c - R, c), (c - s * 3.2, c)], g, 2)
        _line(d, [(c + s * 3.2, c), (c + R, c)], g, 2)
    return img


def reticle(kind, size=64):
    """ドットサイト（点）とホロサイト（円＋点）。画面中央に小さく重ねる"""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    big = Image.new("RGBA", (size * 4, size * 4), (0, 0, 0, 0))
    d = ImageDraw.Draw(big)
    c = size * 2
    red = (255, 45, 35, 255)
    if kind == "dot":
        d.ellipse([c - 9, c - 9, c + 9, c + 9], fill=red)
    else:
        R = size * 1.55
        d.ellipse([c - R, c - R, c + R, c + R], outline=red, width=9)
        d.ellipse([c - 8, c - 8, c + 8, c + 8], fill=red)
        for ang in (0, 90, 180, 270):
            a = math.radians(ang)
            x0, y0 = c + math.cos(a) * (R - 2), c + math.sin(a) * (R - 2)
            x1, y1 = c + math.cos(a) * (R - 26), c + math.sin(a) * (R - 26)
            d.line([(x0, y0), (x1, y1)], fill=red, width=9)
    glow = big.filter(ImageFilter.GaussianBlur(6))
    big = Image.alpha_composite(glow, big)
    img = big.resize((size, size), Image.LANCZOS)
    return img


def solid(color, size=16):
    return Image.new("RGBA", (size, size), color)
