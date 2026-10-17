// @ts-check
/**
 * システム間の通知（キル・死亡・命中・射撃など）。進行・経済・キルストリーク・ゲームモード・構造物が購読する。
 * 例外は購読者ごとに隔離する。
 */
import { safe } from "../util/log.js";

/**
 * @typedef {Object} KillInfo
 * @property {import("@minecraft/server").Entity} killer
 * @property {import("@minecraft/server").Entity} victim
 * @property {string} victimType
 * @property {string|null} weaponId 武器・投擲物・設置物などの ID
 * @property {boolean} head
 * @property {number} distance
 * @property {"gun"|"melee"|"explosive"|"streak"|"other"} kind
 * @property {boolean} pvp
 */

/** @type {Map<string, ((ev:any)=>void)[]>} */
const subs = new Map();

/**
 * @param {string} name kill / death / shot / hit / assist / streakUsed / medUsed / structureCleared / wave / matchEnd / bossKill / challengeDone / weaponLevel / deployed
 * @param {(ev:any)=>void} fn
 */
export function on(name, fn) {
  const l = subs.get(name) ?? [];
  l.push(fn);
  subs.set(name, l);
}

/**
 * @param {string} name @param {any} ev
 */
export function emitEvent(name, ev) {
  const l = subs.get(name);
  if (!l) return;
  for (const fn of l) safe(`event.${name}`, () => fn(ev));
}
