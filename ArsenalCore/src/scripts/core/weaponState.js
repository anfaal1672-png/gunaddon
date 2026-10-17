// @ts-check
/**
 * 武器 1 挺ごとの状態（ItemStack のダイナミックプロパティ）と、アタッチメント込みの実効ステータス
 */
import { EquipmentSlot } from "@minecraft/server";
import { DATA, NS, defaultVariant, weaponIdOf } from "../config/constants.js";
import { migrateItem, ITEM_FORMAT, CAMO_PROP } from "./migrate.js";
import { t, itemName } from "../util/i18n.js";
import { safe } from "../util/log.js";

const { WEAPONS, ATTACHMENTS, OPTICS, AMMO_VARIANTS, TIERS } = DATA;

/** 1.0 系から変えないキー（init / ammo / mode / att / at / ub）と、2.0 で足したキー（v / camo / dual） */
export const PROP = { init: "a:init", ammo: "a:ammo", mode: "a:mode", att: "a:att", at: "a:at", ub: "a:ub", v: "a:v", camo: CAMO_PROP, dual: "a:dm", id: "a:id", mags: "a:mg" };

/** 武器 1 挺ごとの識別子（同じ武器を 2 挺持っていても区別する） */
export function newWeaponUid() {
  return Math.floor(Math.random() * 0x7fffffff).toString(36) + (Date.now() % 1e6).toString(36);
}

/** @param {string} id */
export const W = (id) => /** @type {any} */ (WEAPONS)[id];
/** @param {string} id */
export const A = (id) => /** @type {any} */ (ATTACHMENTS)[id];

/** 装着可能か @param {string} weaponId @param {string} attId */
export function canAttach(weaponId, attId) {
  const w = W(weaponId);
  const a = A(attId);
  if (!w || !a) return false;
  if (!w.slots.includes(a.slot)) return false;
  if (w.fixed && w.fixed[a.slot]) return false;
  if (a.only && !a.only.includes(w.cat)) return false;
  return true;
}

/** @type {Map<string, any>} */
const statCache = new Map();

/**
 * 実効ステータス
 * @param {string} weaponId @param {Record<string,string>} att @param {string} ammoType
 */
export function computeStats(weaponId, att, ammoType) {
  const key = `${weaponId}|${JSON.stringify(att)}|${ammoType}`;
  const c = statCache.get(key);
  if (c) return c;
  const w = W(weaponId);
  /** @type {any[]} */
  const mods = [];
  for (const aid of Object.values(att)) {
    const a = A(aid);
    if (a) mods.push({ ...a.mods, _optic: a.optic, _id: aid });
  }
  if (w.fixed) for (const aid of Object.values(w.fixed)) {
    const a = A(aid);
    if (a) mods.push({ ...a.mods, _optic: a.optic, _id: aid });
  }
  const m = (/** @type {string} */ k, dflt = 1) => mods.reduce((acc, x) => (typeof x[k] === "number" ? acc * x[k] : acc), dflt);
  const madd = (/** @type {string} */ k) => mods.reduce((acc, x) => (typeof x[k] === "number" ? acc + x[k] : acc), 0);
  const has = (/** @type {string} */ k) => mods.some((x) => x[k] === true);
  const any = (/** @type {string} */ k) => mods.find((x) => x[k] !== undefined)?.[k];

  const opticId = mods.find((x) => x._optic)?._optic ?? w.optic ?? "iron";
  const optic = /** @type {any} */ (OPTICS)[opticId] ?? OPTICS.iron;
  const isShell = w.ammo === "shell";
  const variant = isShell ? null : /** @type {any} */ (AMMO_VARIANTS)[ammoType] ?? AMMO_VARIANTS.std;
  const suppressed = any("sound") === "suppressed" || w.sound.startsWith("suppressed");

  let pellets = w.pellets ?? 1;
  let dmg = w.dmg;
  let pelletSpread = (w.pelletSpread ?? 0) * m("pelletSpread");
  let range0 = w.range[0];
  let range1 = w.range[1];
  let falloff = w.falloff;
  let hip = w.spread.hip;
  let ads = w.spread.ads;
  let fireSecs = 0;
  let pen = w.pen;
  let ap = w.ap ?? 0;
  let tracerAlways = false;
  if (isShell) {
    if (ammoType === "slug") {
      const rifled = w.rifled ? 1.3 : 1.0;
      dmg = w.dmg * pellets * 0.7 * rifled;
      pellets = 1;
      pelletSpread = 0;
      range0 *= 2.5;
      range1 *= 2.2;
      falloff = 0.6;
      pen += 1;
      if (w.rifled) {
        hip *= 0.5;
        ads *= 0.5;
      }
    } else if (ammoType === "fire") {
      dmg *= 0.75;
      fireSecs = 4 * (w.fireBoost ?? 1);
      range1 *= 0.8;
    } else if (w.rifled) {
      pelletSpread *= 1.5;
    }
  } else if (variant) {
    dmg *= variant.dmg;
    pen += variant.pen;
    ap = Math.min(1, ap + variant.ap);
    fireSecs = variant.fire;
    range0 *= variant.range;
    range1 *= variant.range;
    tracerAlways = variant.tracer;
  }
  // 2.0 の弾薬改造・銃身・トリガー
  dmg *= m("dmg");
  const penSet = mods.find((x) => typeof x.penSet === "number")?.penSet;
  pen = penSet !== undefined ? penSet : Math.max(0, pen + madd("penAdd"));
  if (has("explosive")) fireSecs = Math.max(fireSecs, 0);
  if (typeof w.fireSecs === "number") fireSecs = Math.max(fireSecs, w.fireSecs);
  const rangeMul = m("range");
  const modes = [...w.modes];
  const ub = any("underbarrel");
  if (ub) modes.push("ub");
  const subsonic = has("subsonic");

  const st = {
    id: weaponId,
    cat: w.cat,
    tier: w.tier,
    fire: w.fire ?? "hitscan",
    ammoFamily: w.ammo,
    ammoPerItem: w.ammoPerItem ?? 1,
    mag: Math.max(1, Math.ceil(w.mag * m("mag"))),
    rpm: w.rpm * m("rpm"),
    semiRate: m("semiRate"),
    burstRpm: (w.burstRpm ?? w.rpm) * m("rpm"),
    burstDelay: w.burstDelay ?? 5,
    modes,
    dmg,
    dmgMin: w.dmgMin ?? dmg,
    head: w.head,
    range0: range0 * rangeMul,
    range1: range1 * rangeMul,
    falloff,
    hip: hip * m("hipSpread"),
    ads: ads * m("adsSpread") * optic.adsSpread,
    moveSpread: w.spread.move,
    bloom: w.spread.bloom * m("bloom"),
    bloomMax: w.spread.bloomMax * m("bloom"),
    recover: w.spread.recover,
    recoilV: w.recoil.v * m("recoilV"),
    recoilH: w.recoil.h * m("recoilH"),
    shake: w.recoil.shake,
    reloadTac: Math.max(4, Math.round(w.reload.tac * m("reload"))),
    reloadEmpty: Math.max(4, Math.round(w.reload.empty * m("reload"))),
    single: w.single ? { start: w.single.start, per: Math.max(4, Math.round(w.single.per * m("reload"))), end: w.single.end } : null,
    adsTime: Math.max(1, w.ads + madd("adsTime") + optic.adsTime),
    move: w.move * m("move"),
    pen,
    ap,
    fireSecs,
    pellets,
    pelletSpread,
    optic: opticId,
    fov: optic.fov,
    zoomBoost: optic.zoomBoost ?? 0,
    nightVision: !!optic.nightVision,
    sound: suppressed ? (["sniper", "dmr", "battle"].includes(w.cat) ? "suppressed_heavy" : "suppressed") : w.sound,
    pitch: w.pitch ?? 1,
    flash: !mods.some((x) => x.flash === false) && !suppressed,
    tracer: !mods.some((x) => x.tracer === false) && !suppressed,
    tracerAlways,
    laser: has("laser"),
    flashlight: has("flashlight"),
    bipod: has("bipod"),
    underbarrel: ub ?? null,
    suppressed,
    bolt: !!w.bolt,
    pump: !!w.pump,
    spinup: w.spinup ?? 0,
    charge: w.charge ?? 0,
    heat: w.heat ? { ...w.heat, cool: w.heat.cool * m("heatCool") } : null,
    chain: w.chain ?? null,
    lockTicks: w.lockTicks ?? 0,
    cooldown: w.cooldown ?? 0,
    wallPierce: !!w.wallPierce,
    projectile: w.projectile ?? null,
    // 構えるまでの tick（走ったあと・走りながら撃つとき）
    ready: /** @type {any} */ (DATA.CATEGORIES)[w.cat].ready ?? 6,
    // 薬室の 1 発：クローズドボルトの箱型マガジンの銃は、残弾ありのリロードで「マガジン＋薬室 1 発」になる
    // （リボルバー・中折れ・1 発ずつ装填・オープンボルトの機関銃・ランチャー・エネルギー兵器などは対象外）
    chamber: !w.single && w.ammo !== "cell" && w.cat !== "lmg" && w.cat !== "launcher" && !["revolver", "double", "launcher", "tube", "flare", "grapple", "flamer", "energy", "mortar", "rotary", "lmg"].includes(w.model?.type) ? 1 : 0,
    // 弾が飛ぶ（ヒットスキャンの銃）：カテゴリの弾速と重力。亜音速弾は 0.8 倍の弾速
    travel: (!w.fire || w.fire === "hitscan") && (w.bullet ?? /** @type {any} */ (DATA.CATEGORIES)[w.cat].bullet)
      ? { speed: (w.bullet ?? /** @type {any} */ (DATA.CATEGORIES)[w.cat].bullet).speed * (subsonic ? 0.8 : 1), gravity: (w.bullet ?? /** @type {any} */ (DATA.CATEGORIES)[w.cat].bullet).gravity }
      : null,
    model: w.model,
    durability: /** @type {any} */ (DATA.CATEGORIES)[w.cat].durability,
    // ---- 2.0 ----
    subsonic,
    noRicochet: has("noRicochet") || penSet === 0,
    explosive: has("explosive"),
    pelletFlat: has("pelletFlat"),
    meleeDmg: 4 + madd("meleeDmg"),
    dualMag: has("dualMag"),
    canted: has("canted"),
    variable: !!optic.variable,
    altFov: optic.altFov ?? null,
    rangefinder: !!optic.rangefinder,
    vsUnarmored: m("vsUnarmored"),
    vsArmored: m("vsArmored"),
    adsRecoil: w.adsRecoil ?? 1,
    armorBonus: w.armorBonus ?? 1,
    mark: w.mark ?? 0,
    knock: w.knock ?? 0,
    ammoPerItemFam: w.ammoPerItem ?? 1,
  };
  statCache.set(key, st);
  return st;
}

/** 手持ちのインベントリスロット @param {import("@minecraft/server").Player} player */
export function heldSlot(player) {
  return safe("heldSlot", () => {
    const inv = player.getComponent("minecraft:inventory");
    if (!inv || !inv.container) return undefined;
    return inv.container.getSlot(player.selectedSlotIndex);
  });
}

/** @param {import("@minecraft/server").Player} player */
export function heldItem(player) {
  return safe("heldItem", () => player.getComponent("minecraft:equippable")?.getEquipment(EquipmentSlot.Mainhand));
}

/**
 * 武器アイテムの状態を読む（未初期化なら満タンで初期化）
 * @param {import("@minecraft/server").ContainerSlot | import("@minecraft/server").ItemStack} slot
 * @param {string} weaponId
 */
export function readWeapon(slot, weaponId) {
  const w = W(weaponId);
  let init = slot.getDynamicProperty(PROP.init);
  /** @type {Record<string,string>} */
  let att = {};
  const rawAtt = slot.getDynamicProperty(PROP.att);
  if (typeof rawAtt === "string") {
    try {
      att = JSON.parse(rawAtt);
    } catch {
      att = {};
    }
  }
  let ammoType = /** @type {string} */ (slot.getDynamicProperty(PROP.at) ?? (w.defaultVariant ?? defaultVariant(w.ammo)));
  const st = computeStats(weaponId, att, ammoType);
  if (init !== true) {
    const mode = w.modes[0];
    slot.setDynamicProperties({ [PROP.init]: true, [PROP.ammo]: st.mag, [PROP.mode]: mode, [PROP.att]: "{}", [PROP.at]: ammoType, [PROP.ub]: 0, [PROP.v]: ITEM_FORMAT });
    writeLore(slot, weaponId, att, ammoType);
  } else if (migrateItem(slot, weaponId)) {
    // 1.0.2 のアイテム：外れたアタッチメントを反映して読み直す
    const raw2 = slot.getDynamicProperty(PROP.att);
    att = typeof raw2 === "string" ? JSON.parse(raw2) : {};
    writeLore(slot, weaponId, att, ammoType);
    return readWeapon(slot, weaponId);
  }
  if (slot.getDynamicProperty(PROP.id) === undefined) slot.setDynamicProperty(PROP.id, newWeaponUid());
  const ammo = /** @type {number} */ (slot.getDynamicProperty(PROP.ammo) ?? st.mag);
  let mode = /** @type {string} */ (slot.getDynamicProperty(PROP.mode) ?? w.modes[0]);
  if (!st.modes.includes(mode)) mode = st.modes[0];
  const ub = /** @type {number} */ (slot.getDynamicProperty(PROP.ub) ?? 0);
  return { ammo: Math.min(ammo, st.mag), mode, att, ammoType, ub, stats: st };
}

/**
 * @param {import("@minecraft/server").ContainerSlot | import("@minecraft/server").ItemStack} slot
 * @param {Record<string, string|number|boolean>} values
 */
export function writeProps(slot, values) {
  safe("writeProps", () => slot.setDynamicProperties(values));
}

/**
 * 説明文（Lore）を更新
 * @param {import("@minecraft/server").ContainerSlot | import("@minecraft/server").ItemStack} slot
 * @param {string} weaponId @param {Record<string,string>} att @param {string} ammoType
 */
export function writeLore(slot, weaponId, att, ammoType) {
  const w = W(weaponId);
  const tier = /** @type {any} */ (TIERS)[w.tier];
  /** @type {import("@minecraft/server").RawMessage[]} */
  const lore = [];
  lore.push({ rawtext: [{ text: `${tier.color}` }, { translate: `arsenal.tier.${w.tier}` }, { text: " §7| " }, { translate: `arsenal.cat.${w.cat}` }] });
  lore.push({ rawtext: [{ text: "§7" }, t("arsenal.ui.lore_ammo", { translate: `arsenal.ammo.${w.ammo}` }, { translate: `arsenal.variant.${ammoType}` })] });
  const fixed = w.fixed ? Object.values(w.fixed) : [];
  for (const aid of [...fixed, ...Object.values(att)]) {
    lore.push({ rawtext: [{ text: "§b+ " }, itemName(/** @type {string} */ (aid))] });
  }
  const camo = safe("lore.camo", () => slot.getDynamicProperty(PROP.camo));
  if (typeof camo === "string") lore.push({ rawtext: [{ text: "§d◆ " }, { translate: `arsenal.camo.${camo}` }] });
  safe("writeLore", () => slot.setLore(lore));
}

/** 所持武器のアイテム識別キー @param {import("@minecraft/server").ItemStack} item @param {number} slot */
export function itemKey(item, slot) {
  // 見た目違い ID への差し替えでは持ち替えとみなさない（元の武器 ID と 1 挺ごとの識別子で見分ける）
  const uid = safe("itemKey.uid", () => item.getDynamicProperty(PROP.id)) ?? "";
  return `${weaponIdOf(item.typeId) ?? item.typeId}@${slot}#${uid}`;
}

/**
 * 所持中の武器（識別子が一致するもの）があるスロット。手持ちのスロットを優先し、動かされていれば探す
 * @param {import("@minecraft/server").Container} c @param {number} prefer @param {string|null} wid @param {string|null} uid
 */
export function findWeaponSlot(c, prefer, wid, uid) {
  const match = (/** @type {import("@minecraft/server").ItemStack|undefined} */ it) => !!it && isWeaponItem(it, wid) && (!uid || it.getDynamicProperty(PROP.id) === uid);
  if (prefer >= 0 && prefer < c.size && match(c.getItem(prefer))) return prefer;
  if (!uid) return -1;
  for (let i = 0; i < c.size; i++) if (match(c.getItem(i))) return i;
  return -1;
}

/**
 * スロットのアイテムが所持中の武器か（見た目違い ID も同じ武器）
 * @param {import("@minecraft/server").ItemStack|undefined} it @param {string|null} wid
 */
export function isWeaponItem(it, wid) {
  return !!it && !!wid && weaponIdOf(it.typeId) === wid;
}

export { NS };
