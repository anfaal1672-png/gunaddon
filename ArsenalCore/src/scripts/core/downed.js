// @ts-check
/**
 * ダウン制（ワールド設定「ダウン制」）：死ぬはずのダメージを受けると 30 秒間ダウンし、這って味方を待つ。
 * 味方が除細動器を使うと蘇生、時間切れで死亡。ダウン中にさらに致死ダメージを受けると死亡。
 */
import { system, world, Player, EntityDamageCause } from "@minecraft/server";
import { W as WS } from "./settings.js";
import { addLethalGuard } from "./damage.js";
import { playNear, playTo, emit } from "../fx/effects.js";
import { t } from "../util/i18n.js";
import { announce } from "../ui/hud2.js";
import { safe } from "../util/log.js";

const DOWN_TICKS = 600;

/** @type {Map<string, {until:number, since:number}>} */
const downed = new Map();
/** 死亡させる処理中（横取りしない） */
const finishing = new Set();

/** @type {(p:Player)=>boolean|null} ゲームモードがダウン制を上書きする（null で上書きなし） */
let modeOverride = () => null;
/** @param {(p:Player)=>boolean|null} fn */
export function setDownedOverride(fn) {
  modeOverride = fn;
}

/** @param {import("@minecraft/server").Entity} p */
export function isDowned(p) {
  const d = downed.get(p.id);
  return !!d && d.until > system.currentTick;
}

/** @param {Player} p */
function ruleActive(p) {
  const o = modeOverride(p);
  if (o !== null && o !== undefined) return o;
  return !!WS().downed;
}

/** @param {Player} p */
function enter(p) {
  const now = system.currentTick;
  downed.set(p.id, { until: now + DOWN_TICKS, since: now });
  safe("downed.enter", () => {
    const h = p.getComponent("minecraft:health");
    h?.setCurrentValue(Math.max(2, Math.min(4, h.effectiveMax)));
    p.addEffect("slowness", DOWN_TICKS, { amplifier: 3, showParticles: false });
    p.addEffect("weakness", DOWN_TICKS, { amplifier: 4, showParticles: false });
    p.addEffect("mining_fatigue", DOWN_TICKS, { amplifier: 3, showParticles: false });
    announce(p, { rawtext: [{ text: "§c" }, t("arsenal.ui.downed")] }, 60);
  });
  playNear(p.dimension, p.location, "arsenal.fx.flash_ring", { range: 16, volume: 0.4, pitch: 0.5 });
  world.sendMessage({ rawtext: [{ text: "§e" }, t("arsenal.ui.downed_msg", p.name)] });
}

/**
 * 蘇生
 * @param {Player} p @param {Player} [by]
 */
export function revive(p, by) {
  if (!downed.has(p.id)) return false;
  downed.delete(p.id);
  safe("downed.revive", () => {
    for (const e of ["slowness", "weakness", "mining_fatigue"]) p.removeEffect(e);
    const h = p.getComponent("minecraft:health");
    h?.setCurrentValue(Math.min(h.effectiveMax, 8));
    p.addEffect("regeneration", 60, { amplifier: 1, showParticles: true });
  });
  emit(p.dimension, "arsenal:heal", p.location, undefined, { range: 32 });
  playNear(p.dimension, p.location, "arsenal.gear.defib", { range: 24 });
  if (by) playTo(by, "arsenal.ui.challenge", { volume: 0.6 });
  return true;
}

/** @param {Player} p */
function finish(p) {
  downed.delete(p.id);
  finishing.add(p.id);
  safe("downed.finish", () => p.applyDamage(9999, { cause: EntityDamageCause.override }));
  finishing.delete(p.id);
}

export function attachDowned() {
  addLethalGuard((target, _attacker, info) => {
    if (!(target instanceof Player)) return false;
    if (finishing.has(target.id)) return false;
    if (isDowned(target)) return false;
    if (!ruleActive(target)) return false;
    if (info && info.engine) system.run(() => enter(target));
    else enter(target);
    return true;
  });
  world.afterEvents.entityDie.subscribe((ev) => {
    downed.delete(ev.deadEntity.id);
  }, { entityTypes: ["minecraft:player"] });
}

/** 毎秒：ダウン中の表示と時間切れ */
export function tickDowned() {
  const now = system.currentTick;
  for (const [id, d] of downed) {
    const p = world.getEntity(id);
    if (!(p instanceof Player) || !p.isValid) {
      downed.delete(id);
      continue;
    }
    if (now >= d.until) {
      finish(p);
      continue;
    }
    const left = Math.ceil((d.until - now) / 20);
    announce(p, { rawtext: [{ text: "§c" }, t("arsenal.ui.downed_left", String(left))] }, 30);
    emit(p.dimension, "arsenal:blood", p.location, undefined, { range: 24, blood: true, minQ: 1 });
  }
}

/** @param {string} id */
export function forgetDowned(id) {
  downed.delete(id);
}
