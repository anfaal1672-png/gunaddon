// HUD 2.0 の往復テスト用：スクリプトの符号化（ui/hud2.js の encodeHud2）で試験ベクトルを作り、JSON で出力する
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const run = path.join(here, ".run_hud");
fs.rmSync(run, { recursive: true, force: true });
fs.mkdirSync(path.join(run, "node_modules"), { recursive: true });
fs.cpSync(path.join(root, "ArsenalCore_BP", "scripts"), path.join(run, "scripts"), { recursive: true });
fs.cpSync(path.join(here, "mock", "@minecraft"), path.join(run, "node_modules", "@minecraft"), { recursive: true });
fs.writeFileSync(path.join(run, "package.json"), '{"type":"module"}');
console.warn = () => {};
console.info = () => {};
const D = await import(pathToFileURL(path.join(run, "scripts", "config", "weapons.data.js")).href);
const hud2 = await import(pathToFileURL(path.join(run, "scripts", "ui", "hud2.js")).href);
let seed = 12345;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const out = [];
for (let i = 0; i < 64; i++) {
  const v = {
    hit: pick(["0", "1", "2", "3"]), dir: String(Math.floor(rnd() * 9)), xh: pick(["x", ...Array.from({ length: 10 }, (_, k) => String(k))]),
    ammo: pick(["---", Math.floor(rnd() * 150)]), res: pick(["", "INF", Math.floor(rnd() * 9999)]), mode: pick(["S", "A", "B", "C", "D", "U", "M", "-"]),
    st: pick(["0", "R", "J", "H", "L", "K", "B", "E", "P", "X"]), heat: String(Math.floor(rnd() * 10)), plate: pick(["-", "0", "1", "2", "3", "4"]),
    hp: Math.floor(rnd() * 40), hdg: pick([String(Math.floor(rnd() * D.HUD2.hdgSteps)), String(Math.floor(rnd() * 10)), "---"]), dmg: pick(["", "§f7", "§e124", "§c9999", "§f30"]), sup: String(Math.floor(rnd() * 4)), nvg: pick(["0", "1"]),
    gm: pick(["0", "1", "2", "3", "4", "5"]), sa: Math.floor(rnd() * 200), sb: Math.floor(rnd() * 200), tm: pick(["", " 9:59", " 0:05", "12:00"]),
    stk: Math.floor(rnd() * 30), cr: Math.floor(rnd() * 2000000), ks: pick(["0", "1"]), rng: pick(["----", Math.floor(rnd() * 999)]),
    wdir: pick(["-", "0", "7", "4"]), wstr: pick(["-", "1", "3"]), sz: pick(["0", "1", "2"]), lay: pick(["0", "1", "2"]), seq: String(Math.floor(rnd() * 10)),
  };
  const enc = hud2.encodeHud2(v);
  out.push({ values: v, encoded: enc, live: hud2.encodeLive(v), decoded: hud2.decodeHud2(enc) });
}
fs.rmSync(run, { recursive: true, force: true });
process.stdout.write(JSON.stringify({ hud2: D.HUD2, layout: D.HUD2_LAYOUT, vectors: out }));
