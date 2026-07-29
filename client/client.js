import { spawn, spawnSync, execSync } from "child_process";
import { readFileSync, existsSync, writeFileSync, rmSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import readline from "readline";
import WebSocket from "ws";

const __dirname = dirname(fileURLToPath(import.meta.url));
const configPath = join(__dirname, "..", "config.json");
const config = existsSync(configPath) ? JSON.parse(readFileSync(configPath, "utf-8")) : {};

const RELAY_URL = process.env.RELAY_URL || config.relayUrl || "wss://localhost:8766/vibecoding/ws";
const ROOM = process.env.ROOM || "default";

const tokenFile = process.env.RELAY_TOKEN_FILE || join(__dirname, ".vibecoding-token");
const OPENDCODE_MODE = process.env.OPENDCODE_MODE || "json";
const OPENDCODE_BIN = process.env.OPENDCODE_BIN || (
  process.platform === "linux" ? "opencode" : join(process.env.APPDATA || "", "npm", "node_modules", "opencode-ai", "bin", "opencode.exe")
);
const COMPACT_PYTHON = process.env.COMPACT_PYTHON || config.compactPython || "python";
const IS_LINUX = process.platform === "linux";
let TOKEN = process.env.RELAY_TOKEN;

if (!TOKEN && existsSync(tokenFile)) {
  TOKEN = readFileSync(tokenFile, "utf-8").trim();
}

const pidFile = join(process.env.TEMP || "/tmp", "vibecoding-client-pid.txt");
if (!TOKEN) {
  console.error("RELAY_TOKEN env var or .vibecoding-token file is required");
  try { rmSync(pidFile); } catch {}
  process.exit(1);
}

if (existsSync(pidFile)) {
  try {
    const oldPid = parseInt(readFileSync(pidFile, "utf-8").trim(), 10);
    if (oldPid && oldPid !== process.pid) {
      if (process.platform === "win32") {
        console.log(`[client] Killing stale instance PID ${oldPid}`);
        spawn("taskkill", ["/PID", String(oldPid), "/F"]);
      } else {
        try { process.kill(oldPid, 0); } catch { /* not alive */ }
        console.log(`[client] Killing stale instance PID ${oldPid}`);
        process.kill(oldPid, "SIGKILL");
      }
    }
  } catch {}
}
writeFileSync(pidFile, String(process.pid));

// ── Per-tab process tracking ──
const childMap = new Map();   // tabId -> { child, dir, sessionId, rlOut, rlErr }
let compactChild = null;
let compactTabId = "";
const allChildren = new Set();
let currentTabId = "";
let ws = null;
let reconnectTimer = null;
let retryCount = 0;
let disconnectGraceTimer = null;
let disconnectedSince = null;
let feishuNotified = false;
const sessionCache = new Map();
const newSessionDirs = new Set();
const tabSessions = new Map();

let sendFeishuText = null;
const feishuPath = new URL("../lib/send-feishu.js", import.meta.url).pathname;
if (existsSync(feishuPath)) {
  import("../lib/send-feishu.js").then((m) => { sendFeishuText = m.sendFeishuText; }).catch(() => {});
}

function getReconnectDelay() {
  if (retryCount < 10) return 5000;
  return Math.min(5000 * Math.pow(2, retryCount - 10), 300000);
}

function cancelAfterGrace() {
  if (disconnectGraceTimer) return;
  disconnectGraceTimer = setTimeout(() => {
    disconnectGraceTimer = null;
    cancelAll();
  }, 10000);
}

function cancelGraceIfAlive() {
  if (disconnectGraceTimer) {
    clearTimeout(disconnectGraceTimer);
    disconnectGraceTimer = null;
  }
}

function reconnect() {
  if (reconnectTimer) return;
  if (disconnectedSince && !feishuNotified && Date.now() - disconnectedSince >= 300000) {
    feishuNotified = true;
    if (sendFeishuText) sendFeishuText("⚠️ VibeCoding client has been disconnected from relay for over 5 minutes.");
  }
  const delay = getReconnectDelay();
  retryCount++;
  console.log(`[client] Reconnecting in ${delay}ms (retry ${retryCount})`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);
}

function wsl(cmd) {
  return new Promise((resolve, reject) => {
    const child = spawn("wsl", ["-e", "bash", "--noprofile", "--norc", "-c", cmd], { stdio: ["ignore", "pipe", "pipe"] });
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
  if (IS_LINUX) return "opencode";
  return wslDir.startsWith("/mnt/") ? "opencode" : (config.opencodeBinWsl || "/usr/local/bin/opencode");
}

function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*m/g, "");
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
    let settled = false;
    const pyBin = IS_LINUX ? "python3" : "python";
    const child = spawn(pyBin, [script, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      if (code === 0) resolve(stdout.trim());
      else {
        console.error("[client] python stderr:", stderr);
        reject(new Error(`exit ${code}`));
      }
    });
    child.on("error", (err) => { if (!settled) { settled = true; reject(err); } });
  });
}

function normalizeDir(d) {
  if (d.match(/^[A-Za-z]:/)) return "/mnt/" + d[0].toLowerCase() + d.slice(2).replace(/\\/g, "/");
  return d.replace(/\\/g, "/");
}

async function listSessions(dir) {
  if (!dir) return [];
  try {
    const script = join(__dirname, "sessions_fast.py");
    const pyBin = IS_LINUX ? "python3" : "python";
    let raw;
    if (dir.match(/^[A-Za-z]:/)) {
      const r = spawnSync(pyBin, [script, dir], { encoding: "utf-8", windowsHide: true, timeout: 5000 });
      raw = r.stdout;
    } else if (IS_LINUX) {
      const r = spawnSync(pyBin, [script, dir], { encoding: "utf-8", timeout: 5000 });
      raw = r.stdout;
    } else {
      const fScript = "/mnt/" + script[0].toLowerCase() + script.slice(2).replace(/\\/g, "/");
      raw = await wsl(`python3 '${fScript}' '${dir}'`);
    }
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function getLastSession(dir) {
  const sessions = await listSessions(dir);
  if (sessions.length === 0) return null;
  sessions.sort((a, b) => (b.updated || 0) - (a.updated || 0));
  return sessions[0].id;
}

async function loadHistory(dir, sessionId, forceTabId) {
  try {
    const script = join(__dirname, "last_fast.py");
    const pyBin = IS_LINUX ? "python3" : "python";
    let raw;
    const isWin = dir.match(/^[A-Za-z]:/);
    if (isWin) {
      const r = spawnSync(pyBin, [script, sessionId, dir], { encoding: "utf-8", windowsHide: true });
      raw = r.stdout;
    } else if (IS_LINUX) {
      const r = spawnSync(pyBin, [script, sessionId, dir], { encoding: "utf-8" });
      raw = r.stdout;
    } else {
      const fScript = "/mnt/" + script[0].toLowerCase() + script.slice(2).replace(/\\/g, "/");
      const cmd = `cd '${dir}' && python3 '${fScript}' '${sessionId}' '${dir}'`;
      raw = await wsl(cmd);
    }
    if (!raw || raw.trim() === "[]") { console.warn("[client] loadHistory: 0 rounds, sid:", sessionId); return; }
    const rounds = JSON.parse(raw);
    if (rounds.length === 0) { console.warn("[client] loadHistory: 0 rounds, sid:", sessionId); return; }
    send({ type: "history", rounds, sessionId }, forceTabId);
    console.log(`[client] Sent ${rounds.length} history rounds (fast path)`);
  } catch (e) {
    console.error("[client] loadHistory error:", e.message);
  }
}

async function sendHistory(msg) {
  const dir = msg.dir || process.cwd();
  const ftId = currentTabId;
  console.log("[client] sendHistory dir:", dir);
  if (!dir) return;
  const isWin = dir.match(/^[A-Za-z]:/);
  const cacheKey = isWin ? "/mnt/" + dir[0].toLowerCase() + dir.slice(2).replace(/\\/g, "/") : dir;

  if (newSessionDirs.has(cacheKey)) return;

  let sid;
  if (msg.sessionId) {
    sid = msg.sessionId;
  } else {
    sid = tabSessions.get(ftId);
    if (!sid) {
      if (!sessionCache.has(cacheKey)) {
        const sid_ = await getLastSession(dir);
        if (sid_) { sessionCache.set(cacheKey, sid_); }
        else { console.warn("[client] sendHistory: no session found for", dir); return; }
      }
      sid = sessionCache.get(cacheKey);
    }
  }
  if (sid) {
    await loadHistory(dir, sid, ftId);
  } else {
    console.warn("[client] sendHistory: no cached session for", cacheKey);
  }
}

async function handleListSessions(msg) {
  const dir = msg.dir || process.cwd();
  const ftId = currentTabId;
  const sessions = await listSessions(dir);
  const isWin = dir.match(/^[A-Za-z]:/);
  const cacheKey = isWin ? "/mnt/" + dir[0].toLowerCase() + dir.slice(2).replace(/\\/g, "/") : dir;
  if (!sessionCache.has(cacheKey) && !newSessionDirs.has(cacheKey)) {
    const sid = await getLastSession(dir);
    if (sid) sessionCache.set(cacheKey, sid);
  }
  const current = tabSessions.get(ftId) || sessionCache.get(cacheKey) || null;
  send({ type: "sessions", sessions, current, dir }, ftId);
}

function handleSelectSession(msg) {
  if (msg.sessionId) {
    tabSessions.set(currentTabId, msg.sessionId);
  } else {
    tabSessions.delete(currentTabId);
  }
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
  const url = `${RELAY_URL}/${encodeURIComponent(ROOM)}/pc`;

  ws = new WebSocket(url, TOKEN);

  ws.on("open", () => {
    console.log(`[client] Connected to relay (room: ${ROOM})`);
    retryCount = 0;
    disconnectedSince = null;
    feishuNotified = false;
    cancelGraceIfAlive();
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    try { ws._socket?.setKeepAlive(true, 15000); } catch {}
    // Notify all running tabs
    for (const tabId of childMap.keys()) {
      send({ type: "processing" }, tabId);
    }
  });

  ws.on("message", (data) => {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }
    currentTabId = msg.tabId || "";

    if (msg.type === "msg") {
      handleMessage(msg);
    } else if (msg.type === "cancel") {
      cancelCurrent(currentTabId);
    } else if (msg.type === "load_history") {
      console.log("[client] load_history received, dir:", msg.dir);
      const hDir = msg.dir || "";
      const hIsWin = hDir.match(/^[A-Za-z]:/);
      const hKey = hIsWin ? "/mnt/" + hDir[0].toLowerCase() + hDir.slice(2).replace(/\\/g, "/") : hDir;
      for (const [tabId, entry] of childMap) {
        if (entry.dir === hKey) {
          send({ type: "processing" }, tabId);
          break;
        }
      }
      sendHistory(msg);
    } else if (msg.type === "list_sessions") {
      console.log("[client] list_sessions received, dir:", msg.dir);
      handleListSessions(msg);
    } else if (msg.type === "select_session") {
      console.log("[client] select_session, id:", msg.sessionId, "dir:", msg.dir);
      handleSelectSession(msg);
    } else if (msg.type === "status_query") {
      const entry = childMap.get(currentTabId);
      send({ type: "processing_state", active: !!entry, dir: msg.dir, sessionId: entry ? entry.sessionId : null });
    }
  });

  ws.on("close", () => {
    console.log("[client] Disconnected");
    if (!disconnectedSince) disconnectedSince = Date.now();
    cancelAfterGrace();
    reconnect();
  });

  ws.on("error", (err) => {
    console.error("[client] WebSocket error:", err.message);
    if (!disconnectedSince) disconnectedSince = Date.now();
    cancelAfterGrace();
    reconnect();
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
  return config.allowedDirs || [];
}

function closeEntry(entry) {
  try { entry.rlOut?.close(); } catch {}
  try { entry.rlErr?.close(); } catch {}
}

function killProcess(child) {
  try {
    if (IS_LINUX) {
      process.kill(-child.pid, "SIGTERM");
      setTimeout(() => { try { process.kill(-child.pid, "SIGKILL"); } catch {} }, 5000);
    } else {
      spawn("taskkill", ["/PID", child.pid.toString(), "/T", "/F"]);
    }
  } catch {}
}

// ── JSON line handler — tabId passed as parameter ──
function onJsonLine(line, tabId) {
  const raw = stripAnsi(line);
  try {
    const msg = JSON.parse(raw);
    const t = msg.type;
    const p = msg.part || {};

    if (t === "text") {
      send({ type: "chunk", text: (p.text || "") + "\n" }, tabId);
      if (p.text && /\[question\]/.test(p.text)) {
        send({ type: "done", code: 0 }, tabId);
      }
    } else if (t === "reasoning") {
      send({ type: "chunk", text: (p.text || "") + "\n" }, tabId);
    } else if (t === "tool_use") {
      const name = p.tool || "";
      const state = p.state || {};
      let cmd = state.title || "";
      if (!cmd) {
        const inp = state.input || {};
        if (typeof inp === "string") cmd = inp;
        else cmd = inp.command || inp.description || "";
      }
      send({ type: "chunk", text: `[${name}] ${cmd}\n` }, tabId);
      if (name === "question") {
        send({ type: "done", code: 0 }, tabId);
      }
    } else if (t === "error") {
      const err = msg.message || (msg.error && msg.error.message) || msg.error || "";
      send({ type: "chunk", text: `[error] ${err}\n` }, tabId);
      send({ type: "done", code: 1 }, tabId);
    }
  } catch {
    // non-JSON line (WSL noise), drop silently
  }
}

async function handleMessage(msg) {
  const dir = msg.dir;
  const message = msg.msg || "";

  if (!message.trim()) return;

  const tabKey = currentTabId;

  if (message.trim() === "/stop") {
    let killed = 0;
    const stoppedTabs = [...childMap.keys()];
    const toKill = [...allChildren];
    allChildren.clear();
    childMap.clear();
    for (const child of toKill) {
      if (child.exitCode === null && !child.killed) {
        killProcess(child);
        killed++;
      }
    }
    compactChild = null;
    compactTabId = "";
    send({ type: "chunk", text: `[stop] Killed ${killed} process(es)\n` }, tabKey);
    send({ type: "done", code: 0, suppressLabel: true }, tabKey);
    // Notify all other stopped tabs
    for (const id of stoppedTabs) {
      if (id !== tabKey) {
        send({ type: "cancelled" }, id);
      }
    }
    // Broadcast clear to all tabs (even if no processes, e.g. after restart)
    ws.send(JSON.stringify({ type: "clear_processing" }));
    return;
  }

  if (message.trim() === "!!restart") {
    console.log("[client] Restart requested");
    cancelAll();
    setTimeout(() => {
      if (ws) { ws.removeAllListeners(); try { ws._socket?.destroy(); } catch {} }
      process.exit(0);
    }, 500);
    return;
  }

  if (message.trim() === "/compact") {
    if (IS_LINUX) {
      send({ type: "error", text: "/compact is not supported on Linux. Run opencode and enter /compact manually." }, tabKey);
      return;
    }
    if (!msg.dir || !msg.dir.trim()) {
      send({ type: "error", text: "No working directory configured. Set Work Dir in settings first." }, tabKey);
      return;
    }
    const cDir = msg.dir;
    const cIsWin = cDir.match(/^[A-Za-z]:/);
    const cActualDir = cIsWin
      ? "/mnt/" + cDir[0].toLowerCase() + cDir.slice(2).replace(/\\/g, "/")
      : cDir;

    const sid = sessionCache.get(cActualDir) || null;
    if (!sid) {
      send({ type: "error", text: "No active session. Send a message first, then use /compact." }, tabKey);
      return;
    }

    if (compactChild) {
      send({ type: "error", text: "A compact is already in progress." }, tabKey);
      return;
    }

    console.log("[client] /compact dir:", cDir, "session:", sid, "mode:", cIsWin ? "win" : "wsl");
    send({ type: "chunk", text: "[compact] Opening terminal...\n" }, tabKey);

    const ocBin = cIsWin ? OPENDCODE_BIN : getOpenCode(cActualDir);
    const compactScript = join(__dirname, "compact.py");
    compactTabId = tabKey;

    compactChild = spawn(COMPACT_PYTHON, [
      compactScript,
      "--dir", cIsWin ? cDir : cActualDir,
      "--session", sid,
      "--mode", cIsWin ? "win" : "wsl",
      "--opencode", ocBin,
    ], { stdio: ["ignore", "pipe", "pipe"] });
    allChildren.add(compactChild);

    let cstdout = "";
    let cstderr = "";
    let compactSettled = false;
    compactChild.stdout.on("data", (d) => { cstdout += d; });
    compactChild.stderr.on("data", (d) => { cstderr += d; });

    compactChild.on("close", (code) => {
      if (compactSettled) return;
      compactSettled = true;
      allChildren.delete(compactChild);
      compactChild = null;
      const ctId = compactTabId;
      compactTabId = "";
      try {
        const result = JSON.parse(cstdout.trim() || "{}");
        if (result.success) {
          send({ type: "chunk", text: "[compact] " + result.message + "\n" }, ctId);
          send({ type: "done", code: 0, suppressLabel: true }, ctId);
          console.log("[client] compact done");
        } else {
          const detail = cstderr.trim() || result.message || "failed";
          send({ type: "error", text: "Compact: " + detail }, ctId);
          console.error("[client] compact stderr:", cstderr.trim());
        }
      } catch {
        send({ type: "error", text: "Compact: " + (cstderr.trim() || "script failed") }, ctId);
        console.error("[client] compact stderr:", cstderr.trim());
      }
    });

    compactChild.on("error", (err) => {
      if (compactSettled) return;
      compactSettled = true;
      allChildren.delete(compactChild);
      compactChild = null;
      const ctId = compactTabId;
      compactTabId = "";
      send({ type: "error", text: "Compact: " + err.message }, ctId);
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
    send({ type: "error", text: "Directory not in allowed project paths" }, tabKey);
    return;
  }

  if (isWin) {
    if (!existsSync(dir)) {
      send({ type: "error", text: `Directory not found: ${dir}` }, tabKey);
      return;
    }
  } else if (IS_LINUX) {
    if (!existsSync(dir)) {
      send({ type: "error", text: `Directory not found: ${dir}` }, tabKey);
      return;
    }
  } else {
    const exists = await dirExists(actualDir);
    if (!exists) {
      send({ type: "error", text: `Directory not found: ${actualDir}` }, tabKey);
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
  let variantFlag = "";
  let runMessage = message;
  const m = message.match(/^\/model\s+(\S+)/);
  if (m) {
    modelFlag = m[1];
    runMessage = message.slice(m[0].length).trim() || "hi";
  }
  const v = runMessage.match(/^\/variant\s+(\S+)/);
  if (v) {
    variantFlag = v[1];
    runMessage = runMessage.slice(v[0].length).trim() || "hi";
  }

  const rn = runMessage.match(/^\/rename\s+(.+)/);
  if (rn) {
    const newTitle = rn[1].trim();
    const sid = lastSessionId;
    if (!sid) {
      send({ type: "chunk", text: "[rename] No active session\n" }, tabKey);
      send({ type: "done", code: 1, suppressLabel: true }, tabKey);
      return;
    }
    const escaped = newTitle.replace(/'/g, "'\\''");
    const sql = `UPDATE session SET title = '${escaped}' WHERE id = '${sid}'`;
    try {
      if (IS_LINUX) {
        execSync(`opencode db "${sql}"`, { shell: true });
      } else {
        const bin = actualDir.startsWith("/mnt/") ? OPENDCODE_BIN : "wsl";
        const args = actualDir.startsWith("/mnt/") ? ["db", sql] : ["opencode", "db", sql];
        const r = spawnSync(bin, args, { windowsHide: true, encoding: "utf-8" });
        if (r.error) throw r.error;
        if (r.status !== 0) throw new Error(r.stderr?.trim() || `exit code ${r.status}`);
      }
      send({ type: "chunk", text: `[rename] Session title changed to: ${newTitle}\n` }, tabKey);
    } catch (e) {
      send({ type: "chunk", text: `[rename] Failed: ${e.message}\n` }, tabKey);
    }
    send({ type: "done", code: 0, suppressLabel: true }, tabKey);
    return;
  }

  const sessionArg = lastSessionId ? `-s "${lastSessionId}"` : "";
  const escapedMsg = runMessage
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\$/g, '\\$')
    .replace(/`/g, '\\`')
    .replace(/!/g, '\\!');

  const useJson = OPENDCODE_MODE === "json";
  const fmtFlag = useJson ? ["--format", "json"] : [];

  // Kill previous task for THIS tab only — other tabs keep running
  const prev = childMap.get(tabKey);
  if (prev) {
    killProcess(prev.child);
    closeEntry(prev);
    childMap.delete(tabKey);
    send({ type: "cancelled" }, tabKey);
  }

  let child;
  if (isWin) {
    const args = ["run", ...fmtFlag];
    if (lastSessionId) args.push("-s", lastSessionId);
    if (modelFlag) args.push("-m", modelFlag);
    if (variantFlag) args.push("--variant", variantFlag);
    args.push(runMessage);
    child = spawn(OPENDCODE_BIN, args, { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
    console.log(`[client] Running opencode natively in ${dir}: ${message}`);
  } else if (IS_LINUX) {
    const args = ["run", ...fmtFlag];
    if (lastSessionId) args.push("-s", lastSessionId);
    if (modelFlag) args.push("-m", modelFlag);
    if (variantFlag) args.push("--variant", variantFlag);
    args.push(runMessage);
    child = spawn(OPENDCODE_BIN, args, { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
    console.log(`[client] Running opencode in ${dir}: ${message}`);
  } else {
    const escapedDir = actualDir
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\$/g, '\\$')
      .replace(/`/g, '\\`');
    const inner = `cd "${escapedDir}" && ${getOpenCode(escapedDir)} run${useJson ? " --format json" : ""} ${sessionArg}${modelFlag ? ` -m "${modelFlag}"` : ""}${variantFlag ? ` --variant "${variantFlag}"` : ""} "${escapedMsg}"`;
    const cmd = `script -q -c ${JSON.stringify(inner)} /dev/null`;
    child = spawn("wsl", ["-e", "bash", "--noprofile", "--norc", "-c", cmd], { stdio: ["ignore", "pipe", "pipe"] });
    console.log(`[client] Running ${getOpenCode(actualDir)} via PTY in ${actualDir}: ${message}`);
  }

  allChildren.add(child);
  const rlOut = readline.createInterface({ input: child.stdout });
  const rlErr = readline.createInterface({ input: child.stderr });
  childMap.set(tabKey, { child, dir: actualDir, sessionId: lastSessionId, rlOut, rlErr });

  if (useJson) {
    const jTabId = tabKey;
    rlOut.on("line", (line) => onJsonLine(line, jTabId));
    rlErr.on("line", (line) => onJsonLine(line, jTabId));
  } else {
    let burstCount = 0;
    let burstStart = 0;
    const MAX_BURST = 40;
    const tTabId = tabKey;
    const onTextLine = (line) => {
      const text = stripAnsi(line);
      const now = Date.now();
      if (now - burstStart > 2000) { burstCount = 0; burstStart = now; }
      burstCount++;
      if (burstCount > MAX_BURST) return;
      if (burstCount === MAX_BURST) {
        send({ type: "chunk", text: text + "\n" }, tTabId);
        send({ type: "chunk", text: "[Output truncated...]\n" }, tTabId);
        return;
      }
      send({ type: "chunk", text: text + "\n" }, tTabId);
      if (/^\[question\]/.test(text)) {
        send({ type: "done", code: 0 }, tTabId);
      }
    };
    rlOut.on("line", onTextLine);
    rlErr.on("line", onTextLine);
  }

  child.on("close", async (code) => {
    const entry = childMap.get(tabKey);
    if (!entry || entry.child !== child) return;
    childMap.delete(tabKey);
    allChildren.delete(child);
    closeEntry(entry);
    send({ type: "done", code: code || 0 }, tabKey);
    if (code === 0) {
      try {
        const sid = lastSessionId || await getLastSession(dir);
        if (sid) {
          sessionCache.set(actualDir, sid);
          const sessions = await listSessions(dir);
          send({ type: "sessions", sessions, current: sid, dir }, tabKey);
          let out;
          const dbPaths = config.statsDbPaths || [];
          if (isWin) {
            const r = spawnSync("python", [join(__dirname, "stats.py"), sid, ...dbPaths], { encoding: "utf-8", windowsHide: true, timeout: 5000 });
            out = r.stdout;
          } else if (IS_LINUX) {
            const r = spawnSync("python3", [join(__dirname, "stats.py"), sid, ...dbPaths], { encoding: "utf-8", timeout: 5000 });
            out = r.stdout;
          } else {
            const dbArgs = dbPaths.map(p => `"${p}"`).join(" ");
            const statsScript = "/mnt/" + __dirname[0].toLowerCase() + __dirname.slice(2).replace(/\\/g, "/") + "/stats.py";
            out = await wsl(`python3 '${statsScript}' "${sid}" ${dbArgs}`);
          }
          if (out) {
            const s = JSON.parse(out);
            if (!s.error) {
              let line = `c=${s.ctx.toLocaleString()} o=${s.out.toLocaleString()}`;
              if (s.reasoning) line += ` r=${s.reasoning.toLocaleString()}`;
              if (s.model) line += `\n${s.model}${s.variant ? " " + s.variant : ""}`;
              send({ type: "chunk", text: line }, tabKey);
            }
          }
        }
      } catch {}
    }
  });

  child.on("error", (err) => {
    const entry = childMap.get(tabKey);
    if (!entry || entry.child !== child) return;
    childMap.delete(tabKey);
    allChildren.delete(child);
    closeEntry(entry);
    send({ type: "error", text: `Failed to start opencode: ${err.message}` }, tabKey);
  });
}

// ── Cancel: tabId specified → cancel that tab only; no tabId → cancel ALL ──
function cancelCurrent(tabId) {
  if (tabId) {
    const entry = childMap.get(tabId);
    if (entry) {
      killProcess(entry.child);
      closeEntry(entry);
      childMap.delete(tabId);
      send({ type: "cancelled" }, tabId);
    }
  } else {
    cancelAll();
  }
}

function cancelAll() {
  for (const [tabId, entry] of childMap) {
    killProcess(entry.child);
    closeEntry(entry);
    childMap.delete(tabId);
    send({ type: "cancelled" }, tabId);
  }
  if (compactChild) {
    killProcess(compactChild);
    compactChild = null;
    compactTabId = "";
  }
}

function send(obj, forceTabId) {
  if (ws && ws.readyState === 1) {
    if (forceTabId) {
      ws.send(JSON.stringify({ ...obj, tabId: forceTabId }));
      return;
    }
    ws.send(JSON.stringify(obj.tabId ? obj : { ...obj, tabId: currentTabId }));
  }
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

const stdinRl = readline.createInterface({ input: process.stdin });
stdinRl.on("SIGINT", shutdown);

function shutdown() {
  cancelAll();
  if (disconnectGraceTimer) clearTimeout(disconnectGraceTimer);
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (ws) ws.close();
  process.exit(0);
}

process.on("uncaughtException", (err) => {
  console.error("[client] Uncaught:", err.message);
  cancelAll();
  if (disconnectGraceTimer) clearTimeout(disconnectGraceTimer);
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (ws) ws.close();
  process.exit(1);
});

connect();
