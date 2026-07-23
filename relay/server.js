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
const MAX_MSG_SIZE = 65536;
const LOG_FILE = "/var/log/relay/relay.log";

function logReject(ip, reason) {
  try {
    mkdirSync(dirname(LOG_FILE), { recursive: true });
  } catch {}
  try {
    appendFileSync(LOG_FILE, `${new Date().toISOString()} REJECT ip=${ip} reason=${reason}\n`);
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
  console.error("PC_TOKEN and PHONE_TOKEN are required (env vars or TOKEN_FILE)");
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

// Rate limiters
const msgLimiter = new Map();  // room -> [timestamps]
const connLimiter = new Map(); // ip -> [timestamps]

const MSG_LIMIT = 30;     // max messages per window
const MSG_WINDOW = 10000; // 10s window
const CONN_LIMIT = 20;     // max connections per window
const CONN_WINDOW = 60000;// 60s window

function checkRate(limiter, key, limit, window) {
  const now = Date.now();
  let timestamps = limiter.get(key);
  if (!timestamps) {
    timestamps = [];
    limiter.set(key, timestamps);
  }
  // Remove old entries
  while (timestamps.length && timestamps[0] < now - window) {
    timestamps.shift();
  }
  if (timestamps.length >= limit) return false;
  timestamps.push(now);
  return true;
}

const wss = new WebSocketServer({ host: HOST, port: PORT, maxPayload: MAX_MSG_SIZE });

function ts() {
  return new Date().toISOString();
}

wss.on("connection", (ws, req) => {
  const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket.remoteAddress;
  if (!checkRate(connLimiter, ip, CONN_LIMIT, CONN_WINDOW)) {
    console.log(`[${ts()}] REJECT ${ip} - connection rate limited`);
    logReject(ip, "rate_limited");
    ws.close(1008, "rate limited");
    return;
  }
  const pathParts = (req.url || "").replace(/^\/+|\/+$/g, "").split("/");
  const room = pathParts[0] || "";
  const role = pathParts[1] || "";
  const origin = req.headers["origin"];

  if (!room || !/^[a-zA-Z0-9_-]{1,32}$/.test(room)) {
    console.log(`[${ts()}] REJECT ${ip} - invalid room`);
    logReject(ip, "invalid_room");
    ws.close(1008, "unauthorized");
    return;
  }
  if (!role || !["pc", "phone"].includes(role)) {
    console.log(`[${ts()}] REJECT ${ip} room=${room} - invalid role`);
    logReject(ip, "invalid_role room=" + room);
    ws.close(1008, "unauthorized");
    return;
  }
  const originPattern = new RegExp("^" + ORIGIN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$");
  if (origin && !originPattern.test(origin)) {
    console.log(`[${ts()}] REJECT ${ip} room=${room} - invalid origin=${origin}`);
    logReject(ip, "invalid_origin room=" + room + " origin=" + origin);
    ws.close(1008, "unauthorized");
    return;
  }

  const token = (req.headers["sec-websocket-protocol"] || "").split(",")[0].trim();
  const expected = role === "pc" ? PC_TOKEN : PHONE_TOKEN;
  if (!safeCompare(token, expected)) {
    console.log(`[${ts()}] REJECT ${ip} room=${room} role=${role} - auth failed`);
    logReject(ip, "auth_failed room=" + room + " role=" + role);
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
        console.log(`[${ts()}] DISCONNECT room=${room} role=pc`);
      }
    } else {
      if (pair.phone === ws) {
        pair.phone = null;
        pair.lastActivity = Date.now();
        console.log(`[${ts()}] DISCONNECT room=${room} role=phone`);
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
    console.log(`[${ts()}] CONNECT ${ip} room=${room} role=pc`);
    notifyPhone(room, { type: "status", online: true });
  } else {
      if (pair.phone) {
        try { pair.phone.close(1000, "replaced"); } catch {}
      }
      pair.phone = ws;
      pair.lastActivity = Date.now();
      console.log(`[${ts()}] CONNECT ${ip} room=${room} role=phone`);
      if (pair.pc && pair.pc.readyState === 1) {
        ws.send(JSON.stringify({ type: "status", online: true }));
      } else {
        ws.send(JSON.stringify({ type: "status", online: false }));
      }
      // Flush buffered messages (from PC → phone while phone was offline)
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
      console.log(`[${ts()}] REJECT room=${room} role=${role} - message rate limited`);
      logReject(ip, "msg_rate_limited room=" + room);
      return;
    }
    pair.lastActivity = Date.now();

    if (role === "phone") {
      console.log(`[${ts()}] MSG room=${room} phone->pc type=${msg.type}`);
      if (pair.pc && pair.pc.readyState === 1) {
        pair.pc.send(JSON.stringify(msg));
      } else {
        ws.send(JSON.stringify({ type: "error", text: "PC not connected" }));
      }
    } else if (role === "pc") {
      if (pair.phone && pair.phone.readyState === 1) {
        pair.phone.send(JSON.stringify(msg));
      } else {
        // Phone offline → buffer (max 500, drop oldest to keep newest)
        if (pair.phoneBuffer.length >= 500) pair.phoneBuffer.shift();
        pair.phoneBuffer.push(msg);
      }
    }
  });

  ws.on("close", () => { cleanup(); });

  ws.on("error", (err) => {
    console.error(`[${ts()}] ERROR room=${room} role=${role} ${err.message}`);
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
      console.log(`[${ts()}] CLEANUP room=${room} (idle)`);
    }
  }
}, 60000);

console.log(`[${ts()}] Relay listening on ${HOST}:${PORT}`);
