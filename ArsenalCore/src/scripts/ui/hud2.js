// @ts-check
/**
 * HUD 2.0：JSON UI（RP の ui/hud_screen.json）へのデータ受け渡し
 *
 * タイトルの文字列 = "AC2|" + 固定長の ASCII フィールド + 目印 "§a§r§s§n" + "§" + スコープ表示の番号
 *   ・フィールドの並びと長さは data/hud.js（HUD2）。JSON UI 側は ('%.Ns' * #t) の差で切り出す
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
  s = s.replace(/[^\x20-\x7e]/g, "?").replace(/\|/g, "!");
  if (s.length > n) s = typeof v === "number" ? "9".repeat(n) : s.slice(0, n);
  return typeof v === "number" ? s.padStart(n, " ") : s.padEnd(n, " ");
}

/**
 * 符号化（テストと build.py の往復テストでも使う）
 * @param {Record<string, string|number>} values
 */
export function encodeHud2(values) {
  let out = H.header;
  for (const f of H.fields) out += fit(f.name, values[f.name] ?? (f.len === 1 ? "0" : ""));
  return out;
}

/**
 * 復号（テスト用）
 * @param {string} s
 */
export function decodeHud2(s) {
  /** @type {Record<string, string>} */
  const out = {};
  if (!s.startsWith(H.header)) return null;
  for (const [name, f] of Object.entries(L.fields)) out[name] = s.slice(f.at, f.at + f.len);
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
  const code = scopeCode(s);
  if (st && s.weaponId && !(code && code !== "5" && code !== "6")) {
    const sp = spreadNow(player, s, st);
    v.xh = String(Math.max(0, Math.min(9, Math.round(sp * 1.4))));
  } else if (s.meleeId) v.xh = "0";
  else v.xh = "x";
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
  const yaw = ((player.getRotation().y % 360) + 360) % 360;
  v.hdg = prefs.compass ? String(Math.round(yaw / 22.5) % 16).padStart(2, "0") : "--";
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
  if (!force && !s.hudDirty && now - s.hud2Tick < H.resendTicks) return;
  const payload = encodeHud2(hud2Values(player, s));
  const code = scopeCode(s);
  const text = payload + SCOPE_MARK + "§" + (code || "0");
  if (text === s.hud2Last && now - s.hud2Tick < H.resendTicks && !force) return;
  s.hud2Tick = now;
  s.hud2Last = text;
  s.hudDirty = false;
  s.lastMark = code ? SCOPE_MARK + "§" + code : "";
  safe("hud2.send", () => player.onScreenDisplay.setTitle(text, { fadeInDuration: 0, stayDuration: H.stayTicks, fadeOutDuration: 0 }));
}
