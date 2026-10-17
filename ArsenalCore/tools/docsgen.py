"""ARSENAL CORE 2.0 — ドキュメントの自動生成（docs/WEAPON_STATS.md の追加の表と README.md）"""
import json
import math

NAME = lambda d: f"{d['name']['ja']} ({d['name']['en']})"  # noqa: E731


def _ttk_shots(w):
    pel = w.get("pellets", 1)
    return w["dmg"] * pel * (0.8 if pel > 1 else 1)


def _fire_time(w, shots):
    rpm = w["rpm"]
    mode0 = w["modes"][0]
    if shots <= 1:
        return 0.0
    if mode0.startswith("burst"):
        n = int(mode0[5:])
        br = w.get("burstRpm", rpm)
        bd = w.get("burstDelay", 5)
        full = (shots - 1) // n
        rem = (shots - 1) % n
        return (full * ((n - 1) * 1200 / br + bd) + rem * 1200 / br) / 20
    if mode0 == "double":
        return max(0.0, (math.ceil(shots / 2) - 1) * 60 / rpm)
    return (shots - 1) * 60 / rpm


def _shots_vs(dmg, ap, armor_pts, plates, plate_hp, hp=20.0):
    """防具（バニラの式、ap で割り引き）→ プレート → 体力 の順に受け止めたときの必要弾数"""
    a = armor_pts * (1 - min(1, ap))
    left_plates = plates * plate_hp
    n = 0
    while hp > 0 and n < 200:
        n += 1
        d = dmg
        if a > 0:
            eff = max(0.0, min(20.0, max(a / 5, a - 4 * d / 8)))
            d *= 1 - eff / 25
        take = min(left_plates, d)
        left_plates -= take
        hp -= d - take
    return n


def extra_sections(data):
    W, T = data["WEAPONS"], data["TIERS"]
    L = []
    # 近接
    L += ["## 近接武器", "", "| 武器 | ティア | ダメージ | 背後 | 特殊 | 移動 | 体TTK（振り） | 作成 |", "|---|---|---:|---:|---|---:|---:|---|"]
    for mid, m in data["MELEE"].items():
        swing = 0.25 if m["dmg"] < 8 else 0.4
        hits = max(1, math.ceil(20 / m["dmg"]))
        rec = "ルート限定" if m["tier"] == "legendary" else "作業台"
        L.append(f"| {NAME(m)} | {T[m['tier']]['name']['ja']} | {m['dmg']} | ×{m['backstab']} | {m['desc']['ja']} | {int(m['move'] * 100)}% | {(hits - 1) * swing:.2f}（{hits} 回） | {rec} |")
    L.append("")
    # 防具と TTK
    ARM = data["ARMOR"]
    reps = {c: next((wid for wid, w in W.items() if w["cat"] == c), None) for c in ("smg", "assault", "battle", "sniper", "shotgun", "lmg")}
    sets = [("なし", 0, 0), ("軽装 I（頭＋胴）", ARM["helmet_light_1"]["protection"] + ARM["vest_light_1"]["protection"], ARM["vest_light_1"]["plates"]),
            ("標準 II", ARM["helmet_standard_2"]["protection"] + ARM["vest_standard_2"]["protection"], ARM["vest_standard_2"]["plates"]),
            ("重装 III", ARM["helmet_heavy_3"]["protection"] + ARM["vest_heavy_3"]["protection"], ARM["vest_heavy_3"]["plates"])]
    L += ["## 防具と TTK", "", "胴撃ちで倒すまでの時間（秒、プレートは満タン）。防具点はバニラの式、徹甲（ap）で割り引き、そのあとプレート（1 枚 10）が受け止めます。", "",
          "| 代表武器 | " + " | ".join(n for n, _, _ in sets) + " |", "|---|" + "---:|" * len(sets)]
    for cat, wid in reps.items():
        if not wid:
            continue
        w = W[wid]
        d = _ttk_shots(w)
        cells = []
        for _, pts, pl in sets:
            n = _shots_vs(d, w.get("ap", 0), pts, pl, data["PLATE_HP"])
            cells.append(f"{_fire_time(w, n):.2f}（{n} 発）")
        L.append(f"| {NAME(w)} | " + " | ".join(cells) + " |")
    L.append("")
    L += ["| 防具 | 部位 | ティア | 防御 | 頭の軽減 | プレート | 移動 | 特殊 |", "|---|---|---|---:|---:|---:|---:|---|"]
    for aid, a in ARM.items():
        L.append(f"| {NAME(a)} | {'頭' if a['slot'] == 'head' else '胴'} | {T[a['tier']]['name']['ja']} | {a['protection']} | {int(a['headProt'] * 100)}% | {a['plates']} | {int(a['move'] * 100)}% | {a.get('special') or ''} |")
    L.append("")
    # 投擲物・医療・設置物・乗り物
    L += ["## 投擲物・爆発物", "", "| 名前 | 効果 |", "|---|---|"]
    for tid, t in data["THROWABLES"].items():
        L.append(f"| {NAME(t)} | {t['desc']['ja']} |")
    L += ["", "## 医療品", "", "| 名前 | 使用時間 | 効果 |", "|---|---:|---|"]
    for mid, m in data["MEDICAL"].items():
        L.append(f"| {NAME(m)} | {m['use'] / 20:.1f} 秒 | {m['desc']['ja']} |")
    L += ["", "## 設置物", "", "| 名前 | 耐久 | 効果 |", "|---|---:|---|"]
    for did, dd in data["DEPLOYABLES"].items():
        L.append(f"| {NAME(dd)} | {dd['health'] or dd.get('durability', '')} | {dd['desc']['ja']} |")
    L += ["", "## 銃座・乗り物", "", "| 名前 | 耐久 | ダメージ | RPM | 射程 | 弾薬 | 説明 |", "|---|---:|---:|---:|---:|---|---|"]
    for vid, v in data["VEHICLES"].items():
        L.append(f"| {NAME(v)} | {v['health']} | {v['dmg']} | {v['rpm']} | {v['range']} | {data['AMMO_FAMILIES'][v['ammo']]['name']['ja']} | {v['desc']['ja']} |")
    # 敵・ボス
    L += ["", "## 敵", "", "| 敵 | 勢力 | 役割 | 体力 | 装甲 | 武器 | 1 発 | 交戦距離 |", "|---|---|---|---:|---:|---|---:|---:|"]
    for eid, e in data["ENEMIES"].items():
        wn = W[e["weapon"]]["name"]["ja"] if e.get("weapon") else "近接"
        L.append(f"| {NAME(e)} | {data['FACTIONS'][e['faction']]['name']['ja']} | {e['role']} | {e['health']} | {int(e.get('armorValue', 0) * 100)}% | {wn} | {e['damage']} | {e['range']} |")
    L += ["", "## ボス", "", "| ボス | 体力 | 段階 | 行動 | 部位 | 呼び出し | 報酬 |", "|---|---:|---:|---|---|---|---|"]
    for bid, b in data["BOSSES"].items():
        acts = " → ".join("/".join(v) for _, v in sorted(b["actions"].items()))
        parts = "・".join(p["name"]["ja"] for p in (b.get("parts") or {}).values()) or "—"
        L.append(f"| {NAME(b)} | {b['health']} | {len(b['phases'])} | {acts} | {parts} | {data['TOOLS'][b['summon']]['name']['ja']} | {b['reward']['credits']} クレジット・経験値 {b['reward']['xp']}・レジェンダリー |")
    # 役割の重複
    L += ["", "## 役割の重複チェック（自動）", "", "同じカテゴリで最も性能が近い 2 挺と、その差（ダメージ・RPM・装弾数・射程・腰だめ拡散のうち最も差の大きい項目）。ビルド時に 5% 以内の組があると失敗します。", "",
          "| カテゴリ | 最も近い 2 挺 | 最大の差 |", "|---|---|---:|"]
    by = {}
    for wid, w in W.items():
        by.setdefault(w["cat"], []).append(wid)
    feats = [lambda w: w["dmg"] * w.get("pellets", 1), lambda w: w["rpm"], lambda w: w["mag"], lambda w: w["range"][1], lambda w: w["spread"]["hip"]]
    for cat, ids in by.items():
        best = None
        for i in range(len(ids)):
            for j in range(i + 1, len(ids)):
                a, b = W[ids[i]], W[ids[j]]
                diff = max(abs(f(a) - f(b)) / max(abs(f(a)), abs(f(b)), 1e-6) for f in feats)
                if best is None or diff < best[0]:
                    best = (diff, ids[i], ids[j])
        if best:
            L.append(f"| {data['CATEGORIES'][cat]['name']['ja']} | {W[best[1]]['name']['ja']} / {W[best[2]]['name']['ja']} | {best[0] * 100:.0f}% |")
    L.append("")
    return L


# ---------------------------------------------------------------------------
#  README
# ---------------------------------------------------------------------------
WORLD_SETTING_DOC = {
    "damageMul": "銃のダメージ倍率", "headMul": "ヘッドショット倍率の効き", "friendlyFire": "味方撃ち", "explosionGrief": "爆発でブロックを壊すか（ゲームルールに従う／常に／しない）",
    "glassBreak": "弾でガラスが割れる", "durability": "武器の耐久とジャム", "creativeInfinite": "クリエイティブで弾が減らない", "raiders": "レイダーズの出現",
    "spawnProtect": "ワールドのスポーン周辺で撃てない半径", "flashlightBlocks": "フラッシュライトで光源ブロックを置く", "killFeed": "キルログ", "autoReload": "弾切れで自動リロード",
    "legion": "アイアン・レギオンの出現", "hollow": "ホロウの出現", "structures": "構造物の密度（なし／少なめ／標準／多め）", "economy": "経済（クレジット・店）",
    "progressionLocks": "アタッチメント作成に武器レベルが必要", "killstreaks": "キルストリーク", "downed": "ダウン制（即死せず蘇生待ち）", "bleeding": "出血",
    "backstabPvp": "PvP の背後攻撃の倍率の上限", "aimAssistPvp": "プレイヤーへのエイムアシスト", "wind": "風（遠距離弾が流れる）", "aiDifficulty": "敵 AI の難易度",
    "suppression": "制圧（至近弾で拡散が増える）", "bosses": "ボスの召喚",
}
PLAYER_SETTING_DOC = {
    "adsMode": "ADS の操作（長押し／切り替え）", "triggerMode": "フルオートの撃ち方（押している間／タップで開始・停止）", "reloadInput": "リロードの操作（スニーク 2 回／手動のみ）",
    "hudMode": "HUD の情報量（全部／簡易／なし）", "hudPos": "従来型 HUD の位置", "hitmarkers": "ヒットマーカー", "damageNumbers": "ダメージの数字", "blood": "血しぶき",
    "aimKick": "撃ったときの視点の跳ね（なし／弱／強）", "cameraShake": "画面の揺れ", "fovZoom": "ADS の視野角のズーム", "fxQuality": "演出の品質", "volume": "効果音の音量",
    "trajectory": "投擲の軌道表示", "hudStyle": "HUD の種類（HUD 2.0／従来型）", "hudScale": "HUD 2.0 の大きさ", "compass": "方位バー", "damageDir": "被弾方向の表示",
    "suppressionFx": "制圧の画面効果", "aimAssist": "エイムアシスト（対モブ）", "autoFire": "照準が敵に重なったら自動で撃つ", "fpOffsetV": "一人称の武器の高さ",
    "fpOffsetD": "一人称の武器の距離", "showRank": "名前の横に階級", "nvgAuto": "暗視ゴーグルを暗所で自動オン", "hudLayout": "HUD 2.0 の配置（自動／標準／高め／左）",
}


def _table(head, rows):
    out = ["| " + " | ".join(head) + " |", "|" + "---|" * len(head)]
    out += ["| " + " | ".join(str(c) for c in r) + " |" for r in rows]
    return "\n".join(out)


def readme(data, tpl, trademarks):
    W, T, C = data["WEAPONS"], data["TIERS"], data["CATEGORIES"]
    fam = lambda f: data["AMMO_FAMILIES"].get(f, {"name": {"ja": "なし"}})["name"]["ja"]  # noqa: E731
    wrows = []
    for cid, c in sorted(C.items(), key=lambda kv: kv[1]["order"]):
        for wid, w in W.items():
            if w["cat"] != cid:
                continue
            d = _ttk_shots(w)
            n = max(1, math.ceil(20 / d)) if d > 0 else 99
            wrows.append([NAME(w), c["name"]["ja"], T[w["tier"]]["name"]["ja"], fam(w["ammo"]), w["mag"], w["rpm"], f"{_fire_time(w, n):.2f}"])
    mrows = [[NAME(m), T[m["tier"]]["name"]["ja"], m["dmg"], f"×{m['backstab']}", m["desc"]["ja"]] for m in data["MELEE"].values()]
    arows = []
    for slot, sd in data["ATTACHMENT_SLOTS"].items():
        for aid, a in data["ATTACHMENTS"].items():
            if a["slot"] == slot:
                arows.append([NAME(a), sd["name"]["ja"], T[a["tier"]]["name"]["ja"], a["desc"]["ja"]])
    armrows = [[NAME(a), "頭" if a["slot"] == "head" else "胴", T[a["tier"]]["name"]["ja"], a["protection"], a["plates"], a.get("special") or ""] for a in data["ARMOR"].values()]
    grows = []
    for kind, tbl in (("投擲物", data["THROWABLES"]), ("医療品", data["MEDICAL"]), ("設置物", data["DEPLOYABLES"]), ("銃座・乗り物", data["VEHICLES"])):
        for g in tbl.values():
            grows.append([NAME(g), kind, T[g.get("tier", "common")]["name"]["ja"], g["desc"]["ja"]])
    erows = [[NAME(e), data["FACTIONS"][e["faction"]]["name"]["ja"], e["role"], e["health"], W[e["weapon"]]["name"]["ja"] if e.get("weapon") else "近接"] for e in data["ENEMIES"].values()]
    erows += [[NAME(b), data["FACTIONS"][b["faction"]]["name"]["ja"], "ボス", b["health"], W[b["weapon"]]["name"]["ja"]] for b in data["BOSSES"].values()]
    srows = [[NAME(s), data["FACTIONS"][s["faction"]]["name"]["ja"], s["desc"]["ja"], "・".join(f"{c['tier']}×{c['count']}" for c in s["chests"])] for s in data["STRUCTURES"].values()]
    krows = [[NAME(k), k["kills"], k["points"], k["desc"]["ja"]] for k in data["KILLSTREAKS"].values()]
    mdrows = [[NAME(m), m["desc"]["ja"], "個人戦" if m["teams"] == 0 else "協力" if m["teams"] == 1 else "2 チーム", m["minPlayers"], m["scoreLimit"] or "—", f"{m['timeLimit'] // 60} 分" if m["timeLimit"] else "—"] for m in data["MODES"].values()]
    lrows = [[NAME(l), W[l["primary"]]["name"]["ja"], W[l["secondary"]]["name"]["ja"], data["MELEE"][l["melee"]]["name"]["ja"], "・".join(f"{i.split(':')[1]}×{n}" for i, n in l["gear"])] for l in data["LOADOUTS"].values()]
    wsrows = [[f"`{k}`", f"`{json.dumps(v, ensure_ascii=False)}`", WORLD_SETTING_DOC.get(k, "")] for k, v in data["DEFAULT_WORLD_SETTINGS"].items()]
    psrows = [[f"`{k}`", f"`{json.dumps(v, ensure_ascii=False)}`", PLAYER_SETTING_DOC.get(k, "")] for k, v in data["DEFAULT_PLAYER_SETTINGS"].items()]
    rep = {
        "{{N_WEAPONS}}": str(len(W) + len(data["MELEE"])), "{{N_GUNS}}": str(len(W)), "{{N_MELEE}}": str(len(data["MELEE"])), "{{N_ATT}}": str(len(data["ATTACHMENTS"])),
        "{{N_AMMO}}": str(len(data["ammoItems"])), "{{N_ARMOR}}": str(len(data["ARMOR"])), "{{N_GEAR}}": str(len(grows)), "{{N_ENEMIES}}": str(len(data["ENEMIES"])),
        "{{N_STRUCT}}": str(len(data["STRUCTURES"])), "{{N_TM}}": str(len(trademarks)),
        "{{WEAPON_LIST}}": _table(["武器", "カテゴリ", "ティア", "弾薬", "装弾", "RPM", "体TTK（秒）"], wrows),
        "{{MELEE_LIST}}": _table(["武器", "ティア", "ダメージ", "背後", "特徴"], mrows),
        "{{ATT_LIST}}": _table(["アタッチメント", "枠", "ティア", "効果"], arows),
        "{{ARMOR_LIST}}": _table(["防具", "部位", "ティア", "防御", "プレート", "特殊"], armrows),
        "{{GEAR_LIST}}": _table(["装備", "種類", "ティア", "効果"], grows),
        "{{ENEMY_LIST}}": _table(["敵", "勢力", "役割", "体力", "武器"], erows),
        "{{STRUCT_LIST}}": _table(["構造物", "勢力", "内容", "宝箱"], srows),
        "{{KS_LIST}}": _table(["キルストリーク", "PvP のキル数", "PvE のポイント", "効果"], krows),
        "{{MODE_LIST}}": _table(["モード", "ルール", "形式", "最少人数", "目標", "制限時間"], mdrows),
        "{{LOADOUT_LIST}}": _table(["装備セット", "主武器", "副武器", "近接", "装備"], lrows),
        "{{WORLD_SETTINGS}}": _table(["キー", "既定値", "内容"], wsrows),
        "{{PLAYER_SETTINGS}}": _table(["キー", "既定値", "内容"], psrows),
    }
    for k, v in rep.items():
        tpl = tpl.replace(k, v)
    return tpl
