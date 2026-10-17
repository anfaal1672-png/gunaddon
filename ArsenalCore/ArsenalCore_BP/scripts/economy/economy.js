// @ts-check
/**
 * 経済（ワールド設定 economy）：クレジットの獲得・補給係の店（買う・売る）・闇市
 *
 *  ・所持クレジットはプレイヤーのダイナミックプロパティ a:cr（数値）。初めて参加したとき CURRENCY.start を配る
 *  ・獲得：敵を倒す（tier 別）・ヘッドショット・遠距離・PvP・アシスト・構造物の制圧・ホードのウェーブ・試合・ボス・チャレンジ
 *  ・店：補給係（arsenal:quartermaster）に触ると開く。カテゴリ → 一覧 → 詳細（買う数）の 3 段
 *  ・売値は買値の SELL_RATE 倍。武器は残り耐久に比例
 *  ・闇市：階級 unlockRank 以上。ゲーム内の日ごとに品が入れ替わる（全員共通）。各品はワールド全体で 1 日 stock 個まで
 */
import { world, system, Player, ItemStack } from "@minecraft/server";
import { ActionFormData, MessageFormData, FormCancelationReason } from "@minecraft/server-ui";
import { DATA, NS, ENTITY, AMMO_ITEMS, weaponIdOf, enemyIdOf, enemyDef, meleeIdOf } from "../config/constants.js";
import { W as WS } from "../core/settings.js";
import { S } from "../core/state.js";
import { on } from "../core/events.js";
import { giveItem, giveStack, isCreative } from "../core/inventory.js";
import { initLootWeapon } from "../systems/loot.js";
import { rankOf, addStat } from "../progression/progression.js";
import { playTo } from "../fx/effects.js";
import { t, raw, itemName, anyItemName, descOf } from "../util/i18n.js";
import { safe, logError } from "../util/log.js";

const CUR = DATA.CURRENCY;
const PRICES = /** @type {Record<string, number>} */ (DATA.PRICES);
const R = DATA.REWARDS;
const BM = DATA.BLACK_MARKET;
const TIERS = /** @type {Record<string, any>} */ (DATA.TIERS);
const GLYPH = String.fromCharCode(0xe118);

/** @param {number} n */
export const fmtCr = (n) => `${Math.floor(n).toLocaleString("en-US")}${GLYPH}`;

// ---------------------------------------------------------------------------
//  残高
// ---------------------------------------------------------------------------

/** @param {Player} p */
export function credits(p) {
  const v = safe("cr.get", () => p.getDynamicProperty("a:cr"));
  if (typeof v !== "number") {
    safe("cr.init", () => p.setDynamicProperty("a:cr", CUR.start));
    return CUR.start;
  }
  return v;
}

/**
 * 増減（足りなければ false）
 * @param {Player} p @param {number} n @param {boolean} [earn] 獲得として統計に数える
 */
export function addCredits(p, n, earn = true) {
  if (!n) return true;
  const cur = credits(p);
  const next = Math.min(CUR.max, cur + Math.round(n));
  if (next < 0) return false;
  safe("cr.set", () => p.setDynamicProperty("a:cr", next));
  if (n > 0 && earn) addStat(p, "creditsEarned", n);
  const s = S(p);
  s.hudDirty = true;
  return true;
}

/** HUD 2.0 の cr フィールド @param {Player} p */
export function creditsForHud(p) {
  return WS().economy ? credits(p) : 0;
}

/**
 * 獲得（ワールド設定が OFF なら何もしない）
 * @param {Player} p @param {number} n
 */
function earn(p, n) {
  if (!WS().economy || n <= 0) return;
  addCredits(p, n, true);
}

// ---------------------------------------------------------------------------
//  獲得のイベント
// ---------------------------------------------------------------------------

export function attachEconomy() {
  on("kill", (ev) => {
    const k = ev.killer;
    if (!(k instanceof Player)) return;
    let n = 0;
    if (ev.pvp) n = R.pvpKill;
    else {
      const eid = enemyIdOf(ev.victimType ?? "");
      if (eid) {
        const d = enemyDef(eid);
        if (d?.phases) return; // ボスは bossKill で全員に
        n = /** @type {any} */ (R.killByTier)[d?.tier ?? 1] ?? 10;
      } else if (safe("eco.monster", () => ev.victim?.matches?.({ families: ["monster"] }))) n = 4;
      else return;
    }
    if (ev.head) n += R.headshotBonus;
    if (ev.distance >= R.longshotDist) n += R.longshotBonus;
    earn(k, n);
  });
  on("assist", (ev) => earn(ev.player, R.assist));
  on("structureCleared", (ev) => {
    for (const p of ev.players ?? []) earn(p, R.structureClear);
  });
  on("wave", (ev) => {
    for (const p of ev.players ?? []) earn(p, R.hordeWave * (ev.mul ?? 1));
  });
  on("matchEnd", (ev) => {
    for (const p of ev.players ?? []) earn(p, (ev.winners ?? []).some((/** @type {Player} */ w) => w.id === p.id) ? R.matchWin : R.matchPlay);
  });
  on("bossKill", (ev) => {
    for (const p of ev.players ?? []) earn(p, ev.credits ?? 0);
  });
  on("challengeDone", (ev) => earn(ev.player, ev.credits ?? 0));
  world.afterEvents.playerSpawn.subscribe((ev) => safe("eco.spawn", () => {
    if (ev.initialSpawn) credits(ev.player);
  }));
  world.afterEvents.playerInteractWithEntity.subscribe((ev) => safe("eco.qm", () => {
    if (ev.target.typeId === ENTITY.quartermaster) system.run(() => openShop(ev.player));
  }));
}

// ---------------------------------------------------------------------------
//  フォーム
// ---------------------------------------------------------------------------

/**
 * @template {{canceled:boolean, cancelationReason?: any}} R2
 * @param {Player} player @param {{show:(p:Player)=>Promise<R2>}} form
 * @returns {Promise<R2|undefined>}
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
      logError("shop.show", e);
      return undefined;
    }
  }
  s.menuOpen = false;
  return undefined;
}

/** アイテム ID の買値 @param {string} typeId */
export function priceOf(typeId) {
  return PRICES[typeId];
}

/** アイコン @param {string} typeId */
function iconOf(typeId) {
  const id = typeId.slice(NS.length + 1);
  if (DATA.WEAPONS[id]) return `textures/items/arsenal/weapons/${id}`;
  if (DATA.MELEE[id]) return `textures/items/arsenal/melee/${id}`;
  if (DATA.ATTACHMENTS[id]) return `textures/items/arsenal/attachments/${id}`;
  if (DATA.ARMOR[id]) return `textures/items/arsenal/armor/${id}`;
  if (DATA.THROWABLES[id]) return `textures/items/arsenal/throwables/${id}`;
  if (DATA.MEDICAL[id]) return `textures/items/arsenal/medical/${id}`;
  if (DATA.DEPLOYABLES[id] || DATA.VEHICLES[id]) return `textures/items/arsenal/gear/${id}`;
  if (AMMO_ITEMS.some((a) => a.id === id)) return `textures/items/arsenal/ammo/${id}`;
  if (DATA.MATERIALS[id]) return `textures/items/arsenal/materials/${id}`;
  return `textures/items/arsenal/tools/${id}`;
}

/** @param {Player} p */
function header(p) {
  return raw(t("arsenal.shop.balance"), " §e", fmtCr(credits(p)));
}

/**
 * 店を開く
 * @param {Player} p
 */
export async function openShop(p) {
  if (!WS().economy) {
    p.sendMessage(t("arsenal.shop.disabled"));
    return;
  }
  const cats = Object.keys(DATA.SHOP);
  const f = new ActionFormData().title(t("arsenal.shop.title")).body(header(p));
  for (const c of cats) f.button({ translate: `arsenal.shop.cat.${c}` }, c === "sell" ? "textures/ui/trade_icon" : undefined);
  const bmOk = rankOf(p) >= BM.unlockRank;
  f.button(raw(bmOk ? "§5" : "§8", t("arsenal.shop.black_market")), "textures/ui/icon_book_writable");
  const r = await show(p, f);
  if (!r || r.canceled || r.selection === undefined) return;
  if (r.selection === cats.length) {
    if (!bmOk) {
      p.sendMessage(t("arsenal.shop.bm_locked", String(BM.unlockRank)));
      return;
    }
    return openBlackMarket(p);
  }
  const c = cats[r.selection];
  if (c === "sell") return openSell(p);
  return openList(p, c);
}

/**
 * カテゴリの品目
 * @param {string} c
 * @returns {string[]} アイテム ID
 */
export function shopItems(c) {
  const sh = /** @type {any} */ (DATA.SHOP)[c];
  const maxT = sh?.maxTier ? TIERS[sh.maxTier].order : 3;
  const ok = (/** @type {string} */ tier) => TIERS[tier ?? "common"].order <= maxT;
  switch (c) {
    case "weapons":
      return [
        ...Object.entries(DATA.WEAPONS).filter(([, w]) => ok(/** @type {any} */ (w).tier)).sort((a, b) => DATA.CATEGORIES[/** @type {any} */ (a[1]).cat].order - DATA.CATEGORIES[/** @type {any} */ (b[1]).cat].order).map(([id]) => `${NS}:${id}`),
        ...Object.entries(DATA.MELEE).filter(([, w]) => ok(/** @type {any} */ (w).tier)).map(([id]) => `${NS}:${id}`),
      ];
    case "ammo":
      return AMMO_ITEMS.map((a) => `${NS}:${a.id}`);
    case "attachments":
      return Object.entries(DATA.ATTACHMENTS).filter(([, a]) => ok(/** @type {any} */ (a).tier)).map(([id]) => `${NS}:${id}`);
    case "armor":
      return Object.keys(DATA.ARMOR).map((id) => `${NS}:${id}`);
    case "gear":
      return [...Object.keys(DATA.THROWABLES), ...Object.keys(DATA.MEDICAL), ...Object.keys(DATA.DEPLOYABLES), ...Object.keys(DATA.VEHICLES), "streak_terminal", "repair_kit", "detonator"].map((id) => `${NS}:${id}`);
    case "materials":
      return [...(sh.items ?? [])];
  }
  return [];
}

/** @param {Player} p @param {string} c */
async function openList(p, c) {
  const items = shopItems(c).filter((id) => typeof PRICES[id] === "number");
  const f = new ActionFormData().title({ translate: `arsenal.shop.cat.${c}` }).body(header(p));
  const cr = credits(p);
  for (const id of items) {
    const price = PRICES[id];
    f.button(raw(price <= cr ? "§f" : "§8", anyItemName(id), "\n§e", fmtCr(price)), iconOf(id));
  }
  f.button(t("arsenal.ui.btn_back"));
  const r = await show(p, f);
  if (!r || r.canceled || r.selection === undefined) return;
  if (r.selection >= items.length) return openShop(p);
  return openDetail(p, c, items[r.selection]);
}

/**
 * @param {Player} p @param {string} c @param {string} id
 */
async function openDetail(p, c, id) {
  const price = PRICES[id];
  const plain = id.slice(NS.length + 1);
  const stackable = !(DATA.WEAPONS[plain] || DATA.MELEE[plain] || DATA.ARMOR[plain] || DATA.ATTACHMENTS[plain] || DATA.VEHICLES[plain]);
  const qty = c === "ammo" ? /** @type {number[]} */ (DATA.SHOP.ammo.stacks) : stackable ? [1, 4, 16] : [1];
  const body = raw(id.startsWith(`${NS}:`) ? descOf(plain) : "", "\n\n", header(p));
  const f = new ActionFormData().title(anyItemName(id)).body(body);
  const cr = credits(p);
  for (const q of qty) f.button(raw(price * q <= cr ? "§a" : "§8", t("arsenal.shop.buy_n", String(q)), "  §e", fmtCr(price * q)));
  f.button(t("arsenal.ui.btn_back"));
  const r = await show(p, f);
  if (!r || r.canceled || r.selection === undefined) return;
  if (r.selection >= qty.length) return openList(p, c);
  buy(p, id, qty[r.selection], price);
  return openDetail(p, c, id);
}

/**
 * 買う（テストからも使う）
 * @param {Player} p @param {string} id @param {number} n @param {number} unit
 */
export function buy(p, id, n, unit) {
  const cost = Math.round(unit * n);
  if (!isCreative(p) && credits(p) < cost) {
    p.sendMessage(t("arsenal.shop.no_money"));
    playTo(p, "arsenal.ui.error", { volume: 0.7 });
    return false;
  }
  if (!isCreative(p)) addCredits(p, -cost, false);
  const wid = weaponIdOf(id);
  if (wid) {
    for (let i = 0; i < n; i++) {
      const it = new ItemStack(id, 1);
      initLootWeapon(it, false);
      giveStack(p, it);
    }
  } else giveItem(p, id, n);
  playTo(p, "arsenal.ui.buy");
  p.sendMessage(raw("§a", t("arsenal.shop.bought", anyItemName(id), String(n), fmtCr(cost))));
  return true;
}

// ---------------------------------------------------------------------------
//  売る
// ---------------------------------------------------------------------------

/**
 * 売値（1 個あたり）
 * @param {ItemStack} it
 */
export function sellPrice(it) {
  const wid = weaponIdOf(it.typeId);
  const base = PRICES[wid ? `${NS}:${wid}` : it.typeId];
  if (typeof base !== "number") return 0;
  let v = base * DATA.SELL_RATE;
  const d = safe("sell.dur", () => it.getComponent("minecraft:durability"));
  if (d && d.maxDurability > 0) v *= Math.max(0.1, 1 - d.damage / d.maxDurability);
  return Math.max(1, Math.floor(v));
}

/** @param {Player} p */
async function openSell(p) {
  const inv = p.getComponent("minecraft:inventory")?.container;
  if (!inv) return;
  /** @type {{slot:number, it:ItemStack, each:number}[]} */
  const rows = [];
  for (let i = 0; i < inv.size; i++) {
    const it = inv.getItem(i);
    if (!it) continue;
    const each = sellPrice(it);
    if (each > 0) rows.push({ slot: i, it, each });
  }
  const f = new ActionFormData().title(t("arsenal.shop.cat.sell")).body(raw(header(p), "\n", t("arsenal.shop.sell_body", String(Math.round(DATA.SELL_RATE * 100)))));
  for (const r0 of rows) {
    const wid = weaponIdOf(r0.it.typeId);
    f.button(raw(anyItemName(wid ? `${NS}:${wid}` : r0.it.typeId), ` §7x${r0.it.amount}`, "\n§e", fmtCr(r0.each * r0.it.amount)), iconOf(wid ? `${NS}:${wid}` : r0.it.typeId));
  }
  f.button(t("arsenal.ui.btn_back"));
  const r = await show(p, f);
  if (!r || r.canceled || r.selection === undefined) return;
  if (r.selection >= rows.length) return openShop(p);
  const row = rows[r.selection];
  const conf = new MessageFormData().title(t("arsenal.shop.cat.sell")).body(raw(anyItemName(row.it.typeId), ` x${row.it.amount} → §e${fmtCr(row.each * row.it.amount)}`)).button1(t("arsenal.shop.sell_yes")).button2(t("arsenal.ui.btn_back"));
  const r2 = await show(p, conf);
  if (!r2 || r2.canceled || r2.selection !== 0) return openSell(p);
  sellSlot(p, row.slot);
  return openSell(p);
}

/**
 * スロットの品を売る（テストからも使う）
 * @param {Player} p @param {number} slot
 */
export function sellSlot(p, slot) {
  const inv = p.getComponent("minecraft:inventory")?.container;
  const it = inv?.getItem(slot);
  if (!inv || !it) return 0;
  const each = sellPrice(it);
  if (each <= 0) return 0;
  const total = each * it.amount;
  inv.setItem(slot, undefined);
  addCredits(p, total, false);
  playTo(p, "arsenal.ui.sell");
  return total;
}

// ---------------------------------------------------------------------------
//  闇市
// ---------------------------------------------------------------------------

/** ゲーム内の日の番号 */
function gameDay() {
  return Math.floor((safe("bm.day", () => world.getAbsoluteTime()) ?? system.currentTick) / 24000);
}

/** @param {number} seed */
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let x = Math.imul(s ^ (s >>> 15), 1 | s);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 今日の品揃え（日の番号から決まる）
 * @param {number} [day]
 * @returns {{id:string, price:number}[]}
 */
export function blackMarketStock(day = gameDay()) {
  const r = rng(day * 7919 + 17);
  /** @param {string[]} pool @param {number} n */
  const take = (pool, n) => {
    const a = [...pool];
    const out = [];
    while (out.length < n && a.length) out.push(a.splice(Math.floor(r() * a.length), 1)[0]);
    return out;
  };
  const legW = Object.entries(DATA.WEAPONS).filter(([, w]) => /** @type {any} */ (w).tier === "legendary").map(([id]) => `${NS}:${id}`);
  const legP = Object.entries(DATA.ATTACHMENTS).filter(([, a]) => /** @type {any} */ (a).tier === "legendary").map(([id]) => `${NS}:${id}`);
  const rare = [
    ...Object.entries(DATA.ATTACHMENTS).filter(([, a]) => /** @type {any} */ (a).tier === "rare").map(([id]) => `${NS}:${id}`),
    ...Object.entries(DATA.ARMOR).filter(([, a]) => /** @type {any} */ (a).tier === "rare").map(([id]) => `${NS}:${id}`),
  ];
  const ids = [...take(legW, BM.legendaryWeapons), ...take(legP, BM.legendaryParts), ...take(rare, BM.rareParts)];
  return ids.map((id) => ({ id, price: Math.round(((PRICES[id] ?? 1000) * BM.markup) / 10) * 10 }));
}

/** @returns {{day:number, sold:Record<string, number>}} */
function bmSold() {
  const day = gameDay();
  const raw0 = safe("bm.sold", () => world.getDynamicProperty("a:bm"));
  if (typeof raw0 === "string") {
    const o = safe("bm.parse", () => JSON.parse(raw0));
    if (o && o.day === day) return o;
  }
  return { day, sold: {} };
}

/** @param {Player} p */
async function openBlackMarket(p) {
  const stock = blackMarketStock();
  const sold = bmSold();
  const f = new ActionFormData().title(raw("§5", t("arsenal.shop.black_market"))).body(raw(header(p), "\n§7", t("arsenal.shop.bm_body")));
  for (const s of stock) {
    const left = BM.stock - (sold.sold[s.id] ?? 0);
    const tier = TIERS[/** @type {any} */ (DATA.WEAPONS[s.id.slice(NS.length + 1)] ?? DATA.ATTACHMENTS[s.id.slice(NS.length + 1)] ?? DATA.ARMOR[s.id.slice(NS.length + 1)])?.tier ?? "rare"];
    f.button(raw(left > 0 ? tier.color : "§8", anyItemName(s.id), "\n§e", fmtCr(s.price), left > 0 ? "" : raw(" §c", t("arsenal.shop.sold_out"))), iconOf(s.id));
  }
  f.button(t("arsenal.ui.btn_back"));
  const r = await show(p, f);
  if (!r || r.canceled || r.selection === undefined) return;
  if (r.selection >= stock.length) return openShop(p);
  buyBlackMarket(p, r.selection);
  return openBlackMarket(p);
}

/**
 * 闇市で買う（テストからも使う）
 * @param {Player} p @param {number} idx
 */
export function buyBlackMarket(p, idx) {
  if (rankOf(p) < BM.unlockRank) return false;
  const s = blackMarketStock()[idx];
  if (!s) return false;
  const sold = bmSold();
  if ((sold.sold[s.id] ?? 0) >= BM.stock) {
    p.sendMessage(t("arsenal.shop.sold_out"));
    return false;
  }
  if (!buy(p, s.id, 1, s.price)) return false;
  sold.sold[s.id] = (sold.sold[s.id] ?? 0) + 1;
  safe("bm.save", () => world.setDynamicProperty("a:bm", JSON.stringify(sold)));
  return true;
}

void meleeIdOf;
