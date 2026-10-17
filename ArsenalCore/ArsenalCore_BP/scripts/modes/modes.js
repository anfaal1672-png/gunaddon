// @ts-check
/**
 * ゲームモード：フリー・フォー・オール／チームデスマッチ／ガンゲーム／ホード／陣取り
 *
 * 流れ
 *   OP がアリーナツールでアリーナ（範囲の 2 隅・スポーン地点・旗＝丘の位置）を登録 → モードとアリーナを選んで開始
 *   → ロビー（lobbySecs 秒。野戦マニュアル「ゲームモード」から参加）→ 開始時に参加者の持ち物・位置・ゲームモード・体力を保存
 *   → 装備セットを配布 → ラウンド → 結果 → 保存した状態に戻す
 *
 * 持ち物の保存：アリーナの中心に見えない保管庫（arsenal:storage、54 枠）を置き、ティッキングエリアで読み込んだままにする。
 *   プレイヤーには a:msave（保管庫の ID・元の位置・ゲームモードなど）を書く。退出・ワールドの再起動があっても、
 *   次に参加したときに a:msave を見て必ず戻す（再起動で試合そのものは中止）。
 * 死亡：参加者は死なない（致死ダメージを横取り）。キル・デスを数えて、観戦モードで待たせてからスポーン地点へ戻す。
 */
import { world, system, Player, ItemStack, GameMode, EquipmentSlot, DisplaySlotId, ItemLockMode } from "@minecraft/server";
import { ActionFormData, ModalFormData, FormCancelationReason } from "@minecraft/server-ui";
import { DATA, NS, ENTITY, ammoItemId, defaultVariant, weaponIdOf } from "../config/constants.js";
import { isOperator } from "../core/settings.js";
import { S } from "../core/state.js";
import { on, emitEvent } from "../core/events.js";
import { addLethalGuard } from "../core/damage.js";
import { setDownedOverride, forgetDowned } from "../core/downed.js";
import { computeStats, writeLore, PROP, W } from "../core/weaponState.js";
import { desiredTypeId, retype } from "../core/migrate.js";
import { setStreakFilter } from "../systems/killstreaks.js";
import { spawnEnemy, allAI } from "../systems/ai/brain.js";
import { addHud2Provider, announce } from "../ui/hud2.js";
import { playNear, playTo } from "../fx/effects.js";
import { dist, isLoaded } from "../util/math.js";
import { t, raw, itemName } from "../util/i18n.js";
import { safe, logError, info } from "../util/log.js";

const MODES = /** @type {Record<string, any>} */ (DATA.MODES);
const LOADOUTS = /** @type {Record<string, any>} */ (DATA.LOADOUTS);
const TEAMS = DATA.TEAMS;
const LIM = DATA.ARENA_LIMITS;
const GM_CODE = { ffa: "1", tdm: "2", gungame: "3", horde: "4", koth: "5" };
const ARENAS_KEY = "a:arenas";
const MATCH_KEY = "a:match";
const SAVE_KEY = "a:msave";
const OBJ = "arsenal_score";

/**
 * @typedef {{x:number,y:number,z:number}} V
 * @typedef {{id:string, name:string, dim:string, a:V|null, b:V|null, spawns:V[], hills:V[]}} Arena
 * @typedef {{kills:number, deaths:number, level:number, team:number, loadout:string, respawnAt:number, alive:boolean, name:string}} Part
 * @typedef {{mode:string, arenaId:string, phase:"lobby"|"live"|"end", parts:Map<string, Part>, teamScore:number[], lobbyUntil:number, startTick:number, endTick:number, wave:number, waveState:"break"|"fight", waveUntil:number, toSpawn:number, hill:number, hillMoveAt:number, storageId:string|null, center:V, restoreAt:number, winners:string[]}} Match
 */

/** @type {Match|null} */
let match = null;
/** @type {Arena[]|null} */
let arenasCache = null;

// ---------------------------------------------------------------------------
//  アリーナ
// ---------------------------------------------------------------------------

/** @returns {Arena[]} */
export function arenas() {
  if (arenasCache) return arenasCache;
  arenasCache = [];
  const r = safe("arena.load", () => world.getDynamicProperty(ARENAS_KEY));
  if (typeof r === "string") safe("arena.parse", () => {
    const a = JSON.parse(r);
    if (Array.isArray(a)) arenasCache = a;
  });
  return arenasCache;
}
function saveArenas() {
  safe("arena.save", () => world.setDynamicProperty(ARENAS_KEY, JSON.stringify(arenas())));
}

/** @param {Arena} a */
function arenaCenter(a) {
  if (!a.a || !a.b) return a.spawns[0] ?? { x: 0, y: 64, z: 0 };
  return { x: (a.a.x + a.b.x) / 2, y: Math.min(a.a.y, a.b.y) + 1, z: (a.a.z + a.b.z) / 2 };
}

/**
 * アリーナが使えるか（理由のキーを返す。使えれば null）
 * @param {Arena} a @param {string} mode
 */
export function arenaProblem(a, mode) {
  if (!a.a || !a.b) return "arsenal.mode.err_corners";
  const sx = Math.abs(a.a.x - a.b.x) + 1;
  const sz = Math.abs(a.a.z - a.b.z) + 1;
  if (Math.max(sx, sz) > LIM.maxSize) return "arsenal.mode.err_big";
  if (Math.min(sx, sz) < LIM.minSize) return "arsenal.mode.err_small";
  if (a.spawns.length < (mode === "horde" ? 1 : 2)) return "arsenal.mode.err_spawns";
  if (mode === "koth" && !a.hills.length) return "arsenal.mode.err_hill";
  return null;
}

/** @param {Arena} a @param {V} p */
function inside(a, p) {
  if (!a.a || !a.b) return true;
  const x0 = Math.min(a.a.x, a.b.x) - 1, x1 = Math.max(a.a.x, a.b.x) + 1;
  const z0 = Math.min(a.a.z, a.b.z) - 1, z1 = Math.max(a.a.z, a.b.z) + 1;
  const y0 = Math.min(a.a.y, a.b.y) - 8, y1 = Math.max(a.a.y, a.b.y) + 24;
  return p.x >= x0 && p.x <= x1 && p.z >= z0 && p.z <= z1 && p.y >= y0 && p.y <= y1;
}

/** @param {{x:number,y:number,z:number}} l */
const floorV = (l) => ({ x: Math.floor(l.x) + 0.5, y: Math.floor(l.y), z: Math.floor(l.z) + 0.5 });

// ---------------------------------------------------------------------------
//  フォーム
// ---------------------------------------------------------------------------

/**
 * @template {{canceled:boolean, cancelationReason?: any}} R
 * @param {Player} player @param {{show:(p:Player)=>Promise<R>}} form
 * @returns {Promise<R|undefined>}
 */
async function show(player, form) {
  const s = S(player);
  for (let i = 0; i < 20; i++) {
    try {
      s.menuOpen = true;
      const r = await form.show(player);
      s.menuOpen = false;
      if (r.canceled && r.cancelationReason === FormCancelationReason.UserBusy) {
        await system.waitTicks(4);
        continue;
      }
      return r;
    } catch (e) {
      s.menuOpen = false;
      logError("mode.form", e);
      return undefined;
    }
  }
  s.menuOpen = false;
  return undefined;
}

/** 編集中のアリーナ（プレイヤーごと） @type {Map<string, string>} */
const editing = new Map();

/**
 * アリーナツール（OP）
 * @param {Player} p
 */
export async function openArenaTool(p) {
  if (!isOperator(p)) {
    p.sendMessage(t("arsenal.ui.op_only"));
    return;
  }
  const list = arenas();
  let cur = list.find((a) => a.id === editing.get(p.id));
  const f = new ActionFormData().title(t("arsenal.mode.tool_title"));
  f.body(cur ? raw(t("arsenal.mode.tool_editing", cur.name), "\n§7", t("arsenal.mode.tool_info", String(cur.spawns.length), String(cur.hills.length), cur.a && cur.b ? "OK" : "--")) : t("arsenal.mode.tool_none"));
  const acts = [];
  f.button(t("arsenal.mode.tool_new")); acts.push("new");
  if (list.length) { f.button(t("arsenal.mode.tool_pick")); acts.push("pick"); }
  if (cur) {
    f.button(t("arsenal.mode.tool_corner_a")); acts.push("a");
    f.button(t("arsenal.mode.tool_corner_b")); acts.push("b");
    f.button(t("arsenal.mode.tool_spawn")); acts.push("spawn");
    f.button(t("arsenal.mode.tool_hill")); acts.push("hill");
    f.button(t("arsenal.mode.tool_clear")); acts.push("clear");
    f.button(raw("§c", t("arsenal.mode.tool_delete"))); acts.push("delete");
  }
  f.button(raw("§a", t("arsenal.mode.tool_start"))); acts.push("start");
  if (match) { f.button(raw("§c", t("arsenal.mode.tool_stop"))); acts.push("stop"); }
  const r = await show(p, f);
  if (!r || r.canceled || r.selection === undefined) return;
  const act = acts[r.selection];
  const here = floorV(p.location);
  switch (act) {
    case "new": {
      if (list.length >= LIM.maxArenas) {
        p.sendMessage(t("arsenal.mode.err_max", String(LIM.maxArenas)));
        return;
      }
      const m = new ModalFormData().title(t("arsenal.mode.tool_new")).textField(t("arsenal.mode.tool_name"), "arena", { defaultValue: `arena${list.length + 1}` });
      const r2 = await show(p, m);
      if (!r2 || r2.canceled || !r2.formValues) return;
      const name = String(r2.formValues[0] ?? "").replace(/[^\w\- ]/g, "").slice(0, 20) || `arena${list.length + 1}`;
      const a = { id: `a${Date.now().toString(36)}`, name, dim: p.dimension.id, a: here, b: null, spawns: [], hills: [] };
      list.push(a);
      editing.set(p.id, a.id);
      saveArenas();
      p.sendMessage(t("arsenal.mode.tool_created", name));
      return openArenaTool(p);
    }
    case "pick": {
      const f2 = new ActionFormData().title(t("arsenal.mode.tool_pick"));
      for (const a of list) f2.button(raw(a.name, "\n§8", `${Math.round(arenaCenter(a).x)}, ${Math.round(arenaCenter(a).z)}`));
      const r2 = await show(p, f2);
      if (!r2 || r2.canceled || r2.selection === undefined) return;
      editing.set(p.id, list[r2.selection].id);
      return openArenaTool(p);
    }
    case "a": case "b": {
      if (!cur) return;
      cur[act] = here;
      cur.dim = p.dimension.id;
      saveArenas();
      p.sendMessage(t("arsenal.mode.tool_set", act.toUpperCase(), `${here.x | 0} ${here.y} ${here.z | 0}`));
      return;
    }
    case "spawn": {
      if (!cur) return;
      if (cur.spawns.length >= LIM.maxSpawns) {
        p.sendMessage(t("arsenal.mode.err_spawn_max", String(LIM.maxSpawns)));
        return;
      }
      cur.spawns.push(here);
      saveArenas();
      p.sendMessage(t("arsenal.mode.tool_spawn_added", String(cur.spawns.length)));
      return;
    }
    case "hill": {
      if (!cur) return;
      cur.hills.push(here);
      saveArenas();
      p.sendMessage(t("arsenal.mode.tool_hill_added", String(cur.hills.length)));
      return;
    }
    case "clear": {
      if (!cur) return;
      cur.spawns = [];
      cur.hills = [];
      saveArenas();
      p.sendMessage(t("arsenal.mode.tool_cleared"));
      return;
    }
    case "delete": {
      if (!cur) return;
      arenasCache = list.filter((a) => a !== cur);
      editing.delete(p.id);
      saveArenas();
      p.sendMessage(t("arsenal.mode.tool_deleted"));
      return;
    }
    case "start": return openStart(p);
    case "stop": {
      endMatch(null, "arsenal.mode.stopped");
      return;
    }
  }
  void cur;
}

/** @param {Player} p */
async function openStart(p) {
  if (match) {
    p.sendMessage(t("arsenal.mode.err_running"));
    return;
  }
  const list = arenas();
  if (!list.length) {
    p.sendMessage(t("arsenal.mode.err_no_arena"));
    return;
  }
  const modes = Object.keys(MODES);
  const f = new ModalFormData()
    .title(t("arsenal.mode.tool_start"))
    .dropdown(t("arsenal.mode.pick_mode"), modes.map((m) => ({ translate: `arsenal.mode_name.${m}` })), { defaultValueIndex: 0 })
    .dropdown(t("arsenal.mode.pick_arena"), list.map((a) => a.name), { defaultValueIndex: Math.max(0, list.findIndex((a) => a.id === editing.get(p.id))) });
  const r = await show(p, f);
  if (!r || r.canceled || !r.formValues) return;
  const mode = modes[/** @type {number} */ (r.formValues[0])];
  const arena = list[/** @type {number} */ (r.formValues[1])];
  const prob = arenaProblem(arena, mode);
  if (prob) {
    p.sendMessage(raw("§c", t(prob)));
    return;
  }
  startLobby(mode, arena, p);
}

/**
 * 参加・装備セットの選択（野戦マニュアルから）
 * @param {Player} p
 */
export async function openModesMenu(p) {
  if (!match) {
    p.sendMessage(t("arsenal.mode.none"));
    if (isOperator(p)) return openArenaTool(p);
    return;
  }
  const m = match;
  const part = m.parts.get(p.id);
  const def = MODES[m.mode];
  const f = new ActionFormData().title({ translate: `arsenal.mode_name.${m.mode}` }).body(raw({ translate: `arsenal.mode_desc.${m.mode}` }, "\n\n§7", t("arsenal.mode.players", String(m.parts.size))));
  const acts = [];
  if (!part && m.phase === "lobby") { f.button(raw("§a", t("arsenal.mode.join"))); acts.push("join"); }
  if (part && m.phase === "lobby") { f.button(t("arsenal.mode.leave")); acts.push("leave"); }
  if (part && def.loadouts.length) { f.button(t("arsenal.mode.loadout")); acts.push("loadout"); }
  const r = await show(p, f);
  if (!r || r.canceled || r.selection === undefined) return;
  const act = acts[r.selection];
  if (act === "join") joinMatch(p);
  else if (act === "leave") {
    m.parts.delete(p.id);
    p.sendMessage(t("arsenal.mode.left"));
    saveMatch();
  } else if (act === "loadout" && part) {
    const f2 = new ActionFormData().title(t("arsenal.mode.loadout"));
    for (const l of def.loadouts) f2.button(raw(l === part.loadout ? "§a▶ " : "", { translate: `arsenal.loadout.${l}` }, "\n§8", itemName(LOADOUTS[l].primary)), `textures/items/arsenal/weapons/${LOADOUTS[l].primary}`);
    const r2 = await show(p, f2);
    if (!r2 || r2.canceled || r2.selection === undefined) return;
    part.loadout = def.loadouts[r2.selection];
    p.sendMessage(t("arsenal.mode.loadout_set", { translate: `arsenal.loadout.${part.loadout}` }));
  }
}

// ---------------------------------------------------------------------------
//  試合の進行
// ---------------------------------------------------------------------------

function saveMatch() {
  if (!match) {
    safe("match.clear", () => world.setDynamicProperty(MATCH_KEY, undefined));
    return;
  }
  const m = match;
  safe("match.save", () => world.setDynamicProperty(MATCH_KEY, JSON.stringify({ mode: m.mode, arenaId: m.arenaId, phase: m.phase, parts: [...m.parts.keys()], storageId: m.storageId, center: m.center })));
}

/** @returns {Arena|undefined} */
function curArena() {
  return match ? arenas().find((a) => a.id === match?.arenaId) : undefined;
}

/**
 * @param {string} mode @param {Arena} arena @param {Player} by
 */
export function startLobby(mode, arena, by) {
  const def = MODES[mode];
  const now = system.currentTick;
  match = {
    mode, arenaId: arena.id, phase: "lobby", parts: new Map(), teamScore: [0, 0], lobbyUntil: now + def.lobbySecs * 20, startTick: 0, endTick: 0,
    wave: 0, waveState: "break", waveUntil: 0, toSpawn: 0, hill: 0, hillMoveAt: 0, storageId: null, center: arenaCenter(arena), restoreAt: 0, winners: [],
  };
  saveMatch();
  world.sendMessage(raw("§6[ARSENAL] ", t("arsenal.mode.lobby_open", { translate: `arsenal.mode_name.${mode}` }, arena.name, String(def.lobbySecs))));
  for (const p of world.getAllPlayers()) playTo(p, "arsenal.ui.radio");
  joinMatch(by);
}

/** @param {Player} p */
export function joinMatch(p) {
  const m = match;
  if (!m || m.phase !== "lobby") return false;
  if (m.parts.has(p.id)) return true;
  if (m.parts.size >= LIM.maxPlayers) {
    p.sendMessage(t("arsenal.mode.full"));
    return false;
  }
  if (safe("join.saved", () => p.getDynamicProperty(SAVE_KEY)) !== undefined) {
    p.sendMessage(t("arsenal.mode.err_restore_pending"));
    return false;
  }
  const def = MODES[m.mode];
  m.parts.set(p.id, { kills: 0, deaths: 0, level: 0, team: 0, loadout: def.loadouts[0] ?? "", respawnAt: 0, alive: true, name: p.name });
  saveMatch();
  world.sendMessage(raw("§e", t("arsenal.mode.joined", p.name, String(m.parts.size))));
  return true;
}

function beginMatch() {
  const m = match;
  const arena = curArena();
  if (!m || !arena) return;
  const def = MODES[m.mode];
  const players = /** @type {Player[]} */ ([...m.parts.keys()].map((id) => world.getEntity(id)).filter((p) => p instanceof Player && p.isValid));
  if (players.length < def.minPlayers) {
    world.sendMessage(raw("§c[ARSENAL] ", t("arsenal.mode.not_enough", String(def.minPlayers))));
    match = null;
    saveMatch();
    return;
  }
  const dim = world.getDimension(arena.dim);
  // 保管庫（ティッキングエリアで読み込んだまま）
  const c = floorV(m.center);
  safe("mode.tick_area", () => dim.runCommand(`tickingarea add circle ${Math.floor(c.x)} ${Math.floor(c.y)} ${Math.floor(c.z)} 1 arsenal_mode true`));
  const storage = safe("mode.storage", () => dim.spawnEntity(ENTITY.storage, { x: c.x, y: c.y + 0.1, z: c.z }));
  if (!storage) {
    world.sendMessage(raw("§c[ARSENAL] ", t("arsenal.mode.err_storage")));
    match = null;
    saveMatch();
    return;
  }
  m.storageId = storage.id;
  // チーム分け（交互）
  const ordered = players.sort(() => Math.random() - 0.5);
  ordered.forEach((p, i) => {
    const part = /** @type {Part} */ (m.parts.get(p.id));
    part.team = def.teams === 2 ? i % 2 : 0;
  });
  let slot = 0;
  for (const p of ordered) {
    const part = /** @type {Part} */ (m.parts.get(p.id));
    if (!saveAndClear(/** @type {Player} */ (p), storage, slot)) {
      m.parts.delete(p.id);
      continue;
    }
    slot++;
    safe("mode.tags", () => {
      p.addTag(`arsenal_mode:${m.mode}`);
      if (def.teams === 2) p.addTag(`arsenal_team:mode_${part.team}`);
      if (def.teams === 1) p.addTag("arsenal_team:mode_coop");
    });
    equipLoadout(/** @type {Player} */ (p), part);
    spawnAt(/** @type {Player} */ (p), part);
  }
  m.phase = "live";
  m.startTick = system.currentTick;
  m.endTick = def.timeLimit ? m.startTick + def.timeLimit * 20 : 0;
  if (m.mode === "horde") {
    m.wave = 0;
    m.waveState = "break";
    m.waveUntil = system.currentTick + 100;
  }
  if (m.mode === "koth") m.hillMoveAt = system.currentTick + def.hillMoveSecs * 20;
  setupScoreboard();
  saveMatch();
  for (const p of ordered) {
    playTo(/** @type {Player} */ (p), "arsenal.world.wave_horn");
    announce(/** @type {Player} */ (p), raw("§6", { translate: `arsenal.mode_name.${m.mode}` }, " §f", t("arsenal.mode.go")), 60);
  }
}

/**
 * 持ち物・位置などを保管庫へ
 * @param {Player} p @param {import("@minecraft/server").Entity} storage @param {number} idx 保管庫の何人目か（54 枠を 1 人 41 枠 → 1 つの保管庫に 1 人。2 人目以降は保管庫を増やす）
 */
function saveAndClear(p, storage, idx) {
  let box = storage;
  if (idx > 0) {
    const b2 = safe("mode.storage2", () => storage.dimension.spawnEntity(ENTITY.storage, { x: storage.location.x, y: storage.location.y + 0.1, z: storage.location.z }));
    if (!b2) return false;
    box = b2;
  }
  const inv = box.getComponent("minecraft:inventory")?.container;
  const pc = p.getComponent("minecraft:inventory")?.container;
  const eq = p.getComponent("minecraft:equippable");
  if (!inv || !pc) return false;
  const ok = safe("mode.save", () => {
    for (let i = 0; i < pc.size; i++) {
      const it = pc.getItem(i);
      inv.setItem(i, it);
      pc.setItem(i, undefined);
    }
    const slots = [EquipmentSlot.Head, EquipmentSlot.Chest, EquipmentSlot.Legs, EquipmentSlot.Feet, EquipmentSlot.Offhand];
    slots.forEach((sl, k) => {
      const it = eq?.getEquipment(sl);
      inv.setItem(36 + k, it);
      eq?.setEquipment(sl, undefined);
    });
    const h = p.getComponent("minecraft:health");
    const tags = p.getTags().filter((x) => x.startsWith("arsenal_team:"));
    for (const tg of tags) p.removeTag(tg);
    p.setDynamicProperty(SAVE_KEY, JSON.stringify({
      box: box.id, dim: p.dimension.id, loc: p.location, gm: p.getGameMode(), hp: h?.currentValue ?? 20, tags,
      boxLoc: box.location, boxDim: box.dimension.id,
    }));
    box.setDynamicProperty("a:owner", p.id);
    p.setGameMode(GameMode.Adventure);
    return true;
  });
  return !!ok;
}

/**
 * 保存した状態へ戻す（試合終了・再参加・再起動後）
 * @param {Player} p
 * @returns {boolean} 戻せたか（保管庫が読み込まれていなければ false）
 */
export function restorePlayer(p) {
  const raw0 = safe("restore.get", () => p.getDynamicProperty(SAVE_KEY));
  if (typeof raw0 !== "string") return true;
  /** @type {any} */
  const sv = safe("restore.parse", () => JSON.parse(raw0));
  if (!sv) {
    p.setDynamicProperty(SAVE_KEY, undefined);
    return true;
  }
  const box = world.getEntity(sv.box);
  if (!box || !box.isValid) {
    // 保管庫のある場所へ連れて行き、読み込まれるのを待つ
    safe("restore.goto", () => p.teleport(sv.boxLoc, { dimension: world.getDimension(sv.boxDim) }));
    return false;
  }
  const inv = box.getComponent("minecraft:inventory")?.container;
  const pc = p.getComponent("minecraft:inventory")?.container;
  const eq = p.getComponent("minecraft:equippable");
  if (!inv || !pc) return false;
  safe("restore.items", () => {
    for (let i = 0; i < pc.size; i++) pc.setItem(i, undefined);
    for (let i = 0; i < 36; i++) pc.setItem(i, inv.getItem(i));
    const slots = [EquipmentSlot.Head, EquipmentSlot.Chest, EquipmentSlot.Legs, EquipmentSlot.Feet, EquipmentSlot.Offhand];
    slots.forEach((sl, k) => eq?.setEquipment(sl, inv.getItem(36 + k)));
    for (let i = 0; i < inv.size; i++) inv.setItem(i, undefined);
  });
  safe("restore.state", () => {
    for (const tg of p.getTags()) if (tg.startsWith("arsenal_mode:") || tg.startsWith("arsenal_team:")) p.removeTag(tg);
    for (const tg of sv.tags ?? []) p.addTag(tg);
    p.teleport(sv.loc, { dimension: world.getDimension(sv.dim) });
    p.setGameMode(sv.gm ?? GameMode.Survival);
    const h = p.getComponent("minecraft:health");
    h?.setCurrentValue(Math.max(1, Math.min(h.effectiveMax, sv.hp ?? 20)));
    p.setDynamicProperty(SAVE_KEY, undefined);
    box.remove();
    for (const e of ["slowness", "resistance", "weakness"]) p.removeEffect(e);
  });
  S(p).hudDirty = true;
  p.sendMessage(t("arsenal.mode.restored"));
  // ほかに保管庫が残っていなければ、ティッキングエリアを外す
  system.runTimeout(() => safe("restore.area", () => {
    if (match) return;
    const left = world.getDimension(sv.boxDim).getEntities({ type: ENTITY.storage, location: sv.boxLoc, maxDistance: 4 });
    if (!left.length) world.getDimension(sv.boxDim).runCommand("tickingarea remove arsenal_mode");
  }), 5);
  return true;
}

/**
 * 武器 1 挺（アタッチメント込み）
 * @param {string} wid @param {Record<string,string>} att
 */
function makeWeapon(wid, att = {}) {
  const w = W(wid);
  if (!w) {
    return new ItemStack(`${NS}:${wid}`, 1); // 近接武器
  }
  const ammoType = w.defaultVariant ?? defaultVariant(w.ammo);
  const st = computeStats(wid, att, ammoType);
  let it = new ItemStack(`${NS}:${wid}`, 1);
  it.setDynamicProperties({ [PROP.init]: true, [PROP.v]: DATA.ITEM_FORMAT, [PROP.ammo]: st.mag, [PROP.mode]: st.modes[0], [PROP.att]: JSON.stringify(att), [PROP.at]: ammoType, [PROP.ub]: 0 });
  writeLore(it, wid, att, ammoType);
  const want = desiredTypeId(wid, att, null);
  if (want !== it.typeId) it = retype(it, want);
  it.lockMode = ItemLockMode.inventory;
  return it;
}

/** @param {Player} p @param {string} id @param {number} n */
function giveN(p, id, n) {
  const c = p.getComponent("minecraft:inventory")?.container;
  let left = n;
  while (left > 0 && c) {
    const k = Math.min(64, left);
    left -= k;
    const it = new ItemStack(id, k);
    it.lockMode = ItemLockMode.inventory;
    c.addItem(it);
  }
}

/**
 * 装備セットを配る
 * @param {Player} p @param {Part} part
 */
function equipLoadout(p, part) {
  const m = match;
  if (!m) return;
  const c = p.getComponent("minecraft:inventory")?.container;
  if (!c) return;
  for (let i = 0; i < c.size; i++) c.setItem(i, undefined);
  if (m.mode === "gungame") {
    const ladder = MODES.gungame.ladder;
    const wid = ladder[Math.min(part.level, ladder.length - 1)];
    c.setItem(0, makeWeapon(wid));
    const w = W(wid);
    if (w && w.ammo !== "none") {
      const id = ammoItemId(w.ammo, w.defaultVariant ?? defaultVariant(w.ammo));
      if (id) giveN(p, id, Math.ceil((w.mag * 6) / (w.ammoPerItem ?? 1)));
    }
    if (wid !== "combat_knife") c.setItem(2, makeWeapon("combat_knife"));
    return;
  }
  const lo = LOADOUTS[part.loadout] ?? LOADOUTS.assault;
  c.setItem(0, makeWeapon(lo.primary, lo.attachments?.[lo.primary] ?? {}));
  c.setItem(1, makeWeapon(lo.secondary, lo.attachments?.[lo.secondary] ?? {}));
  c.setItem(2, makeWeapon(lo.melee));
  for (const [id, n] of lo.ammo) {
    const wid = id === "@primary" ? lo.primary : id === "@secondary" ? lo.secondary : null;
    const w = wid ? W(wid) : null;
    const aid = w ? ammoItemId(w.ammo, w.defaultVariant ?? defaultVariant(w.ammo)) : id;
    if (aid) giveN(p, aid, Math.ceil(n / (w?.ammoPerItem ?? 1)));
  }
  for (const [id, n] of lo.gear) giveN(p, id, n);
  const eq = p.getComponent("minecraft:equippable");
  safe("mode.armor", () => {
    const [head, chest] = lo.armor;
    if (head) eq?.setEquipment(EquipmentSlot.Head, new ItemStack(head, 1));
    if (chest) {
      const it = new ItemStack(chest, 1);
      it.setDynamicProperty("a:pl", lo.plates ?? 0);
      eq?.setEquipment(EquipmentSlot.Chest, it);
    }
  });
}

/**
 * スポーン地点へ
 * @param {Player} p @param {Part} part
 */
function spawnAt(p, part) {
  const a = curArena();
  const m = match;
  if (!a || !m) return;
  let pts = a.spawns;
  if (MODES[m.mode].teams === 2 && pts.length >= 2) {
    // チームごとに近い半分のスポーン（1 つ目のスポーンに近い順で前半がアルファ）
    const s0 = pts[0];
    const sorted = [...pts].sort((u, v) => dist(u, s0) - dist(v, s0));
    const half = Math.ceil(sorted.length / 2);
    pts = part.team === 0 ? sorted.slice(0, half) : sorted.slice(half);
  }
  // 敵から一番遠いスポーン
  let best = pts[0];
  let bestD = -1;
  for (const sp of pts) {
    let dmin = Infinity;
    for (const [id, o] of m.parts) {
      if (id === p.id) continue;
      if (MODES[m.mode].teams === 2 && o.team === part.team) continue;
      const op = world.getEntity(id);
      if (op && op.isValid) dmin = Math.min(dmin, dist(op.location, sp));
    }
    if (dmin > bestD) {
      bestD = dmin;
      best = sp;
    }
  }
  safe("mode.tp", () => {
    p.teleport(best, { dimension: world.getDimension(a.dim) });
    p.setGameMode(GameMode.Adventure);
    const h = p.getComponent("minecraft:health");
    h?.resetToMaxValue();
    p.addEffect("resistance", 40, { amplifier: 255, showParticles: false });
    p.extinguishFire();
  });
  const s = S(p);
  s.spawnProtUntil = system.currentTick + 40;
  s.bleedUntil = 0;
  s.hudDirty = true;
  part.alive = true;
  part.respawnAt = 0;
}

/**
 * 参加者の「死亡」（致死ダメージの横取り）
 * @param {Player} victim @param {import("@minecraft/server").Entity|undefined} attacker @param {any} info
 */
function onModeDeath(victim, attacker, info) {
  const m = match;
  if (!m || m.phase !== "live") return;
  const part = m.parts.get(victim.id);
  if (!part || !part.alive) return;
  const def = MODES[m.mode];
  part.alive = false;
  part.deaths++;
  const killer = attacker instanceof Player ? attacker : undefined;
  const kpart = killer ? m.parts.get(killer.id) : undefined;
  emitEvent("death", { victim, killer, info });
  if (killer && kpart && killer.id !== victim.id) {
    emitEvent("kill", { killer, victim, victimType: victim.typeId, weaponId: info?.weaponId ?? null, head: !!info?.head, distance: dist(killer.location, victim.location), kind: "gun", pvp: true });
    kpart.kills++;
    world.sendMessage(raw("§6", { text: killer.name }, " §7[", info?.weaponId ? itemName(info.weaponId) : { text: "?" }, "§7] §f", { text: victim.name }, info?.head ? " §c✦" : ""));
    if (m.mode === "tdm") m.teamScore[kpart.team]++;
    if (m.mode === "gungame") gunGameAdvance(killer, kpart, victim, part, info?.weaponId);
  }
  // 観戦で待つ
  safe("mode.dead", () => {
    const h = victim.getComponent("minecraft:health");
    h?.resetToMaxValue();
    victim.setGameMode(GameMode.Spectator);
    forgetDowned(victim.id);
  });
  if (def.respawn === null) {
    part.respawnAt = 0; // ホード：ウェーブの終わりまで
    announce(victim, raw("§c", t("arsenal.mode.dead_wave")), 60);
    if ([...m.parts.values()].every((x) => !x.alive)) endMatch(null, "arsenal.mode.horde_wiped");
  } else {
    part.respawnAt = system.currentTick + def.respawn * 20;
    announce(victim, raw("§c", t("arsenal.mode.dead_respawn", String(def.respawn))), 40);
  }
  updateScoreboard();
  checkWin();
}

/**
 * @param {Player} killer @param {Part} kp @param {Player} victim @param {Part} vp @param {string|undefined} wid
 */
function gunGameAdvance(killer, kp, victim, vp, wid) {
  const ladder = MODES.gungame.ladder;
  const cur = ladder[Math.min(kp.level, ladder.length - 1)];
  // 近接で倒されたら 1 段下がる
  if (MODES.gungame.demoteOnMelee && wid === "combat_knife" && cur !== "combat_knife") {
    vp.level = Math.max(0, vp.level - 1);
    announce(victim, raw("§c", t("arsenal.mode.gg_demoted")), 40);
  }
  if (wid !== cur && !(wid === "combat_knife")) return;
  if (cur === "combat_knife" && wid === "combat_knife") {
    kp.level = ladder.length;
    return;
  }
  if (wid === cur) {
    kp.level++;
    if (kp.level < ladder.length) {
      system.run(() => safe("gg.swap", () => {
        equipLoadout(killer, kp);
        playTo(killer, "arsenal.ui.levelup");
        announce(killer, raw("§a", t("arsenal.mode.gg_next", String(kp.level + 1), String(ladder.length)), " §f", itemName(ladder[kp.level])), 40);
      }));
    }
  }
}

function checkWin() {
  const m = match;
  if (!m || m.phase !== "live") return;
  const def = MODES[m.mode];
  if (m.mode === "ffa") {
    for (const [id, p] of m.parts) if (p.kills >= def.scoreLimit) return endMatch([id]);
  } else if (m.mode === "tdm" || m.mode === "koth") {
    for (const tm of [0, 1]) if (m.teamScore[tm] >= def.scoreLimit) return endMatch([...m.parts].filter(([, p]) => p.team === tm).map(([id]) => id));
  } else if (m.mode === "gungame") {
    for (const [id, p] of m.parts) if (p.level >= def.ladder.length) return endMatch([id]);
  }
}

/** 時間切れ・ホードのクリアでの勝者 */
function timeUpWinners() {
  const m = match;
  if (!m) return [];
  const entries = [...m.parts];
  if (m.mode === "tdm" || m.mode === "koth") {
    if (m.teamScore[0] === m.teamScore[1]) return [];
    const tm = m.teamScore[0] > m.teamScore[1] ? 0 : 1;
    return entries.filter(([, p]) => p.team === tm).map(([id]) => id);
  }
  const key = m.mode === "gungame" ? "level" : "kills";
  const best = Math.max(...entries.map(([, p]) => /** @type {any} */ (p)[key]));
  return entries.filter(([, p]) => /** @type {any} */ (p)[key] === best).map(([id]) => id);
}

/**
 * 終了
 * @param {string[]|null} winners @param {string} [reasonKey]
 */
export function endMatch(winners, reasonKey) {
  const m = match;
  if (!m) return;
  if (m.phase === "lobby") {
    match = null;
    saveMatch();
    world.sendMessage(raw("§c[ARSENAL] ", t(reasonKey ?? "arsenal.mode.stopped")));
    return;
  }
  if (m.phase === "end") return;
  m.phase = "end";
  m.winners = winners ?? [];
  m.restoreAt = system.currentTick + 100;
  const players = /** @type {Player[]} */ ([...m.parts.keys()].map((id) => world.getEntity(id)).filter((p) => p instanceof Player));
  const names = m.winners.map((id) => m.parts.get(id)?.name ?? "?").join(", ");
  const lines = [...m.parts.values()].sort((a, b) => b.kills - a.kills).slice(0, 8).map((p) => `§f${p.name} §7${p.kills}/${p.deaths}${m.mode === "gungame" ? ` §8Lv${p.level + 1}` : ""}`);
  for (const p of players) {
    const pp = /** @type {Player} */ (p);
    const won = m.winners.includes(pp.id);
    announce(pp, raw(won ? "§6" : "§7", t(won ? "arsenal.mode.victory" : "arsenal.mode.defeat")), 80);
    pp.sendMessage(raw("§6===== ", { translate: `arsenal.mode_name.${m.mode}` }, " =====\n", reasonKey ? raw("§7", t(reasonKey), "\n") : "", t("arsenal.mode.winners", names || "-"), "\n", lines.join("\n")));
    playTo(pp, won ? "arsenal.ui.rankup" : "arsenal.ui.challenge");
  }
  emitEvent("matchEnd", { mode: m.mode, players, winners: players.filter((p) => m.winners.includes(p.id)) });
  // ホードの敵を片付ける
  for (const ai of allAI().values()) if (ai.ent.isValid && ai.ent.hasTag("arsenal_mode_enemy")) safe("mode.cleanup", () => ai.ent.remove());
  saveMatch();
}

function finishRestore() {
  const m = match;
  if (!m) return;
  for (const id of m.parts.keys()) {
    const p = world.getEntity(id);
    if (p instanceof Player) restorePlayer(p);
  }
  removeScoreboard();
  match = null;
  saveMatch();
}

// ---------------------------------------------------------------------------
//  ホード
// ---------------------------------------------------------------------------

/** @param {number} now */
function hordeTick(now) {
  const m = /** @type {Match} */ (match);
  const def = MODES.horde;
  const a = curArena();
  if (!a) return;
  const dim = world.getDimension(a.dim);
  const alivePlayers = [...m.parts].filter(([, p]) => p.alive).length;
  if (m.waveState === "break") {
    if (now < m.waveUntil) return;
    m.wave++;
    if (m.wave > def.waves) {
      endMatch([...m.parts.keys()], "arsenal.mode.horde_clear");
      return;
    }
    m.waveState = "fight";
    const n = Math.round(def.baseCount + def.perWave * (m.wave - 1) + def.perPlayer * m.parts.size);
    m.toSpawn = n;
    for (const id of m.parts.keys()) {
      const p = world.getEntity(id);
      if (p instanceof Player) {
        announce(p, raw("§c", t("arsenal.mode.wave", String(m.wave), String(def.waves))), 60);
        playTo(p, "arsenal.world.wave_horn");
      }
    }
    const boss = def.boss[m.wave];
    if (boss) {
      const sp = a.spawns[Math.floor(Math.random() * a.spawns.length)] ?? m.center;
      const far = pickEnemySpawn(a, dim) ?? sp;
      if (boss === "hollow_brute_pack") for (let i = 0; i < 3; i++) spawnEnemy(dim, far, "hollow_brute", { tag: "arsenal_mode_enemy", persist: true, src: "horde" });
      else spawnEnemy(dim, far, boss, { tag: "arsenal_mode_enemy", persist: true, src: "horde" });
    }
    return;
  }
  // 戦闘中：少しずつ出す
  let alive = 0;
  for (const ai of allAI().values()) if (ai.ent.isValid && ai.ent.hasTag("arsenal_mode_enemy")) alive++;
  if (m.toSpawn > 0 && alive < def.maxAlive && now % 10 === 0) {
    const pos = pickEnemySpawn(a, dim);
    if (pos) {
      const r = Math.random();
      const id = m.wave >= 4 && r < 0.12 ? "hollow_brute" : m.wave >= 2 && r < 0.3 ? "hollow_bloater" : "hollow_runner";
      if (spawnEnemy(dim, pos, id, { tag: "arsenal_mode_enemy", persist: true, src: "horde" })) m.toSpawn--;
    }
  }
  if (m.toSpawn <= 0 && alive === 0) {
    // ウェーブ終了：倒れた人を戻し、休憩
    m.waveState = "break";
    m.waveUntil = now + def.breakSecs * 20;
    const players = [];
    for (const [id, part] of m.parts) {
      const p = world.getEntity(id);
      if (!(p instanceof Player)) continue;
      players.push(p);
      if (!part.alive) spawnAt(p, part);
      refillAmmo(p, part);
      announce(p, raw("§a", t("arsenal.mode.wave_clear", String(m.wave), String(def.breakSecs))), 80);
    }
    emitEvent("wave", { players, wave: m.wave, mul: 1 + m.wave * 0.1 });
    // 休憩中の補給係
    safe("horde.qm", () => {
      const qm = dim.getEntities({ type: ENTITY.quartermaster, location: m.center, maxDistance: 32 });
      if (!qm.length) {
        const e = dim.spawnEntity(ENTITY.quartermaster, m.center);
        e.addTag("arsenal_mode_npc");
      }
    });
  }
  void alivePlayers;
}

/** 敵の出現位置：スポーン地点から離れた、アリーナの縁の辺り @param {Arena} a @param {import("@minecraft/server").Dimension} dim */
function pickEnemySpawn(a, dim) {
  if (!a.a || !a.b) return null;
  for (let i = 0; i < 6; i++) {
    const edge = Math.floor(Math.random() * 4);
    const x0 = Math.min(a.a.x, a.b.x), x1 = Math.max(a.a.x, a.b.x);
    const z0 = Math.min(a.a.z, a.b.z), z1 = Math.max(a.a.z, a.b.z);
    const x = edge === 0 ? x0 + 1 : edge === 1 ? x1 - 1 : x0 + Math.random() * (x1 - x0);
    const z = edge === 2 ? z0 + 1 : edge === 3 ? z1 - 1 : z0 + Math.random() * (z1 - z0);
    const top = { x: Math.floor(x) + 0.5, y: Math.max(a.a.y, a.b.y) + 10, z: Math.floor(z) + 0.5 };
    if (!isLoaded(dim, top, system.currentTick)) continue;
    const hit = safe("horde.ground", () => dim.getBlockFromRay(top, { x: 0, y: -1, z: 0 }, { maxDistance: 40, includeLiquidBlocks: false, includePassableBlocks: false }));
    if (!hit) continue;
    const pos = { x: top.x, y: hit.block.location.y + 1, z: top.z };
    const near = [...(match?.parts.keys() ?? [])].some((id) => {
      const p = world.getEntity(id);
      return p && p.isValid && dist(p.location, pos) < 10;
    });
    if (!near) return pos;
  }
  return null;
}

/** @param {Player} p @param {Part} part */
function refillAmmo(p, part) {
  const lo = LOADOUTS[part.loadout];
  if (!lo) return;
  for (const [id, n] of lo.ammo) {
    const wid = id === "@primary" ? lo.primary : id === "@secondary" ? lo.secondary : null;
    const w = wid ? W(wid) : null;
    const aid = w ? ammoItemId(w.ammo, w.defaultVariant ?? defaultVariant(w.ammo)) : id;
    if (aid) giveN(p, aid, Math.ceil(n / 2 / (w?.ammoPerItem ?? 1)));
  }
}

// ---------------------------------------------------------------------------
//  陣取り
// ---------------------------------------------------------------------------

/** @param {number} now */
function kothTick(now) {
  const m = /** @type {Match} */ (match);
  const a = curArena();
  if (!a || !a.hills.length) return;
  const def = MODES.koth;
  if (now >= m.hillMoveAt && a.hills.length > 1) {
    m.hill = (m.hill + 1) % a.hills.length;
    m.hillMoveAt = now + def.hillMoveSecs * 20;
    for (const id of m.parts.keys()) {
      const p = world.getEntity(id);
      if (p instanceof Player) announce(p, raw("§e", t("arsenal.mode.hill_moved")), 40);
    }
  }
  const hill = a.hills[m.hill];
  const dim = world.getDimension(a.dim);
  if (now % 10 === 0) safe("koth.fx", () => {
    for (let i = 0; i < 8; i++) {
      const ang = (i / 8) * Math.PI * 2 + now * 0.02;
      const at = { x: hill.x + Math.cos(ang) * def.hillRadius, y: hill.y + 0.2, z: hill.z + Math.sin(ang) * def.hillRadius };
      for (const p of dim.getPlayers({ location: hill, maxDistance: 64 })) safe("koth.p", () => p.spawnParticle("arsenal:target_marker", at));
    }
  });
  if (now % 20 !== 0) return;
  const on = [0, 0];
  for (const [id, part] of m.parts) {
    const p = world.getEntity(id);
    if (!(p instanceof Player) || !part.alive) continue;
    if (dist(p.location, hill) <= def.hillRadius + 0.5) on[part.team]++;
  }
  if (on[0] > 0 && on[1] === 0) m.teamScore[0] += def.pointsPerSec;
  else if (on[1] > 0 && on[0] === 0) m.teamScore[1] += def.pointsPerSec;
  updateScoreboard();
  checkWin();
}

// ---------------------------------------------------------------------------
//  スコアボード
// ---------------------------------------------------------------------------

function setupScoreboard() {
  safe("sb.setup", () => {
    const sb = world.scoreboard;
    const old = sb.getObjective(OBJ);
    if (old) sb.removeObjective(OBJ);
    const obj = sb.addObjective(OBJ, "§6ARSENAL");
    sb.setObjectiveAtDisplaySlot(DisplaySlotId.Sidebar, { objective: obj });
  });
  updateScoreboard();
}

function updateScoreboard() {
  const m = match;
  if (!m) return;
  safe("sb.update", () => {
    const obj = world.scoreboard.getObjective(OBJ);
    if (!obj) return;
    if (m.mode === "tdm" || m.mode === "koth") {
      obj.setScore(TEAMS[0].color + TEAMS[0].name.en, m.teamScore[0]);
      obj.setScore(TEAMS[1].color + TEAMS[1].name.en, m.teamScore[1]);
    } else {
      for (const p of m.parts.values()) obj.setScore(p.name, m.mode === "gungame" ? p.level + 1 : p.kills);
    }
  });
}

function removeScoreboard() {
  safe("sb.remove", () => {
    if (world.scoreboard.getObjective(OBJ)) world.scoreboard.removeObjective(OBJ);
  });
}

// ---------------------------------------------------------------------------
//  ループ
// ---------------------------------------------------------------------------

export function tickModes() {
  const m = match;
  if (!m) return;
  const now = system.currentTick;
  if (m.phase === "lobby") {
    const left = m.lobbyUntil - now;
    if (left <= 0) beginMatch();
    else if (left % 100 === 0 || left === 60 || left === 40 || left === 20) {
      for (const id of m.parts.keys()) {
        const p = world.getEntity(id);
        if (p instanceof Player) announce(p, raw("§e", t("arsenal.mode.starting", String(Math.ceil(left / 20)))), 25);
      }
    }
    return;
  }
  if (m.phase === "end") {
    if (now >= m.restoreAt) finishRestore();
    return;
  }
  const def = MODES[m.mode];
  const a = curArena();
  // 復活・場外
  if (now % 5 === 0) {
    for (const [id, part] of m.parts) {
      const p = world.getEntity(id);
      if (!(p instanceof Player) || !p.isValid) continue;
      if (!part.alive && part.respawnAt > 0 && now >= part.respawnAt) {
        spawnAt(p, part);
        equipLoadout(p, part);
      }
      if (part.alive && a && now % 20 === 0 && !inside(a, p.location)) {
        announce(p, raw("§c", t("arsenal.mode.out_of_bounds")), 30);
        spawnAt(p, part);
      }
    }
  }
  if (m.mode === "horde") hordeTick(now);
  if (m.mode === "koth") kothTick(now);
  if (m.endTick && now >= m.endTick) endMatch(timeUpWinners(), "arsenal.mode.time_up");
}

/**
 * HUD 2.0 の値
 * @param {Player} p
 */
function hudProvider(p) {
  const m = match;
  if (!m || m.phase === "lobby") return null;
  const part = m.parts.get(p.id);
  if (!part) return null;
  const now = system.currentTick;
  /** @type {Record<string, string|number>} */
  const v = { gm: /** @type {any} */ (GM_CODE)[m.mode] ?? "0" };
  const def = MODES[m.mode];
  if (m.mode === "tdm" || m.mode === "koth") {
    v.sa = m.teamScore[part.team];
    v.sb = m.teamScore[1 - part.team];
  } else if (m.mode === "horde") {
    v.sa = m.wave;
    let alive = 0;
    for (const ai of allAI().values()) if (ai.ent.isValid && ai.ent.hasTag("arsenal_mode_enemy")) alive++;
    v.sb = alive + m.toSpawn;
  } else if (m.mode === "gungame") {
    v.sa = part.level + 1;
    v.sb = def.ladder.length;
  } else {
    v.sa = part.kills;
    v.sb = def.scoreLimit;
  }
  const left = m.endTick ? Math.max(0, Math.ceil((m.endTick - now) / 20)) : m.mode === "horde" && m.waveState === "break" ? Math.max(0, Math.ceil((m.waveUntil - now) / 20)) : -1;
  v.tm = left >= 0 ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`.padStart(5, " ") : "";
  const s = S(p);
  if (s.spawnProtUntil > now && !s.weaponId) v.st = "P";
  return v;
}

/** 試合中か（ほかのシステムが参照） @param {Player} p */
export function inMatch(p) {
  return !!match && match.phase === "live" && match.parts.has(p.id);
}
/** @returns {Match|null} */
export function currentMatch() {
  return match;
}

export function attachModes() {
  // 致死ダメージの横取り（参加者）
  addLethalGuard((target, attacker, inf) => {
    if (!(target instanceof Player) || !inMatch(target)) return false;
    const part = match?.parts.get(target.id);
    if (!part || !part.alive) return true;
    if (inf && inf.engine) system.run(() => safe("mode.death", () => onModeDeath(target, attacker, inf)));
    else onModeDeath(target, attacker, inf);
    return true;
  });
  // 試合中はダウン制を使わない
  setDownedOverride((p) => (inMatch(p) ? false : null));
  // ガンゲームなどストリーク禁止
  setStreakFilter((p) => {
    if (!match || !match.parts.has(p.id) || match.phase !== "live") return true;
    return !!MODES[match.mode].streaks;
  });
  addHud2Provider(hudProvider);
  // 参加：保存した状態があれば戻す（再起動・退出からの復帰）
  world.afterEvents.playerSpawn.subscribe((ev) => safe("mode.spawn", () => {
    const p = ev.player;
    if (!ev.initialSpawn) return;
    if (safe("mode.sv", () => p.getDynamicProperty(SAVE_KEY)) === undefined) return;
    if (match && match.parts.has(p.id) && match.phase === "live") {
      const part = match.parts.get(p.id);
      if (part) spawnAt(p, part);
      return;
    }
    // 保管庫が読み込まれるまで何度か試す
    let tries = 0;
    const h = system.runInterval(() => {
      tries++;
      if (!p.isValid || restorePlayer(p) || tries > 30) {
        system.clearRun(h);
        if (tries > 30) p.sendMessage(t("arsenal.mode.restore_failed"));
      }
    }, 20);
  }));
  world.afterEvents.worldLoad.subscribe(() => safe("mode.recover", () => {
    // 再起動：試合は中止（参加者は次に入ったとき a:msave から戻る）
    const r = world.getDynamicProperty(MATCH_KEY);
    if (typeof r === "string") {
      info("previous match aborted by restart; players will be restored on join");
      world.setDynamicProperty(MATCH_KEY, undefined);
      removeScoreboard();
    }
  }));
  world.afterEvents.entityLoad.subscribe((ev) => safe("mode.orphan", () => {
    if (!match && ev.entity.hasTag("arsenal_mode_enemy")) ev.entity.remove();
    if (!match && ev.entity.hasTag("arsenal_mode_npc")) ev.entity.remove();
  }));
  on("death", () => updateScoreboard());
}

/** テスト用 */
export function __setMatchLobbyNow() {
  if (match) match.lobbyUntil = system.currentTick;
}

void weaponIdOf;
