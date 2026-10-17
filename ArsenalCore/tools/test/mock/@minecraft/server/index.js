// テスト用の @minecraft/server モック（ARSENAL CORE のロジック検証専用。ゲームには含めない）
export const EquipmentSlot = { Mainhand: "Mainhand", Offhand: "Offhand", Head: "Head", Chest: "Chest", Legs: "Legs", Feet: "Feet" };
export const EntityDamageCause = { entityAttack: "entityAttack", entityExplosion: "entityExplosion", blockExplosion: "blockExplosion", projectile: "projectile", override: "override" };
export const GameMode = { Survival: "Survival", Creative: "Creative", Adventure: "Adventure", Spectator: "Spectator" };
export const CameraShakeType = { Positional: "Positional", Rotational: "Rotational" };
export const EasingType = { OutQuad: "OutQuad", Linear: "Linear" };
export const ButtonState = { Pressed: "Pressed", Released: "Released" };
export const InputButton = { Jump: "Jump", Sneak: "Sneak" };
export const LiquidType = { Water: "Water" };
export const EntityInitializationCause = { Spawned: "Spawned", Loaded: "Loaded", Born: "Born", Event: "Event", Transformed: "Transformed" };
export const PlayerPermissionLevel = { Visitor: 0, Member: 1, Operator: 2, Custom: 3 };
export const CommandPermissionLevel = { Any: 0, GameDirectors: 1, Admin: 2, Host: 3, Owner: 4 };
export const DisplaySlotId = { Sidebar: "Sidebar", List: "List", BelowName: "BelowName" };
export const ItemLockMode = { inventory: "inventory", slot: "slot", none: "none" };

export const LOG = { api: { blockRay: 0, entityRay: 0, getEntities: 0, getBlock: 0 }, events: [], placed: [], cameras: [], commands: [], particles: 0, particleIds: {}, sounds: {}, damage: [], explosions: [], anims: [], animOpts: [], fov: [], actionbar: [], titles: [], subtitles: [], spawned: [], messages: [], heldWrites: 0, shakes: [], lights: [], early: [] };

// 実機の「早期実行」：モジュールの読み込み中と beforeEvents.startup の中では、
// ワールドの状態に触れるネイティブ関数が例外を投げる。worldLoad（または最初の tick）で解除。
let early = true;
function assertNotEarly(name) {
  if (!early) return;
  LOG.early.push({ name, stack: new Error().stack?.split("\n").slice(2, 8).join("\n") });
  throw new Error(`Native function [World::${name}] cannot be used in early execution.`);
}
export function __endEarly() { early = false; }
/** テスト用：早期実行の制限を無視してワールドのダイナミックプロパティを仕込む（「前回のセッションで保存済み」の再現） */
export function __seedWorldProp(k, v) { dynProps[k] = v; }
// 使用中（押しっぱなし）に手持ちのアイテムを書き換えた回数を数えるためのフック
export const __use = { holdingSlot: -1 };

function signal() {
  const subs = [];
  return {
    subs,
    subscribe(fn) { subs.push(fn); return fn; },
    unsubscribe(fn) { const i = subs.indexOf(fn); if (i >= 0) subs.splice(i, 1); },
    fire(ev) { for (const f of subs) f(ev); },
  };
}
const sigProxy = () => new Proxy({}, { get(t, k) { if (!t[k]) t[k] = signal(); return t[k]; } });

let idc = 1;
const FAMILIES = { "arsenal:projectile": ["arsenal_fx", "inanimate"], "arsenal:target_dummy": ["inanimate", "arsenal_target"], "minecraft:item": ["inanimate"], "minecraft:zombie": ["monster", "mob", "zombie"] };
/** エンティティの種族（テスト側が globalThis.__familyOf で上書きできる） */
export function familiesOf(e) {
  if (e._families) return e._families;
  const f = globalThis.__familyOf?.(e.typeId);
  if (f) return f;
  return FAMILIES[e.typeId] ?? (e.typeId === "minecraft:player" ? ["player"] : ["mob"]);
}
const entities = new Map();

export class MolangVariableMap {
  constructor() { this.v = {}; }
  setFloat(n, x) { this.v[n] = x; }
  setColorRGB(n, c) { this.v[n] = c; }
  setColorRGBA(n, c) { this.v[n] = c; }
  setSpeedAndDirection(n, s, d) { if (!isFinite(s) || !isFinite(d.x)) throw new Error("NaN molang"); this.v[n] = { s, d }; }
  setVector3(n, x) { this.v[n] = x; }
}

const DUR = { vx9: 1500 };
export class ItemStack {
  constructor(typeId, amount = 1) {
    if (typeof typeId !== "string") typeId = typeId.id;
    this.typeId = typeId;
    this.amount = amount;
    this.props = {};
    this.lore = [];
    const isGun = globalThis.__WEAPON_IDS?.has(typeId.replace("arsenal:", ""));
    this.maxAmount = isGun || typeId.includes("field_manual") || typeId.includes("detonator") ? 1 : 64;
    this.isStackable = this.maxAmount > 1;
    this.dur = isGun ? { damage: 0, maxDurability: DUR[typeId] ?? 3000 } : null;
  }
  getDynamicProperty(k) { return this.props[k]; }
  setDynamicProperty(k, v) { if (v === undefined) delete this.props[k]; else this.props[k] = v; }
  setDynamicProperties(o) { for (const [k, v] of Object.entries(o)) this.setDynamicProperty(k, v); }
  getDynamicPropertyIds() { return Object.keys(this.props); }
  getLore() { return this.lore.map((l) => (typeof l === "string" ? l : JSON.stringify(l))); }
  getRawLore() { return this.lore; }
  setLore(l) { this.lore = l ?? []; }
  getComponent(id) { if (id === "minecraft:durability" && this.dur) return this.dur; return undefined; }
  clone() { const c = new ItemStack(this.typeId, this.amount); c.props = { ...this.props }; c.lore = [...this.lore]; if (this.dur) c.dur = { ...this.dur }; if (this.nameTag) c.nameTag = this.nameTag; c.lockMode = this.lockMode; c.keepOnDeath = this.keepOnDeath; return c; }
}

class ContainerSlot {
  constructor(c, i) { this.c = c; this.i = i; }
  get isValid() { return true; }
  getItem() { const it = this.c.items[this.i]; return it ? it.clone() : undefined; }
  setItem(it) { if (this.i === __use.holdingSlot) LOG.heldWrites++; this.c.items[this.i] = it ? it.clone() : undefined; }
  hasItem() { return !!this.c.items[this.i]; }
  get typeId() { return this.c.items[this.i]?.typeId; }
  getDynamicProperty(k) { return this.c.items[this.i]?.getDynamicProperty(k); }
  setDynamicProperty(k, v) { this.c.items[this.i]?.setDynamicProperty(k, v); }
  setDynamicProperties(o) { if (this.i === __use.holdingSlot) LOG.heldWrites++; this.c.items[this.i]?.setDynamicProperties(o); }
  setLore(l) { this.c.items[this.i]?.setLore(l); }
  getLore() { return this.c.items[this.i]?.getLore() ?? []; }
}

export class Container {
  constructor(n) { this.size = n; this.items = new Array(n).fill(undefined); }
  get isValid() { return true; }
  getItem(i) { const it = this.items[i]; return it ? it.clone() : undefined; }
  setItem(i, it) { if (i === __use.holdingSlot) LOG.heldWrites++; this.items[i] = it ? it.clone() : undefined; }
  getSlot(i) { return new ContainerSlot(this, i); }
  addItem(it) {
    let left = it.amount;
    for (let i = 0; i < this.size && left > 0; i++) {
      const cur = this.items[i];
      if (cur && cur.typeId === it.typeId && cur.amount < cur.maxAmount) {
        const n = Math.min(left, cur.maxAmount - cur.amount); cur.amount += n; left -= n;
      }
    }
    for (let i = 0; i < this.size && left > 0; i++) {
      if (!this.items[i]) { const c = it.clone(); c.amount = Math.min(left, c.maxAmount); left -= c.amount; this.items[i] = c; }
    }
    if (left > 0) { const r = it.clone(); r.amount = left; return r; }
    return undefined;
  }
  get emptySlotsCount() { return this.items.filter((x) => !x).length; }
}

export class Entity {
  constructor(typeId, loc, dim, hp = 20) {
    this.id = String(idc++);
    this.typeId = typeId;
    this.location = { ...loc };
    this.dimension = dim;
    this._valid = true;
    this.nameTag = "";
    this.localizationKey = `entity.${typeId}.name`;
    this.health = hp > 0 ? { currentValue: hp, effectiveMax: hp, setCurrentValue(v) { this.currentValue = v; return true; }, resetToMaxValue() { this.currentValue = this.effectiveMax; } } : null;
    this.events = [];
    this.comps = {};
    this.height = 1.9; this.width = 0.6;
    this.tags = new Set();
    this.effects = {};
    this.props = {};
    this.isSneaking = false; this.isOnGround = true; this.isFlying = false; this.isSprinting = false; this.isInWater = false;
    this.vel = { x: 0, y: 0, z: 0 };
    this.rot = { x: 0, y: 0 };
    entities.set(this.id, this);
  }
  get isValid() { return this._valid; }
  getComponent(id) {
    if (id === "minecraft:health") return this.health ?? undefined;
    return this.comps[id];
  }
  triggerEvent(n) { this.events.push(n); LOG.events.push({ id: this.id, typeId: this.typeId, n }); }
  getAABB() { return { center: { x: this.location.x, y: this.location.y + this.height / 2, z: this.location.z }, extent: { x: this.width / 2, y: this.height / 2, z: this.width / 2 } }; }
  getHeadLocation() { return { x: this.location.x, y: this.location.y + this.height * 0.85, z: this.location.z }; }
  getViewDirection() { const p = this.rot.x * Math.PI / 180, y = this.rot.y * Math.PI / 180; return { x: -Math.sin(y) * Math.cos(p), y: -Math.sin(p), z: Math.cos(y) * Math.cos(p) }; }
  getRotation() { return { ...this.rot }; }
  setRotation(r) { this.rot = { ...r }; }
  getVelocity() { return { ...this.vel }; }
  applyDamage(n, opt) {
    if (!this.health) return false;
    LOG.damage.push({ target: this.typeId, n, cause: opt?.cause });
    this.health.currentValue = Math.max(0, this.health.currentValue - n);
    if (this.health.currentValue <= 0) { this._valid = false; world.afterEvents.entityDie.fire({ deadEntity: this, damageSource: { cause: opt?.cause, damagingEntity: opt?.damagingEntity } }); }
    return true;
  }
  applyKnockback() {}
  applyImpulse() {}
  setOnFire() { return true; }
  extinguishFire() { return true; }
  getEffect(id) { return this.effects[id]; }
  addEffect(id, d, o) { this.effects[id] = { duration: d, amplifier: o?.amplifier ?? 0 }; return this.effects[id]; }
  removeEffect(id) { delete this.effects[id]; return true; }
  setProperty(k, v) { this.props[k] = v; }
  getProperty(k) { return this.props[k]; }
  teleport(l, o) { this.location = { x: l.x, y: l.y, z: l.z }; if (o?.dimension) this.dimension = o.dimension; }
  remove() { if (!this._valid && !entities.has(this.id)) return; this._valid = false; entities.delete(this.id); world.afterEvents.entityRemove.fire({ removedEntityId: this.id, typeId: this.typeId }); }
  playAnimation(n, o) { LOG.anims.push(n); LOG.animOpts.push({ n, o }); }
  getTags() { return [...this.tags]; }
  hasTag(t) { return this.tags.has(t); }
  addTag(t) { this.tags.add(t); return true; }
  removeTag(t) { return this.tags.delete(t); }
  getDynamicProperty(k) { return this.props["dp:" + k]; }
  setDynamicProperty(k, v) { this.props["dp:" + k] = v; }
  matches(o) { if (o?.families) return o.families.some((f) => familiesOf(this).includes(f)); return true; }
  runCommand(c) { return { successCount: 1 }; }
}

class Camera {
  setCamera(preset, o) { LOG.cameras.push({ preset, o }); }
  setFov(o) { LOG.fov.push(o?.fov ?? "reset"); }
  addShake(o) { LOG.shakes.push(o); }
  stopShaking() {}
  fade() {}
  clear() {}
}

export class Player extends Entity {
  constructor(dim) {
    super("minecraft:player", { x: 0.5, y: 64, z: 0.5 }, dim, 20);
    this.name = "Tester";
    this.height = 1.8;
    this.inv = new Container(36);
    this.selectedSlotIndex = 0;
    this.camera = new Camera();
    this.onScreenDisplay = { setActionBar: (m) => LOG.actionbar.push(m), setTitle: (t, o) => LOG.titles.push({ t, o }), updateSubtitle: (t) => LOG.subtitles.push(t) };
    this.buttons = { Jump: "Released", Sneak: "Released" };
    this.inputInfo = { getButtonState: (b) => this.buttons[b] };
    this.gm = "Survival";
    this.move = { currentValue: 0.1, setCurrentValue(v) { this.currentValue = v; return true; }, resetToDefaultValue() { this.currentValue = 0.1; } };
    this.playerPermissionLevel = 2;
    this.commandPermissionLevel = 0;
    this.eqSlots = {};
    this.equip = {
      totalArmor: 0, totalToughness: 0,
      getEquipment: (s) => (s === "Mainhand" ? this.inv.getItem(this.selectedSlotIndex) : this.eqSlots[s]?.clone()),
      setEquipment: (s, it) => { if (s === "Mainhand") this.inv.setItem(this.selectedSlotIndex, it); else this.eqSlots[s] = it ? it.clone() : undefined; return true; },
    };
    this.clientSystemInfo = { platformType: "Desktop" };
    this.riding = null;
  }
  getHeadLocation() { return { x: this.location.x, y: this.location.y + 1.62, z: this.location.z }; }
  getComponent(id) {
    if (id === "minecraft:inventory") return { container: this.inv };
    if (id === "minecraft:equippable") return this.equip;
    if (id === "minecraft:movement") return this.move;
    if (id === "minecraft:riding") return this.riding ? { entityRidingOn: this.riding } : undefined;
    return super.getComponent(id);
  }
  getGameMode() { return this.gm; }
  setGameMode(g) { this.gm = g; }
  playSound(s) { LOG.sounds[s] = (LOG.sounds[s] ?? 0) + 1; }
  spawnParticle(id, loc, v) { if (!isFinite(loc.x) || !isFinite(loc.y) || !isFinite(loc.z)) throw new Error("NaN particle " + id); LOG.particles++; LOG.particleIds[id] = (LOG.particleIds[id] ?? 0) + 1; }
  sendMessage(m) { LOG.messages.push(m); }
}

function rayAABB(o, d, e) {
  const b = e.getAABB();
  let tmin = -Infinity, tmax = Infinity;
  for (const k of ["x", "y", "z"]) {
    const lo = b.center[k] - b.extent[k], hi = b.center[k] + b.extent[k];
    if (Math.abs(d[k]) < 1e-9) { if (o[k] < lo || o[k] > hi) return null; continue; }
    let t1 = (lo - o[k]) / d[k], t2 = (hi - o[k]) / d[k];
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
  }
  if (tmax < Math.max(0, tmin)) return null;
  return Math.max(0, tmin);
}

class Block {
  constructor(dim, loc, typeId) { this.dimension = dim; this.location = loc; this.x = loc.x; this.y = loc.y; this.z = loc.z; this.typeId = typeId; }
  get isAir() { return this.typeId === "minecraft:air"; }
  get isLiquid() { return false; }
  canBeDestroyedByLiquidSpread() { return this.typeId === "minecraft:short_grass"; }
  get isValid() { return true; }
  setType(t) { this.typeId = typeof t === "string" ? t : t.id; this.dimension.blocks.set(key(this.location), this.typeId); if (this.typeId.startsWith("minecraft:light_block")) LOG.lights.push({ ...this.location }); }
  above() { return this.dimension.getBlock({ x: this.x, y: this.y + 1, z: this.z }); }
  below() { return this.dimension.getBlock({ x: this.x, y: this.y - 1, z: this.z }); }
  getComponent(id) { if (id === "minecraft:inventory") { const c = this.dimension.containers.get(key(this.location)); return c ? { container: c } : undefined; } return undefined; }
  get permutation() { const st = this.dimension.states.get(key(this.location)) ?? {}; return { getState: (k) => st[k], type: { id: this.typeId } }; }
}
const key = (l) => `${Math.floor(l.x)},${Math.floor(l.y)},${Math.floor(l.z)}`;

export class Dimension {
  constructor(id) { this.id = id; this.blocks = new Map(); this.containers = new Map(); this.states = new Map(); this.heightRange = { min: -64, max: 320 }; this.loadedRadius = 160; }
  // 原点から loadedRadius ブロック以内のチャンクだけが読み込まれている想定。外に触ると実機と同じ例外を投げる
  isChunkLoaded(l) { return Math.abs(l.x) <= this.loadedRadius && Math.abs(l.z) <= this.loadedRadius; }
  __assertLoaded(l) {
    if (!this.isChunkLoaded(l) || l.y < this.heightRange.min || l.y >= this.heightRange.max) {
      const e = new Error(`Trying to access location (${l.x.toFixed(1)}, ${l.y.toFixed(1)}, ${l.z.toFixed(1)}) which is not in a chunk currently loaded and ticking.`);
      e.name = "LocationInUnloadedChunkError";
      LOG.unloadedAccess = (LOG.unloadedAccess ?? 0) + 1;
      throw e;
    }
  }
  blockAt(l) { const k = key(l); if (this.blocks.has(k)) return this.blocks.get(k); return Math.floor(l.y) < 64 ? "minecraft:stone" : "minecraft:air"; }
  getBlock(l) { LOG.api.getBlock++; this.__assertLoaded(l); const p = { x: Math.floor(l.x), y: Math.floor(l.y), z: Math.floor(l.z) }; return new Block(this, p, this.blockAt(p)); }
  getBlockFromRay(o, d, opt) {
    LOG.api.blockRay++;
    const max = opt?.maxDistance ?? 64;
    this.__assertLoaded(o);
    this.__assertLoaded({ x: o.x + d.x * max, y: o.y + d.y * max, z: o.z + d.z * max });
    for (let t = 0; t <= max; t += 0.05) {
      const p = { x: o.x + d.x * t, y: o.y + d.y * t, z: o.z + d.z * t };
      const ty = this.blockAt(p);
      if (ty !== "minecraft:air" && !ty.startsWith("minecraft:light_block") && ty !== "minecraft:fire") {
        const b = new Block(this, { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) }, ty);
        const fx = p.x - b.x, fy = p.y - b.y, fz = p.z - b.z;
        const dists = { West: fx, East: 1 - fx, Down: fy, Up: 1 - fy, North: fz, South: 1 - fz };
        const face = Object.entries(dists).sort((a, b2) => a[1] - b2[1])[0][0];
        return { block: b, face, faceLocation: { x: fx, y: fy, z: fz } };
      }
    }
    return undefined;
  }
  getEntitiesFromRay(o, d, opt) {
    LOG.api.entityRay++;
    const max = opt?.maxDistance ?? 64;
    const out = [];
    for (const e of entities.values()) {
      if (!e.isValid || e.dimension !== this) continue;
      if (opt?.excludeTypes?.includes(e.typeId)) continue;
      if (e.typeId === "arsenal:projectile") continue;
      const t = rayAABB(o, d, e);
      if (t !== null && t <= max) out.push({ entity: e, distance: t });
    }
    return out;
  }
  getEntities(opt = {}) {
    LOG.api.getEntities++;
    const fam = familiesOf;
    return [...entities.values()].filter((e) => e.isValid && e.dimension === this && (!opt.type || e.typeId === opt.type)
      && (!opt.families || opt.families.every((f) => fam(e).includes(f)))
      && (!opt.excludeTypes || !opt.excludeTypes.includes(e.typeId))
      && (!opt.excludeFamilies || !fam(e).some((f) => opt.excludeFamilies.includes(f)))
      && (!opt.location || Math.hypot(e.location.x - opt.location.x, e.location.y - opt.location.y, e.location.z - opt.location.z) <= (opt.maxDistance ?? 1e9)));
  }
  getPlayers(opt = {}) { return this.getEntities(opt).filter((e) => e instanceof Player); }
  spawnEntity(id, l) {
    this.__assertLoaded(l);
    const hp = id === "arsenal:projectile" ? 1 : globalThis.__healthOf?.(id) ?? 20;
    const e = new Entity(id, l, this, hp);
    globalThis.__onSpawnEntity?.(e);
    LOG.spawned.push(id);
    // 実機と同じく after イベントは後で届く（次の tick の頭）
    timeouts.push({ fn: () => world.afterEvents.entitySpawn.fire({ entity: e, cause: "Spawned" }), at: system.currentTick });
    return e;
  }
  spawnItem(it, l) { const e = new Entity("minecraft:item", l, this, 0); e.item = it; return e; }
  spawnParticle(id, loc) { if (!isFinite(loc.x)) throw new Error("NaN"); LOG.particles++; }
  playSound() {}
  // エンジンの爆発はこのモックではダメージを与えない（スクリプト側の爆風ダメージを検証するため）
  createExplosion(l, p, o) { this.__assertLoaded(l); LOG.explosions.push({ l, p, o }); return true; }
  runCommand(c) { LOG.commands.push(c); return { successCount: 1 }; }
}

const overworld = new Dimension("minecraft:overworld");
const dynProps = {};
export const world = {
  afterEvents: sigProxy(),
  beforeEvents: sigProxy(),
  _gameRules: { pvp: true, mobGriefing: true },
  get gameRules() { assertNotEarly("gameRules"); return this._gameRules; },
  players: [],
  getAllPlayers() { assertNotEarly("getAllPlayers"); return this.players.filter((p) => p.isValid); },
  getPlayers() { return this.getAllPlayers(); },
  getDimension() { assertNotEarly("getDimension"); return overworld; },
  getEntity(id) { assertNotEarly("getEntity"); return entities.get(id); },
  getDynamicProperty(k) { assertNotEarly("getDynamicProperty"); return dynProps[k]; },
  setDynamicProperty(k, v) { assertNotEarly("setDynamicProperty"); dynProps[k] = v; },
  sendMessage(m) { assertNotEarly("sendMessage"); LOG.messages.push(m); },
  getDefaultSpawnLocation() { assertNotEarly("getDefaultSpawnLocation"); return { x: 0, y: 64, z: 0 }; },
  getDynamicPropertyIds() { assertNotEarly("getDynamicPropertyIds"); return Object.keys(dynProps); },
  timeOfDay: 6000,
  getTimeOfDay() { assertNotEarly("getTimeOfDay"); return this.timeOfDay; },
  getAbsoluteTime() { assertNotEarly("getAbsoluteTime"); return system.currentTick + 24000 * 3; },
  structureManager: { place(name, dim, loc, o) { LOG.placed.push({ name, loc, o }); globalThis.__onPlace?.(name, dim, loc); } },
  scoreboard: (() => {
    const objs = new Map();
    return {
      objs,
      getObjective(id) { assertNotEarly("scoreboard"); return objs.get(id); },
      addObjective(id, name) { assertNotEarly("scoreboard"); const scores = new Map(); const o = { id, name, scores, setScore(p, v) { scores.set(p, v); }, getScore(p) { return scores.get(p); } }; objs.set(id, o); return o; },
      removeObjective(id) { objs.delete(typeof id === "string" ? id : id.id); return true; },
      setObjectiveAtDisplaySlot() { return undefined; },
    };
  })(),
};

const intervals = [];
let handleSeq = 1000;
const timeouts = [];
export const system = {
  currentTick: 0,
  beforeEvents: sigProxy(),
  afterEvents: sigProxy(),
  runInterval(fn, n = 1) { const h = ++handleSeq; intervals.push({ fn, n, h }); return h; },
  runTimeout(fn, d = 1) { timeouts.push({ fn, at: this.currentTick + Math.max(1, d) }); return timeouts.length; },
  run(fn) { timeouts.push({ fn, at: this.currentTick + 1 }); return 0; },
  waitTicks(n) { return new Promise((r) => this.runTimeout(r, n)); },
  clearRun(h) { const i = intervals.findIndex((x) => x.h === h); if (i >= 0) intervals.splice(i, 1); },
};

// worldLoad の購読者が呼ばれる時点で早期実行は終わっている
{
  const wl = world.afterEvents.worldLoad;
  const fire0 = wl.fire.bind(wl);
  wl.fire = (ev) => { early = false; fire0(ev); };
}

export function __tick(n = 1) {
  early = false;
  for (let i = 0; i < n; i++) {
    system.currentTick++;
    for (const t of timeouts.filter((x) => x.at <= system.currentTick)) { timeouts.splice(timeouts.indexOf(t), 1); t.fn(); }
    for (const iv of [...intervals]) if (system.currentTick % iv.n === 0) iv.fn();
  }
}
export const __overworld = overworld;
export const __entities = entities;
