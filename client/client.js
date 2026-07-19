import { spawn } from "child_process";
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import readline from "readline";
import WebSocket from "ws";

const RELAY_URL = process.env.RELAY_URL || "wss://wxysyn.com/vibecoding/ws";
const ROOM = process.env.ROOM || "default";

const __dirname = dirname(fileURLToPath(import.meta.url));
const tokenFile = process.env.RELAY_TOKEN_FILE || join(__dirname, ".vibecoding-token");
const OPENDCODE_BIN = process.env.OPENDCODE_BIN || join(process.env.APPDATA || "", "npm", "node_modules", "opencode-ai", "bin", "opencode.exe");
let TOKEN = process.env.RELAY_TOKEN;

if (!TOKEN && existsSync(tokenFile)) {
  TOKEN = readFileSync(tokenFile, "utf-8").trim();
}

if (!TOKEN) {
  console.error("RELAY_TOKEN env var or .vibecoding-token file is required");
  process.exit(1);
}

let currentChild = null;
let ws = null;
let reconnectTimer = null;
const sessionCache = new Map();

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

function getOpenCode(wslDir) {
  return wslDir.startsWith("/mnt/") ? "opencode" : "/home/anzye/.npm-global/bin/opencode";
}

function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

function runOpenCode(dir, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(OPENDCODE_BIN, args, { cwd: dir, stdio: ["ignore", "pipe", "pipe"], ...opts });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    child.on("close", (code) => {
      if (code === 0) resolve(stdout.trim());
      else {
        console.error("[client] opencode stderr:", stderr);
        reject(new Error(`exit ${code}`));
      }
    });
    child.on("error", reject);
  });
}

async function dirExists(wslDir) {
  if (wslDir.match(/^[A-Za-z]:/)) return existsSync(wslDir);
  try {
    const out = await wsl(`test -d "${wslDir}" && echo ok`);
    return out === "ok";
  } catch {
    return false;
  }
}

function pipeToPython(script, input) {
  return new Promise((resolve, reject) => {
    const child = spawn("python", [script], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    child.on("close", (code) => {
      if (code === 0) resolve(stdout.trim());
      else {
        console.error("[client] python stderr:", stderr);
        reject(new Error(`exit ${code}`));
      }
    });
    child.on("error", reject);
    child.stdin.write(input);
    child.stdin.end();
  });
}

async function getLastSession(dir) {
  try {
    let raw;
    if (dir.match(/^[A-Za-z]:/)) {
      raw = await runOpenCode(dir, ["session", "list", "--format", "json"]);
    } else {
      raw = await wsl(`cd "${dir}" && ${getOpenCode(dir)} session list --format json`);
    }
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
    let raw;
    const isWin = dir.match(/^[A-Za-z]:/);
    if (isWin) {
      const exportOut = await runOpenCode(dir, ["export", sessionId]);
      if (!exportOut) return;
      raw = await pipeToPython(join(__dirname, "last5.py"), exportOut);
    } else {
      const script = "/mnt/c/vibecoding-app/client/last5.py";
      const safeDir = dir
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"')
        .replace(/\$/g, '\\$')
        .replace(/`/g, '\\`');
      raw = await wsl(`cd "${safeDir}" && ${getOpenCode(dir)} export "${sessionId}" 2>/dev/null | python3 "${script}"`);
    }
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
  const isWin = dir.match(/^[A-Za-z]:/);
  const cacheKey = isWin ? "/mnt/" + dir[0].toLowerCase() + dir.slice(2).replace(/\\/g, "/") : dir;

  if (!sessionCache.has(cacheKey)) {
    const sid = await getLastSession(dir);
    if (sid) sessionCache.set(cacheKey, sid);
  }
  const sid = sessionCache.get(cacheKey);
  if (sid) {
    await loadHistory(dir, sid);
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

function loadAllowedDirs() {
  const file = process.env.ALLOWED_DIRS_FILE || join(__dirname, "allowed-dirs.txt");
  try {
    if (existsSync(file)) {
      return readFileSync(file, "utf-8")
        .split("\n")
        .map(l => l.trim())
        .filter(l => l && !l.startsWith("#"));
    }
  } catch {}
  return [
    "/mnt/c/Users/anzye/projects/",
    "/home/anzye/projects/",
    "/mnt/c/vibecoding-app/",
    "/mnt/c/Users/anzye/scripts/",
    "/mnt/c/Users/anzye/",
  ];
}

async function handleMessage(msg) {
  const dir = msg.dir || process.cwd();
  const message = msg.msg || "";

  if (!message.trim()) return;

  const isWin = dir.match(/^[A-Za-z]:/);
  let actualDir = dir;
  if (isWin) {
    actualDir = "/mnt/" + actualDir[0].toLowerCase() + actualDir.slice(2).replace(/\\/g, "/");
  }

  const allowedPrefixes = loadAllowedDirs();
  const normalized = actualDir.replace(/\\/g, "/").replace(/\/$/, "") + "/";
  const winNormalized = isWin ? dir.replace(/\\/g, "/").replace(/\/$/, "") + "/" : "";
  if (!allowedPrefixes.some(p => normalized.startsWith(p) || (winNormalized && winNormalized.startsWith(p)))) {
    send({ type: "error", text: "Directory not in allowed project paths" });
    return;
  }

  if (isWin) {
    if (!existsSync(dir)) {
      send({ type: "error", text: `Directory not found: ${dir}` });
      return;
    }
  } else {
    const exists = await dirExists(actualDir);
    if (!exists) {
      send({ type: "error", text: `Directory not found: ${actualDir}` });
      return;
    }
  }

  if (!sessionCache.has(actualDir)) {
    const sid = await getLastSession(dir);
    if (sid) {
      sessionCache.set(actualDir, sid);
      console.log(`[client] Using session: ${sid}`);
    }
  }
  const lastSessionId = sessionCache.get(actualDir) || null;

  const sessionArg = lastSessionId ? `-s "${lastSessionId}"` : "-c";
  const escapedMsg = message
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\$/g, '\\$')
    .replace(/`/g, '\\`')
    .replace(/!/g, '\\!');

  let child;
  if (isWin) {
    const args = ["run"];
    if (lastSessionId) { args.push("-s", lastSessionId); } else { args.push("-c"); }
    args.push(message);
    child = spawn(OPENDCODE_BIN, args, { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
    console.log(`[client] Running opencode natively in ${dir}: ${message}`);
  } else {
    const escapedDir = actualDir
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\$/g, '\\$')
      .replace(/`/g, '\\`');
    const inner = `cd "${escapedDir}" && ${getOpenCode(escapedDir)} run ${sessionArg} "${escapedMsg}"`;
    const cmd = `script -q -c ${JSON.stringify(inner)} /dev/null`;
    child = spawn("wsl", ["-e", "bash", "-c", cmd], { stdio: ["ignore", "pipe", "pipe"] });
    console.log(`[client] Running ${getOpenCode(actualDir)} via PTY in ${actualDir}: ${message}`);
  }

  currentChild = child;

  const rlOut = readline.createInterface({ input: child.stdout });
  const rlErr = readline.createInterface({ input: child.stderr });

  let buf = [];
  let isCmdSection;
  let cmdLineCount;
  const MAX_CMD_LINES = 20;

  function flushBuf() {
    if (buf.length === 0) return;
    const first = buf.find(l => l.trim() !== "") || "";
    isCmdSection = /^\[bash\b/.test(first.trim());
    cmdLineCount = 0;
    for (const line of buf) {
      if (isCmdSection && line.trim() && ++cmdLineCount > MAX_CMD_LINES) {
        if (cmdLineCount === MAX_CMD_LINES + 1) send({ type: "chunk", text: "\n[Output truncated...]\n" });
        continue;
      }
      send({ type: "chunk", text: line + "\n" });
    }
    buf = [];
  }

  function onLine(line) {
    const text = stripAnsi(line);
    if (text.trim() === "") {
      buf.push(text);
      flushBuf();
    } else {
      buf.push(text);
    }
  }

  rlOut.on("line", onLine);
  rlErr.on("line", onLine);

  child.on("close", (code) => {
    currentChild = null;
    flushBuf();
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
