// @ts-check
/**
 * 構造物（自然生成）
 *
 *  1. 地物ルールが 1 ブロックの目印（arsenal:site_marker、状態 arsenal:kind = 構造物の番号）を地表に置く
 *  2. 目印のブロックの tick（2〜3 秒ごと）で、48 ブロック以内にプレイヤーが来たらワールド設定「構造物の密度」で抽選
 *     → 当たれば本体（arsenal:<id>）を置き、宝箱を詰め、守備隊を出す。外れ・OFF なら目印を消すだけ
 *  3. 守備隊には arsenal_site:<番号> のタグを付け、全滅したら「制圧」として近くのプレイヤーに報酬
 *
 *  ・宝箱と出現位置の座標はビルド時に config/structures.gen.js へ書き出してあるので、置いたあとにブロックを走査しない
 *  ・ほかの構造物から 40 ブロック以内には置かない（地形の重なりを防ぐ）
 *  ・記録（最大 64 件）はワールドのダイナミックプロパティ a:sites
 */
import { world, system } from "@minecraft/server";
import { DATA, NS, ENTITY } from "../config/constants.js";
import { STRUCTURE_POINTS, SITE_KINDS } from "../config/structures.gen.js";
import { W as WS } from "../core/settings.js";
import { emitEvent } from "../core/events.js";
import { spawnEnemy } from "./ai/brain.js";
import { rollLoot, fillContainer } from "./lootgen.js";
import { playNear } from "../fx/effects.js";
import { announce } from "../ui/hud2.js";
import { isLoaded } from "../util/math.js";
import { t, raw } from "../util/i18n.js";
import { safe } from "../util/log.js";

const STRUCT = /** @type {Record<string, any>} */ (DATA.STRUCTURES);
const DENSITY = /** @type {Record<string, any>} */ (DATA.STRUCTURE_DENSITY);
const FACTIONS = /** @type {Record<string, any>} */ (DATA.FACTIONS);
const SITES_KEY = "a:sites";
const MAX_SITES = 64;
const MIN_GAP = 40;
const ROLE_OF = { roof: 1, center: 2, edge: 3 };

/**
 * @typedef {{n:number, sid:string, dim:string, x:number, y:number, z:number, left:number, cleared:boolean, t:number}} Site
 */
/** @type {Site[]|null} */
let sites = null;

/** @returns {Site[]} */
function allSites() {
  if (sites) return sites;
  sites = [];
  const raw0 = safe("sites.load", () => world.getDynamicProperty(SITES_KEY));
  if (typeof raw0 === "string") safe("sites.parse", () => {
    const a = JSON.parse(raw0);
    if (Array.isArray(a)) sites = a.filter((s) => s && STRUCT[s.sid]);
  });
  return sites;
}

function saveSites() {
  const a = allSites();
  // 古い制圧済みから捨てる
  while (a.length > MAX_SITES) {
    const i = a.findIndex((s) => s.cleared);
    a.splice(i >= 0 ? i : 0, 1);
  }
  safe("sites.save", () => world.setDynamicProperty(SITES_KEY, JSON.stringify(a)));
}

function nextId() {
  const n = /** @type {number} */ (safe("sites.n", () => world.getDynamicProperty("a:site_n")) ?? 0) + 1;
  safe("sites.n.save", () => world.setDynamicProperty("a:site_n", n));
  return n;
}

/**
 * 目印のブロックの tick（カスタムコンポーネント arsenal:site）
 * @param {import("@minecraft/server").Block} block @param {import("@minecraft/server").Dimension} dim
 */
export function onSiteTick(block, dim) {
  const kind = /** @type {number} */ (safe("site.kind", () => /** @type {any} */ (block.permutation).getState(`${NS}:kind`)) ?? 0);
  const sid = SITE_KINDS[kind];
  const loc = block.location;
  if (!sid || !STRUCT[sid]) {
    safe("site.bad", () => block.setType("minecraft:air"));
    return;
  }
  const near = safe("site.near", () => dim.getPlayers({ location: loc, maxDistance: 48 })) ?? [];
  if (!near.length) return;
  const keep = (DENSITY[WS().structures] ?? DENSITY.normal).keep;
  const tooClose = allSites().some((s) => s.dim === dim.id && Math.hypot(s.x - loc.x, s.z - loc.z) < MIN_GAP);
  if (tooClose || Math.random() >= keep) {
    safe("site.drop", () => block.setType("minecraft:air"));
    return;
  }
  expand(dim, sid, loc, block);
}

/**
 * 本体を置く
 * @param {import("@minecraft/server").Dimension} dim @param {string} sid @param {import("@minecraft/server").Vector3} at 目印の位置（地表） @param {import("@minecraft/server").Block} [marker]
 * @returns {Site|undefined}
 */
export function expand(dim, sid, at, marker) {
  const sd = STRUCT[sid];
  const pts = STRUCTURE_POINTS[sid];
  const [sx, sy, sz] = sd.size;
  const origin = { x: Math.floor(at.x) - Math.floor(sx / 2), y: Math.floor(at.y) - sd.sink, z: Math.floor(at.z) - Math.floor(sz / 2) };
  const now = system.currentTick;
  // ワールドの高さの外にはみ出すなら置かない（目印は消す）
  const hr = /** @type {any} */ (dim).heightRange;
  if (hr && (origin.y < hr.min || origin.y + sy > hr.max)) {
    if (marker) safe("site.oob", () => marker.setType("minecraft:air"));
    return undefined;
  }
  // 足元から天井まで、四隅のチャンクが読み込まれていること
  for (const c of [[0, 0], [sx - 1, 0], [0, sz - 1], [sx - 1, sz - 1]]) {
    for (const y of [origin.y, origin.y + sy - 1]) {
      if (!isLoaded(dim, { x: origin.x + c[0], y, z: origin.z + c[1] }, now)) return undefined;
    }
  }
  if (marker) safe("site.clear", () => marker.setType("minecraft:air"));
  const ok = safe("site.place", () => {
    world.structureManager.place(`${NS}:${sid}`, dim, origin, { includeEntities: false });
    return true;
  });
  if (!ok) return undefined;
  /** @type {Site} */
  const site = { n: nextId(), sid, dim: dim.id, x: origin.x + Math.floor(sx / 2), y: origin.y + sd.sink, z: origin.z + Math.floor(sz / 2), left: 0, cleared: false, t: Date.now() };
  allSites().push(site);
  // 置いた直後に詰める（place は同期）。宝箱の中身がまだ作られていなければ、2 tick 後にもう一度
  safe("site.populate", () => populate(dim, sid, origin, site));
  saveSites();
  return site;
}

/**
 * 宝箱・守備隊・補給係
 * @param {import("@minecraft/server").Dimension} dim @param {string} sid @param {import("@minecraft/server").Vector3} origin @param {Site} site
 */
function populate(dim, sid, origin, site) {
  const sd = STRUCT[sid];
  const pts = STRUCTURE_POINTS[sid];
  /** @type {string[]} */
  const tiers = [];
  for (const c of sd.chests) for (let i = 0; i < c.count; i++) tiers.push(c.tier);
  /** @type {{pos:import("@minecraft/server").Vector3, tier:string}[]} */
  const retry = [];
  pts.chests.forEach((/** @type {number[]} */ c, /** @type {number} */ i) => {
    const pos = { x: origin.x + c[0], y: origin.y + c[1], z: origin.z + c[2] };
    const ok = safe("site.chest", () => {
      const inv = dim.getBlock(pos)?.getComponent("minecraft:inventory")?.container;
      if (!inv) return false;
      fillContainer(inv, rollLoot(tiers[i] ?? "common"));
      return true;
    });
    if (!ok) retry.push({ pos, tier: tiers[i] ?? "common" });
  });
  if (retry.length) {
    system.runTimeout(() => {
      for (const r of retry) safe("site.chest2", () => {
        if (!isLoaded(dim, r.pos, system.currentTick)) return;
        const inv = dim.getBlock(r.pos)?.getComponent("minecraft:inventory")?.container;
        if (inv) fillContainer(inv, rollLoot(r.tier));
      });
    }, 2);
  }
  // 守備隊
  const markers = pts.markers.map((/** @type {number[]} */ m) => ({ pos: { x: origin.x + m[0] + 0.5, y: origin.y + m[1], z: origin.z + m[2] + 0.5 }, role: m[3], used: 0 }));
  const facOn = /** @type {any} */ (WS())[FACTIONS[sd.faction]?.setting ?? "raiders"] !== false;
  let n = 0;
  if (facOn) {
    for (const g of sd.garrison) {
      const want = /** @type {any} */ (ROLE_OF)[g.at ?? ""] ?? 0;
      for (let i = 0; i < g.count; i++) {
        let cand = markers.filter((m) => (want ? m.role === want : true));
        if (!cand.length) cand = markers;
        if (!cand.length) break;
        cand.sort((a, b) => a.used - b.used);
        const m = cand[0];
        m.used++;
        const off = m.used > 1 ? { x: (Math.random() - 0.5) * 1.2, z: (Math.random() - 0.5) * 1.2 } : { x: 0, z: 0 };
        const e = spawnEnemy(dim, { x: m.pos.x + off.x, y: m.pos.y, z: m.pos.z + off.z }, g.id, { persist: true, tag: `arsenal_site:${site.n}`, src: "site" });
        if (e) n++;
      }
    }
  }
  // 目印のブロックを消す
  for (const m of markers) safe("site.marker", () => {
    const b = dim.getBlock({ x: Math.floor(m.pos.x), y: m.pos.y, z: Math.floor(m.pos.z) });
    if (b && b.typeId === `${NS}:spawn_marker`) b.setType("minecraft:air");
  });
  if (sd.merchant && Math.random() < sd.merchant) {
    safe("site.merchant", () => dim.spawnEntity(ENTITY.quartermaster, { x: site.x + 0.5, y: site.y + 1, z: site.z + 0.5 }));
  }
  site.left = n;
  if (n === 0) site.cleared = true;
  saveSites();
  for (const p of dim.getPlayers({ location: { x: site.x, y: site.y, z: site.z }, maxDistance: 64 })) {
    announce(p, raw("§e", t(`arsenal.structure.${sid}`)), 40);
  }
}

/** 守備隊の死亡 → 残り数を減らし、全滅で制圧 */
function onDeath(/** @type {import("@minecraft/server").Entity} */ e) {
  const tag = safe("site.tag", () => e.getTags().find((x) => x.startsWith("arsenal_site:")));
  if (!tag) return;
  const n = Number(tag.slice("arsenal_site:".length));
  const site = allSites().find((s) => s.n === n);
  if (!site || site.cleared) return;
  site.left = Math.max(0, site.left - 1);
  if (site.left === 0) {
    site.cleared = true;
    const dim = e.dimension;
    const players = dim.getPlayers({ location: { x: site.x, y: site.y, z: site.z }, maxDistance: 64 });
    for (const p of players) {
      announce(p, raw("§a", t("arsenal.structure.cleared", { translate: `arsenal.structure.${site.sid}` })), 60);
      playNear(dim, p.location, "arsenal.ui.challenge", { range: 4 });
    }
    emitEvent("structureCleared", { sid: site.sid, players, site });
  }
  saveSites();
}

/** 変異体の巣：夜になると周りに変異体が湧く（200 tick ごと） */
function tickNests() {
  const tod = safe("sites.tod", () => world.getTimeOfDay()) ?? 6000;
  if (tod < 13000 || tod > 23000) return;
  if (/** @type {any} */ (WS()).hollow === false) return;
  for (const s of allSites()) {
    if (s.sid !== "hollow_ruin") continue;
    const dim = safe("sites.dim", () => world.getDimension(s.dim));
    if (!dim) continue;
    const c = { x: s.x + 0.5, y: s.y + 1, z: s.z + 0.5 };
    if (!isLoaded(dim, c, system.currentTick)) continue;
    const players = dim.getPlayers({ location: c, maxDistance: 40 });
    if (!players.length) continue;
    const alive = dim.getEntities({ location: c, maxDistance: 24, families: ["arsenal_hollow"] }).length;
    if (alive >= 4 || Math.random() > 0.5) continue;
    spawnEnemy(dim, c, Math.random() < 0.8 ? "hollow_runner" : "hollow_bloater", { src: "nest" });
  }
}

export function tickStructures() {
  if (system.currentTick % 200 === 100) safe("sites.nests", tickNests);
}

export function attachStructures() {
  world.afterEvents.entityDie.subscribe((ev) => safe("site.die", () => onDeath(ev.deadEntity)));
}

/** 報告・テスト用 */
export function siteList() {
  return allSites();
}

