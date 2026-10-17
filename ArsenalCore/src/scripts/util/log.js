// @ts-check
/**
 * ログと例外の隔離。1 人のプレイヤーで起きた例外が全体のループを止めないようにする。
 */
const seen = new Map();

/**
 * 未ロードのチャンクやワールドの高さ外へのアクセスは、遠くを撃てば普通に起こる。
 * 呼び出し側で避けているが、境界で起きたものはゲーム内の警告に出さない。
 * @param {unknown} err
 */
export function isBenign(err) {
  if (!(err instanceof Error)) return false;
  const n = err.name || err.constructor?.name || "";
  if (n === "LocationInUnloadedChunkError" || n === "LocationOutOfWorldBoundariesError") return true;
  return /not in a chunk currently loaded|outside of the world|out of (the )?world bound|unloaded chunk/i.test(err.message);
}

/** @param {string} where @param {unknown} err */
export function logError(where, err) {
  if (isBenign(err)) return;
  const msg = err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err);
  const key = `${where}:${msg.slice(0, 120)}`;
  const n = (seen.get(key) ?? 0) + 1;
  seen.set(key, n);
  // 同じエラーの連続出力は間引く（1, 2, 3, 10, 100, 1000 回目のみ）
  if (n <= 3 || n === 10 || n === 100 || n === 1000) {
    console.warn(`[ARSENAL] ${where} (#${n}): ${msg}`);
  }
}

/**
 * 例外を捕捉して実行
 * @template T
 * @param {string} where
 * @param {() => T} fn
 * @returns {T | undefined}
 */
export function safe(where, fn) {
  try {
    return fn();
  } catch (e) {
    logError(where, e);
    return undefined;
  }
}

/** @param {string} msg */
export function info(msg) {
  console.info(`[ARSENAL] ${msg}`);
}
