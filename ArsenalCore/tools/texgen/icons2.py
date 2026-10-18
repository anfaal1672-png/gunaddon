"""
ARSENAL CORE — 2.0 で増えたアイコン・テクスチャ（迷彩・アタッチメント・弾薬・投擲物・医療品・近接武器・
道具・キルストリーク・HUD 2.0 の部品）。すべて Pillow と numpy で手続き的に描く。
"""
import math
import random

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

from texgen.textures import (TILE, TILE_ORDER, COMMON, make_tile, new_icon, rect, outline, _shade, _mix, _clamp,
                             attachment_icon, ammo_icon, throwable_icon, tool_icon)

DK = (48, 50, 54)
MD = (80, 84, 90)
LT = (160, 166, 172)
BRASS = (206, 164, 68)


# ---------------------------------------------------------------------------
#  迷彩
# ---------------------------------------------------------------------------
def camo_tile(kind, colors, rng, base=None):
    """16x16 の迷彩タイル。kind … solid / woodland / digital / tiger / gold / diamond"""
    cols = [tuple(c) for c in colors]
    t = np.zeros((TILE, TILE, 4), dtype=np.uint8)
    if kind == "solid":
        for y in range(TILE):
            for x in range(TILE):
                d = rng.randint(-5, 5)
                c = cols[1] if (x * 7 + y * 3 + rng.randint(0, 20)) % 23 == 0 else cols[0]
                t[y, x] = (*_shade(c, d), 255)
        return t
    if kind == "woodland":
        # 低周波ノイズの等高線で 4 色に塗り分ける（タイルの端がつながるよう周期関数）
        ph = [rng.random() * 6.28 for _ in range(6)]
        for y in range(TILE):
            for x in range(TILE):
                u, v = x / TILE * 6.2832, y / TILE * 6.2832
                n = (math.sin(u + ph[0]) * math.cos(v * 2 + ph[1]) + 0.6 * math.sin(u * 2 + v + ph[2])
                     + 0.4 * math.cos(u * 3 - v * 2 + ph[3]))
                i = 0 if n < -0.55 else 1 if n < 0.1 else 2 if n < 0.7 else 3
                t[y, x] = (*_shade(cols[i % len(cols)], rng.randint(-3, 3)), 255)
        return t
    if kind == "digital":
        grid = [[rng.randrange(len(cols)) for _ in range(8)] for _ in range(8)]
        for _ in range(2):  # 塊にする
            g2 = [row[:] for row in grid]
            for y in range(8):
                for x in range(8):
                    if rng.random() < 0.5:
                        g2[y][x] = grid[(y + rng.choice((-1, 0, 1))) % 8][(x + rng.choice((-1, 0, 1))) % 8]
            grid = g2
        for y in range(TILE):
            for x in range(TILE):
                t[y, x] = (*cols[grid[y // 2][x // 2]], 255)
        return t
    if kind == "tiger":
        ph = rng.random() * 6.28
        for y in range(TILE):
            for x in range(TILE):
                s = math.sin((x * 0.9 + math.sin(y * 0.8 + ph) * 2.2) * 0.9)
                c = cols[1] if s > 0.55 else cols[2] if s > 0.35 else cols[0]
                t[y, x] = (*_shade(c, rng.randint(-4, 4)), 255)
        return t
    if kind in ("gold", "diamond"):
        for y in range(TILE):
            for x in range(TILE):
                g = (x + y) / (2 * TILE)
                c = _mix(cols[1], cols[0], 0.5 + 0.5 * math.sin(g * 6.28 + 0.5))
                if (x + y * 3) % 11 == 0 or (kind == "diamond" and (x * 5 + y) % 13 == 0):
                    c = cols[2]
                t[y, x] = (*_shade(c, rng.randint(-4, 4)), 255)
        return t
    return make_tile("main", cols[0], rng)


CAMO_TILES = ("main", "main_dark", "furniture", "mag", "accent")


def camo_atlas(cid, camo):
    """迷彩の素材アトラス（全武器で共有）。本体・外装・マガジンを迷彩に、金属・レンズなどは共通の色"""
    rng = random.Random("camo:" + cid)
    img = np.zeros((64, 64, 4), dtype=np.uint8)
    tiles = {}
    cols = camo["colors"]
    kind = camo["kind"]
    for i, tk in enumerate(TILE_ORDER):
        if tk in CAMO_TILES:
            if tk == "main_dark" and kind not in ("gold", "diamond"):
                t = camo_tile(kind, [_shade(c, -28) for c in cols], rng)
            elif tk == "accent":
                t = make_tile("accent", tuple(cols[-1]), rng)
            else:
                t = camo_tile(kind, cols, rng)
        elif tk == "glow":
            t = make_tile("glow", (120, 220, 255) if kind != "gold" else (255, 200, 90), rng)
        elif tk == "grip" and kind in ("gold", "diamond"):
            t = camo_tile(kind, [_shade(c, -20) for c in cols], rng)
        else:
            t = make_tile(tk, COMMON.get(tk, (128, 128, 128)), rng)
        tiles[tk] = t
        img[(i // 4) * TILE:(i // 4 + 1) * TILE, (i % 4) * TILE:(i % 4 + 1) * TILE] = t
    return Image.fromarray(img, "RGBA"), tiles


def camo_swatch(cid, camo, size=32):
    """フォームのボタン用の見本"""
    rng = random.Random("sw:" + cid)
    t = camo_tile(camo["kind"], camo["colors"], rng)
    im = Image.fromarray(np.tile(t, (2, 2, 1)), "RGBA").resize((size, size), Image.NEAREST)
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, size - 1, size - 1], outline=(20, 20, 24, 255))
    return im


# ---------------------------------------------------------------------------
#  アタッチメント（2.0 で追加した種類。既存の種類は textures.attachment_icon）
# ---------------------------------------------------------------------------
V1_ATTACHMENTS = {"optic_reddot", "optic_holo", "optic_2x", "optic_4x", "optic_8x", "optic_thermal", "muzzle_suppressor", "muzzle_compensator",
                  "muzzle_brake", "muzzle_flash_hider", "muzzle_choke", "grip_vertical", "grip_angled", "bipod", "ub_launcher", "ub_shotgun",
                  "mag_extended", "mag_drum", "mag_quick", "laser_tactical", "flashlight", "stock_light", "stock_heavy"}


def _scope_icon(d, big, lens=(70, 130, 190), extra=None):
    rect(d, 3, 12 - big, 29, 19 + big, MD)
    rect(d, 2, 10 - big, 7, 21 + big, DK)
    rect(d, 25, 9 - big, 30, 22 + big, DK)
    rect(d, 14, 7 - big, 18, 12 - big, LT)
    rect(d, 9, 20 + big, 12, 25, DK)
    rect(d, 20, 20 + big, 23, 25, DK)
    rect(d, 27, 11 - big, 29, 20 + big, lens, hl=False)
    if extra:
        extra(d)


def attachment_icon_any(aid, a):
    if aid in V1_ATTACHMENTS:
        return attachment_icon(aid, a)
    img = new_icon()
    d = ImageDraw.Draw(img)
    slot = a["slot"]
    if aid == "optic_prism3":
        rect(d, 7, 18, 25, 22, DK)
        d.polygon([(9, 18), (23, 18), (25, 8), (7, 8)], fill=MD + (255,))
        rect(d, 10, 10, 22, 16, (70, 130, 190))
        d.point((16, 13), fill=(255, 80, 60, 255))
        rect(d, 14, 5, 18, 8, LT)
    elif aid == "optic_12x":
        _scope_icon(d, 3)
        rect(d, 9, 14, 12, 17, (230, 170, 30), hl=False)
    elif aid == "optic_variable":
        _scope_icon(d, 1, extra=lambda dd: rect(dd, 8, 11, 10, 20, (230, 170, 30), hl=False))
    elif aid == "optic_nv":
        _scope_icon(d, 1, lens=(80, 220, 110))
    elif aid == "optic_rangefinder":
        _scope_icon(d, 1, extra=lambda dd: rect(dd, 16, 21, 24, 26, (200, 40, 40)))
    elif aid == "side_canted":
        rect(d, 5, 18, 27, 22, DK)
        d.polygon([(10, 18), (14, 18), (19, 8), (15, 8)], fill=MD + (255,))
        d.polygon([(20, 18), (24, 18), (29, 8), (25, 8)], fill=MD + (255,))
        rect(d, 16, 6, 18, 8, (230, 170, 30), hl=False)
    elif aid == "laser_combo":
        rect(d, 4, 11, 22, 21, DK)
        rect(d, 22, 12, 26, 16, MD)
        rect(d, 22, 17, 26, 20, MD)
        d.line([26, 14, 31, 14], fill=(255, 40, 40, 255))
        d.polygon([(26, 17), (31, 15), (31, 22), (26, 20)], fill=(255, 250, 200, 140))
    elif slot == "muzzle":
        if aid.startswith("muzzle_suppressor"):
            heavy = aid.endswith("heavy")
            y0, y1 = (11, 21) if heavy else (13, 19)
            x0 = 2 if heavy else 7
            rect(d, x0, y0, 28, y1, DK)
            for x in range(x0 + 3, 27, 4):
                d.line([x, y0 + 1, x, y1 - 1], fill=MD + (255,))
        elif aid == "muzzle_flash_cone":
            d.polygon([(6, 14), (26, 9), (26, 23), (6, 18)], fill=DK + (255,))
            rect(d, 3, 14, 7, 18, MD)
        elif aid == "muzzle_duckbill":
            rect(d, 4, 13, 14, 19, DK)
            d.polygon([(14, 13), (29, 9), (29, 23), (14, 19)], fill=MD + (255,))
            d.line([16, 16, 29, 16], fill=DK + (255,))
        elif aid == "muzzle_bayonet":
            rect(d, 2, 14, 9, 19, DK)
            d.polygon([(9, 14), (29, 15), (31, 16), (9, 19)], fill=(200, 206, 214, 255))
            d.line([9, 15, 28, 15], fill=(240, 244, 248, 255))
        else:
            rect(d, 6, 12, 26, 20, MD)
    elif slot == "barrel":
        L = {"barrel_long": 28, "barrel_short": 16, "barrel_heavy": 24, "barrel_fluted": 24, "barrel_ported": 22, "barrel_match": 28}[aid]
        w = 3 if aid != "barrel_heavy" else 5
        x0 = (32 - L) // 2
        rect(d, x0, 16 - w, x0 + L, 16 + w, DK)
        if aid == "barrel_fluted":
            for x in range(x0 + 2, x0 + L - 1, 3):
                d.line([x, 16 - w + 1, x, 16 + w - 1], fill=MD + (255,))
        if aid == "barrel_ported":
            for x in range(x0 + L - 9, x0 + L - 2, 3):
                rect(d, x, 16 - w, x + 1, 16 - w + 1, (20, 20, 20), hl=False)
        if aid == "barrel_match":
            rect(d, x0 + 3, 16 - w, x0 + 6, 16 + w, (30, 90, 180), hl=False)
        rect(d, x0 + L - 2, 16 - w - 1, x0 + L, 16 + w + 1, MD)
    elif aid == "ub_flamer":
        rect(d, 3, 10, 22, 16, (140, 40, 36))
        rect(d, 22, 11, 29, 15, DK)
        rect(d, 6, 17, 18, 22, (230, 170, 30))
        d.point((29, 13), fill=(255, 150, 40, 255))
    elif aid == "ub_grapple":
        rect(d, 3, 11, 20, 17, DK)
        rect(d, 5, 12, 12, 16, BRASS)
        d.line([20, 14, 27, 14], fill=LT + (255,), width=2)
        d.line([27, 10, 27, 18], fill=LT + (255,), width=2)
        d.line([27, 10, 30, 8], fill=LT + (255,))
        d.line([27, 18, 30, 20], fill=LT + (255,))
    elif aid == "mag_dual":
        for x0 in (9, 16):
            d.polygon([(x0, 3), (x0 + 6, 3), (x0 + 7, 27), (x0 + 1, 27)], fill=MD + (255,))
        rect(d, 8, 12, 24, 15, (30, 90, 180), hl=False)
    elif aid == "optic_micro":
        rect(d, 9, 20, 23, 23, DK)
        rect(d, 11, 12, 21, 20, MD)
        rect(d, 13, 14, 19, 19, (60, 110, 170))
        d.point((16, 16), fill=(255, 40, 40, 255))
    elif aid == "optic_thermal_compact":
        rect(d, 6, 12, 26, 20, MD)
        rect(d, 4, 11, 8, 21, DK)
        rect(d, 24, 11, 28, 21, DK)
        rect(d, 25, 13, 27, 19, (230, 90, 40), hl=False)
        rect(d, 11, 20, 14, 25, DK)
        rect(d, 19, 20, 22, 25, DK)
    elif aid == "muzzle_linear":
        rect(d, 4, 13, 10, 19, DK)
        rect(d, 10, 11, 26, 21, MD)
        rect(d, 26, 13, 29, 19, DK)
    elif aid == "muzzle_tank_brake":
        rect(d, 4, 10, 28, 22, DK)
        for x in (9, 15, 21):
            rect(d, x, 9, x + 2, 23, LT, hl=False)
    elif aid in ("grip_stubby", "grip_handstop", "grip_heavy"):
        rect(d, 4, 8, 28, 12, DK)
        if aid == "grip_stubby":
            rect(d, 13, 12, 19, 21, MD)
        elif aid == "grip_handstop":
            d.polygon([(18, 12), (24, 12), (20, 20), (16, 20)], fill=MD + (255,))
        else:
            rect(d, 11, 12, 21, 28, MD)
            for y in (16, 20, 24):
                d.line([11, y, 21, y], fill=DK + (255,))
    elif aid == "mag_polymer":
        d.polygon([(11, 3), (19, 3), (22, 27), (14, 27)], fill=(60, 64, 70, 255))
        rect(d, 12, 6, 18, 8, (200, 160, 60), hl=False)
    elif aid == "mag_casket":
        d.polygon([(8, 3), (22, 3), (25, 28), (11, 28)], fill=MD + (255,))
        d.line([15, 4, 18, 27], fill=DK + (255,))
    elif aid == "laser_ir":
        rect(d, 5, 12, 22, 20, DK)
        rect(d, 22, 13, 26, 19, MD)
        d.line([26, 16, 31, 16], fill=(120, 60, 160, 160))
    elif aid == "mag_belt":
        rect(d, 4, 12, 22, 28, (92, 100, 70))
        for x in range(8, 30, 3):
            rect(d, x, 4, x + 1, 12, BRASS, hl=False)
    elif slot == "stock":
        if aid == "stock_folding":
            d.line([28, 12, 12, 12], fill=MD + (255,), width=2)
            d.line([12, 12, 12, 24], fill=MD + (255,), width=2)
            rect(d, 8, 20, 14, 26, DK)
        elif aid == "stock_skeleton":
            d.polygon([(28, 10), (28, 14), (8, 20), (6, 12)], outline=MD + (255,))
            d.line([28, 12, 6, 12], fill=MD + (255,), width=2)
            d.line([28, 16, 8, 22], fill=MD + (255,), width=2)
            rect(d, 3, 9, 7, 25, DK)
        elif aid == "stock_precision":
            d.polygon([(28, 10), (28, 16), (10, 25), (3, 25), (3, 9)], fill=DK + (255,))
            rect(d, 8, 6, 20, 9, MD)
            rect(d, 3, 18, 6, 28, MD)
        elif aid == "stock_none":
            rect(d, 22, 10, 30, 18, DK)
            rect(d, 18, 12, 22, 16, MD)
            d.line([6, 6, 16, 26], fill=(200, 40, 40, 255), width=2)
            d.line([16, 6, 6, 26], fill=(200, 40, 40, 255), width=2)
        else:  # cheek riser
            d.polygon([(28, 10), (28, 16), (8, 24), (4, 24), (4, 9)], fill=MD + (255,))
            rect(d, 8, 6, 20, 9, (30, 90, 180))
            rect(d, 2, 8, 5, 25, DK)
    elif slot == "trigger":
        col = {"trigger_hair": (206, 164, 68), "trigger_match": (70, 130, 190), "trigger_rapid": (200, 40, 40), "trigger_twostage": (90, 170, 90)}[aid]
        rect(d, 6, 6, 26, 12, DK)
        d.arc([8, 8, 24, 28], 0, 180, fill=MD + (255,), width=2)
        d.polygon([(15, 12), (18, 12), (17, 22), (14, 20)], fill=col + (255,))
        if aid == "trigger_rapid":
            d.polygon([(24, 14), (28, 14), (26, 19)], fill=col + (255,))
        if aid == "trigger_twostage":
            rect(d, 19, 14, 21, 17, col, hl=False)
    elif slot == "ammo":
        col = {"ammo_hollow": (200, 110, 60), "ammo_subsonic": (60, 70, 90), "ammo_frangible": (140, 140, 150), "ammo_explosive": (230, 60, 40), "ammo_ap_core": (30, 30, 34), "ammo_match": (70, 130, 190)}[aid]
        for i in range(3):
            x = 7 + i * 7
            rect(d, x, 12, x + 5, 28, BRASS)
            d.polygon([(x, 12), (x + 5, 12), (x + 5, 8), (x + 2.5, 4), (x, 8)], fill=col + (255,))
        if aid == "ammo_hollow":
            for i in range(3):
                d.point((9 + i * 7, 5), fill=(30, 30, 30, 255))
        if aid == "ammo_explosive":
            d.polygon([(24, 2), (30, 6), (26, 8)], fill=(255, 220, 80, 255))
    return outline(img)


# ---------------------------------------------------------------------------
#  弾薬（燃料・迫撃砲弾）
# ---------------------------------------------------------------------------
def ammo_icon_any(item):
    shape = item["shape"]
    if shape not in ("fuel", "mortar"):
        return ammo_icon(item)
    img = new_icon()
    d = ImageDraw.Draw(img)
    if shape == "fuel":
        rect(d, 7, 7, 25, 29, (200, 40, 36))
        rect(d, 9, 9, 23, 12, (150, 28, 26), hl=False)
        rect(d, 17, 3, 23, 7, DK)
        rect(d, 9, 3, 15, 6, DK)
        rect(d, 10, 15, 22, 24, (230, 170, 30), hl=False)
        d.polygon([(16, 16), (20, 22), (12, 22)], fill=(40, 40, 40, 255))
    else:
        d.polygon([(16, 1), (22, 8), (22, 22), (10, 22), (10, 8)], fill=(92, 100, 70, 255))
        rect(d, 13, 22, 19, 26, DK)
        for x in (10, 14, 18):
            rect(d, x, 25, x + 3, 30, DK)
        rect(d, 10, 11, 22, 12, (230, 170, 30), hl=False)
    return outline(img)


# ---------------------------------------------------------------------------
#  投擲物（2.0 で追加した種類）
# ---------------------------------------------------------------------------
def throwable_icon_any(tid, t):
    k = t["kind"]
    if k not in ("gas", "emp", "cluster", "decoy", "knife", "snap", "nuke"):
        return throwable_icon(tid, t)
    img = new_icon()
    d = ImageDraw.Draw(img)
    if k == "nuke":
        # 戦術核：太い円筒と黄色の帯、放射能の印
        rect(d, 7, 8, 25, 29, (96, 104, 84))
        rect(d, 7, 15, 25, 18, (230, 190, 30), hl=False)
        rect(d, 12, 3, 20, 8, (60, 64, 70))
        d.ellipse([12, 20, 20, 28], fill=(230, 190, 30, 255))
        d.ellipse([14, 22, 18, 26], fill=(30, 30, 32, 255))
        d.point([16, 2], fill=(255, 60, 40, 255))
    elif k == "knife":
        d.polygon([(4, 27), (20, 11), (26, 5), (27, 6), (22, 13), (6, 29)], fill=(200, 206, 214, 255))
        d.line([6, 26, 24, 8], fill=(240, 244, 248, 255))
        d.line([3, 24, 9, 30], fill=DK + (255,), width=2)
        rect(d, 1, 27, 4, 30, (40, 40, 44))
    elif k == "cluster":
        d.ellipse([8, 8, 24, 26], fill=(92, 100, 70, 255))
        for (x, y) in ((6, 10), (22, 10), (6, 22), (22, 22)):
            d.ellipse([x, y, x + 5, y + 5], fill=(230, 170, 30, 255))
        rect(d, 13, 4, 19, 9, LT)
    else:
        col = {"gas": (120, 170, 60), "emp": (60, 120, 220), "decoy": (140, 120, 90), "snap": (230, 170, 30)}[k]
        rect(d, 10, 8, 22, 29, col)
        rect(d, 10, 13, 22, 15, DK, hl=False)
        rect(d, 13, 4, 19, 8, LT)
        d.line([19, 6, 24, 14], fill=LT + (255,))
        if k == "emp":
            d.polygon([(17, 17), (13, 23), (16, 23), (14, 28), (19, 21), (16, 21)], fill=(230, 245, 255, 255))
        elif k == "gas":
            d.ellipse([12, 18, 20, 26], outline=(230, 240, 200, 255))
        elif k == "snap":
            d.ellipse([13, 18, 19, 24], fill=(200, 40, 40, 255))
        elif k == "decoy":
            for i, y in enumerate((18, 21, 24)):
                d.line([13 + i, y, 19 - i, y], fill=(40, 40, 40, 255))
    return outline(img)


# ---------------------------------------------------------------------------
#  医療品
# ---------------------------------------------------------------------------
def medical_icon(mid):
    img = new_icon()
    d = ImageDraw.Draw(img)
    if mid == "bandage":
        d.ellipse([6, 8, 26, 26], fill=(236, 232, 220, 255))
        d.ellipse([12, 13, 20, 21], fill=(200, 196, 184, 255))
        d.polygon([(22, 20), (30, 26), (26, 30), (18, 24)], fill=(236, 232, 220, 255))
        rect(d, 14, 3, 18, 8, (200, 40, 40))
    elif mid == "medkit":
        rect(d, 4, 9, 28, 27, (230, 230, 222))
        rect(d, 12, 5, 20, 9, DK)
        rect(d, 14, 12, 18, 24, (200, 40, 40), hl=False)
        rect(d, 10, 16, 22, 20, (200, 40, 40), hl=False)
    elif mid == "adrenaline":
        d.polygon([(6, 26), (22, 10), (26, 14), (10, 30)], fill=(230, 230, 222, 255))
        d.polygon([(10, 24), (20, 14), (22, 16), (12, 26)], fill=(230, 170, 30, 255))
        d.line([22, 10, 29, 3], fill=LT + (255,), width=1)
        rect(d, 3, 25, 7, 29, DK)
    elif mid == "defibrillator":
        rect(d, 4, 12, 28, 28, (230, 170, 30))
        rect(d, 8, 15, 24, 22, (30, 30, 34), hl=False)
        d.line([9, 19, 13, 19, 15, 16, 17, 22, 19, 19, 23, 19], fill=(80, 255, 120, 255))
        rect(d, 6, 4, 12, 11, (200, 40, 40))
        rect(d, 20, 4, 26, 11, (200, 40, 40))
    elif mid == "armor_plate":
        d.polygon([(7, 4), (25, 4), (27, 8), (27, 22), (16, 29), (5, 22), (5, 8)], fill=(96, 102, 90, 255))
        d.polygon([(9, 7), (23, 7), (24, 10), (24, 20), (16, 25), (8, 20), (8, 10)], fill=(120, 126, 110, 255))
        d.line([9, 8, 23, 8], fill=(170, 176, 160, 255))
    return outline(img)


# ---------------------------------------------------------------------------
#  近接武器（バニラの剣と同じく 2D の絵を手に持つ。32x32 の斜め配置）
# ---------------------------------------------------------------------------
def _diag(d, x0, y0, x1, y1, col, w):
    d.line([x0, y0, x1, y1], fill=col + (255,), width=w)


def melee_icon(mid, m):
    img = new_icon()
    d = ImageDraw.Draw(img)
    steel = (196, 202, 210)
    edge = (240, 244, 248)
    if mid == "combat_knife":
        _diag(d, 6, 26, 12, 20, (40, 40, 44), 4)          # 柄
        rect(d, 11, 17, 15, 21, DK)                         # 鍔
        d.polygon([(13, 18), (26, 5), (28, 4), (27, 7), (15, 20)], fill=steel + (255,))
        d.line([15, 17, 26, 6], fill=edge + (255,))
    elif mid == "machete":
        _diag(d, 4, 28, 10, 22, (110, 70, 40), 4)
        d.polygon([(9, 21), (24, 6), (29, 3), (29, 7), (26, 11), (12, 24)], fill=steel + (255,))
        d.line([12, 22, 27, 7], fill=edge + (255,))
        d.polygon([(26, 3), (30, 2), (29, 6)], fill=steel + (255,))
    elif mid == "breaching_axe":
        _diag(d, 5, 28, 22, 11, (60, 62, 66), 3)
        d.polygon([(18, 5), (26, 3), (30, 10), (27, 15), (21, 10)], fill=steel + (255,))
        d.polygon([(18, 13), (14, 17), (12, 13), (16, 10)], fill=(200, 40, 40, 255))
        d.line([26, 4, 29, 10], fill=edge + (255,))
        rect(d, 3, 26, 7, 30, (230, 170, 30))
    elif mid == "riot_baton":
        _diag(d, 5, 27, 26, 6, (40, 42, 46), 4)
        _diag(d, 5, 27, 10, 22, (26, 26, 28), 5)
        rect(d, 24, 3, 29, 8, (230, 190, 40))
        d.point((27, 5), fill=(120, 200, 255, 255))
        d.line([22, 13, 25, 11], fill=(120, 200, 255, 255))
    elif mid == "spring_knife":
        _diag(d, 5, 27, 13, 19, (60, 62, 66), 5)
        d.line([8, 24, 12, 20], fill=(230, 170, 30, 255))
        d.polygon([(14, 18), (25, 7), (28, 5), (27, 8), (16, 20)], fill=steel + (255,))
        d.line([16, 17, 26, 7], fill=edge + (255,))
    elif mid == "vibro_blade":
        _diag(d, 4, 28, 10, 22, (30, 30, 36), 4)
        rect(d, 9, 19, 14, 24, (120, 60, 200))
        d.polygon([(12, 20), (26, 6), (30, 2), (29, 7), (15, 22)], fill=(170, 120, 255, 255))
        d.line([14, 19, 28, 4], fill=(240, 220, 255, 255))
        for (x, y) in ((18, 12), (23, 7)):
            d.point((x, y), fill=(255, 255, 255, 255))
    elif mid == "tomahawk":
        _diag(d, 5, 28, 21, 12, (110, 70, 40), 3)
        d.polygon([(19, 9), (25, 4), (29, 8), (27, 13), (22, 13)], fill=steel + (255,))
        d.line([25, 4, 29, 8], fill=edge + (255,))
        rect(d, 4, 26, 8, 30, (40, 40, 44))
    elif mid == "war_hammer":
        _diag(d, 5, 28, 20, 13, (70, 52, 36), 3)
        d.polygon([(16, 8), (22, 2), (30, 10), (24, 16)], fill=(120, 124, 130, 255))
        d.polygon([(18, 8), (22, 4), (28, 10), (24, 14)], fill=steel + (255,))
        rect(d, 3, 26, 7, 30, (40, 40, 44))
    elif mid == "kukri":
        _diag(d, 5, 27, 10, 22, (60, 40, 28), 4)
        rect(d, 9, 19, 13, 23, (200, 170, 80))
        d.polygon([(12, 20), (18, 12), (24, 9), (29, 5), (27, 11), (20, 16), (14, 22)], fill=steel + (255,))
        d.line([18, 12, 28, 6], fill=edge + (255,))
    elif mid == "katana":
        _diag(d, 3, 29, 9, 23, (30, 30, 36), 3)
        for (x, y) in ((5, 27), (7, 25)):
            d.point((x, y), fill=(200, 40, 40, 255))
        rect(d, 8, 21, 12, 25, (200, 170, 80))
        d.polygon([(11, 22), (27, 6), (30, 2), (29, 6), (13, 24)], fill=steel + (255,))
        d.line([12, 22, 28, 5], fill=edge + (255,))
    return outline(img)


# ---------------------------------------------------------------------------
#  道具（2.0）・キルストリーク
# ---------------------------------------------------------------------------
def tool_icon_any(tid):
    if tid in ("field_manual", "detonator", "repair_kit", "target_dummy"):
        return tool_icon(tid)
    img = new_icon()
    d = ImageDraw.Draw(img)
    if tid == "arena_tool":
        d.ellipse([5, 5, 27, 27], fill=(60, 62, 66, 255))
        d.ellipse([8, 8, 24, 24], fill=(230, 226, 210, 255))
        d.polygon([(16, 9), (19, 16), (16, 23), (13, 16)], fill=(200, 40, 40, 255))
        d.polygon([(16, 16), (19, 16), (16, 23), (13, 16)], fill=(60, 62, 66, 255))
        rect(d, 24, 3, 29, 9, (230, 170, 30))
    elif tid == "streak_terminal":
        rect(d, 6, 4, 26, 29, (52, 54, 58))
        rect(d, 8, 7, 24, 18, (20, 60, 40), hl=False)
        d.line([10, 15, 13, 12, 16, 14, 19, 9, 22, 11], fill=(80, 255, 120, 255))
        for i in range(3):
            rect(d, 9 + i * 5, 21, 12 + i * 5, 25, (200, 40, 40) if i == 1 else LT)
    elif tid == "warlord_banner":
        _diag(d, 6, 30, 6, 2, (110, 70, 40), 2)
        d.polygon([(7, 3), (27, 3), (27, 20), (17, 16), (7, 20)], fill=(140, 30, 30, 255))
        d.ellipse([12, 6, 22, 14], fill=(230, 226, 210, 255))
        rect(d, 14, 12, 20, 15, (230, 226, 210), hl=False)
    elif tid == "legion_core":
        d.polygon([(16, 2), (27, 9), (27, 23), (16, 30), (5, 23), (5, 9)], fill=(90, 110, 140, 255))
        d.polygon([(16, 8), (22, 12), (22, 20), (16, 24), (10, 20), (10, 12)], fill=(255, 120, 60, 255))
        d.ellipse([13, 13, 19, 19], fill=(255, 230, 180, 255))
    elif tid == "hollow_heart":
        d.ellipse([6, 7, 26, 28], fill=(110, 130, 60, 255))
        d.ellipse([9, 10, 21, 22], fill=(150, 170, 80, 255))
        d.line([16, 4, 16, 9], fill=(70, 60, 50, 255), width=2)
        d.line([10, 14, 14, 18, 12, 23], fill=(70, 30, 40, 255))
        d.line([20, 13, 18, 19, 22, 24], fill=(70, 30, 40, 255))
        d.ellipse([14, 15, 18, 19], fill=(200, 230, 120, 255))
    return outline(img)


def killstreak_icon(kid):
    img = new_icon()
    d = ImageDraw.Draw(img)
    if kid == "recon":
        d.ellipse([4, 8, 28, 24], fill=(230, 226, 210, 255))
        d.ellipse([11, 10, 21, 22], fill=(40, 120, 200, 255))
        d.ellipse([14, 13, 18, 19], fill=(20, 20, 24, 255))
    elif kid == "supply_drop":
        d.polygon([(4, 12), (16, 2), (28, 12)], fill=(236, 236, 230, 255))
        d.line([6, 12, 12, 19], fill=LT + (255,))
        d.line([26, 12, 20, 19], fill=LT + (255,))
        rect(d, 10, 18, 22, 29, (150, 110, 60))
        rect(d, 10, 22, 22, 23, (230, 170, 30), hl=False)
    elif kid == "turret_drop":
        rect(d, 9, 12, 21, 19, (110, 120, 136))
        rect(d, 21, 14, 29, 16, DK)
        d.line([15, 19, 9, 29], fill=DK + (255,), width=2)
        d.line([15, 19, 21, 29], fill=DK + (255,), width=2)
        d.line([15, 19, 15, 29], fill=DK + (255,), width=2)
    elif kid == "airstrike":
        d.polygon([(2, 12), (22, 10), (30, 12), (22, 14)], fill=(110, 120, 136, 255))
        d.polygon([(12, 11), (16, 4), (19, 11)], fill=(90, 100, 116, 255))
        for i, x in enumerate((8, 15, 22)):
            d.ellipse([x, 17 + i * 3, x + 4, 21 + i * 3], fill=(40, 40, 44, 255))
    elif kid == "emp_strike":
        d.ellipse([3, 3, 29, 29], outline=(90, 170, 255, 255), width=2)
        d.ellipse([9, 9, 23, 23], outline=(90, 170, 255, 255), width=2)
        d.polygon([(17, 6), (11, 17), (15, 17), (13, 26), (21, 14), (17, 14)], fill=(230, 245, 255, 255))
    elif kid == "missile_strike":
        d.polygon([(16, 2), (20, 8), (20, 22), (12, 22), (12, 8)], fill=(230, 230, 226, 255))
        d.polygon([(12, 18), (6, 26), (12, 24)], fill=(90, 100, 116, 255))
        d.polygon([(20, 18), (26, 26), (20, 24)], fill=(90, 100, 116, 255))
        d.polygon([(13, 24), (16, 31), (19, 24)], fill=(255, 150, 40, 255))
        d.rectangle([13, 10, 18, 12], fill=(220, 60, 50, 255))
    elif kid == "nuke":
        d.ellipse([3, 3, 29, 29], fill=(230, 190, 30, 255))
        d.ellipse([13, 13, 19, 19], fill=(30, 30, 32, 255))
        for a0 in (0, 120, 240):
            d.pieslice([5, 5, 27, 27], a0 - 90 - 30, a0 - 90 + 30, fill=(30, 30, 32, 255))
        d.ellipse([11, 11, 21, 21], fill=(230, 190, 30, 255))
        d.ellipse([13, 13, 19, 19], fill=(30, 30, 32, 255))
    elif kid == "gunship":
        d.polygon([(4, 16), (24, 12), (30, 16), (24, 20)], fill=(70, 76, 86, 255))
        d.polygon([(12, 14), (18, 4), (21, 13)], fill=(60, 66, 76, 255))
        d.polygon([(12, 18), (18, 28), (21, 19)], fill=(60, 66, 76, 255))
        d.line([22, 20, 26, 26], fill=(230, 170, 30, 255), width=2)
    return outline(img)


# ---------------------------------------------------------------------------
#  HUD 2.0 の部品
# ---------------------------------------------------------------------------
def crosshair(step, size=64):
    """動的クロスヘア：step 0〜9 で 4 本の線の間隔が広がる"""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    c = size // 2
    gap = 3 + step * 2.6
    L = 7
    W = (255, 255, 255, 235)
    S = (0, 0, 0, 160)
    for (dx, dy) in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        x0 = c + dx * gap
        y0 = c + dy * gap
        x1 = c + dx * (gap + L)
        y1 = c + dy * (gap + L)
        d.line([x0 + 1, y0 + 1, x1 + 1, y1 + 1], fill=S, width=2)
        d.line([x0, y0, x1, y1], fill=W, width=2)
    d.rectangle([c - 1, c - 1, c, c], fill=W)
    return img


def hitmarker(kind, size=48):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    col = {"hit": (255, 255, 255, 255), "head": (255, 190, 40, 255), "kill": (255, 60, 50, 255)}[kind]
    c = size // 2
    a, b = 7, 16 if kind != "kill" else 19
    w = 3 if kind != "hit" else 2
    for sx, sy in ((1, 1), (1, -1), (-1, 1), (-1, -1)):
        d.line([c + sx * a + 1, c + sy * a + 1, c + sx * b + 1, c + sy * b + 1], fill=(0, 0, 0, 150), width=w)
        d.line([c + sx * a, c + sy * a, c + sx * b, c + sy * b], fill=col, width=w)
    return img


def damage_arc(i, size=256):
    """被弾方向：画面中央を囲む円弧の 8 方向（i=0 前 … 時計回り）"""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    start = -90 + i * 45 - 16
    d.arc([12, 12, size - 12, size - 12], start, start + 32, fill=(230, 40, 30, 220), width=10)
    d.arc([20, 20, size - 20, size - 20], start + 6, start + 26, fill=(255, 120, 90, 160), width=4)
    return img.filter(ImageFilter.GaussianBlur(0.6))


def compass_strip(center_deg, w=256, h=24):
    """方位バー：center_deg（度、0 = 南を向いている＝マイクラの yaw 0）を中央にした帯。data/hud.js の hdgSteps 枚（2.6.5 から 4° ごと）作る"""
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, w - 1, h - 1], fill=(0, 0, 0, 90))
    labels = {0: "S", 90: "W", 180: "N", 270: "E", 45: "SW", 135: "NW", 225: "NE", 315: "SE"}
    px_per_deg = w / 180.0
    for deg in range(0, 360, 5):
        rel = ((deg - center_deg + 540) % 360) - 180
        x = w / 2 + rel * px_per_deg
        if not (0 <= x < w):
            continue
        big = deg % 45 == 0
        mid = deg % 15 == 0
        d.line([x, h - (9 if big else 5 if mid else 3), x, h - 1], fill=(255, 255, 255, 220 if big else 140 if mid else 90), width=1)
        if deg in labels:
            _tiny_text(d, labels[deg], x, 2, (255, 220, 120, 255) if len(labels[deg]) == 1 else (220, 220, 220, 230))
    d.polygon([(w / 2 - 4, 0), (w / 2 + 4, 0), (w / 2, 5)], fill=(255, 80, 60, 255))
    return img


_FONT5 = {
    "N": ["1001", "1101", "1011", "1001", "1001"], "S": ["0111", "1000", "0110", "0001", "1110"],
    "E": ["1111", "1000", "1110", "1000", "1111"], "W": ["1001", "1001", "1011", "1101", "1001"],
}


def _tiny_text(d, text, cx, y, col):
    total = len(text) * 5 - 1
    x = cx - total / 2
    for ch in text:
        g = _FONT5.get(ch)
        if g:
            for r, row in enumerate(g):
                for c_, bit in enumerate(row):
                    if bit == "1":
                        d.point((x + c_, y + r), fill=col)
        x += 5


def vignette(level, size=256):
    """制圧の画面効果（周囲が暗くなる）。level 1〜3"""
    a = np.zeros((size, size, 4), dtype=np.uint8)
    yy, xx = np.mgrid[0:size, 0:size]
    r = np.sqrt(((xx - size / 2) / (size / 2)) ** 2 + ((yy - size / 2) / (size / 2)) ** 2)
    alpha = np.clip((r - (0.75 - level * 0.1)) / 0.45, 0, 1) * (90 + level * 50)
    a[..., 3] = alpha.astype(np.uint8)
    a[..., 0] = 10
    a[..., 1] = 6
    a[..., 2] = 6
    return Image.fromarray(a, "RGBA")


def nvg_overlay(size=256):
    a = np.zeros((size, size, 4), dtype=np.uint8)
    yy, xx = np.mgrid[0:size, 0:size]
    r = np.sqrt(((xx - size / 2) / (size / 2)) ** 2 + ((yy - size / 2) / (size / 2)) ** 2)
    rng = np.random.default_rng(3)
    noise = rng.integers(0, 24, (size, size))
    a[..., 0] = 20
    a[..., 1] = 220
    a[..., 2] = 60
    a[..., 3] = np.clip(46 + noise + np.clip((r - 0.8) / 0.25, 0, 1) * 200, 0, 255).astype(np.uint8)
    for y in range(0, size, 3):
        a[y, :, 3] = np.clip(a[y, :, 3].astype(int) + 14, 0, 255).astype(np.uint8)
    return Image.fromarray(a, "RGBA")


def plate_icon(full, size=16):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    col = (120, 190, 255, 255) if full else (70, 74, 80, 200)
    d.polygon([(3, 1), (12, 1), (14, 4), (14, 10), (8, 15), (1, 10), (1, 4)], fill=col, outline=(20, 20, 24, 255))
    return img


def panel(alpha=120, size=16):
    img = Image.new("RGBA", (size, size), (0, 0, 0, alpha))
    return img


def wind_arrow(i, size=32):
    """風向き（0〜7、画面上方向 = 前方からの相対）"""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    a = math.radians(i * 45)
    c = size / 2
    tip = (c + math.sin(a) * 12, c - math.cos(a) * 12)
    l = (c + math.sin(a + 2.5) * 9, c - math.cos(a + 2.5) * 9)
    r = (c + math.sin(a - 2.5) * 9, c - math.cos(a - 2.5) * 9)
    d.polygon([tip, l, (c, c), r], fill=(180, 220, 255, 230), outline=(20, 20, 24, 255))
    return img
