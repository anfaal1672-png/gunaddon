// @ts-check
/**
 * 構造物ルート・敵ドロップの武器を「見つけた瞬間」に初期化する。
 *   ・チェストを開けたとき、未初期化の武器に装弾（ランダム）と、ティアに応じたアタッチメントを付与
 *   ・レイダーが落とした武器も同様
 * ルートテーブルそのものは BP/loot_tables（バニラ表＋ARSENAL のプール）で定義している。
 */
import { world, system, Player } from "@minecraft/server";
import { DATA } from "../config/constants.js";
import { canAttach, computeStats, writeLore, PROP, W } from "../core/weaponState.js";
import { weaponIdOf, defaultVariant, enemyIdOf } from "../config/constants.js";
import { safe } from "../util/log.js";

/** ARSENAL の敵（銃を落とす）か @param {import("@minecraft/server").Entity} e */
const isEnemy = (e) => !(e instanceof Player) && !!enemyIdOf(e.typeId);

const EXTRA_BY_TIER = { common: 0.25, uncommon: 0.5, rare: 0.85, legendary: 1.0 };

/**
 * 未初期化の武器 ItemStack を初期化（戻り値：変更したか）
 * @param {import("@minecraft/server").ItemStack} item @param {boolean} lootBonus
 */
export function initLootWeapon(item, lootBonus) {
  const wid = weaponIdOf(item.typeId);
  if (!wid) return false;
  if (item.getDynamicProperty(PROP.init) === true) return false;
  const w = W(wid);
  const ammoType = w.defaultVariant ?? defaultVariant(w.ammo);
  /** @type {Record<string,string>} */
  const att = {};
  if (lootBonus) {
    const chance = /** @type {any} */ (EXTRA_BY_TIER)[w.tier] ?? 0.3;
    for (const slot of w.slots) {
      if (Math.random() > chance * 0.6) continue;
      const opts = Object.keys(DATA.ATTACHMENTS).filter((a) => /** @type {any} */ (DATA.ATTACHMENTS)[a].slot === slot && canAttach(wid, a));
      if (opts.length) att[slot] = opts[Math.floor(Math.random() * opts.length)];
    }
  }
  const st = computeStats(wid, att, ammoType);
  const ammo = lootBonus ? Math.floor(st.mag * (0.2 + Math.random() * 0.8)) : st.mag;
  item.setDynamicProperties({ [PROP.init]: true, [PROP.v]: DATA.ITEM_FORMAT, [PROP.ammo]: ammo, [PROP.mode]: st.modes[0], [PROP.att]: JSON.stringify(att), [PROP.at]: ammoType, [PROP.ub]: 0 });
  writeLore(item, wid, att, ammoType);
  return true;
}

/** @param {import("@minecraft/server").Container} c */
function scanContainer(c) {
  for (let i = 0; i < c.size; i++) {
    const it = c.getItem(i);
    if (!it || !weaponIdOf(it.typeId)) continue;
    if (initLootWeapon(it, true)) c.setItem(i, it);
  }
}

export function attachLoot() {
  world.afterEvents.blockContainerOpened.subscribe((ev) => {
    const block = ev.block;
    const src = ev.openSource.entity;
    if (!(src instanceof Player)) return;
    system.runTimeout(() => safe("loot.scan", () => {
      if (!block.isValid) return;
      const c = block.getComponent("minecraft:inventory")?.container;
      if (c) scanContainer(c);
    }), 1);
  });
  // レイダーのドロップ
  world.afterEvents.entityDie.subscribe((ev) => {
    const e = ev.deadEntity;
    if (!isEnemy(e)) return;
    const loc = e.location;
    const dim = e.dimension;
    system.runTimeout(() => safe("loot.drop", () => {
      for (const ie of dim.getEntities({ location: loc, maxDistance: 3, type: "minecraft:item" })) {
        const comp = ie.getComponent("minecraft:item");
        const it = comp?.itemStack;
        if (!it || !weaponIdOf(it.typeId)) continue;
        if (initLootWeapon(it, true)) {
          const p = ie.location;
          ie.remove();
          dim.spawnItem(it, p);
        }
      }
    }), 2);
  });
}
