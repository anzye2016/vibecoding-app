import { spawn, exec } from "child_process";
import readline from "readline";
import WebSocket from "ws";

const RELAY_URL = process.env.RELAY_URL || "wss://wxysyn.com/vibecoding/ws";
const ROOM = process.env.ROOM || "default";
const TOKEN = process.env.RELAY_TOKEN || "vibecoding-default-token";

let currentChild = null;
let ws = null;
let reconnectTimer = null;
let lastSessionId = null;
let historySent = false;

function wsl(cmd) {
  return new Promise((resolve, reject) => {
    exec(`wsl -e bash -c ${JSON.stringify(cmd)}`, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout.trim());
    });
  });
}

function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

async function dirExists(wslDir) {
  try {
    const out = await wsl(`test -d "${wslDir}" && echo ok`);
    return out === "ok";
  } catch {
    return false;
  }
}

async function getLastSession(dir) {
  try {
    const raw = await wsl(`cd "${dir}" && opencode session list --format json`);
    const sessions = JSON.parse(raw);
    if (Array.isArray(sessions)) {
      const named = sessions.filter(s => !s.title.startsWith("New session"));
      const target = named.length > 0 ? named[0] : sessions[0];
      return target ? target.id : null;
    }
  } catch (e) {
    console.error("[client] Failed to get session list:", e.message);
  }
  return null;
}

async function loadHistory(dir, sessionId) {
  try {
    const raw = await wsl(`cd "${dir}" && opencode export "${sessionId}"`);
    const data = JSON.parse(raw);
    const msgs = data.messages || [];
    const rounds = [];
    let lastUser = null;
    for (const m of msgs) {
      const role = m.info?.role;
      const text = m.parts?.[0]?.text || "";
      if (!text.trim()) continue;
      if (role === "user") {
        lastUser = text;
      } else if (role === "assistant" && lastUser !== null) {
        rounds.push({ user: lastUser, assistant: text });
        lastUser = null;
      }
    }
    const recent = rounds.slice(-5);
    if (recent.length === 0) return;
    send({ type: "history", rounds: recent });
    console.log(`[client] Sent ${recent.length} history rounds`);
  } catch (e) {
    console.error("[client] Failed to load history:", e.message);
  }
}

function connect() {
  const url = `${RELAY_URL}?room=${encodeURIComponent(ROOM)}&role=pc&token=${encodeURIComponent(TOKEN)}`;

  ws = new WebSocket(url);

  ws.on("open", () => {
    console.log(`[client] Connected to relay (room: ${ROOM})`);
    if (reconnectTimer) {
      clearInterval(reconnectTimer);
      reconnectTimer = null;
    }
  });

  ws.on("message", (data) => {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }

    if (msg.type === "msg") {
      handleMessage(msg);
    } else if (msg.type === "cancel") {
      cancelCurrent();
    }
  });

  ws.on("close", () => {
    console.log("[client] Disconnected, reconnecting in 5s...");
    cancelCurrent();
    scheduleReconnect();
  });

  ws.on("error", (err) => {
    console.error("[client] WebSocket error:", err.message);
  });
}

async function handleMessage(msg) {
  const dir = msg.dir || process.cwd();
  const message = msg.msg || "";

  if (!message.trim()) return;

  let actualDir = dir;
  if (actualDir.match(/^[A-Za-z]:/)) {
    actualDir = "/mnt/" + actualDir[0].toLowerCase() + actualDir.slice(2).replace(/\\/g, "/");
  }

  const exists = await dirExists(actualDir);
  if (!exists) {
    send({ type: "error", text: `Directory not found: ${actualDir}` });
    return;
  }

  if (!lastSessionId) {
    lastSessionId = await getLastSession(actualDir);
    if (lastSessionId) {
      console.log(`[client] Using session: ${lastSessionId}`);
    }
  }

  if (!historySent && lastSessionId) {
    historySent = true;
    await loadHistory(actualDir, lastSessionId);
  }

  const sessionArg = lastSessionId ? `-s "${lastSessionId}"` : "-c";

  console.log(`[client] Running opencode in ${actualDir}: ${message}`);

  const escapedMsg = message.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const cmd = `cd "${actualDir}" && opencode run ${sessionArg} "${escapedMsg}"`;

  const child = spawn("wsl", ["-e", "bash", "-c", cmd], { stdio: ["ignore", "pipe", "pipe"] });

  currentChild = child;

  const rlOut = readline.createInterface({ input: child.stdout });
  const rlErr = readline.createInterface({ input: child.stderr });

  rlOut.on("line", (line) => {
    send({ type: "chunk", text: stripAnsi(line) + "\n" });
  });

  rlErr.on("line", (line) => {
    send({ type: "chunk", text: stripAnsi(line) + "\n" });
  });

  child.on("close", (code) => {
    currentChild = null;
    rlOut.close();
    rlErr.close();
    send({ type: "done", code: code || 0 });
  });

  child.on("error", (err) => {
    currentChild = null;
    send({ type: "error", text: `Failed to start opencode: ${err.message}` });
  });
}

function cancelCurrent() {
  if (currentChild) {
    spawn("taskkill", ["/PID", currentChild.pid.toString(), "/T", "/F"]);
    currentChild = null;
    send({ type: "cancelled" });
  }
}

function send(obj) {
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify(obj));
  }
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setInterval(() => {
    if (ws && ws.readyState === 1) return;
    connect();
  }, 5000);
}

process.on("SIGINT", () => {
  cancelCurrent();
  if (reconnectTimer) clearInterval(reconnectTimer);
  if (ws) ws.close();
  process.exit(0);
});

process.on("SIGTERM", () => {
  cancelCurrent();
  if (reconnectTimer) clearInterval(reconnectTimer);
  if (ws) ws.close();
  process.exit(0);
});

connect();
