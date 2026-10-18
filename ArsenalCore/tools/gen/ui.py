"""ARSENAL CORE 生成：HUD（JSON UI）— 1.0.2 のスコープ表示 ＋ 2.0 の HUD 2.0

データの受け渡しはタイトル文字列（#hud_title_text_string）とサブタイトル（#hud_subtitle_text_string）を使う。
  ・スコープ表示：目印 "§a§r§s§n" + "§" + 番号 が含まれているか（1.0.2 と同じ）
  ・HUD 2.0：1 文字ごとの札（".a12." ＝ 弾数の 1 桁目が 2）を含むかで、画像と 1 文字ずつのラベルを出し分ける（data/hud.js）。
    スコープ表示と同じく引き算と比較だけを使い、文字列の * 演算（'%.Ns' * #t）は使わない
  ・毎 tick 変わる値（照準の広がり・方位）だけはサブタイトルの札で受け取る（タイトルを毎 tick 変えない。data/hud.js の live）
バニラの要素は置き換えない。root_panel の先頭に 1 つ足すのと、目印入りのタイトルの枠を隠すだけ。
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from texgen import textures as tx  # noqa: E402
from texgen import icons2 as ic  # noqa: E402
from gen.common import NS, wjson, wpng  # noqa: E402,F401


TITLE_VAR = "#arsenal_t"
# 毎 tick 変わる値（照準の広がり・方位）はサブタイトルで受け取る（data/hud.js の live）
SUB_VAR = "#arsenal_s"


def _bind_title():
    return {"binding_name": "#hud_title_text_string", "binding_name_override": TITLE_VAR, "binding_type": "global"}


def _bind_sub():
    return {"binding_name": "#hud_subtitle_text_string", "binding_name_override": SUB_VAR, "binding_type": "global"}


def _contains(s, var=TITLE_VAR):
    """タイトル（var がサブタイトルならサブタイトル）が s を含むか（スコープ表示と同じ、引き算と比較だけの式）"""
    return f"(not (({var} - '{s}') = {var}))"


class Hud2Expr:
    """HUD 2.0 の表示条件を作る（build.py の往復テストも同じ式を評価する）

    タイトルは 1 文字ごとの札（SEP + キー + 桁 + 文字 + SEP）の並びなので、条件は「札を含むか」の組み合わせだけ。
    文字列の * 演算（'%.Ns' * #t の切り出し）は使わない。
    """

    def __init__(self, hud2, var=TITLE_VAR, mark="§a§r§s§n"):
        self.h = hud2
        self.var = var
        self.mark = mark
        self.f = {f["name"]: f for f in hud2["fields"]}

    def token(self, name, i, ch):
        sep = self.h["sep"]
        return f"{sep}{self.f[name]['key']}{i}{self.h['blank'] if ch == ' ' else ch}{sep}"

    def has(self, name, i, ch):
        if name == self.h.get("liveRaw"):
            raise ValueError(f"{name}: 札ではなくそのままの値で送る（raw_texture を使う）")
        if (name in self.h.get("live", [])) != (self.var == SUB_VAR):
            raise ValueError(f"{name}: {'サブタイトル' if name in self.h.get('live', []) else 'タイトル'}で送る値を {self.var} で見ている")
        return _contains(self.token(name, i, ch), self.var)

    def eq(self, name, value):
        if len(value) != self.f[name]["len"]:
            raise ValueError(f"{name}: 長さ {self.f[name]['len']} の値ではない {value!r}")
        parts = [self.has(name, i, ch) for i, ch in enumerate(value)]
        return parts[0] if len(parts) == 1 else "(" + " and ".join(parts) + ")"

    def any_of(self, name, values):
        return "(" + " or ".join(self.eq(name, v) for v in values) + ")"

    def active(self):
        return _contains(self.h["header"] + self.h["sep"], self.var)

    def _strip_parts(self):
        """サブタイトルから、方位とダメージ以外（見出し・目印・ほかの札・区切り・印）を取り除く引き算の並び"""
        H = self.h
        parts = [H["liveHeader"], self.mark]
        for name in H["live"]:
            if name == H["liveRaw"]:
                continue
            f = self.f[name]
            parts += [f"{H['sep']}{f['key']}{i}{ch}" for i in range(f["len"]) for ch in H["liveChars"][name]]
        return parts + [H["sep"], H["rawMark"], H["dmgMark"]]

    @staticmethod
    def _minus(parts):
        return "(" + SUB_VAR + "".join(f" - '{p}'" for p in parts) + ")"

    def raw_value(self):
        """方位（英字 2 文字）だけを残す式：ほかを引いたあと、ダメージの色コードと数字も引く（* 演算は使わない）"""
        H = self.h
        return self._minus(self._strip_parts() + list(H["dmgColors"].values()) + list("0123456789"))

    def raw_texture(self, prefix):
        return f"('{prefix}' + {self.raw_value()})"

    def raw_shown(self):
        """生の値があり、隠す印（---）ではない"""
        H = self.h
        return f"({_contains(H['liveHeader'] + H['sep'], SUB_VAR)} and (not {_contains(H['rawMark'] + '---', SUB_VAR)}))"

    def dmg_text(self):
        """ダメージ（色コード + 数字）だけを残す式：ほかを引いたあと、方位の英字と隠す印も引く"""
        H = self.h
        return self._minus(self._strip_parts() + ["---"] + list(H["hdgLetters"]))

    def dmg_shown(self):
        H = self.h
        # 印の直後が色コード（目印 "§a§r§s§n" も § で始まるので、色コードまで見る）
        colors = " or ".join(_contains(H["dmgMark"] + c, SUB_VAR) for c in H["dmgColors"].values())
        return f"({_contains(H['liveHeader'] + H['sep'], SUB_VAR)} and ({colors}))"


def hdg_letters(hud2, i):
    """方位の番号（0〜179）→ 英字 2 文字"""
    a = hud2["hdgLetters"]
    return a[i // len(a)] + a[i % len(a)]


class UiMixin:
    SCOPE_MARK = "§a§r§s§n"
    SCOPE_KINDS = {"1": ("scope", "2x"), "2": ("scope", "4x"), "3": ("scope", "8x"), "4": ("scope", "thermal"), "5": ("reticle", "dot"), "6": ("reticle", "holo")}

    def hud_ui(self):
        """ui/hud_screen.json"""
        M = self.SCOPE_MARK
        tex = f"{self.rp}/textures/ui/arsenal"
        for k in ("2x", "4x", "8x", "thermal"):
            wpng(f"{tex}/scope_{k}.png", tx.scope_overlay(k))
        wpng(f"{tex}/reticle_dot.png", tx.reticle("dot"))
        wpng(f"{tex}/reticle_holo.png", tx.reticle("holo"))
        wpng(f"{tex}/black.png", tx.solid((6, 6, 8, 255)))

        def bind(code):
            return [
                {"binding_name": "#hud_title_text_string", "binding_name_override": "#arsenal_t", "binding_type": "global"},
                {"binding_type": "view", "source_property_name": f"(not ((#arsenal_t - '{M}§{code}') = #arsenal_t))", "target_property_name": "#visible"},
            ]

        ui = {"namespace": "hud"}
        # keep_ratio: false が要る。既定（縦横比を保つ）だと 16×16 の黒が正方形のまま中央に置かれ、
        # 左右の黒い縁が画面の中ほどの帯にしかならない（スコープ中に四隅から景色が見えていた）
        ui["arsenal_black"] = {"type": "image", "texture": "textures/ui/arsenal/black", "size": ["fill", "100%"], "keep_ratio": False}
        root_controls = []
        for code, (kind, name) in self.SCOPE_KINDS.items():
            key = f"arsenal_view_{name}"
            if kind == "scope":
                ui[key] = {
                    "type": "stack_panel", "orientation": "horizontal",
                    "size": ["100%", "100%"], "anchor_from": "center", "anchor_to": "center",
                    "controls": [
                        {"left@hud.arsenal_black": {}},
                        {"lens": {"type": "image", "texture": f"textures/ui/arsenal/scope_{name}", "size": ["100%y", "100%"]}},
                        {"right@hud.arsenal_black": {}},
                    ],
                    "bindings": bind(code),
                }
            else:
                px = 14 if name == "dot" else 40
                ui[key] = {
                    "type": "image", "texture": f"textures/ui/arsenal/reticle_{name}",
                    "size": [px, px], "anchor_from": "center", "anchor_to": "center",
                    "bindings": bind(code),
                }
            root_controls.append({f"{name}@hud.{key}": {}})
        ui["arsenal_scope_root"] = {
            "type": "panel", "size": ["100% + 48px", "100% + 48px"], "anchor_from": "center", "anchor_to": "center",
            "layer": 0, "controls": root_controls,
        }
        hud2_controls = self._hud2(ui)
        # HUD 2.0 のタイトルでないとき（"AC2|" が無い）は親パネルごと隠す。子は自分の条件だけを評価する（毎フレームの式を減らす）
        ui["arsenal_hud2_root"] = {
            "type": "panel", "size": ["100%", "100%"], "anchor_from": "center", "anchor_to": "center", "layer": 1,
            "controls": hud2_controls,
            "bindings": [_bind_title(), {"binding_type": "view", "source_property_name": self.hud2_expr.active(), "target_property_name": "#visible"}],
        }
        ui["root_panel"] = {"modifications": [
            {"array_name": "controls", "operation": "insert_front", "value": [
                {"arsenal_scope_root@hud.arsenal_scope_root": {}},
                {"arsenal_hud2_root@hud.arsenal_hud2_root": {}},
            ]},
        ]}
        # 目印入りのタイトルは枠ごと隠す（HUD 2.0 のデータも目印を含むので、文字が画面に出ることはない）
        ui["hud_title_text"] = {"modifications": [
            {"array_name": "controls", "operation": "replace", "control_name": "title_frame", "value": {"title_frame": {
                "type": "panel",
                "size": ["100%", "100%cm"],
                "controls": [
                    {"title_background": {"type": "image", "size": ["100%sm + 30px", "100%sm + 6px"], "texture": "textures/ui/hud_tip_text_background", "alpha": "@hud.anim_title_background_alpha_in"}},
                    {"title": {
                        "type": "label", "anchor_from": "top_middle", "anchor_to": "top_middle",
                        "color": "$title_command_text_color", "enable_profanity_filter": True,
                        "text": "#text", "layer": 31, "localize": False, "font_size": "extra_large",
                        "variables": [{"requires": "(not $title_shadow)", "$show_shadow": False}, {"requires": "$title_shadow", "$show_shadow": True}],
                        "shadow": "$show_shadow", "text_alignment": "center", "offset": [0, 6],
                        "bindings": [{"binding_name": "#hud_title_text_string", "binding_name_override": "#text", "binding_type": "global"}],
                    }},
                ],
                "bindings": [
                    {"binding_name": "#hud_title_text_string", "binding_name_override": "#arsenal_t", "binding_type": "global"},
                    {"binding_type": "view", "source_property_name": f"((#arsenal_t - '{M}') = #arsenal_t)", "target_property_name": "#visible"},
                ],
            }}},
        ]}
        # HUD 2.0 のサブタイトル（毎 tick 変わる値。目印を含む）も枠ごと隠す。目印のない知らせ（従来の HUD）はバニラと同じに出る
        ui["hud_title_text"]["modifications"].append(
            {"array_name": "controls", "operation": "replace", "control_name": "subtitle_frame", "value": {"subtitle_frame": {
                "type": "panel",
                "size": ["100%", "100%cm"],
                "controls": [
                    {"subtitle_background": {
                        "type": "image", "size": ["100%sm + 20px", "100%sm + 5px"], "offset": [0, 16], "texture": "textures/ui/hud_tip_text_background",
                        "variables": [{"requires": "$subtitle_initially_visible", "$subtitle_bg": "@hud.anim_title_background_alpha_in"},
                                      {"requires": "(not $subtitle_initially_visible)", "$subtitle_bg": "@hud.anim_subtitle_background_alpha_in"}],
                        "alpha": "$subtitle_bg"}},
                    {"subtitle": {
                        "type": "label", "anchor_from": "top_middle", "anchor_to": "top_middle",
                        "color": "$title_command_text_color", "enable_profanity_filter": True,
                        "text": "#text", "layer": 31, "localize": False, "font_size": "large",
                        "variables": [{"requires": "$subtitle_initially_visible", "$anim_type": 1.0},
                                      {"requires": "(not $subtitle_initially_visible)", "$anim_type": "@hud.anim_subtitle_text_alpha_in"},
                                      {"requires": "(not $title_shadow)", "$show_shadow": False}, {"requires": "$title_shadow", "$show_shadow": True}],
                        "shadow": "$show_shadow", "alpha": "$anim_type", "text_alignment": "center", "offset": [1, 19],
                        "bindings": [{"binding_name": "#hud_subtitle_text_string", "binding_name_override": "#text", "binding_type": "global"}],
                    }},
                ],
                "bindings": [
                    {"binding_name": "#hud_subtitle_text_string", "binding_name_override": "#arsenal_s", "binding_type": "global"},
                    {"binding_type": "view", "source_property_name": f"((#arsenal_s - '{M}') = #arsenal_s)", "target_property_name": "#visible"},
                ],
            }}})
        wjson(f"{self.rp}/ui/hud_screen.json", ui)
        self.ui_textures = [f"textures/ui/arsenal/{n}" for n in ("scope_2x", "scope_4x", "scope_8x", "scope_thermal", "reticle_dot", "reticle_holo", "black")]
        self.log(f"  hud ui: scope 4 + reticle 2 + HUD 2.0 ({self.hud2_count} controls)")

    # ------------------------------------------------------------------
    #  HUD 2.0
    # ------------------------------------------------------------------
    def _hud2(self, ui):
        H = self.d["HUD2"]
        E = Hud2Expr(H)
        EL = Hud2Expr(H, SUB_VAR)  # 毎 tick 変わる値（照準の広がり・方位）
        self.hud2_expr = E
        tex = f"{self.rp}/textures/ui/arsenal/hud2"
        for i in range(10):
            wpng(f"{tex}/xh_{i}.png", ic.crosshair(i))
        for k in ("hit", "head", "kill"):
            wpng(f"{tex}/hm_{k}.png", ic.hitmarker(k))
        for i in range(8):
            wpng(f"{tex}/dmg_{i}.png", ic.damage_arc(i))
            wpng(f"{tex}/wind_{i}.png", ic.wind_arrow(i))
        for i in range(180):
            # 名前は英字 2 文字（compass_AA〜compass_GX。data/hud.js の hdgLetters）
            wpng(f"{tex}/compass_{hdg_letters(H, i)}.png", ic.compass_strip(i * 2))
        for lv in (1, 2, 3):
            wpng(f"{tex}/sup_{lv}.png", ic.vignette(lv))
        wpng(f"{tex}/nvg.png", ic.nvg_overlay())
        wpng(f"{tex}/plate_on.png", ic.plate_icon(True))
        wpng(f"{tex}/plate_off.png", ic.plate_icon(False))
        wpng(f"{tex}/panel.png", ic.panel(110))
        for i in range(10):
            from PIL import Image, ImageDraw
            im = Image.new("RGBA", (40, 4), (0, 0, 0, 120))
            d = ImageDraw.Draw(im)
            d.rectangle([0, 0, int(40 * (i + 1) / 10) - 1, 3], fill=(120, 200, 255, 230))
            wpng(f"{tex}/bar_{i}.png", im)
        n = [0]
        DIGITS = "0123456789"

        def vis(cond):
            """表示条件。式が見ている文字列（タイトル・サブタイトル）だけをバインドする"""
            if not cond:
                return []
            binds = ([_bind_title()] if TITLE_VAR in cond else []) + ([_bind_sub()] if SUB_VAR in cond else [])
            return binds + [{"binding_type": "view", "source_property_name": cond, "target_property_name": "#visible"}]

        def img(name, texture, size, anchor="center", offset=(0, 0), cond=None, layer=2):
            n[0] += 1
            c = {"type": "image", "texture": f"textures/ui/arsenal/hud2/{texture[:-4] if texture.endswith('.png') else texture}", "size": list(size),
                 "anchor_from": anchor, "anchor_to": anchor, "offset": list(offset), "layer": layer, "bindings": vis(cond)}
            if "100%" in size:
                c["keep_ratio"] = False  # 全画面の効果（暗視・制圧）を画面いっぱいに引き伸ばす
            return {name: c}

        def align_of(anchor):
            return "right" if anchor.endswith("right") else "left" if anchor.endswith("left") else "center"

        def label(name, text, anchor="center", offset=(0, 0), cond=None, color=(1, 1, 1), scale=1.0, localize=True, layer=3):
            """固定の文字のラベル（翻訳キー、または 1 文字）。表示するかどうかだけを条件で決める"""
            n[0] += 1
            c = {"type": "label", "anchor_from": anchor, "anchor_to": anchor, "offset": [int(round(offset[0])), offset[1]], "layer": layer,
                 "color": list(color), "shadow": True, "font_scale_factor": scale, "text_alignment": align_of(anchor), "size": ["default", "default"],
                 "text": text, "localize": localize, "bindings": vis(cond)}
            return {name: c}

        def group(name, controls, cond=None):
            """子をまとめるパネル（親の条件が偽なら子の条件は評価しない）"""
            n[0] += 1
            return {name: {"type": "panel", "size": ["100%", "100%"], "anchor_from": "center", "anchor_to": "center", "layer": 1,
                           "controls": controls, "bindings": vis(cond)}}

        def cell_x(anchor, ox, k, count, cw):
            """等幅の枠の k 番目（左から）の x。右寄せの基準は右端、左寄せは左端、中央は中心"""
            if anchor.endswith("right"):
                return ox - (count - 1 - k) * cw
            if anchor.endswith("left"):
                return ox + k * cw
            return ox + (k - (count - 1) / 2) * cw

        def text_cells(name, parts, anchor, offset, cond=None, color=(1, 1, 1), scale=1.0, layer=3):
            # cond はグループのパネルではなく各ラベルに付ける（cond かつ札）。表示条件付きのパネルの子は、
            # パネルが現れた直後にタイトルが変わらないと古い表示のまま残ることがある（実機で測距の数字が出ず "m" だけ出た）
            """数字などの文字列を 1 文字ずつのラベルで表示する。
            parts の要素：("f", フィールド名, 桁, 使う文字) → その桁の文字ごとに 1 枚（札を含むものだけ見える）
                          ("c", 文字)                     → 常に見える固定の文字
                          None                            → 空白 1 文字分
            Minecraft の既定フォントの数字は幅 6 px（字 5 ＋ 間隔 1）なので、6 px × 倍率の格子に並べる"""
            cw = 6 * scale
            ox, oy = offset
            kids = []
            for k, part in enumerate(parts):
                if part is None:
                    continue
                at = (cell_x(anchor, ox, k, len(parts), cw), oy)
                if part[0] == "c":
                    kids.append(label(f"{name}_{k}", part[1], anchor=anchor, offset=at, cond=cond, color=color, scale=scale, localize=False, layer=layer))
                    continue
                _, field, pos, chars = part
                for ch in chars:
                    own = E.has(field, pos, ch)
                    kids.append(label(f"{name}_{k}_{ord(ch)}", ch, anchor=anchor, offset=at, cond=f"({cond} and {own})" if cond else own, color=color,
                                      scale=scale, localize=False, layer=layer))
            return group(name, kids)

        def digits(field, chars=DIGITS):
            return [("f", field, i, chars) for i in range(E.f[field]["len"])]

        def not_(cond):
            return f"(not {cond})"

        out = []
        # 全画面：暗視・制圧
        out.append(img("nvg", "nvg.png", ("100%", "100%"), cond=E.eq("nvg", "1"), layer=0))
        for lv in (1, 2, 3):
            out.append(img(f"sup{lv}", f"sup_{lv}.png", ("100%", "100%"), cond=E.eq("sup", str(lv)), layer=0))
        # 中央：クロスヘア・ヒットマーカー・被弾方向
        for i in range(10):
            out.append(img(f"xh{i}", f"xh_{i}.png", (48, 48), cond=EL.eq("xh", str(i))))
        for code, k in (("1", "hit"), ("2", "head"), ("3", "kill")):
            out.append(img(f"hm_{k}", f"hm_{k}.png", (32, 32), cond=E.eq("hit", code), layer=4))
        for i in range(8):
            out.append(img(f"dmg{i}", f"dmg_{i}.png", (140, 140), cond=E.eq("dir", str(i + 1)), layer=4))
        # 測距・風
        out.append(text_cells("rng", digits("rng") + [("c", "m")], "center", (0, 34), cond=not_(E.eq("rng", "----")), color=(1, 0.9, 0.5)))
        for i in range(8):
            out.append(img(f"wind{i}", f"wind_{i}.png", (20, 20), offset=(70, 34), cond=E.eq("wdir", str(i))))
        for v in ("1", "2", "3"):
            out.append(label(f"wstr{v}", f"x{v}", offset=(88, 34), cond=E.eq("wstr", v), color=(0.7, 0.9, 1.0), scale=0.8, localize=False))
        # 上：方位バー（2.6）：2° ごとの 180 枚の画像を、1 枚の画像のテクスチャ名で切り替える。
        # 名前はサブタイトルの方位（英字 2 文字）から作る（Hud2Expr.raw_texture）。表示条件は 1 つ
        n[0] += 1
        out.append({"cmp": {"type": "image", "texture": "#texture", "size": [192, 18], "anchor_from": "top_middle", "anchor_to": "top_middle", "offset": [0, 2], "layer": 2,
                            "bindings": [_bind_sub(),
                                         {"binding_type": "view", "source_property_name": EL.raw_shown(), "target_property_name": "#visible"},
                                         {"binding_type": "view", "source_property_name": EL.raw_texture("textures/ui/arsenal/hud2/compass_"), "target_property_name": "#texture"}]}})
        # 方位バーの画像を全部、最初から読み込んでおく（2.6.2）。テクスチャ名を切り替えるたびに読み込むと、
        # 読み込むまでの一瞬だけ何も出ず、向きを変えると点滅した。表示条件のない 1 px・ほぼ透明の画像なので、毎フレームの評価はない
        pre = []
        for i in range(180):
            pre.append({f"cmp_pre{i}": {"type": "image", "texture": f"textures/ui/arsenal/hud2/compass_{hdg_letters(H, i)}", "size": [1, 1], "alpha": 0.01,
                                        "anchor_from": "top_left", "anchor_to": "top_left", "offset": [0, 0], "layer": 0}})
            n[0] += 1
        out.append({"cmp_preload": {"type": "panel", "size": [1, 1], "anchor_from": "top_left", "anchor_to": "top_left", "controls": pre}})
        # 照準の右上：与えたダメージ（2.6.2）。色コードつきの数字をサブタイトルからそのまま出す（ラベル 1 つ）
        n[0] += 1
        out.append({"dmgnum": {"type": "label", "text": "#text", "localize": False, "shadow": True, "font_scale_factor": 1.0, "layer": 5, "color": [1, 1, 1],
                               "anchor_from": "center", "anchor_to": "left_middle", "offset": [16, -14], "size": ["default", "default"], "text_alignment": "left",
                               "bindings": [_bind_sub(),
                                            {"binding_type": "view", "source_property_name": EL.dmg_shown(), "target_property_name": "#visible"},
                                            {"binding_type": "view", "source_property_name": EL.dmg_text(), "target_property_name": "#text"}]}})
        # 上：ゲームモードの得点（試合中だけ。子はモード名と得点・時間）
        gm_names = {"1": "arsenal.mode_name.ffa", "2": "arsenal.mode_name.tdm", "3": "arsenal.mode_name.gungame", "4": "arsenal.mode_name.horde", "5": "arsenal.mode_name.koth"}
        gm = [img("gm_panel", "panel.png", (150, 30), anchor="top_middle", offset=(0, 22))]
        for code, key in gm_names.items():
            gm.append(label(f"gm{code}", key, anchor="top_middle", offset=(0, 23), cond=E.eq("gm", code), color=(1, 0.85, 0.4), scale=0.8))
        gm.append(text_cells("gm_sa", digits("sa"), "top_middle", (-44, 35), color=(0.5, 0.8, 1.0)))
        gm.append(text_cells("gm_tm", digits("tm", DIGITS + ":"), "top_middle", (0, 35)))
        gm.append(text_cells("gm_sb", digits("sb"), "top_middle", (44, 35), color=(1.0, 0.5, 0.45)))
        out.append(group("gm", gm, not_(E.eq("gm", "0"))))
        # 左上：クレジット・連続キル・ストリーク
        out.append(text_cells("cr", [None] + digits("cr"), "top_left", (6, 6), color=(1, 0.85, 0.35), scale=0.9))
        out.append(text_cells("stk", [None] + digits("stk"), "top_left", (6, 18), cond=not_(E.eq("stk", " 0")), color=(1, 0.6, 0.3), scale=0.9))
        out.append(label("ks", "arsenal.ui.ks_ready", anchor="top_left", offset=(40, 18), cond=E.eq("ks", "1"), color=(0.5, 1, 0.5), scale=0.8))
        # 右下（配置 3 通り）：弾数・モード・状態・プレート・体力
        places = {"0": ("bottom_right", (-10, -42)), "1": ("bottom_right", (-10, -118)), "2": ("bottom_left", (10, -60))}
        has_ammo = not_(E.eq("ammo", "---"))
        for lay, (anchor, (ox, oy)) in places.items():
            sgn = -1 if anchor.endswith("right") else 1
            g = []  # この配置の子（親パネルが lay の条件を持つ）

            def at(dx, dy):
                return (ox + sgn * dx, oy + dy)
            g.append(img(f"l{lay}_panel", "panel.png", (104, 48), anchor=anchor, offset=at(-4, 4), layer=1))
            for sz, scale in (("0", 1.5), ("1", 2.0), ("2", 2.6)):
                g.append(text_cells(f"l{lay}_ammo{sz}", digits("ammo"), anchor, at(46, -18), cond=f"({E.eq('sz', sz)} and {has_ammo})", scale=scale))
            # 予備弾："/" ＋ 4 桁。無限は "INF"
            res_parts = [("c", "/")] + digits("res")
            res_at = at(0, -14)
            g.append(text_cells(f"l{lay}_res", res_parts, anchor, res_at, cond=has_ammo, color=(0.75, 0.75, 0.78)))
            inf_x = cell_x(anchor, res_at[0], len(res_parts) - 1 if sgn < 0 else 1, len(res_parts), 6)
            g.append(label(f"l{lay}_inf", "INF", anchor=anchor, offset=(inf_x, res_at[1]), cond=f"({has_ammo} and {E.eq('res', 'INF ')})",
                           color=(0.75, 0.75, 0.78), localize=False))
            modes = {"S": "arsenal.mode.semi", "A": "arsenal.mode.auto", "B": "arsenal.mode.burst", "C": "arsenal.mode.charge", "D": "arsenal.mode.double", "U": "arsenal.mode.ub", "M": "arsenal.ui.melee"}
            for code, key in modes.items():
                g.append(label(f"l{lay}_mode{code}", key, anchor=anchor, offset=at(0, -2), cond=E.eq("mode", code), color=(0.9, 0.9, 0.6), scale=0.8))
            states = {"R": ("arsenal.ui.reloading", (0.5, 0.8, 1.0)), "J": ("arsenal.ui.jammed", (1, 0.4, 0.3)), "H": ("arsenal.ui.overheated", (1, 0.5, 0.2)),
                      "L": ("arsenal.ui.locking", (1, 0.9, 0.3)), "K": ("arsenal.ui.locked", (1, 0.3, 0.3)), "B": ("arsenal.ui.breath", (0.5, 0.9, 1.0)),
                      "E": ("arsenal.ui.empty", (1, 0.3, 0.3)), "P": ("arsenal.ui.spawn_protect", (1, 0.8, 0.3)), "X": ("arsenal.ui.broken", (1, 0.3, 0.3))}
            for code, (key, col) in states.items():
                g.append(label(f"l{lay}_st{code}", key, anchor=anchor, offset=at(0, -60), cond=E.eq("st", code), color=col, scale=0.8))
            # 熱・充電・リロードの進み具合（0 のときは出さない）
            for i in range(1, 10):
                g.append(img(f"l{lay}_bar{i}", f"bar_{i}.png", (60, 4), anchor=anchor, offset=at(0, -52), cond=E.eq("heat", str(i))))
            for k in range(1, 5):
                full = [str(v) for v in range(k, 5)]
                g.append(img(f"l{lay}_pl{k}on", "plate_on.png", (10, 10), anchor=anchor, offset=at(90 - k * 12, 8), cond=E.any_of("plate", full)))
                g.append(img(f"l{lay}_pl{k}off", "plate_off.png", (10, 10), anchor=anchor, offset=at(90 - k * 12, 8), cond=E.any_of("plate", [str(v) for v in range(0, k)])))
            g.append(text_cells(f"l{lay}_hp", [None] + digits("hp"), anchor, at(0, 8), color=(1, 0.5, 0.5), scale=0.9))
            out.append(group(f"lay{lay}", g, E.eq("lay", lay)))
        self.hud2_count = n[0]
        return [dict(c) for c in out]
