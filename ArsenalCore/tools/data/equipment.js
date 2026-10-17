// ARSENAL CORE データ定義（tools/data/）。ランタイムにはビルド時に 1 ファイル（BP/scripts/config/weapons.data.js）へまとめて出力する。
// 投擲物・装備

// ---------------------------------------------------------------------------
//  投擲物
// ---------------------------------------------------------------------------
export const THROWABLES = {
  grenade_frag: { kind: "frag", tier: "common", name: { ja: "フラググレネード", en: "Frag Grenade" }, desc: { ja: "3 秒で爆発。長押しでクッキング", en: "Explodes after 3s. Hold to cook" }, fuse: 60, power: 3.2, speed: 1.1, cook: true, cost: { "arsenal:steel_ingot": 1, "minecraft:gunpowder": 2 }, out: 2 },
  grenade_impact: { kind: "impact", tier: "uncommon", name: { ja: "インパクトグレネード", en: "Impact Grenade" }, desc: { ja: "着弾で即爆発", en: "Explodes on impact" }, power: 2.6, speed: 1.2, cost: { "arsenal:steel_ingot": 1, "minecraft:gunpowder": 2, "minecraft:redstone": 1 }, out: 2 },
  grenade_smoke: { kind: "smoke", tier: "common", name: { ja: "スモークグレネード", en: "Smoke Grenade" }, desc: { ja: "15 秒間の煙幕を張る", en: "Deploys a 15s smoke screen" }, fuse: 30, duration: 300, radius: 5, speed: 1.1, cost: { "minecraft:iron_nugget": 4, "minecraft:gunpowder": 1, "minecraft:charcoal": 2 }, out: 2 },
  grenade_flash: { kind: "flash", tier: "uncommon", name: { ja: "フラッシュバン", en: "Flashbang" }, desc: { ja: "見ている者の視界を奪う", en: "Blinds anyone looking at it" }, fuse: 34, radius: 20, speed: 1.15, cost: { "minecraft:iron_nugget": 4, "minecraft:gunpowder": 1, "minecraft:glowstone_dust": 2 }, out: 2 },
  molotov: { kind: "molotov", tier: "common", name: { ja: "火炎瓶", en: "Molotov" }, desc: { ja: "着弾地点を炎上させる", en: "Sets the impact area ablaze" }, radius: 2.6, duration: 160, speed: 1.0, cost: { "minecraft:glass_bottle": 1, "minecraft:blaze_powder": 1, "minecraft:paper": 1 }, out: 1 },
  sticky_bomb: { kind: "sticky", tier: "uncommon", name: { ja: "スティッキー爆弾", en: "Sticky Bomb" }, desc: { ja: "壁や敵に張り付き 2 秒後に爆発", en: "Sticks to anything, explodes after 2s" }, fuse: 40, power: 3.0, speed: 1.05, cost: { "minecraft:slime_ball": 1, "minecraft:gunpowder": 2, "arsenal:steel_ingot": 1 }, out: 2 },
  c4: { kind: "c4", tier: "rare", name: { ja: "C4 爆薬", en: "C4 Charge" }, desc: { ja: "投げて貼り付け、起爆装置で爆破", en: "Throw it, then use the detonator" }, power: 4.6, speed: 0.8, cost: { "minecraft:tnt": 1, "arsenal:polymer": 2, "minecraft:redstone": 2 }, out: 1 },
  landmine: { kind: "mine", tier: "uncommon", name: { ja: "地雷", en: "Landmine" }, desc: { ja: "地面に設置。敵が踏むと爆発", en: "Place on ground. Triggers on enemies" }, power: 3.2, triggerRadius: 1.3, cost: { "arsenal:steel_ingot": 2, "minecraft:gunpowder": 2, "minecraft:stone_pressure_plate": 1 }, out: 2 },
  // ---- 2.0 で追加 ----
  grenade_gas: { kind: "gas", tier: "uncommon", name: { ja: "ガスグレネード", en: "Gas Grenade" }, desc: { ja: "12 秒間の毒ガス。ガスマスクで防げる", en: "12s toxic cloud. Gas masks block it" }, fuse: 30, duration: 240, radius: 4.5, speed: 1.1, cost: { "minecraft:iron_nugget": 4, "minecraft:spider_eye": 1, "minecraft:gunpowder": 1 }, out: 2 },
  grenade_emp: { kind: "emp", tier: "rare", name: { ja: "EMP グレネード", en: "EMP Grenade" }, desc: { ja: "範囲内の機械・エネルギー兵器・ドローン・砲台を 8 秒止める", en: "Disables machines, energy weapons, drones and turrets for 8s" }, fuse: 34, radius: 9, duration: 160, speed: 1.1, cost: { "arsenal:precision_parts": 1, "minecraft:redstone": 4, "minecraft:copper_ingot": 2 }, out: 2 },
  grenade_cluster: { kind: "cluster", tier: "rare", name: { ja: "クラスターグレネード", en: "Cluster Grenade" }, desc: { ja: "爆発後に 5 個の子弾をばら撒く", en: "Bursts into five bomblets" }, fuse: 50, power: 2.4, bomblets: 5, bombletPower: 1.6, speed: 1.05, cost: { "arsenal:steel_ingot": 2, "minecraft:gunpowder": 4 }, out: 1 },
  grenade_decoy: { kind: "decoy", tier: "common", name: { ja: "デコイ", en: "Decoy" }, desc: { ja: "偽の銃声を 8 秒鳴らし、敵をおびき寄せる", en: "Fakes gunfire for 8s to lure enemies" }, fuse: 20, duration: 160, radius: 24, speed: 1.1, cost: { "minecraft:iron_nugget": 3, "minecraft:noteblock": 1, "minecraft:redstone": 1 }, out: 2 },
  throwing_knife: { kind: "knife", tier: "common", name: { ja: "投げナイフ", en: "Throwing Knife" }, desc: { ja: "まっすぐ飛ぶ。頭に当てれば一撃。刺さったら拾える", en: "Flies straight. Headshots kill. Pick it back up" }, dmg: 9, head: 2.5, speed: 2.4, cost: { "arsenal:steel_ingot": 1, "minecraft:stick": 1 }, out: 2 },
  grenade_snap: { kind: "snap", tier: "uncommon", name: { ja: "スナップグレネード", en: "Snap Grenade" }, desc: { ja: "周囲 20 ブロックの敵の位置を 8 秒間あぶり出す", en: "Reveals enemies within 20 blocks for 8s" }, fuse: 24, radius: 20, duration: 160, speed: 1.1, cost: { "minecraft:iron_nugget": 3, "minecraft:redstone": 2, "minecraft:ender_pearl": 1 }, out: 2 },
  grenade_mini: { kind: "frag", tier: "common", name: { ja: "ミニグレネード", en: "Mini Grenade" }, desc: { ja: "小型で遠くへ投げられる。2 秒で爆発。威力は控えめ", en: "Small and throws far. 2s fuse, lighter blast" }, fuse: 40, power: 2.2, speed: 1.35, cook: true, cost: { "arsenal:steel_ingot": 1, "minecraft:gunpowder": 1 }, out: 3 },
  grenade_heavy_impact: { kind: "impact", tier: "rare", name: { ja: "高性能インパクト弾", en: "HE Impact Grenade" }, desc: { ja: "着弾で即爆発。重く飛距離は短いが威力大", en: "Explodes on impact. Heavy, short range, big blast" }, power: 3.6, speed: 0.9, cost: { "arsenal:steel_ingot": 2, "minecraft:gunpowder": 3, "minecraft:redstone": 1 }, out: 1 },
  thermite: { kind: "molotov", tier: "uncommon", name: { ja: "テルミット", en: "Thermite" }, desc: { ja: "狭い範囲を長時間燃やし続ける", en: "Burns a tight area for a long time" }, radius: 1.8, duration: 300, speed: 1.0, cost: { "minecraft:iron_nugget": 4, "minecraft:blaze_powder": 1, "minecraft:redstone": 1 }, out: 1 },
};

// ---------------------------------------------------------------------------
//  医療品（2.0）
//  use … 使用に掛かる tick / heal … 回復量 / regen … 持続回復（tick, 毎秒回復量）
// ---------------------------------------------------------------------------
export const MEDICAL = {
  bandage: { tier: "common", name: { ja: "包帯", en: "Bandage" }, desc: { ja: "出血を止め、体力を 2 回復", en: "Stops bleeding, heals 2" }, use: 20, heal: 2, stopsBleed: true, cost: { "minecraft:paper": 2, "minecraft:string": 1 }, out: 3 },
  medkit: { tier: "uncommon", name: { ja: "メディキット", en: "Medkit" }, desc: { ja: "出血を止め、10 秒かけて体力を 12 回復", en: "Stops bleeding, heals 12 over 10s" }, use: 36, heal: 2, regen: [200, 1.0], stopsBleed: true, cost: { "minecraft:golden_apple": 1, "minecraft:paper": 2, "arsenal:polymer": 1 }, out: 2 },
  adrenaline: { tier: "rare", name: { ja: "アドレナリン", en: "Adrenaline" }, desc: { ja: "10 秒間、移動速度と被ダメージ軽減", en: "10s of speed and damage resistance" }, use: 10, heal: 0, buff: 200, cost: { "minecraft:sugar": 2, "minecraft:glistering_melon_slice": 1, "minecraft:glass_bottle": 1 }, out: 2 },
  defibrillator: { tier: "rare", name: { ja: "除細動器", en: "Defibrillator" }, desc: { ja: "ダウンした味方を蘇生する（ダウン制あり時）", en: "Revives a downed ally (when downed rules are on)" }, use: 40, heal: 0, revive: 8, cost: { "arsenal:precision_parts": 2, "minecraft:redstone_block": 1, "minecraft:copper_ingot": 3 }, out: 1 },
  armor_plate: { tier: "common", name: { ja: "アーマープレート", en: "Armor Plate" }, desc: { ja: "ボディアーマーに差し込む。1 枚でダメージ 10 を受け止める", en: "Insert into body armor. Each soaks 10 damage" }, use: 24, heal: 0, plate: true, cost: { "arsenal:steel_ingot": 2, "arsenal:polymer": 1 }, out: 2 },
};

// ---------------------------------------------------------------------------
//  設置物（2.0）
//  entity … 設置される実体 / health … 耐久 / range … 索敵・効果半径
// ---------------------------------------------------------------------------
export const DEPLOYABLES = {
  sentry_turret: { tier: "rare", name: { ja: "センチネル砲台", en: "Sentinel Turret" }, desc: { ja: "近づく敵を自動で撃つ。弾は設置者の在庫から補充", en: "Auto-fires at enemies. Draws ammo from your stock" }, entity: "sentry", health: 40, range: 24, dmg: 3.0, rpm: 400, ammo: "medium", mag: 60, cost: { "arsenal:steel_ingot": 8, "arsenal:precision_parts": 4, "minecraft:observer": 1, "minecraft:dispenser": 1 } },
  deploy_shield: { tier: "uncommon", name: { ja: "設置式シールド", en: "Deployable Shield" }, desc: { ja: "弾を止める防弾板。耐久 60", en: "Bulletproof cover with 60 HP" }, entity: "shield_wall", health: 60, range: 0, cost: { "arsenal:steel_ingot": 6, "arsenal:polymer": 2 } },
  claymore: { tier: "uncommon", name: { ja: "クレイモア", en: "Claymore" }, desc: { ja: "設置した向きの扇状に敵を感知して爆発", en: "Directional mine: triggers in a forward cone" }, entity: "claymore", health: 4, range: 3.5, power: 2.8, cost: { "arsenal:steel_ingot": 2, "minecraft:gunpowder": 3, "minecraft:tripwire_hook": 1 } },
  ammo_station: { tier: "uncommon", name: { ja: "弾薬ステーション", en: "Ammo Station" }, desc: { ja: "周囲 5 ブロックの味方の弾を 5 秒ごとに補給（在庫 300 発）", en: "Resupplies allies within 5 blocks every 5s (300-round stock)" }, entity: "ammo_station", health: 30, range: 5, stock: 300, cost: { "arsenal:steel_ingot": 4, "arsenal:polymer": 2, "minecraft:chest": 1, "minecraft:gunpowder": 8 } },
  med_station: { tier: "rare", name: { ja: "医療ステーション", en: "Med Station" }, desc: { ja: "周囲 5 ブロックの味方を回復し、出血を止める（60 秒）", en: "Heals allies within 5 blocks and stops bleeding (60s)" }, entity: "med_station", health: 30, range: 5, duration: 1200, cost: { "arsenal:steel_ingot": 3, "arsenal:polymer": 3, "minecraft:golden_apple": 1, "minecraft:glowstone_dust": 2 } },
  mortar_emplacement: { tier: "rare", name: { ja: "迫撃砲陣地", en: "Mortar Emplacement" }, desc: { ja: "設置して使うと座標を指定して砲撃できる（迫撃砲弾を使う）", en: "Place, then use it to shell a target position (uses mortar shells)" }, entity: "mortar_emplacement", health: 50, range: 160, cost: { "arsenal:steel_ingot": 8, "minecraft:iron_block": 1, "arsenal:precision_parts": 2 } },
  recon_drone: { tier: "rare", name: { ja: "偵察ドローン", en: "Recon Drone" }, desc: { ja: "使うとドローン視点で飛ばせる。見つけた敵をマーキング。スニークで戻る", en: "Fly a drone from its camera; marks enemies. Sneak to return" }, entity: "recon_drone", health: 10, range: 64, duration: 600, cost: { "arsenal:precision_parts": 3, "arsenal:polymer": 3, "minecraft:feather": 4, "minecraft:redstone": 2 } },
  riot_shield: { tier: "uncommon", name: { ja: "ライオットシールド", en: "Riot Shield" }, desc: { ja: "オフハンドに持つと正面からの弾を防ぐ。構えている間は遅くなる", en: "Offhand: blocks bullets from the front. Slower while held" }, offhand: true, health: 0, range: 0, durability: 600, cost: { "arsenal:steel_ingot": 5, "arsenal:polymer": 3, "minecraft:glass_pane": 1 } },
};

// ---------------------------------------------------------------------------
//  銃座と乗り物（2.0）
// ---------------------------------------------------------------------------
export const VEHICLES = {
  hmg_nest: { kind: "emplacement", tier: "rare", name: { ja: "重機関銃座", en: "HMG Nest" }, desc: { ja: "乗って視点で照準、ジャンプボタンで射撃", en: "Mount it, aim with your view, fire with Jump" }, health: 80, dmg: 6.0, rpm: 540, range: 90, spread: 1.2, ammo: "heavy", sound: "hmg", fire: "hitscan", cost: { "arsenal:steel_ingot": 10, "arsenal:precision_parts": 4, "minecraft:iron_block": 1 } },
  aa_gun: { kind: "emplacement", tier: "rare", name: { ja: "対空機関砲", en: "AA Gun" }, desc: { ja: "炸裂弾の二連装。空中の敵やドローンに強い", en: "Twin flak cannon. Deadly against flyers and drones" }, health: 90, dmg: 5.0, rpm: 360, range: 120, spread: 1.6, ammo: "heavy", sound: "battle", fire: "flak", flak: 2.5, cost: { "arsenal:steel_ingot": 12, "arsenal:precision_parts": 5, "minecraft:iron_block": 2 } },
  at_post: { kind: "emplacement", tier: "rare", name: { ja: "対装甲ランチャー座", en: "AT Launcher Post" }, desc: { ja: "有線誘導ロケット。視点の先へ飛んでいく", en: "Wire-guided rocket that flies where you look" }, health: 70, dmg: 14.0, rpm: 20, range: 160, spread: 0, ammo: "rocket", sound: "rocket", fire: "wire", power: 4.0, cost: { "arsenal:steel_ingot": 10, "arsenal:precision_parts": 6, "minecraft:tnt": 2 } },
  buggy: { kind: "vehicle", tier: "rare", name: { ja: "軽装甲バギー", en: "Armored Buggy" }, desc: { ja: "2 人乗り。運転席と銃手席（機関銃）。燃料で走る", en: "Two seats: driver and gunner (MG). Runs on fuel" }, health: 120, speed: 0.34, fuel: 2400, dmg: 4.0, rpm: 600, range: 60, spread: 2.0, ammo: "medium", sound: "lmg", fire: "hitscan", cost: { "arsenal:steel_ingot": 16, "arsenal:precision_parts": 6, "minecraft:iron_block": 2, "arsenal:polymer": 4 } },
  // ---- 2.3 で追加 ----
  gl_post: { kind: "emplacement", tier: "rare", name: { ja: "自動擲弾銃座", en: "Auto Grenade Post" }, desc: { ja: "40mm 擲弾を連射する。弧を描いて遮蔽物の裏に落とせる", en: "Rapid-fire 40mm grenades that arc behind cover" }, health: 75, dmg: 8.0, rpm: 150, range: 70, spread: 1.4, ammo: "gl40", sound: "launcher", fire: "gl40", cost: { "arsenal:steel_ingot": 10, "arsenal:precision_parts": 5, "minecraft:iron_block": 1, "minecraft:tnt": 1 } },
  apc: { kind: "vehicle", tier: "legendary", name: { ja: "装甲兵員輸送車", en: "Armored Personnel Carrier" }, desc: { ja: "2 人乗りの重装甲車。遅いが頑丈で、銃手席は重機関銃", en: "Two-seat heavy armor. Slow but tough, with an HMG turret" }, health: 240, speed: 0.27, fuel: 3200, dmg: 6.0, rpm: 480, range: 80, spread: 1.6, ammo: "heavy", sound: "hmg", fire: "hitscan", cost: { "arsenal:steel_ingot": 24, "arsenal:precision_parts": 8, "minecraft:iron_block": 4, "arsenal:polymer": 6 } },
};

