// @ts-check
/**
 * ランタイム定数と、データ定義から導出する参照テーブル
 */
import * as D from "./weapons.data.js";

export const NS = D.NS;
export const TICKS_PER_SEC = 20;

export const ENTITY = {
  projectile: `${NS}:projectile`,
  dummy: `${NS}:target_dummy`,
  // 2.0
  aiShot: `${NS}:ai_shot`,
  waypoint: `${NS}:waypoint`,
  crate: `${NS}:supply_crate`,
  quartermaster: `${NS}:quartermaster`,
  storage: `${NS}:storage`,
};

export const BLOCK = {
  bench: `${NS}:weapon_bench`,
  press: `${NS}:ammo_press`,
  crate: `${NS}:ammo_crate`,
};

export const ITEM = {
  manual: `${NS}:field_manual`,
  detonator: `${NS}:detonator`,
  repairKit: `${NS}:repair_kit`,
  targetKit: `${NS}:target_kit`,
  // 2.0
  arenaTool: `${NS}:arena_tool`,
  streakTerminal: `${NS}:streak_terminal`,
  warlordBanner: `${NS}:warlord_banner`,
  legionCore: `${NS}:legion_core`,
  hollowHeart: `${NS}:hollow_heart`,
  fuel: `${NS}:fuel_canister`,
  plate: `${NS}:armor_plate`,
};

/** 弾体モデルの種類（BP の arsenal:kind プロパティ値）*/
export const PROJ_KIND = {
  frag: 0, impact: 1, smoke: 2, flash: 3, molotov: 4, sticky: 5, c4: 6, mine: 7,
  gl40: 8, rocket: 9, flare: 10, hook: 11, seeker: 12,
  // 2.0（番号は既存の後ろに足すだけ）
  knife: 13, gas: 14, emp: 15, cluster: 16, decoy: 17, snap: 18, mortar: 19, plasma: 20, needle: 21, bomblet: 22, blade: 23, missile: 24,
  // 2.6
  nuke: 25,
};

/** 武器 ID の集合 */
export const WEAPON_IDS = new Set(Object.keys(D.WEAPONS));
export const ATTACHMENT_IDS = new Set(Object.keys(D.ATTACHMENTS));
export const THROWABLE_IDS = new Set(Object.keys(D.THROWABLES));

/** 弾薬アイテム一覧と逆引き */
export const AMMO_ITEMS = D.listAmmoItems();
/** @type {Map<string, {id:string,family:string,variant:string}>} */
export const AMMO_BY_ITEM = new Map(AMMO_ITEMS.map((a) => [`${NS}:${a.id}`, a]));

/**
 * 系統と弾種からアイテム ID
 * @param {string} family @param {string} variant
 */
export function ammoItemId(family, variant) {
  const a = AMMO_ITEMS.find((x) => x.family === family && x.variant === variant);
  return a ? `${NS}:${a.id}` : undefined;
}

/** @param {string} family */
export function defaultVariant(family) {
  return D.AMMO_FAMILIES[/** @type {keyof typeof D.AMMO_FAMILIES} */ (family)]?.variants[0] ?? "std";
}

/** 見た目違い ID（"<id>__o1" / "<id>__c3"）→ 元の武器 */
const VARIANT_OF = /** @type {Record<string, {base:string, look?:number, camo?:string}>} */ (D.VARIANT_OF);

/**
 * アイテム ID → 武器 ID（見た目違い ID も元の武器として扱う）
 * @param {string} typeId
 */
export function weaponIdOf(typeId) {
  if (!typeId.startsWith(`${NS}:`)) return undefined;
  const id = typeId.slice(NS.length + 1);
  if (WEAPON_IDS.has(id)) return id;
  const v = VARIANT_OF[id];
  return v ? v.base : undefined;
}

/**
 * アイテム ID の見た目（光学グループ・迷彩）。元の ID なら既定の見た目
 * @param {string} typeId
 * @returns {{base:string, look:number, camo:string|null, variant:boolean}|undefined}
 */
export function lookOf(typeId) {
  if (!typeId.startsWith(`${NS}:`)) return undefined;
  const id = typeId.slice(NS.length + 1);
  if (WEAPON_IDS.has(id)) return { base: id, look: /** @type {any} */ (D.LOOK)[id].base, camo: null, variant: false };
  const v = VARIANT_OF[id];
  if (!v) return undefined;
  return { base: v.base, look: v.look ?? /** @type {any} */ (D.LOOK)[v.base].base, camo: v.camo ?? null, variant: true };
}

const MELEE_IDS = new Set(Object.keys(D.MELEE));
const ARMOR_IDS = new Set(Object.keys(D.ARMOR));
const MEDICAL_IDS = new Set(Object.keys(D.MEDICAL));
const DEPLOYABLE_IDS = new Set(Object.keys(D.DEPLOYABLES));
const VEHICLE_IDS = new Set(Object.keys(D.VEHICLES));

/** @param {Set<string>} set @param {string} typeId */
function idIn(set, typeId) {
  if (!typeId.startsWith(`${NS}:`)) return undefined;
  const id = typeId.slice(NS.length + 1);
  return set.has(id) ? id : undefined;
}
/** @param {string} typeId */
export const meleeIdOf = (typeId) => idIn(MELEE_IDS, typeId);
/** @param {string} typeId */
export const armorIdOf = (typeId) => idIn(ARMOR_IDS, typeId);
/** @param {string} typeId */
export const medicalIdOf = (typeId) => idIn(MEDICAL_IDS, typeId);
/** @param {string} typeId */
export const deployableIdOf = (typeId) => idIn(DEPLOYABLE_IDS, typeId);
/** @param {string} typeId */
export const vehicleIdOf = (typeId) => idIn(VEHICLE_IDS, typeId);

/** 敵の ID（ボスを含む） @param {string} typeId */
export function enemyIdOf(typeId) {
  if (!typeId.startsWith(`${NS}:`)) return undefined;
  const id = typeId.slice(NS.length + 1);
  if (/** @type {any} */ (D.ENEMIES)[id] || /** @type {any} */ (D.BOSSES)[id]) return id;
  return undefined;
}

/** 敵の定義（ボスを含む） @param {string} id */
export function enemyDef(id) {
  return /** @type {any} */ (D.ENEMIES)[id] ?? /** @type {any} */ (D.BOSSES)[id];
}

/** @param {string} typeId */
export function throwableIdOf(typeId) {
  if (!typeId.startsWith(`${NS}:`)) return undefined;
  const id = typeId.slice(NS.length + 1);
  return THROWABLE_IDS.has(id) ? id : undefined;
}

/** @param {string} typeId */
export function attachmentIdOf(typeId) {
  if (!typeId.startsWith(`${NS}:`)) return undefined;
  const id = typeId.slice(NS.length + 1);
  return ATTACHMENT_IDS.has(id) ? id : undefined;
}

/** 遠距離レイヤーを持つ射撃音セット */
export const FAR_SOUND_SETS = new Set(["pistol", "magnum", "smg", "smg_heavy", "rifle", "rifle_heavy", "battle", "sniper", "antimat", "shotgun", "lmg", "lmg_heavy", "rotary", "hmg"]);

/** 射撃ごとの反動アニメーションの強さ */
/** @param {number} v */
export function kickClass(v) {
  if (v < 1.2) return "light";
  if (v < 2.6) return "medium";
  if (v < 5.0) return "heavy";
  return "massive";
}

/** 薬莢の種類 */
/** @param {string} weaponId */
export function casingKind(weaponId) {
  const w = D.WEAPONS[/** @type {keyof typeof D.WEAPONS} */ (weaponId)];
  if (!w) return null;
  if (w.ammo === "shell") return w.model.type === "double" ? null : "shell";
  if (["cell", "gl40", "rocket", "flare", "none", "fuel", "mortar"].includes(w.ammo)) return null;
  if (w.model.type === "revolver") return null;
  return "casing";
}

/** 射撃モードの表示キー @param {string} mode */
export const modeKey = (mode) => `arsenal.mode.${mode.startsWith("burst") ? "burst" : mode}`;

export const HUD_GLYPH = {
  bullet: "", bulletEmpty: "", semi: "", burst: "", auto: "",
  hit: "", hitHead: "", kill: "", heat: "", lock: "", reload: "",
  shell: "", grenade: "", cell: "", wrench: "", jam: "",
  ub: "", charge: "", rocket: "", hook: "", dot: "", skull: "", shield: "", flame: "",
};

export const DATA = D;
