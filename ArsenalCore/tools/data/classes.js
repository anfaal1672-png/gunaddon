// ARSENAL CORE データ定義（tools/data/）。ランタイムにはビルド時に 1 ファイル（BP/scripts/config/weapons.data.js）へまとめて出力する。
// 兵科とパーク（3.0）
//
// 兵科：いつでも 1 つ選ぶ（野戦マニュアル →「兵科・パーク」）。パッシブ（常に効く補正）と、戦術デバイスで使うアビリティを持つ
// パーク：3 つの枠（ティア 1〜3）に 1 つずつ。階級で解放される
//
// 補正の値（mods）は掛け算。1 より小さいほど「少なく・短く」なる
//  move      … 移動速度             reload   … リロード時間        ads    … 覗き込みの時間
//  recoil    … 反動                 heavyRecoil … 反動（機関銃・重火器だけ）
//  spread    … 腰だめの広がり        ready    … 走ったあと撃てるまでの時間
//  dmgTaken  … 受けるダメージ        explTaken … 受ける爆発ダメージ
//  heal      … 医療品の回復量        head     … 頭へのダメージ        sight  … 敵に見つかる距離
//  deployHp  … 設置物の体力

export const CLASSES = {
  assault: {
    name: { ja: "突撃兵", en: "Assault" },
    desc: { ja: "速く動き、速く装填する。前に出て撃ち合う", en: "Moves and reloads faster. Built for the front line" },
    mods: { move: 1.06, reload: 0.9 },
    ability: {
      id: "rush", name: { ja: "突撃", en: "Rush" },
      desc: { ja: "8 秒間、移動 +25%・リロード -40%・反動 -30%", en: "8 s: +25% speed, -40% reload time, -30% recoil" },
      seconds: 8, cooldown: 60, mods: { move: 1.25, reload: 0.6, recoil: 0.7 },
    },
  },
  medic: {
    name: { ja: "衛生兵", en: "Medic" },
    desc: { ja: "医療品の回復量 +50%。被弾していない間、少しずつ回復する", en: "+50% healing from medical items. Slowly regenerates out of combat" },
    mods: { heal: 1.5 }, regen: { every: 60, amount: 1, calm: 100 },
    ability: {
      id: "field", name: { ja: "回復フィールド", en: "Healing Field" },
      desc: { ja: "8 秒間、まわり 5 ブロックの自分・味方・分隊を回復する", en: "8 s: heals you, allies and your squad within 5 blocks" },
      seconds: 8, cooldown: 70, radius: 5,
    },
  },
  engineer: {
    name: { ja: "工兵", en: "Engineer" },
    desc: { ja: "設置物の体力 +50%、受ける爆発ダメージ -25%", en: "+50% deployable health, -25% explosive damage taken" },
    mods: { deployHp: 1.5, explTaken: 0.75 },
    ability: {
      id: "resupply", name: { ja: "補給パック", en: "Resupply" },
      desc: { ja: "自分とまわり 6 ブロックの味方に、持っている銃の弾倉 2 本分の弾を配る", en: "You and allies within 6 blocks get 2 magazines for the held gun" },
      seconds: 0, cooldown: 60, radius: 6, mags: 2,
    },
  },
  recon: {
    name: { ja: "偵察兵", en: "Recon" },
    desc: { ja: "敵に見つかる距離 -25%、覗き込み -20%", en: "Spotted from 25% shorter range, 20% faster ADS" },
    mods: { sight: 0.75, ads: 0.8 },
    ability: {
      id: "pulse", name: { ja: "パルススキャン", en: "Pulse Scan" },
      desc: { ja: "まわり 40 ブロックの敵を 10 秒間マーク（壁越しに見え、受けるダメージ +15%）", en: "Marks enemies within 40 blocks for 10 s (seen through walls, +15% damage)" },
      seconds: 10, cooldown: 45, radius: 40,
    },
  },
  heavy: {
    name: { ja: "重装兵", en: "Heavy" },
    desc: { ja: "受けるダメージ -12%、機関銃・重火器の反動 -20%、移動 -5%", en: "-12% damage taken, -20% LMG/heavy recoil, -5% speed" },
    mods: { dmgTaken: 0.88, heavyRecoil: 0.8, move: 0.95 },
    ability: {
      id: "bulwark", name: { ja: "防壁", en: "Bulwark" },
      desc: { ja: "6 秒間、受けるダメージ -60%・吹き飛ばされない", en: "6 s: -60% damage taken, no knockback" },
      seconds: 6, cooldown: 70, mods: { dmgTaken: 0.4 },
    },
  },
};

/** 既定の兵科（初めてのプレイヤー） */
export const DEFAULT_CLASS = "assault";
/** 兵科を変えてから次に変えられるまで（秒）。試合中は変えられない */
export const CLASS_SWITCH_COOLDOWN = 30;

export const PERKS = {
  // ---- ティア 1 ----
  quick_hands: { tier: 1, rank: 1, name: { ja: "早業", en: "Quick Hands" }, desc: { ja: "リロード -15%", en: "-15% reload time" }, mods: { reload: 0.85 } },
  fleet_foot: { tier: 1, rank: 4, name: { ja: "健脚", en: "Fleet Foot" }, desc: { ja: "移動 +5%、走ったあと撃てるまで -40%", en: "+5% speed, -40% sprint-to-fire" }, mods: { move: 1.05, ready: 0.6 } },
  steady_aim: { tier: 1, rank: 8, name: { ja: "安定照準", en: "Steady Aim" }, desc: { ja: "覗き込み -25%、腰だめの広がり -15%", en: "-25% ADS time, -15% hip spread" }, mods: { ads: 0.75, spread: 0.85 } },
  scavenger: { tier: 1, rank: 12, name: { ja: "回収屋", en: "Scavenger" }, desc: { ja: "銃で倒すと、その銃の弾を半分の弾倉ぶん拾う", en: "Gun kills give you half a magazine of ammo" }, scavenge: 0.5 },
  // ---- ティア 2 ----
  hardened: { tier: 2, rank: 6, name: { ja: "強靭", en: "Hardened" }, desc: { ja: "受けるダメージ -8%", en: "-8% damage taken" }, mods: { dmgTaken: 0.92 } },
  flak_jacket: { tier: 2, rank: 10, name: { ja: "防爆服", en: "Flak Jacket" }, desc: { ja: "受ける爆発ダメージ -40%", en: "-40% explosive damage taken" }, mods: { explTaken: 0.6 } },
  field_medic: { tier: 2, rank: 14, name: { ja: "応急処置", en: "Field Medic" }, desc: { ja: "医療品の回復量 +40%", en: "+40% healing from medical items" }, mods: { heal: 1.4 } },
  ghost: { tier: 2, rank: 18, name: { ja: "隠密", en: "Ghost" }, desc: { ja: "敵に見つかる距離 -30%", en: "Spotted from 30% shorter range" }, mods: { sight: 0.7 } },
  // ---- ティア 3 ----
  deadeye: { tier: 3, rank: 20, name: { ja: "精密射撃", en: "Deadeye" }, desc: { ja: "頭へのダメージ +20%", en: "+20% headshot damage" }, mods: { head: 1.2 } },
  adrenaline: { tier: 3, rank: 25, name: { ja: "闘志", en: "Adrenaline" }, desc: { ja: "倒すたびに体力 4 回復", en: "Heal 4 HP on every kill" }, killHeal: 4 },
  iron_grip: { tier: 3, rank: 30, name: { ja: "鉄の握り", en: "Iron Grip" }, desc: { ja: "反動 -20%", en: "-20% recoil" }, mods: { recoil: 0.8 } },
  last_stand: { tier: 3, rank: 35, name: { ja: "不屈", en: "Last Stand" }, desc: { ja: "倒れるダメージを 1 回だけ体力 1 で耐え、3 秒間ダメージ -80%（120 秒に 1 回）", en: "Survive a lethal hit with 1 HP and take -80% damage for 3 s (once per 120 s)" }, lastStand: { cooldown: 120, seconds: 3 } },
};

/** 補正の項目（既定はすべて 1） */
export const MOD_KEYS = ["move", "reload", "ads", "recoil", "heavyRecoil", "spread", "ready", "dmgTaken", "explTaken", "heal", "head", "sight", "deployHp"];
