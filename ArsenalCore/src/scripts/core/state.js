// @ts-check
/**
 * プレイヤーごとの一時状態（メモリのみ）。退出時に必ず破棄する。
 */

/**
 * @typedef {Object} ReloadState
 * @property {"mag"|"single"} type
 * @property {string} weaponId
 * @property {number} slot
 * @property {number} start
 * @property {number} end
 * @property {boolean} tactical
 * @property {number} next   次の 1 発装填 tick（single）
 * @property {boolean} finishing
 * @property {boolean} cancelRequested
 * @property {number[]} cues 効果音を鳴らした段階
 */

/**
 * @typedef {Object} PlayerState
 * @property {string} id
 * @property {string|null} weaponId 所持中の武器
 * @property {number} slot 所持中のホットバースロット
 * @property {string|null} heldKey 所持アイテムの識別（typeId@slot）
 * @property {any} stats 実効ステータス
 * @property {number} ammo
 * @property {string} mode
 * @property {Record<string,string>} att
 * @property {string} ammoType
 * @property {number} ub アンダーバレル装弾数
 * @property {boolean} jammed
 * @property {number} heat
 * @property {number} overheatUntil
 * @property {boolean} holding 使用ボタン押下中
 * @property {boolean} tapFiring タップ切り替え式のフルオートで射撃中
 * @property {number} lastToggleTick
 * @property {boolean} ammoDirty 残弾をまだアイテムに書き込んでいない
 * @property {string} adsAnim 再生中の ADS アニメーション
 * @property {string} lastMark HUD に載せたスコープ表示の印
 * @property {number} markTick
 * @property {number} pressQueue 未処理の押下回数
 * @property {number} pendingUseTick
 * @property {number} startUseTick
 * @property {number} shotTimer 次弾まで（tick、小数）
 * @property {number} burstLeft
 * @property {number} bloom 追加拡散（度）
 * @property {number} kickDebt 回復待ちの縦反動（度）
 * @property {number} spin 回転（グラインダー）
 * @property {number} charge 充電（レールスパイク）
 * @property {ReloadState|null} reload
 * @property {boolean} ads
 * @property {number} adsLevel 0..1
 * @property {boolean} adsToggle
 * @property {number} lastSneakPress
 * @property {boolean} sneakDown
 * @property {boolean} jumpDown
 * @property {boolean} fovApplied
 * @property {number} fovValue
 * @property {boolean} moveApplied
 * @property {number} moveValue
 * @property {boolean} nvApplied
 * @property {boolean} slowApplied
 * @property {string|null} poseWeapon
 * @property {number} poseTick
 * @property {number} hudTick
 * @property {boolean} hudDirty
 * @property {{tick:number, kind:string, dmg:number}|null} hit
 * @property {string|null} lockTarget
 * @property {number} lockTicks
 * @property {number} lockSeen ロック対象を最後に照準の円錐の中で見た tick
 * @property {boolean} sprintPose 走っている間の構えを再生中か
 * @property {number} readyAt この tick まで撃てない（走ったあと構え直している）
 * @property {number[]} mags 手持ちの銃の途中のマガジン（弾数。多い順）
 * @property {number} armHitUntil 腕を撃たれて照準がぶれる期限
 * @property {number} legHitUntil 脚を撃たれて足を引きずる期限
 * @property {number} lastShotTick
 * @property {number} wearPending
 * @property {number} lastWearWrite
 * @property {number} lastKick
 * @property {number} breathUntil
 * @property {number} breathCooldown
 * @property {number} swayTick
 * @property {number} cooldownUntil
 * @property {{id:string,start:number}|null} throwing
 * @property {import("../util/math.js").Vec3|null} lightPos
 * @property {string|null} lightDim
 * @property {boolean} menuOpen
 * @property {number} lastEquipTick
 * @property {number} glintTick
 * @property {number} laserTick
 * @property {number} trajTick
 * @property {number} dryTick
 * @property {number} lastHintTick
 * @property {number} grappleUntil
 * @property {import("../util/math.js").Vec3|null} grapplePoint
 * @property {number} statusMsgUntil
 * @property {import("@minecraft/server").RawMessage|null} statusMsg
 * ---- 2.0 ----
 * @property {number} loopSoundTick 照射系の音を最後に鳴らした tick
 * @property {number} empUntil EMP でエネルギー兵器が止まっている期限
 * @property {{x:number,z:number}|null} mortarTarget 迫撃砲の目標座標（メニューで指定）
 * @property {number} sup 制圧の強さ 0〜3（小数）
 * @property {number} supTick
 * @property {{dir:number, tick:number}|null} dmgDir 被弾方向（HUD 2.0）
 * @property {number} meleeCd 近接の次に振れる tick
 * @property {number} meleeStart 近接武器の長押し開始 tick（-1 なら押していない）
 * @property {string|null} meleeId 持っている近接武器
 * @property {number} lastButt 銃床打撃の tick
 * @property {boolean} variableHigh 可変倍率スコープが高倍率側
 * @property {boolean} cantedOn キャンテッドアイアンに持ち替え中
 * @property {number} assistTick
 * @property {string|null} assistTarget エイムアシストが追っている相手
 * @property {boolean} autoFiring 自動射撃で押している
 * @property {number} streak 連続キル
 * @property {number} streakPts PvE のストリークポイント
 * @property {string} hud2Last HUD 2.0 に最後に送った文字列
 * @property {number} hud2Tick
 * @property {number} hud2Seq HUD 2.0 を送った回数（タイトルに 0〜9 で載せる）
 * @property {string} hud2Live HUD 2.0 のサブタイトル（毎 tick 変わる値）に最後に送った文字列
 * @property {Record<string, string|number>|null} hud2Vals HUD 2.0 の値（毎 tick 変わる方位・照準以外は、変化時と再送時に集め直す）
 * @property {string} fpoffAnim 再生中の一人称位置調整アニメーション
 * @property {boolean} nvgOn 暗視ゴーグルの手動 ON/OFF（null は自動）
 * @property {number} nvgTick
 * @property {boolean} indoor 屋内か（射撃音の残響）
 * @property {number} indoorTick
 * @property {number} rangeDist 測距スコープの距離（-1 なし）
 * @property {string|null} droneId 操縦中の偵察ドローン
 * @property {number} gunshipUntil ガンシップ操作の期限
 * @property {number} gunshipShot
 * @property {boolean} jumpHeld ジャンプボタン（銃座・乗り物の射撃）
 * @property {boolean} jumpToggle タップ切り替え式の銃座射撃
 * @property {number} vehShot 銃座の次弾 tick
 * @property {string|null} ridingId 乗っている銃座・乗り物
 * @property {number} calib 一人称の位置の調整モード（0 なら通常）
 * @property {number} lastHurtTick
 * @property {number} medUntil 医療品の持続回復の期限
 * @property {number} bleedUntil 出血の期限
 * @property {number} hintMask 表示済みの状況ヒント
 * @property {number} lastWeaponXp 経験値を最後に書き込んだ tick
 * @property {number} magHits このマガジンで経験値になった命中数
 * @property {number} shieldHp ライオットシールドの構え（未使用なら 0）
 * @property {number} look 手に持っている武器の見た目グループ
 * @property {boolean} nvgActive 暗視ゴーグルが働いている
 * @property {number} statusShownAt 状態メッセージを最後にアクションバーへ出した期限
 * @property {number} spottedTick 偵察ドローンに見つかったと知らせた tick
 * @property {number} adrenUntil アドレナリンの期限
 * @property {number} useStart 医療品・除細動器の使用開始 tick（-1 なし）
 * @property {string|null} useItem 使用中の装備
 * @property {number} spawnProtUntil ゲームモードの復活直後の保護
 * @property {number} heavyUntil 近接の溜め攻撃が有効な期限
 * @property {string|null} uid 所持中の武器の識別子（a:id）
 * @property {number} lookCheck 見た目違い ID を確かめる次の tick
 * @property {string} hudStyleNow 前回の HUD の種類
 * @property {number} ksPts 使っていないキルストリークの貯め（PvE ポイント・PvP 連続キルの最大）
 */

/** @type {Map<string, PlayerState>} */
const states = new Map();

/** @param {string} id @returns {PlayerState} */
function create(id) {
  return {
    id,
    weaponId: null, slot: -1, heldKey: null, stats: null,
    ammo: 0, mode: "semi", att: {}, ammoType: "std", ub: 0, jammed: false,
    heat: 0, overheatUntil: 0,
    holding: false, tapFiring: false, lastToggleTick: -99, ammoDirty: false, adsAnim: "", lastMark: "", markTick: -99, pressQueue: 0, pendingUseTick: 0, startUseTick: -99,
    shotTimer: 0, burstLeft: 0, bloom: 0, kickDebt: 0, spin: 0, charge: 0,
    reload: null,
    ads: false, adsLevel: 0, adsToggle: false, lastSneakPress: -99, sneakDown: false, jumpDown: false,
    fovApplied: false, fovValue: 0, moveApplied: false, moveValue: 0.1, nvApplied: false, slowApplied: false,
    poseWeapon: null, poseTick: 0,
    hudTick: 0, hudDirty: true, hit: null,
    lockTarget: null, lockTicks: 0, lockSeen: 0, sprintPose: false, readyAt: 0, mags: [], armHitUntil: 0, legHitUntil: 0,
    lastShotTick: -99, wearPending: 0, lastWearWrite: 0, lastKick: -99,
    breathUntil: 0, breathCooldown: 0, swayTick: 0, cooldownUntil: 0,
    throwing: null, lightPos: null, lightDim: null, menuOpen: false, lastEquipTick: 0,
    glintTick: 0, laserTick: 0, trajTick: 0, dryTick: -99, lastHintTick: -9999,
    grappleUntil: 0, grapplePoint: null, statusMsgUntil: 0, statusMsg: null,
    loopSoundTick: -99, empUntil: 0, mortarTarget: null, sup: 0, supTick: 0, dmgDir: null,
    meleeCd: 0, meleeStart: -1, meleeId: null, lastButt: -99, variableHigh: false, cantedOn: false,
    assistTick: 0, assistTarget: null, autoFiring: false, streak: 0, streakPts: 0, hud2Last: "", hud2Tick: -99, hud2Seq: 0, hud2Live: "", hud2Vals: null, fpoffAnim: "",
    nvgOn: true, nvgTick: 0, indoor: false, indoorTick: -99, rangeDist: -1, droneId: null, gunshipUntil: 0, gunshipShot: 0,
    jumpHeld: false, jumpToggle: false, vehShot: 0, ridingId: null, calib: 0, lastHurtTick: -99, medUntil: 0, bleedUntil: 0,
    hintMask: 0, lastWeaponXp: 0, magHits: 0, shieldHp: 0, look: 0, nvgActive: false, statusShownAt: -1,
    spottedTick: -999, adrenUntil: 0, useStart: -1, useItem: null, spawnProtUntil: 0, ksPts: 0, heavyUntil: 0, uid: null, lookCheck: 0, hudStyleNow: "",
  };
}

/** @param {{id:string}} player @returns {PlayerState} */
export function S(player) {
  let s = states.get(player.id);
  if (!s) {
    s = create(player.id);
    states.set(player.id, s);
  }
  return s;
}

/** @param {string} id */
export function dropState(id) {
  states.delete(id);
}

export function allStates() {
  return states;
}
