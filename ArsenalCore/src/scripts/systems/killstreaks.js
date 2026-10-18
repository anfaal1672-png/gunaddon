// @ts-check
/**
 * キルストリーク（ワールド設定 killstreaks）
 *
 *  ・PvP／ゲームモード：死なずに kills 回倒すと、そのストリークが「使える」になる（死ぬと連続キルは 0。使えるものは残る）
 *  ・PvE：敵を倒すと tier に応じたポイントが貯まり、points 以上あれば使える（使うと減る）
 *  ・ストリーク端末（アイテム）で一覧から選んで使う。ゲームモードの設定（streaks:false）では使えない
 *  ・状態はプレイヤーのダイナミックプロパティ a:ks（{pts, ready:[...]}）
 */
import { world, system, Player, InputButton, ButtonState } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";
import { DATA, NS, ENTITY, enemyIdOf, enemyDef } from "../config/constants.js";
import { W as WS, explosionBreaksBlocks } from "../core/settings.js";
import { S } from "../core/state.js";
import { on, emitEvent } from "../core/events.js";
import { explode, miniBlast, canDamage } from "../core/damage.js";
import { applyEmp } from "./ai/brain.js";
import { dropSentry, markFor } from "./deployables.js";
import { rollLoot } from "./lootgen.js";
import { emit, playNear, playTo } from "../fx/effects.js";
import { announce } from "../ui/hud2.js";
import { add, mul, norm, isLoaded, rand, loadedReach, hitPoint } from "../util/math.js";
import { t, raw } from "../util/i18n.js";
import { safe } from "../util/log.js";

const KS = /** @type {Record<string, any>} */ (DATA.KILLSTREAKS);
const PTS = /** @type {Record<string, number>} */ (DATA.STREAK_POINTS);
const MAX_PTS = 400;

/** @type {(p:Player)=>boolean} ゲームモードがストリークを禁止するか */
let allowed = () => true;
/** @param {(p:Player)=>boolean} fn */
export function setStreakFilter(fn) {
  allowed = fn;
}

/** @type {Map<string, {pts:number, ready:Set<string>}>} */
const cache = new Map();

/** @param {Player} p */
function ks(p) {
  let c = cache.get(p.id);
  if (c) return c;
  c = { pts: 0, ready: new Set() };
  const raw0 = safe("ks.load", () => p.getDynamicProperty("a:ks"));
  if (typeof raw0 === "string") {
    safe("ks.parse", () => {
      const o = JSON.parse(raw0);
      c.pts = Math.max(0, Math.min(MAX_PTS, Number(o.pts) || 0));
      for (const r of o.ready ?? []) if (KS[r]) c.ready.add(r);
    });
  }
  cache.set(p.id, c);
  return c;
}

/** @param {Player} p */
function save(p) {
  const c = ks(p);
  safe("ks.save", () => p.setDynamicProperty("a:ks", JSON.stringify({ pts: Math.round(c.pts), ready: [...c.ready] })));
  const s = S(p);
  s.ksPts = c.pts;
  s.hudDirty = true;
}

/** @param {string} id */
export function forgetStreaks(id) {
  cache.delete(id);
}

/**
 * いま使えるストリーク
 * @param {Player} p
 */
export function available(p) {
  if (!WS().killstreaks || !allowed(p)) return [];
  const c = ks(p);
  return Object.keys(KS).filter((id) => c.ready.has(id) || c.pts >= KS[id].points);
}

/** HUD 2.0 の ks フィールド @param {Player} p */
export function streakReady(p) {
  return available(p).length > 0;
}

// ---------------------------------------------------------------------------
//  貯める
// ---------------------------------------------------------------------------

function attachCounting() {
  on("kill", (ev) => {
    const k = ev.killer;
    if (!(k instanceof Player) || !WS().killstreaks) return;
    const s = S(k);
    const c = ks(k);
    const before = available(k).length;
    s.streak++;
    if (ev.pvp || k.getTags().some((x) => x.startsWith("arsenal_mode:"))) {
      for (const [id, d] of Object.entries(KS)) if (s.streak === d.kills) c.ready.add(id);
    } else {
      const eid = enemyIdOf(ev.victimType ?? "");
      const tier = eid ? enemyDef(eid)?.tier ?? 1 : ev.victim?.typeId?.startsWith("minecraft:") ? 0 : 1;
      c.pts = Math.min(MAX_PTS, c.pts + (tier ? PTS[tier] ?? 10 : 4));
    }
    save(k);
    if (available(k).length > before && allowed(k)) {
      playTo(k, "arsenal.ui.streak_ready");
      announce(k, raw("§6", t("arsenal.ks.ready_msg")), 40);
    }
  });
  on("death", (ev) => {
    const v = ev.victim;
    if (!(v instanceof Player)) return;
    S(v).streak = 0;
    S(v).hudDirty = true;
  });
}

// ---------------------------------------------------------------------------
//  使う
// ---------------------------------------------------------------------------

/** 視線の先の地点（最大 160） @param {Player} p */
function aimPoint(p) {
  const eye = p.getHeadLocation();
  const v = p.getViewDirection();
  const reach = loadedReach(p.dimension, eye, v, 160, system.currentTick);
  if (reach <= 0) return null;
  const hit = safe("ks.aim", () => p.dimension.getBlockFromRay(eye, v, { maxDistance: reach, includeLiquidBlocks: true, includePassableBlocks: false }));
  if (hit) return add(hit.block.location, { x: 0.5, y: 1, z: 0.5 });
  return null;
}

/**
 * 端末を開く
 * @param {Player} p
 */
export async function openTerminal(p) {
  if (!WS().killstreaks) {
    p.sendMessage(t("arsenal.ks.disabled"));
    return;
  }
  if (!allowed(p)) {
    p.sendMessage(t("arsenal.ks.not_now"));
    return;
  }
  const c = ks(p);
  const ids = Object.keys(KS);
  const f = new ActionFormData().title(t("arsenal.ks.title")).body(raw(t("arsenal.ks.body", String(S(p).streak), String(Math.floor(c.pts)))));
  for (const id of ids) {
    const d = KS[id];
    const st = c.ready.has(id) ? "§a" : c.pts >= d.points ? "§e" : "§8";
    const cond = c.ready.has(id) ? t("arsenal.ks.ready") : t("arsenal.ks.cost", String(d.kills), String(d.points));
    f.button(raw(st, t(`arsenal.ks.${id}`), "\n§7", cond), `textures/ui/arsenal/ks_${id}`);
  }
  const s = S(p);
  s.menuOpen = true;
  const res = await f.show(/** @type {any} */ (p)).catch(() => undefined);
  s.menuOpen = false;
  if (!res || res.canceled || res.selection === undefined) return;
  const id = ids[res.selection];
  if (!id) return;
  useStreak(p, id);
}

/**
 * ストリークを使う（端末・テスト）
 * @param {Player} p @param {string} id
 * @returns {boolean}
 */
export function useStreak(p, id) {
  const d = KS[id];
  if (!d || !WS().killstreaks || !allowed(p)) return false;
  const c = ks(p);
  const byToken = c.ready.has(id);
  if (!byToken && c.pts < d.points) {
    p.sendMessage(t("arsenal.ks.locked"));
    playTo(p, "arsenal.ui.error", { volume: 0.6 });
    return false;
  }
  let target = null;
  if (d.targeted) {
    target = aimPoint(p);
    if (!target) {
      p.sendMessage(t("arsenal.ks.no_target"));
      return false;
    }
  }
  const ok = safe(`ks.${id}`, () => run(p, id, d, target)) ?? false;
  if (!ok) return false;
  if (byToken) c.ready.delete(id);
  else c.pts -= d.points;
  save(p);
  emitEvent("streakUsed", { player: p, id });
  playTo(p, "arsenal.ui.radio");
  for (const o of p.dimension.getPlayers({ location: p.location, maxDistance: 128 })) {
    safe("ks.announce", () => o.sendMessage(raw("§6", { text: p.name }, " §7» §f", t(`arsenal.ks.${id}`))));
  }
  return true;
}

/**
 * @param {Player} p @param {string} id @param {any} d @param {import("../util/math.js").Vec3|null} target
 */
function run(p, id, d, target) {
  const dim = p.dimension;
  switch (id) {
    case "recon": {
      recons.push({ owner: p.id, dim, pos: { ...p.location }, radius: d.radius, until: system.currentTick + d.seconds * 20 });
      playNear(dim, p.location, "arsenal.world.sonar", { range: 64 });
      emit(dim, "arsenal:sonic_ring", p.location, undefined, { range: 96 });
      return true;
    }
    case "supply_drop":
    case "turret_drop": {
      if (!target) return false;
      dropCrate(p, target, id, d);
      return true;
    }
    case "airstrike": {
      if (!target) return false;
      const v = p.getViewDirection();
      const dir = norm({ x: v.x, y: 0, z: v.z });
      const start = add(target, mul(dir, (-d.spacing * (d.shots - 1)) / 2));
      playNear(dim, target, "arsenal.world.klaxon", { range: 128 });
      for (let i = 0; i < d.shots; i++) {
        const pt = add(start, mul(dir, i * d.spacing));
        emit(dim, "arsenal:target_marker", pt, undefined, { range: 128 });
        system.runTimeout(() => safe("ks.air", () => {
          const g = ground(dim, pt);
          if (g) explode(dim, g, d.power, p.isValid ? p : undefined, explosionBreaksBlocks(), false, "ks_airstrike");
        }), d.warn + i * 3);
      }
      system.runTimeout(() => playNear(dim, target, "arsenal.world.jet", { range: 200 }), Math.round(d.warn * 0.6));
      return true;
    }
    case "emp_strike": {
      playNear(dim, p.location, "arsenal.boss.emp_charge", { range: 64 });
      system.runTimeout(() => safe("ks.emp", () => applyEmp(dim, p.location, d.radius, d.seconds * 20, p.id)), 20);
      return true;
    }
    case "gunship": {
      startGunship(p, d);
      return true;
    }
  }
  return false;
}

/** @param {import("@minecraft/server").Dimension} dim @param {import("../util/math.js").Vec3} p */
function ground(dim, p) {
  const from = { x: p.x, y: p.y + 20, z: p.z };
  if (!isLoaded(dim, from, system.currentTick)) return null;
  const hit = safe("ks.ground", () => dim.getBlockFromRay(from, { x: 0, y: -1, z: 0 }, { maxDistance: 60, includeLiquidBlocks: true, includePassableBlocks: false }));
  return hit ? { x: p.x, y: hit.block.location.y + 1, z: p.z } : p;
}

// ---------------------------------------------------------------------------
//  偵察（位置をあぶり出す）
// ---------------------------------------------------------------------------

/** @type {{owner:string, dim:import("@minecraft/server").Dimension, pos:import("../util/math.js").Vec3, radius:number, until:number}[]} */
let recons = [];

function tickRecon() {
  const now = system.currentTick;
  if (now % 20 !== 0) return;
  recons = recons.filter((r) => r.until > now);
  for (const r of recons) {
    const owner = world.getEntity(r.owner);
    if (!(owner instanceof Player)) continue;
    safe("recon", () => {
      for (const e of r.dim.getEntities({ location: owner.location, maxDistance: r.radius, excludeFamilies: ["inanimate", "arsenal_fx", "arsenal_deployable"], excludeTypes: ["minecraft:item", "minecraft:xp_orb"] })) {
        if (e.id === owner.id) continue;
        const hostile = !!enemyIdOf(e.typeId) || (e instanceof Player ? canDamage(owner, e) && e.getTags().some((x) => x.startsWith("arsenal_team:")) : false) || safe("recon.fam", () => e.matches({ families: ["monster"] }));
        if (!hostile) continue;
        markFor(e, 25);
        const at = add(e.getAABB().center, { x: 0, y: e.getAABB().extent.y + 0.6, z: 0 });
        safe("recon.p", () => owner.spawnParticle("arsenal:lock_marker", at));
      }
    });
  }
}

// ---------------------------------------------------------------------------
//  補給投下・砲台投下（空から箱が落ちてくる）
// ---------------------------------------------------------------------------

/** @type {{ent:import("@minecraft/server").Entity, owner:string, kind:string, landY:number, d:any}[]} */
let crates = [];

/**
 * @param {Player} p @param {import("../util/math.js").Vec3} target @param {string} kind @param {any} d
 */
function dropCrate(p, target, kind, d) {
  const dim = p.dimension;
  const g = ground(dim, target) ?? target;
  const start = { x: g.x, y: g.y + 30, z: g.z };
  if (!isLoaded(dim, start, system.currentTick)) return;
  const e = safe("ks.crate", () => dim.spawnEntity(ENTITY.crate, start));
  if (!e) return;
  safe("ks.crate.own", () => {
    e.setDynamicProperty("a:own", p.id);
    e.setDynamicProperty("a:kind", kind);
  });
  crates.push({ ent: e, owner: p.id, kind, landY: g.y, d });
  emit(dim, "arsenal:signal_smoke", g, undefined, { range: 128 });
  playNear(dim, g, "arsenal.world.drop_whistle", { range: 96 });
}

function tickCrates() {
  crates = crates.filter((c) => {
    const e = c.ent;
    if (!e.isValid) return false;
    const y = e.location.y;
    const speed = (30 / Math.max(20, c.d.fallTicks ?? 80));
    if (y - c.landY > speed + 0.01) {
      safe("crate.fall", () => e.teleport({ x: e.location.x, y: y - speed, z: e.location.z }));
      return true;
    }
    safe("crate.land", () => {
      e.teleport({ x: e.location.x, y: c.landY, z: e.location.z });
      e.setProperty(`${NS}:landed`, true);
    });
    playNear(e.dimension, e.location, "arsenal.fx.bounce", { range: 24, pitch: 0.5 });
    emit(e.dimension, "arsenal:impact_dust", e.location, undefined, { range: 48 });
    if (c.kind === "turret_drop") {
      const owner = world.getEntity(c.owner);
      if (owner instanceof Player) dropSentry(owner, e.location, c.d.seconds);
      safe("crate.rm", () => e.remove());
    }
    return false;
  });
}

/**
 * 補給箱を開ける（触る）
 * @param {Player} p @param {import("@minecraft/server").Entity} e
 */
function openCrate(p, e) {
  if (safe("crate.landed", () => e.getProperty(`${NS}:landed`)) !== true) return;
  const d = KS.supply_drop;
  const items = rollLoot(d.lootTier);
  if (Math.random() < d.bonusChance) items.push(...rollLoot(d.bonusTier).filter((i) => i.typeId !== "minecraft:bread").slice(0, 2));
  const loc = add(e.location, { x: 0, y: 0.6, z: 0 });
  safe("crate.open", () => e.remove());
  for (const it of items) safe("crate.item", () => p.dimension.spawnItem(it, loc));
  playNear(p.dimension, loc, "arsenal.mech.bolt_back", { range: 16, pitch: 0.7 });
}

// ---------------------------------------------------------------------------
//  ガンシップ（上空視点から機関砲）
// ---------------------------------------------------------------------------

/** @type {Map<string, {until:number, center:import("@minecraft/server").Vector3, camera:boolean, next:number, d:any}>} */
const gunships = new Map();

/** @param {Player} p @param {any} d */
function startGunship(p, d) {
  const now = system.currentTick;
  const center = { x: p.location.x, y: p.location.y + d.height, z: p.location.z };
  const cam = !!safe("gunship.cam", () => {
    p.camera.setCamera("minecraft:free", { location: center, rotation: { x: 70, y: p.getRotation().y } });
    return true;
  });
  gunships.set(p.id, { until: now + d.seconds * 20, center, camera: cam, next: now + 20, d });
  const s = S(p);
  s.gunshipUntil = now + d.seconds * 20;
  safe("gunship.guard", () => {
    p.addEffect("resistance", d.seconds * 20, { amplifier: 3, showParticles: false });
    p.addEffect("slowness", d.seconds * 20, { amplifier: 5, showParticles: false });
  });
  playNear(p.dimension, p.location, "arsenal.world.gunship", { range: 200 });
  p.sendMessage(t("arsenal.ks.gunship_hint"));
}

function tickGunships() {
  const now = system.currentTick;
  for (const [pid, g] of gunships) {
    const p = world.getEntity(pid);
    if (!(p instanceof Player) || !p.isValid || now >= g.until || p.isSneaking) {
      gunships.delete(pid);
      if (p instanceof Player) {
        S(p).gunshipUntil = 0;
        safe("gunship.clear", () => p.camera.clear());
        safe("gunship.fx", () => {
          p.removeEffect("slowness");
          p.removeEffect("resistance");
        });
      }
      continue;
    }
    // 上空をゆっくり旋回
    const ang = (now % 1200) / 1200 * Math.PI * 2;
    const eye = g.camera ? { x: g.center.x + Math.cos(ang) * 10, y: g.center.y, z: g.center.z + Math.sin(ang) * 10 } : p.getHeadLocation();
    if (g.camera) safe("gunship.cam2", () => p.camera.setCamera("minecraft:free", { location: eye, rotation: p.getRotation(), easeOptions: { easeTime: 0.05 } }));
    if (now % 60 === 0) playNear(p.dimension, g.center, "arsenal.world.gunship", { range: 200, volume: 0.6 });
    if (now < g.next) continue;
    const jump = safe("gunship.jump", () => p.inputInfo.getButtonState(InputButton.Jump) === ButtonState.Pressed) ?? false;
    if (!jump) continue;
    g.next = now + Math.max(2, Math.round(1200 / g.d.rpm));
    const v = p.getViewDirection();
    const dim = p.dimension;
    if (!isLoaded(dim, eye, now)) continue;
    const reach = loadedReach(dim, eye, v, 120, now);
    const hit = reach > 0 ? safe("gunship.ray", () => dim.getBlockFromRay(eye, v, { maxDistance: reach, includeLiquidBlocks: true, includePassableBlocks: false })) : undefined;
    const at = hit ? hitPoint(hit) : add(eye, mul(v, 80));
    const jitter = { x: rand(-0.8, 0.8), y: 0, z: rand(-0.8, 0.8) };
    const pt = add(at, jitter);
    emit(dim, "arsenal:tracer_trail", pt, undefined, { range: 96 });
    playNear(dim, eye, "arsenal.far.hmg", { range: 200, volume: 0.5 });
    miniBlast(p, pt, g.d.blast, g.d.damage, "ks_gunship");
  }
}

// ---------------------------------------------------------------------------

export function tickStreaks() {
  tickRecon();
  tickCrates();
  if (gunships.size) tickGunships();
}

export function attachStreaks() {
  attachCounting();
  world.afterEvents.playerInteractWithEntity.subscribe((ev) => safe("crate.interact", () => {
    if (ev.target.typeId === ENTITY.crate && safe("crate.kind", () => ev.target.getDynamicProperty("a:kind")) === "supply_drop") openCrate(ev.player, ev.target);
  }));
  world.afterEvents.playerSpawn.subscribe((ev) => safe("ks.spawn", () => {
    const c = ks(ev.player);
    S(ev.player).ksPts = c.pts;
  }));
}

/** テスト用：ポイントを足す @param {Player} p @param {number} n */
export function addStreakPoints(p, n) {
  const c = ks(p);
  c.pts = Math.min(MAX_PTS, c.pts + n);
  save(p);
}

