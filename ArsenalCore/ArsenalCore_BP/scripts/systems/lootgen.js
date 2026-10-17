// @ts-check
/**
 * 宝箱・補給箱の中身を作る（DATA.LOOT_TIERS）。構造物の宝箱・キルストリークの補給投下・ホードの報酬箱が使う。
 */
import { ItemStack } from "@minecraft/server";
import { DATA, NS, ammoItemId, defaultVariant } from "../config/constants.js";
import { initLootWeapon } from "./loot.js";
import { safe } from "../util/log.js";

const TIERS = /** @type {Record<string, any>} */ (DATA.TIERS);
const LOOT = /** @type {Record<string, any>} */ (DATA.LOOT_TIERS);

/** @param {number[]} r */
const between = (r) => r[0] + Math.floor(Math.random() * (r[1] - r[0] + 1));
/** @template T @param {T[]} a @returns {T|undefined} */
const pickOne = (a) => (a.length ? a[Math.floor(Math.random() * a.length)] : undefined);

/** @param {string|undefined} lo @param {string} hi @param {any} tbl */
function inTier(tbl, lo, hi) {
  const a = lo ? TIERS[lo].order : 0;
  const b = TIERS[hi].order;
  return Object.entries(tbl).filter(([, v]) => {
    const o = TIERS[/** @type {any} */ (v).tier ?? "common"]?.order ?? 0;
    return o >= a && o <= b;
  }).map(([id]) => id);
}

/**
 * 1 つの項目から ItemStack
 * @param {any} en
 * @returns {ItemStack|undefined}
 */
function roll(en) {
  return safe("loot.roll", () => {
    switch (en.kind) {
      case "item": {
        return new ItemStack(en.id, between(en.count ?? [1, 1]));
      }
      case "ammo": {
        // よく使う弾薬系統から（重み付け）
        const fams = ["light", "light", "medium", "medium", "medium", "heavy", "shell", "precision", "magnum", "cell"];
        const fam = pickOne(fams) ?? "medium";
        const id = ammoItemId(fam, defaultVariant(fam));
        if (!id) return undefined;
        let n = between(en.count ?? [8, 16]);
        if (fam === "precision" || fam === "cell") n = Math.max(2, Math.floor(n / 3));
        return new ItemStack(id, Math.min(64, n));
      }
      case "weapon": {
        const id = pickOne(inTier(DATA.WEAPONS, en.minTier, en.maxTier));
        if (!id) return undefined;
        const it = new ItemStack(`${NS}:${id}`, 1);
        initLootWeapon(it, true);
        return it;
      }
      case "attachment": {
        const id = pickOne(inTier(DATA.ATTACHMENTS, en.minTier, en.maxTier));
        return id ? new ItemStack(`${NS}:${id}`, 1) : undefined;
      }
      case "armor": {
        const ids = Object.entries(DATA.ARMOR).filter(([, a]) => {
          const l = /** @type {any} */ (a).level;
          return l <= (en.maxLevel ?? 3) && l >= (en.minLevel ?? 1);
        }).map(([id]) => id);
        const id = pickOne(ids);
        return id ? new ItemStack(`${NS}:${id}`, 1) : undefined;
      }
    }
    return undefined;
  });
}

/**
 * ティアの中身を抽選
 * @param {string} tier
 * @returns {ItemStack[]}
 */
export function rollLoot(tier) {
  const t = LOOT[tier] ?? LOOT.common;
  const out = [];
  const total = t.entries.reduce((/** @type {number} */ a, /** @type {any} */ e) => a + e.weight, 0);
  const n = between(t.rolls);
  for (let i = 0; i < n; i++) {
    let r = Math.random() * total;
    const en = t.entries.find((/** @type {any} */ e) => (r -= e.weight) < 0) ?? t.entries[0];
    const it = roll(en);
    if (it) out.push(it);
  }
  if (t.guaranteed) {
    const it = roll(t.guaranteed);
    if (it) out.push(it);
  }
  return out;
}

/**
 * 容器へ詰める（空いているスロットへばらけて入れる）
 * @param {import("@minecraft/server").Container} c @param {ItemStack[]} items
 */
export function fillContainer(c, items) {
  const free = [];
  for (let i = 0; i < c.size; i++) if (!c.getItem(i)) free.push(i);
  for (const it of items) {
    if (!free.length) break;
    const k = Math.floor(Math.random() * free.length);
    const slot = free.splice(k, 1)[0];
    c.setItem(slot, it);
  }
}
