import { useState, useRef, useCallback, useEffect, useMemo, memo } from "react";
import {
  View,
  Text,
  TextInput,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Platform,
  Keyboard,
  StatusBar,
  Image,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import MarkdownBlock from "./components/MarkdownBlock";
import SessionPickerModal from "./components/SessionPickerModal";
import SettingsModal from "./components/SettingsModal";
import QuickDirEditModal from "./components/QuickDirEditModal";
import { useChatConnection } from "./hooks/useChatConnection";
import { genTabId, sessionLabelFor } from "./chatModel";
import { THEME_PALETTES, buildPalette } from "./theme";
import { P } from "../lib/protocol.js";

function tryParseQuestion(text) {
  if (!text) return null;
  const idx = text.indexOf("[question]");
  if (idx === -1) return null;
  const after = text.slice(idx + "[question]".length).trim();
  const start = after.indexOf("{");
  const end = after.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const data = JSON.parse(after.slice(start, end + 1));
    return { data, before: text.slice(0, idx).trim() };
  } catch {
    return null;
  }
}

function QuestionBlock({ questionData, beforeText, onAnswer, C }) {
  const [answered, setAnswered] = useState(false);
  const handleAnswer = (label) => {
    if (answered) return;
    setAnswered(true);
    onAnswer(label);
  };
  return (
    <View style={{ marginVertical: 8 }}>
      {beforeText ? <MarkdownBlock text={beforeText} C={C} /> : null}
      {questionData.questions.map((q, qi) => {
        const options = Array.isArray(q.options) ? q.options : [];
        return (
          <View key={qi} style={{ gap: 4 }}>
            {q.header ? <Text style={{ color: "#facc15", fontSize: 13, fontWeight: "600", marginBottom: 2 }}>{q.header}</Text> : null}
            {q.question ? <Text style={{ color: C.textBright, fontSize: 15, lineHeight: 22, marginBottom: 8 }}>{q.question}</Text> : null}
            {options.map((opt, oi) => (
              <TouchableOpacity
                key={oi}
                style={[{ backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, marginTop: 6 }, answered && { opacity: 0.5 }]}
                onPress={() => handleAnswer(opt.label)}
                activeOpacity={0.7}
                disabled={answered}
              >
                <Text style={{ color: C.accentLight, fontSize: 14, fontWeight: "500" }}>{opt.label}</Text>
                {opt.description ? <Text style={{ color: C.text, fontSize: 12, marginTop: 3, lineHeight: 17 }}>{opt.description}</Text> : null}
              </TouchableOpacity>
            ))}
          </View>
        );
      })}
    </View>
  );
}

const STORAGE_KEYS = {
  TOKEN: "vibecoding_token",
  ROOM: "vibecoding_room",
  DIR: "vibecoding_dir",
  RELAY: "vibecoding_relay",
  THEME: "vibecoding_theme",
  CUSTOM_COLORS: "vibecoding_custom_colors",
  BG_IMAGE: "vibecoding_bg_image",
  BG_OPACITY: "vibecoding_bg_opacity",
  SHOW_STATS: "vibecoding_show_stats",
  QUICK_DIRS: "vibecoding_quick_dirs",
};

/* ── Memoized chat background: stable until uri/opacity actually change ── */
const ChatBackground = memo(function ChatBackground({ uri, opacity }) {
  if (!uri) return null;
  return <Image source={{ uri }} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, opacity }} resizeMode="cover" />;
});

const SPINNER_FRAMES = ["|", "/", "-", "\\"];

const ThinkingBar = memo(function ThinkingBar({ s }) {
  const [spinner, setSpinner] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setSpinner(x => (x + 1) % SPINNER_FRAMES.length), 100);
    return () => clearInterval(t);
  }, []);
  return (
    <View style={s.thinkingBar}>
      <Text style={s.thinkingText}>Thinking...</Text>
      <Text style={s.thinkingDot}>{SPINNER_FRAMES[spinner]}</Text>
    </View>
  );
});

/* ── Memoized message row: only re-renders when its own msg reference changes ── */
const MessageItem = memo(function MessageItem({ msg, C, onAnswer, s }) {
  if (msg.type === P.STATUS) {
    return (
      <TouchableOpacity activeOpacity={1.0}>
        <Text style={s.statusLine}>{msg.text}</Text>
      </TouchableOpacity>
    );
  }
  if (msg.type === P.ERROR) {
    return (
      <TouchableOpacity activeOpacity={1.0}>
        <Text style={s.errorLine}>{msg.text}</Text>
      </TouchableOpacity>
    );
  }
  if (msg.type === "user" || msg.type === "history-user") {
    return (
      <View style={s.userBubble}>
        <Text style={s.userBubbleText} selectable>{msg.text}</Text>
      </View>
    );
  }
  if (msg.type === P.CHUNK || msg.type === "history-assistant") {
    const parsed = tryParseQuestion(msg.text);
    const questions = parsed && Array.isArray(parsed.data.questions) ? parsed.data.questions : null;
    if (questions && questions.length > 0) {
      return <QuestionBlock questionData={parsed.data} beforeText={parsed.before} onAnswer={onAnswer} C={C} />;
    }
    return (
      <View style={s.assistantBubble}>
        <MarkdownBlock text={msg.text} C={C} />
      </View>
    );
  }
  if (msg.type === "spacer") {
    return <View style={{ height: 16 }} />;
  }
  return (
    <View style={s.assistantBubble}>
      <MarkdownBlock text={msg.text} C={C} />
    </View>
  );
});

export default function ChatScreen() {
  const insets = useSafeAreaInsets();
  const scrollRef = useRef(null);
  const workDirRef = useRef("");

  const [token, setToken] = useState("");
  const [roomId, setRoomId] = useState("");
  const [workDir, setWorkDir] = useState("");
  const [relayUrl, setRelayUrl] = useState("");
  const [showStats, setShowStats] = useState(true);
  const [quickDirs, setQuickDirs] = useState([]);

  const onSessions = useCallback((msg) => {
    if (!msg.dir || !msg.current) return;
    setQuickDirs(prev => prev.map(q =>
      q.path === msg.dir ? { ...q, sessionLabel: sessionLabelFor(msg.current, msg.sessions) } : q
    ));
  }, []);

  const conn = useChatConnection({ roomId, token, relayUrl, showStats, workDirRef, scrollRef, onDirChange: setWorkDir, onSessions });

  const {
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
    cancelTask,
    fetchSessions,
    setMessages,
    setProcessing,
    setCurrentSessionId,
    setSessionLabel,
    setPendingCount,
    wsRef,
    tabMessages,
    tabProcessing,
    activeTabIdRef,
    historyLoadedRef,
    currentSessionIdRef,
    pendingSessionRef,
    pendingSessionLabelRef,
    autoLoadHistoryRef,
    restoredFromCacheRef,
    connectedDirRef,
    nearBottom,
    pendingQueue,
  } = conn;

  const [inputText, setInputText] = useState("");
  const [kbHeight, setKbHeight] = useState(0);
  const [showSessionPicker, setShowSessionPicker] = useState(false);
  const [themeName, setThemeName] = useState("zinc");
  const [isDark, setIsDark] = useState(false);
  const [customColors, setCustomColors] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [bgImage, setBgImage] = useState(null);
  const [bgOpacity, setBgOpacity] = useState(0.6);
  const [editingQuick, setEditingQuick] = useState(null);
  const longPressed = useRef(false);
  const scrollTimerRef = useRef(null);
  const lastActiveTagRef = useRef(-1);

  useEffect(() => { workDirRef.current = workDir; }, [workDir]);

  useEffect(() => { if (status === "connected") setShowSettings(false); }, [status]);

  const basePalette = isDark ? THEME_PALETTES[themeName].dark : THEME_PALETTES[themeName].light;
  const palette = useMemo(() => customColors ? { ...basePalette, ...customColors } : basePalette, [basePalette, customColors]);
  const C = useMemo(() => buildPalette(palette), [palette]);
  const styles = useMemo(() => useStyles(C), [C]);

  useEffect(() => {
    const updateKb = (e) => {
      const h = e?.endCoordinates?.height || 0;
      setKbHeight(h);
      if (h > 0) scrollRef.current?.scrollToEnd({ animated: true });
    };
    const show = Keyboard.addListener("keyboardDidShow", updateKb);
    const change = Keyboard.addListener("keyboardDidChangeFrame", updateKb);
    const hide = Keyboard.addListener("keyboardDidHide", () => setKbHeight(0));
    return () => { show.remove(); change.remove(); hide.remove(); };
  }, []);

  useEffect(() => {
    try {
      AsyncStorage.getItem(STORAGE_KEYS.TOKEN).then((v) => { if (v) setToken(v); }).catch(() => {});
      AsyncStorage.getItem(STORAGE_KEYS.ROOM).then((v) => { if (v) setRoomId(v); }).catch(() => {});
      AsyncStorage.getItem(STORAGE_KEYS.DIR).then((v) => { if (v) setWorkDir(v); }).catch(() => {});
      AsyncStorage.getItem(STORAGE_KEYS.RELAY).then((v) => { if (v) setRelayUrl(v); }).catch(() => {});
      AsyncStorage.getItem(STORAGE_KEYS.THEME).then((v) => { if (v) { const { n, d } = JSON.parse(v); setThemeName(n); setIsDark(d); } }).catch(() => {});
      AsyncStorage.getItem(STORAGE_KEYS.CUSTOM_COLORS).then((v) => { if (v) setCustomColors(JSON.parse(v)); }).catch(() => {});
      AsyncStorage.getItem(STORAGE_KEYS.BG_IMAGE).then((v) => { if (v) setBgImage(v); }).catch(() => {});
      AsyncStorage.getItem(STORAGE_KEYS.BG_OPACITY).then((v) => { if (v) setBgOpacity(parseFloat(v)); }).catch(() => {});
      AsyncStorage.getItem(STORAGE_KEYS.SHOW_STATS).then((v) => { if (v !== null) setShowStats(v === "true"); }).catch(() => {});
      AsyncStorage.getItem(STORAGE_KEYS.QUICK_DIRS).then((v) => { if (v) try {
        const dirs = JSON.parse(v);
        dirs.forEach(d => { if (!d.tabId) d.tabId = genTabId(); });
        setQuickDirs(dirs);
      } catch {} }).catch(() => {});
    } catch (_) {}
  }, []);

  useEffect(() => {
    if (token) AsyncStorage.setItem(STORAGE_KEYS.TOKEN, token).catch(() => {});
    if (roomId) AsyncStorage.setItem(STORAGE_KEYS.ROOM, roomId).catch(() => {});
    if (workDir) AsyncStorage.setItem(STORAGE_KEYS.DIR, workDir).catch(() => {});
    if (relayUrl) AsyncStorage.setItem(STORAGE_KEYS.RELAY, relayUrl).catch(() => {});
    AsyncStorage.setItem(STORAGE_KEYS.THEME, JSON.stringify({ n: themeName, d: isDark })).catch(() => {});
    if (customColors) AsyncStorage.setItem(STORAGE_KEYS.CUSTOM_COLORS, JSON.stringify(customColors)).catch(() => {});
    else AsyncStorage.removeItem(STORAGE_KEYS.CUSTOM_COLORS).catch(() => {});
    if (bgImage) AsyncStorage.setItem(STORAGE_KEYS.BG_IMAGE, bgImage).catch(() => {});
    else AsyncStorage.removeItem(STORAGE_KEYS.BG_IMAGE).catch(() => {});
    AsyncStorage.setItem(STORAGE_KEYS.BG_OPACITY, String(bgOpacity)).catch(() => {});
    AsyncStorage.setItem(STORAGE_KEYS.SHOW_STATS, String(showStats)).catch(() => {});
    try { AsyncStorage.setItem(STORAGE_KEYS.QUICK_DIRS, JSON.stringify(quickDirs)).catch(() => {}); } catch {}
  }, [token, roomId, workDir, relayUrl, themeName, isDark, customColors, bgImage, bgOpacity, showStats, quickDirs]);

  const sendMessage = () => {
    const msg = inputText.trim();
    if (!msg) return;
    if (wsRef.current && wsRef.current.readyState === 1) {
      doSend(msg);
      setInputText("");
    } else {
      enqueue(msg);
      setInputText("");
    }
  };

  const answerQuestion = useCallback((answer) => {
    if (wsRef.current && wsRef.current.readyState === 1) {
      doSend(answer);
    } else {
      enqueue(answer);
    }
  }, [wsRef, doSend, enqueue]);

  const selectSession = (sessionId, title) => {
    setShowSessionPicker(false);
    pendingQueue.current = [];
    setPendingCount(0);
    if (wsRef.current && wsRef.current.readyState === 1) {
      const tabId = activeTabIdRef.current;
      wsRef.current.send(JSON.stringify({ type: P.SELECT_SESSION, tabId, sessionId: sessionId || null, dir: workDir }));
      setMessages([]);
      historyLoadedRef.current.set(tabId, false);
      if (tabMessages.current.has(tabId)) tabMessages.current.delete(tabId);
      wsRef.current.send(JSON.stringify({ type: P.LOAD_HISTORY, tabId, dir: workDir, sessionId: sessionId || null }));
      wsRef.current.send(JSON.stringify({ type: P.LIST_SESSIONS, tabId, dir: workDir }));
    }
    setSessionLabel(title || "(new)");
    setCurrentSessionId(sessionId || null);
    currentSessionIdRef.current = sessionId || null;
    setQuickDirs(prev => prev.map(q =>
      q.path === workDir ? { ...q, sessionId: sessionId || null, sessionLabel: title || null } : q
    ));
  };

  /* ── Tab switching — no disconnect ── */
  const switchToQuickDir = (q, i) => {
    if (!q.path) return;
    Keyboard.dismiss();
    // Save current tab's state
    const prevTabId = activeTabIdRef.current;
    if (prevTabId) {
      tabMessages.current.set(prevTabId, messages);
      tabProcessing.current.set(prevTabId, processing);
    }
    // Switch to new tab
    activeTabIdRef.current = q.tabId;
    lastActiveTagRef.current = i ?? -1;
    setWorkDir(q.path);
    workDirRef.current = q.path;
    setCurrentSessionId(q.sessionId || null);
    currentSessionIdRef.current = q.sessionId || null;
    setSessionLabel(q.sessionLabel || "(auto)");
    // Restore messages & processing
    const targetMsgs = tabMessages.current.get(q.tabId) || [];
    if (targetMsgs.length > 0) restoredFromCacheRef.current = true;
    setMessages(targetMsgs);
    const p = tabProcessing.current.get(q.tabId);
    setProcessing(p !== undefined ? p : false);
    nearBottom.current = true;

    if (wsRef.current?.readyState === 1) {
      wsRef.current.send(JSON.stringify({ type: P.SELECT_SESSION, tabId: q.tabId, sessionId: q.sessionId || null, dir: q.path }));
      if (!historyLoadedRef.current.get(q.tabId) && q.sessionId) {
        wsRef.current.send(JSON.stringify({ type: P.LOAD_HISTORY, tabId: q.tabId, dir: q.path, sessionId: q.sessionId || null }));
      }
      wsRef.current.send(JSON.stringify({ type: P.LIST_SESSIONS, tabId: q.tabId, dir: q.path }));
    }
    if (!wsRef.current || wsRef.current.readyState !== 1) {
      if (!historyLoadedRef.current.get(q.tabId)) autoLoadHistoryRef.current = true;
      pendingSessionRef.current = { sessionId: q.sessionId, sessionLabel: q.sessionLabel, tabId: q.tabId };
      pendingSessionLabelRef.current = q.sessionLabel && q.sessionLabel !== "(auto)" && q.sessionLabel !== "(new)" ? q.sessionLabel : null;
      connectChat(q.path);
    }
  };

  const refreshHistory = () => {
    if (wsRef.current && wsRef.current.readyState === 1) {
      const tabId = activeTabIdRef.current;
      if (tabMessages.current.has(tabId)) tabMessages.current.delete(tabId);
      historyLoadedRef.current.set(tabId, false);
      wsRef.current.send(JSON.stringify({ type: P.LOAD_HISTORY, tabId, dir: workDir, sessionId: currentSessionIdRef.current }));
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} />
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={[styles.statusDot, { backgroundColor: status === "connected" ? "#4ade80" : status === "connecting" ? "#facc15" : "#ef4444" }]} />
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle} numberOfLines={1}>
              {currentSessionId ? sessionLabel || "(unnamed)" : (status === "connected" ? roomId : "Disconnected")}
            </Text>
            <Text style={styles.headerSub} numberOfLines={1}>
              {status === "connected" ? "Connected · " + workDir : status === "connecting" ? "Connecting..." : "Offline"}
            </Text>
          </View>
        </View>
        <TouchableOpacity onPress={refreshHistory} style={[styles.themeBtn, { marginRight: 6 }]} activeOpacity={0.6}>
          <Text style={styles.themeBtnText}>F</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => { if (tabMessages.current.has(activeTabIdRef.current)) tabMessages.current.delete(activeTabIdRef.current); setMessages([]); }} style={[styles.themeBtn, { marginRight: 6 }]} activeOpacity={0.6}>
          <Text style={styles.themeBtnText}>✕</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setShowSettings(true)} style={styles.themeBtn} activeOpacity={0.6}>
          <Text style={styles.themeBtnText}>☰</Text>
        </TouchableOpacity>
      </View>
      {quickDirs.length > 0 && (
        <ScrollView horizontal keyboardShouldPersistTaps="always" showsHorizontalScrollIndicator={false} style={{ backgroundColor: C.cardAlt, maxHeight: 36 }}>
          <View style={{ flexDirection: "row", gap: 4, paddingHorizontal: 10, paddingVertical: 4 }}>
            {quickDirs.map((q, i) => {
              const isActive = q.path === workDir && (
                (status === "connected" && (!q.sessionId || q.sessionId === currentSessionId)) ||
                (status !== "connected" && lastActiveTagRef.current === i)
              );
              return (
              <TouchableOpacity
                key={i}
                style={{
                  paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6,
                  backgroundColor: isActive ? C.accent : C.card
                }}
                onPress={() => switchToQuickDir(q, i)}
                activeOpacity={0.7}
              >
                <Text style={{ color: isActive ? "#fff" : C.text, fontSize: 12, fontWeight: "500" }} numberOfLines={1}>{q.name}</Text>
              </TouchableOpacity>
              );
            })}
          </View>
        </ScrollView>
      )}

      <View style={{ flex: 1 }}>
        <ChatBackground uri={bgImage} opacity={bgOpacity} />
        <ScrollView
          ref={scrollRef}
          style={styles.output}
          contentContainerStyle={styles.outputContent}
          onScroll={(e) => {
            const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
            nearBottom.current = (contentOffset.y + layoutMeasurement.height) >= contentSize.height - 240;
          }}
          scrollEventThrottle={100}
          onContentSizeChange={() => {
            if (nearBottom.current) {
              clearTimeout(scrollTimerRef.current);
              scrollTimerRef.current = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: false }), 100);
            }
          }}
          showsVerticalScrollIndicator={false}
        >
        {messages.length === 0 && (
          <Text style={styles.emptyHint}>Set Token, Room ID and tap Connect</Text>
        )}
        {messages.map((msg, i) => (
          <MessageItem key={msg._id || i} msg={msg} C={C} s={styles} onAnswer={answerQuestion} />
        ))}
        {processing && <ThinkingBar s={styles} />}
        </ScrollView>
      </View>

      <View style={[styles.inputBar, { paddingBottom: insets.bottom + 8 + kbHeight }]}>
        <TextInput
          style={[styles.input, styles.inputInner]}
          placeholder={
            pendingCount > 0
              ? `${pendingCount} message${pendingCount > 1 ? "s" : ""} pending...`
              : status === "connected" ? "Type a message..." : "Not connected"
          }
          placeholderTextColor={C.placeholder}
          value={inputText}
          onChangeText={setInputText}
          multiline
          numberOfLines={4}
          autoCapitalize="none"
          autoCorrect={false}
          editable={status === "connected" || pendingCount > 0}
          onSubmitEditing={sendMessage}
          blurOnSubmit={false}
        />
        {processing ? (
          <TouchableOpacity style={styles.cancelBtn} onPress={cancelTask} activeOpacity={0.7}>
            <Text style={styles.cancelBtnText}>Stop</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.sendBtn, pendingCount === 0 && status !== "connected" && { opacity: 0.3 }]}
            onPress={sendMessage}
            activeOpacity={0.7}
          >
            <Text style={styles.sendBtnText}>{pendingCount > 0 ? "Queue" : "Send"}</Text>
          </TouchableOpacity>
        )}
      </View>

      <SessionPickerModal
        visible={showSessionPicker}
        onClose={() => setShowSessionPicker(false)}
        sessions={sessions}
        currentSessionId={currentSessionId}
        onSelect={selectSession}
        C={C}
        styles={styles}
        insets={insets}
      />

      <SettingsModal
        visible={showSettings}
        onClose={() => setShowSettings(false)}
        status={status}
        sessionLabel={sessionLabel}
        relayUrl={relayUrl} setRelayUrl={setRelayUrl}
        token={token} setToken={setToken}
        roomId={roomId} setRoomId={setRoomId}
        workDir={workDir} setWorkDir={setWorkDir}
        showStats={showStats} setShowStats={setShowStats}
        onConnectPress={() => { if (status === "disconnected") { autoLoadHistoryRef.current = true; connectChat(); } else disconnect(); }}
        onOpenSessions={() => { if (status === "connected") setShowSessionPicker(true); else fetchSessions(() => setShowSessionPicker(true)); }}
        themeName={themeName} setThemeName={setThemeName}
        customColors={customColors} setCustomColors={setCustomColors}
        isDark={isDark} setIsDark={setIsDark}
        palette={palette} C={C} styles={styles} insets={insets}
        quickDirs={quickDirs}
        onSwitchDirPress={(q, i) => { if (longPressed.current) { longPressed.current = false; return; } switchToQuickDir(q, i); setShowSettings(false); }}
        onEditDir={(i) => { longPressed.current = true; setEditingQuick(i); }}
        onDeleteDir={(i) => setQuickDirs(prev => prev.filter((_, j) => j !== i))}
        onAddDir={() => {
          if (quickDirs.length >= 20 || !workDir) return;
          const connectedThisDir = status === "connected" && connectedDirRef.current === workDir;
          setQuickDirs(prev => [...prev, { tabId: genTabId(), name: "Quick" + (prev.length + 1), path: workDir, showStats, sessionId: connectedThisDir ? currentSessionId : null, sessionLabel: connectedThisDir ? sessionLabel : null }]);
        }}
        bgImage={bgImage} setBgImage={setBgImage}
        bgOpacity={bgOpacity} setBgOpacity={setBgOpacity}
      />

      {editingQuick !== null && (
        <QuickDirEditModal
          editingQuick={editingQuick}
          quickDirs={quickDirs}
          onChange={(field, v) => setQuickDirs(prev => prev.map((q, j) => j === editingQuick ? { ...q, [field]: field === "name" ? v.slice(0, 20) : v } : q))}
          onToggle={(field) => setQuickDirs(prev => prev.map((q, j) => j === editingQuick ? { ...q, [field]: !q[field] } : q))}
          onDone={() => setEditingQuick(null)}
          C={C}
          styles={styles}
        />
      )}
    </View>
  );
}

const useStyles = (C) => StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 8, flex: 1 },
  themeBtn: { width: 32, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: C.card, borderWidth: 1, borderColor: C.text2 },
  themeBtnText: { fontSize: 15, color: C.textBright },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  headerTitle: { color: C.textBright, fontSize: 14, fontWeight: "600" },
  headerSub: { color: C.placeholder, fontSize: 11, marginTop: 1 },
  setupInput: { backgroundColor: C.input, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: C.textBright, fontSize: 14 },
  connectBtn: { borderRadius: 8, paddingVertical: 10, alignItems: "center" },
  connectBtnText: { color: "#fff", fontSize: 14, fontWeight: "600" },
  output: { flex: 1 },
  outputContent: { padding: 12 },
  emptyHint: { color: C.placeholder, fontSize: 14, textAlign: "center", marginTop: 40 },
  statusLine: { color: "#737373", fontSize: 13, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", lineHeight: 22 },
  errorLine: { color: "#ef4444", fontSize: 13, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", lineHeight: 22 },
  userBubble: { alignSelf: "flex-end", maxWidth: "88%", backgroundColor: C.accent, borderRadius: 18, borderBottomRightRadius: 3, paddingHorizontal: 14, paddingVertical: 10, marginTop: 4, shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 8, elevation: 2 },
  userBubbleText: { color: "#09090b", fontSize: 16, lineHeight: 24 },
  assistantBubble: { alignSelf: "flex-start", maxWidth: "92%", backgroundColor: C.card, borderRadius: 18, borderBottomLeftRadius: 3, paddingHorizontal: 12, paddingVertical: 6, marginTop: 4, borderWidth: 1, borderColor: C.border },
  thinkingBar: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 4, marginTop: 4 },
  thinkingText: { color: C.placeholder, fontSize: 13, fontStyle: "italic" },
  thinkingDot: { color: C.accent, fontSize: 11, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" },
  inputBar: { flexDirection: "row", alignItems: "flex-end", paddingHorizontal: 10, paddingTop: 8, gap: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.border, backgroundColor: C.cardAlt },
  input: { flex: 1, padding: 4 },
  inputInner: { backgroundColor: C.input, borderWidth: 1, borderColor: C.border, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10, color: C.textBright, fontSize: 15, lineHeight: 22, maxHeight: 120 },
  sendBtn: { width: 52, height: 40, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: C.accent },
  sendBtnText: { color: "#fff", fontSize: 14, fontWeight: "600" },
  cancelBtn: { width: 52, height: 40, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: "#dc2626" },
  cancelBtnText: { color: "#fff", fontSize: 13, fontWeight: "600" },
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border },
  modalTitle: { color: C.textBright, fontSize: 18, fontWeight: "600" },
  modalClose: { color: C.accent, fontSize: 15 },
  sessionItem: { paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border },
  sessionItemActive: { backgroundColor: C.card },
  sessionItemTitle: { color: C.text, fontSize: 14 },
  sessionItemTitleActive: { color: C.accent, fontWeight: "600" },
  sessionItemDate: { color: C.placeholder, fontSize: 11, marginTop: 3 },
  sectionLabel: { color: C.text2, fontSize: 12, fontWeight: "600", marginBottom: 4 },
  themeCard: { borderWidth: 1, borderColor: C.border, borderRadius: 10, padding: 10, width: "47%" },
  themeCardActive: { borderColor: C.accent, borderWidth: 2 },
  colorInput: { backgroundColor: C.input, borderWidth: 1, borderColor: C.border, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6, color: C.textBright, fontSize: 13, flex: 1 },
});
