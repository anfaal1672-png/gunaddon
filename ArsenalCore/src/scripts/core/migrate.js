// @ts-check
/**
 * 1.0.2 → 2.0 の移行と、見た目違い ID（光学グループ・迷彩）の差し替え
 *
 *  ・アイテム：a:v（形式のバージョン）が無ければ 1.0 系とみなし、既存のキー（a:ammo / a:mode / a:att / a:at / a:ub / a:init）は
 *    そのまま、無効になったアタッチメントだけ外して a:v = 2 を付ける
 *  ・ワールド／プレイヤー：設定の欠けたキーを既定値で補い、a:v を付ける
 *  ・見た目違い ID：状態（ダイナミックプロパティ・耐久・名前・Lore・エンチャント）をすべて引き継いで ID だけ替える。
 *    元の ID への復元（normalizeVariants）も用意する
 */
import { world, ItemStack } from "@minecraft/server";
import { DATA, NS, weaponIdOf, lookOf } from "../config/constants.js";
import { safe } from "../util/log.js";

export const ITEM_FORMAT = DATA.ITEM_FORMAT;
const WORLD_VERSION_KEY = "a:v";
const PLAYER_VERSION_KEY = "a:v";
export const CAMO_PROP = "a:cm";

/**
 * 1.0 系のアイテムを 2.0 形式へ（書き換えた場合 true）
 * @param {import("@minecraft/server").ItemStack | import("@minecraft/server").ContainerSlot} it
 * @param {string} wid
 */
export function migrateItem(it, wid) {
  const v = it.getDynamicProperty("a:v");
  if (typeof v === "number" && v >= ITEM_FORMAT) return false;
  if (it.getDynamicProperty("a:init") !== true) {
    // まだ一度も初期化されていない（作成直後・ルート）→ 初期化時に a:v を付ける
    return false;
  }
  const w = /** @type {any} */ (DATA.WEAPONS)[wid];
  /** @type {Record<string, string>} */
  let att = {};
  const raw = it.getDynamicProperty("a:att");
  if (typeof raw === "string") {
    try {
      att = JSON.parse(raw);
    } catch {
      att = {};
    }
  }
  /** @type {Record<string, string>} */
  const kept = {};
  for (const [slot, aid] of Object.entries(att)) {
    const a = /** @type {any} */ (DATA.ATTACHMENTS)[aid];
    if (a && a.slot === slot && w.slots.includes(slot) && !(w.fixed && w.fixed[slot]) && (!a.only || a.only.includes(w.cat))) kept[slot] = aid;
  }
  it.setDynamicProperties({ "a:att": JSON.stringify(kept), "a:v": ITEM_FORMAT });
  return true;
}

/** 世界の移行（起動時に 1 回） */
export function migrateWorld() {
  safe("migrate.world", () => {
    const v = world.getDynamicProperty(WORLD_VERSION_KEY);
    if (typeof v === "number" && v >= ITEM_FORMAT) return;
    const raw = world.getDynamicProperty("arsenal:world_settings");
    if (typeof raw === "string") {
      let s = {};
      try {
        s = JSON.parse(raw);
      } catch {
        s = {};
      }
      world.setDynamicProperty("arsenal:world_settings", JSON.stringify({ ...DATA.DEFAULT_WORLD_SETTINGS, ...s }));
    }
    world.setDynamicProperty(WORLD_VERSION_KEY, ITEM_FORMAT);
  });
}

/**
 * プレイヤーの移行（参加時）
 * @param {import("@minecraft/server").Player} player
 */
export function migratePlayer(player) {
  safe("migrate.player", () => {
    const v = player.getDynamicProperty(PLAYER_VERSION_KEY);
    if (typeof v === "number" && v >= ITEM_FORMAT) return;
    const raw = player.getDynamicProperty("arsenal:prefs");
    if (typeof raw === "string") {
      let s = {};
      try {
        s = JSON.parse(raw);
      } catch {
        s = {};
      }
      // 1.0.2 で HUD を消していた・タイトル表示にしていた人は、従来型の HUD のままにする
      const keepClassic = /** @type {any} */ (s).hudStyle === undefined && (/** @type {any} */ (s).hudMode === "off" || /** @type {any} */ (s).hudPos === "title");
      player.setDynamicProperty("arsenal:prefs", JSON.stringify({ ...DATA.DEFAULT_PLAYER_SETTINGS, ...s, ...(keepClassic ? { hudStyle: "classic" } : {}) }));
    }
    player.setDynamicProperty(PLAYER_VERSION_KEY, ITEM_FORMAT);
  });
}

/**
 * アタッチメントと迷彩から、手に持つべき見た目の ID を決める
 * @param {string} wid @param {Record<string,string>} att @param {string|null} camo
 */
export function desiredTypeId(wid, att, camo) {
  if (camo && /** @type {any} */ (DATA.CAMOS)[camo]) return `${NS}:${wid}__${camo}`;
  const look = /** @type {any} */ (DATA.LOOK)[wid];
  if (!look || look.groups.length === 0) return `${NS}:${wid}`;
  const aid = att.optic;
  const optic = aid ? /** @type {any} */ (DATA.ATTACHMENTS)[aid]?.optic : null;
  const w = /** @type {any} */ (DATA.WEAPONS)[wid];
  const g = /** @type {any} */ (DATA.OPTIC_GROUP)[optic ?? w.optic ?? "iron"] ?? 0;
  if (g === look.base || !look.groups.includes(g)) return `${NS}:${wid}`;
  return `${NS}:${wid}__o${g}`;
}

/**
 * ItemStack の ID だけを替えた複製（状態はすべて引き継ぐ）
 * @param {ItemStack} old @param {string} newTypeId
 */
export function retype(old, newTypeId) {
  const it = new ItemStack(newTypeId, old.amount);
  for (const id of old.getDynamicPropertyIds()) {
    const v = old.getDynamicProperty(id);
    if (v !== undefined) it.setDynamicProperty(id, v);
  }
  safe("retype.durability", () => {
    const a = old.getComponent("minecraft:durability");
    const b = it.getComponent("minecraft:durability");
    if (a && b) b.damage = Math.min(b.maxDurability - 1, a.damage);
  });
  // 説明文は RawMessage で書いているので、getLore()（文字列）ではなく getRawLore() で写す
  safe("retype.lore", () => it.setLore(/** @type {any} */ (old).getRawLore ? /** @type {any} */ (old).getRawLore() : old.getLore()));
  safe("retype.name", () => {
    if (old.nameTag) it.nameTag = old.nameTag;
    it.keepOnDeath = old.keepOnDeath;
    it.lockMode = old.lockMode;
  });
  safe("retype.enchant", () => {
    const a = old.getComponent("minecraft:enchantable");
    const b = it.getComponent("minecraft:enchantable");
    if (a && b) b.addEnchantments(a.getEnchantments());
  });
  return it;
}

/**
 * コンテナのスロットの武器を、あるべき見た目の ID に合わせる（変えた場合 true）
 * 使用中（撃っている最中）には呼ばないこと。メニュー操作・持ち替え時に使う
 * @param {import("@minecraft/server").Container} c @param {number} slot
 */
export function syncLook(c, slot) {
  return safe("syncLook", () => {
    const it = c.getItem(slot);
    if (!it) return false;
    const wid = weaponIdOf(it.typeId);
    if (!wid) return false;
    /** @type {Record<string,string>} */
    let att = {};
    const raw = it.getDynamicProperty("a:att");
    if (typeof raw === "string") {
      try {
        att = JSON.parse(raw);
      } catch {
        att = {};
      }
    }
    const camo = /** @type {string|undefined} */ (it.getDynamicProperty(CAMO_PROP)) ?? null;
    const want = desiredTypeId(wid, att, camo);
    if (want === it.typeId) return false;
    c.setItem(slot, retype(it, want));
    return true;
  }) ?? false;
}

/**
 * 見た目違い ID をすべて元の ID に戻す（アドオンを外す前や、不具合時の復旧用）
 * @param {import("@minecraft/server").Player} player
 * @returns {number} 戻した数
 */
export function normalizeVariants(player) {
  let n = 0;
  safe("normalize", () => {
    const c = player.getComponent("minecraft:inventory")?.container;
    if (!c) return;
    for (let i = 0; i < c.size; i++) {
      const it = c.getItem(i);
      if (!it) continue;
      const lk = lookOf(it.typeId);
      if (!lk || !lk.variant) continue;
      c.setItem(i, retype(it, `${NS}:${lk.base}`));
      n++;
    }
  });
  return n;
}
