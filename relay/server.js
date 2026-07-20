import { WebSocketServer } from "ws";
import { timingSafeEqual } from "crypto";
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const configPath = join(__dirname, "..", "config.json");
const config = existsSync(configPath) ? JSON.parse(readFileSync(configPath, "utf-8")) : {};

const PORT = parseInt(process.env.PORT || config.relayPort || "8766", 10);
const HOST = process.env.HOST || config.relayHost || "127.0.0.1";
const ORIGIN = process.env.ORIGIN || config.relayOrigin || "https://localhost";
const MAX_MSG_SIZE = 65536;

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

const wss = new WebSocketServer({ host: HOST, port: PORT, maxPayload: MAX_MSG_SIZE });

function ts() {
  return new Date().toISOString();
}

wss.on("connection", (ws, req) => {
  const url = new URL(req.url, "http://localhost");
  const room = url.searchParams.get("room");
  const role = url.searchParams.get("role");
  const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket.remoteAddress;
  const origin = req.headers["origin"];

  if (!room || !/^[a-zA-Z0-9_-]{1,32}$/.test(room)) {
    console.log(`[${ts()}] REJECT ${ip} - invalid room`);
    ws.close(1008, "unauthorized");
    return;
  }
  if (!role || !["pc", "phone"].includes(role)) {
    console.log(`[${ts()}] REJECT ${ip} room=${room} - invalid role`);
    ws.close(1008, "unauthorized");
    return;
  }
  const originPattern = new RegExp("^" + ORIGIN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$");
  if (origin && !originPattern.test(origin)) {
    console.log(`[${ts()}] REJECT ${ip} room=${room} - invalid origin=${origin}`);
    ws.close(1008, "unauthorized");
    return;
  }

  const token = url.searchParams.get("token");
  const expected = role === "pc" ? PC_TOKEN : PHONE_TOKEN;
  if (!safeCompare(token, expected)) {
    console.log(`[${ts()}] REJECT ${ip} room=${room} role=${role} - auth failed`);
    ws.close(1008, "unauthorized");
    return;
  }

  if (!rooms.has(room)) {
    rooms.set(room, { pc: null, phone: null, lastActivity: Date.now() });
  }
  const pair = rooms.get(room);

  ws.isAlive = true;
  ws.on("pong", () => { ws.isAlive = true; });
  const pingTimer = setInterval(() => {
    if (!ws.isAlive) return ws.terminate();
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
  }

  ws.on("message", (data) => {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }
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
      }
    }
  });

  ws.on("close", () => {
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
  });

  ws.on("error", (err) => {
    console.error(`[${ts()}] ERROR room=${room} role=${role} ${err.message}`);
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
