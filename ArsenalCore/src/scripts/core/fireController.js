// @ts-check
/**
 * 射撃制御：入力 → 射撃判定（セミ・バースト・フルオート・二連・充電・アンダーバレル）、
 * 連射レート、スピンアップ、過熱、ジャム、耐久、弾道の振り分け
 */
import { system, GameMode, MolangVariableMap, world } from "@minecraft/server";
import { W as WS, P } from "./settings.js";
import { heldSlot, writeProps, PROP, isWeaponItem, findWeaponSlot } from "./weaponState.js";
import { spreadNow, applyRecoil } from "./recoil.js";
import { startReload, reserveRounds, status, isInfinite } from "./reload.js";
import { traceHitscan, drawTracer, whizzBy, arcLine } from "./ballistics.js";
import { canDamage, dealDamage, hitFeedback, bulletHit } from "./damage.js";
import { fireBallistic, fireBullet, fireGrenade40, fireRocket, fireFlare, fireHook } from "../systems/projectiles.js";
import { fireFlame, fireBeam, fireGravity, fireCoil, fireSonic, fireProjectile2, mortarTarget } from "./fire2.js";
import { miniBlast } from "./damage.js";
import { emitEvent } from "./events.js";
import { isDowned } from "./downed.js";
import { gunshot, muzzleFx, muzzlePos, playNear, playTo, emit } from "../fx/effects.js";
import { casingKind, DATA, ammoItemId } from "../config/constants.js";
import { cone, add, mul, dist, sub, norm, basis } from "../util/math.js";
import { t } from "../util/i18n.js";
import { safe } from "../util/log.js";
import { countItem, consumeItem } from "./inventory.js";

/**
 * スポーン保護
 * @param {import("@minecraft/server").Player} player
 */
function inSpawnProtection(player) {
  const r = WS().spawnProtect;
  if (!r || r <= 0) return false;
  if (player.dimension.id !== "minecraft:overworld") return false;
  const sp = safe("spawn", () => world.getDefaultSpawnLocation());
  if (!sp) return false;
  const dx = player.location.x - sp.x;
  const dz = player.location.z - sp.z;
  return dx * dx + dz * dz <= r * r;
}

/**
 * 押下（トリガーを引いた）。バースト中の押下は数えない（1 回押して 1 バースト）
 * @param {import("./state.js").PlayerState} s
 */
export function pressTrigger(s) {
  if (s.burstLeft > 0) return;
  s.pressQueue = Math.min(1, s.pressQueue + 1);
}

/**
 * タップ切り替え式のフルオートを止める
 * @param {import("@minecraft/server").Player} player @param {import("./state.js").PlayerState} s
 */
export function stopTapFire(player, s) {
  if (!s.tapFiring) return;
  s.tapFiring = false;
  s.holding = false;
  s.pressQueue = 0;
  s.hudDirty = true;
  flushWear(player, s);
}

/**
 * 毎 tick の射撃処理
 * @param {import("@minecraft/server").Player} player @param {import("./state.js").PlayerState} s
 */
export function tickFire(player, s) {
  const st = s.stats;
  const now = system.currentTick;
  if (s.shotTimer > 0) s.shotTimer -= 1;
  // 過熱の冷却
  if (st.heat) {
    if (s.heat > 0 && !(s.holding && s.ammo > 0 && s.overheatUntil <= now)) s.heat = Math.max(0, s.heat - st.heat.cool);
    else if (s.heat > 0) s.heat = Math.max(0, s.heat - st.heat.cool * 0.25);
    if (s.overheatUntil > 0 && now >= s.overheatUntil) {
      s.overheatUntil = 0;
      s.hudDirty = true;
    }
  }
  // スピン
  if (st.spinup > 0) {
    if (s.holding && !s.reload) {
      if (s.spin === 0) playNear(player.dimension, player.location, "arsenal.fx.spin_up", { range: 24 });
      s.spin = Math.min(st.spinup + 20, s.spin + 1);
    } else if (s.spin > 0) {
      if (s.spin >= st.spinup) playNear(player.dimension, player.location, "arsenal.fx.spin_down", { range: 24 });
      s.spin = 0;
    }
  }
  const mode = s.mode;
  // 充電（レールスパイク）
  if (mode === "charge") {
    if (s.holding && !s.reload && s.ammo > 0) {
      if (s.charge === 0) playTo(player, "arsenal.fx.charge", { volume: 0.8 });
      s.charge = Math.min(st.charge, s.charge + 1);
      if (s.charge % 4 === 0) s.hudDirty = true;
    }
    s.pressQueue = 0;
    return;
  }
  // 1 発ずつ装填中の割り込み
  if (s.reload) {
    if (s.reload.type === "single" && s.pressQueue > 0 && s.ammo > 0) {
      s.reload.cancelRequested = true;
    }
    s.pressQueue = 0;
    return;
  }
  let guard = 0;
  while (guard++ < 4) {
    let want = false;
    let count = 1;
    let burstStep = false;
    if (mode === "auto") want = s.holding || s.pressQueue > 0;
    else if (mode === "semi" || mode === "ub") want = s.pressQueue > 0;
    else if (mode === "double") {
      want = s.pressQueue > 0;
      count = Math.min(2, Math.max(1, s.ammo));
    } else if (mode.startsWith("burst")) {
      if (s.burstLeft > 0) {
        want = true;
        burstStep = true;
      } else if (s.pressQueue > 0) {
        // 押下 1 回につき 1 バースト（押下を使い切らないと、1 回のタップで弾が尽きるまでバーストが続いてしまう）
        s.pressQueue = 0;
        s.burstLeft = parseInt(mode.slice(5), 10) || 3;
        want = true;
        burstStep = true;
      }
    }
    if (!want || s.shotTimer > 0) break;
    if (st.spinup > 0 && s.spin < st.spinup) break;
    if (mode !== "auto" && !burstStep) s.pressQueue = Math.max(0, s.pressQueue - 1);
    // フルオート：押下の記録は撃った時点で使い切る（離した後に 1 発余計に出ないように）
    if (mode === "auto") s.pressQueue = 0;
    const ok = mode === "ub" ? fireUnderbarrel(player, s) : shoot(player, s, count);
    if (!ok) {
      s.burstLeft = 0;
      s.pressQueue = 0;
      if (s.tapFiring) stopTapFire(player, s);
      break;
    }
    if (burstStep) {
      s.burstLeft--;
      if (s.burstLeft > 0) s.shotTimer += 1200 / st.burstRpm;
      else s.shotTimer += 1200 / st.burstRpm + st.burstDelay / (st.semiRate || 1);
    } else if (mode === "semi") {
      // ヘアトリガー：セミオートの連射上限が上がる
      s.shotTimer += 1200 / (st.rpm * (st.semiRate || 1));
    } else {
      s.shotTimer += 1200 / st.rpm;
    }
  }
  if (s.shotTimer < 0) s.shotTimer = 0;
}

/**
 * 充電完了で離したとき
 * @param {import("@minecraft/server").Player} player @param {import("./state.js").PlayerState} s
 */
export function releaseCharge(player, s) {
  const st = s.stats;
  if (!st || s.mode !== "charge" || s.charge <= 0) return;
  const ratio = Math.min(1, s.charge / Math.max(1, st.charge));
  s.charge = 0;
  if (s.shotTimer > 0 || s.reload) return;
  if (ratio < 0.15) return;
  shoot(player, s, 1, ratio);
  s.shotTimer = 1200 / st.rpm;
}

/**
 * 空撃ち
 * @param {import("@minecraft/server").Player} player @param {import("./state.js").PlayerState} s
 */
function dryFire(player, s) {
  const now = system.currentTick;
  if (now - s.dryTick < 6) return;
  s.dryTick = now;
  playNear(player.dimension, player.location, "arsenal.mech.dry_fire", { range: 12 });
  if (WS().autoReload && P(player).reloadInput !== "manual") startReload(player, s);
  else status(s, t("arsenal.ui.empty"));
}

/**
 * 1 回の射撃
 * @param {import("@minecraft/server").Player} player @param {import("./state.js").PlayerState} s @param {number} count 同時発射数（二連）@param {number} [charge]
 * @returns {boolean}
 */
export function shoot(player, s, count = 1, charge = 1) {
  const st = s.stats;
  const now = system.currentTick;
  if (inSpawnProtection(player)) {
    status(s, t("arsenal.ui.spawn_protect"));
    return false;
  }
  if (s.jammed) {
    dryFire(player, s);
    status(s, t("arsenal.ui.jammed"));
    return false;
  }
  if (isDowned(player)) return false;
  // EMP：エネルギー兵器が止まる
  if (st.ammoFamily === "cell" && s.empUntil > now) {
    status(s, t("arsenal.ui.emp"));
    return false;
  }
  if (st.heat && s.overheatUntil > now) {
    status(s, t("arsenal.ui.overheated"));
    return false;
  }
  if (st.cooldown && s.cooldownUntil > now) return false;
  if (WS().durability && s.stats && isBroken(player)) {
    status(s, t("arsenal.ui.broken"));
    playNear(player.dimension, player.location, "arsenal.mech.jam", { range: 12, pitch: 0.7 });
    return false;
  }
  const noAmmo = st.ammoFamily === "none";
  if (!noAmmo && s.ammo <= 0) {
    dryFire(player, s);
    return false;
  }
  const n = noAmmo ? count : Math.min(count, s.ammo);
  if (!noAmmo) s.ammo -= n;
  s.lastShotTick = now;
  s.hudDirty = true;
  const ads = s.adsLevel > 0.5;
  const eye = player.getHeadLocation();
  const view = player.getViewDirection();
  const muzzle = muzzlePos(player, ads);
  const spread = spreadNow(player, s, st);

  for (let k = 0; k < n; k++) {
    switch (st.fire) {
      case "ballistic": {
        fireBallistic(player, muzzle, cone(view, spread), st);
        break;
      }
      case "gl40": fireGrenade40(player, muzzle, cone(view, spread), st); break;
      case "rocket": fireRocket(player, muzzle, cone(view, spread * 0.5), st, null); break;
      case "seeker": {
        const locked = s.lockTarget && s.lockTicks >= st.lockTicks ? s.lockTarget : null;
        fireRocket(player, muzzle, cone(view, spread * 0.5), st, locked);
        s.lockTicks = 0;
        break;
      }
      case "flare": fireFlare(player, muzzle, cone(view, spread), st); break;
      case "grapple": fireHook(player, muzzle, view, st); s.cooldownUntil = now + st.cooldown; break;
      case "rail": fireRail(player, eye, cone(view, spread), st, charge, muzzle); break;
      case "arc": fireArc(player, eye, cone(view, spread), st, muzzle); break;
      case "cryo": fireCryo(player, eye, cone(view, spread), st, muzzle); break;
      // ---- 2.0 ----
      case "flame": fireFlame(player, eye, cone(view, spread), st, muzzle); break;
      case "beam": fireBeam(player, eye, cone(view, spread), st, muzzle); break;
      case "gravity": fireGravity(player, eye, cone(view, spread), st, player.isSneaking && s.adsLevel < 0.5); break;
      case "coil": fireCoil(player, eye, cone(view, spread), st, charge, muzzle); break;
      case "sonic": fireSonic(player, eye, view, st, muzzle); break;
      case "plasma": fireProjectile2(player, muzzle, cone(view, spread), st); break;
      case "needle": fireProjectile2(player, muzzle, cone(view, spread), st, null, s.lockTarget); break;
      case "mortar": fireProjectile2(player, muzzle, view, st, mortarTarget(player, st, s.mortarTarget)); break;
      default: fireHitscan(player, s, eye, view, spread, st, muzzle);
    }
  }
  emitEvent("shot", { player, weaponId: st.id, n });
  // 過熱
  if (st.heat) {
    s.heat += st.heat.perShot * n;
    if (s.heat >= 100) {
      s.heat = 100;
      s.overheatUntil = now + st.heat.lockout;
      playNear(player.dimension, player.location, "arsenal.fx.overheat", { range: 16 });
      playNear(player.dimension, player.location, "arsenal.fx.heat_vent", { range: 16 });
      emit(player.dimension, "arsenal:steam", muzzle, undefined, { range: 32 });
    }
  }
  // 演出（照射系は音を間引く）
  const looping = st.fire === "flame" || st.fire === "beam";
  if (!looping || now - s.loopSoundTick >= 6) {
    s.loopSoundTick = now;
    gunshot(player, st, muzzle);
  }
  if (!looping) muzzleFx(player, st, muzzle, casingKind(st.id));
  applyRecoil(player, s, st, n > 1 ? 1.6 : 1);
  if (st.bolt || st.pump) {
    const delay = Math.max(3, Math.floor((1200 / st.rpm) * 0.35));
    system.runTimeout(() => safe("boltCycle", () => {
      if (!player.isValid) return;
      playNear(player.dimension, player.location, st.pump ? "arsenal.mech.pump" : "arsenal.mech.bolt_back", { range: 16 });
      if (st.bolt) system.runTimeout(() => safe("boltFwd", () => { if (player.isValid) playNear(player.dimension, player.location, "arsenal.mech.bolt_forward", { range: 16 }); }), 5);
      player.playAnimation(st.pump ? "animation.arsenal.pump" : "animation.arsenal.bolt", { controller: "arsenal_reload", blendOutTime: 0.1 });
    }), delay);
  }
  // 弾薬の保存は撃ち止めたときにまとめて行う（撃っている最中に手持ちのアイテムを書き換えると、
  // 端末によっては「使用」が途切れて押しっぱなし扱いが残り、射撃が止まらなくなるため）
  if (!noAmmo) s.ammoDirty = true;
  if (WS().durability && player.getGameMode() !== GameMode.Creative) {
    s.wearPending += n;
    const ratio = durabilityRatio(player, s);
    if (ratio < 0.25 && st.ammoFamily !== "none" && !st.heat) {
      const chance = (0.25 - ratio) * 0.12;
      if (Math.random() < chance) {
        s.jammed = true;
        playNear(player.dimension, player.location, "arsenal.mech.jam", { range: 12 });
        status(s, t("arsenal.ui.jammed"));
      }
    }
  }
  // 自動リロード（撃ち切り）
  if (!noAmmo && s.ammo <= 0 && WS().autoReload && P(player).reloadInput !== "manual" && reserveRounds(player, st, s.ammoType) > 0) {
    system.runTimeout(() => safe("autoReload", () => { if (player.isValid && s.ammo <= 0 && !s.reload) startReload(player, s); }), 4);
  }
  return true;
}

/**
 * ヒットスキャン射撃（散弾含む）
 * @param {import("@minecraft/server").Player} player @param {import("./state.js").PlayerState} s
 * @param {import("../util/math.js").Vec3} eye @param {import("../util/math.js").Vec3} view @param {number} spread @param {any} st @param {import("../util/math.js").Vec3} muzzle
 */
function fireHitscan(player, s, eye, view, spread, st, muzzle) {
  const pellets = st.pellets;
  const q = P(player).fxQuality;
  const tracerEvery = q === "low" ? 4 : q === "medium" ? 2 : 1;
  const flame = st.ammoFamily === "shell" && s.ammoType === "fire";
  if (flame) {
    const v = new MolangVariableMap();
    v.setSpeedAndDirection("variable.aim", 12, view);
    emit(player.dimension, "arsenal:flame", muzzle, v, { range: 64 });
  }
  let lastEnd = null;
  const travel = !!st.travel && WS().bulletTravel !== false;
  for (let i = 0; i < pellets; i++) {
    let d = cone(view, spread + (pellets > 1 && !st.pelletFlat ? st.pelletSpread : 0));
    if (pellets > 1 && st.pelletFlat) {
      // ダックビル：散弾を横一列に広げる
      const { r: right } = basis(view);
      const k = ((i / Math.max(1, pellets - 1)) - 0.5) * Math.tan((st.pelletSpread * 1.6 * Math.PI) / 180);
      d = norm(add(d, mul(right, k)));
    }
    const showTracer = st.tracerAlways || (st.tracer && (pellets > 1 ? i % 3 === 0 : (s.lastShotTick + s.ammo) % tracerEvery === 0));
    if (travel) {
      // 弾が飛ぶ：1 tick ごとに弾速ぶん進み、重力で落ちる（偏差と落下）。最初の 1 tick ぶんはこの場で進める
      fireBullet(player, eye, d, st, { pen: pellets > 1 ? 0 : st.pen, silent: pellets > 1 && i > 0, tracer: showTracer && !flame, whizz: pellets === 1, muzzle });
      continue;
    }
    const r = traceHitscan(player, eye, d, st, { pen: pellets > 1 ? 0 : st.pen, silent: pellets > 1 && i > 0 });
    lastEnd = r.end;
    if (st.explosive && (r.stopped || r.hitEntity)) miniBlast(player, r.end, 1.4, 3.0, st.id);
    if (showTracer && !flame) drawTracer(player, muzzle, r.end, st, true);
  }
  if (lastEnd && pellets === 1) whizzBy(player, eye, lastEnd);
}

/**
 * レールスパイク：一直線上のすべてを貫通
 * @param {import("@minecraft/server").Player} player @param {import("../util/math.js").Vec3} eye @param {import("../util/math.js").Vec3} dir @param {any} st @param {number} charge @param {import("../util/math.js").Vec3} muzzle
 */
function fireRail(player, eye, dir, st, charge, muzzle) {
  const dmg = st.dmgMin + (st.dmg - st.dmgMin) * charge;
  const r = traceHitscan(player, eye, dir, st, { baseDmg: dmg, pierceAll: true, pen: 3 + charge * 4, wallPierce: true });
  const v = new MolangVariableMap();
  const L = dist(muzzle, r.end);
  const dn = norm(sub(r.end, muzzle));
  v.setSpeedAndDirection("variable.tracer", 0.01, dn);
  v.setColorRGB("variable.color", { red: 0.4, green: 0.85, blue: 1.0 });
  for (let i = 0; i < L; i += 0.5) emit(player.dimension, "arsenal:rail_beam", add(muzzle, mul(dn, i)), v, { range: 160 });
  emit(player.dimension, "arsenal:energy_ring", r.end, v, { range: 96 });
}

/**
 * アークキャスター：連鎖電撃
 * @param {import("@minecraft/server").Player} player @param {import("../util/math.js").Vec3} eye @param {import("../util/math.js").Vec3} dir @param {any} st @param {import("../util/math.js").Vec3} muzzle
 */
function fireArc(player, eye, dir, st, muzzle) {
  const v = new MolangVariableMap();
  v.setColorRGB("variable.color", { red: 0.7, green: 0.55, blue: 1.0 });
  /** @type {import("@minecraft/server").Entity|null} */
  let first = null;
  const r = traceHitscan(player, eye, dir, st, { pen: 0, noImpact: false, onEntity: (e) => { first = e; } });
  arcLine(player.dimension, muzzle, r.end, v);
  if (!first) return;
  /** @type {import("@minecraft/server").Entity} */
  let cur = first;
  const hit = new Set([player.id, cur.id]);
  let dmg = st.dmg;
  for (let j = 0; j < st.chain.jumps; j++) {
    dmg *= st.chain.falloff;
    const from = cur.getAABB().center;
    const next = cur.dimension.getEntities({ location: from, maxDistance: st.chain.radius, excludeFamilies: ["inanimate", "arsenal_fx", "projectile"], excludeTypes: ["minecraft:item", "minecraft:xp_orb"] })
      .filter((e) => !hit.has(e.id) && e.getComponent("minecraft:health") && canDamage(player, e))
      .sort((a, b) => dist(a.location, from) - dist(b.location, from))[0];
    if (!next) break;
    hit.add(next.id);
    const to = next.getAABB().center;
    arcLine(player.dimension, from, to, v);
    const wet = next.isInWater ? 1.5 : 1;
    bulletHit(player, next, to, norm(sub(to, from)), dist(eye, to), st, 1, { baseDmg: dmg * wet, noZones: true });
    cur = next;
  }
}

/**
 * クライオランス：鈍足と凍結
 * @param {import("@minecraft/server").Player} player @param {import("../util/math.js").Vec3} eye @param {import("../util/math.js").Vec3} dir @param {any} st @param {import("../util/math.js").Vec3} muzzle
 */
function fireCryo(player, eye, dir, st, muzzle) {
  const r = traceHitscan(player, eye, dir, st, {
    onEntity: (e) => safe("cryo", () => {
      const cur = e.getEffect("slowness");
      const amp = Math.min(3, cur ? cur.amplifier + 1 : 1);
      e.addEffect("slowness", 70, { amplifier: amp, showParticles: false });
      if (amp >= 3) {
        e.addEffect("mining_fatigue", 60, { amplifier: 2, showParticles: false });
        e.addEffect("weakness", 60, { amplifier: 1, showParticles: false });
        e.extinguishFire(false);
      }
      emit(e.dimension, "arsenal:frost", e.getAABB().center, undefined, { range: 48 });
    }),
  });
  const v = new MolangVariableMap();
  v.setColorRGB("variable.color", { red: 0.6, green: 0.9, blue: 1.0 });
  const dn = norm(sub(r.end, muzzle));
  v.setSpeedAndDirection("variable.tracer", 0.01, dn);
  const L = dist(muzzle, r.end);
  for (let i = 0; i < L; i += 0.7) emit(player.dimension, "arsenal:rail_beam", add(muzzle, mul(dn, i)), v, { range: 96, minQ: 1 });
  emit(player.dimension, "arsenal:frost", r.end, undefined, { range: 48 });
}

/**
 * アンダーバレル射撃
 * @param {import("@minecraft/server").Player} player @param {import("./state.js").PlayerState} s
 */
function fireUnderbarrel(player, s) {
  const st = s.stats;
  const kind = st.underbarrel;
  const now = system.currentTick;
  if (s.ub <= 0) {
    // 自動装填
    const ammoId = kind === "launcher" ? ammoItemId("gl40", "std") : ammoItemId("shell", "buck");
    const cap = kind === "launcher" ? 1 : 3;
    if (!ammoId) return false;
    const inf = isInfinite(player);
    const have = inf ? cap : countItem(player, ammoId);
    if (have <= 0) {
      dryFire(player, s);
      status(s, t("arsenal.ui.no_ammo"));
      return false;
    }
    const n = Math.min(cap, have);
    if (!inf) consumeItem(player, ammoId, n);
    s.ub = n;
    s.shotTimer = kind === "launcher" ? 30 : 24;
    playNear(player.dimension, player.location, kind === "launcher" ? "arsenal.mech.heavy_load" : "arsenal.mech.shell_insert", { range: 12 });
    const slot = heldSlot(player);
    if (slot) writeProps(slot, { [PROP.ub]: s.ub });
    s.hudDirty = true;
    return true;
  }
  s.ub--;
  const muzzle = muzzlePos(player, s.adsLevel > 0.5);
  const eye = player.getHeadLocation();
  const view = player.getViewDirection();
  if (kind === "launcher") {
    const gl = { ...st, id: "thumper", projectile: DATA.WEAPONS.thumper.projectile };
    fireGrenade40(player, muzzle, view, gl);
    gunshot(player, { ...st, sound: "launcher", suppressed: false, pitch: 1.05 }, muzzle);
    applyRecoil(player, s, { ...st, recoilV: 3.0, recoilH: 0.5, shake: 0.07 });
    s.shotTimer = 20;
  } else {
    const sg = { ...st, id: "breacher", pellets: 7, pelletSpread: 7, dmg: 2.4, head: 1.3, range0: 6, range1: 18, falloff: 0.3, pen: 0, fire: "hitscan", tracer: true };
    for (let i = 0; i < sg.pellets; i++) {
      const d = cone(view, 1.5 + sg.pelletSpread);
      const r = traceHitscan(player, eye, d, sg, { pen: 0, silent: i > 0 });
      if (i % 3 === 0) drawTracer(player, muzzle, r.end, sg, true);
    }
    gunshot(player, { ...st, sound: "shotgun", suppressed: false, pitch: 1.1 }, muzzle);
    applyRecoil(player, s, { ...st, recoilV: 4.0, recoilH: 1.0, shake: 0.08 });
    s.shotTimer = 14;
  }
  muzzleFx(player, { ...st, flash: true }, muzzle, null);
  const slot = heldSlot(player);
  if (slot) writeProps(slot, { [PROP.ub]: s.ub });
  s.lastShotTick = now;
  s.hudDirty = true;
  return true;
}

// ---------------------------------------------------------------------------
//  耐久
// ---------------------------------------------------------------------------

/** @param {import("@minecraft/server").Player} player */
function isBroken(player) {
  const slot = heldSlot(player);
  if (!slot) return false;
  return safe("isBroken", () => {
    const it = slot.getItem();
    const d = it?.getComponent("minecraft:durability");
    return !!d && d.damage >= d.maxDurability - 1;
  }) ?? false;
}

/** @param {import("@minecraft/server").Player} player @param {import("./state.js").PlayerState} s */
export function durabilityRatio(player, s) {
  const slot = heldSlot(player);
  if (!slot) return 1;
  return safe("durRatio", () => {
    const it = slot.getItem();
    const d = it?.getComponent("minecraft:durability");
    if (!d) return 1;
    return 1 - (d.damage + s.wearPending) / d.maxDurability;
  }) ?? 1;
}

/**
 * 残弾と蓄積した損耗をアイテムに書き込む（射撃停止時にまとめて 1 回で行う）
 * @param {import("@minecraft/server").Player} player @param {import("./state.js").PlayerState} s
 */
export function flushWear(player, s) {
  if (s.wearPending <= 0 && !s.ammoDirty) return;
  const n = s.wearPending;
  const writeAmmo = s.ammoDirty;
  s.wearPending = 0;
  s.ammoDirty = false;
  s.lastWearWrite = system.currentTick;
  if (!s.weaponId) return;
  safe("flushWear", () => {
    const c = player.getComponent("minecraft:inventory")?.container;
    if (!c) return;
    // 同じ武器の別の 1 挺に書かないよう、識別子で探す（持ち替え・並べ替えで動いていても追いかける）
    const idx = findWeaponSlot(c, player.selectedSlotIndex, s.weaponId, s.uid);
    if (idx < 0) return;
    const it = c.getItem(idx);
    if (!it) return;
    if (writeAmmo) it.setDynamicProperty(PROP.ammo, s.ammo);
    const d = it.getComponent("minecraft:durability");
    if (d && n > 0) d.damage = Math.min(d.maxDurability - 1, d.damage + n);
    c.setItem(idx, it);
  });
}
