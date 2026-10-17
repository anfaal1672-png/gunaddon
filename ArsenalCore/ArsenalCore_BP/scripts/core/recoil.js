// @ts-check
/**
 * 拡散（ブルーム）と反動
 *   ・拡散：腰だめ/ADS を ADS 進行度で補間し、移動・空中・連射で広がる
 *   ・反動：画面揺れ（カメラシェイク）＋ブルーム＋（設定で）視点の跳ね上がり
 */
import { system, CameraShakeType } from "@minecraft/server";
import { P } from "./settings.js";
import { kickClass } from "../config/constants.js";
import { lerp, clamp, rand } from "../util/math.js";
import { suppressionSpread } from "./suppression.js";
import { safe } from "../util/log.js";

/**
 * 現在の拡散角（度）
 * @param {import("@minecraft/server").Player} player @param {import("./state.js").PlayerState} s @param {any} st
 */
export function spreadNow(player, s, st) {
  let sp = lerp(st.hip, st.ads, s.adsLevel);
  const v = player.getVelocity();
  const hs = Math.sqrt(v.x * v.x + v.z * v.z);
  if (hs > 0.03) sp += st.moveSpread * clamp(hs / 0.22, 0, 1) * (1 - 0.55 * s.adsLevel);
  if (!player.isOnGround && !player.isFlying) sp += st.moveSpread * 1.6;
  if (player.isSneaking) sp *= st.bipod ? 0.5 : 0.88;
  sp += s.bloom * (1 - 0.45 * s.adsLevel);
  // 息止め中は照準が安定する
  if (s.breathUntil > system.currentTick && s.adsLevel > 0.5) sp *= 0.35;
  sp += suppressionSpread(s);
  // 腕を撃たれた：照準がぶれる
  if (s.armHitUntil > system.currentTick) sp = sp * 1.5 + 0.6;
  return Math.max(0, sp);
}

/**
 * 反動の適用
 * @param {import("@minecraft/server").Player} player @param {import("./state.js").PlayerState} s @param {any} st @param {number} [mult]
 */
export function applyRecoil(player, s, st, mult = 1) {
  const prefs = P(player);
  let k = mult;
  if (s.adsLevel > 0.5) k *= 0.8 * (st.adsRecoil ?? 1);
  if (player.isSneaking) k *= st.bipod ? 0.35 : 0.85;
  if (s.armHitUntil > system.currentTick) k *= 1.3;
  s.bloom = Math.min(st.bloomMax, s.bloom + st.bloom * k);
  const v = st.recoilV * k;
  const h = st.recoilH * k;
  if (prefs.aimKick !== "off") {
    const scale = prefs.aimKick === "full" ? 1.0 : 0.45;
    safe("recoil.rotate", () => {
      const r = player.getRotation();
      const nx = clamp(r.x - v * scale, -78, 89.9);
      player.setRotation({ x: nx, y: r.y + rand(-h, h) * scale });
      // 縦反動の 75% は撃ち止めると自動で戻る
      s.kickDebt += (r.x - nx) * 0.75;
    });
  }
  if (prefs.cameraShake) {
    // 倍率スコープでは画面の揺れが拡大されて見えるので、ごく弱くする
    const zoomed = s.adsLevel > 0.5 && (st.fov ?? 70) < 50;
    const amp = zoomed ? 0.2 : s.adsLevel > 0.5 ? 0.6 : 1;
    safe("recoil.shake", () => player.camera.addShake({ intensity: clamp(st.shake * k * amp, 0.003, 0.4), duration: 0.06 + Math.min(0.12, st.recoilV * 0.015), type: CameraShakeType.Positional }));
  }
  const now = system.currentTick;
  if (now - s.lastKick >= 2) {
    s.lastKick = now;
    safe("recoil.anim", () => player.playAnimation(`animation.arsenal.kick.${kickClass(st.recoilV)}`, { controller: "arsenal_kick", blendOutTime: 0.05 }));
  }
}

/**
 * 撃ち止めたときの視点の戻り（反動回復）
 * @param {import("@minecraft/server").Player} player @param {import("./state.js").PlayerState} s
 */
export function tickRecoil(player, s) {
  if (s.kickDebt <= 0.01) {
    s.kickDebt = 0;
    return;
  }
  if (system.currentTick - s.lastShotTick < 3) return;
  const step = Math.min(s.kickDebt, 0.35 + s.kickDebt * 0.18);
  s.kickDebt -= step;
  safe("recoil.recover", () => {
    const r = player.getRotation();
    player.setRotation({ x: clamp(r.x + step, -89.9, 89.9), y: r.y });
  });
}

/** 毎 tick のブルーム回復 @param {import("./state.js").PlayerState} s @param {any} st */
export function recoverBloom(s, st) {
  if (s.bloom > 0) s.bloom = Math.max(0, s.bloom - st.recover * (s.holding ? 0.5 : 1));
}
