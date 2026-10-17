// @ts-check
/**
 * ダメージ計算と適用、部位判定、防具・プレート・盾、ヒットマーカー、キルログ、キルの通知
 *
 * 無敵時間の扱い：
 *   Bedrock ではダメージ後およそ 10 tick の無敵時間があり、高レートの連射が吸われてしまう。
 *   そこで「エンジンのダメージ適用（被弾演出・ヘイト・キル帰属）」は 10 tick に 1 回だけ小さな値で行い、
 *   実ダメージは体力コンポーネントを直接減算する。致死ダメージだけはエンジン経由で与え、
 *   不死のトーテム・死亡メッセージ・キル帰属を正しく処理させる。
 *
 * 致死ダメージの横取り（ダウン制・ゲームモードの復活）：
 *   lethal guard が true を返すと、その致死ダメージは与えない（guard 側でダウン・復活を処理する）。
 *   スクリプト経由（dealDamage）とエンジン経由（beforeEvents.entityHurt）の両方で同じ guard を使う。
 */
import { world, system, EntityDamageCause, GameMode, Player } from "@minecraft/server";
import { W as WS } from "./settings.js";
import { S } from "./state.js";
import { playTo, impactEntity, playNear, emit, explosionFx } from "../fx/effects.js";
import { ENTITY, NS, enemyIdOf, enemyDef } from "../config/constants.js";
import { safe } from "../util/log.js";
import { t, raw, itemName } from "../util/i18n.js";
import { clamp, isLoaded, dist, sub, norm, dot } from "../util/math.js";
import { onDummyHit } from "../systems/dummy.js";
import { emitEvent } from "./events.js";
import { absorbPlates, helmetHeadMul, hasRiotShieldFacing } from "./armor.js";

/** 対象ごとの最後のエンジンダメージ tick */
const lastEngineHit = new Map();
/**
 * 直近の攻撃者（キルの帰属・武器・頭・距離）
 * @type {Map<string, {shooterId:string, weaponId:string|null, tick:number, head?:boolean, dist?:number, kind?:string}>}
 */
const lastAttacker = new Map();
/** 最近ダメージを与えたプレイヤー（アシスト判定） @type {Map<string, Map<string, number>>} */
const contributors = new Map();
/** スクリプトが与える致死ダメージ（エンジン側の横取り判定から除外） */
const scriptLethal = new Set();
/** マーキング（命中した相手が一定時間、被ダメージ増） @type {Map<string, number>} */
const marked = new Map();

const NON_FLESH = new Set(["minecraft:skeleton", "minecraft:stray", "minecraft:wither_skeleton", "minecraft:bogged", "minecraft:iron_golem", "minecraft:snow_golem", "minecraft:shulker", "minecraft:blaze", "minecraft:breeze", "minecraft:creaking", "minecraft:magma_cube", "minecraft:slime", "minecraft:vex", "minecraft:allay", "minecraft:armor_stand"]);

/** @type {((target:import("@minecraft/server").Entity, attacker:import("@minecraft/server").Entity|undefined, info:any)=>boolean)[]} */
const lethalGuards = [];

/**
 * 致死ダメージの横取りを登録（ダウン制・ゲームモード）
 * @param {(target:import("@minecraft/server").Entity, attacker:import("@minecraft/server").Entity|undefined, info:any)=>boolean} fn
 */
export function addLethalGuard(fn) {
  lethalGuards.push(fn);
}

/** @param {import("@minecraft/server").Entity} target @param {import("@minecraft/server").Entity|undefined} attacker @param {any} info */
function guardLethal(target, attacker, info) {
  for (const g of lethalGuards) {
    if (safe("lethalGuard", () => g(target, attacker, info))) return true;
  }
  return false;
}

/**
 * 部位判定
 * @param {import("@minecraft/server").Entity} target @param {import("../util/math.js").Vec3} point
 * @returns {"head"|"body"|"leg"}
 */
export function hitZone(target, point) {
  const box = safe("hitZone", () => target.getAABB());
  if (!box) return "body";
  const h = box.extent.y * 2;
  const bottom = box.center.y - box.extent.y;
  const rel = clamp((point.y - bottom) / Math.max(0.01, h), 0, 1);
  if (h >= 1.2) {
    if (rel >= 0.78) return "head";
    if (rel <= 0.33) return "leg";
    return "body";
  }
  if (h >= 0.6 && rel >= 0.72) return "head";
  return "body";
}

/** 敵の定義（ARSENAL の敵なら） @param {import("@minecraft/server").Entity} e */
export function enemyOf(e) {
  const id = enemyIdOf(e.typeId);
  return id ? enemyDef(id) : undefined;
}

/**
 * 相手が「装甲あり」か（ホローポイントの減衰・対物ライフルの特効）
 * @param {import("@minecraft/server").Entity} target
 */
export function isArmored(target) {
  const en = enemyOf(target);
  if (en) return (en.armorValue ?? 0) >= 0.25 || en.model === "robot" || !!en.phases;
  if (target.typeId.startsWith(`${NS}:`)) return true; // 設置物・乗り物
  if (target instanceof Player) {
    const eq = safe("armor.eq", () => target.getComponent("minecraft:equippable"));
    return !!eq && eq.totalArmor >= 8;
  }
  return target.typeId === "minecraft:iron_golem" || target.typeId === "minecraft:ravager";
}

/**
 * 防具による軽減
 * @param {import("@minecraft/server").Entity} target @param {number} dmg @param {number} ap
 */
function armorReduce(target, dmg, ap) {
  const en = enemyOf(target);
  if (en) {
    const a = clamp((en.armorValue ?? 0) * (1 - clamp(ap, 0, 1)), 0, 0.8);
    dmg *= 1 - a;
  } else {
    const eq = safe("armor", () => target.getComponent("minecraft:equippable"));
    let armor = 0;
    let tough = 0;
    if (eq) {
      armor = eq.totalArmor;
      tough = eq.totalToughness;
    }
    armor *= 1 - clamp(ap, 0, 1);
    tough *= 1 - clamp(ap, 0, 1);
    if (armor > 0) {
      const eff = clamp(Math.max(armor / 5, armor - (4 * dmg) / (tough + 8)), 0, 20);
      dmg *= 1 - eff / 25;
    }
  }
  const res = safe("resistance", () => target.getEffect("resistance"));
  if (res) dmg *= Math.max(0, 1 - 0.2 * (res.amplifier + 1));
  return dmg;
}

/** @param {import("@minecraft/server").Entity} e */
const isEnemyAI = (e) => e.typeId.startsWith(`${NS}:`) && !!enemyIdOf(e.typeId);

/**
 * 攻撃してよい相手か
 * @param {import("@minecraft/server").Entity} shooter @param {import("@minecraft/server").Entity} target
 */
export function canDamage(shooter, target) {
  if (!target.isValid) return false;
  if (target.id === shooter.id) return false;
  const ws = WS();
  const tt = target.typeId;
  if (tt === ENTITY.quartermaster || tt === ENTITY.storage || tt === ENTITY.crate || tt === ENTITY.waypoint) return false;
  // 敵同士は撃ち合わない
  if (isEnemyAI(shooter) && isEnemyAI(target)) return false;
  if (target instanceof Player) {
    const gm = safe("gm", () => target.getGameMode());
    if (gm === GameMode.Creative || gm === GameMode.Spectator) return false;
    if (shooter instanceof Player) {
      if (!(safe("pvp", () => world.gameRules.pvp) ?? true)) return false;
      if (!ws.friendlyFire && sameTeam(shooter, target)) return false;
    }
  }
  // 設置物・乗り物：持ち主と味方は壊さない
  if (tt.startsWith(`${NS}:`) && !isEnemyAI(target) && shooter instanceof Player) {
    const owner = safe("owner", () => target.getDynamicProperty("a:own"));
    if (typeof owner === "string") {
      if (owner === shooter.id) return false;
      const op = world.getEntity(owner);
      if (!ws.friendlyFire && op instanceof Player && sameTeam(shooter, op)) return false;
    }
  }
  if (!ws.friendlyFire && shooter instanceof Player) {
    const tame = safe("tame", () => target.getComponent("minecraft:tameable"));
    if (tame && tame.isTamed && tame.tamedToPlayerId === shooter.id) return false;
  }
  // プレイヤーの設置物（砲台・銃座）が撃った弾は、持ち主が撃ったのと同じ扱い
  if (!(shooter instanceof Player) && shooter.typeId.startsWith(`${NS}:`) && !isEnemyAI(shooter)) {
    const own = safe("shooter.own", () => shooter.getDynamicProperty("a:own"));
    if (typeof own === "string") {
      if (target.id === own) return false;
      const op = world.getEntity(own);
      if (op instanceof Player) {
        if (target instanceof Player && (!(safe("pvp2", () => world.gameRules.pvp) ?? true) || (!ws.friendlyFire && sameTeam(op, target)))) return false;
        const town = safe("target.own", () => target.getDynamicProperty("a:own"));
        if (town === own) return false;
      }
    }
    if (!(target instanceof Player) && !isEnemyAI(target) && !target.typeId.startsWith("minecraft:")) return false;
  }
  return true;
}

/** @param {Player} a @param {Player} b */
export function sameTeam(a, b) {
  const ta = a.getTags().find((x) => x.startsWith("arsenal_team:"));
  if (!ta) return false;
  return b.hasTag(ta);
}

/**
 * ダメージを与える（共通）
 * @param {import("@minecraft/server").Entity} shooter
 * @param {import("@minecraft/server").Entity} target
 * @param {number} dmg 軽減後の最終ダメージ
 * @param {{fire?:number, weaponId?:string, head?:boolean, knock?:import("../util/math.js").Vec3|null, knockPower?:number, dist?:number, kind?:string}} [o]
 * @returns {{dealt:number, killed:boolean}}
 */
export function dealDamage(shooter, target, dmg, o = {}) {
  const res = { dealt: 0, killed: false };
  safe("dealDamage", () => {
    const now = system.currentTick;
    // マーキング
    const mk = marked.get(target.id);
    if (mk !== undefined) {
      if (mk > now) dmg *= 1.15;
      else marked.delete(target.id);
    }
    const health = target.getComponent("minecraft:health");
    if (!health) {
      target.applyDamage(dmg, { cause: EntityDamageCause.entityAttack, damagingEntity: shooter });
      return;
    }
    lastAttacker.set(target.id, { shooterId: shooter.id, weaponId: o.weaponId ?? null, tick: now, head: !!o.head, dist: o.dist ?? dist(shooter.location, target.location), kind: o.kind });
    if (shooter instanceof Player) {
      let c = contributors.get(target.id);
      if (!c) contributors.set(target.id, (c = new Map()));
      c.set(shooter.id, now);
    }
    const hp = health.currentValue;
    if (hp <= 0) return;
    if (target instanceof Player) {
      const st = S(target);
      st.lastHurtTick = now;
      const dv = sub(shooter.location, target.location);
      const view = target.getViewDirection();
      const ang = Math.atan2(dv.x * view.z - dv.z * view.x, dv.x * view.x + dv.z * view.z);
      st.dmgDir = { dir: ((Math.round(-ang / (Math.PI / 4)) % 8) + 8) % 8, tick: now };
      st.hudDirty = true;
    }
    if (dmg >= hp - 0.01) {
      if (guardLethal(target, shooter, { weaponId: o.weaponId, head: o.head })) {
        res.dealt = Math.max(0, hp - 1);
        return;
      }
      // 致死：エンジン経由でキルを帰属させる
      scriptLethal.add(target.id);
      target.applyDamage(Math.max(hp * 4 + 40, dmg * 4), { cause: EntityDamageCause.entityAttack, damagingEntity: shooter });
      scriptLethal.delete(target.id);
      res.dealt = hp;
      res.killed = !target.isValid || (target.getComponent("minecraft:health")?.currentValue ?? 0) <= 0;
      lastEngineHit.set(target.id, now);
    } else {
      const last = lastEngineHit.get(target.id) ?? -99;
      if (now - last >= 10) {
        target.applyDamage(0.5, { cause: EntityDamageCause.entityAttack, damagingEntity: shooter });
        lastEngineHit.set(target.id, now);
      }
      if (target.isValid) {
        const h2 = target.getComponent("minecraft:health");
        if (h2) {
          const cur = h2.currentValue;
          const next = Math.max(0.5, cur - Math.max(0, dmg - (now - last >= 10 ? 0.5 : 0)));
          h2.setCurrentValue(next);
          res.dealt = dmg;
        }
      }
    }
    const kv = o.knock;
    const kp = o.knockPower ?? 0;
    if (kv && target.isValid && kp > 0) {
      safe("knock", () => target.applyKnockback({ x: kv.x * kp, z: kv.z * kp }, 0.05));
    }
    if (o.fire && o.fire > 0 && target.isValid) target.setOnFire(o.fire, true);
  });
  return res;
}

/** 距離減衰 @param {any} st @param {number} d */
export function rangeMul(st, d) {
  if (d <= st.range0) return 1;
  if (d >= st.range1) return st.falloff;
  return 1 - ((d - st.range0) / (st.range1 - st.range0)) * (1 - st.falloff);
}

/**
 * 弾丸の命中処理
 * @param {import("@minecraft/server").Entity} shooter
 * @param {import("@minecraft/server").Entity} target
 * @param {import("../util/math.js").Vec3} point
 * @param {import("../util/math.js").Vec3} dir
 * @param {number} distance
 * @param {any} st
 * @param {number} mul 貫通などによる倍率
 * @param {{baseDmg?:number, extraFire?:number, noZones?:boolean, silent?:boolean}} [o]
 * @returns {"hit"|"pass"|"block"}
 */
export function bulletHit(shooter, target, point, dir, distance, st, mul, o = {}) {
  if (target.typeId === ENTITY.dummy) {
    if (!(shooter instanceof Player)) return "pass";
    const zone = o.noZones ? "body" : hitZone(target, point);
    const base = (o.baseDmg ?? st.dmg) * rangeMul(st, distance) * mul * WS().damageMul;
    const hm = 1 + (st.head - 1) * WS().headMul;
    const dmg = base * (zone === "head" ? hm : zone === "leg" ? 0.75 : 1);
    onDummyHit(shooter, target, dmg, zone, distance, st.id);
    hitFeedback(shooter, zone === "head" ? "head" : "hit", dmg);
    impactEntity(target.dimension, point, false);
    emitEvent("hit", { shooter, target, head: zone === "head", distance, weaponId: st.id, dummy: true });
    return "hit";
  }
  const health = safe("hasHealth", () => target.getComponent("minecraft:health"));
  if (!health) return "pass";
  if (!canDamage(shooter, target)) return "pass";
  const tt = target.typeId;
  // 設置式シールド：弾を止めて耐久が減る
  if (tt === `${NS}:shield_wall`) {
    dealDamage(shooter, target, (o.baseDmg ?? st.dmg) * mul * 0.6, { weaponId: st.id });
    emit(target.dimension, "arsenal:impact_spark", point, undefined, { range: 40 });
    playNear(target.dimension, point, "arsenal.armor.helmet_ping", { range: 24, volume: 0.6 });
    return "block";
  }
  const en = enemyOf(target);
  // シールド兵：正面からの弾はほとんど止める
  if (en && en.frontBlock) {
    const f = target.getViewDirection();
    if (dot({ x: f.x, y: 0, z: f.z }, { x: -dir.x, y: 0, z: -dir.z }) > 0.45 && hitZone(target, point) !== "leg") {
      emit(target.dimension, "arsenal:impact_spark", point, undefined, { range: 40 });
      playNear(target.dimension, point, "arsenal.armor.helmet_ping", { range: 24, volume: 0.6, pitch: 0.8 });
      if (shooter instanceof Player) hitFeedback(shooter, "hit", 0);
      return "block";
    }
  }
  // ライオットシールド（オフハンド）：正面からの弾を止める
  if (target instanceof Player && hasRiotShieldFacing(target, dir)) {
    emit(target.dimension, "arsenal:impact_spark", point, undefined, { range: 40 });
    playNear(target.dimension, point, "arsenal.armor.helmet_ping", { range: 24, volume: 0.8 });
    return "block";
  }
  let zone = o.noZones ? "body" : hitZone(target, point);
  let dmg = (o.baseDmg ?? st.dmg) * rangeMul(st, distance) * mul * WS().damageMul;
  const hm = 1 + (st.head - 1) * WS().headMul;
  if (zone === "head") dmg *= hm * (target instanceof Player ? helmetHeadMul(target) : 1);
  else if (zone === "leg") dmg *= 0.75;
  const armored = isArmored(target);
  dmg *= armored ? (st.vsArmored ?? 1) * (st.armorBonus ?? 1) : (st.vsUnarmored ?? 1);
  // ボスの部位破壊
  if (en && en.phases) dmg = bossPartHit(target, point, dmg);
  // 敵の射撃（難易度・倍率）
  if (isEnemyAI(shooter)) dmg *= enemyDamageMul();
  dmg = armorReduce(target, dmg, st.ap);
  if (target instanceof Player) dmg = absorbPlates(target, dmg);
  const knockPower = st.cat === "shotgun" ? 0.12 : st.cat === "sniper" ? 0.25 : 0.03;
  const r = dealDamage(shooter, target, dmg, { fire: (st.fireSecs || 0) + (o.extraFire || 0), weaponId: st.id, head: zone === "head", knock: dir, knockPower, dist: distance, kind: "gun" });
  const robot = en && ["robot", "shield_bot", "mortar_bot", "drone", "juggernaut"].includes(en.model);
  if (en && en.faction === "hollow") emit(target.dimension, "arsenal:ichor", point, undefined, { range: 40, blood: true });
  else impactEntity(target.dimension, point, !NON_FLESH.has(tt) && !robot && !tt.startsWith(`${NS}:`) || (!!en && !robot));
  if (!o.silent) {
    playNear(target.dimension, point, robot ? "arsenal.melee.hit_metal" : "arsenal.fx.impact_flesh", { range: 16, volume: 0.6 });
  }
  if (st.mark > 0 && target.isValid) marked.set(target.id, system.currentTick + st.mark);
  if (shooter instanceof Player) {
    if (r.killed) {
      hitFeedback(shooter, "kill", r.dealt);
      killFeed(shooter, target, st.id, zone === "head");
    } else {
      hitFeedback(shooter, zone === "head" ? "head" : "hit", r.dealt);
    }
  }
  emitEvent("hit", { shooter, target, head: zone === "head", distance, weaponId: st.id, dealt: r.dealt });
  return "hit";
}

let enemyMul = 1;
/** 敵の弾の倍率（難易度）。AI が設定する @param {number} v */
export function setEnemyDamageMul(v) {
  enemyMul = v;
}
/** 敵の弾の倍率（難易度とワールド設定） */
export function enemyDamageMul() {
  return enemyMul;
}

/** @type {(target:import("@minecraft/server").Entity, point:import("../util/math.js").Vec3, dmg:number)=>number} */
let bossPartHit = (_t, _p, d) => d;
/** @param {(target:import("@minecraft/server").Entity, point:import("../util/math.js").Vec3, dmg:number)=>number} fn */
export function setBossPartHandler(fn) {
  bossPartHit = fn;
}

/**
 * ヒットマーカー（HUD と音）
 * @param {import("@minecraft/server").Entity} shooter @param {"hit"|"head"|"kill"} kind @param {number} dmg
 */
export function hitFeedback(shooter, kind, dmg) {
  if (!(shooter instanceof Player)) return;
  const s = S(shooter);
  const now = system.currentTick;
  const prev = s.hit && now - s.hit.tick < 6 ? s.hit.dmg : 0;
  s.hit = { tick: now, kind: s.hit && s.hit.kind === "kill" && now - s.hit.tick < 12 ? "kill" : kind, dmg: prev + dmg };
  s.hudDirty = true;
  const snd = kind === "kill" ? "arsenal.fx.kill" : kind === "head" ? "arsenal.fx.headshot" : "arsenal.fx.hit";
  playTo(shooter, snd, { volume: kind === "hit" ? 0.55 : 0.8 });
}

/**
 * キルログ
 * @param {import("@minecraft/server").Entity} killer @param {import("@minecraft/server").Entity} victim @param {string|null} weaponId @param {boolean} head
 */
export function killFeed(killer, victim, weaponId, head) {
  if (!WS().killFeed) return;
  if (!(killer instanceof Player)) return;
  safe("killFeed", () => {
    const victimName = victim instanceof Player ? { text: victim.name } : victim.nameTag ? { text: victim.nameTag } : { translate: victim.localizationKey };
    const msg = raw(
      "§6",
      { text: killer.name },
      " §7[",
      weaponId ? itemName(weaponId) : t("arsenal.ui.explosive"),
      "§7] §f",
      victimName,
      head ? " §c" : "",
      head ? t("arsenal.ui.headshot") : "",
    );
    if (victim instanceof Player) world.sendMessage(msg);
    else killer.sendMessage(msg);
  });
}

/** 死亡の帰属とキルの通知（エンジン経由の死亡をすべてここで扱う） */
export function attachDeathHandler() {
  world.afterEvents.entityDie.subscribe((ev) => {
    safe("entityDie", () => {
      const src = ev.damageSource;
      const victim = ev.deadEntity;
      const info = lastAttacker.get(victim.id);
      const contrib = contributors.get(victim.id);
      lastAttacker.delete(victim.id);
      lastEngineHit.delete(victim.id);
      contributors.delete(victim.id);
      marked.delete(victim.id);
      let killer = src.damagingEntity;
      // 設置物（砲台）や投射物のキルは持ち主へ
      if (killer && killer.typeId.startsWith(`${NS}:`) && !(killer instanceof Player)) {
        const own = safe("killer.own", () => killer?.getDynamicProperty("a:own"));
        if (typeof own === "string") {
          const op = world.getEntity(own);
          if (op instanceof Player) killer = op;
        }
      }
      if (!killer && info && system.currentTick - info.tick < 100) killer = world.getEntity(info.shooterId);
      const explosive = src.cause === EntityDamageCause.entityExplosion || src.cause === EntityDamageCause.blockExplosion;
      if (killer instanceof Player && explosive && info && info.shooterId === killer.id && system.currentTick - info.tick < 60) {
        hitFeedback(killer, "kill", 0);
        killFeed(killer, victim, info.weaponId, false);
      }
      if (victim instanceof Player) emitEvent("death", { victim, killer, info });
      if (killer && killer.isValid !== false) {
        const kind = explosive ? "explosive" : info?.kind ?? (src.cause === EntityDamageCause.entityAttack && !info ? "melee" : "gun");
        emitEvent("kill", {
          killer, victim, victimType: victim.typeId, weaponId: info?.weaponId ?? null, head: !!info?.head,
          distance: info?.dist ?? 0, kind, pvp: victim instanceof Player && killer instanceof Player,
        });
        if (contrib && killer instanceof Player) {
          for (const [pid, tk] of contrib) {
            if (pid === killer.id || system.currentTick - tk > 200) continue;
            const ap = world.getEntity(pid);
            if (ap instanceof Player) emitEvent("assist", { player: ap, victim });
          }
        }
      }
    });
  });
}

/** エンジンの爆発ダメージを受けた記録（entityId → tick） */
const explosionHurt = new Map();

/** 爆発の被弾を記録し、撃った本人へヒットマーカーを出す／エンジン経由のダメージにプレートと横取りを効かせる */
export function attachExplosionTracking() {
  world.afterEvents.entityHurt.subscribe((ev) => {
    safe("explosionHurt", () => {
      const c = ev.damageSource.cause;
      if (c !== EntityDamageCause.entityExplosion && c !== EntityDamageCause.blockExplosion) return;
      const e = ev.hurtEntity;
      explosionHurt.set(e.id, system.currentTick);
      const src = ev.damageSource.damagingEntity;
      if (src instanceof Player && src.id !== e.id && ev.damage > 0) hitFeedback(src, "hit", ev.damage);
    });
  });
  const before = /** @type {any} */ (world.beforeEvents).entityHurt;
  if (before && typeof before.subscribe === "function") {
    before.subscribe((/** @type {any} */ ev) => {
      try {
        const e = ev.hurtEntity;
        if (!(e instanceof Player)) return;
        if (scriptLethal.has(e.id)) return;
        const hp = e.getComponent("minecraft:health")?.currentValue ?? 20;
        let dmg = ev.damage;
        const c = ev.damageSource?.cause;
        if (c === EntityDamageCause.projectile || c === EntityDamageCause.entityAttack || c === EntityDamageCause.entityExplosion || c === EntityDamageCause.blockExplosion) {
          const after = absorbPlates(e, dmg, true);
          if (after < dmg) {
            dmg = after;
            ev.damage = after;
          }
        }
        if (dmg >= hp - 0.01 && lethalGuards.length) {
          const attacker = ev.damageSource?.damagingEntity;
          // before イベントでは世界を変えられないので、横取りの判定だけ行い、処理は次の tick に回す
          const handled = guardLethal(e, attacker, { engine: true, cause: c });
          if (handled) ev.cancel = true;
        }
      } catch {
        /* before イベント内の例外は握りつぶす */
      }
    });
  }
}

/**
 * 遮蔽率（爆心から対象の 3 点へのレイがどれだけ通るか）
 * @param {import("@minecraft/server").Dimension} dim @param {import("../util/math.js").Vec3} loc @param {import("@minecraft/server").Entity} e
 */
function exposure(dim, loc, e) {
  const box = e.getAABB();
  const pts = [box.center, { x: box.center.x, y: box.center.y + box.extent.y * 0.8, z: box.center.z }, { x: box.center.x, y: box.center.y - box.extent.y * 0.8, z: box.center.z }];
  let open = 0;
  for (const pt of pts) {
    const v = { x: pt.x - loc.x, y: pt.y - loc.y, z: pt.z - loc.z };
    const L = Math.hypot(v.x, v.y, v.z);
    if (L < 0.3) {
      open++;
      continue;
    }
    const d = { x: v.x / L, y: v.y / L, z: v.z / L };
    const hit = safe("exposure", () => dim.getBlockFromRay(loc, d, { maxDistance: L - 0.2, includeLiquidBlocks: false, includePassableBlocks: false }));
    if (!hit) open++;
  }
  return open / pts.length;
}

/**
 * 爆風ダメージ（スクリプト側の式）
 * @param {import("@minecraft/server").Entity|undefined} shooter @param {import("@minecraft/server").Entity} e @param {import("../util/math.js").Vec3} loc @param {number} radius @param {number} d @param {number} impact @param {string|null} weaponId
 */
function blastOne(shooter, e, loc, radius, d, impact, weaponId) {
  const box = e.getAABB();
  const dmg = ((impact * impact + impact) / 2) * 7 * radius + 1;
  if (e.typeId === ENTITY.dummy) {
    if (shooter instanceof Player) {
      onDummyHit(shooter, e, dmg * WS().damageMul, "body", d, weaponId ?? "explosive");
      hitFeedback(shooter, "hit", dmg * WS().damageMul);
    }
    return;
  }
  if (!e.getComponent("minecraft:health")) return;
  if (shooter && !canDamage(shooter, e)) return;
  let final = armorReduce(e, dmg * WS().damageMul * (shooter && isEnemyAI(shooter) ? enemyDamageMul() : 1), 0);
  if (e instanceof Player) final = absorbPlates(e, final);
  if (shooter) {
    const r = dealDamage(shooter, e, final, { weaponId: weaponId ?? undefined, knock: { x: box.center.x - loc.x, y: 0, z: box.center.z - loc.z }, knockPower: 0.15 * impact, kind: "explosive" });
    if (shooter instanceof Player) {
      if (r.killed) {
        hitFeedback(shooter, "kill", r.dealt);
        killFeed(shooter, e, weaponId, false);
      } else hitFeedback(shooter, "hit", r.dealt);
    }
  } else {
    e.applyDamage(final, { cause: EntityDamageCause.blockExplosion });
  }
}

/**
 * 爆発
 *   エンジンの爆発（ブロック破壊・ノックバック・ダメージ）を起こし、次の tick に
 *   エンジンのダメージが入らなかった対象（射撃練習ターゲットや、エンジン側の判定から漏れた対象）へ
 *   同じ式の爆風ダメージを与える。二重には当たらない。
 * @param {import("@minecraft/server").Dimension} dim @param {import("../util/math.js").Vec3} loc @param {number} power
 * @param {import("@minecraft/server").Entity|undefined} source @param {boolean} breaks @param {boolean} fire @param {string|null} weaponId
 */
export function explode(dim, loc, power, source, breaks, fire, weaponId) {
  const now = system.currentTick;
  if (!isLoaded(dim, loc, now)) return;
  const radius = power * 2;
  /** @type {import("@minecraft/server").Entity[]} */
  let near = [];
  safe("explode.scan", () => {
    near = dim.getEntities({ location: loc, maxDistance: radius + 1.5, excludeFamilies: ["inanimate", "arsenal_fx"], excludeTypes: ["minecraft:item", "minecraft:xp_orb"] });
    if (source && source.isValid) {
      for (const e of near) lastAttacker.set(e.id, { shooterId: source.id, weaponId, tick: now, kind: "explosive" });
    }
  });
  safe("explode.dummies", () => {
    for (const e of dim.getEntities({ location: loc, maxDistance: radius + 1.5, type: ENTITY.dummy })) near.push(e);
  });
  safe("explode", () => {
    dim.createExplosion(loc, power, { breaksBlocks: breaks, causesFire: fire, source: source && source.isValid ? source : undefined, allowUnderwater: true });
  });
  const shooter = source && source.isValid ? source : undefined;
  system.runTimeout(() => safe("explode.fallback", () => {
    for (const e of near) {
      if (!e.isValid) continue;
      const hurtAt = explosionHurt.get(e.id);
      if (hurtAt !== undefined && hurtAt >= now) continue;
      if (shooter && e.id === shooter.id) continue;
      const box = e.getAABB();
      const d = Math.hypot(box.center.x - loc.x, box.center.y - loc.y, box.center.z - loc.z);
      if (d >= radius) continue;
      const exp = exposure(dim, loc, e);
      if (exp <= 0) continue;
      blastOne(shooter, e, loc, radius, d, (1 - d / radius) * exp, weaponId);
    }
    if (explosionHurt.size > 256) {
      for (const [id, tk] of explosionHurt) if (system.currentTick - tk > 40) explosionHurt.delete(id);
    }
  }), 1);
}

/**
 * 小さな炸裂（ブロックを壊さない・エンジンの爆発を使わない）：炸裂弾・プラズマ・子弾
 * @param {import("@minecraft/server").Entity|undefined} shooter @param {import("../util/math.js").Vec3} loc @param {number} radius @param {number} dmg @param {string|null} weaponId
 */
export function miniBlast(shooter, loc, radius, dmg, weaponId) {
  const dim = shooter?.dimension;
  if (!dim || !isLoaded(dim, loc, system.currentTick)) return;
  explosionFx(dim, loc, Math.max(0.6, radius * 0.5));
  safe("miniBlast", () => {
    for (const e of dim.getEntities({ location: loc, maxDistance: radius + 1, excludeFamilies: ["inanimate", "arsenal_fx"], excludeTypes: ["minecraft:item", "minecraft:xp_orb"] })) {
      if (shooter && e.id === shooter.id) continue;
      const c = e.getAABB().center;
      const d = dist(c, loc);
      if (d > radius) continue;
      if (!e.getComponent("minecraft:health") || (shooter && !canDamage(shooter, e))) continue;
      const k = 1 - d / (radius + 0.5);
      let final = armorReduce(e, dmg * k * WS().damageMul, 0.2);
      if (e instanceof Player) final = absorbPlates(e, final);
      if (shooter) {
        const r = dealDamage(shooter, e, final, { weaponId: weaponId ?? undefined, knock: norm(sub(c, loc)), knockPower: 0.08, kind: "explosive" });
        hitFeedback(shooter, r.killed ? "kill" : "hit", r.dealt);
      }
    }
  });
}

/**
 * 近接攻撃のダメージ（銃床打撃・近接武器の追加効果・投げナイフ）
 * @param {import("@minecraft/server").Entity} attacker @param {import("@minecraft/server").Entity} target @param {number} dmg @param {string} weaponId @param {{ap?:number, fire?:number, head?:boolean}} [o]
 */
export function meleeDamage(attacker, target, dmg, weaponId, o = {}) {
  if (!canDamage(attacker, target) || !target.getComponent("minecraft:health")) return { dealt: 0, killed: false };
  let d = armorReduce(target, dmg * WS().damageMul, o.ap ?? 0);
  if (target instanceof Player) d = absorbPlates(target, d);
  const r = dealDamage(attacker, target, d, { weaponId, fire: o.fire, head: o.head, kind: "melee", knock: norm(sub(target.location, attacker.location)), knockPower: 0.2 });
  if (attacker instanceof Player) {
    hitFeedback(attacker, r.killed ? "kill" : o.head ? "head" : "hit", r.dealt);
    if (r.killed) killFeed(attacker, target, weaponId, !!o.head);
  }
  return r;
}

/**
 * エンジンが与えるダメージ（近接武器の素のダメージなど）の帰属を記録する
 * @param {import("@minecraft/server").Entity} target @param {import("@minecraft/server").Entity} attacker @param {string} weaponId @param {string} kind
 */
export function noteAttack(target, attacker, weaponId, kind) {
  const now = system.currentTick;
  lastAttacker.set(target.id, { shooterId: attacker.id, weaponId, tick: now, head: false, dist: dist(attacker.location, target.location), kind });
  if (attacker instanceof Player) {
    let c = contributors.get(target.id);
    if (!c) contributors.set(target.id, (c = new Map()));
    c.set(attacker.id, now);
  }
}

/** マーキング中か @param {string} id */
export function isMarked(id) {
  const m = marked.get(id);
  return m !== undefined && m > system.currentTick;
}

/** @param {string} id */
export function forgetEntity(id) {
  lastEngineHit.delete(id);
  lastAttacker.delete(id);
  contributors.delete(id);
  marked.delete(id);
}
