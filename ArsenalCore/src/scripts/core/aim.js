// @ts-check
/**
 * ADS（覗き込み）、ズーム、移動速度、保持ポーズ、スコープの揺れと息止め、
 * レーザー・フラッシュライト、ロックオン
 */
import { system, world, EasingType, MolangVariableMap } from "@minecraft/server";
import { P, W as WS } from "./settings.js";
import { emit, playTo } from "../fx/effects.js";
import { SCOPED_OPTICS, resetScopeMark, effectiveOptic } from "../ui/hud.js";
import { add, mul, len, sub, norm, dot, loadedReach, hitPoint, dist } from "../util/math.js";
import { armorMove, riotShieldMove } from "./armor.js";
import { DATA } from "../config/constants.js";
import { fp_step } from "../util/fpstep.js";
import { safe } from "../util/log.js";
import { tickPathLock, clearPathLock } from "./pathlock.js";
import { tickSmart, clearSmart } from "./fire3.js";
import { canDamage } from "./damage.js";

const BASE_SPEED = 0.1;

/**
 * FOV を戻す
 * @param {import("@minecraft/server").Player} player @param {number} easeTime
 */
export function resetFov(player, easeTime = 0.12) {
  safe("fov.reset", () => {
    try {
      player.runCommand(`camera @s fov_clear ${easeTime.toFixed(2)} out_quad`);
    } catch {
      player.camera.setFov();
    }
  });
}

/**
 * @param {import("@minecraft/server").Player} player @param {number} fov @param {number} easeTime
 */
function setFov(player, fov, easeTime) {
  safe("fov.set", () => player.camera.setFov({ fov, easeOptions: { easeTime, easeType: EasingType.OutQuad } }));
}

/**
 * 移動速度
 * @param {import("@minecraft/server").Player} player @param {number} mul
 */
export function applyMove(player, mul) {
  safe("move", () => {
    const m = player.getComponent("minecraft:movement");
    if (!m) return;
    const v = BASE_SPEED * mul;
    if (Math.abs(m.currentValue - v) > 1e-4) m.setCurrentValue(v);
  });
}

/** @param {import("@minecraft/server").Player} player */
export function resetMove(player) {
  safe("move.reset", () => player.getComponent("minecraft:movement")?.resetToDefaultValue());
}

/**
 * 走っている間の構え：一人称は銃を左下へ傾けて手前に寄せ、三人称は銃を体の前に斜めに抱える（銃の種類ごと）。走るのをやめる・銃を持ち替えると
 * stopExpression で解け、blendOutTime で元の構えへ戻る。撃った直後とリロード中は構えない。
 * 構えを解いたら、銃が重いほど撃てるまで時間がかかる（st.ready tick）
 * @param {import("@minecraft/server").Player} player @param {import("./state.js").PlayerState} s @param {any} st @param {number} now
 */
function tickSprintPose(player, s, st, now) {
  const want = player.isSprinting && st.cat !== "melee" && !s.reload && !s.holding && !s.tapFiring && now - s.lastShotTick > 6;
  if (want && !s.sprintPose) {
    s.sprintPose = true;
    // 銃の種類ごとの構え（長物は手前へ大きく引き、拳銃は下へ寄せる。tools/riggen.py の SPRINT_FP）
    safe("sprint.pose", () => player.playAnimation(`animation.arsenal.sprint.${st.cat}`, {
      controller: "arsenal_sprint",
      blendOutTime: 0.18,
      stopExpression: "!q.is_sprinting || !q.equipped_item_any_tag('slot.weapon.mainhand', 'arsenal:firearm')",
    }));
  } else if (!want && s.sprintPose) {
    s.sprintPose = false;
    s.readyAt = now + (st.ready ?? 0);
    if (player.isSprinting) safe("sprint.stop", () => player.playAnimation("animation.arsenal.none", { controller: "arsenal_sprint", blendOutTime: 0.1 }));
  }
}

/**
 * 保持ポーズ（三人称の構え・一人称の ADS 腕位置）
 * @param {import("@minecraft/server").Player} player @param {import("./state.js").PlayerState} s
 */
export function ensurePose(player, s) {
  const now = system.currentTick;
  if (!s.weaponId) return;
  if (s.poseWeapon === s.weaponId && now - s.poseTick < 100) return;
  s.poseWeapon = s.weaponId;
  s.poseTick = now;
  safe("pose", () => player.playAnimation(`animation.arsenal.hold.${s.weaponId}`, {
    controller: "arsenal_hold",
    blendOutTime: 0.2,
    stopExpression: `!q.equipped_item_any_tag('slot.weapon.mainhand', 'arsenal:w_${s.weaponId}')`,
  }));
}

/**
 * ADS の構え（一人称）。倍率スコープは銃を画面外へ下ろし、それ以外はアイアンサイト／ドットを
 * 画面中央に合わせる。スニークに関係なくスクリプトの ADS 状態で切り替えるので「切り替え」式でも効く。
 * @param {import("@minecraft/server").Player} player @param {import("./state.js").PlayerState} s @param {any} st
 */
function playAds(player, s, st) {
  const optic = effectiveOptic(s, st);
  const scoped = SCOPED_OPTICS.has(optic);
  const base = /** @type {any} */ (DATA.LOOK)[s.weaponId ?? ""]?.base ?? 0;
  const look = s.cantedOn ? base : s.look;
  const anim = scoped ? "animation.arsenal.ads_scope" : look === base ? `animation.arsenal.ads.${s.weaponId}` : `animation.arsenal.ads.${s.weaponId}.o${look}`;
  if (s.adsAnim === anim) return;
  s.adsAnim = anim;
  const tag = scoped ? "arsenal:firearm" : `arsenal:w_${s.weaponId}`;
  safe("ads.anim", () => player.playAnimation(anim, {
    controller: "arsenal_ads",
    blendOutTime: 0.12,
    stopExpression: `!q.equipped_item_any_tag('slot.weapon.mainhand', '${tag}')`,
  }));
}

/**
 * ADS の構えを解く
 * @param {import("@minecraft/server").Player} player @param {import("./state.js").PlayerState} s
 */
function stopAds(player, s) {
  if (!s.adsAnim) return;
  s.adsAnim = "";
  safe("ads.stop", () => player.playAnimation("animation.arsenal.none", { controller: "arsenal_ads", blendOutTime: 0.0 }));
}

/**
 * 武器を下ろしたときの後始末
 * @param {import("@minecraft/server").Player} player @param {import("./state.js").PlayerState} s
 */
export function clearAim(player, s) {
  if (s.fovApplied) resetFov(player);
  s.fovApplied = false;
  if (s.nvApplied) removeShortEffect(player, "night_vision", 420);
  s.nvApplied = false;
  if (s.slowApplied) removeShortEffect(player, "slowness", 60);
  s.slowApplied = false;
  s.ads = false;
  s.adsLevel = 0;
  s.adsToggle = false;
  s.breathUntil = 0;
  s.lockTarget = null;
  s.lockTicks = 0;
  clearPathLock(player);
  s.poseWeapon = null;
  s.variableHigh = false;
  s.cantedOn = false;
  s.rangeDist = -1;
  if (s.autoFiring) {
    s.autoFiring = false;
    s.holding = false;
  }
  stopAds(player, s);
  resetScopeMark(player, s);
  clearLight(player, s);
  safe("stopShake", () => player.camera.stopShaking());
}

/**
 * @param {import("@minecraft/server").Player} player @param {string} id @param {number} maxDur
 */
function removeShortEffect(player, id, maxDur) {
  safe("rmEffect", () => {
    const e = player.getEffect(id);
    if (e && e.duration <= maxDur) player.removeEffect(id);
  });
}

/**
 * 毎 tick：ADS の状態更新
 * @param {import("@minecraft/server").Player} player @param {import("./state.js").PlayerState} s @param {any} st
 */
export function tickAim(player, s, st) {
  const prefs = P(player);
  const now = system.currentTick;
  const want = (prefs.adsMode === "toggle" ? s.adsToggle : player.isSneaking) && !(s.reload && s.reload.type === "mag") && !player.isSprinting;
  const step = 1 / Math.max(1, st.adsTime);
  s.adsLevel = want ? Math.min(1, s.adsLevel + step) : Math.max(0, s.adsLevel - step * 1.5);
  tickSprintPose(player, s, st, now);
  const fov = effectiveFov(s, st);
  if (want !== s.ads) {
    s.ads = want;
    s.hudDirty = true;
    if (want) {
      if (prefs.fovZoom) {
        setFov(player, fov, st.adsTime / 20);
        s.fovApplied = true;
        s.fovValue = fov;
      }
      if (st.nightVision) {
        safe("nv", () => player.addEffect("night_vision", 400, { amplifier: 0, showParticles: false }));
        s.nvApplied = true;
      }
      s.lockTarget = null;
      s.lockTicks = 0;
      clearPathLock(player);
      clearSmart(player.id);
      playAds(player, s, st);
    } else {
      stopAds(player, s);
      if (s.fovApplied) resetFov(player, 0.12);
      s.fovApplied = false;
      if (s.nvApplied) removeShortEffect(player, "night_vision", 420);
      s.nvApplied = false;
      if (s.slowApplied) removeShortEffect(player, "slowness", 60);
      s.slowApplied = false;
      if (s.breathUntil > now) s.breathUntil = now;
      s.lockTarget = null;
      s.lockTicks = 0;
      clearPathLock(player);
      clearSmart(player.id);
      safe("stopShake", () => player.camera.stopShaking());
    }
  } else if (want && s.fovApplied && s.fovValue !== fov && prefs.fovZoom) {
    setFov(player, fov, 0.1);
    s.fovValue = fov;
  }
  // 覗いたままアタッチメントを替えたとき
  if (s.ads) playAds(player, s, st);
  if (s.ads) {
    if (st.nightVision && now % 200 === 0) safe("nv", () => player.addEffect("night_vision", 400, { amplifier: 0, showParticles: false }));
    if (st.zoomBoost > 0 && now % 20 === 0 && prefs.fovZoom) {
      safe("zoomSlow", () => player.addEffect("slowness", 40, { amplifier: st.zoomBoost, showParticles: false }));
      s.slowApplied = true;
    }
    const scoped = SCOPED_OPTICS.has(effectiveOptic(s, st));
    if (st.rangefinder && s.adsLevel >= 1 && now % 5 === 0) rangefind(player, s);
    if (prefs.aimAssist !== "off" && s.adsLevel >= 0.5) {
      s.assistTick = now;
      aimAssist(player, s, st, prefs.aimAssist === "strong" ? ASSIST.strong : ASSIST.light);
    }
    if (scoped && s.adsLevel >= 1) {
      // 以前はカメラシェイクで「揺れ」を出していたが、高倍率では視点が激しく震えて狙えないため廃止。
      // 息止め（ジャンプ）は拡散を減らす効果として残す
      if (s.breathUntil > 0 && now === s.breathUntil) {
        playTo(player, "arsenal.fx.breath_out", { volume: 0.7 });
        s.breathCooldown = now + 50;
      }
      // スコープの反射光（ほかのプレイヤーから見える）
      if (now - s.glintTick >= 20) {
        s.glintTick = now;
        const eye = player.getHeadLocation();
        emit(player.dimension, "arsenal:scope_glint", add(eye, mul(player.getViewDirection(), 0.7)), undefined, { range: 160, except: player.id });
      }
    }
    if (st.fire === "pathfinder") tickPathLock(player, s, st);
    else if (st.fire === "smart") safe("smart", () => tickSmart(player, st));
    else if (st.lockTicks > 0) tickLock(player, s, st);
  }
  if (!s.ads && s.rangeDist >= 0) s.rangeDist = -1;
  // 自動射撃（スマホ向け補助）：照準が敵に重なったら撃つ
  if (prefs.autoFire) tickAutoFire(player, s, st);
  // 移動速度（武器の重さ × 防具 × 盾）
  const mv = st.move * armorMove(player) * riotShieldMove(player);
  if (!s.moveApplied || Math.abs(s.moveValue - mv) > 1e-4) {
    applyMove(player, mv);
    s.moveApplied = true;
    s.moveValue = mv;
  }
  ensurePose(player, s);
  ensureFpOffset(player, s);
  if (st.laser && now - s.laserTick >= 2) {
    s.laserTick = now;
    laser(player);
  }
  if (st.flashlight && WS().flashlightBlocks && now % 4 === 0) flashlight(player, s);
  else if (!st.flashlight && s.lightPos) clearLight(player, s);
}

/**
 * 実効の視野角：可変倍率（高倍率側）・キャンテッドアイアン
 * @param {import("./state.js").PlayerState} s @param {any} st
 */
function effectiveFov(s, st) {
  if (s.cantedOn) return 62;
  if (st.variable) return s.variableHigh ? st.altFov ?? 34 : st.fov;
  return st.fov;
}

/**
 * 一人称の位置調整（個人設定・調整モード）
 * @param {import("@minecraft/server").Player} player @param {import("./state.js").PlayerState} s
 */
export function ensureFpOffset(player, s) {
  const p = P(player);
  const v = s.calib ? Math.floor((s.calib - 1) / 5) - 2 : Math.max(-2, Math.min(2, p.fpOffsetV | 0));
  const d = s.calib ? ((s.calib - 1) % 5) - 2 : Math.max(-2, Math.min(2, p.fpOffsetD | 0));
  const anim = v === 0 && d === 0 ? "" : `animation.arsenal.fpoff.v${fp_step(v)}_d${fp_step(d)}`;
  if (anim === s.fpoffAnim) return;
  s.fpoffAnim = anim;
  safe("fpoff", () => player.playAnimation(anim || "animation.arsenal.none", {
    controller: "arsenal_fpoff",
    blendOutTime: 0.1,
    stopExpression: anim ? "!q.equipped_item_any_tag('slot.weapon.mainhand', 'arsenal:firearm')" : "1.0",
  }));
}

/**
 * 測距：狙っている地点までの距離
 * @param {import("@minecraft/server").Player} player @param {import("./state.js").PlayerState} s
 */
function rangefind(player, s) {
  safe("rangefind", () => {
    const eye = player.getHeadLocation();
    const dir = player.getViewDirection();
    const reach = loadedReach(player.dimension, eye, dir, 300, system.currentTick);
    if (reach <= 0) return;
    const bh = player.dimension.getBlockFromRay(eye, dir, { maxDistance: reach, includePassableBlocks: false, includeLiquidBlocks: true });
    const ents = player.dimension.getEntitiesFromRay(eye, dir, { maxDistance: reach, excludeFamilies: ["inanimate", "arsenal_fx"] }).filter((e) => e.entity.id !== player.id);
    let d = bh ? len(sub(hitPoint(bh), eye)) : -1;
    if (ents.length && (d < 0 || ents[0].distance < d)) d = ents[0].distance;
    if (Math.round(d) !== s.rangeDist) {
      s.rangeDist = d < 0 ? -1 : Math.round(d);
      s.hudDirty = true;
    }
  });
}

/** エイムアシストの強さ：引き寄せる円錐の半角・保つ円錐の半角（度）・1 tick に詰める割合・1 tick の最大の回転（度） */
const ASSIST = {
  light: { cone: 8, keep: 13, k: 0.22, max: 1.8 },
  strong: { cone: 12, keep: 18, k: 0.4, max: 3.5 },
};
/** これより小さいずれは直さない（細かく揺れないように。度） */
const ASSIST_DEADZONE = 0.35;

/** 照準と目標のなす角（度） @param {import("../util/math.js").Vec3} dir @param {import("../util/math.js").Vec3} v 正規化済み */
function angleTo(dir, v) {
  return (Math.acos(Math.max(-1, Math.min(1, dot(dir, v)))) * 180) / Math.PI;
}

/**
 * エイムアシストの狙う点：体の中心。弾が飛ぶ銃では、弾が届くまでに動くぶん先を狙う
 * @param {import("@minecraft/server").Entity} e @param {import("../util/math.js").Vec3} eye @param {any} st
 */
function assistPoint(e, eye, st) {
  const c = e.getAABB().center;
  if (!st.travel || !(st.travel.speed > 0)) return c;
  const v = safe("assist.vel", () => e.getVelocity()) ?? { x: 0, y: 0, z: 0 };
  const t = dist(eye, c) / st.travel.speed;
  return { x: c.x + v.x * t, y: c.y + Math.max(-0.5, Math.min(0.5, v.y * t)), z: c.z + v.z * t };
}

/**
 * エイムアシスト（ADS 中、毎 tick）：照準の近くの見えている敵へ、照準を少しずつ寄せる。
 * 撃てる相手だけ（敵対 mob・アドオンの敵、PvP の設定でプレイヤー）。壁の向こうの相手には寄せない。
 * いったん選んだ相手は、少し外れても（keep の円錐の中なら）追い続ける
 * @param {import("@minecraft/server").Player} player @param {import("./state.js").PlayerState} s @param {any} st @param {{cone:number, keep:number, k:number, max:number}} cfg
 */
function aimAssist(player, s, st, cfg) {
  safe("aimAssist", () => {
    const eye = player.getHeadLocation();
    const dir = player.getViewDirection();
    const range = Math.min(64, st.range1 ?? 48);
    /** 見えているか @param {import("@minecraft/server").Entity} e @param {import("../util/math.js").Vec3} p */
    const visible = (e, p) => {
      const v = sub(p, eye);
      const L = len(v);
      if (L < 0.5) return true;
      const reach = loadedReach(player.dimension, eye, mul(v, 1 / L), L, system.currentTick);
      if (reach < L - 0.01) return false;
      return !player.dimension.getBlockFromRay(eye, mul(v, 1 / L), { maxDistance: Math.max(0.1, L - 0.3), includePassableBlocks: false, includeLiquidBlocks: false });
    };
    /** 狙える相手か @param {import("@minecraft/server").Entity} e */
    const ok = (e) => e.isValid && e.id !== player.id && !!e.getComponent("minecraft:health") && canDamage(player, e);
    /** @type {{e:import("@minecraft/server").Entity, p:import("../util/math.js").Vec3, a:number}|null} */
    let best = null;
    // 選んでいる相手を優先（少し外れても追い続ける）
    const cur = s.assistTarget ? world.getEntity(s.assistTarget) : undefined;
    if (cur && ok(cur)) {
      const p = assistPoint(cur, eye, st);
      const a = angleTo(dir, norm(sub(p, eye)));
      if (a <= cfg.keep && dist(eye, p) <= range && visible(cur, p)) best = { e: cur, p, a };
    }
    if (!best) {
      s.assistTarget = null;
      const cands = player.dimension.getEntities({ location: eye, maxDistance: range, families: ["monster"], excludeFamilies: ["inanimate", "arsenal_fx"] });
      if (WS().aimAssistPvp) cands.push(...player.dimension.getPlayers({ location: eye, maxDistance: range }));
      let bestScore = Infinity;
      for (const e of cands) {
        if (!ok(e)) continue;
        const p = assistPoint(e, eye, st);
        const a = angleTo(dir, norm(sub(p, eye)));
        // 近い相手を少し優先する（同じ角度なら近い方）
        const score = a + dist(eye, p) * 0.02;
        if (a <= cfg.cone && score < bestScore && visible(e, p)) {
          best = { e, p, a };
          bestScore = score;
        }
      }
      if (best) s.assistTarget = best.e.id;
    }
    if (!best || best.a < ASSIST_DEADZONE) return;
    const v = norm(sub(best.p, eye));
    const r = player.getRotation();
    const want = { x: (-Math.asin(v.y) * 180) / Math.PI, y: (Math.atan2(-v.x, v.z) * 180) / Math.PI };
    let dy = want.y - r.y;
    while (dy > 180) dy -= 360;
    while (dy < -180) dy += 360;
    const dx = want.x - r.x;
    // ずれの k 割を詰める。ただし 1 tick に max 度まで（急に首が回らないように）
    const step = Math.min(1, cfg.max / Math.max(1e-6, Math.hypot(dx * cfg.k, dy * cfg.k)));
    player.setRotation({ x: r.x + dx * cfg.k * step, y: r.y + dy * cfg.k * step });
  });
}

/**
 * 自動射撃：ADS 中に照準が敵に重なっていれば引き金を引く
 * @param {import("@minecraft/server").Player} player @param {import("./state.js").PlayerState} s @param {any} st
 */
function tickAutoFire(player, s, st) {
  const onTarget = s.ads && s.adsLevel >= 1 && (safe("autoFire", () => {
    const eye = player.getHeadLocation();
    const vd = player.getViewDirection();
    // 読み込まれていないチャンクの先へはレイを撃てない（例外になる）
    const reach = loadedReach(player.dimension, eye, vd, Math.min(64, st.range1), system.currentTick);
    if (reach < 0.5) return false;
    const hits = player.dimension.getEntitiesFromRay(eye, vd, { maxDistance: reach, excludeFamilies: ["inanimate", "arsenal_fx", "player"] });
    return hits.some((h) => h.entity.id !== player.id && h.entity.getComponent("minecraft:health"));
  }) ?? false);
  if (onTarget && !s.autoFiring) {
    s.autoFiring = true;
    s.holding = true;
    s.pressQueue = 1;
  } else if (!onTarget && s.autoFiring) {
    s.autoFiring = false;
    s.holding = false;
  }
}

/**
 * ADS 中にジャンプ：可変倍率の切替・キャンテッドアイアンの持ち替え・息止め
 * @param {import("@minecraft/server").Player} player @param {import("./state.js").PlayerState} s
 */
export function adsJump(player, s) {
  const st = s.stats;
  if (!st || !s.ads) return;
  if (st.variable) {
    s.variableHigh = !s.variableHigh;
    playTo(player, "arsenal.mech.mode_switch", { volume: 0.6, pitch: s.variableHigh ? 1.2 : 0.9 });
    s.adsAnim = "";
    s.hudDirty = true;
    return;
  }
  if (st.canted) {
    s.cantedOn = !s.cantedOn;
    playTo(player, "arsenal.mech.mode_switch", { volume: 0.6, pitch: 1.3 });
    s.adsAnim = "";
    s.hudDirty = true;
    return;
  }
  holdBreath(player, s);
}

/**
 * 息止め（ADS 中にジャンプ）
 * @param {import("@minecraft/server").Player} player @param {import("./state.js").PlayerState} s
 */
export function holdBreath(player, s) {
  const now = system.currentTick;
  if (!s.ads || now < s.breathCooldown || s.breathUntil > now) return;
  s.breathUntil = now + 60;
  safe("stopShake", () => player.camera.stopShaking());
  playTo(player, "arsenal.fx.breath_in", { volume: 0.7 });
  s.hudDirty = true;
}

/** @param {import("@minecraft/server").Player} player */
function laser(player) {
  safe("laser", () => {
    const eye = player.getHeadLocation();
    const dir = player.getViewDirection();
    const reach = loadedReach(player.dimension, eye, dir, 64, system.currentTick);
    if (reach < 0.5) return;
    const hit = player.dimension.getBlockFromRay(eye, dir, { maxDistance: reach, includePassableBlocks: false, includeLiquidBlocks: false });
    const ents = player.dimension.getEntitiesFromRay(eye, dir, { maxDistance: reach, excludeFamilies: ["inanimate", "arsenal_fx"] }).filter((e) => e.entity.id !== player.id);
    let d = 64;
    if (hit) d = Math.min(d, dist(hitPoint(hit), eye));
    if (ents.length) d = Math.min(d, ents[0].distance);
    if (d < 63.9) emit(player.dimension, "arsenal:laser_dot", add(eye, mul(dir, d - 0.05)), undefined, { range: 72 });
  });
}

/**
 * @param {import("@minecraft/server").Player} player @param {import("./state.js").PlayerState} s
 */
function flashlight(player, s) {
  safe("flashlight", () => {
    const eye = player.getHeadLocation();
    const dir = player.getViewDirection();
    const reach = loadedReach(player.dimension, eye, dir, 28, system.currentTick);
    const hit = reach >= 0.5 ? player.dimension.getBlockFromRay(eye, dir, { maxDistance: reach, includePassableBlocks: true, includeLiquidBlocks: true }) : undefined;
    let target = add(eye, mul(dir, 28));
    if (hit) target = add(hitPoint(hit), mul(dir, -0.6));
    const bp = { x: Math.floor(target.x), y: Math.floor(target.y), z: Math.floor(target.z) };
    if (s.lightPos && s.lightPos.x === bp.x && s.lightPos.y === bp.y && s.lightPos.z === bp.z) return;
    clearLight(player, s);
    const b = player.dimension.getBlock(bp);
    if (b && b.isAir) {
      b.setType("minecraft:light_block_13");
      s.lightPos = bp;
      s.lightDim = player.dimension.id;
    }
  });
}

/**
 * @param {import("@minecraft/server").Player} player @param {import("./state.js").PlayerState} s
 */
export function clearLight(player, s) {
  if (!s.lightPos) return;
  const pos = s.lightPos;
  s.lightPos = null;
  safe("light.clear", () => {
    const b = player.dimension.getBlock(pos);
    if (b && b.typeId === "minecraft:light_block_13") b.setType("minecraft:air");
  });
}

/** ロックオンの円錐：捕まえる（中心から 8°）・捕まえ続ける（14°）・ロック完了後に外れても保つ時間 */
const LOCK_ACQ_COS = Math.cos((8 * Math.PI) / 180);
const LOCK_KEEP_COS = Math.cos((14 * Math.PI) / 180);
const LOCK_GRACE = 30;
const LOCK_RANGE = 160;

/**
 * 照準の円錐の中で、いちばん中心に近い・見えている敵
 * @param {import("@minecraft/server").Player} player @param {import("../util/math.js").Vec3} eye @param {import("../util/math.js").Vec3} dir
 */
function lockCandidate(player, eye, dir) {
  let best = null;
  let bestCos = LOCK_ACQ_COS;
  for (const e of player.dimension.getEntities({ location: eye, maxDistance: LOCK_RANGE, excludeFamilies: ["inanimate", "arsenal_fx", "projectile"], excludeTypes: ["minecraft:item", "minecraft:xp_orb"] })) {
    if (e.id === player.id || !e.getComponent("minecraft:health")) continue;
    const c = lockCos(e, eye, dir);
    if (c > bestCos && lockVisible(player, eye, e)) {
      best = e;
      bestCos = c;
    }
  }
  return best;
}

/** @param {import("@minecraft/server").Entity} e @param {import("../util/math.js").Vec3} eye @param {import("../util/math.js").Vec3} dir */
function lockCos(e, eye, dir) {
  const v = sub(e.getAABB().center, eye);
  const L = len(v);
  return L < 1e-3 ? 1 : dot(v, dir) / L;
}

/** 目から敵の中心までブロックに遮られていないか @param {import("@minecraft/server").Player} player @param {import("../util/math.js").Vec3} eye @param {import("@minecraft/server").Entity} e */
function lockVisible(player, eye, e) {
  const v = sub(e.getAABB().center, eye);
  const L = len(v);
  if (L < 1e-3) return true;
  const bh = player.dimension.getBlockFromRay(eye, mul(v, 1 / L), { maxDistance: L, includePassableBlocks: false, includeLiquidBlocks: false });
  return !bh;
}

/**
 * ロックオン（シーカー）。照準の中心から 8° 以内の見えている敵を捕まえ、14° 以内にいる間は捕まえ続ける。
 * 見失っても進み具合は少しずつしか減らず、ロック完了後は 1.5 秒のあいだ照準から外れてもロックを保つ
 * @param {import("@minecraft/server").Player} player @param {import("./state.js").PlayerState} s @param {any} st
 */
function tickLock(player, s, st) {
  const now = system.currentTick;
  safe("lock", () => {
    const eye = player.getHeadLocation();
    const dir = player.getViewDirection();
    const cur = s.lockTarget ? world.getEntity(s.lockTarget) : undefined;
    const curOk = !!cur && cur.isValid && cur.dimension.id === player.dimension.id;
    /** @type {import("@minecraft/server").Entity|undefined} */
    let target;
    if (curOk && lockCos(/** @type {any} */ (cur), eye, dir) >= LOCK_KEEP_COS && lockVisible(player, eye, /** @type {any} */ (cur))) {
      target = cur;
      s.lockSeen = now;
    } else if (curOk && s.lockTicks >= st.lockTicks && now - s.lockSeen <= LOCK_GRACE) {
      target = cur; // ロック済み：少しのあいだ外れても保つ
    } else if (now % 2 === 0 || !s.lockTarget) {
      target = lockCandidate(player, eye, dir) ?? undefined;
      if (target) s.lockSeen = now;
    }
    if (!target) {
      if (s.lockTicks > 0) s.lockTicks = Math.max(0, Math.min(s.lockTicks, st.lockTicks - 1) - 1);
      if (s.lockTicks === 0) s.lockTarget = null;
      return;
    }
    if (s.lockTarget !== target.id) {
      s.lockTarget = target.id;
      s.lockTicks = 0;
    }
    if (s.lockTicks < st.lockTicks + 1) s.lockTicks++;
    s.hudDirty = true;
    const v = new MolangVariableMap();
    const locked = s.lockTicks >= st.lockTicks;
    v.setFloat("variable.locked", locked ? 0.2 : 0.8);
    player.spawnParticle("arsenal:lock_marker", target.getAABB().center, v);
    if (!locked && s.lockTicks % 4 === 0) playTo(player, "arsenal.fx.lock_beep", { volume: 0.6, pitch: 0.8 + (0.6 * s.lockTicks) / st.lockTicks });
    if (s.lockTicks === st.lockTicks) playTo(player, "arsenal.fx.lock_on", { volume: 0.7 });
  });
}
