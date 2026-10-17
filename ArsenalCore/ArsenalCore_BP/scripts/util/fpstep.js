// @ts-check
/**
 * 一人称の位置調整の段階名（riggen.fp_step_name と同じ規則）：0 / p1 / p2 / m1 / m2
 * @param {number} n
 */
export function fp_step(n) {
  return n === 0 ? "0" : n > 0 ? `p${n}` : `m${-n}`;
}
