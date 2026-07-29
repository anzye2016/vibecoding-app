import { WebSocketServer } from "ws";
import { timingSafeEqual } from "crypto";
import { readFileSync, existsSync, appendFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const configPath = join(__dirname, "..", "config.json");
const config = existsSync(configPath) ? JSON.parse(readFileSync(configPath, "utf-8")) : {};

const PORT = parseInt(process.env.PORT || config.relayPort || "8766", 10);
const HOST = process.env.HOST || config.relayHost || "127.0.0.1";
const ORIGIN = process.env.ORIGIN || config.relayOrigin || "https://localhost";
const MAX_MSG_SIZE = 1048576;
const LOG_FILE = "/var/log/relay/relay.log";

function log(level, event, data = {}) {
  const entry = { time: new Date().toISOString(), level, event, ...data };
  const line = JSON.stringify(entry) + "\n";
  if (level === "error") process.stderr.write(line);
  else process.stdout.write(line);
  try {
    mkdirSync(dirname(LOG_FILE), { recursive: true });
  } catch {}
  try {
    appendFileSync(LOG_FILE, line);
  } catch {}
}

function loadToken(name) {
  const env = process.env[name];
  if (env) return env;
  const tokenFile = process.env.TOKEN_FILE || "/etc/vibecoding-relay/tokens.env";
  if (existsSync(tokenFile)) {
    const content = readFileSync(tokenFile, "utf-8");
    for (const line of content.split("\n")) {
      const [k, ...rest] = line.split("=");
      if (k === name) return rest.join("=").trim();
    }
  }
  return null;
}

const PC_TOKEN = loadToken("PC_TOKEN");
const PHONE_TOKEN = loadToken("PHONE_TOKEN");

if (!PC_TOKEN || !PHONE_TOKEN) {
  log("fatal", "config_error", { msg: "PC_TOKEN and PHONE_TOKEN are required" });
  process.exit(1);
}

function safeCompare(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "utf-8"), Buffer.from(b, "utf-8"));
  } catch {
    return false;
  }
}

const rooms = new Map();

const msgLimiter = new Map();
const connLimiter = new Map();

const MSG_LIMIT = 30;
const MSG_WINDOW = 10000;
const CONN_LIMIT = 20;
const CONN_WINDOW = 60000;

function checkRate(limiter, key, limit, window) {
  const now = Date.now();
  let timestamps = limiter.get(key);
  if (!timestamps) {
    timestamps = [];
    limiter.set(key, timestamps);
  }
  while (timestamps.length && timestamps[0] < now - window) {
    timestamps.shift();
  }
  if (timestamps.length >= limit) return false;
  timestamps.push(now);
  return true;
}

const wss = new WebSocketServer({ host: HOST, port: PORT, maxPayload: MAX_MSG_SIZE });

wss.on("connection", (ws, req) => {
  const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket.remoteAddress;
  const pathParts = (req.url || "").replace(/^\/+|\/+$/g, "").split("/");
  const room = pathParts[0] || "";
  const role = pathParts[1] || "";
  const origin = req.headers["origin"];

  if (!checkRate(connLimiter, ip, CONN_LIMIT, CONN_WINDOW)) {
    log("warn", "reject", { ip, reason: "rate_limited", room, role });
    ws.close(1008, "rate limited");
    return;
  }

  if (!room || !/^[a-zA-Z0-9_-]{1,32}$/.test(room)) {
    log("warn", "reject", { ip, reason: "invalid_room", room, role });
    ws.close(1008, "unauthorized");
    return;
  }
  if (!role || !["pc", "phone"].includes(role)) {
    log("warn", "reject", { ip, reason: "invalid_role", room, role });
    ws.close(1008, "unauthorized");
    return;
  }
  const originPattern = new RegExp("^" + ORIGIN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$");
  if (origin && !originPattern.test(origin)) {
    log("warn", "reject", { ip, reason: "invalid_origin", room, role, origin });
    ws.close(1008, "unauthorized");
    return;
  }

  const token = (req.headers["sec-websocket-protocol"] || "").split(",")[0].trim();
  const expected = role === "pc" ? PC_TOKEN : PHONE_TOKEN;
  if (!safeCompare(token, expected)) {
    log("warn", "reject", { ip, reason: "auth_failed", room, role });
    ws.close(1008, "unauthorized");
    return;
  }

  if (!rooms.has(room)) {
    rooms.set(room, { pc: null, phone: null, lastActivity: Date.now(), phoneBuffer: [] });
  }
  const pair = rooms.get(room);

  ws.isAlive = true;
  ws.on("pong", () => { ws.isAlive = true; });

  function cleanup() {
    clearInterval(pingTimer);
    if (role === "pc") {
      if (pair.pc === ws) {
        pair.pc = null;
        pair.lastActivity = Date.now();
        notifyPhone(room, { type: "status", online: false });
        log("info", "disconnect", { room, role: "pc" });
      }
    } else {
      if (pair.phone === ws) {
        pair.phone = null;
        pair.lastActivity = Date.now();
        log("info", "disconnect", { room, role: "phone" });
      }
    }
  }

  const pingTimer = setInterval(() => {
    if (!ws.isAlive) {
      cleanup();
      ws.terminate();
      return;
    }
    ws.isAlive = false;
    ws.ping();
  }, 30000);

  if (role === "pc") {
    if (pair.pc) {
      try { pair.pc.close(1000, "replaced"); } catch {}
    }
    pair.pc = ws;
    pair.lastActivity = Date.now();
    log("info", "connect", { ip, room, role: "pc" });
    notifyPhone(room, { type: "status", online: true });
  } else {
    if (pair.phone) {
      try { pair.phone.close(1000, "replaced"); } catch {}
    }
    pair.phone = ws;
    pair.lastActivity = Date.now();
    log("info", "connect", { ip, room, role: "phone" });
    if (pair.pc && pair.pc.readyState === 1) {
      ws.send(JSON.stringify({ type: "status", online: true }));
    } else {
      ws.send(JSON.stringify({ type: "status", online: false }));
    }
    const buf = pair.phoneBuffer;
    pair.phoneBuffer = [];
    for (const m of buf) {
      try { ws.send(JSON.stringify(m)); } catch {}
    }
  }

  ws.on("message", (data) => {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }
    if (!checkRate(msgLimiter, room, MSG_LIMIT, MSG_WINDOW)) {
      log("warn", "reject", { ip, reason: "msg_rate_limited", room, role });
      return;
    }
    pair.lastActivity = Date.now();

    if (role === "phone") {
      log("info", "msg", { room, dir: "phone->pc", type: msg.type });
      if (pair.pc && pair.pc.readyState === 1) {
        pair.pc.send(JSON.stringify(msg));
      } else {
        ws.send(JSON.stringify({ type: "error", text: "PC not connected" }));
      }
    } else if (role === "pc") {
      if (pair.phone && pair.phone.readyState === 1) {
        pair.phone.send(JSON.stringify(msg));
      } else {
        if (pair.phoneBuffer.length >= 500) pair.phoneBuffer.shift();
        pair.phoneBuffer.push(msg);
      }
    }
  });

  ws.on("close", () => { cleanup(); });

  ws.on("error", (err) => {
    log("error", "ws_error", { room, role, msg: err.message });
    cleanup();
  });
});

function notifyPhone(room, msg) {
  const pair = rooms.get(room);
  if (pair && pair.phone && pair.phone.readyState === 1) {
    pair.phone.send(JSON.stringify(msg));
  }
}

setInterval(() => {
  const now = Date.now();
  const expire = 10 * 60 * 1000;
  for (const [room, pair] of rooms) {
    if (!pair.pc && !pair.phone && now - pair.lastActivity > expire) {
      rooms.delete(room);
      log("info", "cleanup", { room, reason: "idle" });
    }
  }
}, 60000);

log("info", "listen", { host: HOST, port: PORT });
