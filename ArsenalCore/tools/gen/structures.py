"""ARSENAL CORE 生成：構造物（.mcstructure を NBT で直接書き出す）と自然生成（地物・地物ルール）

.mcstructure の形式（リトルエンディアン NBT）
  {format_version:1, size:[x,y,z], structure:{block_indices:[[主層],[副層]], entities:[], palette:{default:{block_palette:[...], block_position_data:{}}}},
   structure_world_origin:[0,0,0]}
  ・ブロックの並びは x → y → z の入れ子（z が最も速く変わる）
  ・パレットの各ブロックは name / states / version。states は公式の状態名・値（tools/vanilla/blocks.json）で検証する
"""
import io
import json
import os
import random
import struct
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from gen.common import NS, wjson  # noqa: E402

TOOLS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BLOCK_VERSION = (1 << 24) | (26 << 16) | (50 << 8) | 0  # 1.26.50.0

_VANILLA = None


def vanilla_blocks():
    global _VANILLA
    if _VANILLA is None:
        with open(os.path.join(TOOLS, "vanilla", "blocks.json"), encoding="utf-8") as f:
            _VANILLA = json.load(f)
    return _VANILLA


# ---------------------------------------------------------------------------
#  NBT（リトルエンディアン）
# ---------------------------------------------------------------------------
TAG_END, TAG_BYTE, TAG_SHORT, TAG_INT, TAG_LONG, TAG_FLOAT, TAG_DOUBLE, TAG_BYTE_ARRAY, TAG_STRING, TAG_LIST, TAG_COMPOUND = 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10


class Byte(int):
    pass


class Int(int):
    pass


class NList(list):
    """要素の型を明示するリスト"""

    def __init__(self, tag, items=()):
        super().__init__(items)
        self.tag = tag


def _tag_of(v):
    if isinstance(v, Byte) or isinstance(v, bool):
        return TAG_BYTE
    if isinstance(v, int):
        return TAG_INT
    if isinstance(v, float):
        return TAG_FLOAT
    if isinstance(v, str):
        return TAG_STRING
    if isinstance(v, NList):
        return TAG_LIST
    if isinstance(v, dict):
        return TAG_COMPOUND
    raise TypeError(type(v))


def _w_str(out, s):
    b = s.encode("utf-8")
    out.write(struct.pack("<H", len(b)))
    out.write(b)


def _w_payload(out, tag, v):
    if tag == TAG_BYTE:
        out.write(struct.pack("<b", int(v)))
    elif tag == TAG_INT:
        out.write(struct.pack("<i", int(v)))
    elif tag == TAG_FLOAT:
        out.write(struct.pack("<f", float(v)))
    elif tag == TAG_STRING:
        _w_str(out, v)
    elif tag == TAG_LIST:
        out.write(struct.pack("<b", v.tag if len(v) else (v.tag or TAG_END)))
        out.write(struct.pack("<i", len(v)))
        for it in v:
            _w_payload(out, v.tag, it)
    elif tag == TAG_COMPOUND:
        for k, x in v.items():
            t = _tag_of(x)
            out.write(struct.pack("<b", t))
            _w_str(out, k)
            _w_payload(out, t, x)
        out.write(struct.pack("<b", TAG_END))
    else:
        raise TypeError(tag)


def nbt_bytes(root):
    out = io.BytesIO()
    out.write(struct.pack("<b", TAG_COMPOUND))
    _w_str(out, "")
    _w_payload(out, TAG_COMPOUND, root)
    return out.getvalue()


def nbt_read(data):
    """読み戻し（検証用）"""
    pos = [0]

    def rd(fmt):
        n = struct.calcsize(fmt)
        v = struct.unpack_from(fmt, data, pos[0])
        pos[0] += n
        return v[0]

    def rs():
        n = rd("<H")
        s = data[pos[0]:pos[0] + n].decode("utf-8")
        pos[0] += n
        return s

    def payload(tag):
        if tag == TAG_BYTE:
            return rd("<b")
        if tag == TAG_SHORT:
            return rd("<h")
        if tag == TAG_INT:
            return rd("<i")
        if tag == TAG_LONG:
            return rd("<q")
        if tag == TAG_FLOAT:
            return rd("<f")
        if tag == TAG_DOUBLE:
            return rd("<d")
        if tag == TAG_STRING:
            return rs()
        if tag == TAG_LIST:
            t = rd("<b")
            n = rd("<i")
            return [payload(t) for _ in range(n)]
        if tag == TAG_COMPOUND:
            o = {}
            while True:
                t = rd("<b")
                if t == TAG_END:
                    return o
                k = rs()
                o[k] = payload(t)
        raise ValueError(f"tag {tag}")

    t = rd("<b")
    assert t == TAG_COMPOUND
    rs()
    return payload(TAG_COMPOUND)


# ---------------------------------------------------------------------------
#  ボクセル
# ---------------------------------------------------------------------------
def block_state(name, **states):
    """公式の状態一覧で検証しつつ、すべての状態を埋めた (name, states) を返す"""
    vb = vanilla_blocks()
    if name.startswith("minecraft:"):
        if name not in vb["blocks"]:
            raise ValueError(f"unknown block {name}")
        out = {}
        for p in vb["blocks"][name]:
            meta = vb["properties"][p]
            key = p
            if p in states:
                v = states[p]
            elif p.replace("minecraft:", "") in states:
                v = states[p.replace("minecraft:", "")]
            else:
                v = meta["values"][0] if meta["type"] != "bool" else False
            if v not in meta["values"] and not (meta["type"] == "bool" and v in (0, 1, True, False)):
                raise ValueError(f"{name}: {p}={v} not in {meta['values']}")
            out[key] = Byte(1 if v else 0) if meta["type"] == "bool" else (Int(v) if meta["type"] == "int" else str(v))
        extra = set(states) - set(vb["blocks"][name]) - {p.replace("minecraft:", "") for p in vb["blocks"][name]}
        if extra:
            raise ValueError(f"{name}: unknown states {extra}")
        return (name, tuple(sorted(out.items())))
    return (name, tuple(sorted((k, Int(v) if isinstance(v, int) else v) for k, v in states.items())))


VOID = ("minecraft:structure_void", ())
AIR = ("minecraft:air", ())


class Vox:
    def __init__(self, sx, sy, sz, seed):
        self.sx, self.sy, self.sz = sx, sy, sz
        self.b = {}
        self.rng = random.Random(seed)
        self.chests = []
        self.markers = []

    def inside(self, x, y, z):
        return 0 <= x < self.sx and 0 <= y < self.sy and 0 <= z < self.sz

    def set(self, x, y, z, name, **st):
        if self.inside(x, y, z):
            self.b[(x, y, z)] = block_state(name, **st) if isinstance(name, str) else name

    def box(self, x0, y0, z0, x1, y1, z1, name, hollow=False, **st):
        bs = block_state(name, **st) if isinstance(name, str) else name
        for x in range(min(x0, x1), max(x0, x1) + 1):
            for y in range(min(y0, y1), max(y0, y1) + 1):
                for z in range(min(z0, z1), max(z0, z1) + 1):
                    if hollow and min(x0, x1) < x < max(x0, x1) and min(z0, z1) < z < max(z0, z1) and min(y0, y1) < y < max(y0, y1):
                        continue
                    if self.inside(x, y, z):
                        self.b[(x, y, z)] = bs

    def walls(self, x0, y0, z0, x1, y1, z1, name, **st):
        bs = block_state(name, **st)
        for x in range(x0, x1 + 1):
            for y in range(y0, y1 + 1):
                for z in range(z0, z1 + 1):
                    if x in (x0, x1) or z in (z0, z1):
                        self.set(x, y, z, bs)

    def air(self, x0, y0, z0, x1, y1, z1):
        self.box(x0, y0, z0, x1, y1, z1, AIR)

    def chest(self, x, y, z, facing="south"):
        self.set(x, y, z, "minecraft:chest", **{"minecraft:cardinal_direction": facing})
        self.chests.append((x, y, z))

    def marker(self, x, y, z, role=0):
        """守備隊の出現位置（arsenal:spawn_marker）。role 0 どこでも / 1 屋上 / 2 中心 / 3 外周"""
        self.set(x, y, z, block_state(f"{NS}:spawn_marker", **{f"{NS}:role": role}))
        self.markers.append((x, y, z, role))

    def scatter(self, x0, z0, x1, z1, y, names, chance):
        for x in range(x0, x1 + 1):
            for z in range(z0, z1 + 1):
                if self.rng.random() < chance:
                    self.set(x, y, z, self.rng.choice(names))

    def to_nbt(self):
        palette = []
        index = {}
        prim = []
        for x in range(self.sx):
            for y in range(self.sy):
                for z in range(self.sz):
                    bs = self.b.get((x, y, z), VOID)
                    if bs not in index:
                        index[bs] = len(palette)
                        palette.append(bs)
                    prim.append(Int(index[bs]))
        pal = NList(TAG_COMPOUND, [{"name": n, "states": dict(st), "version": Int(BLOCK_VERSION)} for n, st in palette])
        root = {
            "format_version": Int(1),
            "size": NList(TAG_INT, [Int(self.sx), Int(self.sy), Int(self.sz)]),
            "structure": {
                "block_indices": NList(TAG_LIST, [NList(TAG_INT, prim), NList(TAG_INT, [Int(-1)] * len(prim))]),
                "entities": NList(TAG_COMPOUND, []),
                "palette": {"default": {"block_palette": pal, "block_position_data": {}}},
            },
            "structure_world_origin": NList(TAG_INT, [Int(0), Int(0), Int(0)]),
        }
        return nbt_bytes(root), [n for n, _ in palette]


# ---------------------------------------------------------------------------
#  構造物の設計
# ---------------------------------------------------------------------------
def _tent(v, x0, z0, g, color, length=5):
    """A 型のテント（z 方向に長い）"""
    for z in range(z0, z0 + length):
        v.set(x0, g, z, color)
        v.set(x0 + 4, g, z, color)
        v.set(x0 + 1, g + 1, z, color)
        v.set(x0 + 3, g + 1, z, color)
        v.set(x0 + 2, g + 2, z, color)
        for x in range(x0 + 1, x0 + 4):
            if (x, g, z) not in v.b:
                v.set(x, g, z, AIR)
        v.set(x0 + 2, g + 1, z, AIR)
    v.set(x0 + 2, g, z0 + length - 1, color)


def raider_camp(sd):
    sx, sy, sz = sd["size"]
    v = Vox(sx, sy, sz, "raider_camp")
    g = sd["sink"]  # 地面の 1 つ上（最初の空気の段）
    c = sx // 2
    # 地面：踏み固めた土と砂利
    for x in range(sx):
        for z in range(sz):
            d = abs(x - c) + abs(z - c)
            if d <= 8:
                v.set(x, g - 1, z, v.rng.choice(["minecraft:coarse_dirt", "minecraft:coarse_dirt", "minecraft:gravel", "minecraft:dirt_with_roots"]))
                v.air(x, g, z, x, sy - 1, z)
    # 焚き火と丸太の椅子
    v.set(c, g, c, "minecraft:campfire", extinguished=False, **{"minecraft:cardinal_direction": "north"})
    for dx, dz in ((-2, 0), (2, 0), (0, -2)):
        v.set(c + dx, g, c + dz, "minecraft:oak_log", pillar_axis="x" if dz == 0 else "z")
    # テント 3 張
    _tent(v, 1, 2, g, "minecraft:brown_wool")
    _tent(v, 11, 2, g, "minecraft:light_gray_wool")
    _tent(v, 6, 11, g, "minecraft:brown_wool", length=5)
    # 物資
    v.chest(3, g, 6, "north")
    v.chest(13, g, 6, "north")
    v.chest(8, g, 15, "north")
    for p in ((1, 9), (2, 9), (15, 10)):
        v.set(p[0], g, p[1], "minecraft:barrel", facing_direction=1)
    v.set(15, g, 9, "minecraft:hay_block", pillar_axis="y")
    v.set(14, g, 12, "minecraft:target")
    # 見張りの柵とランタン
    for (x, z) in ((0, 0), (16, 0), (0, 16), (16, 16)):
        v.set(x, g, z, "minecraft:oak_fence")
        v.set(x, g + 1, z, "minecraft:oak_fence")
        v.set(x, g + 2, z, "minecraft:lantern", hanging=False)
    for (x, z) in ((5, 8), (11, 8), (8, 5), (12, 13)):
        v.marker(x, g, z, 0)
    v.marker(c + 1, g, c + 1, 2)
    return v


def outpost(sd):
    sx, sy, sz = sd["size"]
    v = Vox(sx, sy, sz, "outpost")
    g = sd["sink"]
    v.box(0, g - 1, 0, sx - 1, g - 1, sz - 1, "minecraft:coarse_dirt")
    v.air(0, g, 0, sx - 1, sy - 1, sz - 1)
    # 土嚢の囲い（泥レンガ）、正面に切れ目
    for x in range(sx):
        for z in range(sz):
            if x in (0, sx - 1) or z in (0, sz - 1):
                if z == sz - 1 and 6 <= x <= 8:
                    continue
                v.set(x, g, z, "minecraft:mud_bricks")
                if (x + z) % 3:
                    v.set(x, g + 1, z, "minecraft:mud_brick_slab", **{"minecraft:vertical_half": "bottom"})
    # 見張り台（中央奥 5x5）
    tx, tz = 5, 2
    for (x, z) in ((tx, tz), (tx + 4, tz), (tx, tz + 4), (tx + 4, tz + 4)):
        v.box(x, g, z, x, g + 8, z, "minecraft:spruce_log", pillar_axis="y")
    v.box(tx, g + 8, tz, tx + 4, g + 8, tz + 4, "minecraft:spruce_planks")
    for x in range(tx, tx + 5):
        for z in range(tz, tz + 5):
            if x in (tx, tx + 4) or z in (tz, tz + 4):
                v.set(x, g + 9, z, "minecraft:spruce_fence")
    v.box(tx, g + 11, tz, tx + 4, g + 11, tz + 4, "minecraft:spruce_slab", **{"minecraft:vertical_half": "bottom"})
    for (x, z) in ((tx, tz), (tx + 4, tz), (tx, tz + 4), (tx + 4, tz + 4)):
        v.set(x, g + 10, z, "minecraft:spruce_fence")
    for y in range(g, g + 8):
        v.set(tx + 2, y, tz + 5, "minecraft:ladder", facing_direction=3)
    v.set(tx + 2, g + 8, tz + 4, AIR)
    v.marker(tx + 2, g + 9, tz + 2, 1)
    # 補給テントと焚き火
    _tent(v, 1, 8, g, "minecraft:green_wool", length=4)
    v.set(11, g, 10, "minecraft:campfire", extinguished=False, **{"minecraft:cardinal_direction": "north"})
    v.chest(2, g, 12, "north")
    v.chest(12, g, 3, "west")
    v.chest(tx + 2, g + 9, tz + 1, "south")
    v.set(12, g, 4, "minecraft:barrel", facing_direction=1)
    v.set(12, g, 5, "minecraft:barrel", facing_direction=1)
    v.set(tx + 2, g + 12, tz + 2, "minecraft:lantern", hanging=False)
    for (x, z) in ((3, 6), (11, 7), (9, 12)):
        v.marker(x, g, z, 0)
    v.marker(7, g, 9, 2)
    return v


def armory_bunker(sd):
    sx, sy, sz = sd["size"]
    v = Vox(sx, sy, sz, "armory_bunker")
    s = sd["sink"]  # 地面の高さ（y = s - 1 が地表のブロック）
    floor = 0
    top = s  # 屋根は地表の 1 段上
    wall = "minecraft:gray_concrete"
    v.box(1, floor, 3, sx - 2, top, sz - 2, wall, hollow=True)
    v.box(2, floor + 1, 4, sx - 3, top - 1, sz - 3, AIR)
    v.box(2, floor, 4, sx - 3, floor, sz - 3, "minecraft:polished_andesite")
    v.box(1, top, 3, sx - 2, top, sz - 2, "minecraft:light_gray_concrete")
    # 屋根の上の覆土（半分草）と換気口
    for x in range(1, sx - 1):
        for z in range(3, sz - 1):
            if v.rng.random() < 0.5:
                v.set(x, top + 1, z, "minecraft:moss_carpet")
    v.set(sx // 2, top + 1, sz - 5, "minecraft:iron_bars")
    # 入口：地表から階段で下りる溝
    cx = sx // 2
    for i, z in enumerate(range(0, 4)):
        yy = s - 1 - i
        v.air(cx - 1, yy, z, cx + 1, s + 1, z)
        v.set(cx - 1, yy, z, "minecraft:stone_brick_stairs", weirdo_direction=3)
        v.set(cx, yy, z, "minecraft:stone_brick_stairs", weirdo_direction=3)
        v.set(cx + 1, yy, z, "minecraft:stone_brick_stairs", weirdo_direction=3)
        v.set(cx - 2, yy, z, "minecraft:stone_bricks")
        v.set(cx + 2, yy, z, "minecraft:stone_bricks")
    v.air(cx - 1, floor + 1, 3, cx + 1, floor + 3, 3)
    # 照明と装備
    for z in range(6, sz - 3, 4):
        v.set(cx, top - 1, z, "minecraft:lantern", hanging=True)
    for z in range(5, sz - 3, 2):
        v.set(2, floor + 1, z, "minecraft:barrel", facing_direction=5)
        v.set(sx - 3, floor + 1, z, "minecraft:smithing_table")
    v.chest(3, floor + 1, sz - 3, "north")
    v.chest(sx - 4, floor + 1, sz - 3, "north")
    v.chest(cx - 1, floor + 1, sz - 3, "north")
    v.chest(cx + 1, floor + 1, sz - 3, "north")
    v.set(cx, floor + 1, sz - 3, "minecraft:anvil", damage="slightly_damaged") if "damage" in vanilla_blocks()["blocks"].get("minecraft:anvil", []) else v.set(cx, floor + 1, sz - 3, "minecraft:iron_block")
    v.box(4, floor + 1, 9, sx - 5, floor + 1, 9, "minecraft:iron_bars")
    v.set(cx, floor + 1, 9, AIR)
    for (x, z, r) in ((4, 6, 0), (sx - 5, 6, 0), (cx, 12, 2), (4, 14, 0)):
        v.marker(x, floor + 1, z, r)
    return v


def legion_lab(sd):
    sx, sy, sz = sd["size"]
    v = Vox(sx, sy, sz, "legion_lab")
    g = sd["sink"]
    v.box(0, 0, 0, sx - 1, g - 1, sz - 1, "minecraft:smooth_stone")
    v.air(0, g, 0, sx - 1, sy - 1, sz - 1)
    x0, z0, x1, z1 = 3, 3, sx - 4, sz - 4
    v.walls(x0, g, z0, x1, g + 6, z1, "minecraft:white_concrete")
    v.box(x0, g + 7, z0, x1, g + 7, z1, "minecraft:light_gray_concrete")
    v.box(x0 + 1, g - 1, z0 + 1, x1 - 1, g - 1, z1 - 1, "minecraft:polished_diorite")
    # 窓の帯
    for x in range(x0 + 2, x1 - 1, 3):
        for z in (z0, z1):
            v.set(x, g + 3, z, "minecraft:glass_pane")
            v.set(x, g + 4, z, "minecraft:glass_pane")
    for z in range(z0 + 2, z1 - 1, 3):
        for x in (x0, x1):
            v.set(x, g + 3, z, "minecraft:glass_pane")
            v.set(x, g + 4, z, "minecraft:glass_pane")
    # 入口
    cx = sx // 2
    v.air(cx - 1, g, z1, cx + 1, g + 2, z1)
    v.box(cx - 2, g + 3, z1 + 1, cx + 2, g + 3, z1 + 2, "minecraft:light_gray_concrete")
    # 中央の実験室（ガラスの壁）と照明
    v.walls(cx - 3, g, cx - 3, cx + 3, g + 3, cx + 3, "minecraft:light_blue_stained_glass")
    v.air(cx - 1, g, cx + 3, cx + 1, g + 2, cx + 3)
    for (x, z) in ((x0 + 3, z0 + 3), (x1 - 3, z0 + 3), (x0 + 3, z1 - 3), (x1 - 3, z1 - 3), (cx, cx)):
        v.set(x, g + 6, z, "minecraft:sea_lantern")
    v.set(cx, g, cx, "minecraft:beacon") if "minecraft:beacon" in vanilla_blocks()["blocks"] else None
    v.chest(cx - 2, g, cx - 2, "south")
    v.chest(x0 + 1, g, z0 + 1, "south")
    v.chest(x1 - 1, g, z0 + 1, "south")
    for z in range(z0 + 3, z1, 2):
        v.set(x1 - 1, g, z, "minecraft:iron_block") if z % 4 == 1 else v.set(x1 - 1, g, z, "minecraft:blast_furnace", **{"minecraft:cardinal_direction": "west"})
    # 屋上のアンテナと手すり
    v.box(cx + 4, g + 8, cx - 4, cx + 4, g + 10, cx - 4, "minecraft:iron_bars")
    v.set(cx + 4, g + 10, cx - 4, "minecraft:lightning_rod") if "minecraft:lightning_rod" in vanilla_blocks()["blocks"] else None
    for x in range(x0, x1 + 1):
        for z in (z0, z1):
            v.set(x, g + 8, z, "minecraft:iron_bars")
    for z in range(z0, z1 + 1):
        for x in (x0, x1):
            v.set(x, g + 8, z, "minecraft:iron_bars")
    v.set(x0 + 2, g + 8, z0 + 2, "minecraft:ladder", facing_direction=3)
    for (x, z, r) in ((x0 + 3, z0 + 2, 0), (cx + 2, cx + 5, 0), (x1 - 3, z1 - 2, 0), (cx - 4, cx, 2)):
        v.marker(x, g, z, r)
    v.marker(x0 + 4, g + 8, z0 + 4, 1)
    v.marker(x1 - 4, g + 8, z1 - 4, 1)
    v.marker(1, g, 1, 3)
    v.marker(sx - 2, g, sz - 2, 3)
    return v


def crashed_transport(sd):
    sx, sy, sz = sd["size"]
    v = Vox(sx, sy, sz, "crashed_transport")
    g = sd["sink"]
    # 墜落の溝
    for x in range(sx):
        for z in range(2, sz - 2):
            if v.rng.random() < 0.7:
                v.set(x, g - 1, z, v.rng.choice(["minecraft:coarse_dirt", "minecraft:gravel", "minecraft:coarse_dirt"]))
    cz = sz // 2
    body = "minecraft:light_gray_concrete"
    # 胴体（割れて 2 つに分かれている）
    for x in range(2, sx - 4):
        if 11 <= x <= 12:
            continue
        rng_r = 2 if x not in (2, sx - 5) else 1
        for dy in range(0, 4):
            for dz in range(-2, 3):
                inside = abs(dz) < 2 and 0 < dy < 3
                edge = abs(dz) == 2 or dy in (0, 3)
                if edge and not (abs(dz) == 2 and dy in (0, 3)):
                    if v.rng.random() < (0.93 if x not in (10, 13) else 0.55):
                        v.set(x, g + dy, cz + dz, body if dy else "minecraft:iron_block")
                elif inside:
                    v.set(x, g + dy, cz + dz, AIR)
        del rng_r
    # 窓
    for x in range(4, sx - 5, 3):
        v.set(x, g + 2, cz - 2, "minecraft:glass_pane")
        v.set(x, g + 2, cz + 2, "minecraft:glass_pane")
    # 翼（片方は折れて地面に刺さる）
    v.box(7, g + 2, 0, 9, g + 2, cz - 3, "minecraft:smooth_stone_slab", **{"minecraft:vertical_half": "bottom"})
    v.box(7, g, cz + 3, 9, g, sz - 1, "minecraft:smooth_stone_slab", **{"minecraft:vertical_half": "top"})
    # 尾翼
    v.box(sx - 4, g + 1, cz, sx - 2, g + 5, cz, body)
    v.box(sx - 4, g + 1, cz - 1, sx - 4, g + 2, cz + 1, body)
    # 積み荷と煙
    v.chest(5, g + 1, cz, "east")
    v.chest(16, g + 1, cz + 1, "west")
    v.chest(12, g, cz - 3, "north")
    for (x, z) in ((11, cz + 3), (13, cz + 4), (12, cz + 2)):
        v.set(x, g, z, "minecraft:barrel", facing_direction=1)
    v.set(11, g - 1, cz, "minecraft:campfire", extinguished=False, **{"minecraft:cardinal_direction": "north"})
    v.set(12, g - 1, cz - 1, "minecraft:magma")
    for (x, z, r) in ((3, cz - 4, 0), (18, cz + 4, 0), (12, cz, 2), (20, cz - 4, 0)):
        v.marker(x, g, z, r)
    return v


def derelict_port(sd):
    sx, sy, sz = sd["size"]
    v = Vox(sx, sy, sz, "derelict_port")
    g = sd["sink"]
    # 岸（コンクリートの護岸）と桟橋
    v.box(0, 0, 0, sx - 1, g - 1, 9, "minecraft:stone_bricks")
    v.air(0, g, 0, sx - 1, sy - 1, sz - 1)
    for x in range(0, sx):
        for z in range(10, sz):
            if 8 <= x <= 12:
                v.set(x, g - 1, z, "minecraft:spruce_planks" if v.rng.random() < 0.88 else AIR)
        if x in (8, 12):
            for z in range(10, sz, 3):
                v.box(x, 0, z, x, g - 1, z, "minecraft:spruce_log", pillar_axis="y")
    # 倉庫
    v.walls(1, g, 1, 9, g + 5, 8, "minecraft:spruce_planks")
    v.box(1, g + 6, 1, 9, g + 6, 8, "minecraft:dark_oak_slab", **{"minecraft:vertical_half": "bottom"})
    v.air(4, g, 8, 6, g + 3, 8)
    for x in (1, 9):
        for z in (1, 8):
            v.box(x, g, z, x, g + 5, z, "minecraft:spruce_log", pillar_axis="y")
    for (x, z) in ((3, 2), (7, 2)):
        v.set(x, g + 4, z, "minecraft:lantern", hanging=True)
    v.chest(2, g, 2, "south")
    v.chest(8, g, 2, "south")
    # 貨物コンテナ
    for (x0, z0, col) in ((13, 1, "minecraft:red_concrete"), (13, 5, "minecraft:blue_concrete"), (18, 1, "minecraft:orange_concrete")):
        v.box(x0, g, z0, x0 + 3, g + 2, z0 + 2, col, hollow=True)
        v.air(x0 + 1, g, z0 + 1, x0 + 2, g + 1, z0 + 1)
        v.air(x0 + 3, g, z0 + 1, x0 + 3, g + 1, z0 + 1)
    v.chest(14, g, 2, "east")
    v.chest(19, g, 2, "east")
    v.box(13, g + 3, 1, 16, g + 5, 3, "minecraft:green_concrete", hollow=True)
    # クレーン
    v.box(20, g, 7, 20, g + 8, 7, "minecraft:iron_block")
    v.box(14, g + 8, 7, 21, g + 8, 7, "minecraft:iron_block")
    v.box(15, g + 4, 7, 15, g + 7, 7, "minecraft:iron_chain", pillar_axis="y") if "minecraft:iron_chain" in vanilla_blocks()["blocks"] else v.box(15, g + 4, 7, 15, g + 7, 7, "minecraft:iron_bars")
    for (x, z, r) in ((3, 6, 0), (10, 13, 0), (15, 8, 0), (5, 4, 2), (10, sz - 2, 3)):
        v.marker(x, g, z, r)
    return v


def hollow_ruin(sd):
    sx, sy, sz = sd["size"]
    v = Vox(sx, sy, sz, "hollow_ruin")
    s = sd["sink"]
    wall = ["minecraft:mossy_cobblestone", "minecraft:cracked_stone_bricks", "minecraft:cobblestone", "minecraft:mossy_stone_bricks"]
    for x in range(1, sx - 1):
        for y in range(0, s + 1):
            for z in range(1, sz - 1):
                edge = x in (1, sx - 2) or z in (1, sz - 2) or y in (0, s)
                if edge:
                    if y == s and v.rng.random() < 0.35:
                        continue  # 崩れた天井
                    v.set(x, y, z, v.rng.choice(wall))
                else:
                    v.set(x, y, z, AIR)
    # 地上に突き出た割れた入口
    cx = sx // 2
    v.air(cx - 1, s, cx - 1, cx + 1, s + 1, cx + 1)
    for y in range(1, s + 1):
        v.set(cx, y, 2, "minecraft:ladder", facing_direction=3)
    v.air(cx, s, 1, cx, s + 1, 1)
    for (x, z) in ((cx - 2, cx - 2), (cx + 2, cx - 2), (cx - 2, cx + 2), (cx + 2, cx + 2)):
        v.box(x, s + 1, z, x, s + 1 + v.rng.randint(0, 1), z, v.rng.choice(wall))
    v.scatter(2, 2, sx - 3, sz - 3, s - 1, ["minecraft:web"], 0.12)
    v.scatter(2, 2, sx - 3, sz - 3, 1, ["minecraft:bone_block", "minecraft:moss_carpet", "minecraft:moss_carpet"], 0.12)
    v.chest(2, 1, sz - 3, "north")
    v.chest(sx - 3, 1, 3, "west")
    v.set(cx, 1, cx, "minecraft:soul_campfire", extinguished=False, **{"minecraft:cardinal_direction": "north"}) if "minecraft:soul_campfire" in vanilla_blocks()["blocks"] else None
    for (x, z, r) in ((3, 3, 0), (sx - 4, sz - 4, 0), (3, sz - 5, 0), (cx + 1, cx + 2, 2)):
        v.marker(x, 1, z, r)
    return v


def checkpoint(sd):
    sx, sy, sz = sd["size"]
    v = Vox(sx, sy, sz, "checkpoint")
    g = sd["sink"]
    cz = sz // 2
    # 地面と道（x 方向に通る）
    for x in range(sx):
        for z in range(sz):
            road = abs(z - cz) <= 2
            v.set(x, g - 1, z, "minecraft:gravel" if road else v.rng.choice(["minecraft:coarse_dirt", "minecraft:dirt", "minecraft:gravel"]))
            v.air(x, g, z, x, sy - 1, z)
    # 遮断機（縞模様）と支柱
    v.box(9, g, cz - 3, 9, g + 1, cz - 3, "minecraft:stone_brick_wall")
    for i, z in enumerate(range(cz - 2, cz + 3)):
        v.set(9, g + 1, z, "minecraft:red_concrete" if i % 2 == 0 else "minecraft:white_concrete")
    # 土嚢（泥レンガ）の陣地を道の両側に
    for x0 in (3, 14):
        for z in range(cz - 2, cz + 3):
            v.set(x0, g, z, "minecraft:mud_bricks")
            if z != cz:
                v.set(x0, g + 1, z, "minecraft:packed_mud")
    # 見張り小屋（2 階建て、屋上に狙撃手）
    hx0, hz0, hx1, hz1 = 11, 0, 16, 3
    v.walls(hx0, g, hz0, hx1, g + 3, hz1, "minecraft:spruce_planks")
    v.box(hx0, g + 4, hz0, hx1, g + 4, hz1, "minecraft:spruce_planks")
    v.air(13, g, hz1, 14, g + 1, hz1)
    for x in (12, 15):
        v.set(x, g + 2, hz0, "minecraft:glass_pane")
        v.set(x, g + 2, hz1, "minecraft:glass_pane")
    for x in range(hx0, hx1 + 1):
        for z in (hz0, hz1):
            v.set(x, g + 5, z, "minecraft:spruce_fence")
    for z in range(hz0, hz1 + 1):
        for x in (hx0, hx1):
            v.set(x, g + 5, z, "minecraft:spruce_fence")
    for y in range(g, g + 5):
        v.set(hx0 + 1, y, hz0 + 1, "minecraft:ladder", facing_direction=3)
    v.air(hx0 + 1, g + 4, hz0 + 1, hx0 + 1, g + 4, hz0 + 1)
    v.chest(hx1 - 1, g, hz0 + 1, "west")
    v.set(hx1 - 1, g, hz0 + 2, "minecraft:barrel", facing_direction=1)
    # 反対側：物資置き場と有刺鉄線
    v.chest(3, g, sz - 2, "north")
    for p in ((1, sz - 2), (5, sz - 2), (2, sz - 1)):
        v.set(p[0], g, p[1], "minecraft:barrel", facing_direction=1)
    for x in range(0, sx, 2):
        v.set(x, g, 0, "minecraft:iron_bars") if x < hx0 - 1 else None
        v.set(x, g, sz - 1, "minecraft:iron_bars") if x > 7 else None
    for (x, z) in ((0, cz - 3), (sx - 1, cz + 3)):
        v.set(x, g, z, "minecraft:oak_fence")
        v.set(x, g + 1, z, "minecraft:lantern", hanging=False)
    for (x, z, r) in ((4, cz - 1, 0), (15, cz + 1, 0), (6, sz - 3, 0), (9, cz + 4, 2), (13, hz0 + 2, 1), (1, 1, 3), (sx - 2, sz - 2, 3)):
        v.marker(x, g + 5 if r == 1 else g, z, r)
    return v


def radar_station(sd):
    sx, sy, sz = sd["size"]
    v = Vox(sx, sy, sz, "radar_station")
    g = sd["sink"]
    c = sx // 2
    v.box(0, 0, 0, sx - 1, g - 1, sz - 1, "minecraft:smooth_stone")
    v.air(0, g, 0, sx - 1, sy - 1, sz - 1)
    # 外周フェンス（入口は南）
    for i in range(sx):
        for (x, z) in ((i, 0), (i, sz - 1), (0, i), (sx - 1, i)):
            if z == sz - 1 and abs(x - c) <= 1:
                continue
            v.set(x, g, z, "minecraft:iron_bars")
            v.set(x, g + 1, z, "minecraft:iron_bars")
    # 管制棟
    x0, z0, x1, z1 = 2, 2, 8, 7
    v.walls(x0, g, z0, x1, g + 3, z1, "minecraft:light_gray_concrete")
    v.box(x0, g + 4, z0, x1, g + 4, z1, "minecraft:gray_concrete")
    v.air(5, g, z1, 5, g + 1, z1)
    for x in range(x0 + 1, x1, 2):
        v.set(x, g + 2, z0, "minecraft:glass_pane")
    v.chest(x0 + 1, g, z0 + 1, "south")
    v.chest(x1 - 1, g, z0 + 1, "south")
    v.set(x0 + 3, g, z0 + 1, "minecraft:observer", **{"minecraft:facing_direction": "up"})
    v.set(x0 + 4, g, z0 + 1, "minecraft:redstone_lamp")
    # レーダー塔（鉄格子の骨組み＋頂上の皿）
    tx, tz = 12, 5
    for y in range(g, g + 11):
        for (dx, dz) in ((-1, -1), (1, -1), (-1, 1), (1, 1)):
            v.set(tx + dx, y, tz + dz, "minecraft:iron_bars")
        v.set(tx, y, tz, "minecraft:ladder", facing_direction=3) if y < g + 11 else None
    v.box(tx - 2, g + 11, tz - 2, tx + 2, g + 11, tz + 2, "minecraft:iron_block")
    v.set(tx, g + 11, tz, AIR)
    v.box(tx - 3, g + 13, tz - 1, tx + 3, g + 13, tz + 1, "minecraft:white_concrete")
    v.box(tx, g + 12, tz, tx, g + 14, tz, "minecraft:iron_block")
    v.set(tx, g + 14, tz, "minecraft:daylight_detector")
    for x in range(tx - 2, tx + 3):
        for z in (tz - 2, tz + 2):
            v.set(x, g + 12, z, "minecraft:iron_bars")
    # 発電機
    for (x, z) in ((10, 11), (13, 11)):
        v.box(x, g, z, x + 1, g + 1, z + 2, "minecraft:iron_block")
        v.set(x, g + 2, z + 1, "minecraft:redstone_lamp")
    v.chest(c, g, sz - 3, "north")
    v.set(c - 3, g, sz - 4, "minecraft:barrel", facing_direction=1)
    for (x, z, r) in ((5, 9, 0), (11, 9, 0), (c, c + 2, 2), (2, sz - 3, 3), (sx - 3, 2, 3)):
        v.marker(x, g, z, r)
    v.marker(tx + 1, g + 12, tz, 1)
    return v


def infested_farm(sd):
    sx, sy, sz = sd["size"]
    v = Vox(sx, sy, sz, "infested_farm")
    g = sd["sink"]
    for x in range(sx):
        for z in range(sz):
            v.set(x, g - 1, z, "minecraft:coarse_dirt" if v.rng.random() < 0.5 else "minecraft:dirt")
            v.air(x, g, z, x, sy - 1, z)
    # 枯れた畑
    for x in range(1, 7):
        for z in range(1, sz - 1):
            v.set(x, g - 1, z, "minecraft:farmland", moisturized_amount=0)
            if v.rng.random() < 0.4:
                v.set(x, g, z, "minecraft:wheat", growth=v.rng.randint(0, 3))
    for z in range(1, sz - 1, 4):
        v.set(0, g, z, "minecraft:oak_fence")
    v.set(3, g, sz // 2, "minecraft:carved_pumpkin", **{"minecraft:cardinal_direction": "east"})
    # 納屋（壊れた壁と屋根）
    x0, z0, x1, z1 = 8, 1, sx - 2, sz - 2
    for x in range(x0, x1 + 1):
        for z in range(z0, z1 + 1):
            v.set(x, g - 1, z, "minecraft:spruce_planks")
    for y in range(g, g + 5):
        for x in range(x0, x1 + 1):
            for z in (z0, z1):
                if v.rng.random() < 0.85 or y < g + 2:
                    v.set(x, y, z, "minecraft:dark_oak_planks" if x in (x0, x1) else "minecraft:spruce_planks")
        for z in range(z0, z1 + 1):
            for x in (x0, x1):
                if v.rng.random() < 0.85 or y < g + 2:
                    v.set(x, y, z, "minecraft:dark_oak_log", pillar_axis="y") if z in (z0, z1) else v.set(x, y, z, "minecraft:spruce_planks")
    v.air(x0, g, (z0 + z1) // 2 - 1, x0, g + 2, (z0 + z1) // 2 + 1)
    for x in range(x0, x1 + 1):
        for z in range(z0, z1 + 1):
            if v.rng.random() < 0.7:
                v.set(x, g + 5, z, "minecraft:oak_slab", **{"minecraft:vertical_half": "bottom"})
    # 中の干し草・骨・苔
    for (x, z) in ((x1 - 1, z0 + 1), (x1 - 1, z0 + 2), (x1 - 2, z0 + 1)):
        v.set(x, g, z, "minecraft:hay_block", pillar_axis="y")
    v.scatter(x0 + 1, z0 + 1, x1 - 1, z1 - 1, g, ["minecraft:moss_carpet", "minecraft:moss_carpet", "minecraft:bone_block"], 0.15)
    v.scatter(x0 + 1, z0 + 1, x1 - 1, z1 - 1, g + 4, ["minecraft:web"], 0.12)
    v.chest(x0 + 1, g, z1 - 1, "north")
    v.chest(x1 - 1, g, z1 - 1, "north")
    v.chest(2, g, sz - 2, "north")
    v.set(5, g, 1, "minecraft:composter", composter_fill_level=0)
    cx, cz = (x0 + x1) // 2, (z0 + z1) // 2
    for (x, z, r) in ((x0 + 2, z0 + 2, 0), (x1 - 3, z1 - 3, 0), (3, 3, 0), (4, sz - 4, 0), (cx, cz, 2), (sx - 1, sz - 1, 3)):
        v.marker(x, g, z, r)
    return v


def crow_compound(sd):
    """ブラッククロウの前線基地（3.0）：金網で囲んだ敷地、2 階建ての指揮所、ヘリパッド、照明塔"""
    sx, sy, sz = sd["size"]
    v = Vox(sx, sy, sz, "crow_compound")
    g = sd["sink"]
    for x in range(sx):
        for z in range(sz):
            v.set(x, g - 1, z, v.rng.choice(["minecraft:gravel", "minecraft:gray_concrete_powder", "minecraft:gravel", "minecraft:coarse_dirt"]))
            v.air(x, g, z, x, sy - 1, z)
    # 金網の柵（入口は南）
    for x in range(sx):
        for z in (0, sz - 1):
            if z == sz - 1 and sx // 2 - 2 <= x <= sx // 2 + 2:
                continue
            v.set(x, g, z, "minecraft:iron_bars")
            v.set(x, g + 1, z, "minecraft:iron_bars")
    for z in range(sz):
        for x in (0, sx - 1):
            v.set(x, g, z, "minecraft:iron_bars")
            v.set(x, g + 1, z, "minecraft:iron_bars")
    # 指揮所（2 階建て、屋上に見張り）
    bx0, bz0, bx1, bz1 = 2, 2, 10, 9
    v.box(bx0, g - 1, bz0, bx1, g - 1, bz1, "minecraft:smooth_stone")
    v.walls(bx0, g, bz0, bx1, g + 6, bz1, "minecraft:gray_concrete")
    v.box(bx0, g + 3, bz0, bx1, g + 3, bz1, "minecraft:light_gray_concrete")
    v.box(bx0, g + 7, bz0, bx1, g + 7, bz1, "minecraft:black_concrete")
    v.air(6, g, bz1, 7, g + 1, bz1)
    for x in (4, 8):
        for y in (g + 1, g + 5):
            v.set(x, y, bz0, "minecraft:tinted_glass")
            v.set(x, y, bz1, "minecraft:tinted_glass")
    for z in (4, 7):
        v.set(bx1, g + 1, z, "minecraft:tinted_glass")
        v.set(bx1, g + 5, z, "minecraft:tinted_glass")
    # 階段代わりのはしご（1 階 → 2 階 → 屋上）
    for y in range(g, g + 8):
        v.set(bx0 + 1, y, bz0 + 1, "minecraft:ladder", facing_direction=3)
    v.air(bx0 + 1, g + 3, bz0 + 1, bx0 + 1, g + 3, bz0 + 1)
    v.air(bx0 + 1, g + 7, bz0 + 1, bx0 + 1, g + 7, bz0 + 1)
    for y in (g + 3, g + 7):
        v.set(bx0 + 1, y, bz0 + 1, "minecraft:ladder", facing_direction=3)
    for x in range(bx0, bx1 + 1):
        for z in (bz0, bz1):
            v.set(x, g + 8, z, "minecraft:andesite_wall")
    for z in range(bz0, bz1 + 1):
        for x in (bx0, bx1):
            v.set(x, g + 8, z, "minecraft:andesite_wall")
    v.set(bx1 - 1, g + 8, bz0 + 1, "minecraft:lightning_rod", facing_direction=1)
    v.chest(bx1 - 1, g, bz0 + 1, "west")
    v.chest(bx1 - 1, g + 4, bz1 - 1, "west")
    v.set(bx1 - 1, g, bz0 + 2, "minecraft:barrel", facing_direction=1)
    v.set(bx0 + 3, g + 4, bz0 + 2, "minecraft:redstone_lamp")
    # ヘリパッド（黄色の H）
    hx, hz = 15, 6
    v.box(hx - 3, g - 1, hz - 3, hx + 3, g - 1, hz + 3, "minecraft:gray_concrete")
    for dz in range(-2, 3):
        v.set(hx - 1, g - 1, hz + dz, "minecraft:yellow_concrete")
        v.set(hx + 1, g - 1, hz + dz, "minecraft:yellow_concrete")
    v.set(hx, g - 1, hz, "minecraft:yellow_concrete")
    # 照明塔と物資
    for (x, z) in ((1, sz - 2), (sx - 2, sz - 2), (sx - 2, 1)):
        v.box(x, g, z, x, g + 3, z, "minecraft:andesite_wall")
        v.set(x, g + 4, z, "minecraft:sea_lantern")
    v.chest(15, g, sz - 4, "north")
    for p in ((13, sz - 4), (17, sz - 4), (14, sz - 3), (16, sz - 3)):
        v.set(p[0], g, p[1], "minecraft:barrel", facing_direction=1)
    # 土嚢の陣地（入口の前）
    for x in range(sx // 2 - 3, sx // 2 + 4):
        if abs(x - sx // 2) >= 2:
            v.set(x, g, sz - 4, "minecraft:mud_bricks")
    for (x, z, r) in ((6, 5, 2), (4, 12, 0), (16, 12, 0), (12, 16, 0), (5, 6, 0), (8, 6, 1), (18, 2, 3), (2, sz - 3, 3)):
        v.marker(x, g + 8 if r == 1 else g, z, r)
    return v


def crow_relay(sd):
    """ブラッククロウの通信中継所（3.0）：鉄塔のアンテナと小さな機材小屋"""
    sx, sy, sz = sd["size"]
    v = Vox(sx, sy, sz, "crow_relay")
    g = sd["sink"]
    c = sx // 2
    for x in range(sx):
        for z in range(sz):
            v.set(x, g - 1, z, v.rng.choice(["minecraft:gravel", "minecraft:coarse_dirt", "minecraft:gravel"]))
            v.air(x, g, z, x, sy - 1, z)
    # 鉄塔（四隅の柱と横桟。上に足場と避雷針）
    tx0, tx1 = c - 2, c + 2
    for y in range(g, g + 11):
        for (x, z) in ((tx0, tx0), (tx0, tx1), (tx1, tx0), (tx1, tx1)):
            v.set(x, y, z, "minecraft:andesite_wall")
        if (y - g) % 4 == 3:
            for i in range(tx0, tx1 + 1):
                for (x, z) in ((i, tx0), (i, tx1), (tx0, i), (tx1, i)):
                    v.set(x, y, z, "minecraft:iron_bars")
    for y in range(g, g + 11):
        v.set(c, y, c, "minecraft:ladder", facing_direction=3)
        v.set(c, y, c - 1, "minecraft:polished_andesite")
    v.box(tx0, g + 11, tx0, tx1, g + 11, tx1, "minecraft:iron_block")
    v.air(c, g + 11, c, c, g + 11, c)
    v.set(c, g + 11, c, "minecraft:ladder", facing_direction=3)
    for i in range(tx0, tx1 + 1):
        for (x, z) in ((i, tx0), (i, tx1), (tx0, i), (tx1, i)):
            v.set(x, g + 12, z, "minecraft:iron_bars")
    v.box(c + 1, g + 12, c + 1, c + 1, g + 13, c + 1, "minecraft:andesite_wall")
    v.set(c + 1, g + 14, c + 1, "minecraft:lightning_rod", facing_direction=1)
    v.set(c - 1, g + 12, c - 1, "minecraft:redstone_lamp")
    # 機材小屋
    v.walls(0, g, 0, 4, g + 2, 3, "minecraft:gray_concrete")
    v.box(0, g + 3, 0, 4, g + 3, 3, "minecraft:black_concrete")
    v.air(2, g, 3, 2, g + 1, 3)
    v.set(0, g + 1, 2, "minecraft:tinted_glass")
    v.chest(1, g, 1, "east")
    v.set(3, g, 1, "minecraft:barrel", facing_direction=1)
    v.chest(sx - 2, g, sz - 2, "north")
    for p in ((sx - 3, sz - 2), (sx - 2, sz - 3)):
        v.set(p[0], g, p[1], "minecraft:barrel", facing_direction=1)
    for (x, z) in ((0, sz - 1), (sx - 1, 0)):
        v.box(x, g, z, x, g + 2, z, "minecraft:andesite_wall")
        v.set(x, g + 3, z, "minecraft:sea_lantern")
    for (x, z, r) in ((c, c + 1, 2), (2, 6, 0), (sx - 3, 4, 0), (4, sz - 3, 3), (c - 1, c + 1, 1)):
        v.marker(x, g + 12 if r == 1 else g, z, r)
    return v


BUILDERS = {
    "raider_camp": raider_camp, "outpost": outpost, "armory_bunker": armory_bunker, "legion_lab": legion_lab,
    "crashed_transport": crashed_transport, "derelict_port": derelict_port, "hollow_ruin": hollow_ruin,
    "checkpoint": checkpoint, "radar_station": radar_station, "infested_farm": infested_farm,
    "crow_compound": crow_compound, "crow_relay": crow_relay,
}


class StructuresMixin:
    def structures(self):
        S = self.d["STRUCTURES"]
        kinds = list(S)
        self.structure_report = {}
        for i, (sid, sd) in enumerate(S.items()):
            v = BUILDERS[sid](sd)
            data, names = v.to_nbt()
            path = f"{self.bp}/structures/{NS}/{sid}.mcstructure"
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "wb") as f:
                f.write(data)
            self.structure_report[sid] = {"blocks": sorted(set(names)), "chests": len(v.chests), "markers": len(v.markers), "size": [v.sx, v.sy, v.sz]}
            # 目印の構造物（1 ブロック）
            m = Vox(1, 1, 1, "site")
            m.set(0, 0, 0, block_state(f"{NS}:site_marker", **{f"{NS}:kind": i}))
            mdata, _ = m.to_nbt()
            with open(f"{self.bp}/structures/{NS}/site_{sid}.mcstructure", "wb") as f:
                f.write(mdata)
            feat = f"site_{sid}_feature"
            wjson(f"{self.bp}/features/{feat}.json", {"format_version": "1.13.0", "minecraft:structure_template_feature": {
                "description": {"identifier": f"{NS}:{feat}"},
                "structure_name": f"{NS}:site_{sid}",
                "adjustment_radius": 4,
                "facing_direction": "random",
                "constraints": {"grounded": {}, "unburied": {}, "block_intersection": {"block_allowlist": ["minecraft:air", "minecraft:short_grass", "minecraft:tall_grass", "minecraft:snow_layer"]}},
            }})
            denom = max(2, int(round(100 / sd["scatter"])))
            bf = [{"test": "has_biome_tag", "operator": "==", "value": b} for b in sd["biomes"]]
            wjson(f"{self.bp}/feature_rules/site_{sid}_rule.json", {"format_version": "1.13.0", "minecraft:feature_rules": {
                "description": {"identifier": f"{NS}:site_{sid}_rule", "places_feature": f"{NS}:{feat}"},
                "conditions": {"placement_pass": "surface_pass", "minecraft:biome_filter": [{"any_of": bf}] if len(bf) > 1 else bf},
                "distribution": {
                    "iterations": 1,
                    "scatter_chance": {"numerator": 1, "denominator": denom},
                    "x": {"distribution": "uniform", "extent": [0, 15]},
                    "y": "q.heightmap(v.worldx, v.worldz)",
                    "z": {"distribution": "uniform", "extent": [0, 15]},
                },
            }})
            self.Lname(f"arsenal.structure.{sid}", sd["name"])
        self.site_kinds = kinds
        # ランタイム用：宝箱と出現位置の座標（構造物の中の相対座標）。本体を置いたあと、ブロックを走査しなくて済む
        pts = {}
        for sid, sd in S.items():
            v = BUILDERS[sid](sd)
            pts[sid] = {"chests": [list(c) for c in v.chests], "markers": [list(m) for m in v.markers], "size": [v.sx, v.sy, v.sz]}
        src = os.path.join(os.path.dirname(os.path.abspath(self.bp)), "src", "scripts", "config", "structures.gen.js")
        with open(src, "w", encoding="utf-8") as f:
            f.write("// @ts-nocheck\n// 自動生成（tools/gen/structures.py）。構造物の宝箱と出現位置の相対座標。直接編集しないこと\n")
            f.write("/** @type {Record<string, {chests:number[][], markers:number[][], size:number[]}>} */\n")
            f.write("export const STRUCTURE_POINTS = " + json.dumps(pts, separators=(",", ":")) + ";\n")
            f.write("export const SITE_KINDS = " + json.dumps(kinds) + ";\n")
        self.log(f"  structures: {len(S)} (+ site markers, features, feature rules)")
