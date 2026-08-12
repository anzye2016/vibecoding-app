import { useState, useRef, useCallback, useEffect } from "react";
import { AppState } from "react-native";
import { DEFAULT_RELAY, mergeMsg, genTabId, capMessages, withId, sessionLabelFor } from "../chatModel";
import { P } from "../../lib/protocol.js";

/* ── Connection + per-tab messaging hub ──
 * Owns the WebSocket lifecycle, message dispatch and per-tab state
 * (messages/processing/session), so the screen component stays presentational.
 */
export function useChatConnection({ roomId, token, relayUrl, showStats, workDirRef, scrollRef, onDirChange, onSessions }) {
  const [status, setStatus] = useState("disconnected");
  const [messages, setMessages] = useState([]);
  const [processing, setProcessing] = useState(false);
  const [currentSessionId, setCurrentSessionId] = useState(null);
  const [sessionLabel, setSessionLabel] = useState("(auto)");
  const [pendingCount, setPendingCount] = useState(0);
  const [sessions, setSessions] = useState([]);

  const wsRef = useRef(null);
  const connectRef = useRef(null);
  const reconnectTimer = useRef(null);
  const appStateReady = useRef(false);
  const restoreProcessingRef = useRef(false);
  const retryCount = useRef(0);
  const wasEverConnected = useRef(false);
  const doneTimerRef = useRef(new Map());
  const intentionalDisconnect = useRef(false);
  const nearBottom = useRef(true);

  const pendingQueue = useRef([]);
  const tabMessages = useRef(new Map());
  const tabProcessing = useRef(new Map());
  const activeTabIdRef = useRef(genTabId());
  const historyLoadedRef = useRef(new Map());
  const pendingSessionRef = useRef(null);
  const pendingSessionLabelRef = useRef(null);
  const autoLoadHistoryRef = useRef(false);
  const connectedDirRef = useRef("");
  const restoredFromCacheRef = useRef(false);
  const currentSessionIdRef = useRef(null);

  const getReconnectDelay = () => {
    const n = retryCount.current;
    if (n < 10) return 1000;
    return Math.min(1000 * Math.pow(2, n - 10), 30000);
  };

  useEffect(() => {
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      for (const t of doneTimerRef.current.values()) clearTimeout(t);
      doneTimerRef.current.clear();
      if (wsRef.current) wsRef.current.close();
    };
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (!appStateReady.current) { appStateReady.current = true; return; }
      if (state !== "active") return;
      if (intentionalDisconnect.current) return;
      if (wsRef.current?.readyState === 1) return;
      connectRef.current?.();
    });
    return () => sub.remove();
  }, []);

  /* ── Route messages to per-tab state ── */
  const addMessage = useCallback((msg) => {
    setMessages((prev) => mergeMsg(prev, msg));
  }, []);

  const routeMsg = useCallback((tabId, msg) => {
    if (!tabId) { addMessage(msg); return; }
    const prev = tabMessages.current.get(tabId) || [];
    const merged = mergeMsg(prev, msg);
    tabMessages.current.set(tabId, merged);
    if (tabId === activeTabIdRef.current) setMessages(merged);
  }, [addMessage]);

  const routeProc = useCallback((tabId, active) => {
    tabProcessing.current.set(tabId, active);
    if (tabId === activeTabIdRef.current) setProcessing(active);
  }, []);

  const clearDoneTimer = useCallback((tabId) => {
    const prev = doneTimerRef.current.get(tabId);
    if (prev) clearTimeout(prev);
    doneTimerRef.current.delete(tabId);
  }, []);

  const doSend = useCallback((text, dir, overrideTabId) => {
    if (!wsRef.current || wsRef.current.readyState !== 1) return;
    const tabId = overrideTabId || activeTabIdRef.current;
    wsRef.current.send(JSON.stringify({ type: P.MSG, tabId, dir: dir || workDirRef.current, msg: text }));
    routeMsg(tabId, { type: "user", text: `${text}` });
    const dt = doneTimerRef.current.get(tabId);
    if (dt) {
      clearTimeout(dt);
      doneTimerRef.current.delete(tabId);
      routeMsg(tabId, { type: P.STATUS, text: "--- Done ---" });
    }
    nearBottom.current = true;
    routeProc(tabId, true);
  }, [routeMsg, routeProc, workDirRef]);

  const enqueue = useCallback((text) => {
    pendingQueue.current.push({ text, dir: workDirRef.current, tabId: activeTabIdRef.current });
    setPendingCount(pendingQueue.current.length);
  }, [workDirRef]);

  const flushQueue = useCallback(() => {
    const q = pendingQueue.current;
    if (q.length === 0) return;
    pendingQueue.current = [];
    setPendingCount(0);
    for (const item of q) {
      doSend(item.text, item.dir, item.tabId);
    }
  }, [doSend]);

  const cancelTask = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState === 1) {
      wsRef.current.send(JSON.stringify({ type: P.CANCEL, tabId: activeTabIdRef.current }));
    }
  }, []);

  const connectChat = (dir) => {
    if (!roomId.trim() || !token.trim()) return;
    if (typeof dir === "string") {
      workDirRef.current = dir;
      if (onDirChange) onDirChange(dir);
    }

    const hlKey = activeTabIdRef.current;
    restoreProcessingRef.current = !intentionalDisconnect.current && historyLoadedRef.current.get(hlKey) && processing;

    intentionalDisconnect.current = true;
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    intentionalDisconnect.current = false;

    setStatus("connecting");

    const url = `${relayUrl || DEFAULT_RELAY}/${encodeURIComponent(roomId.trim())}/phone`;
    const ws = new WebSocket(url, token.trim());
    wsRef.current = ws;

    ws.onopen = () => {
      if (wsRef.current !== ws) return;
      retryCount.current = 0;
      setStatus("connected");
      connectedDirRef.current = workDirRef.current;
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
        reconnectTimer.current = null;
      }
      if (wasEverConnected.current) {
        if (restoreProcessingRef.current) setProcessing(true);
        addMessage({ type: P.STATUS, text: "--- Connected ---" });
      } else {
        wasEverConnected.current = true;
        addMessage({ type: P.STATUS, text: "--- Connected ---" });
      }
      if (pendingSessionRef.current) {
        const ps = pendingSessionRef.current;
        pendingSessionRef.current = null;
        if (ps.sessionLabel) pendingSessionLabelRef.current = ps.sessionLabel;
        ws.send(JSON.stringify({ type: P.SELECT_SESSION, tabId: ps.tabId || "", sessionId: ps.sessionId || null, dir: workDirRef.current }));
        setCurrentSessionId(ps.sessionId || null);
        currentSessionIdRef.current = ps.sessionId || null;
        setSessionLabel(ps.sessionLabel || "(new)");
        if (ps.tabId) historyLoadedRef.current.set(ps.tabId, false);
        if (!restoredFromCacheRef.current) setMessages([]);
        restoredFromCacheRef.current = false;
        if (autoLoadHistoryRef.current) {
          autoLoadHistoryRef.current = false;
          const hid = ps.tabId || "";
          if (!tabMessages.current.get(hid)?.length) tabMessages.current.set(hid, []);
          ws.send(JSON.stringify({ type: P.LOAD_HISTORY, tabId: hid, dir: workDirRef.current, sessionId: ps.sessionId || null }));
        }
        ws.send(JSON.stringify({ type: P.LIST_SESSIONS, tabId: ps.tabId || "", dir: workDirRef.current }));
      }
      ws.send(JSON.stringify({ type: P.STATUS_QUERY, tabId: activeTabIdRef.current, dir: workDirRef.current, sessionId: currentSessionIdRef.current }));
      flushQueue();
    };

    ws.onclose = () => {
      if (wsRef.current !== ws) return;
      wsRef.current = null;
      setStatus("disconnected");
      addMessage({ type: P.STATUS, text: "--- Disconnected ---" });
      if (!intentionalDisconnect.current && AppState.currentState === "active") {
        const delay = getReconnectDelay();
        retryCount.current++;
        reconnectTimer.current = setTimeout(() => connectRef.current?.(), delay);
      }
    };

    ws.onerror = () => {
      if (wsRef.current !== ws) return;
      addMessage({ type: P.ERROR, text: "Connection failed" });
    };

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        const tabId = msg.tabId || "";

        if (msg.type === P.STATUS) {
          if (msg.online) {
            addMessage({ type: P.STATUS, text: "--- PC online ---" });
            ws.send(JSON.stringify({ type: P.LIST_SESSIONS, tabId: activeTabIdRef.current, dir: workDirRef.current }));
          } else {
            addMessage({ type: P.STATUS, text: "--- PC offline ---" });
            for (const id of tabProcessing.current.keys()) routeProc(id, false);
          }
        } else if (msg.type === P.CHUNK) {
          const dt = doneTimerRef.current.get(tabId);
          if (dt) {
            clearTimeout(dt);
            doneTimerRef.current.delete(tabId);
            if (showStats) routeMsg(tabId, { type: P.STATUS, text: msg.text.trim() });
            routeMsg(tabId, { type: P.STATUS, text: "--- Done ---" });
          } else if (/^c=[\d,]+/.test(msg.text.trim())) {
            if (showStats) routeMsg(tabId, { type: P.STATUS, text: msg.text.trim() });
          } else {
            routeMsg(tabId, msg);
          }
        } else if (msg.type === P.DONE) {
          routeProc(tabId, false);
          clearDoneTimer(tabId);
          if (!msg.suppressLabel) doneTimerRef.current.set(tabId, setTimeout(() => routeMsg(tabId, { type: P.STATUS, text: "--- Done ---" }), 2000));
        } else if (msg.type === P.CANCELLED) {
          routeProc(tabId, false);
          clearDoneTimer(tabId);
          routeMsg(tabId, { type: P.STATUS, text: "--- Cancelled ---" });
        } else if (msg.type === P.ERROR) {
          routeProc(tabId, false);
          clearDoneTimer(tabId);
          routeMsg(tabId, { type: P.ERROR, text: msg.text });
        } else if (msg.type === P.CLEAR_PROCESSING) {
          for (const id of tabProcessing.current.keys()) routeProc(id, false);
        } else if (msg.type === P.PROCESSING) {
          routeProc(tabId, true);
        } else if (msg.type === P.PROCESSING_STATE) {
          if (msg.active === false) routeProc(tabId, false);
          else if (!msg.dir || msg.dir === workDirRef.current) {
            routeProc(tabId, true);
          }
        } else if (msg.type === P.HISTORY) {
          if (tabId) historyLoadedRef.current.set(tabId, true);
          if (msg.rounds && Array.isArray(msg.rounds)) {
            const histMsgs = [];
            msg.rounds.forEach((r, idx) => {
              if (idx > 0) histMsgs.push(withId({ type: "spacer" }));
              histMsgs.push(withId({ type: "history-user", text: r.user }));
              histMsgs.push(withId({ type: "history-assistant", text: r.assistant }));
            });
            histMsgs.push(withId({ type: P.STATUS, text: "--- History loaded ---" }));
            tabMessages.current.set(tabId, capMessages(histMsgs));
            if (tabId === activeTabIdRef.current) setMessages(capMessages(histMsgs));
            requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: false }));
          } else if (tabId === activeTabIdRef.current) {
            setMessages([]);
          }
        } else if (msg.type === P.SESSIONS) {
          if (tabId === activeTabIdRef.current) {
            setSessions(msg.sessions || []);
            setCurrentSessionId(msg.current || null);
            currentSessionIdRef.current = msg.current || null;
            if (pendingSessionLabelRef.current) {
              setSessionLabel(pendingSessionLabelRef.current);
              pendingSessionLabelRef.current = null;
            } else {
              setSessionLabel(sessionLabelFor(msg.current, msg.sessions));
            }
            if (onSessions) onSessions(msg);
          }
        }
      } catch (err) {
        console.warn("[ws] parse error:", err.message);
      }
    };
  };
  connectRef.current = connectChat;

  const disconnect = useCallback(() => {
    retryCount.current = 0;
    intentionalDisconnect.current = true;
    wasEverConnected.current = false;
    if (pendingQueue.current.length > 0) {
      pendingQueue.current = [];
      setPendingCount(0);
      addMessage({ type: P.STATUS, text: "--- Pending messages cancelled ---" });
    }
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setStatus("disconnected");
    setProcessing(false);
    setCurrentSessionId(null);
    currentSessionIdRef.current = null;
    setSessionLabel("(auto)");
  }, [addMessage]);

  const fetchSessions = (onDone) => {
    if (!roomId.trim() || !token.trim()) return;
    const url = `${relayUrl || DEFAULT_RELAY}/${encodeURIComponent(roomId.trim())}/phone`;
    const ws = new WebSocket(url, token.trim());
    const t = setTimeout(() => { try { ws.close(); } catch {} }, 8000);
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: P.LIST_SESSIONS, tabId: activeTabIdRef.current, dir: workDirRef.current }));
    };
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === P.SESSIONS) {
          setSessions(msg.sessions || []);
          setCurrentSessionId(msg.current || null);
          currentSessionIdRef.current = msg.current || null;
          clearTimeout(t);
          ws.close();
          if (onDone) onDone();
        }
      } catch {}
    };
  };

  return {
    status,
    messages,
    processing,
    sessions,
    currentSessionId,
    sessionLabel,
    pendingCount,
    connectChat,
    disconnect,
    doSend,
    enqueue,
    flushQueue,
    cancelTask,
    fetchSessions,
    setMessages,
    setProcessing,
    setCurrentSessionId,
    setSessionLabel,
    setPendingCount,
    wsRef,
    connectRef,
    tabMessages,
    tabProcessing,
    activeTabIdRef,
    historyLoadedRef,
    pendingQueue,
    currentSessionIdRef,
    pendingSessionRef,
    pendingSessionLabelRef,
    autoLoadHistoryRef,
    restoredFromCacheRef,
    connectedDirRef,
    workDirRef,
    nearBottom,
  };
}
