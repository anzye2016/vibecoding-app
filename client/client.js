import { spawn, spawnSync } from "child_process";
import { readFileSync, existsSync, writeFileSync, rmSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import readline from "readline";
import WebSocket from "ws";
import { P } from "../lib/protocol.js";
import { escapeArg, escapeDir } from "./escapes.js";

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

// 鈹€鈹€ Unified task registry 鈹€鈹€
// Every active child is a task: { tabId, child, kind: "run"|"compact", dir,
//   sessionId, rlOut, rlErr, cancelled, settled }
const tasks = new Set();
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
    if (sendFeishuText) sendFeishuText("鈿狅笍 VibeCoding client has been disconnected from relay for over 5 minutes.");
  }
  const delay = getReconnectDelay();
  retryCount++;
  console.log(`[client] Reconnecting in ${delay}ms (retry ${retryCount})`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);
}

function wsl(cmd, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const child = spawn("wsl", ["-e", "bash", "--noprofile", "--norc", "-c", cmd], { stdio: ["ignore", "pipe", "pipe"] });
    const chunks = [];
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill("SIGKILL"); } catch {}
      reject(new Error("wsl timeout"));
    }, timeoutMs);
    child.stdout.on("data", (d) => { chunks.push(d); });
    child.stderr.on("data", (d) => { stderr += d; });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) {
        resolve(Buffer.concat(chunks).toString("utf8").trim());
      } else {
        console.error("[client] wsl stderr:", stderr);
        reject(new Error(`exit ${code}`));
      }
    });
    child.on("error", (err) => { if (!settled) { settled = true; clearTimeout(timer); reject(err); } });
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
  } catch (e) {
    if (e.message === "wsl timeout") throw e;
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
    send({ type: P.HISTORY, rounds, sessionId }, forceTabId);
    console.log(`[client] Sent ${rounds.length} history rounds (fast path)`);
  } catch (e) {
    console.error("[client] loadHistory error:", e.message);
  }
}

async function sendHistory(msg) {
  const dir = msg.dir || process.cwd();
  const ftId = msg.tabId || currentTabId;
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
  const ftId = msg.tabId || currentTabId;
  const sessions = await listSessions(dir);
  const isWin = dir.match(/^[A-Za-z]:/);
  const cacheKey = isWin ? "/mnt/" + dir[0].toLowerCase() + dir.slice(2).replace(/\\/g, "/") : dir;
  if (!sessionCache.has(cacheKey) && !newSessionDirs.has(cacheKey)) {
    const sid = await getLastSession(dir);
    if (sid) sessionCache.set(cacheKey, sid);
  }
  const current = tabSessions.get(ftId) || sessionCache.get(cacheKey) || null;
  send({ type: P.SESSIONS, sessions, current, dir }, ftId);
}

function handleSelectSession(msg) {
  const tabId = msg.tabId || currentTabId;
  if (msg.sessionId) {
    tabSessions.set(tabId, msg.sessionId);
  } else {
    tabSessions.delete(tabId);
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
    for (const tabId of new Set([...tasks].map((t) => t.tabId))) {
      send({ type: P.PROCESSING }, tabId);
    }
  });

  ws.on("message", (data) => {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }
    currentTabId = msg.tabId || "";

    if (msg.type === P.MSG) {
      handleMessage(msg);
    } else if (msg.type === P.CANCEL) {
      cancelCurrent(currentTabId);
    } else if (msg.type === P.LOAD_HISTORY) {
      console.log("[client] load_history received, dir:", msg.dir);
      const hDir = msg.dir || "";
      const hIsWin = hDir.match(/^[A-Za-z]:/);
      const hKey = hIsWin ? "/mnt/" + hDir[0].toLowerCase() + hDir.slice(2).replace(/\\/g, "/") : hDir;
      for (const task of tasks) {
        if (task.kind === "run" && task.dir === hKey) {
          send({ type: P.PROCESSING }, task.tabId);
          break;
        }
      }
      sendHistory(msg);
    } else if (msg.type === P.LIST_SESSIONS) {
      console.log("[client] list_sessions received, dir:", msg.dir);
      handleListSessions(msg);
    } else if (msg.type === P.SELECT_SESSION) {
      console.log("[client] select_session, id:", msg.sessionId, "dir:", msg.dir);
      handleSelectSession(msg);
    } else if (msg.type === P.STATUS_QUERY) {
      const task = tasksForTab(msg.tabId || "")[0];
      send({ type: P.PROCESSING_STATE, active: !!task, dir: msg.dir, sessionId: task ? task.sessionId : null });
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

function tasksForTab(tabId) {
  return [...tasks].filter((t) => t.tabId === tabId && !t.cancelled);
}

// Mark cancelled, kill the child, release resources, drop from registry.
// Caller decides which notification message(s) to send.
function killTask(task) {
  if (task.cancelled) return false;
  task.cancelled = true;
  killProcess(task.child);
  closeEntry(task);
  tasks.delete(task);
  return true;
}

function cancelTasksFor(tabId) {
  let any = false;
  for (const task of tasksForTab(tabId)) {
    if (killTask(task)) any = true;
  }
  if (any) send({ type: P.CANCELLED }, tabId);
}

function cancelAll() {
  const notified = new Set();
  for (const task of [...tasks]) {
    if (killTask(task) && !notified.has(task.tabId)) {
      notified.add(task.tabId);
      send({ type: P.CANCELLED }, task.tabId);
    }
  }
}

// 鈹€鈹€ JSON line handler 鈥?tabId passed as parameter 鈹€鈹€
function guardMarkdownLinks(text) {
  // Break [x](y) for non-URL y (insert zero-width space after ]), keep real links.
  // Prevents opencode replies that wrap commands as markdown links from being
  // hijacked by the app's link renderer.
  return String(text).replace(/\[([^\]\n]+?)\]\(([^)]*?)\)/g, (m, a, b) =>
    /^https?:\/\//i.test(b.trim()) ? m : `[${a}]\u200b(${b})`);
}

function onJsonLine(line, tabId) {
  const raw = stripAnsi(line);
  try {
    const msg = JSON.parse(raw);
    const t = msg.type;
    const p = msg.part || {};

    if (t === "text") {
      send({ type: P.CHUNK, text: guardMarkdownLinks(p.text || "") + "\n" }, tabId);
      if (p.text && /\[question\]/.test(p.text)) {
        send({ type: P.DONE, code: 0 }, tabId);
      }
    } else if (t === "reasoning") {
      send({ type: P.CHUNK, text: guardMarkdownLinks(p.text || "") + "\n" }, tabId);
    } else if (t === "tool_use") {
      const name = p.tool || "";
      const state = p.state || {};
      let cmd = state.title || "";
      if (!cmd) {
        const inp = state.input || {};
        if (typeof inp === "string") cmd = inp;
        else cmd = inp.command || inp.description || "";
      }
      send({ type: P.CHUNK, text: `[${name}] ${guardMarkdownLinks(cmd)}\n` }, tabId);
      if (name === "question") {
        send({ type: P.DONE, code: 0 }, tabId);
      }
    } else if (t === "error") {
      const err = msg.message || (msg.error && msg.error.message) || msg.error || "";
      send({ type: P.CHUNK, text: `[error] ${err}\n` }, tabId);
      send({ type: P.DONE, code: 1 }, tabId);
    }
  } catch {
    // non-JSON line (WSL noise), drop silently
  }
}

async function handleMessage(msg) {
  const dir = msg.dir;
  const message = msg.msg || "";

  if (!message.trim()) return;

  const tabKey = msg.tabId || currentTabId;

  if (message.trim() === "/stop") {
    let killed = 0;
    const stoppedTabs = new Set();
    for (const task of [...tasks]) {
      stoppedTabs.add(task.tabId);
      if (task.child.exitCode === null && !task.child.killed) killed++;
      killTask(task);
    }
    send({ type: P.CHUNK, text: `[stop] Killed ${killed} process(es)\n` }, tabKey);
    send({ type: P.DONE, code: 0, suppressLabel: true }, tabKey);
    // Notify all other stopped tabs
    for (const id of stoppedTabs) {
      if (id !== tabKey) {
        send({ type: P.CANCELLED }, id);
      }
    }
    // Broadcast clear to all tabs (even if no processes, e.g. after restart)
    ws.send(JSON.stringify({ type: P.CLEAR_PROCESSING }));
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
      send({ type: P.ERROR, text: "/compact is not supported on Linux. Run opencode and enter /compact manually." }, tabKey);
      return;
    }
    if (!msg.dir || !msg.dir.trim()) {
      send({ type: P.ERROR, text: "No working directory configured. Set Work Dir in settings first." }, tabKey);
      return;
    }
    const cDir = msg.dir;
    const cIsWin = cDir.match(/^[A-Za-z]:/);
    const cActualDir = cIsWin
      ? "/mnt/" + cDir[0].toLowerCase() + cDir.slice(2).replace(/\\/g, "/")
      : cDir;

    const sid = sessionCache.get(cActualDir) || null;
    if (!sid) {
      send({ type: P.ERROR, text: "No active session. Send a message first, then use /compact." }, tabKey);
      return;
    }

    if ([...tasks].some((t) => t.kind === "compact")) {
      send({ type: P.ERROR, text: "A compact is already in progress." }, tabKey);
      return;
    }

    console.log("[client] /compact dir:", cDir, "session:", sid, "mode:", cIsWin ? "win" : "wsl");
    send({ type: P.CHUNK, text: "[compact] Opening terminal...\n" }, tabKey);

    const ocBin = cIsWin ? OPENDCODE_BIN : getOpenCode(cActualDir);
    const compactScript = join(__dirname, "compact.py");

    const ctask = {
      tabId: tabKey,
      kind: "compact",
      dir: cActualDir,
      sessionId: sid,
      cancelled: false,
      settled: false,
    };
    ctask.child = spawn(COMPACT_PYTHON, [
      compactScript,
      "--dir", cIsWin ? cDir : cActualDir,
      "--session", sid,
      "--mode", cIsWin ? "win" : "wsl",
      "--opencode", ocBin,
    ], { stdio: ["ignore", "pipe", "pipe"] });
    tasks.add(ctask);

    let cstdout = "";
    let cstderr = "";
    ctask.child.stdout.on("data", (d) => { cstdout += d; });
    ctask.child.stderr.on("data", (d) => { cstderr += d; });

    ctask.child.on("close", () => {
      if (ctask.settled) return;
      ctask.settled = true;
      tasks.delete(ctask);
      if (ctask.cancelled) {
        console.log("[client] compact cancelled");
        return;
      }
      try {
        const result = JSON.parse(cstdout.trim() || "{}");
        if (result.success) {
          send({ type: P.CHUNK, text: "[compact] " + result.message + "\n" }, tabKey);
          send({ type: P.DONE, code: 0, suppressLabel: true }, tabKey);
          console.log("[client] compact done");
        } else {
          const detail = cstderr.trim() || result.message || "failed";
          send({ type: P.ERROR, text: "Compact: " + detail }, tabKey);
          console.error("[client] compact stderr:", cstderr.trim());
        }
      } catch {
        send({ type: P.ERROR, text: "Compact: " + (cstderr.trim() || "script failed") }, tabKey);
        console.error("[client] compact stderr:", cstderr.trim());
      }
    });

    ctask.child.on("error", (err) => {
      if (ctask.settled) return;
      ctask.settled = true;
      tasks.delete(ctask);
      send({ type: P.ERROR, text: "Compact: " + err.message }, tabKey);
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
    send({ type: P.ERROR, text: "Directory not in allowed project paths" }, tabKey);
    return;
  }

  if (isWin) {
    if (!existsSync(dir)) {
      send({ type: P.ERROR, text: `Directory not found: ${dir}` }, tabKey);
      return;
    }
  } else if (IS_LINUX) {
    if (!existsSync(dir)) {
      send({ type: P.ERROR, text: `Directory not found: ${dir}` }, tabKey);
      return;
    }
  } else {
    try {
      const exists = await dirExists(actualDir);
      if (!exists) {
        send({ type: P.ERROR, text: `Directory not found: ${actualDir}` }, tabKey);
        return;
      }
    } catch (e) {
      send({ type: P.ERROR, text: `WSL not responding (${e.message})` }, tabKey);
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
      send({ type: P.CHUNK, text: "[rename] No active session\n" }, tabKey);
      send({ type: P.DONE, code: 1, suppressLabel: true }, tabKey);
      return;
    }
    const escaped = newTitle.replace(/'/g, "'\\''");
    const sql = `UPDATE session SET title = '${escaped}' WHERE id = '${sid}'`;
    try {
      const bin = IS_LINUX ? "opencode" : (actualDir.startsWith("/mnt/") ? OPENDCODE_BIN : "wsl");
      const args = IS_LINUX ? ["db", sql] : (actualDir.startsWith("/mnt/") ? ["db", sql] : ["opencode", "db", sql]);
      const r = spawnSync(bin, args, { windowsHide: true, encoding: "utf-8" });
      if (r.error) throw r.error;
      if (r.status !== 0) throw new Error(r.stderr?.trim() || `exit code ${r.status}`);
      send({ type: P.CHUNK, text: `[rename] Session title changed to: ${newTitle}\n` }, tabKey);
      try {
        const sessions = await listSessions(dir);
        if (sessions.length > 0) send({ type: P.SESSIONS, sessions, current: sid, dir }, tabKey);
      } catch {}
    } catch (e) {
      send({ type: P.CHUNK, text: `[rename] Failed: ${e.message}\n` }, tabKey);
    }
    send({ type: P.DONE, code: 0, suppressLabel: true }, tabKey);
    return;
  }

  const sessionArg = lastSessionId ? `-s "${escapeArg(lastSessionId)}"` : "";
  const escapedMsg = escapeArg(runMessage);

  const useJson = OPENDCODE_MODE === "json";
  const fmtFlag = useJson ? ["--format", "json"] : [];

  // Kill previous RUN task for THIS tab only 鈥?other tabs keep running
  for (const prev of tasksForTab(tabKey)) {
    if (prev.kind === "run" && killTask(prev)) send({ type: P.CANCELLED }, tabKey);
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
    const escapedDir = escapeDir(actualDir);
    const inner = `cd "${escapedDir}" && ${getOpenCode(escapedDir)} run${useJson ? " --format json" : ""} ${sessionArg}${modelFlag ? ` -m "${escapeArg(modelFlag)}"` : ""}${variantFlag ? ` --variant "${escapeArg(variantFlag)}"` : ""} "${escapedMsg}"`;
    const cmd = `script -q -c ${JSON.stringify(inner)} /dev/null`;
    child = spawn("wsl", ["-e", "bash", "--noprofile", "--norc", "-c", cmd], { stdio: ["ignore", "pipe", "pipe"] });
    console.log(`[client] Running ${getOpenCode(actualDir)} via PTY in ${actualDir}: ${message}`);
  }

  const rlOut = readline.createInterface({ input: child.stdout });
  const rlErr = readline.createInterface({ input: child.stderr });
  const rtask = { tabId: tabKey, kind: "run", child, dir: actualDir, sessionId: lastSessionId, rlOut, rlErr, cancelled: false, settled: false };
  tasks.add(rtask);

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
        send({ type: P.CHUNK, text: text + "\n" }, tTabId);
        send({ type: P.CHUNK, text: "[Output truncated...]\n" }, tTabId);
        return;
      }
      send({ type: P.CHUNK, text: text + "\n" }, tTabId);
      if (/^\[question\]/.test(text)) {
        send({ type: P.DONE, code: 0 }, tTabId);
      }
    };
    rlOut.on("line", onTextLine);
    rlErr.on("line", onTextLine);
  }

  child.on("close", async (code) => {
    if (rtask.cancelled || rtask.settled) return;
    rtask.settled = true;
    tasks.delete(rtask);
    closeEntry(rtask);
    send({ type: P.DONE, code: code || 0 }, tabKey);
    if (code === 0) {
      try {
        const sid = lastSessionId || await getLastSession(dir);
        if (sid) {
          sessionCache.set(actualDir, sid);
          const sessions = await listSessions(dir);
          send({ type: P.SESSIONS, sessions, current: sid, dir }, tabKey);
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
              send({ type: P.CHUNK, text: line }, tabKey);
            }
          }
        }
      } catch {}
    }
  });

  child.on("error", (err) => {
    if (rtask.cancelled || rtask.settled) return;
    rtask.settled = true;
    tasks.delete(rtask);
    closeEntry(rtask);
    send({ type: P.ERROR, text: `Failed to start opencode: ${err.message}` }, tabKey);
  });
}

// 鈹€鈹€ Cancel: tabId specified 鈫?cancel that tab only; no tabId 鈫?cancel ALL 鈹€鈹€
function cancelCurrent(tabId) {
  if (tabId) {
    cancelTasksFor(tabId);
  } else {
    cancelAll();
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

