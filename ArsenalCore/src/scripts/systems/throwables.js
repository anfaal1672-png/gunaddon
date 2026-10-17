// @ts-check
/**
 * 投擲物の操作：使用開始でピンを抜き（フラグはクッキング開始）、離して投げる。
 * スニーク中は放物線の予測線を表示。地雷はブロックに向けて使用して設置。
 */
import { system, GameMode } from "@minecraft/server";
import { DATA, NS } from "../config/constants.js";
import { S } from "../core/state.js";
import { P } from "../core/settings.js";
import { consumeItem, countItem } from "../core/inventory.js";
import { throwItem, explodeInHand, previewTrajectory, placeMine, detonateC4, countC4 } from "./projectiles.js";
import { playNear, playTo } from "../fx/effects.js";
import { renderThrowHud } from "../ui/hud.js";
import { t } from "../util/i18n.js";
import { safe } from "../util/log.js";

/**
 * 使用開始
 * @param {import("@minecraft/server").Player} player @param {string} tid
 */
export function beginThrow(player, tid) {
  const th = /** @type {any} */ (DATA.THROWABLES)[tid];
  if (!th || th.kind === "mine") return;
  const s = S(player);
  if (s.throwing) return;
  s.throwing = { id: tid, start: system.currentTick };
  s.hudDirty = true;
  if (["frag", "impact", "smoke", "flash", "sticky"].includes(th.kind)) playNear(player.dimension, player.location, "arsenal.fx.grenade_pin", { range: 12 });
  if (th.kind === "molotov") playNear(player.dimension, player.location, "arsenal.fx.fire", { range: 8, volume: 0.3, pitch: 1.6 });
}

/**
 * 離して投擲
 * @param {import("@minecraft/server").Player} player
 */
export function releaseThrow(player) {
  const s = S(player);
  const th = s.throwing;
  if (!th) return;
  s.throwing = null;
  s.hudDirty = true;
  const held = system.currentTick - th.start;
  const creative = safe("gm", () => player.getGameMode() === GameMode.Creative) ?? false;
  if (!creative && !consumeItem(player, `${NS}:${th.id}`, 1)) return;
  safe("throwAnim", () => player.playAnimation("animation.arsenal.throw", { controller: "arsenal_reload", blendOutTime: 0.1 }));
  throwItem(player, th.id, held);
  playNear(player.dimension, player.location, "arsenal.mech.equip", { range: 12, pitch: 1.4 });
}

/**
 * 毎 tick：投擲物を持っているとき
 * @param {import("@minecraft/server").Player} player @param {string} tid
 */
export function tickThrowable(player, tid) {
  const s = S(player);
  const now = system.currentTick;
  const th = /** @type {any} */ (DATA.THROWABLES)[tid];
  // クッキングしすぎ
  if (s.throwing && th.cook && th.fuse > 0 && now - s.throwing.start >= th.fuse) {
    s.throwing = null;
    const creative = safe("gm", () => player.getGameMode() === GameMode.Creative) ?? false;
    if (creative || consumeItem(player, `${NS}:${tid}`, 1)) explodeInHand(player, tid);
    return;
  }
  if (s.throwing && th.cook && (now - s.throwing.start) % 20 === 0 && now > s.throwing.start) {
    playTo(player, "arsenal.fx.c4_beep", { pitch: 0.8, volume: 0.4 });
  }
  if (player.isSneaking && P(player).trajectory && now - s.trajTick >= 3) {
    s.trajTick = now;
    previewTrajectory(player, tid);
  }
  renderThrowHud(player, s, tid, countItem(player, `${NS}:${tid}`));
}

/**
 * 起爆装置
 * @param {import("@minecraft/server").Player} player
 */
export function useDetonator(player) {
  const n = countC4(player.id);
  if (n === 0) {
    player.sendMessage(t("arsenal.ui.no_c4"));
    playTo(player, "arsenal.mech.dry_fire");
    return;
  }
  playTo(player, "arsenal.fx.c4_beep", { pitch: 1.4 });
  const k = detonateC4(player);
  player.onScreenDisplay.setActionBar(t("arsenal.ui.detonated", String(k)));
}

/**
 * 地雷の設置（ブロックの上面に対して使用）
 * @param {import("@minecraft/server").Player} player @param {import("@minecraft/server").Block} block @param {string} face
 */
export function tryPlaceMine(player, block, face) {
  if (face !== "Up") return false;
  const above = block.above();
  if (!above || !above.isAir) return false;
  const creative = safe("gm", () => player.getGameMode() === GameMode.Creative) ?? false;
  if (!creative && !consumeItem(player, `${NS}:landmine`, 1)) return false;
  placeMine(player, { x: block.location.x + 0.5, y: block.location.y + 1.02, z: block.location.z + 0.5 });
  return true;
}
