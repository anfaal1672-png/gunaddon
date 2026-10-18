// @ts-check
/**
 * ADS（覗き込み）、ズーム、移動速度、保持ポーズ、スコープの揺れと息止め、
 * レーザー・フラッシュライト、ロックオン
 */
import { system, world, EasingType, MolangVariableMap } from "@minecraft/server";
import { P, W as WS } from "./settings.js";
import { emit, playTo } from "../fx/effects.js";
import { SCOPED_OPTICS, resetScopeMark, effectiveOptic } from "../ui/hud.js";
import { add, mul, len, sub, norm, dot, loadedReach } from "../util/math.js";
import { armorMove, riotShieldMove } from "./armor.js";
import { DATA } from "../config/constants.js";
import { fp_step } from "../util/fpstep.js";
import { safe } from "../util/log.js";
import { tickPathLock, clearPathLock } from "./pathlock.js";

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
 * 走っている間の構え：銃を体の前に下げて抱える（一人称・三人称）。走るのをやめる・銃を持ち替えると
 * stopExpression で解け、blendOutTime で元の構えへ戻る。撃った直後とリロード中は構えない。
 * 構えを解いたら、銃が重いほど撃てるまで時間がかかる（st.ready tick）
 * @param {import("@minecraft/server").Player} player @param {import("./state.js").PlayerState} s @param {any} st @param {number} now
 */
function tickSprintPose(player, s, st, now) {
  const want = player.isSprinting && !s.reload && !s.holding && !s.tapFiring && now - s.lastShotTick > 6;
  if (want && !s.sprintPose) {
    s.sprintPose = true;
    safe("sprint.pose", () => player.playAnimation("animation.arsenal.sprint", {
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
    if (prefs.aimAssist !== "off" && now - s.assistTick >= 2) {
      s.assistTick = now;
      aimAssist(player, s, prefs.aimAssist === "strong" ? 0.35 : 0.18);
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
    let d = bh ? len(sub(add(bh.block.location, bh.faceLocation), eye)) : -1;
    if (ents.length && (d < 0 || ents[0].distance < d)) d = ents[0].distance;
    if (Math.round(d) !== s.rangeDist) {
      s.rangeDist = d < 0 ? -1 : Math.round(d);
      s.hudDirty = true;
    }
  });
}

/**
 * エイムアシスト（スマホ向け・個人設定。PvP ではワールド設定で禁止できる）：照準の近くの敵へ弱く吸い付く
 * @param {import("@minecraft/server").Player} player @param {import("./state.js").PlayerState} s @param {number} k
 */
function aimAssist(player, s, k) {
  safe("aimAssist", () => {
    const eye = player.getHeadLocation();
    const dir = player.getViewDirection();
    let best = null;
    let bestDot = Math.cos((6 * Math.PI) / 180);
    for (const e of player.dimension.getEntities({ location: eye, maxDistance: 48, families: ["monster"], excludeFamilies: ["inanimate", "arsenal_fx"] })) {
      if (e.typeId === "minecraft:player" && !WS().aimAssistPvp) continue;
      const c = e.getAABB().center;
      const v = norm(sub(c, eye));
      const dd = dot(v, dir);
      if (dd > bestDot) {
        bestDot = dd;
        best = v;
      }
    }
    if (!best) return;
    const r = player.getRotation();
    const want = { x: (-Math.asin(best.y) * 180) / Math.PI, y: (Math.atan2(-best.x, best.z) * 180) / Math.PI };
    let dy = want.y - r.y;
    while (dy > 180) dy -= 360;
    while (dy < -180) dy += 360;
    player.setRotation({ x: r.x + (want.x - r.x) * k, y: r.y + dy * k });
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
    if (hit) d = Math.min(d, Math.hypot(hit.block.location.x + hit.faceLocation.x - eye.x, hit.block.location.y + hit.faceLocation.y - eye.y, hit.block.location.z + hit.faceLocation.z - eye.z));
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
    if (hit) target = add(add(hit.block.location, hit.faceLocation), mul(dir, -0.6));
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
