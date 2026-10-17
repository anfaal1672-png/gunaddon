// tools/data/ を読み込み、
//   ・引数なし        … build.py 用の JSON を標準出力へ
//   ・--bundle <path> … ランタイム用の 1 ファイル（関数は事前計算した表を引くだけの形）を書き出す
import fs from "node:fs";
import * as D from "./data/index.js";

const out = {};
for (const [k, v] of Object.entries(D)) {
  if (typeof v === "function") continue;
  out[k] = v;
}
out.ammoItems = D.listAmmoItems();
out.weaponRecipes = Object.fromEntries(Object.keys(D.WEAPONS).map((id) => [id, D.weaponRecipe(id)]));
out.attachmentRecipes = Object.fromEntries(Object.keys(D.ATTACHMENTS).map((id) => [id, D.attachmentRecipe(id)]));
out.repairCosts = Object.fromEntries(Object.keys(D.WEAPONS).map((id) => [id, D.repairCost(id)]));
if (typeof D.derived === "function") Object.assign(out, D.derived());

const i = process.argv.indexOf("--bundle");
if (i < 0) {
  process.stdout.write(JSON.stringify(out, null, 1));
} else {
  const lines = [
    "// @ts-nocheck",
    "// ============================================================================",
    "//  ARSENAL CORE — データ（自動生成。tools/data/ から tools/build.py が出力する。直接編集しないこと）",
    "// ============================================================================",
    "",
  ];
  const skip = new Set(["ammoItems", "weaponRecipes", "attachmentRecipes", "repairCosts"]);
  // 大きな表は any 型にして型推論の負荷と過剰な型エラーを避ける（設定の既定値だけは型として使う）
  const typed = new Set(["DEFAULT_WORLD_SETTINGS", "DEFAULT_PLAYER_SETTINGS", "NS", "ADDON_VERSION", "MIN_ENGINE", "SCRIPT_MODULES"]);
  for (const [k, v] of Object.entries(out)) {
    if (skip.has(k)) continue;
    if (!typed.has(k) && v !== null && typeof v === "object") lines.push("/** @type {any} */");
    lines.push(`export const ${k} = ${JSON.stringify(v)};`);
  }
  lines.push(`const _AMMO_ITEMS = ${JSON.stringify(out.ammoItems)};`);
  lines.push(`const _WEAPON_RECIPES = ${JSON.stringify(out.weaponRecipes)};`);
  lines.push(`const _ATTACHMENT_RECIPES = ${JSON.stringify(out.attachmentRecipes)};`);
  lines.push(`const _REPAIR_COSTS = ${JSON.stringify(out.repairCosts)};`);
  lines.push("/** 弾薬アイテム一覧 @returns {{id:string, family:string, variant:string, name:{ja:string,en:string}, cost:Record<string,number>, out:number, color:number[], stripe:number[]|null, shape:string}[]} */");
  lines.push("export function listAmmoItems() { return _AMMO_ITEMS.map((a) => ({ ...a, cost: { ...a.cost } })); }");
  lines.push("/** 武器のレシピ（レジェンダリーは null） @param {string} id @returns {Record<string, number> | null} */");
  lines.push("export function weaponRecipe(id) { const r = _WEAPON_RECIPES[id]; return r ? { ...r } : null; }");
  lines.push("/** アタッチメントのレシピ @param {string} id @returns {Record<string, number>} */");
  lines.push("export function attachmentRecipe(id) { return { ...(_ATTACHMENT_RECIPES[id] ?? {}) }; }");
  lines.push("/** 修理コスト @param {string} id @returns {Record<string, number>} */");
  lines.push("export function repairCost(id) { return { ...(_REPAIR_COSTS[id] ?? {}) }; }");
  fs.writeFileSync(process.argv[i + 1], lines.join("\n") + "\n");
}
