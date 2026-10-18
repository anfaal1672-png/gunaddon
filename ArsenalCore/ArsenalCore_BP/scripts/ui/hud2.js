// @ts-check
/**
 * HUD 2.0：JSON UI（RP の ui/hud_screen.json）へのデータ受け渡し
 *
 * タイトルの文字列 = "AC2" + 1 文字ごとの札（".a12" ＝ 弾数の 1 桁目が 2）の並び + "." + 目印 "§a§r§s§n" + "§" + スコープ表示の番号
 * サブタイトルの文字列 = "AC2L" + 照準の広がりの札 + "." + "~" + 方位 3 桁 + 目印（data/hud.js の live・liveRaw）
 *   ・フィールドのキーと長さは data/hud.js（HUD2）。JSON UI 側は札を含むかだけを見る（文字列の * 演算は使わない）
 *   ・目印を含むので、バニラのタイトル枠は表示されない（1.0.2 と同じ仕組み）
 *   ・送信は変化したときと、10 tick ごと（タイトルの表示時間より短い間隔）
 */
import { system } from "@minecraft/server";
import { DATA } from "../config/constants.js";
import { P } from "../core/settings.js";
import { plateInfo } from "../core/armor.js";
import { reserveRounds } from "../core/reload.js";
import { spreadNow } from "../core/recoil.js";
import { SCOPE_MARK, scopeCode } from "./hud.js";
import { getWind } from "../systems/projectiles.js";
import { W as WS } from "../core/settings.js";
import { safe } from "../util/log.js";

const H = DATA.HUD2;
const L = DATA.HUD2_LAYOUT;

/** ゲームモード・経済などの外部の値（登録されたもの） @type {((p:import("@minecraft/server").Player)=>Record<string,string|number>|null)[]} */
const providers = [];
/** @param {(p:import("@minecraft/server").Player)=>Record<string,string|number>|null} fn */
export function addHud2Provider(fn) {
  providers.push(fn);
}

/**
 * フィールドを固定長に整える（数値は右寄せ、文字は左寄せ・切り詰め）
 * @param {string} name @param {string|number} v
 */
function fit(name, v) {
  const n = L.fields[name].len;
  let s = typeof v === "number" ? String(Math.max(0, Math.floor(v))) : String(v);
  s = s.replace(/[^\x20-\x7e]/g, "?").split(H.sep).join(",").split(H.blank).join("-");
  if (s.length > n) s = typeof v === "number" ? "9".repeat(n) : s.slice(0, n);
  return typeof v === "number" ? s.padStart(n, " ") : s.padEnd(n, " ");
}

/**
 * 符号化（テストと build.py の往復テストでも使う）
 * @param {Record<string, string|number>} values
 */
export function encodeHud2(values) {
  let out = H.header;
  for (const f of H.fields) {
    const s = fit(f.name, values[f.name] ?? (f.len === 1 ? "0" : ""));
    for (let i = 0; i < s.length; i++) out += H.sep + f.key + i + (s[i] === " " ? H.blank : s[i]);
  }
  return out + H.sep;
}

/**
 * 毎 tick 変わる値（data/hud.js の live）をサブタイトル用に符号化する。札の形はタイトルと同じ
 * @param {Record<string, string|number>} values
 */
export function encodeLive(values) {
  let out = H.liveHeader;
  for (const name of H.live) {
    if (name === H.liveRaw) continue;
    const f = L.fields[name];
    const ok = H.liveChars[name];
    const s = fit(name, values[name] ?? (f.len === 1 ? "0" : ""));
    // JSON UI は札を引き算で取り除くので、決まった文字だけを送る（ほかの文字は先頭の文字に置き換える）
    for (let i = 0; i < s.length; i++) out += H.sep + f.key + i + (ok.includes(s[i]) ? s[i] : ok[0]);
  }
  // 方位は札にせず、印 + そのままの数（0〜179、0 埋めなし。JSON UI が画像のテクスチャ名に使う）
  const raw = String(values[H.liveRaw] ?? "---");
  return out + H.sep + H.rawMark + (/^\d{1,3}$/.test(raw) ? raw : "---");
}

/**
 * サブタイトルの方位（テスト用）
 * @param {string} live
 */
export function liveHeading(live) {
  const i = live.lastIndexOf(H.rawMark);
  return i < 0 ? null : (/^(?:\d+|---)/.exec(live.slice(i + 1))?.[0] ?? null);
}

/**
 * 復号（テスト用）
 * @param {string} s
 */
export function decodeHud2(s) {
  if (!s.startsWith(H.header + H.sep)) return null;
  /** @type {Record<string, string[]>} */
  const chars = {};
  const byKey = new Map(H.fields.map((/** @type {any} */ f) => [f.key, f.name]));
  for (const tok of s.slice(H.header.length).split(H.sep)) {
    if (tok.length !== 3) continue;
    const name = byKey.get(tok[0]);
    if (!name) continue;
    (chars[name] ??= [])[Number(tok[1])] = tok[2] === H.blank ? " " : tok[2];
  }
  /** @type {Record<string, string>} */
  const out = {};
  for (const [name, f] of Object.entries(L.fields)) out[name] = Array.from({ length: f.len }, (_, i) => chars[name]?.[i] ?? "").join("");
  return out;
}

/** @param {string} mode */
function modeChar(mode) {
  if (mode === "auto") return "A";
  if (mode.startsWith("burst")) return "B";
  if (mode === "charge") return "C";
  if (mode === "double") return "D";
  if (mode === "ub") return "U";
  return "S";
}

/**
 * HUD 2.0 の値を集める
 * @param {import("@minecraft/server").Player} player @param {import("../core/state.js").PlayerState} s
 */
export function hud2Values(player, s) {
  const now = system.currentTick;
  const prefs = P(player);
  const st = s.stats;
  /** @type {Record<string, string|number>} */
  const v = {};
  v.hit = s.hit && now - s.hit.tick <= 10 && prefs.hitmarkers ? (s.hit.kind === "kill" ? "3" : s.hit.kind === "head" ? "2" : "1") : "0";
  v.dir = s.dmgDir && now - s.dmgDir.tick <= 30 && prefs.damageDir ? String(s.dmgDir.dir + 1) : "0";
  if (st && s.weaponId) {
    if (st.ammoFamily === "none") {
      v.ammo = "---";
      v.res = "";
    } else {
      v.ammo = s.ammo;
      const r = reserveRounds(player, st, s.ammoType);
      v.res = r === Infinity ? "INF" : r;
    }
    v.mode = modeChar(s.mode);
    let stc = "0";
    let heat = 0;
    if (s.reload) {
      stc = "R";
      const r = s.reload;
      heat = r.type === "mag" ? (now - r.start) / Math.max(1, r.end - r.start) : s.ammo / st.mag;
    } else if (s.jammed) stc = "J";
    else if (st.heat && s.overheatUntil > now) {
      stc = "H";
      heat = 1;
    } else if (st.lockTicks > 0 && s.ads && s.lockTicks > 0) stc = s.lockTicks >= st.lockTicks ? "K" : "L";
    else if (s.breathUntil > now && s.ads) stc = "B";
    else if (s.ammo === 0 && st.ammoFamily !== "none") stc = "E";
    if (st.heat && stc === "0" && s.heat > 0) {
      stc = "0";
      heat = s.heat / 100;
    }
    if (s.mode === "charge" && s.charge > 0) heat = s.charge / Math.max(1, st.charge);
    v.st = stc;
    v.heat = String(Math.max(0, Math.min(9, Math.floor(heat * 9.99))));
  } else {
    v.ammo = "---";
    v.res = "";
    v.mode = s.meleeId ? "M" : "-";
    v.st = "0";
    v.heat = "0";
  }
  const pl = plateInfo(player);
  v.plate = pl.plates < 0 ? "-" : String(Math.min(4, pl.plates));
  v.hp = Math.ceil(safe("hud2.hp", () => player.getComponent("minecraft:health")?.currentValue) ?? 20);
  v.sup = prefs.suppressionFx ? String(Math.min(3, Math.ceil(s.sup))) : "0";
  v.nvg = s.nvgActive ? "1" : "0";
  v.gm = "0";
  v.sa = "";
  v.sb = "";
  v.tm = "";
  v.stk = s.streak;
  v.cr = 0;
  v.ks = "0";
  v.rng = s.rangeDist >= 0 && s.ads ? s.rangeDist : "----";
  v.wdir = "-";
  v.wstr = "-";
  // 風：狙撃・マークスマンで覗いているときだけ（向き＝視線に対する 8 方向、強さ 0〜3）
  if (st && s.ads && (st.cat === "sniper" || st.cat === "dmr") && WS().wind) {
    const w = getWind();
    const m = Math.hypot(w.x, w.z);
    if (m > 0.0002) {
      const view = player.getViewDirection();
      const ang = Math.atan2(w.x * view.z - w.z * view.x, w.x * view.x + w.z * view.z);
      const dir8 = ((Math.round(-ang / (Math.PI / 4)) % 8) + 8) % 8;
      v.wdir = String(dir8);
      v.wstr = String(Math.min(3, Math.max(1, Math.round((m / 0.0035) * 3))));
    }
  }
  for (const fn of providers) {
    const extra = safe("hud2.provider", () => fn(player));
    if (extra) Object.assign(v, extra);
  }
  v.sz = prefs.hudScale === "small" ? "0" : prefs.hudScale === "large" ? "2" : "1";
  v.lay = layoutCode(player, prefs.hudLayout);
  // 毎 tick 変わる値はサブタイトルで送るので、タイトルでは固定（向きを変えてもタイトルが変わらない）
  for (const name of H.live) v[name] = "-".repeat(L.fields[name].len);
  return v;
}

/**
 * 毎 tick 変わる値（クロスヘアの広がり・方位）。サブタイトルで送る
 * @param {import("@minecraft/server").Player} player @param {import("../core/state.js").PlayerState} s
 */
function liveValues(player, s) {
  /** @type {Record<string, string>} */
  const v = {};
  const st = s.stats;
  const code = scopeCode(s);
  if (st && s.weaponId && !(code && code !== "5" && code !== "6")) {
    const sp = spreadNow(player, s, st);
    v.xh = String(Math.max(0, Math.min(9, Math.round(sp * 1.4))));
  } else if (s.meleeId) v.xh = "0";
  else v.xh = "x";
  // 方位：2° ごと（0 = 南、0〜179）。方位バーの画像も 2° ごとにある。
  // 0 埋めしない：実機の JSON UI は引き算の結果 '090' を数の 90 にしてから画像名につなぐ（compass_90）
  const yaw = ((player.getRotation().y % 360) + 360) % 360;
  v.hdg = P(player).compass ? String(Math.round(yaw / 2) % 180) : "---";
  return v;
}

/**
 * @param {import("@minecraft/server").Player} player @param {string} layout
 */
function layoutCode(player, layout) {
  if (layout === "standard") return "0";
  if (layout === "raised") return "1";
  if (layout === "left") return "2";
  // 自動：スマホは操作ボタンを避けて高め
  const mobile = safe("platform", () => /** @type {any} */ (player).clientSystemInfo?.platformType === "Mobile") ?? false;
  return mobile ? "1" : "0";
}

/** HUD 2.0 を使っているか @param {import("@minecraft/server").Player} player */
export function usesHud2(player) {
  return P(player).hudStyle === "hud2";
}

/**
 * 大きな知らせ（ボスの予兆・ダウン・ウェーブ開始など）
 *   HUD 2.0 はタイトルをデータの受け渡しに使っているので、アクションバーに出す（HUD 2.0 ではアクションバーが空いている）。
 *   従来の HUD はサブタイトルに出す。
 * @param {import("@minecraft/server").Player} player @param {import("@minecraft/server").RawMessage|string} msg @param {number} [stay]
 */
export function announce(player, msg, stay = 40) {
  if (usesHud2(player)) {
    safe("announce.bar", () => player.onScreenDisplay.setActionBar(msg));
  } else {
    safe("announce.title", () => player.onScreenDisplay.setTitle("§r", { subtitle: msg, fadeInDuration: 2, stayDuration: stay, fadeOutDuration: 8 }));
  }
}

/**
 * 送信
 * @param {import("@minecraft/server").Player} player @param {import("../core/state.js").PlayerState} s @param {boolean} force
 */
export function renderHud2(player, s, force) {
  const now = system.currentTick;
  // 方位と照準は毎 tick 見て、サブタイトルで送る（向きを変えたら次の tick で方位バーが動く）。
  // ほかの値は変化時と再送時だけ集め直してタイトルで送る。向きを変えただけではタイトルは変わらない
  const live = encodeLive(liveValues(player, s)) + SCOPE_MARK;
  const full = force || s.hudDirty || !s.hud2Vals || now - s.hud2Tick >= H.resendTicks;
  if (!full) return sendLive(player, s, live);
  const v = hud2Values(player, s);
  s.hud2Vals = v;
  v.seq = "0";
  const code = scopeCode(s);
  const key = encodeHud2(v) + SCOPE_MARK + "§" + (code || "0");
  if (key === s.hud2Last && now - s.hud2Tick < H.resendTicks && !force) return sendLive(player, s, live);
  s.hud2Tick = now;
  s.hud2Last = key;
  s.hudDirty = false;
  s.lastMark = code ? SCOPE_MARK + "§" + code : "";
  // 送るたびに番号を変える：同じ内容の再送でも文字列が変わり、JSON UI が表示条件を評価し直す
  // （表示条件のあるパネルが現れた直後に、子の数字が古い状態のまま残るのを防ぐ）
  s.hud2Seq = (s.hud2Seq + 1) % 10;
  const seqTok = `${H.sep}${L.fields.seq.key}0`;
  const text = key.replace(seqTok + "0" + H.sep, seqTok + s.hud2Seq + H.sep);
  s.hud2Live = live;
  safe("hud2.send", () => player.onScreenDisplay.setTitle(text, { subtitle: live, fadeInDuration: 0, stayDuration: H.stayTicks, fadeOutDuration: 0 }));
}

/**
 * 毎 tick 変わる値だけが変わった：サブタイトルだけを差し替える（タイトルの表示時間はそのまま）
 * @param {import("@minecraft/server").Player} player @param {import("../core/state.js").PlayerState} s @param {string} live
 */
function sendLive(player, s, live) {
  if (live === s.hud2Live) return;
  s.hud2Live = live;
  safe("hud2.live", () => player.onScreenDisplay.updateSubtitle(live));
}
