// @ts-check
/**
 * ボス：ウォーロード（レイダーズ）とジャガーノート・マーク II（レギオン）
 *
 *  ・体力の割合で段階（phase）が進み、段階ごとに使う行動が増える（DATA.BOSSES.*.actions）
 *  ・大技は必ず予兆（音・地面の印・画面の文字）を出してから撃つ（warn tick）
 *  ・ジャガーノートは部位破壊（左右のミサイルポッド・胸部装甲）。部位を壊すとその行動が止まる／装甲が外れる
 *  ・段階と部位の体力はボスのダイナミックプロパティ a:boss に保存（ワールドを閉じても続きから）
 *  ・倒すと近くで戦ったプレイヤー全員に報酬（bossKill イベント → 経済・進行が受け取る）とレジェンダリー武器
 */
import { world, system, Player, ItemStack } from "@minecraft/server";
import { DATA, NS, enemyIdOf, enemyDef } from "../config/constants.js";
import { W as WS } from "../core/settings.js";
import { setBossPartHandler, explode, meleeDamage } from "../core/damage.js";
import { emitEvent } from "../core/events.js";
import { addThinkHook, aiFire, spawnEnemy, applyEmp, allAI, hasLos } from "./ai/brain.js";
import { fireMissile, throwAt } from "./projectiles.js";
import { initLootWeapon } from "./loot.js";
import { isCreative, consumeItem } from "../core/inventory.js";
import { emit, playNear, playTo, explosionFx } from "../fx/effects.js";
import { announce } from "../ui/hud2.js";
import { add, sub, mul, norm, dist, dot, basis, rand, isLoaded, loadedReach } from "../util/math.js";
import { t } from "../util/i18n.js";
import { safe } from "../util/log.js";

const BOSSES = /** @type {Record<string, any>} */ (DATA.BOSSES);

/**
 * @typedef {{phase:number, cd:Record<string,number>, parts:Record<string,number>, enraged:boolean, pending:{at:number, fn:()=>void}[], loaded:boolean, fighters:Map<string, number>}} BossState
 */
/** @type {Map<string, BossState>} */
const bosses = new Map();

/** @param {import("@minecraft/server").Entity} e */
function bossDef(e) {
  const id = enemyIdOf(e.typeId);
  return id && BOSSES[id] ? BOSSES[id] : undefined;
}

/** @param {import("@minecraft/server").Entity} e @param {any} def @returns {BossState} */
function stateOf(e, def) {
  let b = bosses.get(e.id);
  if (b) return b;
  b = { phase: 1, cd: {}, parts: {}, enraged: false, pending: [], loaded: false, fighters: new Map() };
  for (const [k, p] of Object.entries(def.parts ?? {})) b.parts[k] = /** @type {any} */ (p).hp;
  safe("boss.load", () => {
    const raw = e.getDynamicProperty("a:boss");
    if (typeof raw === "string") {
      const o = JSON.parse(raw);
      if (typeof o.phase === "number") b.phase = o.phase;
      if (o.parts) Object.assign(b.parts, o.parts);
      b.enraged = !!o.enraged;
    }
  });
  bosses.set(e.id, b);
  // 部位の見た目を合わせる
  if (def.parts) {
    safe("boss.parts.vis", () => {
      e.setProperty(`${NS}:pod_l`, (b.parts.left_pod ?? 1) > 0);
      e.setProperty(`${NS}:pod_r`, (b.parts.right_pod ?? 1) > 0);
      e.setProperty(`${NS}:core`, (b.parts.core ?? 1) > 0);
    });
  }
  return b;
}

/** @param {import("@minecraft/server").Entity} e @param {BossState} b */
function save(e, b) {
  safe("boss.save", () => e.setDynamicProperty("a:boss", JSON.stringify({ phase: b.phase, parts: b.parts, enraged: b.enraged })));
}

/** 近くのプレイヤー @param {import("@minecraft/server").Entity} e @param {number} r */
function playersNear(e, r) {
  return safe("boss.players", () => e.dimension.getPlayers({ location: e.location, maxDistance: r })) ?? [];
}

/**
 * 予兆つきで行動を予約
 * @param {BossState} b @param {number} ticks @param {()=>void} fn
 */
function later(b, ticks, fn) {
  b.pending.push({ at: system.currentTick + ticks, fn });
}

/**
 * 画面の文字で予兆（近くのプレイヤーへ）
 * @param {import("@minecraft/server").Entity} e @param {string} key
 */
function warnText(e, key) {
  for (const p of playersNear(e, 48)) {
    announce(p, { rawtext: [{ text: "§c" }, t(key)] }, 30);
  }
}

// ---------------------------------------------------------------------------
//  行動
// ---------------------------------------------------------------------------

/**
 * @param {import("@minecraft/server").Entity} e @param {any} def @param {BossState} b @param {string} act
 * @param {import("@minecraft/server").Entity} tg @param {import("./ai/brain.js").AI} ai
 */
function doAction(e, def, b, act, tg, ai) {
  const now = system.currentTick;
  const dim = e.dimension;
  switch (act) {
    case "volley":
    case "rotary": {
      const n = act === "rotary" ? 18 : 8;
      const gap = act === "rotary" ? 1 : 2;
      b.cd[act] = now + (act === "rotary" ? 140 : 110);
      playNear(dim, e.location, act === "rotary" ? "arsenal.fx.spin_up" : "arsenal.boss.warlord_roar", { range: 48, volume: 0.6 });
      for (let i = 0; i < n; i++) {
        later(b, 12 + i * gap, () => {
          if (!e.isValid || !tg.isValid) return;
          aiFire(e, ai, norm(sub(tg.getAABB().center, e.getHeadLocation())));
        });
      }
      return;
    }
    case "grenade": {
      b.cd.grenade = now + 160;
      const d = dist(tg.location, e.location);
      if (d < 5 || d > 24) return;
      for (let i = 0; i < (b.phase >= 3 ? 2 : 1); i++) {
        const aim = add(tg.location, { x: rand(-2, 2), y: 0, z: rand(-2, 2) });
        later(b, i * 8, () => e.isValid && throwAt(e, def.grenade ?? "grenade_frag", aim));
      }
      playNear(dim, e.location, "arsenal.fx.grenade_pin", { range: 24 });
      return;
    }
    case "reinforce": {
      const r = def.reinforce;
      b.cd.reinforce = now + r.cooldown;
      let alive = 0;
      for (const o of allAI().values()) if (o.ent.isValid && o.ent.hasTag(`arsenal_minion:${e.id}`)) alive++;
      const n = Math.min(r.count, 6 - alive);
      if (n <= 0) return;
      warnText(e, "arsenal.boss.reinforce");
      playNear(dim, e.location, "arsenal.ui.radio", { range: 64 });
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + rand(0, 1);
        const pos = { x: e.location.x + Math.cos(a) * 6, y: e.location.y + 0.5, z: e.location.z + Math.sin(a) * 6 };
        later(b, 20 + i * 6, () => {
          // 増援はボス戦の途中で消えないよう persist（ボスが倒れると wither で片づく）
          const m = spawnEnemy(dim, pos, r.ids[i % r.ids.length], { tag: `arsenal_minion:${e.id}`, src: "boss", persist: true });
          if (m) emit(dim, "arsenal:signal_smoke", pos, undefined, { range: 64 });
        });
      }
      return;
    }
    case "airstrike": {
      const s = def.airstrike;
      b.cd.airstrike = now + s.cooldown;
      const from = e.location;
      const to = tg.location;
      const dir = norm({ x: to.x - from.x, y: 0, z: to.z - from.z });
      const start = add(to, mul(dir, (-s.spacing * (s.shots - 1)) / 2));
      warnText(e, "arsenal.boss.airstrike");
      playNear(dim, to, "arsenal.world.klaxon", { range: 96 });
      /** @type {import("../util/math.js").Vec3[]} */
      const pts = [];
      for (let i = 0; i < s.shots; i++) pts.push(add(start, mul(dir, i * s.spacing)));
      for (const p of pts) emit(dim, "arsenal:target_marker", p, undefined, { range: 96 });
      later(b, Math.round(s.warn * 0.6), () => playNear(dim, to, "arsenal.world.jet", { range: 160 }));
      pts.forEach((p, i) => later(b, s.warn + i * 3, () => {
        const g = groundBelow(dim, p);
        if (g) explode(dim, g, s.power, e.isValid ? e : undefined, false, false, "boss_airstrike");
      }));
      return;
    }
    case "enrage": {
      if (b.enraged) return;
      b.enraged = true;
      save(e, b);
      safe("boss.enrage", () => {
        e.addEffect("speed", 20 * 600, { amplifier: 1, showParticles: false });
        e.addEffect("strength", 20 * 600, { amplifier: 1, showParticles: false });
      });
      playNear(dim, e.location, "arsenal.boss.warlord_roar", { range: 96, pitch: 0.7 });
      warnText(e, "arsenal.boss.enrage");
      return;
    }
    case "missiles": {
      const m = def.missiles;
      b.cd.missiles = now + m.cooldown;
      const pods = [];
      if ((b.parts.left_pod ?? 0) > 0) pods.push(-1);
      if ((b.parts.right_pod ?? 0) > 0) pods.push(1);
      if (!pods.length) return;
      playNear(dim, e.location, "arsenal.boss.servo", { range: 48 });
      emit(dim, "arsenal:telegraph", tg.location, undefined, { range: 64 });
      playTo(/** @type {any} */ (tg), "arsenal.fx.lock_on", { volume: 1 });
      for (let i = 0; i < m.count; i++) {
        const side = pods[i % pods.length];
        later(b, m.warn + i * 5, () => {
          if (!e.isValid || !tg.isValid) return;
          const { r } = basis(e.getViewDirection());
          const from = add(add(e.location, { x: 0, y: 2.9, z: 0 }), mul(r, side * 0.9));
          fireMissile(e, from, add(norm(sub(tg.location, from)), { x: 0, y: 0.8, z: 0 }), { targetId: tg.id, power: m.power, speed: m.speed, weaponId: "boss_missile" });
          playNear(dim, from, "arsenal.fire.rocket", { range: 64, volume: 0.8 });
        });
      }
      return;
    }
    case "emp": {
      const s = def.emp;
      b.cd.emp = now + s.cooldown;
      if (dist(tg.location, e.location) > s.radius * 1.6) return;
      warnText(e, "arsenal.boss.emp");
      playNear(dim, e.location, "arsenal.boss.emp_charge", { range: 48 });
      for (let i = 0; i < 3; i++) later(b, i * Math.round(s.warn / 3), () => e.isValid && emit(dim, "arsenal:energy_ring", e.location, undefined, { range: 48 }));
      later(b, s.warn, () => {
        if (!e.isValid) return;
        playNear(dim, e.location, "arsenal.boss.emp_blast", { range: 64 });
        applyEmp(dim, e.location, s.radius, s.seconds * 20, e.id);
      });
      return;
    }
    case "blink": {
      // 3.0：煙を張って標的の横か後ろへ回り込む（予兆：煙と音。着いた所にも煙）
      const s = def.blink;
      b.cd.blink = now + s.cooldown;
      emit(dim, "arsenal:smoke_cloud", e.location, undefined, { range: 48 });
      playNear(dim, e.location, "arsenal.fx.smoke", { range: 32 });
      warnText(e, "arsenal.boss.blink");
      later(b, s.warn, () => {
        if (!e.isValid || !tg.isValid) return;
        const back = norm({ x: tg.location.x - e.location.x, y: 0, z: tg.location.z - e.location.z });
        const a = Math.atan2(back.z, back.x) + rand(-1.2, 1.2);
        const r = rand(s.range[0], s.range[1]);
        const to = groundBelow(dim, { x: tg.location.x + Math.cos(a) * r, y: tg.location.y + 2, z: tg.location.z + Math.sin(a) * r });
        if (!to || Math.abs(to.y - tg.location.y) > 4) return;
        if (!hasLos(dim, add(to, { x: 0, y: 1.6, z: 0 }), tg.getAABB().center)) return;
        safe("boss.blink", () => e.teleport(to, { facingLocation: tg.location }));
        emit(dim, "arsenal:smoke_cloud", to, undefined, { range: 48 });
        playNear(dim, to, "arsenal.fx.smoke", { range: 32 });
      });
      return;
    }
    case "stomp": {
      const s = def.stomp;
      if (dist(tg.location, e.location) > s.radius * 1.4) return;
      b.cd.stomp = now + s.cooldown;
      emit(dim, "arsenal:telegraph", e.location, undefined, { range: 48 });
      playNear(dim, e.location, "arsenal.boss.servo", { range: 32, pitch: 0.6 });
      later(b, s.warn, () => {
        if (!e.isValid) return;
        playNear(dim, e.location, "arsenal.boss.stomp", { range: 48 });
        explosionFx(dim, e.location, 1.2);
        emit(dim, "arsenal:sonic_ring", add(e.location, { x: 0, y: 0.2, z: 0 }), undefined, { range: 48 });
        for (const p of playersNear(e, s.radius)) {
          if (!p.isOnGround) continue; // ジャンプでかわせる
          meleeDamage(e, p, s.damage, "boss_stomp");
          const v = norm(sub(p.location, e.location));
          safe("boss.stomp.kb", () => p.applyKnockback({ x: v.x * 1.4, z: v.z * 1.4 }, 0.6));
        }
      });
      return;
    }
  }
}

/** @param {import("@minecraft/server").Dimension} dim @param {import("../util/math.js").Vec3} p */
export function groundBelow(dim, p) {
  const from = { x: p.x, y: p.y + 12, z: p.z };
  if (!isLoaded(dim, from, system.currentTick)) return null;
  const reach = loadedReach(dim, from, { x: 0, y: -1, z: 0 }, 30, system.currentTick);
  const hit = reach > 0 ? safe("boss.ground", () => dim.getBlockFromRay(from, { x: 0, y: -1, z: 0 }, { maxDistance: reach, includeLiquidBlocks: true, includePassableBlocks: false })) : undefined;
  return hit ? { x: p.x, y: hit.block.location.y + 1, z: p.z } : { x: p.x, y: p.y, z: p.z };
}

// ---------------------------------------------------------------------------
//  思考（AI の思考に割り込む）
// ---------------------------------------------------------------------------

/** @param {import("./ai/brain.js").AI} ai @param {number} now */
function bossThink(ai, now) {
  const def = ai.def;
  if (!def.phases) return false;
  const e = ai.ent;
  const b = stateOf(e, def);
  const h = e.getComponent("minecraft:health");
  const hp01 = h ? h.currentValue / Math.max(1, h.effectiveMax) : 1;
  // 段階
  let phase = 1;
  for (let i = 0; i < def.phases.length; i++) if (hp01 <= def.phases[i] + 1e-6) phase = i + 1;
  if (phase > b.phase) {
    b.phase = phase;
    save(e, b);
    playNear(e.dimension, e.location, def.faction === "legion" ? "arsenal.boss.juggernaut_roar" : "arsenal.boss.warlord_roar", { range: 96 });
    for (const p of playersNear(e, 64)) {
      announce(p, { rawtext: [{ text: "§c" }, { translate: `entity.${NS}:${ai.eid}.name` }, { text: " §7- §f" }, t("arsenal.boss.phase", String(phase))] }, 40);
    }
    b.cd = {}; // 段階が変わったら大技をすぐ使える
    b.cd.volley = now + 40;
  }
  if (ai.stunUntil > now || ai.empUntil > now) return false;
  const tg = ai.target ? world.getEntity(ai.target) : undefined;
  if (!tg || !tg.isValid) return false;
  if (tg instanceof Player) b.fighters.set(tg.id, now);
  // 1 回の思考で 1 つだけ大技を選ぶ（予約中の大技があれば待つ）
  if (b.pending.length > 4) return false;
  const acts = def.actions[b.phase] ?? def.actions[1];
  const ready = acts.filter((/** @type {string} */ a) => (b.cd[a] ?? 0) <= now && (a !== "enrage" || !b.enraged));
  if (!ready.length) return false;
  const act = ready[Math.floor(Math.random() * ready.length)];
  if ((act === "volley" || act === "rotary") && !hasLos(e.dimension, e.getHeadLocation(), tg.getAABB().center)) return false;
  doAction(e, def, b, act, tg, ai);
  return false;
}

/** 予約した行動の実行（毎 tick） */
export function tickBosses() {
  const now = system.currentTick;
  for (const [id, b] of bosses) {
    if (!b.pending.length) continue;
    const due = b.pending.filter((p) => p.at <= now);
    if (!due.length) continue;
    b.pending = b.pending.filter((p) => p.at > now);
    for (const p of due) safe(`boss.act.${id}`, p.fn);
  }
}

// ---------------------------------------------------------------------------
//  部位破壊
// ---------------------------------------------------------------------------

/**
 * @param {import("@minecraft/server").Entity} target @param {import("../util/math.js").Vec3} point @param {number} dmg
 */
function partHit(target, point, dmg) {
  const def = bossDef(target);
  if (!def || !def.parts) return dmg;
  const b = stateOf(target, def);
  const box = target.getAABB();
  const rel = (point.y - (box.center.y - box.extent.y)) / Math.max(0.01, box.extent.y * 2);
  const { r, f } = basis(target.getViewDirection());
  const off = sub(point, box.center);
  const side = dot(off, r);
  const front = dot(off, f);
  /** @type {string|null} */
  let part = null;
  if (rel > 0.72 && Math.abs(side) > box.extent.x * 0.35) part = side < 0 ? "left_pod" : "right_pod";
  else if (rel > 0.4 && rel <= 0.8 && front > 0) part = "core";
  const coreUp = (b.parts.core ?? 0) > 0;
  if (!part || (b.parts[part] ?? 0) <= 0) return coreUp ? dmg * 0.6 : dmg * 1.25;
  b.parts[part] = Math.max(0, b.parts[part] - dmg);
  emit(target.dimension, "arsenal:impact_spark", point, undefined, { range: 48 });
  if (b.parts[part] <= 0) {
    save(target, b);
    const prop = part === "left_pod" ? "pod_l" : part === "right_pod" ? "pod_r" : "core";
    safe("boss.part.off", () => target.setProperty(`${NS}:${prop}`, false));
    explosionFx(target.dimension, point, 1.4);
    playNear(target.dimension, point, "arsenal.fx.explosion", { range: 64 });
    for (const p of playersNear(target, 48)) {
      safe("boss.part.msg", () => p.sendMessage({ rawtext: [{ text: "§e" }, t("arsenal.boss.part_broken", { translate: `arsenal.boss.part.${part}` })] }));
    }
    return dmg * 1.5;
  }
  return dmg * 0.5;
}

// ---------------------------------------------------------------------------
//  報酬・召喚
// ---------------------------------------------------------------------------

/** @param {string} maxTier @param {string} [minTier] */
function randomWeapon(maxTier, minTier) {
  const order = /** @type {any} */ (DATA.TIERS);
  const lo = minTier ? order[minTier].order : 0;
  const hi = order[maxTier].order;
  const ids = Object.entries(DATA.WEAPONS).filter(([, w]) => order[/** @type {any} */ (w).tier].order >= lo && order[/** @type {any} */ (w).tier].order <= hi).map(([id]) => id);
  return ids[Math.floor(Math.random() * ids.length)];
}

/**
 * @param {import("@minecraft/server").Entity} dead @param {any} def
 */
function reward(dead, def) {
  const dim = dead.dimension;
  const loc = dead.location;
  const b = bosses.get(dead.id);
  bosses.delete(dead.id);
  const now = system.currentTick;
  /** @type {Player[]} */
  const fighters = [];
  for (const p of dim.getPlayers({ location: loc, maxDistance: 64 })) {
    const t0 = b?.fighters.get(p.id);
    if (t0 !== undefined && now - t0 < 20 * 120) fighters.push(p);
    else if (dist(p.location, loc) < 32) fighters.push(p);
  }
  for (let i = 0; i < (def.reward.legendary ?? 1); i++) {
    const wid = randomWeapon("legendary", "legendary");
    if (!wid) continue;
    const it = new ItemStack(`${NS}:${wid}`, 1);
    initLootWeapon(it, true);
    safe("boss.drop", () => dim.spawnItem(it, add(loc, { x: 0, y: 1, z: 0 })));
  }
  emit(dim, "arsenal:signal_smoke", loc, undefined, { range: 96 });
  playNear(dim, loc, "arsenal.ui.levelup", { range: 64 });
  emitEvent("bossKill", { bossId: enemyIdOf(dead.typeId), players: fighters, credits: def.reward.credits, xp: def.reward.xp, location: loc });
  for (const p of fighters) {
    announce(p, { rawtext: [{ text: "§6" }, t("arsenal.boss.defeated", { translate: `entity.${NS}:${enemyIdOf(dead.typeId)}.name` })] }, 60);
  }
  // 手下は朽ちて倒れる（増援は persist なので、体力 26 の兵でも確実に倒れる強さにする）
  for (const o of allAI().values()) {
    if (o.ent.isValid && o.ent.hasTag(`arsenal_minion:${dead.id}`)) safe("boss.minion", () => o.ent.addEffect("wither", 400, { amplifier: 2 }));
  }
}

/**
 * ボスを呼び出す（アイテム使用）
 * @param {Player} player @param {string} bossId @param {string} itemId
 */
export function summonBoss(player, bossId, itemId) {
  const def = BOSSES[bossId];
  if (!def) return false;
  if (!WS().bosses) {
    player.sendMessage(t("arsenal.boss.disabled"));
    return false;
  }
  const dim = player.dimension;
  // 同じボスが近くにいるなら呼べない
  const near = safe("boss.near", () => dim.getEntities({ location: player.location, maxDistance: 128, type: `${NS}:${bossId}` })) ?? [];
  if (near.length) {
    player.sendMessage(t("arsenal.boss.already"));
    return false;
  }
  const v = player.getViewDirection();
  const at = groundBelow(dim, add(player.location, mul(norm({ x: v.x, y: 0, z: v.z }), 14)));
  if (!at) return false;
  if (!isCreative(player)) consumeItem(player, itemId, 1);
  playNear(dim, at, "arsenal.world.klaxon", { range: 128 });
  for (let i = 0; i < 4; i++) system.runTimeout(() => emit(dim, "arsenal:signal_smoke", at, undefined, { range: 96 }), i * 10);
  for (const p of dim.getPlayers({ location: at, maxDistance: 64 })) {
    announce(p, { rawtext: [{ text: "§4" }, t("arsenal.boss.incoming", { translate: `entity.${NS}:${bossId}.name` })] }, 50);
  }
  system.runTimeout(() => safe("boss.spawn", () => {
    const e = spawnEnemy(dim, at, bossId, { persist: true, src: "summon" });
    if (e) {
      explosionFx(dim, at, 1.5);
      playNear(dim, at, def.faction === "legion" ? "arsenal.boss.juggernaut_roar" : "arsenal.boss.warlord_roar", { range: 128 });
    }
  }), 60);
  return true;
}

export function attachBosses() {
  addThinkHook(bossThink);
  setBossPartHandler(partHit);
  world.afterEvents.entityDie.subscribe((ev) => {
    safe("boss.die", () => {
      const def = bossDef(ev.deadEntity);
      if (def) reward(ev.deadEntity, def);
    });
  });
  world.afterEvents.entityRemove.subscribe((ev) => {
    const b = bosses.get(ev.removedEntityId);
    if (b && !b.pending.length) bosses.delete(ev.removedEntityId);
  });
}

/** ボスの数（報告用） */
export function bossCount() {
  return bosses.size;
}

void enemyDef;
