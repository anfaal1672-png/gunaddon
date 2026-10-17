// @ts-check
/**
 * 制圧：敵の弾が自分の周囲 2 ブロック以内を通過すると、画面の端が暗くなり（HUD 2.0）、拡散がわずかに増える。
 *  ・拡散の増加はワールド設定「制圧」、画面効果は個人設定「制圧の画面効果」で OFF にできる
 */
import { Player } from "@minecraft/server";
import { S } from "./state.js";
import { W as WS } from "./settings.js";
import { setSuppressHook } from "./ballistics.js";
import { sameTeam } from "./damage.js";

export function attachSuppression() {
  setSuppressHook((p, shooter, miss) => {
    if (!WS().suppression) return;
    if (shooter instanceof Player && (sameTeam(shooter, p) || shooter.id === p.id)) return;
    const s = S(p);
    s.sup = Math.min(3, s.sup + 0.5 + (2.2 - miss) * 0.5);
    s.hudDirty = true;
  });
}

/**
 * 毎 tick の減衰
 * @param {import("./state.js").PlayerState} s
 */
export function tickSuppression(s) {
  if (s.sup > 0) {
    const before = Math.ceil(s.sup);
    s.sup = Math.max(0, s.sup - 0.04);
    if (Math.ceil(s.sup) !== before) s.hudDirty = true;
  }
}

/** 拡散の増分（度） @param {import("./state.js").PlayerState} s */
export function suppressionSpread(s) {
  return WS().suppression ? s.sup * 0.45 : 0;
}
