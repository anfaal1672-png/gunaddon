"""Bedrock の level.dat（8 バイトのヘッダー＋リトルエンディアンの NBT）を読み書きする最小限の実装"""
import struct
END, BYTE, SHORT, INT, LONG, FLOAT, DOUBLE, BARR, STR, LIST, COMP, IARR, LARR = range(13)
class R:
    def __init__(s, b): s.b, s.i = b, 0
    def u(s, f, n): v = struct.unpack_from("<" + f, s.b, s.i)[0]; s.i += n; return v
    def str(s): n = s.u("H", 2); v = s.b[s.i:s.i + n].decode("utf-8", "replace"); s.i += n; return v
    def payload(s, t):
        if t == BYTE: return s.u("b", 1)
        if t == SHORT: return s.u("h", 2)
        if t == INT: return s.u("i", 4)
        if t == LONG: return s.u("q", 8)
        if t == FLOAT: return s.u("f", 4)
        if t == DOUBLE: return s.u("d", 8)
        if t == BARR: n = s.u("i", 4); v = s.b[s.i:s.i + n]; s.i += n; return v
        if t == STR: return s.str()
        if t == LIST:
            et = s.u("b", 1); n = s.u("i", 4); return (et, [s.payload(et) for _ in range(n)])
        if t == COMP:
            d = {}
            while True:
                tt = s.u("b", 1)
                if tt == END: return d
                k = s.str(); d[k] = (tt, s.payload(tt))
        if t == IARR: n = s.u("i", 4); return [s.u("i", 4) for _ in range(n)]
        if t == LARR: n = s.u("i", 4); return [s.u("q", 8) for _ in range(n)]
        raise ValueError(t)
def w_payload(t, v):
    if t == BYTE: return struct.pack("<b", v)
    if t == SHORT: return struct.pack("<h", v)
    if t == INT: return struct.pack("<i", v)
    if t == LONG: return struct.pack("<q", v)
    if t == FLOAT: return struct.pack("<f", v)
    if t == DOUBLE: return struct.pack("<d", v)
    if t == BARR: return struct.pack("<i", len(v)) + v
    if t == STR: b = v.encode(); return struct.pack("<H", len(b)) + b
    if t == LIST: et, items = v; return struct.pack("<bi", et, len(items)) + b"".join(w_payload(et, x) for x in items)
    if t == COMP:
        out = b""
        for k, (tt, vv) in v.items():
            kb = k.encode(); out += struct.pack("<bH", tt, len(kb)) + kb + w_payload(tt, vv)
        return out + b"\0"
    if t == IARR: return struct.pack("<i", len(v)) + b"".join(struct.pack("<i", x) for x in v)
    if t == LARR: return struct.pack("<i", len(v)) + b"".join(struct.pack("<q", x) for x in v)
def load(path):
    b = open(path, "rb").read()
    ver = struct.unpack_from("<i", b, 0)[0]
    r = R(b[8:]); t = r.u("b", 1); name = r.str(); return ver, name, r.payload(t)
def save(path, ver, name, root):
    nb = name.encode()
    body = struct.pack("<bH", COMP, len(nb)) + nb + w_payload(COMP, root)
    open(path, "wb").write(struct.pack("<ii", ver, len(body)) + body)
