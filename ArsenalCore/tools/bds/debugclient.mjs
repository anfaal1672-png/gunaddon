// ARSENAL CORE — BDS のスクリプトデバッガーに接続する最小クライアント（開発用）
//
// Mojang の VS Code 拡張「Minecraft Bedrock Debugger」（github.com/Mojang/minecraft-debugger）と同じプロトコルで話す：
//   ・1 通 = 16 進 8 桁の長さ + 改行 + 1 行の JSON + 改行（message-stream-parser.ts / session.ts の sendDebuggeeMessage）
//   ・接続すると BDS から ProtocolEvent が来るので、protocol（版とスクリプトモジュールの UUID）で返す
//   ・stopOnException で例外のたびに止め、stackTrace / scopes / variables で場所と変数を取ってから resume する
//   ・StatEvent2（診断：tick の時間・エンティティ数など）を集計し、startProfiler / stopProfiler で CPU プロファイルを取る
//
// 使い方：node tools/bds/debugclient.mjs <port> <モジュール UUID> <出力ディレクトリ> <秒> [プロファイル開始秒 プロファイル終了秒]
//   こちらが待ち受け（VS Code の "mode": "listen" と同じ）、BDS から `script debugger connect localhost <port>` でつなぐ
//   （BDS 側は server.properties の allow-outbound-script-debugging=true。tools/bds/run.py の DEV_DEBUG が設定する）。
//   BDS 1.26.52 の listen 側（allow-inbound）は、接続した直後に切られて使えなかった
import net from "node:net";
import fs from "node:fs";
import path from "node:path";

const [port = "19144", uuid, outDir = ".", secs = "60", profFrom, profTo] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const logPath = path.join(outDir, "debugger.log");
const log = (...a) => fs.appendFileSync(logPath, a.join(" ") + "\n");
fs.writeFileSync(logPath, "");

let seq = 1;
/** @type {Map<number, (body:any, err?:string)=>void>} */
const pending = new Map();
const stats = new Map(); // パス → { max, last, n, sum }
const exceptions = [];
let protocolVersion = 0;
let stopped = 0;

function listen() {
  const server = net.createServer((sock) => {
    log("CONNECTED");
    server.close();
    run(sock);
  });
  server.listen(Number(port), "127.0.0.1", () => log("LISTENING", port));
  // つながらないまま時間切れ
  setTimeout(() => {
    if (!protocolVersion) {
      log("NO-CONNECTION");
      process.exit(0);
    }
  }, Number(secs) * 1000 + 5000);
}

function send(sock, obj) {
  const json = Buffer.from(JSON.stringify(obj));
  let len = "00000000" + (json.byteLength + 1).toString(16) + "\n";
  len = len.substring(len.length - 9);
  sock.write(Buffer.concat([Buffer.from(len), json, Buffer.from("\n")]));
}

function request(sock, command, args) {
  return new Promise((resolve) => {
    const s = seq++;
    pending.set(s, (body, err) => resolve(err ? { error: err } : body));
    send(sock, { type: "request", request: { request_seq: s, command, args } });
    setTimeout(() => {
      if (pending.has(s)) {
        pending.delete(s);
        resolve({ error: "timeout" });
      }
    }, 3000);
  });
}

/** 診断の木を「親/子」のパスで平らにして、数値の最大・平均を取る */
function collect(node, prefix) {
  const p = prefix ? `${prefix}/${node.name}` : node.name;
  const v = node.values?.length ? node.values[node.values.length - 1] : undefined;
  if (typeof v === "number") {
    const s = stats.get(p) ?? { max: -Infinity, last: 0, n: 0, sum: 0 };
    s.max = Math.max(s.max, v);
    s.last = v;
    s.n++;
    s.sum += v;
    stats.set(p, s);
  }
  for (const c of node.children ?? []) collect(c, p);
}

async function onStopped(sock, ev) {
  stopped++;
  const frames = await request(sock, "stackTrace", { threadId: ev.thread, startFrame: 0, levels: 25 });
  const list = Array.isArray(frames) ? frames : frames?.stackFrames ?? [];
  let locals = [];
  if (list[0]?.id !== undefined) {
    const scopes = await request(sock, "scopes", { frameId: list[0].id });
    const local = Array.isArray(scopes) ? scopes.find((x) => /local/i.test(x.name)) ?? scopes[0] : undefined;
    if (local?.reference) {
      const vars = await request(sock, "variables", { variablesReference: local.reference });
      if (Array.isArray(vars)) locals = vars.slice(0, 20).map((x) => `${x.name}=${String(x.value).slice(0, 80)}`);
    }
  }
  const where = list.slice(0, 8).map((f) => `${f.name} (${f.fileName ?? f.source?.path ?? f.source?.name ?? "?"}:${f.line})`);
  exceptions.push({ reason: ev.reason, where, locals });
  log("STOPPED", ev.reason, "\n    " + where.join("\n    "), "\n    locals: " + locals.join(", "));
  send(sock, { type: "resume" });
}

function run(sock) {
  let buf = Buffer.alloc(0);
  sock.on("data", (d) => {
    buf = Buffer.concat([buf, d]);
    for (;;) {
      if (buf.length < 9) break;
      const len = parseInt(buf.subarray(0, 9).toString(), 16);
      if (buf.length < 9 + len) break;
      const msg = JSON.parse(buf.subarray(9, 9 + len).toString());
      buf = buf.subarray(9 + len);
      handle(sock, msg);
    }
  });
  sock.on("close", () => log("CLOSED"));
  setTimeout(() => finish(sock), Number(secs) * 1000);
  if (profFrom && profTo) {
    setTimeout(() => {
      log("PROFILER start");
      send(sock, protocolVersion >= 5 ? { type: "startProfiler", target_module_uuid: uuid } : { type: "startProfiler", profiler: { target_module_uuid: uuid } });
    }, Number(profFrom) * 1000);
    setTimeout(() => {
      log("PROFILER stop");
      send(sock, protocolVersion >= 5 ? { type: "stopProfiler", captures_path: outDir, target_module_uuid: uuid } : { type: "stopProfiler", profiler: { captures_path: outDir, target_module_uuid: uuid } });
    }, Number(profTo) * 1000);
  }
}

function handle(sock, msg) {
  if (msg.type === "debuggee-response") {
    const cb = pending.get(msg.request_seq);
    if (cb) {
      pending.delete(msg.request_seq);
      cb(msg.args ?? msg.body, msg.success === false ? msg.response_message ?? "failed" : undefined);
    }
    return;
  }
  if (msg.type === "response" || msg.request_seq !== undefined) {
    const cb = pending.get(msg.request_seq);
    if (cb) {
      pending.delete(msg.request_seq);
      cb(msg.body, msg.error);
    }
    return;
  }
  const ev = msg.type === "event" ? msg.event : msg;
  switch (ev.type) {
    case "ProtocolEvent": {
      protocolVersion = Math.min(ev.version, 11);
      const plugins = (ev.plugins ?? []).map((p) => `${p.name}:${p.module_uuid}`).join(", ");
      log("PROTOCOL", ev.version, "plugins:", plugins);
      send(sock, { type: "protocol", version: protocolVersion, target_module_uuid: uuid });
      send(sock, { type: "stopOnException", stopOnException: true });
      send(sock, { type: "resume" });
      break;
    }
    case "StoppedEvent":
      onStopped(sock, ev);
      break;
    case "PrintEvent":
      log("PRINT", String(ev.message).trimEnd());
      break;
    case "NotificationEvent":
      log("NOTE", String(ev.message).trimEnd());
      break;
    case "StatEvent2":
      for (const s of ev.stats ?? []) collect(s, "");
      break;
    case "ProfilerCapture": {
      const f = path.join(outDir, "capture.cpuprofile");
      // 中身は base64 の .cpuprofile（JSON）。拡張の profiler-utils.ts と同じく復号する
      fs.writeFileSync(f, Buffer.from(ev.capture_data, "base64"));
      log("PROFILER capture", f, ev.capture_data.length, "bytes");
      break;
    }
    default:
      break;
  }
}

function finish(sock) {
  const lines = [...stats.entries()]
    .filter(([, s]) => s.n > 0)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([k, s]) => `${k}\tmax=${+s.max.toFixed(3)}\tavg=${+(s.sum / s.n).toFixed(3)}\tlast=${+s.last.toFixed(3)}\tn=${s.n}`);
  fs.writeFileSync(path.join(outDir, "stats.tsv"), lines.join("\n") + "\n");
  fs.writeFileSync(path.join(outDir, "exceptions.json"), JSON.stringify(exceptions, null, 1));
  log("DONE stopped=" + stopped, "stats=" + stats.size);
  sock.end();
  setTimeout(() => process.exit(0), 300);
}

listen();
