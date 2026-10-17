// @ts-check
/**
 * 多言語テキスト（RawMessage）ヘルパ。
 * 文字列はすべて RP/texts/*.lang に置き、クライアント側の言語で表示される。
 * @typedef {import("@minecraft/server").RawMessage} RawMessage
 */

/**
 * 翻訳キー
 * @param {string} key
 * @param {...(string|number|RawMessage)} args
 * @returns {RawMessage}
 */
export function t(key, ...args) {
  if (args.length === 0) return { translate: key };
  if (args.every((a) => typeof a !== "object")) {
    return { translate: key, with: args.map((a) => String(a)) };
  }
  return { translate: key, with: { rawtext: args.map((a) => (typeof a === "object" ? a : { text: String(a) })) } };
}

/**
 * 複数要素の連結
 * @param {...(string|number|RawMessage|undefined|null|false)} parts
 * @returns {RawMessage}
 */
export function raw(...parts) {
  /** @type {RawMessage[]} */
  const rt = [];
  for (const p of parts) {
    if (p === undefined || p === null || p === false) continue;
    rt.push(typeof p === "object" ? p : { text: String(p) });
  }
  return { rawtext: rt };
}

/** 武器・アイテムの名前 @param {string} id @returns {RawMessage} */
export const itemName = (id) => ({ translate: `item.arsenal.${id}.name` });

/** 説明文 @param {string} id @returns {RawMessage} */
export const descOf = (id) => ({ translate: `arsenal.desc.${id}` });

/** 改行 */
export const NL = "\n";

/** 真偽値の表示 @param {boolean} v @returns {RawMessage} */
export const onOff = (v) => (v ? { translate: "arsenal.ui.on" } : { translate: "arsenal.ui.off" });

/** 任意アイテムの名前（バニラ素材は自前の翻訳キーで確実に表示）@param {string} typeId @returns {RawMessage} */
export function anyItemName(typeId) {
  if (typeId.startsWith("arsenal:")) {
    const id = typeId.slice(8);
    if (id === "weapon_bench" || id === "ammo_press" || id === "ammo_crate") return { translate: `tile.${typeId}.name` };
    return itemName(id);
  }
  return { translate: `arsenal.vanilla.${typeId.replace("minecraft:", "")}` };
}
