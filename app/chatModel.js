/* ── Pure chat model helpers (no React deps) ── */

export const DEFAULT_RELAY = "wss://localhost:8766/vibecoding/ws";

export const MAX_MESSAGES = 60;

/* Stable per-message id for stable keys */
export function withId(msg) {
  if (msg._id) return msg;
  return { ...msg, _id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8) };
}

/* Keep newest MAX_MESSAGES; drop oldest (e.g. user/status/assistant bubbles). */
export function capMessages(prev) {
  if (prev.length <= MAX_MESSAGES) return prev;
  return prev.slice(-MAX_MESSAGES);
}

export function mergeMsg(prev, msg) {
  const last = prev[prev.length - 1];
  if (msg.type === "status" && (msg.text === "--- Connected ---" || msg.text === "--- PC online ---")) {
    return prev.filter(m =>
      !(m.type === "error" && m.text === "Connection failed") &&
      !(m.type === "status" && m.text === "--- Disconnected ---") &&
      !(m.type === "status" && m.text === "--- PC offline ---")
    );
  }
  if (msg.type === "status" && msg.text === "--- Disconnected ---" && last?.type === "status" && last.text === "--- Disconnected ---") return prev;
  if (msg.type === "chunk" && last?.type === "chunk" && !/^c=[\d,]+/.test(msg.text.trim())) {
    return capMessages([...prev.slice(0, -1), { ...last, text: last.text + msg.text }]);
  }
  return capMessages([...prev, withId(msg)]);
}

/* ── Generate unique tabId ── */
export function genTabId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/* Resolve a session label from the sessions list + current id. */
export function sessionLabelFor(currentId, sessions) {
  if (!currentId) return "(new)";
  const cur = (sessions || []).find(s => s.id === currentId);
  return cur ? (cur.title || "(unnamed)") : "(auto)";
}
