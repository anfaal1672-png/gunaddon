// ARSENAL CORE データ定義（tools/data/）。ランタイムにはビルド時に 1 ファイル（BP/scripts/config/weapons.data.js）へまとめて出力する。
// 全武器（カテゴリ順。順序は一覧表示の順番になる）
import { HANDGUN } from "./handgun.js";
import { MACHINE_PISTOL } from "./machine_pistol.js";
import { SMG } from "./smg.js";
import { CARBINE } from "./carbine.js";
import { ASSAULT } from "./assault.js";
import { BATTLE } from "./battle.js";
import { DMR } from "./dmr.js";
import { SNIPER } from "./sniper.js";
import { SHOTGUN } from "./shotgun.js";
import { LMG } from "./lmg.js";
import { HEAVY } from "./heavy.js";
import { LAUNCHER } from "./launcher.js";
import { SPECIAL } from "./special.js";
export { MELEE } from "./melee.js";

/** 弾丸を撃つ（弾薬改造・トリガー・銃身の枠を持てる）弾薬系統 */
const BULLET_AMMO = new Set(["light", "medium", "heavy", "magnum", "precision", "antimat", "shell"]);
/** 弾丸以外を撃つ射撃方式 */
const NON_BULLET_FIRE = new Set(["gl40", "rocket", "seeker", "flare", "grapple", "flame", "beam", "gravity", "sonic", "mortar", "needle", "plasma", "rail", "coil", "arc", "cryo", "pulse"]);

/**
 * 2.0 で増えた枠（銃身・トリガー・弾薬改造）を、武器ごとに書かなくても付くようにする。
 *   銃身 … 銃口の枠を持つ弾丸系の銃 / トリガー … 弾丸系の銃 / 弾薬改造 … 散弾以外の弾丸系の銃
 * @param {Record<string, any>} table
 */
function withAutoSlots(table) {
  /** @type {Record<string, any>} */
  const out = {};
  for (const [id, w] of Object.entries(table)) {
    const bullet = BULLET_AMMO.has(w.ammo) && !NON_BULLET_FIRE.has(w.fire ?? "hitscan");
    const slots = [...w.slots];
    if (bullet && !w.noAutoSlots) {
      if (slots.includes("muzzle") && !slots.includes("barrel")) slots.push("barrel");
      if (!slots.includes("trigger")) slots.push("trigger");
      if (w.ammo !== "shell" && !slots.includes("ammo")) slots.push("ammo");
    }
    out[id] = { ...w, slots };
  }
  return out;
}

export const WEAPONS = withAutoSlots({
  ...HANDGUN,
  ...MACHINE_PISTOL,
  ...SMG,
  ...CARBINE,
  ...ASSAULT,
  ...BATTLE,
  ...DMR,
  ...SNIPER,
  ...SHOTGUN,
  ...LMG,
  ...HEAVY,
  ...LAUNCHER,
  ...SPECIAL,
});
