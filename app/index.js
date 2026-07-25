import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import {
  View,
  Text,
  TextInput,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Platform,
  Keyboard,
  Modal,
  FlatList,
  AppState,
  StatusBar,
  Alert,
  Image,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Slider from "@react-native-community/slider";
import MarkdownBlock from "./components/MarkdownBlock";
import * as ImagePicker from "expo-image-picker";

const THEME_PALETTES = {
  zinc: {
    name: "Zinc", desc: "翡翠绿 · 专业中性",
    dark: { bg: "#09090b", text: "#fafafa", accent: "#34d399", text2: "#a1a1aa" },
    light: { bg: "#fafafa", text: "#3f3f46", accent: "#10b981", text2: "#a1a1aa" },
  },
  slate: {
    name: "Slate", desc: "湛蓝 · 冷静克制",
    dark: { bg: "#020617", text: "#f8fafc", accent: "#60a5fa", text2: "#94a3b8" },
    light: { bg: "#f8fafc", text: "#334155", accent: "#3b82f6", text2: "#94a3b8" },
  },
  forest: {
    name: "Forest", desc: "森林绿 · 自然深邃",
    dark: { bg: "#052e16", text: "#f0fdf4", accent: "#22c55e", text2: "#86efac" },
    light: { bg: "#f0fdf4", text: "#166534", accent: "#16a34a", text2: "#4ade80" },
  },
  rose: {
    name: "Rose", desc: "玫瑰红 · 温暖大胆",
    dark: { bg: "#1f0a0c", text: "#fff1f2", accent: "#fb7185", text2: "#fda4af" },
    light: { bg: "#fff1f2", text: "#881337", accent: "#e11d48", text2: "#e11d48" },
  },
  amber: {
    name: "Amber", desc: "琥珀黄 · 温暖明亮",
    dark: { bg: "#1c1402", text: "#fffbeb", accent: "#fbbf24", text2: "#fde68a" },
    light: { bg: "#fffbeb", text: "#78350f", accent: "#d97706", text2: "#b45309" },
  },
};

function hexToRgb(h) { return { r: parseInt(h.slice(1,3),16), g: parseInt(h.slice(3,5),16), b: parseInt(h.slice(5,7),16) }; }
function rgbToHex(r,g,b) { return `#${Math.min(255,Math.max(0,Math.round(r))).toString(16).padStart(2,"0")}${Math.min(255,Math.max(0,Math.round(g))).toString(16).padStart(2,"0")}${Math.min(255,Math.max(0,Math.round(b))).toString(16).padStart(2,"0")}`; }
function lighten(h, amt) { const c=hexToRgb(h); return rgbToHex(c.r+amt, c.g+amt, c.b+amt); }
function darken(h, amt) { const c=hexToRgb(h); return rgbToHex(c.r-amt, c.g-amt, c.b-amt); }
function isLightHex(h) { const c=hexToRgb(h); return c.r*0.299 + c.g*0.587 + c.b*0.114 > 160; }

function buildPalette(p) {
  const light = isLightHex(p.bg);
  return {
    bg: p.bg, text: p.text, accent: p.accent, text2: p.text2,
    card: light ? lighten(p.bg, 20) : lighten(p.bg, 12),
    cardAlt: light ? lighten(p.bg, 12) : lighten(p.bg, 8),
    textBright: p.text,
    border: light ? `rgba(0,0,0,0.08)` : `rgba(255,255,255,0.08)`,
    input: light ? darken(p.bg, 6) : lighten(p.bg, 8),
    placeholder: light ? "rgba(0,0,0,0.35)" : "rgba(255,255,255,0.35)",
    accentLight: light ? darken(p.accent, 10) : lighten(p.accent, 20),
    codeBg: light ? `rgba(0,0,0,0.04)` : `rgba(0,0,0,0.15)`,
    shadow: light ? "0 1px 3px rgba(0,0,0,0.04)" : "0 1px 3px rgba(0,0,0,0.2)",
  };
}

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

function QuestionBlock({ questionData, beforeText, onAnswer }) {
  const [answered, setAnswered] = useState(false);

  const handleAnswer = (label) => {
    if (answered) return;
    setAnswered(true);
    onAnswer(label);
  };

  return (
    <View style={styles.questionContainer}>
      {beforeText ? <MarkdownBlock text={beforeText} C={C} /> : null}
      {questionData.questions.map((q, qi) => {
        const options = Array.isArray(q.options) ? q.options : [];
        return (
          <View key={qi} style={styles.questionGroup}>
            {q.header ? <Text style={styles.questionHeader}>{q.header}</Text> : null}
            {q.question ? <Text style={styles.questionText}>{q.question}</Text> : null}
            {options.map((opt, oi) => (
              <TouchableOpacity
                key={oi}
                style={[styles.optionBtn, answered && styles.optionBtnUsed]}
                onPress={() => handleAnswer(opt.label)}
                activeOpacity={0.7}
                disabled={answered}
              >
                <Text style={styles.optionLabel}>{opt.label}</Text>
                {opt.description ? <Text style={styles.optionDesc}>{opt.description}</Text> : null}
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
};

const DEFAULT_RELAY = "wss://localhost:8766/vibecoding/ws";

export default function ChatScreen() {
  const insets = useSafeAreaInsets();
  const scrollRef = useRef(null);
  const wsRef = useRef(null);

  const [token, setToken] = useState("");
  const [roomId, setRoomId] = useState("");
  const [workDir, setWorkDir] = useState("");
  const [relayUrl, setRelayUrl] = useState("");
  const [status, setStatus] = useState("disconnected");
  const [processing, setProcessing] = useState(false);
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState("");
  const [kbHeight, setKbHeight] = useState(0);
  const [spinner, setSpinner] = useState(0);
  const historyLoadedRef = useRef(false);
  const intentionalDisconnect = useRef(false);
  const connectRef = useRef(null);
  const reconnectTimer = useRef(null);
  const appStateReady = useRef(false);
  const connIntent = useRef({ auto: false, restoreProcessing: false });
  const retryCount = useRef(0);

  const getReconnectDelay = () => {
    const n = retryCount.current;
    if (n < 10) return 1000;
    return Math.min(1000 * Math.pow(2, n - 10), 30000);
  };

  useEffect(() => {
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
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

  const [sessions, setSessions] = useState([]);
  const [currentSessionId, setCurrentSessionId] = useState(null);
  const [showSessionPicker, setShowSessionPicker] = useState(false);
  const [sessionLabel, setSessionLabel] = useState("(auto)");
  const [pendingCount, setPendingCount] = useState(0);
  const pendingQueue = useRef([]);
  const [themeName, setThemeName] = useState("zinc");
  const [isDark, setIsDark] = useState(false);
  const [customColors, setCustomColors] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [bgImage, setBgImage] = useState(null);
  const [bgOpacity, setBgOpacity] = useState(0.6);

  const basePalette = isDark ? THEME_PALETTES[themeName].dark : THEME_PALETTES[themeName].light;
  const palette = customColors ? { ...basePalette, ...customColors } : basePalette;
  const C = useMemo(() => buildPalette(palette), [palette]);
  const styles = useMemo(() => useStyles(C), [C]);

  const doSend = (text) => {
    if (!wsRef.current || wsRef.current.readyState !== 1) return;
    wsRef.current.send(JSON.stringify({ type: "msg", dir: workDir, msg: text }));
    addMessage({ type: "user", text: `${text}` });
    setProcessing(true);
  };

  const enqueue = (text) => {
    pendingQueue.current.push(text);
    setPendingCount(pendingQueue.current.length);
  };

  const flushQueue = () => {
    const q = pendingQueue.current;
    if (q.length === 0) return;
    pendingQueue.current = [];
    setPendingCount(0);
    for (const text of q) {
      doSend(text);
    }
  };

  const SPINNER_FRAMES = ["|", "/", "-", "\\"];

  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", (e) => {
      setKbHeight(e.endCoordinates.height);
      scrollRef.current?.scrollToEnd({ animated: true });
    });
    const hide = Keyboard.addListener("keyboardDidHide", () => {
      setKbHeight(0);
    });
    return () => { show.remove(); hide.remove(); };
  }, []);

  useEffect(() => {
    if (!processing) return;
    const t = setInterval(() => setSpinner(s => (s + 1) % SPINNER_FRAMES.length), 100);
    return () => clearInterval(t);
  }, [processing]);

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
    } catch (_) {}
  }, []);

  useEffect(() => {
    if (token) AsyncStorage.setItem(STORAGE_KEYS.TOKEN, token);
  }, [token]);

  useEffect(() => {
    if (roomId) AsyncStorage.setItem(STORAGE_KEYS.ROOM, roomId);
  }, [roomId]);

  useEffect(() => {
    if (workDir) AsyncStorage.setItem(STORAGE_KEYS.DIR, workDir);
  }, [workDir]);

  useEffect(() => {
    if (relayUrl) AsyncStorage.setItem(STORAGE_KEYS.RELAY, relayUrl);
  }, [relayUrl]);

  useEffect(() => {
    AsyncStorage.setItem(STORAGE_KEYS.THEME, JSON.stringify({ n: themeName, d: isDark }));
  }, [themeName, isDark]);

  useEffect(() => {
    if (customColors) {
      AsyncStorage.setItem(STORAGE_KEYS.CUSTOM_COLORS, JSON.stringify(customColors));
    } else {
      AsyncStorage.removeItem(STORAGE_KEYS.CUSTOM_COLORS);
    }
  }, [customColors]);

  useEffect(() => {
    if (bgImage) {
      AsyncStorage.setItem(STORAGE_KEYS.BG_IMAGE, bgImage);
    } else {
      AsyncStorage.removeItem(STORAGE_KEYS.BG_IMAGE);
    }
  }, [bgImage]);

  useEffect(() => {
    AsyncStorage.setItem(STORAGE_KEYS.BG_OPACITY, String(bgOpacity));
  }, [bgOpacity]);

  const addMessage = useCallback((msg) => {
    setMessages((prev) => {
      if (msg.type === "status" && (msg.text === "--- Connected ---" || msg.text === "--- PC online ---")) {
        // Clear stale failure messages, don't add the success banner itself
        return prev.filter(m =>
          !(m.type === "error" && m.text === "Connection failed") &&
          !(m.type === "status" && m.text === "--- Disconnected ---") &&
          !(m.type === "status" && m.text === "--- PC offline ---")
        );
      }
      // Dedup consecutive "--- Disconnected ---"
      if (msg.type === "status" && msg.text === "--- Disconnected ---") {
        const last = prev[prev.length - 1];
        if (last && last.type === "status" && last.text === "--- Disconnected ---") return prev;
      }
      const last = prev[prev.length - 1];
      if (msg.type === "chunk" && last && last.type === "chunk") {
        return [...prev.slice(0, -1), { ...last, text: last.text + msg.text }];
      }
      return [...prev, msg];
    });
  }, []);

  /* ---- connection lifecycle ---- */

  const connect = () => {
    if (!roomId.trim() || !token.trim()) return;

    // Capture intent before any side effects
    const isReconnect = !intentionalDisconnect.current && historyLoadedRef.current;
    connIntent.current = { auto: isReconnect, restoreProcessing: isReconnect && processing };

    // Cleanup old connection; suppress its onclose from spawning a new timer
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
      retryCount.current = 0;
      setStatus("connected");
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
        reconnectTimer.current = null;
      }
      if (connIntent.current.auto) {
        if (connIntent.current.restoreProcessing) setProcessing(true);
        addMessage({ type: "status", text: "--- Connected ---" });
      } else {
        setMessages([]);
        historyLoadedRef.current = false;
        addMessage({ type: "status", text: "--- Connected ---" });
      }
      flushQueue();
    };

    ws.onclose = () => {
      if (wsRef.current !== ws) return;
      wsRef.current = null;
      setStatus("disconnected");
      addMessage({ type: "status", text: "--- Disconnected ---" });
      if (!intentionalDisconnect.current && AppState.currentState === "active") {
        const delay = getReconnectDelay();
        retryCount.current++;
        reconnectTimer.current = setTimeout(() => connectRef.current?.(), delay);
      }
    };

    ws.onerror = () => {
      if (wsRef.current !== ws) return;
      addMessage({ type: "error", text: "Connection failed" });
    };

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === "status") {
          if (msg.online) {
            addMessage({ type: "status", text: "--- PC online ---" });
            if (!historyLoadedRef.current) {
              ws.send(JSON.stringify({ type: "load_history", dir: workDir }));
            }
            ws.send(JSON.stringify({ type: "list_sessions", dir: workDir }));
          } else {
            addMessage({ type: "status", text: "--- PC offline ---" });
            setProcessing(false);
          }
        } else if (msg.type === "chunk") {
          addMessage(msg);
        } else if (msg.type === "done") {
          setProcessing(false);
          addMessage({ type: "status", text: `--- Done (exit ${msg.code}) ---` });
        } else if (msg.type === "cancelled") {
          setProcessing(false);
          addMessage({ type: "status", text: "--- Cancelled ---" });
        } else if (msg.type === "error") {
          setProcessing(false);
          addMessage({ type: "error", text: msg.text });
        } else if (msg.type === "processing") {
          setProcessing(true);
        } else if (msg.type === "history") {
          console.log("[app] history received, rounds:", msg.rounds?.length);
          historyLoadedRef.current = true;
          setMessages([]);
          if (msg.rounds && Array.isArray(msg.rounds)) {
            msg.rounds.forEach((r, idx) => {
              if (idx > 0) addMessage({ type: "spacer" });
              addMessage({ type: "history-user", text: r.user });
              addMessage({ type: "history-assistant", text: r.assistant });
            });
            addMessage({ type: "status", text: "--- History loaded ---" });
          }
        } else if (msg.type === "sessions") {
          setSessions(msg.sessions || []);
          setCurrentSessionId(msg.current || null);
          if (!msg.current) {
            setSessionLabel("(new)");
          } else {
            const cur = (msg.sessions || []).find(s => s.id === msg.current);
            setSessionLabel(cur ? (cur.title || "(unnamed)") : "(auto)");
          }
        }
      } catch (err) {
        console.warn("[ws] parse error:", err.message);
      }
    };
  };
  connectRef.current = connect;

  const disconnect = () => {
    retryCount.current = 0;
    intentionalDisconnect.current = true;
    if (pendingQueue.current.length > 0) {
      pendingQueue.current = [];
      setPendingCount(0);
      addMessage({ type: "status", text: "--- Pending messages cancelled ---" });
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
  };

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

  const cancelTask = () => {
    if (wsRef.current && wsRef.current.readyState === 1) {
      wsRef.current.send(JSON.stringify({ type: "cancel" }));
    }
  };

  const answerQuestion = useCallback((answer) => {
    if (wsRef.current && wsRef.current.readyState === 1) {
      doSend(answer);
    } else {
      enqueue(answer);
    }
  }, [workDir]);

  const selectSession = (sessionId, title) => {
    setShowSessionPicker(false);
    pendingQueue.current = [];
    setPendingCount(0);
    if (wsRef.current && wsRef.current.readyState === 1) {
      wsRef.current.send(JSON.stringify({ type: "select_session", sessionId: sessionId || null, dir: workDir }));
      setMessages([]);
      historyLoadedRef.current = false;
      wsRef.current.send(JSON.stringify({ type: "load_history", dir: workDir }));
      wsRef.current.send(JSON.stringify({ type: "list_sessions", dir: workDir }));
    }
    setSessionLabel(title || "(new)");
    setCurrentSessionId(sessionId || null);
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
            <Text style={styles.headerSub}>
              {status === "connected" ? "Connected · opencode" : status === "connecting" ? "Connecting..." : "Offline"}
            </Text>
          </View>
        </View>
        <TouchableOpacity onPress={() => setShowSettings(true)} style={styles.themeBtn} activeOpacity={0.6}>
          <Text style={styles.themeBtnText}>☰</Text>
        </TouchableOpacity>
      </View>

      <View style={{ flex: 1 }}>
        {bgImage ? <Image source={{ uri: bgImage }} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, opacity: bgOpacity }} resizeMode="cover" /> : null}
        <ScrollView
          ref={scrollRef}
          style={styles.output}
          contentContainerStyle={styles.outputContent}
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
          showsVerticalScrollIndicator={false}
        >
        {messages.length === 0 && (
          <Text style={styles.emptyHint}>Set Token, Room ID and tap Connect</Text>
        )}
        {messages.map((msg, i) => {
          if (msg.type === "status") {
            return (
              <TouchableOpacity key={i} activeOpacity={1.0}>
                <Text style={styles.statusLine}>{msg.text}</Text>
              </TouchableOpacity>
            );
          }
          if (msg.type === "error") {
            return (
              <TouchableOpacity key={i} activeOpacity={1.0}>
                <Text style={styles.errorLine}>{msg.text}</Text>
              </TouchableOpacity>
            );
          }
          if (msg.type === "user" || msg.type === "history-user") {
            return (
              <View key={i} style={styles.userBubble}>
                <Text style={styles.userBubbleText} selectable>{msg.text}</Text>
              </View>
            );
          }
          if (msg.type === "chunk" || msg.type === "history-assistant") {
            const parsed = tryParseQuestion(msg.text);
            const questions = parsed && Array.isArray(parsed.data.questions) ? parsed.data.questions : null;
            if (questions && questions.length > 0) {
              return <QuestionBlock key={i} questionData={parsed.data} beforeText={parsed.before} onAnswer={answerQuestion} C={C} />;
            }
            return (
              <View key={i} style={styles.assistantBubble}>
                <MarkdownBlock text={msg.text} C={C} />
              </View>
            );
          }
          if (msg.type === "spacer") {
            return <View key={i} style={{ height: 16 }} />;
          }
          return (
            <View key={i} style={styles.assistantBubble}>
              <MarkdownBlock text={msg.text} C={C} />
            </View>
          );
        })}
        {processing && (
          <View style={styles.thinkingBar}>
            <Text style={styles.thinkingText}>Thinking...</Text>
            <Text style={styles.thinkingDot}>{SPINNER_FRAMES[spinner]}</Text>
          </View>
        )}
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
      <Modal
        visible={showSessionPicker}
        animationType="slide"
        transparent={false}
        onRequestClose={() => setShowSessionPicker(false)}
      >
        <View style={{ flex: 1, backgroundColor: C.cardAlt, paddingTop: insets.top }}>
          <TouchableOpacity style={styles.modalHeader} onPress={() => setShowSessionPicker(false)} activeOpacity={0.7}>
            <Text style={styles.modalTitle}>Sessions</Text>
            <Text style={styles.modalClose}>Close</Text>
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <TouchableOpacity
              style={[styles.sessionItem, !currentSessionId && styles.sessionItemActive]}
              onPress={() => selectSession(null, null)}
              activeOpacity={0.7}
            >
              <Text style={[styles.sessionItemTitle, !currentSessionId && styles.sessionItemTitleActive]}>+ New session</Text>
            </TouchableOpacity>
            <FlatList
              data={sessions}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.sessionItem, currentSessionId === item.id && styles.sessionItemActive]}
                  onPress={() => selectSession(item.id, item.title)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.sessionItemTitle, currentSessionId === item.id && styles.sessionItemTitleActive]} numberOfLines={1}>
                    {item.title || "(unnamed)"}
                  </Text>
                  <Text style={styles.sessionItemDate}>
                    {new Date(item.updated).toLocaleDateString()}
                  </Text>
                </TouchableOpacity>
              )}
            />
          </View>
        </View>
      </Modal>

      {/* ── Settings Modal ── */}
      <Modal
        visible={showSettings}
        animationType="slide"
        transparent={false}
        onRequestClose={() => setShowSettings(false)}
      >
        <View style={{ flex: 1, backgroundColor: C.cardAlt, paddingTop: insets.top }}>
          <TouchableOpacity style={styles.modalHeader} onPress={() => setShowSettings(false)} activeOpacity={0.7}>
            <Text style={styles.modalTitle}>Settings</Text>
            <Text style={styles.modalClose}>Done</Text>
          </TouchableOpacity>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, paddingBottom: 40 + insets.bottom }}>
            <Text style={styles.sectionLabel}>Connection</Text>
              <View style={{ height: 8 }} />
              <TextInput style={styles.setupInput} placeholder="Relay URL" placeholderTextColor={C.placeholder} value={relayUrl} onChangeText={setRelayUrl} autoCapitalize="none" autoCorrect={false} />
              <View style={{ height: 8 }} />
              <TextInput style={styles.setupInput} placeholder="Token" placeholderTextColor={C.placeholder} value={token} onChangeText={setToken} autoCapitalize="none" autoCorrect={false} secureTextEntry />
              <View style={{ height: 8 }} />
              <TextInput style={styles.setupInput} placeholder="Room ID" placeholderTextColor={C.placeholder} value={roomId} onChangeText={setRoomId} autoCapitalize="none" autoCorrect={false} />
              <View style={{ height: 8 }} />
              <TextInput style={styles.setupInput} placeholder="Work dir" placeholderTextColor={C.placeholder} value={workDir} onChangeText={setWorkDir} autoCapitalize="none" autoCorrect={false} />
              <View style={{ height: 8 }} />
                <TouchableOpacity style={[styles.connectBtn, { backgroundColor: status === "connected" ? "#dc2626" : C.accent }, status === "connecting" && { opacity: 0.5 }]} onPress={status === "connected" ? disconnect : connect} disabled={status === "connecting"} activeOpacity={0.8}>
                  <Text style={styles.connectBtnText}>{status === "connected" ? "Disconnect" : status === "connecting" ? "Connecting..." : "Connect"}</Text>
                </TouchableOpacity>
                {status === "connected" && (
                  <TouchableOpacity style={[styles.connectBtn, { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, marginTop: 8 }]} onPress={() => setShowSessionPicker(true)} activeOpacity={0.7}>
                    <Text style={[styles.connectBtnText, { color: C.text }]}>Session: {sessionLabel}</Text>
                  </TouchableOpacity>
                )}

              <View style={{ height: 24 }} />
              <Text style={styles.sectionLabel}>Theme</Text>
              <View style={{ height: 8 }} />
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {Object.entries(THEME_PALETTES).map(([key, t]) => (
                  <TouchableOpacity key={key} style={[styles.themeCard, !customColors && themeName === key && styles.themeCardActive]} onPress={() => { setThemeName(key); setCustomColors(null); }} activeOpacity={0.7}>
                    <View style={{ flexDirection: "row", gap: 3, marginBottom: 4 }}>
                      {[t.dark.bg, t.dark.text, t.dark.accent, t.dark.text2].map((c, i) => (
                        <View key={i} style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: c }} />
                      ))}
                    </View>
                    <Text style={{ color: C.text, fontSize: 12, fontWeight: "500" }}>{t.name}</Text>
                    <Text style={{ color: C.placeholder, fontSize: 10, marginTop: 1 }}>{t.desc}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <View style={{ height: 24 }} />
              <Text style={styles.sectionLabel}>Mode</Text>
              <View style={{ height: 8 }} />
              <View style={{ flexDirection: "row", borderRadius: 8, overflow: "hidden", borderWidth: 1, borderColor: C.border }}>
                {["dark", "light"].map(m => (
                  <TouchableOpacity key={m} style={{ flex: 1, paddingVertical: 10, alignItems: "center", backgroundColor: (isDark ? m === "dark" : m === "light") ? C.accent : "transparent" }} onPress={() => setIsDark(m === "dark")} activeOpacity={0.7}>
                    <Text style={{ color: (isDark ? m === "dark" : m === "light") ? "#fff" : C.text, fontSize: 13, fontWeight: "500" }}>{m === "dark" ? "Dark" : "Light"}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <View style={{ height: 24 }} />
              <Text style={styles.sectionLabel}>Custom Colors</Text>
              <Text style={{ color: C.placeholder, fontSize: 11, marginTop: 2, marginBottom: 8 }}>Override base colors</Text>
              {["bg", "text", "accent", "text2"].map(key => (
                <View key={key} style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 6 }}>
                  <Text style={{ color: C.text2, fontSize: 12, width: 52 }}>{key}</Text>
                  <View style={{ width: 24, height: 24, borderRadius: 6, backgroundColor: /^#[0-9a-fA-F]{6}$/.test(customColors?.[key]) ? customColors[key] : palette[key], borderWidth: 1, borderColor: C.border }} />
                  <TextInput style={styles.colorInput} value={customColors?.[key] !== undefined ? customColors[key] : palette[key]} onChangeText={(v) => setCustomColors(prev => ({ ...(prev || {}), [key]: v }))} placeholder="#hex" placeholderTextColor={C.placeholder} autoCapitalize="none" />
                  <TouchableOpacity onPress={() => { const n = { ...(customColors || {}) }; delete n[key]; if (Object.keys(n).length === 0) setCustomColors(null); else setCustomColors(n); }} activeOpacity={0.6}>
                    <Text style={{ color: C.accent, fontSize: 11 }}>Reset</Text>
                  </TouchableOpacity>
                </View>
              ))}

              <View style={{ height: 24 }} />
              <Text style={styles.sectionLabel}>Chat Background</Text>
              <View style={{ height: 8 }} />
              <TouchableOpacity style={[styles.connectBtn, { backgroundColor: C.card, borderWidth: 1, borderColor: C.border }]} onPress={async () => { if (bgImage) { setBgImage(null); return; } const perm = await ImagePicker.requestMediaLibraryPermissionsAsync(); if (!perm.granted) { Alert.alert("Permission needed", "Allow photo access in Settings to set a chat background."); return; } const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8, base64: false }); if (!result.canceled && result.assets?.[0]) setBgImage(result.assets[0].uri); }} activeOpacity={0.7}>
                <Text style={[styles.connectBtnText, { color: C.text }]}>{bgImage ? "Remove Background" : "Set Background Image"}</Text>
              </TouchableOpacity>
              {bgImage && (
                <View style={{ marginTop: 6 }}>
                  <Text style={{ color: C.text2, fontSize: 11, marginBottom: 2 }}>Opacity: {Math.round(bgOpacity * 100)}%</Text>
                  <Slider style={{ width: "100%", height: 32 }} minimumValue={0.01} maximumValue={1} step={0.01} value={bgOpacity} onValueChange={setBgOpacity} minimumTrackTintColor={C.accent} maximumTrackTintColor={C.border} thumbTintColor={C.accent} />
                </View>
              )}
            </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const useStyles = (C) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.bg,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.border,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flex: 1,
  },
  themeBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
  },
  themeBtnText: {
    fontSize: 15,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  headerTitle: {
    color: C.textBright,
    fontSize: 14,
    fontWeight: "600",
  },
  headerSub: {
    color: C.placeholder,
    fontSize: 11,
    marginTop: 1,
  },
  setupInput: {
    backgroundColor: C.input,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: C.textBright,
    fontSize: 14,
  },
  connectBtn: {
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center",
  },
  connectBtnText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },
  output: {
    flex: 1,
  },
  outputContent: {
    padding: 12,
  },
  emptyHint: {
    color: C.placeholder,
    fontSize: 14,
    textAlign: "center",
    marginTop: 40,
  },
  statusLine: {
    color: "#737373",
    fontSize: 13,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    lineHeight: 20,
  },
  errorLine: {
    color: "#ef4444",
    fontSize: 13,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    lineHeight: 20,
  },
  userBubble: {
    alignSelf: "flex-end",
    maxWidth: "88%",
    backgroundColor: C.accent,
    borderRadius: 18,
    borderBottomRightRadius: 3,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginTop: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 2,
  },
  userBubbleText: {
    color: isLightHex(C.bg) ? "#09090b" : "#fff",
    fontSize: 15,
    lineHeight: 22,
  },
  assistantBubble: {
    alignSelf: "flex-start",
    maxWidth: "92%",
    backgroundColor: C.card,
    borderRadius: 18,
    borderBottomLeftRadius: 3,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginTop: 4,
    borderWidth: 1,
    borderColor: C.border,
    overflow: "hidden",
  },

  inputBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: 12,
    paddingTop: 8,
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: C.border,
    backgroundColor: C.bg,
  },
  input: {
    flex: 1,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
  },
  inputInner: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: C.textBright,
    fontSize: 14,
    textAlignVertical: "top",
  },
  sendBtn: {
    backgroundColor: C.accent,
    borderRadius: 12,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  sendBtnText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },
  cancelBtn: {
    backgroundColor: "#dc2626",
    borderRadius: 12,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  cancelBtnText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },
  thinkingBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 6,
    gap: 8,
  },
  thinkingDot: {
    color: C.text,
    fontSize: 16,
    fontFamily: "monospace",
  },
  thinkingText: {
    color: C.placeholder,
    fontSize: 14,
    fontStyle: "italic",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "flex-end",
  },
  modalContent: {
    backgroundColor: C.cardAlt,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: "60%",
    paddingBottom: 20,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.border,
  },
  modalTitle: {
    color: C.textBright,
    fontSize: 16,
    fontWeight: "600",
  },
  modalClose: {
    color: C.text,
    fontSize: 14,
  },
  sessionItem: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.border,
  },
  sessionItemActive: {
    backgroundColor: C.border,
  },
  sessionItemTitle: {
    color: C.textBright,
    fontSize: 14,
    fontWeight: "500",
  },
  sessionItemTitleActive: {
    color: C.accentLight,
  },
  sessionItemDate: {
    color: C.placeholder,
    fontSize: 12,
    marginTop: 4,
  },
  questionContainer: {
    marginVertical: 8,
  },
  questionGroup: {
    gap: 4,
  },
  questionHeader: {
    color: "#facc15",
    fontSize: 13,
    fontWeight: "600",
    marginBottom: 2,
  },
  questionText: {
    color: C.textBright,
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 8,
  },
  optionBtn: {
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginTop: 6,
  },
  optionBtnUsed: {
    opacity: 0.5,
  },
  optionLabel: {
    color: C.accentLight,
    fontSize: 14,
    fontWeight: "500",
  },
  optionDesc: {
    color: C.text,
    fontSize: 12,
    marginTop: 3,
    lineHeight: 17,
  },
  sectionLabel: {
    color: C.text2,
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  themeCard: {
    width: "47%",
    padding: 10,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: "transparent",
    backgroundColor: C.card,
  },
  themeCardActive: {
    borderColor: C.accent,
  },
  colorInput: {
    flex: 1,
    backgroundColor: C.input,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    color: C.textBright,
    fontSize: 12,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
});
