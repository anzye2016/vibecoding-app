import { spawn } from "child_process";
import { readFileSync, existsSync, writeFileSync, rmSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import readline from "readline";
import WebSocket from "ws";

const RELAY_URL = process.env.RELAY_URL || "wss://wxysyn.com/vibecoding/ws";
const ROOM = process.env.ROOM || "default";

const __dirname = dirname(fileURLToPath(import.meta.url));
const tokenFile = process.env.RELAY_TOKEN_FILE || join(__dirname, ".vibecoding-token");
const OPENDCODE_MODE = process.env.OPENDCODE_MODE || "json";
const OPENDCODE_BIN = process.env.OPENDCODE_BIN || join(process.env.APPDATA || "", "npm", "node_modules", "opencode-ai", "bin", "opencode.exe");
const COMPACT_PYTHON = process.env.COMPACT_PYTHON || "C:\\Users\\anzye\\projects\\screen-agent\\.venv\\Scripts\\python.exe";
let TOKEN = process.env.RELAY_TOKEN;

if (!TOKEN && existsSync(tokenFile)) {
  TOKEN = readFileSync(tokenFile, "utf-8").trim();
}

if (!TOKEN) {
  console.error("RELAY_TOKEN env var or .vibecoding-token file is required");
  process.exit(1);
}

writeFileSync(join(process.env.TEMP || "/tmp", "vibecoding-client-pid.txt"), String(process.pid));

let currentChild = null;
let compactChild = null;
let ws = null;
let reconnectTimer = null;
const sessionCache = new Map();
const newSessionDirs = new Set();

function wsl(cmd) {
  return new Promise((resolve, reject) => {
    const child = spawn("wsl", ["-e", "bash", "-c", cmd], { stdio: ["ignore", "pipe", "pipe"] });
    const chunks = [];
    let stderr = "";
    let settled = false;
    child.stdout.on("data", (d) => { chunks.push(d); });
    child.stderr.on("data", (d) => { stderr += d; });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      if (code === 0) {
        resolve(Buffer.concat(chunks).toString("utf8").trim());
      } else {
        console.error("[client] wsl stderr:", stderr);
        reject(new Error(`exit ${code}`));
      }
    });
    child.on("error", (err) => { if (!settled) { settled = true; reject(err); } });
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

function runPython(script, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn("python", [script, ...args], { stdio: ["ignore", "pipe", "pipe"] });
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
  });
}

function pipeToPython(script, input) {
  return new Promise((resolve, reject) => {
    const tmpFile = join(process.env.TEMP || "/tmp", "vibe-export-" + Date.now() + ".json");
    try { writeFileSync(tmpFile, input, "utf8"); } catch (e) { reject(e); return; }
    const child = spawn("python", [script, tmpFile], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    child.on("close", (code) => {
      try { rmSync(tmpFile); } catch {}
      if (code === 0) resolve(stdout.trim());
      else {
        console.error("[client] python stderr:", stderr);
        reject(new Error(`exit ${code}`));
      }
    });
    child.on("error", (err) => { try { rmSync(tmpFile); } catch {} reject(err); });
  });
}

function normalizeDir(d) {
  if (d.match(/^[A-Za-z]:/)) return "/mnt/" + d[0].toLowerCase() + d.slice(2).replace(/\\/g, "/");
  return d.replace(/\\/g, "/");
}

async function listSessions(dir) {
  if (!dir) return [];
  try {
    let raw;
    if (dir.match(/^[A-Za-z]:/)) {
      raw = await runOpenCode(dir, ["session", "list", "--format", "json"]);
    } else {
      raw = await wsl(`cd "${dir}" && ${getOpenCode(dir)} session list --format json`);
    }
    if (!raw) return [];
    const sessions = JSON.parse(raw);
    if (!Array.isArray(sessions)) return [];
    const nd = normalizeDir(dir);
    return sessions
      .filter(s => normalizeDir(s.directory || "") === nd)
      .map(s => ({ id: s.id, title: s.title, updated: s.updated }));
  } catch {
    return [];
  }
}

async function getLastSession(dir) {
  const sessions = await listSessions(dir);
  if (sessions.length === 0) return null;
  const named = sessions.filter(s => !s.title.startsWith("New session"));
  const candidates = named.length > 0 ? named : sessions;
  candidates.sort((a, b) => (b.updated || 0) - (a.updated || 0));
  return candidates[0].id;
}

async function loadHistory(dir, sessionId) {
  try {
    let raw;
    const isWin = dir.match(/^[A-Za-z]:/);
    let exportOut;
    if (isWin) {
      exportOut = await runOpenCode(dir, ["export", sessionId]);
    } else {
      const safeDir = dir
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"')
        .replace(/\$/g, '\\$')
        .replace(/`/g, '\\`');
      const ts = Date.now();
      const winTmp = (process.env.TEMP || process.env.TMPDIR || "/tmp").split("\\").join("/");
      const wslTmp = "/mnt/" + winTmp[0].toLowerCase() + winTmp.slice(2);
      const fname = `/vibe-export-${ts}.json`;
      await wsl(`cd "${safeDir}" && ${getOpenCode(dir)} export "${sessionId}" > "${wslTmp}${fname}" 2>/dev/null`);
      try { exportOut = readFileSync(winTmp + fname, "utf-8"); } catch {}
      try { await wsl(`rm -f "${wslTmp}${fname}"`); } catch {}
    }
    if (!exportOut) { console.warn("[client] loadHistory: export returned empty for", sessionId); return; }
    raw = await pipeToPython(join(__dirname, "last5.py"), exportOut);
    if (!raw) { console.warn("[client] loadHistory: python returned empty, sid:", sessionId); return; }
    const rounds = JSON.parse(raw);
    if (rounds.length === 0) { console.warn("[client] loadHistory: 0 rounds, sid:", sessionId); return; }
    send({ type: "history", rounds });
    console.log(`[client] Sent ${rounds.length} history rounds`);
  } catch (e) {
    console.error("[client] loadHistory error:", e.message);
  }
}

async function sendHistory(msg) {
  const dir = msg.dir || process.cwd();
  console.log("[client] sendHistory dir:", dir);
  if (!dir) return;
  const isWin = dir.match(/^[A-Za-z]:/);
  const cacheKey = isWin ? "/mnt/" + dir[0].toLowerCase() + dir.slice(2).replace(/\\/g, "/") : dir;

  if (newSessionDirs.has(cacheKey)) return;

  if (!sessionCache.has(cacheKey)) {
    const sid = await getLastSession(dir);
    if (sid) { sessionCache.set(cacheKey, sid); }
    else { console.warn("[client] sendHistory: no session found for", dir); return; }
  }
  const sid = sessionCache.get(cacheKey);
  if (sid) {
    await loadHistory(dir, sid);
  } else {
    console.warn("[client] sendHistory: no cached session for", cacheKey);
  }
}

async function handleListSessions(msg) {
  const dir = msg.dir || process.cwd();
  const sessions = await listSessions(dir);
  const isWin = dir.match(/^[A-Za-z]:/);
  const cacheKey = isWin ? "/mnt/" + dir[0].toLowerCase() + dir.slice(2).replace(/\\/g, "/") : dir;
  const current = sessionCache.get(cacheKey) || null;
  send({ type: "sessions", sessions, current, dir });
}

function handleSelectSession(msg) {
  const dir = msg.dir || process.cwd();
  const isWin = dir.match(/^[A-Za-z]:/);
  const cacheKey = isWin ? "/mnt/" + dir[0].toLowerCase() + dir.slice(2).replace(/\\/g, "/") : dir;
  if (msg.sessionId) {
    sessionCache.set(cacheKey, msg.sessionId);
    newSessionDirs.delete(cacheKey);
  } else {
    sessionCache.delete(cacheKey);
    newSessionDirs.add(cacheKey);
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
    if (currentChild !== null) {
      send({ type: "processing" });
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
      if (currentChild !== null) {
        send({ type: "processing" });
      }
      sendHistory(msg);
    } else if (msg.type === "list_sessions") {
      console.log("[client] list_sessions received, dir:", msg.dir);
      handleListSessions(msg);
    } else if (msg.type === "select_session") {
      console.log("[client] select_session, id:", msg.sessionId, "dir:", msg.dir);
      handleSelectSession(msg);
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
  const dir = msg.dir;
  const message = msg.msg || "";

  if (!message.trim()) return;

  if (message.trim() === "!!restart") {
    console.log("[client] Restart requested");
    send({ type: "chunk", text: "Restarting client...\n" });
    cancelCurrent();
    setTimeout(() => process.exit(0), 200);
    return;
  }

  if (message.trim() === "/compact") {
    if (!msg.dir || !msg.dir.trim()) {
      send({ type: "error", text: "No working directory configured. Set Work Dir in settings first." });
      return;
    }
    const cDir = msg.dir;
    const cIsWin = cDir.match(/^[A-Za-z]:/);
    const cActualDir = cIsWin
      ? "/mnt/" + cDir[0].toLowerCase() + cDir.slice(2).replace(/\\/g, "/")
      : cDir;

    const sid = sessionCache.get(cActualDir) || null;
    if (!sid) {
      send({ type: "error", text: "No active session. Send a message first, then use /compact." });
      return;
    }

    if (compactChild) {
      send({ type: "error", text: "A compact is already in progress." });
      return;
    }

    console.log("[client] /compact dir:", cDir, "session:", sid, "mode:", cIsWin ? "win" : "wsl");
    send({ type: "chunk", text: "[compact] Opening terminal...\n" });

    const ocBin = cIsWin ? OPENDCODE_BIN : getOpenCode(cActualDir);
    const compactScript = join(__dirname, "compact.py");

    compactChild = spawn(COMPACT_PYTHON, [
      compactScript,
      "--dir", cIsWin ? cDir : cActualDir,
      "--session", sid,
      "--mode", cIsWin ? "win" : "wsl",
      "--opencode", ocBin,
    ], { stdio: ["ignore", "pipe", "pipe"] });

    let cstdout = "";
    let cstderr = "";
    compactChild.stdout.on("data", (d) => { cstdout += d; });
    compactChild.stderr.on("data", (d) => { cstderr += d; });

    compactChild.on("close", (code) => {
      compactChild = null;
      try {
        const result = JSON.parse(cstdout.trim() || "{}");
        if (result.success) {
          send({ type: "chunk", text: "[compact] " + result.message + "\n" });
          send({ type: "done", code: 0 });
          console.log("[client] compact done");
        } else {
          const detail = cstderr.trim() || result.message || "failed";
          send({ type: "error", text: "Compact: " + detail });
          console.error("[client] compact stderr:", cstderr.trim());
        }
      } catch {
        send({ type: "error", text: "Compact: " + (cstderr.trim() || "script failed") });
        console.error("[client] compact stderr:", cstderr.trim());
      }
    });

    compactChild.on("error", (err) => {
      compactChild = null;
      send({ type: "error", text: "Compact: " + err.message });
    });

    return;
  }

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

  if (newSessionDirs.has(actualDir)) {
    newSessionDirs.delete(actualDir);
  } else if (!sessionCache.has(actualDir)) {
    const sid = await getLastSession(dir);
    if (sid) {
      sessionCache.set(actualDir, sid);
      console.log(`[client] Using session: ${sid}`);
    }
  }
  const lastSessionId = sessionCache.get(actualDir) || null;

  let modelFlag = "";
  let runMessage = message;
  const m = message.match(/^\/model\s+(\S+)/);
  if (m) {
    modelFlag = m[1];
    runMessage = message.slice(m[0].length).trim() || "hi";
  }

  const sessionArg = lastSessionId ? `-s "${lastSessionId}"` : "-c";
  const escapedMsg = runMessage
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\$/g, '\\$')
    .replace(/`/g, '\\`')
    .replace(/!/g, '\\!');

  const useJson = OPENDCODE_MODE === "json";
  const fmtFlag = useJson ? ["--format", "json"] : [];
  let child;
  if (isWin) {
    const args = ["run", ...fmtFlag];
    if (lastSessionId) { args.push("-s", lastSessionId); } else { args.push("-c"); }
    if (modelFlag) args.push("-m", modelFlag);
    args.push(runMessage);
    child = spawn(OPENDCODE_BIN, args, { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
    console.log(`[client] Running opencode natively in ${dir}: ${message}`);
  } else {
    const escapedDir = actualDir
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\$/g, '\\$')
      .replace(/`/g, '\\`');
    const inner = `cd "${escapedDir}" && ${getOpenCode(escapedDir)} run${useJson ? " --format json" : ""} ${sessionArg}${modelFlag ? ` -m "${modelFlag}"` : ""} "${escapedMsg}"`;
    const cmd = `script -q -c ${JSON.stringify(inner)} /dev/null`;
    child = spawn("wsl", ["-e", "bash", "-c", cmd], { stdio: ["ignore", "pipe", "pipe"] });
    console.log(`[client] Running ${getOpenCode(actualDir)} via PTY in ${actualDir}: ${message}`);
  }

  currentChild = child;
  const rlOut = readline.createInterface({ input: child.stdout });
  const rlErr = readline.createInterface({ input: child.stderr });

  if (useJson) {
    rlOut.on("line", onJsonLine);
    rlErr.on("line", onJsonLine);
  } else {
    let burstCount = 0;
    let burstStart = 0;
    const MAX_BURST = 40;
    const onTextLine = (line) => {
      const text = stripAnsi(line);
      const now = Date.now();
      if (now - burstStart > 2000) { burstCount = 0; burstStart = now; }
      burstCount++;
      if (burstCount > MAX_BURST) return;
      if (burstCount === MAX_BURST) {
        send({ type: "chunk", text: text + "\n" });
        send({ type: "chunk", text: "[Output truncated...]\n" });
        return;
      }
      send({ type: "chunk", text: text + "\n" });
    };
    rlOut.on("line", onTextLine);
    rlErr.on("line", onTextLine);
  }

  child.on("close", async (code) => {
    currentChild = null;
    rlOut.close();
    rlErr.close();
    send({ type: "done", code: code || 0 });
    if (code === 0) {
      try {
        const sid = lastSessionId || await getLastSession(dir);
        if (sid) {
          let out;
          if (isWin) {
            out = await runPython(join(__dirname, "stats.py"), [sid]);
          } else {
            out = await wsl(`python3 /mnt/c/vibecoding-app/client/stats.py "${sid}"`);
          }
          if (out) {
            const s = JSON.parse(out);
            if (!s.error) {
              let line = `c=${s.ctx.toLocaleString()} o=${s.out.toLocaleString()}`;
              if (s.reasoning) line += ` r=${s.reasoning.toLocaleString()}`;
              if (s.model) line += `\n${s.model}${s.variant ? " " + s.variant : ""}`;
              send({ type: "chunk", text: line + "\n" });
            }
          }
        }
      } catch {}
    }
  });

  child.on("error", (err) => {
    currentChild = null;
    send({ type: "error", text: `Failed to start opencode: ${err.message}` });
  });
}

function onJsonLine(line) {
  const raw = stripAnsi(line);
  try {
    const msg = JSON.parse(raw);
    const t = msg.type;
    const p = msg.part || {};

    if (t === "text") {
      send({ type: "chunk", text: (p.text || "") + "\n" });
    } else if (t === "reasoning") {
      send({ type: "chunk", text: (p.text || "") + "\n" });
    } else if (t === "tool_use") {
      const name = p.tool || "";
      const state = p.state || {};
      let cmd = state.title || "";
      if (!cmd) {
        const inp = state.input || {};
        if (typeof inp === "string") cmd = inp;
        else cmd = inp.command || inp.description || "";
      }
      if (cmd) cmd = cmd.slice(0, 2000);
      send({ type: "chunk", text: `[${name}] ${cmd}\n` });
    } else if (t === "error") {
      const err = msg.message || (msg.error && msg.error.message) || msg.error || "";
      send({ type: "chunk", text: `[error] ${err}\n` });
    }
  } catch {
    send({ type: "chunk", text: raw + "\n" });
  }
}

function cancelCurrent() {
  if (currentChild) {
    spawn("taskkill", ["/PID", currentChild.pid.toString(), "/T", "/F"]);
    currentChild = null;
    send({ type: "cancelled" });
  }
  if (compactChild) {
    spawn("taskkill", ["/PID", compactChild.pid.toString(), "/T", "/F"]);
    compactChild = null;
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
