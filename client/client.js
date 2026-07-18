import { spawn } from "child_process";
import readline from "readline";
import WebSocket from "ws";

const RELAY_URL = process.env.RELAY_URL || "wss://wxysyn.com/vibecoding/ws";
const ROOM = process.env.ROOM || "default";
const TOKEN = process.env.RELAY_TOKEN || "vibecoding-default-token";

let currentChild = null;
let ws = null;
let reconnectTimer = null;
let lastSessionId = null;

function wsl(cmd) {
  return new Promise((resolve, reject) => {
    const child = spawn("wsl", ["-e", "bash", "-c", cmd], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    child.on("close", (code) => {
      if (code === 0) resolve(stdout.trim());
      else {
        console.error("[client] wsl stderr:", stderr);
        reject(new Error(`exit ${code}`));
      }
    });
    child.on("error", reject);
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
    if (!raw) return null;
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
    const script = "/mnt/c/vibecoding-app/client/last5.py";
    const raw = await wsl(`cd "${dir}" && opencode export "${sessionId}" 2>/dev/null | python3 "${script}"`);
    if (!raw) return;
    const rounds = JSON.parse(raw);
    if (rounds.length === 0) return;
    send({ type: "history", rounds });
    console.log(`[client] Sent ${rounds.length} history rounds`);
  } catch (e) {
    console.error("[client] Failed to load history:", e.message);
  }
}

async function sendHistory(msg) {
  const dir = msg.dir || process.cwd();
  console.log("[client] sendHistory dir:", dir);
  if (!dir) return;
  let actualDir = dir;
  if (actualDir.match(/^[A-Za-z]:/)) {
    actualDir = "/mnt/" + actualDir[0].toLowerCase() + actualDir.slice(2).replace(/\\/g, "/");
  }
  if (!lastSessionId) {
    lastSessionId = await getLastSession(actualDir);
  }
  if (lastSessionId) {
    await loadHistory(actualDir, lastSessionId);
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
    } else if (msg.type === "load_history") {
      console.log("[client] load_history received, dir:", msg.dir);
      sendHistory(msg);
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

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

const stdinRl = readline.createInterface({ input: process.stdin });
stdinRl.on("SIGINT", shutdown);

function shutdown() {
  cancelCurrent();
  if (reconnectTimer) clearInterval(reconnectTimer);
  if (ws) ws.close();
  process.exit(0);
}

connect();
