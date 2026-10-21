// @ts-check
/**
 * 野戦マニュアルの 2.0 の画面：図鑑（全カテゴリ）・操作ガイド（章立て）・戦績（階級・武器レベル・チャレンジ・統計）、
 * HUD と 2.0 の個人設定、2.0 のワールド設定、一人称の位置の調整モード（/scriptevent arsenal:calib）、診断レポート（/scriptevent arsenal:report）
 */
import { world, system } from "@minecraft/server";
import { ActionFormData, ModalFormData, MessageFormData } from "@minecraft/server-ui";
import { DATA, NS } from "../config/constants.js";
import { W as WS, P, setPrefs, setWorld, isOperator } from "../core/settings.js";
import { S, allStates } from "../core/state.js";
import { computeStats, W } from "../core/weaponState.js";
import { showForm, statBody } from "./menus.js";
import { weaponLevel, rankOf, rankTitle, rankGlyph, profile, challenges, applyNameTag } from "../progression/progression.js";
import { credits, fmtCr } from "../economy/economy.js";
import { aiStats } from "../systems/ai/brain.js";
import { deployableCount } from "../systems/deployables.js";
import { bossCount } from "../systems/bosses.js";
import { siteList } from "../systems/structures.js";
import { currentMatch } from "../modes/modes.js";
import { resetScopeMark, SCOPE_OFF } from "./hud.js";
import { playTo } from "../fx/effects.js";
import { t, raw, itemName, descOf } from "../util/i18n.js";

/** @typedef {import("@minecraft/server").Player} Player */
/** @typedef {import("@minecraft/server").RawMessage} RawMessage */

/** @param {number} n */
const f1 = (n) => (Math.round(n * 10) / 10).toString();
const pct = (/** @type {number} */ n) => `${Math.round(n * 100)}%`;

/** @param {(RawMessage|string)[]} lines @returns {RawMessage} */
function body(lines) {
  const rt = [];
  for (const l of lines) {
    rt.push(typeof l === "string" ? { text: l } : l);
    rt.push({ text: "\n" });
  }
  return { rawtext: rt };
}

/**
 * 詳細を見せて「戻る」を押したら back を呼ぶ
 * @param {Player} p @param {RawMessage|string} title @param {RawMessage} b @param {()=>any} back
 */
async function detail(p, title, b, back) {
  const m = new MessageFormData().title(title).body(b).button1(t("arsenal.ui.btn_back")).button2(t("arsenal.ui.btn_close"));
  const r = await showForm(p, m);
  if (r && !r.canceled && r.selection === 0) return back();
}

// ===========================================================================
//  図鑑
// ===========================================================================

const CODEX_CATS = ["weapons", "melee", "attachments", "armor", "gear", "enemies", "bosses", "killstreaks", "structures"];

/** @param {Player} p */
export async function openCodex2(p) {
  const f = new ActionFormData().title(t("arsenal.ui.btn_codex")).body(t("arsenal.codex.body", String(Object.keys(DATA.WEAPONS).length), String(Object.keys(DATA.ATTACHMENTS).length), String(Object.keys(DATA.ENEMIES).length)));
  const icons = {
    weapons: "textures/items/arsenal/weapons/sentinel", melee: "textures/items/arsenal/melee/combat_knife", attachments: "textures/items/arsenal/attachments/optic_holo",
    armor: "textures/items/arsenal/armor/helmet_standard_2", gear: "textures/items/arsenal/medical/medkit", enemies: "textures/ui/icon_recipe_nature",
    bosses: "textures/ui/icon_trailer", killstreaks: "textures/ui/arsenal/ks_airstrike", structures: "textures/ui/icon_map",
  };
  for (const c of CODEX_CATS) f.button({ translate: `arsenal.codex.cat.${c}` }, /** @type {any} */ (icons)[c]);
  const r = await showForm(p, f);
  if (!r || r.canceled || r.selection === undefined) return;
  const c = CODEX_CATS[r.selection];
  return codexList(p, c);
}

/**
 * @param {Player} p @param {string} c
 */
async function codexList(p, c) {
  /** @type {{name:RawMessage, icon?:string, show:()=>any}[]} */
  const rows = [];
  const back = () => codexList(p, c);
  switch (c) {
    case "weapons": {
      const cats = Object.entries(DATA.CATEGORIES).filter(([k]) => k !== "melee").sort((a, b) => /** @type {any} */ (a[1]).order - /** @type {any} */ (b[1]).order);
      for (const [cid] of cats) {
        const ids = Object.keys(DATA.WEAPONS).filter((w) => W(w).cat === cid);
        rows.push({ name: raw({ translate: `arsenal.cat.${cid}` }, ` §8(${ids.length})`), icon: `textures/items/arsenal/weapons/${ids[0]}`, show: () => weaponCat(p, cid) });
      }
      break;
    }
    case "melee":
      for (const [id, m] of Object.entries(DATA.MELEE)) {
        const mm = /** @type {any} */ (m);
        rows.push({
          name: raw(DATA.TIERS[mm.tier].color, itemName(id)), icon: `textures/items/arsenal/melee/${id}`,
          show: () => detail(p, itemName(id), body([raw("§7", descOf(id)), "", t("arsenal.codex.melee_stats", f1(mm.dmg), `x${f1(mm.backstab)}`, pct(mm.move ?? 1)), raw(t("arsenal.codex.lv"), ` ${weaponLevel(p, id)}`)]), back),
        });
      }
      break;
    case "attachments":
      for (const [id, a] of Object.entries(DATA.ATTACHMENTS)) {
        const aa = /** @type {any} */ (a);
        rows.push({ name: raw(DATA.TIERS[aa.tier].color, itemName(id), "\n§8", { translate: `arsenal.slot.${aa.slot}` }), icon: `textures/items/arsenal/attachments/${id}`, show: () => detail(p, itemName(id), body([raw("§7", descOf(id)), "", raw({ translate: `arsenal.tier.${aa.tier}` }, " §7| ", { translate: `arsenal.slot.${aa.slot}` })]), back) });
      }
      break;
    case "armor":
      for (const [id, a] of Object.entries(DATA.ARMOR)) {
        const aa = /** @type {any} */ (a);
        const lines = [raw({ translate: `arsenal.tier.${aa.tier}` }), t("arsenal.codex.armor_prot", String(aa.protection))];
        if (aa.slot === "head") lines.push(t("arsenal.codex.armor_head", pct(aa.headProt)));
        if (aa.plates) lines.push(t("arsenal.codex.armor_plates", String(aa.plates), String(DATA.PLATE_HP)));
        if (aa.move !== 1) lines.push(t("arsenal.codex.armor_move", pct(aa.move)));
        if (aa.special) lines.push(raw("§b", t(`arsenal.codex.special.${aa.special}`)));
        rows.push({ name: raw(DATA.TIERS[aa.tier].color, itemName(id)), icon: `textures/items/arsenal/armor/${id}`, show: () => detail(p, itemName(id), body(lines), back) });
      }
      break;
    case "gear":
      for (const [tbl, dir] of /** @type {[any, string][]} */ ([[DATA.THROWABLES, "throwables"], [DATA.MEDICAL, "medical"], [DATA.DEPLOYABLES, "gear"], [DATA.VEHICLES, "gear"]])) {
        for (const [id, g] of Object.entries(tbl)) {
          const gg = /** @type {any} */ (g);
          rows.push({ name: raw(DATA.TIERS[gg.tier ?? "common"].color, itemName(id)), icon: `textures/items/arsenal/${dir}/${id}`, show: () => detail(p, itemName(id), body([raw("§7", descOf(id))]), back) });
        }
      }
      break;
    case "enemies":
      for (const [id, e] of Object.entries(DATA.ENEMIES)) {
        const ee = /** @type {any} */ (e);
        const lines = [
          raw({ translate: `arsenal.faction.${ee.faction}` }, " §7| ", { translate: `arsenal.role.${ee.role}` }),
          t("arsenal.codex.enemy_hp", String(ee.health), pct(ee.armorValue ?? 0)),
          ee.weapon ? raw(t("arsenal.codex.enemy_weapon"), " ", itemName(ee.weapon)) : t("arsenal.codex.enemy_melee"),
          t("arsenal.codex.enemy_range", String(ee.range), String(ee.sight ?? ee.range)),
          raw("§7", t(`arsenal.role_desc.${ee.role}`)),
        ];
        rows.push({ name: raw({ translate: `entity.${NS}:${id}.name` }, "\n§8", { translate: `arsenal.faction.${ee.faction}` }), show: () => detail(p, { translate: `entity.${NS}:${id}.name` }, body(lines), back) });
      }
      break;
    case "bosses":
      for (const [id, b] of Object.entries(DATA.BOSSES)) {
        const bb = /** @type {any} */ (b);
        const lines = [
          raw({ translate: `arsenal.faction.${bb.faction}` }),
          t("arsenal.codex.enemy_hp", String(bb.health), pct(bb.armorValue)),
          t("arsenal.codex.boss_phases", String(bb.phases.length)),
          raw("§7", t(`arsenal.boss.desc.${id}`)),
          t("arsenal.codex.boss_summon", itemName(bb.summon)),
          t("arsenal.codex.boss_reward", fmtCr(bb.reward.credits), String(bb.reward.xp)),
        ];
        if (bb.parts) lines.push(raw("§e", t("arsenal.codex.boss_parts"), " ", ...Object.keys(bb.parts).flatMap((k, i) => (i ? [" / ", { translate: `arsenal.boss.part.${k}` }] : [{ translate: `arsenal.boss.part.${k}` }]))));
        rows.push({ name: raw("§4", { translate: `entity.${NS}:${id}.name` }), show: () => detail(p, { translate: `entity.${NS}:${id}.name` }, body(lines), back) });
      }
      break;
    case "killstreaks":
      for (const [id, k] of Object.entries(DATA.KILLSTREAKS)) {
        const kk = /** @type {any} */ (k);
        rows.push({ name: raw({ translate: `arsenal.ks.${id}` }, "\n§8", t("arsenal.ks.cost", String(kk.kills), String(kk.points))), icon: `textures/ui/arsenal/ks_${id}`, show: () => detail(p, { translate: `arsenal.ks.${id}` }, body([raw("§7", { translate: `arsenal.ks.${id}.desc` }), "", t("arsenal.ks.cost", String(kk.kills), String(kk.points))]), back) });
      }
      break;
    case "structures":
      for (const [id, s] of Object.entries(DATA.STRUCTURES)) {
        const ss = /** @type {any} */ (s);
        const chests = ss.chests.map((/** @type {any} */ c) => `${c.count}× ${c.tier}`).join(", ");
        rows.push({ name: raw({ translate: `arsenal.structure.${id}` }, "\n§8", { translate: `arsenal.faction.${ss.faction}` }), show: () => detail(p, { translate: `arsenal.structure.${id}` }, body([raw("§7", { translate: `arsenal.structure_desc.${id}` }), "", t("arsenal.codex.struct_chests", chests), t("arsenal.codex.struct_garrison", String(ss.garrison.reduce((/** @type {number} */ a, /** @type {any} */ g) => a + g.count, 0)))]), back) });
      }
      break;
  }
  const f = new ActionFormData().title({ translate: `arsenal.codex.cat.${c}` });
  for (const r0 of rows) f.button(r0.name, r0.icon);
  f.button(t("arsenal.ui.btn_back"));
  const r = await showForm(p, f);
  if (!r || r.canceled || r.selection === undefined) return;
  if (r.selection >= rows.length) return openCodex2(p);
  return rows[r.selection].show();
}

/** @param {Player} p @param {string} cid */
async function weaponCat(p, cid) {
  const ids = Object.keys(DATA.WEAPONS).filter((w) => W(w).cat === cid);
  const f = new ActionFormData().title({ translate: `arsenal.cat.${cid}` });
  for (const id of ids) {
    const tier = DATA.TIERS[W(id).tier];
    f.button(raw(tier.color, itemName(id), "\n§8", { translate: `arsenal.tier.${W(id).tier}` }, ` §7Lv${weaponLevel(p, id)}`), `textures/items/arsenal/weapons/${id}`);
  }
  f.button(t("arsenal.ui.btn_back"));
  const r = await showForm(p, f);
  if (!r || r.canceled || r.selection === undefined) return;
  if (r.selection >= ids.length) return codexList(p, "weapons");
  const id = ids[r.selection];
  const st = computeStats(id, {}, W(id).defaultVariant ?? (/** @type {any} */ (DATA.AMMO_FAMILIES)[W(id).ammo]?.variants[0] ?? "std"));
  return detail(p, itemName(id), raw(statBody(id, st), t("arsenal.codex.lv"), ` ${weaponLevel(p, id)}`), () => weaponCat(p, cid));
}

// ===========================================================================
//  操作ガイド（章）
// ===========================================================================

export const GUIDE_CHAPTERS = { basics: 8, combat: 8, gear: 8, enemies: 7, world: 7, progress: 7, modes: 7, mobile: 7, trouble: 7 };

/** @param {Player} p */
export async function openGuide2(p) {
  const ids = Object.keys(GUIDE_CHAPTERS);
  const f = new ActionFormData().title(t("arsenal.ui.btn_guide"));
  for (const c of ids) f.button({ translate: `arsenal.guide.${c}` });
  const r = await showForm(p, f);
  if (!r || r.canceled || r.selection === undefined) return;
  const c = ids[r.selection];
  /** @type {RawMessage[]} */
  const lines = [];
  for (let i = 1; i <= /** @type {any} */ (GUIDE_CHAPTERS)[c]; i++) lines.push({ translate: `arsenal.guide.${c}.${i}` }, { text: "\n" });
  return detail(p, { translate: `arsenal.guide.${c}` }, { rawtext: lines }, () => openGuide2(p));
}

// ===========================================================================
//  戦績
// ===========================================================================

/** @param {Player} p */
export async function openProgress(p) {
  const prof = profile(p);
  const r = rankOf(p);
  const title = rankTitle(r);
  const next = DATA.RANK_XP_TABLE[Math.min(DATA.RANK_MAX, r + 1)];
  const lines = [
    raw("§6", rankGlyph(r), " ", t("arsenal.prog.rank", String(r)), " §f", { translate: `arsenal.rank.${DATA.RANK_TITLES.indexOf(title)}` }),
    t("arsenal.prog.xp", String(prof.rankXp), r >= DATA.RANK_MAX ? "MAX" : String(next)),
    raw(t("arsenal.shop.balance"), " §e", fmtCr(credits(p))),
    "",
  ];
  const ch = challenges(p);
  lines.push(raw("§l", t("arsenal.prog.daily")));
  for (const c of ch.daily) lines.push(raw(c.done ? "§a✔ " : "§7• ", t(`arsenal.ch.${c.id}`, String(c.n)), ` §8${c.prog}/${c.n}`));
  lines.push(raw("§l", t("arsenal.prog.weekly")));
  for (const c of ch.weekly) lines.push(raw(c.done ? "§a✔ " : "§7• ", t(`arsenal.ch.${c.id}`, String(c.n)), ` §8${c.prog}/${c.n}`));
  lines.push("", raw("§l", t("arsenal.prog.stats")));
  const st = prof.stats;
  const acc = st.shots > 0 ? Math.round((st.hits / st.shots) * 100) : 0;
  const kd = st.deaths > 0 ? f1(st.kills / st.deaths) : String(st.kills);
  lines.push(t("arsenal.prog.stat_line1", String(st.kills), String(st.deaths), kd, String(st.headKills)));
  lines.push(t("arsenal.prog.stat_line2", `${acc}%`, String(st.longest), String(st.meleeKills), String(st.explosiveKills)));
  lines.push(t("arsenal.prog.stat_line3", String(st.structuresCleared), String(st.wavesSurvived), String(st.matchWins), String(st.bossKills)));
  lines.push(t("arsenal.prog.stat_line4", String(st.missions ?? 0), `${Math.min(DATA.CAMPAIGN.length, Number(/** @type {any} */ (prof).cp) || 0)}/${DATA.CAMPAIGN.length}`));
  // 武器レベル上位
  const top = Object.entries(prof.wxp).sort((a, b) => b[1] - a[1]).slice(0, 6);
  if (top.length) {
    lines.push("", raw("§l", t("arsenal.prog.top_weapons")));
    for (const [id] of top) lines.push(raw(itemName(id), ` §7Lv${weaponLevel(p, id)}`));
  }
  const m = new MessageFormData().title(t("arsenal.prog.title")).body(body(lines)).button1(t("arsenal.ui.btn_close")).button2(t("arsenal.ui.btn_close"));
  await showForm(p, m);
}

// ===========================================================================
//  HUD と 2.0 の個人設定
// ===========================================================================

/** @param {Player} player */
export async function openPrefs2(player) {
  const p = P(player);
  const styles = ["hud2", "classic"];
  const scales = ["small", "normal", "large"];
  const layouts = ["auto", "standard", "raised", "left"];
  const assist = ["off", "light", "strong"];
  const form = new ModalFormData()
    .title(t("arsenal.ui.btn_prefs2"))
    .dropdown(t("arsenal.pref.hud_style"), styles.map((m) => t(`arsenal.pref.hud_style_${m}`)), { defaultValueIndex: Math.max(0, styles.indexOf(p.hudStyle)) })
    .dropdown(t("arsenal.pref.hud_scale"), scales.map((m) => t(`arsenal.pref.hud_scale_${m}`)), { defaultValueIndex: Math.max(0, scales.indexOf(p.hudScale)) })
    .dropdown(t("arsenal.pref.hud_layout"), layouts.map((m) => t(`arsenal.pref.hud_layout_${m}`)), { defaultValueIndex: Math.max(0, layouts.indexOf(p.hudLayout)) })
    .toggle(t("arsenal.pref.compass"), { defaultValue: p.compass })
    .toggle(t("arsenal.pref.damage_dir"), { defaultValue: p.damageDir })
    .toggle(t("arsenal.pref.suppression_fx"), { defaultValue: p.suppressionFx })
    .dropdown(t("arsenal.pref.aim_assist"), assist.map((m) => t(`arsenal.pref.aim_assist_${m}`)), { defaultValueIndex: Math.max(0, assist.indexOf(p.aimAssist)) })
    .toggle(t("arsenal.pref.auto_fire"), { defaultValue: p.autoFire })
    .slider(t("arsenal.pref.fp_v"), -2, 2, { valueStep: 1, defaultValue: p.fpOffsetV | 0 })
    .slider(t("arsenal.pref.fp_d"), -2, 2, { valueStep: 1, defaultValue: p.fpOffsetD | 0 })
    .toggle(t("arsenal.pref.show_rank"), { defaultValue: p.showRank })
    .toggle(t("arsenal.pref.nvg_auto"), { defaultValue: p.nvgAuto })
    .submitButton(t("arsenal.ui.btn_save"));
  const r = await showForm(player, form);
  if (!r || r.canceled || !r.formValues) return;
  const v = r.formValues;
  setPrefs(player, {
    hudStyle: styles[/** @type {number} */ (v[0])],
    hudScale: scales[/** @type {number} */ (v[1])],
    hudLayout: layouts[/** @type {number} */ (v[2])],
    compass: !!v[3],
    damageDir: !!v[4],
    suppressionFx: !!v[5],
    aimAssist: assist[/** @type {number} */ (v[6])],
    autoFire: !!v[7],
    fpOffsetV: /** @type {number} */ (v[8]) | 0,
    fpOffsetD: /** @type {number} */ (v[9]) | 0,
    showRank: !!v[10],
    nvgAuto: !!v[11],
  });
  const s = S(player);
  s.hudDirty = true;
  s.hud2Last = "";
  s.hud2Live = "";
  s.fpoffAnim = "?";
  resetScopeMark(player, s);
  // 残っている HUD 2.0 の文字列を消す（従来型に切り替えたとき）
  player.onScreenDisplay.setTitle(SCOPE_OFF, { fadeInDuration: 0, stayDuration: 1, fadeOutDuration: 0 });
  applyNameTag(player);
  player.sendMessage(t("arsenal.ui.saved"));
}

// ===========================================================================
//  2.0 のワールド設定（OP）
// ===========================================================================

/** @param {Player} player */
export async function openWorld2(player) {
  if (!isOperator(player)) {
    player.sendMessage(t("arsenal.ui.op_only"));
    return;
  }
  const w = WS();
  const dens = Object.keys(DATA.STRUCTURE_DENSITY);
  const diffs = Object.keys(DATA.AI_DIFFICULTY);
  const form = new ModalFormData()
    .title(t("arsenal.ui.btn_world2"))
    .toggle(t("arsenal.ws.legion"), { defaultValue: w.legion })
    .toggle(t("arsenal.ws.hollow"), { defaultValue: w.hollow })
    .dropdown(t("arsenal.ws.structures"), dens.map((d) => ({ translate: `arsenal.density.${d}` })), { defaultValueIndex: Math.max(0, dens.indexOf(w.structures)) })
    .dropdown(t("arsenal.ws.ai_difficulty"), diffs.map((d) => ({ translate: `arsenal.difficulty.${d}` })), { defaultValueIndex: Math.max(0, diffs.indexOf(w.aiDifficulty)) })
    .toggle(t("arsenal.ws.economy"), { defaultValue: w.economy })
    .toggle(t("arsenal.ws.progression_locks"), { defaultValue: w.progressionLocks })
    .toggle(t("arsenal.ws.killstreaks"), { defaultValue: w.killstreaks })
    .toggle(t("arsenal.ws.downed"), { defaultValue: w.downed })
    .toggle(t("arsenal.ws.bleeding"), { defaultValue: w.bleeding })
    .slider(t("arsenal.ws.backstab_pvp"), 10, 50, { valueStep: 5, defaultValue: Math.round(w.backstabPvp * 10) })
    .toggle(t("arsenal.ws.aim_assist_pvp"), { defaultValue: w.aimAssistPvp })
    .toggle(t("arsenal.ws.wind"), { defaultValue: w.wind })
    .toggle(t("arsenal.ws.suppression"), { defaultValue: w.suppression })
    .toggle(t("arsenal.ws.bosses"), { defaultValue: w.bosses })
    .toggle(t("arsenal.ws.bullet_travel"), { defaultValue: w.bulletTravel !== false })
    .toggle(t("arsenal.ws.mag_realism"), { defaultValue: w.magRealism !== false })
    .toggle(t("arsenal.ws.limb_damage"), { defaultValue: w.limbDamage !== false })
    .toggle(t("arsenal.ws.nukes"), { defaultValue: w.nukes !== false })
    .submitButton(t("arsenal.ui.btn_save"));
  const r = await showForm(player, form);
  if (!r || r.canceled || !r.formValues) return;
  const v = r.formValues;
  setWorld({
    legion: !!v[0],
    hollow: !!v[1],
    structures: dens[/** @type {number} */ (v[2])],
    aiDifficulty: diffs[/** @type {number} */ (v[3])],
    economy: !!v[4],
    progressionLocks: !!v[5],
    killstreaks: !!v[6],
    downed: !!v[7],
    bleeding: !!v[8],
    backstabPvp: /** @type {number} */ (v[9]) / 10,
    aimAssistPvp: !!v[10],
    wind: !!v[11],
    suppression: !!v[12],
    bosses: !!v[13],
    bulletTravel: !!v[14],
    magRealism: !!v[15],
    limbDamage: !!v[16],
    nukes: !!v[17],
  });
  world.sendMessage(raw("§e[ARSENAL] ", t("arsenal.ui.world_saved", player.name)));
}

// ===========================================================================
//  一人称の位置の調整モード
// ===========================================================================

/**
 * 開始・終了（/scriptevent arsenal:calib）
 * @param {Player} p
 */
export function toggleCalib(p) {
  const s = S(p);
  if (s.calib) {
    s.calib = 0;
    s.fpoffAnim = "?";
    p.sendMessage(t("arsenal.calib.cancel"));
    return;
  }
  const pr = P(p);
  s.calib = (Math.max(-2, Math.min(2, pr.fpOffsetV | 0)) + 2) * 5 + (Math.max(-2, Math.min(2, pr.fpOffsetD | 0)) + 2) + 1;
  s.fpoffAnim = "?";
  p.sendMessage(t("arsenal.calib.start"));
  calibHud(p, s);
}

/**
 * ジャンプで次の位置
 * @param {Player} p @param {import("../core/state.js").PlayerState} s
 */
export function calibNext(p, s) {
  s.calib = (s.calib % 25) + 1;
  s.fpoffAnim = "?";
  playTo(p, "arsenal.mech.mode_switch", { volume: 0.6 });
  calibHud(p, s);
}

/**
 * スニーク 2 回で保存
 * @param {Player} p @param {import("../core/state.js").PlayerState} s
 */
export function calibSave(p, s) {
  const v = Math.floor((s.calib - 1) / 5) - 2;
  const d = ((s.calib - 1) % 5) - 2;
  s.calib = 0;
  setPrefs(p, { fpOffsetV: v, fpOffsetD: d });
  s.fpoffAnim = "?";
  playTo(p, "arsenal.ui.challenge", { volume: 0.7 });
  p.sendMessage(t("arsenal.calib.saved", String(v), String(d)));
}

/** @param {Player} p @param {import("../core/state.js").PlayerState} s */
export function calibHud(p, s) {
  if (!s.calib) return;
  const v = Math.floor((s.calib - 1) / 5) - 2;
  const d = ((s.calib - 1) % 5) - 2;
  p.onScreenDisplay.setActionBar(t("arsenal.calib.hud", String(v), String(d)));
}

// ===========================================================================
//  診断レポート（/scriptevent arsenal:report）
// ===========================================================================

/** 報告の本文（テストでも使う） */
export function reportLines() {
  const a = aiStats();
  const m = currentMatch();
  const w = WS();
  const sites = siteList();
  return [
    `ARSENAL CORE ${DATA.ADDON_VERSION.join(".")} / @minecraft/server ${DATA.SCRIPT_MODULES.server}`,
    `tick ${system.currentTick}  players ${world.getAllPlayers().length}  states ${allStates().size}`,
    `AI registered ${a.registered}  thinks ${a.thinks}  shots ${a.shots}  maxThink/tick ${a.maxThinkPerTick}  skipped ${a.skipped}`,
    `bosses ${bossCount()}  deployables ${deployableCount()}  sites ${sites.length} (cleared ${sites.filter((s) => s.cleared).length})`,
    `match ${m ? `${m.mode}/${m.phase} players ${m.parts.size}` : "-"}`,
    `world: diff ${w.aiDifficulty} structures ${w.structures} economy ${w.economy} streaks ${w.killstreaks} downed ${w.downed} legion ${w.legion} hollow ${w.hollow} raiders ${w.raiders}`,
  ];
}

/** @param {Player} p */
export async function openReport(p) {
  const lines = reportLines();
  for (const l of lines) console.info(`[ARSENAL report] ${l}`);
  const s = S(p);
  lines.push(`you: weapon ${s.weaponId ?? "-"} look ${s.look} hud ${P(p).hudStyle} calib ${s.calib} riding ${s.ridingId ?? "-"} rank ${rankOf(p)}`);
  const m = new MessageFormData().title("ARSENAL report").body(lines.join("\n")).button1(t("arsenal.ui.btn_close")).button2(t("arsenal.ui.btn_close"));
  await showForm(p, m);
}
