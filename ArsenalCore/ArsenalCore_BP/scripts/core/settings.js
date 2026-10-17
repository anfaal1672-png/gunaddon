// @ts-check
/**
 * ワールド設定（全員共通・OP のみ変更可）と個人設定（プレイヤーごと）
 */
import { world, PlayerPermissionLevel, CommandPermissionLevel } from "@minecraft/server";
import { DEFAULT_WORLD_SETTINGS, DEFAULT_PLAYER_SETTINGS } from "../config/weapons.data.js";
import { safe } from "../util/log.js";

const WORLD_KEY = "arsenal:world_settings";
const PLAYER_KEY = "arsenal:prefs";

/** @typedef {typeof DEFAULT_WORLD_SETTINGS} WorldSettings */
/** @typedef {typeof DEFAULT_PLAYER_SETTINGS} PlayerSettings */

/** @type {WorldSettings | null} */
let worldCache = null;
/** @type {Map<string, PlayerSettings>} */
const prefCache = new Map();

/** @returns {WorldSettings} */
export function W() {
  if (worldCache) return worldCache;
  /** @type {WorldSettings} */
  let s = { ...DEFAULT_WORLD_SETTINGS };
  let raw;
  try {
    raw = world.getDynamicProperty(WORLD_KEY);
  } catch (e) {
    // 早期実行（読み込み中・startup）はまだ読めない。既定値を返すが、キャッシュはしない
    // （キャッシュすると、保存済みの設定がそのセッションのあいだ無視される）
    if (!String(e).includes("early execution")) safe("settings.loadWorld", () => { throw e; });
    return s;
  }
  safe("settings.parseWorld", () => {
    if (typeof raw === "string") s = { ...s, ...JSON.parse(raw) };
  });
  worldCache = s;
  return s;
}

/** @param {Partial<WorldSettings>} patch */
export function setWorld(patch) {
  const s = { ...W(), ...patch };
  worldCache = s;
  safe("settings.saveWorld", () => world.setDynamicProperty(WORLD_KEY, JSON.stringify(s)));
}

/** @param {import("@minecraft/server").Player} player @returns {PlayerSettings} */
export function P(player) {
  const c = prefCache.get(player.id);
  if (c) return c;
  /** @type {PlayerSettings} */
  let s = { ...DEFAULT_PLAYER_SETTINGS };
  safe("settings.loadPlayer", () => {
    const raw = player.getDynamicProperty(PLAYER_KEY);
    if (typeof raw === "string") s = { ...s, ...JSON.parse(raw) };
  });
  prefCache.set(player.id, s);
  return s;
}

/** @param {import("@minecraft/server").Player} player @param {Partial<PlayerSettings>} patch */
export function setPrefs(player, patch) {
  const s = { ...P(player), ...patch };
  prefCache.set(player.id, s);
  safe("settings.savePlayer", () => player.setDynamicProperty(PLAYER_KEY, JSON.stringify(s)));
}

/** @param {string} playerId */
export function forgetPrefs(playerId) {
  prefCache.delete(playerId);
}

/** オペレーター判定 @param {import("@minecraft/server").Player} player */
export function isOperator(player) {
  return (
    safe("settings.isOp", () => player.playerPermissionLevel === PlayerPermissionLevel.Operator || player.commandPermissionLevel >= CommandPermissionLevel.GameDirectors) ?? false
  );
}

/** 爆発でブロックを壊すか */
export function explosionBreaksBlocks() {
  const m = W().explosionGrief;
  if (m === "on") return true;
  if (m === "off") return false;
  return safe("settings.mobGriefing", () => world.gameRules.mobGriefing) ?? true;
}

/** 設定の効果音音量倍率 @param {import("@minecraft/server").Player} player */
export function vol(player) {
  return P(player).volume;
}
