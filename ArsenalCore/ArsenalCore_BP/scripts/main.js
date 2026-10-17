// @ts-check
/**
 * ARSENAL CORE — エントリポイント
 *   起動・イベント登録・カスタムコンポーネント登録・グローバルループ（1 本）
 */
import { world, system, Player, ButtonState, InputButton, GameMode, ItemStack } from "@minecraft/server";
import { weaponIdOf, throwableIdOf, meleeIdOf, medicalIdOf, deployableIdOf, lookOf, ITEM, NS, DATA } from "./config/constants.js";
import { S, dropState, allStates } from "./core/state.js";
import { P, forgetPrefs, W as WS, isOperator } from "./core/settings.js";
import { readWeapon, heldItem, itemKey, PROP, isWeaponItem, findWeaponSlot } from "./core/weaponState.js";
import { tickFire, pressTrigger, releaseCharge, flushWear, stopTapFire } from "./core/fireController.js";
import { tickReload, startReload, cancelReload } from "./core/reload.js";
import { tickAim, clearAim, resetMove, holdBreath, resetFov, applyMove, ensureFpOffset } from "./core/aim.js";
import { recoverBloom, tickRecoil } from "./core/recoil.js";
import { attachDeathHandler, attachExplosionTracking, forgetEntity } from "./core/damage.js";
import { attachSuppression, tickSuppression } from "./core/suppression.js";
import { attachDowned, tickDowned, forgetDowned, isDowned } from "./core/downed.js";
import { armorMove, riotShieldMove, tickNvg, forgetArmor } from "./core/armor.js";
import { migrateWorld, migratePlayer, syncLook, normalizeVariants } from "./core/migrate.js";
import { onMeleeHit, onMeleeStartUse, onMeleeStopUse, tryBreach, buttStroke, meleeMove } from "./core/melee.js";
import { renderWeaponHud, SCOPE_OFF } from "./ui/hud.js";
import { renderHud2, addHud2Provider, usesHud2 } from "./ui/hud2.js";
import { openWeaponMenu, openManual, openBench, openPress, useCrate, useRepairKit, setMode } from "./ui/menus.js";
import { toggleCalib, calibNext, calibSave, calibHud, openReport } from "./ui/codex.js";
import { tickProjectiles, sweepOrphans } from "./systems/projectiles.js";
import { beginThrow, releaseThrow, tickThrowable, useDetonator, tryPlaceMine } from "./systems/throwables.js";
import { tickDummies, attachDummyPickup } from "./systems/dummy.js";
import { attachLoot } from "./systems/loot.js";
import { attachBrain, tickBrain, scanForAI, spawnEnemy } from "./systems/ai/brain.js";
import { attachBosses, tickBosses, summonBoss } from "./systems/bosses.js";
import { attachBleeding, tickGearPlayer, completeMedical, startGearUse, stopGearUse, tryDeploy } from "./systems/gear.js";
import { attachDeployables, tickDeployables, launchDrone } from "./systems/deployables.js";
import { attachVehicles, tickMounted } from "./systems/vehicles.js";
import { attachStreaks, tickStreaks, openTerminal, streakReady, forgetStreaks } from "./systems/killstreaks.js";
import { attachStructures, tickStructures, onSiteTick, expand } from "./systems/structures.js";
import { attachProgression, flushAll, forgetProfile } from "./progression/progression.js";
import { attachEconomy, creditsForHud, addCredits } from "./economy/economy.js";
import { attachModes, tickModes, openArenaTool, inMatch } from "./modes/modes.js";
import { playNear } from "./fx/effects.js";
import { t } from "./util/i18n.js";
import { safe, info } from "./util/log.js";

// ---------------------------------------------------------------------------
//  カスタムコンポーネント
// ---------------------------------------------------------------------------
system.beforeEvents.startup.subscribe((ev) => {
  ev.blockComponentRegistry.registerCustomComponent(`${NS}:station`, {
    onPlayerInteract(e, p) {
      const player = e.player;
      if (!player) return;
      const kind = /** @type {any} */ (p.params)?.kind;
      system.run(() => safe("station", () => {
        if (kind === "bench") openBench(player);
        else if (kind === "press") openPress(player);
        else if (kind === "crate") useCrate(player);
      }));
    },
  });
  // 構造物の目印：近くにプレイヤーが来たら本体を展開
  ev.blockComponentRegistry.registerCustomComponent(`${NS}:site`, {
    onTick(e) {
      safe("site.tick", () => onSiteTick(e.block, e.dimension));
    },
    // 地形生成で置かれたブロックに定期 tick が付かない場合の保険（ランダム tick は読み込まれたチャンクで必ず起きる）
    onRandomTick(e) {
      safe("site.rtick", () => onSiteTick(e.block, e.dimension));
    },
  });
  ev.itemComponentRegistry.registerCustomComponent(`${NS}:tool`, {
    onUse(e) {
      const player = e.source;
      const id = e.itemStack?.typeId;
      system.run(() => safe("tool", () => {
        if (id === ITEM.manual) openManual(player);
        else if (id === ITEM.detonator) useDetonator(player);
        else if (id === ITEM.repairKit) useRepairKit(player);
        else if (id === ITEM.arenaTool) openArenaTool(player);
        else if (id === ITEM.streakTerminal) openTerminal(player);
        else if (id === ITEM.warlordBanner) summonBoss(player, "boss_warlord", id);
        else if (id === ITEM.legionCore) summonBoss(player, "boss_juggernaut", id);
      }));
    },
  });
  ev.itemComponentRegistry.registerCustomComponent(`${NS}:melee`, {
    onHitEntity(e) {
      const a = e.attackingEntity;
      const mid = e.itemStack ? meleeIdOf(e.itemStack.typeId) : undefined;
      if (!(a instanceof Player) || !mid) return;
      const target = e.hitEntity;
      system.run(() => safe("melee.hit", () => onMeleeHit(a, target, mid)));
    },
    onUseOn(e) {
      const p = e.source;
      if (!(p instanceof Player)) return;
      const block = e.block;
      system.run(() => safe("melee.breach", () => tryBreach(p, block)));
    },
  });
  ev.itemComponentRegistry.registerCustomComponent(`${NS}:gear`, {
    onUseOn(e) {
      const p = e.source;
      if (!(p instanceof Player) || !e.itemStack) return;
      const typeId = e.itemStack.typeId;
      const block = e.block;
      const face = String(e.blockFace);
      system.run(() => safe("gear.deploy", () => tryDeploy(p, block, face, typeId)));
    },
    onUse(e) {
      const p = e.source;
      const id = e.itemStack?.typeId;
      if (id && deployableIdOf(id) === "recon_drone") system.run(() => safe("gear.drone", () => launchDrone(p)));
    },
    onCompleteUse(e) {
      const p = e.source;
      const mid = e.itemStack ? medicalIdOf(e.itemStack.typeId) : undefined;
      if (!(p instanceof Player) || !mid) return;
      system.run(() => safe("gear.med", () => completeMedical(p, mid)));
    },
  });
});

// ---------------------------------------------------------------------------
//  武器の装備・収納
// ---------------------------------------------------------------------------

/**
 * @param {Player} player @param {import("./core/state.js").PlayerState} s @param {string} wid @param {number} slotIdx @param {import("@minecraft/server").ItemStack} item
 */
function equip(player, s, wid, slotIdx, item) {
  const inv = player.getComponent("minecraft:inventory")?.container;
  if (!inv) return;
  const slot = inv.getSlot(slotIdx);
  const ws = readWeapon(slot, wid);
  const cur = inv.getItem(slotIdx) ?? item;
  s.weaponId = wid;
  s.slot = slotIdx;
  s.uid = /** @type {string|undefined} */ (cur.getDynamicProperty(PROP.id)) ?? null;
  // 識別子を書いた直後でも持ち替え扱いにならないよう、書いた後のアイテムでキーを作る
  s.heldKey = itemKey(cur, slotIdx);
  // 光学・迷彩に合った見た目の ID への差し替えは、使用ボタンを離しているときに tickWeapon で行う
  s.lookCheck = 0;
  s.stats = ws.stats;
  s.ammo = ws.ammo;
  s.mode = ws.mode;
  s.att = ws.att;
  s.ammoType = ws.ammoType;
  s.ub = ws.ub;
  s.jammed = false;
  s.heat = 0;
  s.overheatUntil = 0;
  s.holding = false;
  s.tapFiring = false;
  s.ammoDirty = false;
  s.pressQueue = 0;
  s.burstLeft = 0;
  s.bloom = 0;
  s.kickDebt = 0;
  s.spin = 0;
  s.charge = 0;
  s.reload = null;
  s.wearPending = 0;
  s.shotTimer = Math.max(4, Math.min(12, ws.stats.adsTime * 2));
  s.lastEquipTick = system.currentTick;
  s.poseWeapon = null;
  s.moveApplied = false;
  s.hudDirty = true;
  s.magHits = 0;
  s.look = lookOf(cur.typeId)?.look ?? 0;
  playNear(player.dimension, player.location, "arsenal.mech.equip", { range: 10, volume: 0.8 });
  // 初めて手にしたときの操作ヒント
  const now = system.currentTick;
  if (now - s.lastHintTick > 20 * 60 * 10) {
    s.lastHintTick = now;
    const seen = player.getDynamicProperty("arsenal:hinted");
    if (seen !== true) {
      player.setDynamicProperty("arsenal:hinted", true);
      player.sendMessage(t("arsenal.ui.first_hint"));
    }
  }
}

/**
 * @param {Player} player @param {import("./core/state.js").PlayerState} s
 */
function holster(player, s) {
  if (!s.weaponId) return;
  flushWearAt(player, s, s.slot);
  cancelReload(player, s);
  clearAim(player, s);
  resetMove(player);
  s.moveApplied = false;
  s.weaponId = null;
  s.heldKey = null;
  s.stats = null;
  s.holding = false;
  s.tapFiring = false;
  s.pressQueue = 0;
  s.burstLeft = 0;
  s.hudDirty = true;
  safe("pose.stop", () => player.playAnimation("animation.arsenal.none", { controller: "arsenal_hold", blendOutTime: 0.15 }));
}

/**
 * 収納時：元のスロットへ損耗を書き込む
 * @param {Player} player @param {import("./core/state.js").PlayerState} s @param {number} idx
 */
function flushWearAt(player, s, idx) {
  if (s.wearPending <= 0 && !s.ammoDirty) return;
  const n = s.wearPending;
  const writeAmmo = s.ammoDirty;
  s.wearPending = 0;
  s.ammoDirty = false;
  safe("flushWearAt", () => {
    const inv = player.getComponent("minecraft:inventory")?.container;
    if (!inv) return;
    // 並べ替えで別のスロットへ動いていても、識別子で同じ 1 挺を探して書く
    const at = findWeaponSlot(inv, idx, s.weaponId, s.uid);
    const it = at >= 0 ? inv.getItem(at) : undefined;
    if (!it || !isWeaponItem(it, s.weaponId)) return;
    if (writeAmmo) it.setDynamicProperty(PROP.ammo, s.ammo);
    const d = it.getComponent("minecraft:durability");
    if (d && n > 0) d.damage = Math.min(d.maxDurability - 1, d.damage + n);
    inv.setItem(at, it);
  });
}

// ---------------------------------------------------------------------------
//  入力
// ---------------------------------------------------------------------------
world.afterEvents.itemStartUse.subscribe((ev) => {
  safe("itemStartUse", () => {
    const player = ev.source;
    const id = ev.itemStack.typeId;
    const wid = weaponIdOf(id);
    const s = S(player);
    if (wid) {
      if (player.getRotation().x < -80) {
        s.holding = false;
        system.run(() => safe("menu", () => openWeaponMenu(player)));
        return;
      }
      if (s.menuOpen) return;
      const now = system.currentTick;
      s.startUseTick = now;
      if (s.weaponId === wid && s.mode === "auto" && P(player).triggerMode === "tap") {
        // タップで撃ち始め、もう一度タップで止める（スマホ向け）
        if (now - s.lastToggleTick < 5) return;
        s.lastToggleTick = now;
        if (s.tapFiring) {
          stopTapFire(player, s);
        } else {
          s.tapFiring = true;
          s.holding = true;
          pressTrigger(s);
          s.hudDirty = true;
        }
        return;
      }
      s.holding = true;
      if (s.weaponId === wid) pressTrigger(s);
      return;
    }
    const tid = throwableIdOf(id);
    if (tid) {
      beginThrow(player, tid);
      return;
    }
    const mid = meleeIdOf(id);
    if (mid) {
      onMeleeStartUse(player, mid, ev.itemStack);
      return;
    }
    startGearUse(player, id);
  });
});

/** @param {Player} player @param {import("@minecraft/server").ItemStack|undefined} item */
function onStop(player, item) {
  const s = S(player);
  const id = item?.typeId ?? "";
  if (weaponIdOf(id) || s.weaponId) {
    if (s.tapFiring) return;
    s.holding = false;
    releaseCharge(player, s);
    // 指を離した時点で残弾・損耗を書き込む（撃っている最中は書き換えない）
    if (s.weaponId) flushWear(player, s);
  }
  if (throwableIdOf(id) || s.throwing) releaseThrow(player);
  if (meleeIdOf(id)) onMeleeStopUse(player);
  if (s.useItem) stopGearUse(player);
}

world.afterEvents.itemStopUse.subscribe((ev) => safe("itemStopUse", () => onStop(ev.source, ev.itemStack)));
world.afterEvents.itemReleaseUse.subscribe((ev) => safe("itemReleaseUse", () => onStop(ev.source, ev.itemStack)));

world.afterEvents.itemUse.subscribe((ev) => {
  safe("itemUse", () => {
    const player = ev.source;
    const wid = weaponIdOf(ev.itemStack.typeId);
    if (!wid) return;
    const s = S(player);
    if (player.getRotation().x < -80) return;
    s.pendingUseTick = system.currentTick;
  });
});

world.afterEvents.playerButtonInput.subscribe((ev) => {
  safe("buttonInput", () => {
    const player = ev.player;
    const s = S(player);
    const now = system.currentTick;
    // 一人称の位置の調整モード：ジャンプで次、スニーク 2 回で保存
    if (s.calib && ev.newButtonState === ButtonState.Pressed) {
      if (ev.button === InputButton.Jump) {
        calibNext(player, s);
        return;
      }
      if (ev.button === InputButton.Sneak) {
        if (now - s.lastSneakPress <= 8) {
          s.lastSneakPress = -99;
          calibSave(player, s);
        } else s.lastSneakPress = now;
        return;
      }
    }
    if (!s.weaponId || !s.stats) return;
    if (ev.button === InputButton.Sneak && ev.newButtonState === ButtonState.Pressed) {
      // ジャンプ中にスニーク → 射撃モード切替
      const jumpHeld = safe("jump", () => player.inputInfo.getButtonState(InputButton.Jump) === ButtonState.Pressed) ?? false;
      if (jumpHeld && !player.isOnGround && s.stats.modes.length > 1) {
        const i = s.stats.modes.indexOf(s.mode);
        setMode(player, s, s.stats.modes[(i + 1) % s.stats.modes.length]);
        return;
      }
      if (P(player).adsMode === "toggle") s.adsToggle = !s.adsToggle;
      if (P(player).reloadInput === "double_sneak") {
        if (now - s.lastSneakPress <= 8) {
          s.lastSneakPress = -99;
          startReload(player, s, true);
          return;
        }
      }
      s.lastSneakPress = now;
    } else if (ev.button === InputButton.Jump && ev.newButtonState === ButtonState.Pressed) {
      if (s.ads && !s.ridingId) holdBreath(player, s);
    }
  });
});

world.afterEvents.playerInteractWithBlock.subscribe((ev) => {
  safe("interactBlock", () => {
    if (!ev.isFirstEvent) return;
    if (ev.itemStack?.typeId === `${NS}:landmine`) tryPlaceMine(ev.player, ev.block, ev.blockFace);
  });
});

// 銃で殴る（銃床打撃）
world.afterEvents.entityHitEntity.subscribe((ev) => {
  safe("buttStroke", () => {
    const p = ev.damagingEntity;
    if (!(p instanceof Player)) return;
    if (!S(p).weaponId) return;
    buttStroke(p, ev.hitEntity);
  });
});

// ---------------------------------------------------------------------------
//  プレイヤーのライフサイクル
// ---------------------------------------------------------------------------
world.afterEvents.playerSpawn.subscribe((ev) => {
  safe("playerSpawn", () => {
    const player = ev.player;
    const s = S(player);
    s.weaponId = null;
    s.heldKey = null;
    s.poseWeapon = null;
    s.reload = null;
    s.ridingId = null;
    s.hud2Last = "";
    resetMove(player);
    if (ev.initialSpawn) {
      migratePlayer(player);
      resetFov(player, 0);
      if (player.getDynamicProperty("arsenal:welcomed") !== true) {
        player.setDynamicProperty("arsenal:welcomed", true);
        player.sendMessage(t("arsenal.ui.welcome"));
        if (player.getGameMode() !== GameMode.Spectator) {
          const inv = player.getComponent("minecraft:inventory")?.container;
          const rest = inv?.addItem(new ItemStack(ITEM.manual, 1));
          if (rest) player.dimension.spawnItem(rest, player.location);
        }
      } else if (player.getDynamicProperty("a:v2hint") !== true) {
        // 1.0 系から更新したプレイヤーへ、2.0 の案内を 1 回だけ
        player.setDynamicProperty("a:v2hint", true);
        player.sendMessage(t("arsenal.ui.welcome_v2"));
      }
    }
  });
});

world.beforeEvents.playerLeave.subscribe((ev) => {
  const id = ev.player.id;
  const player = ev.player;
  const s = allStates().get(id);
  if (s && s.lightPos) {
    const pos = s.lightPos;
    const dim = player.dimension;
    system.run(() => safe("leave.light", () => {
      const b = dim.getBlock(pos);
      if (b && b.typeId === "minecraft:light_block_13") b.setType("minecraft:air");
    }));
  }
  system.run(() => {
    dropState(id);
    forgetPrefs(id);
    forgetArmor(id);
    forgetProfile(id);
    forgetStreaks(id);
    forgetDowned(id);
  });
});

world.afterEvents.entityDie.subscribe((ev) => {
  safe("playerDie", () => {
    const e = ev.deadEntity;
    if (!(e instanceof Player)) return;
    const s = S(e);
    s.reload = null;
    s.throwing = null;
    clearAim(e, s);
    s.weaponId = null;
    s.heldKey = null;
    s.bleedUntil = 0;
    s.medUntil = 0;
    s.sup = 0;
  });
}, { entityTypes: ["minecraft:player"] });

world.afterEvents.entityRemove.subscribe((ev) => forgetEntity(ev.removedEntityId));

world.afterEvents.worldLoad.subscribe(() => {
  safe("worldLoad", () => {
    migrateWorld();
    sweepOrphans();
    info(`loaded ${DATA.ADDON_VERSION.join(".")} — damageMul=${WS().damageMul}`);
  });
});

attachDeathHandler();
attachExplosionTracking();
attachDummyPickup();
attachLoot();
attachSuppression();
attachModes();
attachDowned();
attachBrain();
attachBosses();
attachBleeding();
attachDeployables();
attachVehicles();
attachStreaks();
attachStructures();
attachProgression();
attachEconomy();
addHud2Provider((p) => ({ cr: creditsForHud(p), ks: streakReady(p) ? "1" : "0" }));

// ---------------------------------------------------------------------------
//  グローバルループ（1 本）
// ---------------------------------------------------------------------------

/** @param {Player} player */
function tickPlayer(player) {
  const s = S(player);
  const now = system.currentTick;
  const held = heldItem(player);
  const slotIdx = player.selectedSlotIndex;
  const wid = held ? weaponIdOf(held.typeId) : undefined;
  tickSuppression(s);
  tickGearPlayer(player, s);
  const nvg = tickNvg(player, s);
  if (nvg !== s.nvgActive) {
    s.nvgActive = nvg;
    s.hudDirty = true;
  }
  tickMounted(player, s);
  if (s.calib && now % 20 === 0) calibHud(player, s);
  if (wid && held) {
    s.meleeId = null;
    const key = itemKey(held, slotIdx);
    if (s.heldKey !== key || s.weaponId !== wid) {
      holster(player, s);
      equip(player, s, wid, slotIdx, held);
    }
    tickWeapon(player, s);
  } else {
    if (s.weaponId) holster(player, s);
    const mid = held ? meleeIdOf(held.typeId) : undefined;
    if (mid !== (s.meleeId ?? undefined)) {
      s.meleeId = mid ?? null;
      s.hudDirty = true;
    }
    const tid = held ? throwableIdOf(held.typeId) : undefined;
    if (tid) tickThrowable(player, tid);
    else if (s.throwing) s.throwing = null;
    // 武器を持っていないときの移動速度（防具・盾・近接武器）
    const mul = armorMove(player) * riotShieldMove(player) * (mid ? meleeMove(mid) : 1);
    if (Math.abs(mul - 1) > 1e-3) {
      applyMove(player, mul);
      s.moveApplied = true;
    } else if (s.moveApplied) {
      resetMove(player);
      s.moveApplied = false;
    }
    if (s.calib) ensureFpOffset(player, s);
    // HUD 2.0：ARSENAL の品を持っている・試合中・乗車中・ダウン中・ドローンやガンシップの操作中だけ送る
    // （それ以外ではタイトルを使わず、地図やほかのアドオンの /title を邪魔しない）
    const style = usesHud2(player) && P(player).hudMode !== "off";
    const want = style && (!!held?.typeId.startsWith(`${NS}:`) || inMatch(player) || !!s.ridingId || isDowned(player) || s.gunshipUntil > now || !!s.droneId);
    if (want) renderHud2(player, s, false);
    else clearHud2(player, s);
  }
  // HUD の種類を切り替えたら、残っている HUD 2.0 の文字列を消す
  const style2 = usesHud2(player) ? "hud2" : "classic";
  if (s.hudStyleNow !== style2) {
    if (s.hudStyleNow) clearHud2(player, s, true);
    s.hudStyleNow = style2;
  }
}

/**
 * HUD 2.0 の表示をやめる（タイトルを目印だけのものにして、次のタイトルまで何も出さない）
 * @param {Player} player @param {import("./core/state.js").PlayerState} s @param {boolean} [force]
 */
function clearHud2(player, s, force = false) {
  if (!s.hud2Last && !force) return;
  s.hud2Last = "";
  s.hud2Tick = -99;
  safe("hud2.clear", () => player.onScreenDisplay.setTitle(SCOPE_OFF, { fadeInDuration: 0, stayDuration: 1, fadeOutDuration: 0 }));
}

/** @param {Player} player @param {import("./core/state.js").PlayerState} s */
function tickWeapon(player, s) {
  const st = s.stats;
  const now = system.currentTick;
  if (!st) return;
  // itemStartUse が来ない環境向けのフォールバック
  if (s.pendingUseTick && now - s.pendingUseTick >= 2) {
    if (s.startUseTick < s.pendingUseTick - 1) pressTrigger(s);
    s.pendingUseTick = 0;
  }
  if (s.menuOpen) {
    s.holding = false;
    s.pressQueue = 0;
  }
  if (s.tapFiring && (s.reload || s.mode !== "auto" || P(player).triggerMode !== "tap")) stopTapFire(player, s);
  recoverBloom(s, st);
  tickRecoil(player, s);
  tickReload(player, s);
  tickAim(player, s, st);
  tickFire(player, s);
  if ((s.wearPending > 0 || s.ammoDirty) && now - s.lastShotTick > 12 && !s.holding) flushWear(player, s);
  // 見た目違い ID への差し替え（使用ボタンを離しているときだけ。撃っている最中は手持ちを書き換えない）
  if (!s.holding && !s.tapFiring && now >= s.lookCheck && now - s.lastShotTick > 12) {
    s.lookCheck = now + 10;
    const inv = player.getComponent("minecraft:inventory")?.container;
    if (inv) syncLook(inv, player.selectedSlotIndex);
  }
  // HUD（HUD 2.0 と従来型の振り分け・状態メッセージは renderWeaponHud の中）
  renderWeaponHud(player, s, false);
}

system.runInterval(() => {
  for (const player of world.getAllPlayers()) {
    safe("tickPlayer", () => tickPlayer(player));
  }
  safe("tickProjectiles", () => tickProjectiles());
  safe("tickBrain", () => tickBrain());
  safe("tickBosses", () => tickBosses());
  safe("tickDeployables", () => tickDeployables());
  safe("tickStreaks", () => tickStreaks());
  safe("tickModes", () => tickModes());
  safe("tickStructures", () => tickStructures());
  const now = system.currentTick;
  if (now % 20 === 0) {
    safe("tickDummies", () => tickDummies());
    safe("tickDowned", () => tickDowned());
  }
  if (now % 100 === 50) safe("scanForAI", () => scanForAI());
  if (now % 100 === 0) safe("flushProgress", () => flushAll());
  if (now % 1200 === 600) safe("sweepOrphans", () => sweepOrphans());
}, 1);

// ---------------------------------------------------------------------------
//  スクリプトイベント
//    arsenal:give <武器 ID>   … 武器を渡す（OP）
//    arsenal:menu            … 野戦マニュアル
//    arsenal:calib           … 一人称の位置の調整モード（もう一度で終了）
//    arsenal:report          … 診断レポート
//    arsenal:normalize       … 見た目違い ID を元の武器 ID に戻す（アドオンを外す前に）
//    arsenal:spawn <敵 ID>    … 敵を出す（OP）
//    arsenal:site <構造物 ID> … 足元に構造物を展開（OP）
//    arsenal:credits <数>     … クレジットを足す（OP）
// ---------------------------------------------------------------------------
system.afterEvents.scriptEventReceive.subscribe((ev) => {
  safe("scriptEvent", () => {
    const p = ev.sourceEntity;
    if (!(p instanceof Player)) return;
    const arg = ev.message.trim();
    switch (ev.id) {
      case "arsenal:give":
        if (isOperator(p) && weaponIdOf(`${NS}:${arg}`)) p.getComponent("minecraft:inventory")?.container?.addItem(new ItemStack(`${NS}:${arg}`, 1));
        break;
      case "arsenal:menu":
        openManual(p);
        break;
      case "arsenal:calib":
        toggleCalib(p);
        break;
      case "arsenal:report":
        openReport(p);
        break;
      case "arsenal:normalize": {
        const n = normalizeVariants(p);
        p.sendMessage(t("arsenal.ui.normalized", String(n)));
        break;
      }
      case "arsenal:spawn":
        if (isOperator(p) && (/** @type {any} */ (DATA.ENEMIES)[arg] || /** @type {any} */ (DATA.BOSSES)[arg])) {
          const v = p.getViewDirection();
          spawnEnemy(p.dimension, { x: p.location.x + v.x * 4, y: p.location.y, z: p.location.z + v.z * 4 }, arg, { src: "command" });
        }
        break;
      case "arsenal:site":
        if (isOperator(p) && /** @type {any} */ (DATA.STRUCTURES)[arg]) expand(p.dimension, arg, { x: Math.floor(p.location.x), y: Math.floor(p.location.y), z: Math.floor(p.location.z) + 12 });
        break;
      case "arsenal:credits":
        if (isOperator(p)) addCredits(p, Number(arg) || 0, false);
        break;
    }
  });
});
