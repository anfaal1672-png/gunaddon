// @ts-check
/**
 * インベントリ操作（弾薬・素材の数え上げと消費、アイテム付与）
 */
import { ItemStack, GameMode } from "@minecraft/server";
import { safe } from "../util/log.js";

/** @param {import("@minecraft/server").Player} player */
function container(player) {
  return player.getComponent("minecraft:inventory")?.container;
}

/** 所持数 @param {import("@minecraft/server").Player} player @param {string} typeId */
export function countItem(player, typeId) {
  return safe("countItem", () => {
    const c = container(player);
    if (!c) return 0;
    let n = 0;
    for (let i = 0; i < c.size; i++) {
      const it = c.getItem(i);
      if (it && it.typeId === typeId) n += it.amount;
    }
    return n;
  }) ?? 0;
}

/**
 * 消費（足りなければ消費しない）
 * @param {import("@minecraft/server").Player} player @param {string} typeId @param {number} amount
 * @returns {boolean}
 */
export function consumeItem(player, typeId, amount) {
  if (amount <= 0) return true;
  return safe("consumeItem", () => {
    const c = container(player);
    if (!c) return false;
    if (countItem(player, typeId) < amount) return false;
    let left = amount;
    for (let i = c.size - 1; i >= 0 && left > 0; i--) {
      const it = c.getItem(i);
      if (!it || it.typeId !== typeId) continue;
      const take = Math.min(left, it.amount);
      left -= take;
      if (take >= it.amount) c.setItem(i, undefined);
      else {
        it.amount -= take;
        c.setItem(i, it);
      }
    }
    return left <= 0;
  }) ?? false;
}

/**
 * 最大 amount 個まで消費して、実際に消費した数を返す
 * @param {import("@minecraft/server").Player} player @param {string} typeId @param {number} amount
 */
export function takeUpTo(player, typeId, amount) {
  const have = countItem(player, typeId);
  const n = Math.min(have, amount);
  if (n > 0 && consumeItem(player, typeId, n)) return n;
  return 0;
}

/**
 * アイテムを渡す（あふれたら足元に落とす）
 * @param {import("@minecraft/server").Player} player @param {string} typeId @param {number} amount
 */
export function giveItem(player, typeId, amount = 1) {
  safe("giveItem", () => {
    const c = container(player);
    let left = amount;
    while (left > 0) {
      const probe = new ItemStack(typeId, 1);
      const n = Math.min(left, probe.maxAmount);
      const stack = new ItemStack(typeId, n);
      left -= n;
      const rest = c ? c.addItem(stack) : stack;
      if (rest) player.dimension.spawnItem(rest, player.location);
    }
  });
}

/** @param {import("@minecraft/server").Player} player @param {ItemStack} stack */
export function giveStack(player, stack) {
  safe("giveStack", () => {
    const c = container(player);
    const rest = c ? c.addItem(stack) : stack;
    if (rest) player.dimension.spawnItem(rest, player.location);
  });
}

/**
 * レシピの素材を持っているか
 * @param {import("@minecraft/server").Player} player @param {Record<string, number>} cost @param {number} times
 */
export function hasCost(player, cost, times = 1) {
  if (isCreative(player)) return true;
  return Object.entries(cost).every(([k, v]) => countItem(player, k) >= v * times);
}

/**
 * 素材を消費
 * @param {import("@minecraft/server").Player} player @param {Record<string, number>} cost @param {number} times
 */
export function payCost(player, cost, times = 1) {
  if (isCreative(player)) return true;
  if (!hasCost(player, cost, times)) return false;
  for (const [k, v] of Object.entries(cost)) consumeItem(player, k, v * times);
  return true;
}

/** @param {import("@minecraft/server").Player} player */
export function isCreative(player) {
  return safe("isCreative", () => player.getGameMode() === GameMode.Creative) ?? false;
}
