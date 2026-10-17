// ARSENAL CORE データ定義（tools/data/）。ランタイムにはビルド時に 1 ファイル（BP/scripts/config/weapons.data.js）へまとめて出力する。
// 弾薬

// ---------------------------------------------------------------------------
//  弾薬
//  family … 武器が受け付ける弾の系統。variant … 同系統内の特殊弾。
// ---------------------------------------------------------------------------
export const AMMO_VARIANTS = {
  std: { suffix: "", name: { ja: "", en: "" }, dmg: 1.0, pen: 0, ap: 0, fire: 0, range: 1.0, tracer: false, stripe: null },
  ap: { suffix: "_ap", name: { ja: "徹甲", en: "AP" }, dmg: 0.95, pen: 1, ap: 0.5, fire: 0, range: 1.0, tracer: false, stripe: [70, 110, 220] },
  inc: { suffix: "_inc", name: { ja: "焼夷", en: "Incendiary" }, dmg: 0.9, pen: 0, ap: 0, fire: 3, range: 1.0, tracer: false, stripe: [230, 80, 40] },
  tracer: { suffix: "_tracer", name: { ja: "曳光", en: "Tracer" }, dmg: 1.0, pen: 0, ap: 0, fire: 0, range: 1.15, tracer: true, stripe: [120, 230, 90] },
};

export const AMMO_FAMILIES = {
  light: { name: { ja: "ライト弾", en: "Light Rounds" }, variants: ["std", "ap", "inc", "tracer"], shape: "pistol", color: [214, 172, 72], out: 24, cost: { "minecraft:copper_ingot": 1, "minecraft:gunpowder": 1 } },
  medium: { name: { ja: "ミディアム弾", en: "Medium Rounds" }, variants: ["std", "ap", "inc", "tracer"], shape: "rifle", color: [206, 160, 64], out: 16, cost: { "minecraft:copper_ingot": 1, "minecraft:iron_nugget": 2, "minecraft:gunpowder": 1 } },
  heavy: { name: { ja: "ヘビー弾", en: "Heavy Rounds" }, variants: ["std", "ap", "inc", "tracer"], shape: "rifle_long", color: [184, 140, 60], out: 12, cost: { "minecraft:copper_ingot": 2, "minecraft:iron_nugget": 3, "minecraft:gunpowder": 2 } },
  magnum: { name: { ja: "マグナム弾", en: "Magnum Rounds" }, variants: ["std", "ap", "inc", "tracer"], shape: "magnum", color: [222, 186, 96], out: 12, cost: { "minecraft:copper_ingot": 2, "minecraft:gunpowder": 2 } },
  precision: { name: { ja: "精密弾", en: "Precision Rounds" }, variants: ["std", "ap", "inc", "tracer"], shape: "sniper", color: [196, 150, 70], out: 6, cost: { "arsenal:steel_ingot": 1, "minecraft:copper_ingot": 2, "minecraft:gunpowder": 3 } },
  shell: { name: { ja: "12G シェル", en: "12G Shells" }, variants: ["buck", "slug", "fire"], shape: "shell", color: [176, 38, 38], out: 8, cost: { "minecraft:paper": 1, "minecraft:iron_nugget": 3, "minecraft:gunpowder": 1 } },
  gl40: { name: { ja: "40mm グレネード弾", en: "40mm Grenades" }, variants: ["std"], shape: "grenade40", color: [110, 120, 70], out: 2, cost: { "arsenal:steel_ingot": 1, "minecraft:gunpowder": 3, "minecraft:copper_ingot": 1 } },
  rocket: { name: { ja: "ロケット弾", en: "Rockets" }, variants: ["std"], shape: "rocket", color: [90, 110, 80], out: 1, cost: { "arsenal:steel_ingot": 2, "minecraft:gunpowder": 4, "minecraft:tnt": 1, "arsenal:precision_parts": 1 } },
  cell: { name: { ja: "エネルギーセル", en: "Energy Cells" }, variants: ["std"], shape: "cell", color: [60, 200, 230], out: 4, cost: { "minecraft:redstone": 4, "minecraft:copper_ingot": 2, "minecraft:amethyst_shard": 1 } },
  flare: { name: { ja: "信号弾", en: "Flare Shells" }, variants: ["std"], shape: "flare", color: [230, 90, 50], out: 4, cost: { "minecraft:paper": 1, "minecraft:gunpowder": 1, "minecraft:glowstone_dust": 1 } },
  // ---- 2.0 で追加 ----
  antimat: { name: { ja: "20mm 弾", en: "20mm Rounds" }, variants: ["std", "ap"], shape: "rifle_long", color: [150, 120, 70], out: 3, cost: { "arsenal:steel_ingot": 2, "minecraft:copper_ingot": 2, "minecraft:gunpowder": 3 } },
  fuel: { name: { ja: "燃料キャニスター", en: "Fuel Canister" }, variants: ["std"], shape: "fuel", color: [200, 60, 40], out: 1, cost: { "minecraft:glass_bottle": 1, "minecraft:coal": 2, "minecraft:blaze_powder": 1 } },
  mortar: { name: { ja: "迫撃砲弾", en: "Mortar Shells" }, variants: ["std"], shape: "mortar", color: [96, 104, 70], out: 2, cost: { "arsenal:steel_ingot": 1, "minecraft:gunpowder": 3, "minecraft:tnt": 1 } },
};

// 12G シェルの弾種
export const SHELL_VARIANTS = {
  buck: { name: { ja: "バックショット", en: "Buckshot" }, stripe: [60, 60, 60], extra: {} },
  slug: { name: { ja: "スラッグ", en: "Slug" }, stripe: [60, 110, 200], extra: { "minecraft:iron_ingot": 1 } },
  fire: { name: { ja: "ドラゴンブレス", en: "Dragon's Breath" }, stripe: [240, 150, 30], extra: { "minecraft:blaze_powder": 1 } },
};

// 特殊弾の追加素材
export const VARIANT_EXTRA_COST = {
  ap: { "arsenal:steel_ingot": 1 },
  inc: { "minecraft:blaze_powder": 1 },
  tracer: { "minecraft:glowstone_dust": 1 },
};

/** 弾薬アイテム一覧を展開する */
export function listAmmoItems() {
  const out = [];
  for (const [fam, f] of Object.entries(AMMO_FAMILIES)) {
    for (const v of f.variants) {
      let id;
      let name;
      let cost = { ...f.cost };
      let stripe = null;
      if (fam === "shell") {
        id = `shell_${v}`;
        const sv = SHELL_VARIANTS[v];
        name = { ja: `12G ${sv.name.ja}`, en: `12G ${sv.name.en}` };
        for (const [k, n] of Object.entries(sv.extra)) cost[k] = (cost[k] || 0) + n;
        stripe = sv.stripe;
      } else if (fam === "cell") {
        id = "energy_cell";
        name = f.name;
      } else if (fam === "flare") {
        id = "flare_shell";
        name = f.name;
      } else if (fam === "gl40") {
        id = "ammo_40mm";
        name = f.name;
      } else if (fam === "rocket") {
        id = "ammo_rocket";
        name = f.name;
      } else if (fam === "fuel") {
        id = "fuel_canister";
        name = f.name;
      } else if (fam === "mortar") {
        id = "mortar_shell";
        name = f.name;
      } else {
        const av = AMMO_VARIANTS[v];
        id = `ammo_${fam}${av.suffix}`;
        name = v === "std" ? f.name : { ja: `${f.name.ja}（${av.name.ja}）`, en: `${f.name.en} (${av.name.en})` };
        const extra = VARIANT_EXTRA_COST[v] || {};
        for (const [k, n] of Object.entries(extra)) cost[k] = (cost[k] || 0) + n;
        stripe = av.stripe;
      }
      out.push({ id, family: fam, variant: v, name, cost, out: f.out, color: f.color, stripe, shape: f.shape });
    }
  }
  return out;
}
