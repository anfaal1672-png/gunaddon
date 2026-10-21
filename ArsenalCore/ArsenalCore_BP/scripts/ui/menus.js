// @ts-check
/**
 * フォーム UI：武器メニュー（アタッチメント・弾種・射撃モード・詳細）、野戦マニュアル（設定・図鑑・操作ガイド・チーム）、
 * 兵器作業台、弾薬製造機、弾薬箱
 */
import { system, world } from "@minecraft/server";
import { ActionFormData, ModalFormData, MessageFormData, FormCancelationReason } from "@minecraft/server-ui";
import { DATA, NS, ammoItemId, AMMO_ITEMS, weaponIdOf } from "../config/constants.js";
import { W as WS, P, setPrefs, setWorld, isOperator } from "../core/settings.js";
import { S } from "../core/state.js";
import { canAttach, computeStats, heldSlot, writeProps, writeLore, PROP, W, A } from "../core/weaponState.js";
import { countItem, consumeItem, giveItem, hasCost, payCost, isCreative } from "../core/inventory.js";
import { switchAmmoType, cancelReload, status, repackMags } from "../core/reload.js";
import { flushWear } from "../core/fireController.js";
import { resetScopeMark } from "./hud.js";
import { syncLook, CAMO_PROP } from "../core/migrate.js";
import { openCodex2, openGuide2, openProgress, openPrefs2, openWorld2 } from "./codex.js";
import { openModesMenu } from "../modes/modes.js";
import { weaponLevel, camoUnlocked, profile, rankOf } from "../progression/progression.js";
import { classOf, perksOf, setLoadout, loadoutBody } from "../progression/classes.js";
import { inMatch } from "../modes/modes.js";
import { hire, orderSquad, squadOf, squadBody } from "../systems/squad.js";
import { playTo } from "../fx/effects.js";
import { t, raw, itemName, descOf, anyItemName, onOff } from "../util/i18n.js";
import { safe, logError } from "../util/log.js";

/** @typedef {import("@minecraft/server").Player} Player */
/** @typedef {import("@minecraft/server").RawMessage} RawMessage */

const ICON = {
  weapon: (/** @type {string} */ id) => `textures/items/arsenal/weapons/${id}`,
  att: (/** @type {string} */ id) => `textures/items/arsenal/attachments/${id}`,
  ammo: (/** @type {string} */ id) => `textures/items/arsenal/ammo/${id}`,
  thr: (/** @type {string} */ id) => `textures/items/arsenal/throwables/${id}`,
  mat: (/** @type {string} */ id) => `textures/items/arsenal/materials/${id}`,
  tool: (/** @type {string} */ id) => `textures/items/arsenal/tools/${id}`,
};

/**
 * フォームを安全に表示（ほかの UI が開いていたら少し待って再試行）
 * @template {{canceled:boolean, cancelationReason?: any}} R
 * @param {Player} player @param {{show:(p:Player)=>Promise<R>}} form
 * @returns {Promise<R|undefined>}
 */
export async function showForm(player, form) {
  const s = S(player);
  for (let i = 0; i < 20; i++) {
    try {
      s.menuOpen = true;
      const r = await form.show(player);
      s.menuOpen = false;
      if (r.canceled && r.cancelationReason === FormCancelationReason.UserBusy) {
        await system.waitTicks(4);
        continue;
      }
      return r;
    } catch (e) {
      s.menuOpen = false;
      logError("form.show", e);
      return undefined;
    }
  }
  s.menuOpen = false;
  return undefined;
}

/** @param {number} n */
const f1 = (n) => (Math.round(n * 10) / 10).toString();

/**
 * 武器のステータス本文
 * @param {string} weaponId @param {any} st
 * @returns {RawMessage}
 */
export function statBody(weaponId, st) {
  const w = W(weaponId);
  const tier = /** @type {any} */ (DATA.TIERS)[w.tier];
  /** @type {(RawMessage|string)[]} */
  const lines = [
    raw(tier.color, { translate: `arsenal.tier.${w.tier}` }, " §7| ", { translate: `arsenal.cat.${w.cat}` }),
    raw("§7", descOf(weaponId)),
    "",
  ];
  const pellet = st.pellets > 1 ? ` x${st.pellets}` : "";
  lines.push(t("arsenal.ui.stat_damage", f1(st.dmg) + pellet, f1(st.head)));
  lines.push(t("arsenal.ui.stat_rpm", String(st.rpm)));
  lines.push(t("arsenal.ui.stat_mag", String(st.mag), { translate: `arsenal.ammo.${st.ammoFamily}` }));
  lines.push(t("arsenal.ui.stat_range", f1(st.range0), f1(st.range1)));
  lines.push(t("arsenal.ui.stat_spread", f1(st.hip), f1(st.ads)));
  lines.push(t("arsenal.ui.stat_recoil", f1(st.recoilV), f1(st.recoilH)));
  lines.push(t("arsenal.ui.stat_reload", f1(st.reloadTac / 20), f1(st.reloadEmpty / 20)));
  lines.push(t("arsenal.ui.stat_ads", f1(st.adsTime / 20), { translate: `arsenal.optic.${st.optic}` }));
  lines.push(t("arsenal.ui.stat_move", String(Math.round(st.move * 100))));
  lines.push(t("arsenal.ui.stat_pen", String(st.pen), String(Math.round(st.ap * 100))));
  const modes = st.modes.map((/** @type {string} */ m) => ({ translate: m.startsWith("burst") ? "arsenal.mode.burst" : `arsenal.mode.${m}` }));
  lines.push(raw(t("arsenal.ui.stat_modes"), ...modes.flatMap((/** @type {RawMessage} */ m, /** @type {number} */ i) => (i ? [" / ", m] : [m]))));
  const rawtext = [];
  for (const l of lines) {
    rawtext.push(typeof l === "string" ? { text: l } : l);
    rawtext.push({ text: "\n" });
  }
  return { rawtext };
}

/**
 * レシピ本文
 * @param {Player} player @param {Record<string, number>} cost @param {number} times
 */
function costBody(player, cost, times = 1) {
  const creative = isCreative(player);
  /** @type {RawMessage[]} */
  const rt = [];
  for (const [id, n] of Object.entries(cost)) {
    const have = countItem(player, id);
    const ok = creative || have >= n * times;
    rt.push({ text: ok ? "§a✔ §f" : "§c✘ §f" }, anyItemName(id), { text: ` §7x${n * times} (${have})\n` });
  }
  return { rawtext: rt };
}

// ===========================================================================
//  武器メニュー
// ===========================================================================

/** @param {Player} player */
export async function openWeaponMenu(player) {
  const s = S(player);
  if (!s.weaponId || !s.stats) return;
  flushWear(player, s);
  const wid = s.weaponId;
  const st = s.stats;
  const form = new ActionFormData()
    .title(raw("§l", itemName(wid)))
    .body(raw(t("arsenal.ui.menu_ammo_now", String(s.ammo), String(st.mag), { translate: `arsenal.variant.${s.ammoType}` }), "\n", t("arsenal.ui.menu_mode_now", { translate: s.mode.startsWith("burst") ? "arsenal.mode.burst" : `arsenal.mode.${s.mode}` })))
    .button(t("arsenal.ui.btn_attachments"), ICON.att("optic_4x"))
    .button(t("arsenal.ui.btn_ammo"), ICON.ammo(AMMO_ITEMS.find((a) => a.family === st.ammoFamily)?.id ?? "ammo_light"))
    .button(t("arsenal.ui.btn_mode"), "textures/ui/refresh")
    .button(t("arsenal.ui.btn_stats"), ICON.weapon(wid))
    .button(raw(t("arsenal.ui.btn_camo"), "\n§8Lv ", String(weaponLevel(player, wid))), "textures/ui/color_picker");
  const mortar = st.fire === "mortar";
  if (mortar) form.button(t("arsenal.ui.btn_mortar_target"), "textures/ui/icon_map");
  const partial = s.mags.reduce((a, n) => a + n, 0);
  if (partial > 0) form.button(t("arsenal.ui.btn_repack", String(partial)), ICON.ammo(AMMO_ITEMS.find((a) => a.family === st.ammoFamily)?.id ?? "ammo_light"));
  form.button(t("arsenal.ui.btn_close"));
  const r = await showForm(player, form);
  if (!r || r.canceled || r.selection === undefined) return;
  if (s.weaponId !== wid) return;
  const repackAt = mortar ? 6 : 5;
  if (partial > 0 && r.selection === repackAt) {
    const n = repackMags(player, s);
    if (n > 0) player.sendMessage(t("arsenal.ui.repacked", String(n)));
    return;
  }
  switch (r.selection) {
    case 0: return openAttachmentMenu(player);
    case 1: return openAmmoMenu(player);
    case 2: return openModeMenu(player);
    case 3: {
      const m = new MessageFormData().title(itemName(wid)).body(statBody(wid, st)).button1(t("arsenal.ui.btn_back")).button2(t("arsenal.ui.btn_close"));
      const r2 = await showForm(player, m);
      if (r2 && !r2.canceled && r2.selection === 0) return openWeaponMenu(player);
      return;
    }
    case 4: return openCamoMenu(player);
    case 5: if (mortar) return openMortarTarget(player);
  }
}

/** 迷彩（武器レベルで解放） @param {Player} player */
async function openCamoMenu(player) {
  const s = S(player);
  const wid = s.weaponId;
  if (!wid) return;
  const slot = heldSlot(player);
  const cur = slot ? /** @type {string|undefined} */ (slot.getDynamicProperty(CAMO_PROP)) ?? null : null;
  const ids = Object.keys(DATA.CAMOS);
  const lv = weaponLevel(player, wid);
  const form = new ActionFormData().title(t("arsenal.ui.btn_camo")).body(t("arsenal.ui.camo_body", String(lv)));
  form.button(raw(!cur ? "§a▶ " : "", t("arsenal.ui.camo_none")));
  for (const c of ids) {
    const ok = camoUnlocked(player, wid, c) || isCreative(player);
    const need = /** @type {any} */ (DATA.CAMOS)[c].level;
    form.button(raw(c === cur ? "§a▶ " : ok ? "" : "§8", { translate: `arsenal.camo.${c}` }, ok ? "" : raw("\n§8", t("arsenal.ui.camo_need", String(need)))));
  }
  const r = await showForm(player, form);
  if (!r || r.canceled || r.selection === undefined || s.weaponId !== wid) return;
  const pick = r.selection === 0 ? null : ids[r.selection - 1];
  if (pick && !camoUnlocked(player, wid, pick) && !isCreative(player)) {
    player.sendMessage(t("arsenal.ui.camo_locked", String(/** @type {any} */ (DATA.CAMOS)[pick].level)));
    return;
  }
  setCamo(player, pick);
}

/**
 * 迷彩を付ける（見た目違い ID へ差し替え）
 * @param {Player} player @param {string|null} camo
 */
export function setCamo(player, camo) {
  const inv = player.getComponent("minecraft:inventory")?.container;
  const idx = player.selectedSlotIndex;
  const it = inv?.getItem(idx);
  if (!inv || !it || !weaponIdOf(it.typeId)) return;
  it.setDynamicProperty(CAMO_PROP, camo ?? undefined);
  const s0 = S(player);
  writeLore(it, /** @type {string} */ (weaponIdOf(it.typeId)), s0.att ?? {}, s0.ammoType ?? "std");
  inv.setItem(idx, it);
  syncLook(inv, idx);
  S(player).hudDirty = true;
  playTo(player, "arsenal.fx.craft", { pitch: 1.3 });
}

/** 迫撃砲の目標座標 @param {Player} player */
async function openMortarTarget(player) {
  const s = S(player);
  const cur = s.mortarTarget ?? { x: Math.floor(player.location.x), z: Math.floor(player.location.z) + 40 };
  const form = new ModalFormData()
    .title(t("arsenal.ui.btn_mortar_target"))
    .textField(t("arsenal.gear.mortar_x"), "x", { defaultValue: String(Math.floor(cur.x)) })
    .textField(t("arsenal.gear.mortar_z"), "z", { defaultValue: String(Math.floor(cur.z)) })
    .toggle(t("arsenal.ui.mortar_clear"), { defaultValue: false })
    .submitButton(t("arsenal.ui.btn_save"));
  const r = await showForm(player, form);
  if (!r || r.canceled || !r.formValues) return;
  if (r.formValues[2]) {
    s.mortarTarget = null;
    player.sendMessage(t("arsenal.ui.mortar_cleared"));
    return;
  }
  const x = Number(r.formValues[0]);
  const z = Number(r.formValues[1]);
  if (!isFinite(x) || !isFinite(z)) return;
  s.mortarTarget = { x: x + 0.5, z: z + 0.5 };
  player.sendMessage(t("arsenal.ui.mortar_set", String(Math.floor(x)), String(Math.floor(z))));
}

/** @param {Player} player */
async function openModeMenu(player) {
  const s = S(player);
  const st = s.stats;
  if (!st) return;
  const form = new ActionFormData().title(t("arsenal.ui.btn_mode"));
  for (const m of st.modes) form.button(raw(m === s.mode ? "§a▶ " : "", { translate: m.startsWith("burst") ? "arsenal.mode.burst" : `arsenal.mode.${m}` }, m.startsWith("burst") ? ` (${m.slice(5)})` : ""));
  const r = await showForm(player, form);
  if (!r || r.canceled || r.selection === undefined) return;
  setMode(player, s, st.modes[r.selection]);
}

/**
 * @param {Player} player @param {import("../core/state.js").PlayerState} s @param {string} mode
 */
export function setMode(player, s, mode) {
  s.mode = mode;
  s.burstLeft = 0;
  s.charge = 0;
  s.hudDirty = true;
  const slot = heldSlot(player);
  if (slot) writeProps(slot, { [PROP.mode]: mode });
  playTo(player, "arsenal.mech.mode_switch", { volume: 0.8 });
}

/** @param {Player} player */
async function openAmmoMenu(player) {
  const s = S(player);
  const st = s.stats;
  if (!st) return;
  const fam = /** @type {any} */ (DATA.AMMO_FAMILIES)[st.ammoFamily];
  if (!fam || fam.variants.length <= 1) {
    status(s, t("arsenal.ui.no_variants"));
    return;
  }
  const form = new ActionFormData().title(t("arsenal.ui.btn_ammo")).body(t("arsenal.ui.ammo_switch_body"));
  /** @type {string[]} */
  const vs = fam.variants;
  for (const v of vs) {
    const id = ammoItemId(st.ammoFamily, v);
    const n = id ? countItem(player, id) : 0;
    form.button(raw(v === s.ammoType ? "§a▶ " : "", { translate: `arsenal.variant.${v}` }, ` §8(${n})`), id ? ICON.ammo(id.slice(NS.length + 1)) : undefined);
  }
  const r = await showForm(player, form);
  if (!r || r.canceled || r.selection === undefined) return;
  const v = vs[r.selection];
  if (v === s.ammoType) return;
  switchAmmoType(player, s, v);
  const slot = heldSlot(player);
  if (slot && s.weaponId) {
    writeLore(slot, s.weaponId, s.att, v);
    s.stats = computeStats(s.weaponId, s.att, v);
  }
  playTo(player, "arsenal.mech.mag_out");
}

/** @param {Player} player */
async function openAttachmentMenu(player) {
  const s = S(player);
  const wid = s.weaponId;
  if (!wid) return;
  const w = W(wid);
  if (!w.slots.length) {
    status(s, t("arsenal.ui.no_slots"));
    return;
  }
  const form = new ActionFormData().title(t("arsenal.ui.btn_attachments")).body(t("arsenal.ui.att_body"));
  for (const slotId of w.slots) {
    const cur = s.att[slotId];
    const fixed = w.fixed && w.fixed[slotId];
    form.button(raw({ translate: `arsenal.slot.${slotId}` }, "\n§8", cur ? itemName(cur) : fixed ? itemName(fixed) : { text: "—" }), cur ? ICON.att(cur) : undefined);
  }
  form.button(t("arsenal.ui.btn_back"));
  const r = await showForm(player, form);
  if (!r || r.canceled || r.selection === undefined) return;
  if (r.selection >= w.slots.length) return openWeaponMenu(player);
  return openSlotMenu(player, w.slots[r.selection]);
}

/** @param {Player} player @param {string} slotId */
async function openSlotMenu(player, slotId) {
  const s = S(player);
  const wid = s.weaponId;
  if (!wid) return;
  const options = Object.keys(DATA.ATTACHMENTS).filter((aid) => A(aid).slot === slotId && canAttach(wid, aid));
  const creative = isCreative(player);
  const owned = options.filter((aid) => creative || countItem(player, `${NS}:${aid}`) > 0);
  const form = new ActionFormData().title(t(`arsenal.slot.${slotId}`)).body(owned.length ? t("arsenal.ui.slot_body") : t("arsenal.ui.slot_none"));
  const cur = s.att[slotId];
  /** @type {(string|null)[]} */
  const actions = [];
  if (cur) {
    form.button(raw("§c", t("arsenal.ui.btn_detach"), "\n§8", itemName(cur)), ICON.att(cur));
    actions.push(null);
  }
  for (const aid of owned) {
    const n = countItem(player, `${NS}:${aid}`);
    form.button(raw(aid === cur ? "§a▶ " : "", itemName(aid), creative ? "" : ` §8(${n})`, "\n§7", descOf(aid)), ICON.att(aid));
    actions.push(aid);
  }
  form.button(t("arsenal.ui.btn_back"));
  const r = await showForm(player, form);
  if (!r || r.canceled || r.selection === undefined) return;
  if (r.selection >= actions.length) return openAttachmentMenu(player);
  if (s.weaponId !== wid) return;
  const choice = actions[r.selection];
  applyAttachment(player, slotId, choice);
  return openAttachmentMenu(player);
}

/**
 * アタッチメントの装着・取り外し
 * @param {Player} player @param {string} slotId @param {string|null} aid
 */
export function applyAttachment(player, slotId, aid) {
  const s = S(player);
  const wid = s.weaponId;
  if (!wid) return;
  const creative = isCreative(player);
  const prev = s.att[slotId];
  if (aid === prev) return;
  if (aid) {
    if (!canAttach(wid, aid)) return;
    if (!creative && !consumeItem(player, `${NS}:${aid}`, 1)) return;
  }
  if (prev && !creative) giveItem(player, `${NS}:${prev}`, 1);
  const att = { ...s.att };
  if (aid) att[slotId] = aid;
  else delete att[slotId];
  cancelReload(player, s);
  s.att = att;
  const st = computeStats(wid, att, s.ammoType);
  // 装弾数が減った場合は余りを返却
  if (s.ammo > st.mag) {
    const extra = s.ammo - st.mag;
    s.ammo = st.mag;
    const id = ammoItemId(st.ammoFamily, s.ammoType);
    if (id && !creative) giveItem(player, id, Math.floor(extra / st.ammoPerItem));
  }
  if (!st.modes.includes(s.mode)) s.mode = st.modes[0];
  s.stats = st;
  const slot = heldSlot(player);
  if (slot) {
    writeProps(slot, { [PROP.att]: JSON.stringify(att), [PROP.ammo]: s.ammo, [PROP.mode]: s.mode });
    writeLore(slot, wid, att, s.ammoType);
    // 光学を替えたら見た目違い ID へ（メニュー操作中なので使用中の書き換えにはならない）
    const inv = player.getComponent("minecraft:inventory")?.container;
    if (inv) syncLook(inv, player.selectedSlotIndex);
  }
  s.hudDirty = true;
  playTo(player, aid ? "arsenal.mech.mag_in" : "arsenal.mech.mag_out");
}

// ===========================================================================
//  野戦マニュアル
// ===========================================================================

/** @param {Player} player */
export async function openManual(player) {
  const op = isOperator(player);
  const form = new ActionFormData()
    .title("§lARSENAL CORE")
    .body(t("arsenal.ui.manual_body"))
    .button(t("arsenal.ui.btn_class"), ICON.tool("tactical_device"))
    .button(t("arsenal.ui.btn_squad"), "textures/ui/FriendsIcon")
    .button(t("arsenal.ui.btn_prefs"), "textures/ui/settings_glyph_color_2x")
    .button(t("arsenal.ui.btn_prefs2"), "textures/ui/icon_setting")
    .button(raw(op ? "" : "§8", t("arsenal.ui.btn_world")), "textures/ui/op")
    .button(raw(op ? "" : "§8", t("arsenal.ui.btn_world2")), "textures/ui/op")
    .button(t("arsenal.ui.btn_codex"), ICON.weapon("sentinel"))
    .button(t("arsenal.ui.btn_guide"), ICON.tool("field_manual"))
    .button(t("arsenal.ui.btn_progress"), "textures/ui/icon_best3")
    .button(t("arsenal.ui.btn_modes"), "textures/ui/icon_multiplayer")
    .button(t("arsenal.ui.btn_team"), "textures/ui/FriendsIcon")
    .button(raw(t("arsenal.ui.btn_nvg"), " §8", S(player).nvgOn ? "ON" : "OFF"), "textures/ui/night_vision_effect")
    .button(t("arsenal.ui.btn_close"));
  const r = await showForm(player, form);
  if (!r || r.canceled || r.selection === undefined) return;
  switch (r.selection) {
    case 0: return openLoadout(player);
    case 1: return openSquad(player);
    case 2: return openPrefs(player);
    case 3: return openPrefs2(player);
    case 4: return op ? openWorldSettings(player) : player.sendMessage(t("arsenal.ui.op_only"));
    case 5: return op ? openWorld2(player) : player.sendMessage(t("arsenal.ui.op_only"));
    case 6: return openCodex2(player);
    case 7: return openGuide2(player);
    case 8: return openProgress(player);
    case 9: return openModesMenu(player);
    case 10: return openTeam(player);
    case 11: {
      const s = S(player);
      s.nvgOn = !s.nvgOn;
      s.nvgTick = -99;
      player.sendMessage(t(s.nvgOn ? "arsenal.ui.nvg_on" : "arsenal.ui.nvg_off"));
      return;
    }
  }
}

/**
 * 分隊（3.0）：雇う・命令
 * @param {Player} player
 */
export async function openSquad(player) {
  const SQ = /** @type {Record<string, any>} */ (DATA.SQUAD);
  const have = squadOf(player).length > 0;
  const form = new ActionFormData()
    .title(t("arsenal.ui.btn_squad"))
    .body(squadBody(player))
    .button(t("arsenal.squad.hire"), "textures/ui/FriendsIcon")
    .button(raw(have ? "" : "§8", t("arsenal.squad.order_follow")), "textures/ui/arrow_right")
    .button(raw(have ? "" : "§8", t("arsenal.squad.order_hold")), "textures/ui/pause_screen_icon")
    .button(raw(have ? "" : "§8", t("arsenal.squad.dismiss")), "textures/ui/cancel")
    .button(t("arsenal.ui.btn_close"));
  const r = await showForm(player, form);
  if (!r || r.canceled || r.selection === undefined) return;
  if (r.selection === 1) return orderSquad(player, "follow");
  if (r.selection === 2) return orderSquad(player, "hold");
  if (r.selection === 3) return orderSquad(player, "dismiss");
  if (r.selection !== 0) return;
  const ids = Object.keys(SQ);
  const f2 = new ActionFormData().title(t("arsenal.squad.hire")).body(t("arsenal.squad.hire_body", String(DATA.SQUAD_MAX)));
  for (const id of ids) f2.button(raw({ translate: `entity.${NS}:${id}.name` }, `\n§6${SQ[id].cost} CR §7`, { translate: `arsenal.squad.${id}.desc` }), ICON.weapon(SQ[id].weapon));
  const r2 = await showForm(player, f2);
  if (!r2 || r2.canceled || r2.selection === undefined) return;
  const err = hire(player, ids[r2.selection]);
  if (err) {
    player.sendMessage(t(err));
    playTo(player, "arsenal.ui.error", { volume: 0.6 });
  } else player.sendMessage(raw("§a", t("arsenal.squad.hired"), " ", { translate: `entity.${NS}:${ids[r2.selection]}.name` }));
}

/**
 * 兵科・パーク（3.0）
 * @param {Player} player
 */
export async function openLoadout(player) {
  const CL = /** @type {Record<string, any>} */ (DATA.CLASSES);
  const PK = /** @type {Record<string, any>} */ (DATA.PERKS);
  const form = new ActionFormData()
    .title(t("arsenal.ui.btn_class"))
    .body(loadoutBody(player))
    .button(t("arsenal.class.change"), "textures/ui/icon_setting")
    .button(t("arsenal.class.get_device"), ICON.tool("tactical_device"))
    .button(t("arsenal.ui.btn_close"));
  const r = await showForm(player, form);
  if (!r || r.canceled || r.selection === undefined) return;
  if (r.selection === 1) {
    if (countItem(player, `${NS}:tactical_device`) > 0) return player.sendMessage(t("arsenal.class.have_device"));
    giveItem(player, `${NS}:tactical_device`, 1);
    return;
  }
  if (r.selection !== 0) return;
  if (inMatch(player)) return player.sendMessage(t("arsenal.class.in_match"));
  const ids = Object.keys(CL);
  const rank = rankOf(player);
  const cur = classOf(player);
  const perks = perksOf(player);
  const m = new ModalFormData()
    .title(t("arsenal.ui.btn_class"))
    .dropdown(t("arsenal.class.pick"), ids.map((c) => raw({ translate: `arsenal.class.${c}` }, " §8- ", { translate: `arsenal.ability.${CL[c].ability.id}` })), { defaultValueIndex: Math.max(0, ids.indexOf(cur)) });
  /** @type {string[][]} */
  const tierIds = [];
  for (let tier = 1; tier <= 3; tier++) {
    const list = Object.keys(PK).filter((id) => PK[id].tier === tier);
    tierIds.push(list);
    const opts = [t("arsenal.class.none"), ...list.map((id) => (rank >= PK[id].rank ? raw({ translate: `arsenal.perk.${id}` }, " §7", { translate: `arsenal.perk.${id}.desc` }) : raw("§8", { translate: `arsenal.perk.${id}` }, " ", t("arsenal.class.locked_tag", String(PK[id].rank)))))];
    const now = perks[tier - 1];
    m.dropdown(t("arsenal.class.tier", String(tier)), opts, { defaultValueIndex: now ? list.indexOf(now) + 1 : 0 });
  }
  m.submitButton(t("arsenal.ui.btn_save"));
  const r2 = await showForm(player, m);
  if (!r2 || r2.canceled || !r2.formValues) return;
  const v = r2.formValues;
  const cls = ids[Number(v[0])] ?? cur;
  const chosen = [0, 1, 2].map((i) => {
    const k = Number(v[i + 1]);
    return k > 0 ? tierIds[i][k - 1] ?? null : null;
  });
  // 解放されていないパークは外して保存する（ほかは反映）
  const locked = chosen.map((id) => (id && rank < PK[id].rank ? id : null)).filter(Boolean);
  const ok = chosen.map((id) => (id && rank >= PK[id].rank ? id : null));
  const err = setLoadout(player, cls, ok);
  if (err) {
    player.sendMessage(t(err));
    playTo(player, "arsenal.ui.error", { volume: 0.6 });
    return;
  }
  if (locked.length) player.sendMessage(t("arsenal.class.perk_locked"));
  player.sendMessage(raw("§a", t("arsenal.class.saved"), " §f", { translate: `arsenal.class.${cls}` }));
  playTo(player, "arsenal.ui.buy", { volume: 0.6 });
}

/** @param {Player} player */
async function openPrefs(player) {
  const p = P(player);
  const adsModes = ["hold", "toggle"];
  const triggerModes = ["hold", "tap"];
  const reloadModes = ["double_sneak", "manual"];
  const hudModes = ["full", "compact", "off"];
  const hudPos = ["actionbar", "title"];
  const kick = ["off", "light", "full"];
  const fx = ["auto", "low", "medium", "high"];
  const form = new ModalFormData()
    .title(t("arsenal.ui.btn_prefs"))
    .dropdown(t("arsenal.ui.pref_ads"), adsModes.map((m) => t(`arsenal.ui.ads_${m}`)), { defaultValueIndex: Math.max(0, adsModes.indexOf(p.adsMode)) })
    .dropdown(t("arsenal.ui.pref_trigger"), triggerModes.map((m) => t(`arsenal.ui.trigger_${m}`)), { defaultValueIndex: Math.max(0, triggerModes.indexOf(p.triggerMode)) })
    .dropdown(t("arsenal.ui.pref_reload"), reloadModes.map((m) => t(`arsenal.ui.reload_${m}`)), { defaultValueIndex: Math.max(0, reloadModes.indexOf(p.reloadInput)) })
    .dropdown(t("arsenal.ui.pref_hud"), hudModes.map((m) => t(`arsenal.ui.hud_${m}`)), { defaultValueIndex: Math.max(0, hudModes.indexOf(p.hudMode)) })
    .dropdown(t("arsenal.ui.pref_hudpos"), hudPos.map((m) => t(`arsenal.ui.hudpos_${m}`)), { defaultValueIndex: Math.max(0, hudPos.indexOf(p.hudPos)) })
    .toggle(t("arsenal.ui.pref_hitmarkers"), { defaultValue: p.hitmarkers })
    .toggle(t("arsenal.ui.pref_dmgnum"), { defaultValue: p.damageNumbers })
    .toggle(t("arsenal.ui.pref_blood"), { defaultValue: p.blood })
    .dropdown(t("arsenal.ui.pref_kick"), kick.map((m) => t(`arsenal.ui.kick_${m}`)), { defaultValueIndex: Math.max(0, kick.indexOf(p.aimKick)) })
    .toggle(t("arsenal.ui.pref_shake"), { defaultValue: p.cameraShake })
    .toggle(t("arsenal.ui.pref_fov"), { defaultValue: p.fovZoom })
    .dropdown(t("arsenal.ui.pref_fx"), fx.map((m) => t(`arsenal.ui.fx_${m}`)), { defaultValueIndex: Math.max(0, fx.indexOf(p.fxQuality)) })
    .slider(t("arsenal.ui.pref_volume"), 0, 100, { valueStep: 5, defaultValue: Math.round(p.volume * 100) })
    .toggle(t("arsenal.ui.pref_traj"), { defaultValue: p.trajectory })
    .submitButton(t("arsenal.ui.btn_save"));
  const r = await showForm(player, form);
  if (!r || r.canceled || !r.formValues) return;
  const v = r.formValues;
  setPrefs(player, {
    adsMode: adsModes[/** @type {number} */ (v[0])],
    triggerMode: triggerModes[/** @type {number} */ (v[1])],
    reloadInput: reloadModes[/** @type {number} */ (v[2])],
    hudMode: hudModes[/** @type {number} */ (v[3])],
    hudPos: hudPos[/** @type {number} */ (v[4])],
    hitmarkers: !!v[5],
    damageNumbers: !!v[6],
    blood: !!v[7],
    aimKick: kick[/** @type {number} */ (v[8])],
    cameraShake: !!v[9],
    fovZoom: !!v[10],
    fxQuality: fx[/** @type {number} */ (v[11])],
    volume: (/** @type {number} */ (v[12])) / 100,
    trajectory: !!v[13],
  });
  S(player).hudDirty = true;
  resetScopeMark(player, S(player));
  player.sendMessage(t("arsenal.ui.saved"));
}

/** @param {Player} player */
async function openWorldSettings(player) {
  const w = WS();
  const grief = ["gamerule", "on", "off"];
  const form = new ModalFormData()
    .title(t("arsenal.ui.btn_world"))
    .slider(t("arsenal.ui.ws_damage"), 25, 300, { valueStep: 5, defaultValue: Math.round(w.damageMul * 100) })
    .slider(t("arsenal.ui.ws_head"), 0, 200, { valueStep: 10, defaultValue: Math.round(w.headMul * 100) })
    .toggle(t("arsenal.ui.ws_ff"), { defaultValue: w.friendlyFire })
    .dropdown(t("arsenal.ui.ws_grief"), grief.map((g) => t(`arsenal.ui.grief_${g}`)), { defaultValueIndex: Math.max(0, grief.indexOf(w.explosionGrief)) })
    .toggle(t("arsenal.ui.ws_glass"), { defaultValue: w.glassBreak })
    .toggle(t("arsenal.ui.ws_durability"), { defaultValue: w.durability })
    .toggle(t("arsenal.ui.ws_infinite"), { defaultValue: w.creativeInfinite })
    .toggle(t("arsenal.ui.ws_raiders"), { defaultValue: w.raiders })
    .slider(t("arsenal.ui.ws_spawn"), 0, 64, { valueStep: 4, defaultValue: w.spawnProtect })
    .toggle(t("arsenal.ui.ws_light"), { defaultValue: w.flashlightBlocks })
    .toggle(t("arsenal.ui.ws_killfeed"), { defaultValue: w.killFeed })
    .toggle(t("arsenal.ui.ws_autoreload"), { defaultValue: w.autoReload })
    .submitButton(t("arsenal.ui.btn_save"));
  const r = await showForm(player, form);
  if (!r || r.canceled || !r.formValues) return;
  const v = r.formValues;
  setWorld({
    damageMul: /** @type {number} */ (v[0]) / 100,
    headMul: /** @type {number} */ (v[1]) / 100,
    friendlyFire: !!v[2],
    explosionGrief: grief[/** @type {number} */ (v[3])],
    glassBreak: !!v[4],
    durability: !!v[5],
    creativeInfinite: !!v[6],
    raiders: !!v[7],
    spawnProtect: /** @type {number} */ (v[8]),
    flashlightBlocks: !!v[9],
    killFeed: !!v[10],
    autoReload: !!v[11],
  });
  world.sendMessage(raw("§e[ARSENAL] ", t("arsenal.ui.world_saved", player.name)));
}

/** @param {Player} player */
async function openCodex(player) {
  const cats = Object.entries(DATA.CATEGORIES).sort((a, b) => a[1].order - b[1].order);
  const form = new ActionFormData().title(t("arsenal.ui.btn_codex")).body(t("arsenal.ui.codex_body", String(Object.keys(DATA.WEAPONS).length), String(Object.keys(DATA.ATTACHMENTS).length)));
  for (const [cid] of cats) {
    const first = Object.keys(DATA.WEAPONS).find((w) => W(w).cat === cid) ?? "vx9";
    form.button({ translate: `arsenal.cat.${cid}` }, ICON.weapon(first));
  }
  const r = await showForm(player, form);
  if (!r || r.canceled || r.selection === undefined) return;
  const cid = cats[r.selection][0];
  const ids = Object.keys(DATA.WEAPONS).filter((w) => W(w).cat === cid);
  const f2 = new ActionFormData().title({ translate: `arsenal.cat.${cid}` });
  for (const id of ids) {
    const tier = /** @type {any} */ (DATA.TIERS)[W(id).tier];
    f2.button(raw(tier.color, itemName(id), "\n§8", { translate: `arsenal.tier.${W(id).tier}` }), ICON.weapon(id));
  }
  const r2 = await showForm(player, f2);
  if (!r2 || r2.canceled || r2.selection === undefined) return openCodex(player);
  const id = ids[r2.selection];
  const st = computeStats(id, {}, W(id).defaultVariant ?? (/** @type {any} */ (DATA.AMMO_FAMILIES)[W(id).ammo]?.variants[0] ?? "std"));
  const m = new MessageFormData().title(itemName(id)).body(statBody(id, st)).button1(t("arsenal.ui.btn_back")).button2(t("arsenal.ui.btn_close"));
  const r3 = await showForm(player, m);
  if (r3 && !r3.canceled && r3.selection === 0) return openCodex(player);
}

const GUIDE_LINES = 14;

/** @param {Player} player */
async function openGuide(player) {
  /** @type {RawMessage[]} */
  const lines = [];
  for (let i = 1; i <= GUIDE_LINES; i++) lines.push({ translate: `arsenal.ui.guide_${i}` }, { text: "\n" });
  const m = new MessageFormData().title(t("arsenal.ui.btn_guide")).body({ rawtext: lines }).button1(t("arsenal.ui.btn_back")).button2(t("arsenal.ui.btn_close"));
  const r = await showForm(player, m);
  if (r && !r.canceled && r.selection === 0) return openManual(player);
}

/** @param {Player} player */
async function openTeam(player) {
  const cur = player.getTags().find((x) => x.startsWith("arsenal_team:"));
  const form = new ModalFormData()
    .title(t("arsenal.ui.btn_team"))
    .textField(t("arsenal.ui.team_label"), "alpha", { defaultValue: cur ? cur.slice(13) : "" })
    .submitButton(t("arsenal.ui.btn_save"));
  const r = await showForm(player, form);
  if (!r || r.canceled || !r.formValues) return;
  const name = String(r.formValues[0] ?? "").trim().toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 16);
  for (const tag of player.getTags()) if (tag.startsWith("arsenal_team:")) player.removeTag(tag);
  if (name) {
    player.addTag(`arsenal_team:${name}`);
    player.sendMessage(t("arsenal.ui.team_joined", name));
  } else player.sendMessage(t("arsenal.ui.team_left"));
}

// ===========================================================================
//  兵器作業台
// ===========================================================================

/** @param {Player} player */
export async function openBench(player) {
  const cats = Object.entries(DATA.CATEGORIES).sort((a, b) => a[1].order - b[1].order);
  const form = new ActionFormData().title(t("tile.arsenal:weapon_bench.name")).body(t("arsenal.ui.bench_body"));
  for (const [cid] of cats) {
    const first = Object.keys(DATA.WEAPONS).find((w) => W(w).cat === cid) ?? "vx9";
    form.button({ translate: `arsenal.cat.${cid}` }, ICON.weapon(first));
  }
  form.button(t("arsenal.ui.cat_attachments"), ICON.att("optic_holo"));
  form.button(t("arsenal.ui.cat_throwables"), ICON.thr("grenade_frag"));
  form.button(t("arsenal.ui.cat_armor"), "textures/items/arsenal/armor/vest_standard_2");
  form.button(t("arsenal.ui.cat_gear"), "textures/items/arsenal/medical/medkit");
  form.button(t("arsenal.ui.cat_repair"), ICON.tool("repair_kit"));
  const r = await showForm(player, form);
  if (!r || r.canceled || r.selection === undefined) return;
  if (r.selection < cats.length) return benchList(player, cats[r.selection][0] === "melee" ? "melee" : "weapon", cats[r.selection][0]);
  if (r.selection === cats.length) return benchList(player, "attachment", "");
  if (r.selection === cats.length + 1) return benchList(player, "throwable", "");
  if (r.selection === cats.length + 2) return benchList(player, "armor", "");
  if (r.selection === cats.length + 3) return benchList(player, "gear", "");
  return benchRepair(player);
}

/** 進行によるアタッチメントの作成制限（持っている武器の最高レベルで判定） @param {Player} player @param {string} tier */
function attachmentLocked(player, tier) {
  if (!WS().progressionLocks || isCreative(player)) return 0;
  const need = /** @type {any} */ (DATA.ATTACHMENT_UNLOCK)[tier] ?? 1;
  let best = 1;
  for (const id of Object.keys(profile(player).wxp)) best = Math.max(best, weaponLevel(player, id));
  return best >= need ? 0 : need;
}

/**
 * @param {Player} player @param {"weapon"|"melee"|"attachment"|"throwable"|"armor"|"gear"} kind @param {string} cat
 */
async function benchList(player, kind, cat) {
  /** @type {{id:string, name:RawMessage, icon:string, cost:Record<string,number>|null, out:number, tier:string}[]} */
  const entries = [];
  if (kind === "weapon") {
    for (const id of Object.keys(DATA.WEAPONS)) {
      if (W(id).cat !== cat) continue;
      entries.push({ id, name: itemName(id), icon: ICON.weapon(id), cost: DATA.weaponRecipe(id), out: 1, tier: W(id).tier });
    }
  } else if (kind === "melee") {
    for (const [id, m] of Object.entries(DATA.MELEE)) entries.push({ id, name: itemName(id), icon: `textures/items/arsenal/melee/${id}`, cost: /** @type {any} */ (m).tier === "legendary" ? null : DATA.MELEE_RECIPES[id], out: 1, tier: /** @type {any} */ (m).tier });
  } else if (kind === "armor") {
    for (const [id, a] of Object.entries(DATA.ARMOR)) entries.push({ id, name: itemName(id), icon: `textures/items/arsenal/armor/${id}`, cost: DATA.ARMOR_RECIPES[id], out: 1, tier: /** @type {any} */ (a).tier });
  } else if (kind === "gear") {
    for (const [id, m] of Object.entries(DATA.MEDICAL)) entries.push({ id, name: itemName(id), icon: `textures/items/arsenal/medical/${id}`, cost: /** @type {any} */ (m).cost, out: /** @type {any} */ (m).out ?? 1, tier: /** @type {any} */ (m).tier });
    for (const [id, d] of Object.entries(DATA.DEPLOYABLES)) entries.push({ id, name: itemName(id), icon: `textures/items/arsenal/gear/${id}`, cost: /** @type {any} */ (d).cost, out: 1, tier: /** @type {any} */ (d).tier });
    for (const [id, v] of Object.entries(DATA.VEHICLES)) entries.push({ id, name: itemName(id), icon: `textures/items/arsenal/gear/${id}`, cost: /** @type {any} */ (v).cost, out: 1, tier: /** @type {any} */ (v).tier });
    for (const id of ["streak_terminal", "arena_tool", "warlord_banner", "legion_core", "hollow_heart"]) entries.push({ id, name: itemName(id), icon: ICON.tool(id), cost: /** @type {any} */ (DATA.TOOLS)[id].cost, out: 1, tier: id === "warlord_banner" || id === "legion_core" || id === "hollow_heart" ? "legendary" : "uncommon" });
  } else if (kind === "attachment") {
    for (const id of Object.keys(DATA.ATTACHMENTS)) entries.push({ id, name: itemName(id), icon: ICON.att(id), cost: DATA.attachmentRecipe(id), out: 1, tier: A(id).tier });
  } else {
    for (const [id, th] of Object.entries(DATA.THROWABLES)) entries.push({ id, name: itemName(id), icon: ICON.thr(id), cost: th.cost, out: th.out, tier: th.tier });
    entries.push({ id: "detonator", name: itemName("detonator"), icon: ICON.tool("detonator"), cost: DATA.TOOLS.detonator.cost, out: 1, tier: "uncommon" });
  }
  const titles = { attachment: t("arsenal.ui.cat_attachments"), throwable: t("arsenal.ui.cat_throwables"), armor: t("arsenal.ui.cat_armor"), gear: t("arsenal.ui.cat_gear") };
  const form = new ActionFormData().title(kind === "weapon" || kind === "melee" ? { translate: `arsenal.cat.${cat}` } : /** @type {any} */ (titles)[kind]);
  for (const e of entries) {
    const tier = /** @type {any} */ (DATA.TIERS)[e.tier];
    const craftable = e.cost ? hasCost(player, e.cost) : false;
    const lock = kind === "attachment" ? attachmentLocked(player, e.tier) : 0;
    const mark = !e.cost ? "§8✘ " : lock ? "§8🔒 " : craftable ? "§a✔ " : "§7";
    form.button(raw(mark, tier.color, e.name, "\n§8", lock ? t("arsenal.ui.att_locked", String(lock)) : e.cost ? { translate: `arsenal.tier.${e.tier}` } : t("arsenal.ui.loot_only")), e.icon);
  }
  form.button(t("arsenal.ui.btn_back"));
  const r = await showForm(player, form);
  if (!r || r.canceled || r.selection === undefined) return;
  if (r.selection >= entries.length) return openBench(player);
  const e = entries[r.selection];
  return benchDetail(player, kind, cat, e);
}

/**
 * @param {Player} player @param {"weapon"|"melee"|"attachment"|"throwable"|"armor"|"gear"} kind @param {string} cat
 * @param {{id:string, name:RawMessage, icon:string, cost:Record<string,number>|null, out:number, tier:string}} e
 */
async function benchDetail(player, kind, cat, e) {
  if (!e.cost) {
    const m = new MessageFormData().title(e.name).body(raw(kind === "weapon" ? statBody(e.id, computeStats(e.id, {}, W(e.id).defaultVariant ?? "std")) : descOf(e.id), "\n", t("arsenal.ui.loot_only_body"))).button1(t("arsenal.ui.btn_back")).button2(t("arsenal.ui.btn_close"));
    const r = await showForm(player, m);
    if (r && !r.canceled && r.selection === 0) return benchList(player, kind, cat);
    return;
  }
  const can = hasCost(player, e.cost);
  const body = kind === "weapon" ? raw(statBody(e.id, computeStats(e.id, {}, W(e.id).defaultVariant ?? "std")), "\n§l", t("arsenal.ui.required"), "§r\n", costBody(player, e.cost)) : raw(descOf(e.id), "\n\n§l", t("arsenal.ui.required"), "§r\n", costBody(player, e.cost), e.out > 1 ? `\n§7→ x${e.out}` : "");
  const m = new MessageFormData().title(e.name).body(body).button1(can ? t("arsenal.ui.btn_craft") : raw("§8", t("arsenal.ui.btn_craft"))).button2(t("arsenal.ui.btn_back"));
  const r = await showForm(player, m);
  if (!r || r.canceled) return;
  if (r.selection === 1) return benchList(player, kind, cat);
  const lock = kind === "attachment" ? attachmentLocked(player, e.tier) : 0;
  if (lock) {
    player.sendMessage(t("arsenal.ui.att_locked", String(lock)));
    playTo(player, "arsenal.ui.error");
    return benchList(player, kind, cat);
  }
  if (!payCost(player, e.cost)) {
    player.sendMessage(t("arsenal.ui.not_enough"));
    playTo(player, "arsenal.mech.dry_fire");
    return benchDetail(player, kind, cat, e);
  }
  giveItem(player, `${NS}:${e.id}`, e.out);
  playTo(player, "arsenal.fx.craft");
  player.sendMessage(raw("§a", t("arsenal.ui.crafted", e.name)));
  return benchList(player, kind, cat);
}

/** @param {Player} player */
async function benchRepair(player) {
  const s = S(player);
  const slot = heldSlot(player);
  const item = slot?.getItem();
  const wid = item ? weaponIdOf(item.typeId) : undefined;
  if (!slot || !item || !wid) {
    player.sendMessage(t("arsenal.ui.repair_hold"));
    return;
  }
  flushWear(player, s);
  const it = slot.getItem();
  const d = it?.getComponent("minecraft:durability");
  if (!it || !d) return;
  const frac = d.damage / d.maxDurability;
  if (frac <= 0.001) {
    player.sendMessage(t("arsenal.ui.repair_full"));
    return;
  }
  /** @type {Record<string, number>} */
  const cost = {};
  for (const [k, v] of Object.entries(DATA.repairCost(wid))) cost[k] = Math.max(1, Math.ceil(v * frac));
  const m = new MessageFormData().title(t("arsenal.ui.cat_repair")).body(raw(itemName(wid), `\n§7${Math.round((1 - frac) * 100)}% → §a100%\n\n§l`, t("arsenal.ui.required"), "§r\n", costBody(player, cost))).button1(t("arsenal.ui.btn_repair")).button2(t("arsenal.ui.btn_back"));
  const r = await showForm(player, m);
  if (!r || r.canceled) return;
  if (r.selection === 1) return openBench(player);
  if (!payCost(player, cost)) {
    player.sendMessage(t("arsenal.ui.not_enough"));
    return;
  }
  safe("repair", () => {
    const it2 = slot.getItem();
    const d2 = it2?.getComponent("minecraft:durability");
    if (it2 && d2) {
      d2.damage = 0;
      slot.setItem(it2);
    }
  });
  s.jammed = false;
  playTo(player, "arsenal.fx.repair");
  player.sendMessage(raw("§a", t("arsenal.ui.repaired")));
}

/**
 * ガンスミスキット（手持ちの武器を 35% 修理）
 * @param {Player} player
 */
export function useRepairKit(player) {
  const inv = player.getComponent("minecraft:inventory")?.container;
  if (!inv) return;
  // 修理対象：ホットバーで直近に持っていた武器
  const s = S(player);
  let target = -1;
  for (let i = 0; i < 9; i++) {
    const it = inv.getItem(i);
    if (it && weaponIdOf(it.typeId)) {
      const d = it.getComponent("minecraft:durability");
      if (d && d.damage > 0) {
        target = i;
        if (s.slot === i) break;
      }
    }
  }
  if (target < 0) {
    player.sendMessage(t("arsenal.ui.repair_none"));
    return;
  }
  if (!isCreative(player) && !consumeItem(player, `${NS}:repair_kit`, 1)) return;
  safe("repairKit", () => {
    const it = inv.getItem(target);
    const d = it?.getComponent("minecraft:durability");
    if (it && d) {
      d.damage = Math.max(0, d.damage - Math.round(d.maxDurability * 0.35));
      inv.setItem(target, it);
      player.sendMessage(raw("§a", t("arsenal.ui.kit_used", itemName(/** @type {string} */ (weaponIdOf(it.typeId))))));
    }
  });
  playTo(player, "arsenal.fx.repair");
}

// ===========================================================================
//  弾薬製造機
// ===========================================================================

/** @param {Player} player */
export async function openPress(player) {
  const fams = Object.entries(DATA.AMMO_FAMILIES);
  const form = new ActionFormData().title(t("tile.arsenal:ammo_press.name")).body(t("arsenal.ui.press_body"));
  for (const [fid] of fams) {
    const first = AMMO_ITEMS.find((a) => a.family === fid);
    form.button({ translate: `arsenal.ammo.${fid}` }, first ? ICON.ammo(first.id) : undefined);
  }
  const r = await showForm(player, form);
  if (!r || r.canceled || r.selection === undefined) return;
  const fid = fams[r.selection][0];
  const items = AMMO_ITEMS.filter((a) => a.family === fid);
  if (items.length === 1) return pressDetail(player, items[0]);
  const f2 = new ActionFormData().title({ translate: `arsenal.ammo.${fid}` });
  for (const a of items) f2.button(raw(hasCost(player, a.cost) ? "§a" : "§7", itemName(a.id), ` §8→ x${a.out}`), ICON.ammo(a.id));
  f2.button(t("arsenal.ui.btn_back"));
  const r2 = await showForm(player, f2);
  if (!r2 || r2.canceled || r2.selection === undefined) return;
  if (r2.selection >= items.length) return openPress(player);
  return pressDetail(player, items[r2.selection]);
}

/** @param {Player} player @param {{id:string, cost:Record<string,number>, out:number}} a */
async function pressDetail(player, a) {
  const form = new ActionFormData().title(itemName(a.id)).body(raw("§l", t("arsenal.ui.required"), "§r\n", costBody(player, a.cost), `\n§7→ x${a.out}`));
  const mults = [1, 4, 16];
  for (const m of mults) form.button(raw(hasCost(player, a.cost, m) ? "§a" : "§8", t("arsenal.ui.btn_make", String(a.out * m))));
  form.button(t("arsenal.ui.btn_back"));
  const r = await showForm(player, form);
  if (!r || r.canceled || r.selection === undefined) return;
  if (r.selection >= mults.length) return openPress(player);
  const m = mults[r.selection];
  if (!payCost(player, a.cost, m)) {
    player.sendMessage(t("arsenal.ui.not_enough"));
    playTo(player, "arsenal.mech.dry_fire");
    return pressDetail(player, a);
  }
  giveItem(player, `${NS}:${a.id}`, a.out * m);
  playTo(player, "arsenal.fx.craft", { pitch: 1.2 });
  return pressDetail(player, a);
}

// ===========================================================================
//  弾薬箱
// ===========================================================================

const CRATE_CD_MS = 60_000;

/** @param {Player} player */
export function useCrate(player) {
  const s = S(player);
  const last = /** @type {number} */ (player.getDynamicProperty("arsenal:crate_ts") ?? 0);
  const now = Date.now();
  if (now - last < CRATE_CD_MS && !isCreative(player)) {
    const sec = Math.ceil((CRATE_CD_MS - (now - last)) / 1000);
    player.sendMessage(t("arsenal.ui.crate_wait", String(sec)));
    playTo(player, "arsenal.mech.dry_fire");
    return;
  }
  const inv = player.getComponent("minecraft:inventory")?.container;
  if (!inv) return;
  /** @type {Map<string, number>} */
  const give = new Map();
  for (let i = 0; i < 9; i++) {
    const it = inv.getItem(i);
    const wid = it ? weaponIdOf(it.typeId) : undefined;
    if (!it || !wid) continue;
    const w = W(wid);
    if (w.ammo === "none") continue;
    const variant = /** @type {string} */ (it.getDynamicProperty(PROP.at) ?? w.defaultVariant ?? (/** @type {any} */ (DATA.AMMO_FAMILIES)[w.ammo]?.variants[0] ?? "std"));
    const id = ammoItemId(w.ammo, variant === "slug" || variant === "fire" ? variant : variant) ?? ammoItemId(w.ammo, "std");
    if (!id) continue;
    const per = w.ammoPerItem ?? 1;
    const rounds = Math.min(w.mag * 2, w.ammo === "gl40" || w.ammo === "rocket" ? 3 : 120);
    give.set(id, (give.get(id) ?? 0) + Math.ceil(rounds / per));
  }
  if (give.size === 0) {
    player.sendMessage(t("arsenal.ui.crate_none"));
    return;
  }
  for (const [id, n] of give) giveItem(player, id, n);
  player.setDynamicProperty("arsenal:crate_ts", now);
  playTo(player, "arsenal.mech.mag_in");
  playTo(player, "arsenal.fx.craft", { pitch: 0.8 });
  player.sendMessage(raw("§a", t("arsenal.ui.crate_ok")));
  s.hudDirty = true;
}

export { onOff };
