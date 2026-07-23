import { useState, useRef, useCallback, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
  Modal,
  FlatList,
  AppState,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import MarkdownBlock from "./components/MarkdownBlock";

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
      {beforeText ? <MarkdownBlock text={beforeText} /> : null}
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
  const [showSetup, setShowSetup] = useState(true);
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

  const addMessage = useCallback((msg) => {
    setMessages((prev) => {
      if (msg.type === "status" && (msg.text === "--- Connected ---" || msg.text === "--- PC online ---")) {
        // Clear stale failure messages, don't add the success banner itself
        return prev.filter(m =>
          !(m.type === "error" && m.text === "Connection failed") &&
          !(m.type === "status" && m.text === "--- Disconnected ---")
        );
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
    setShowSetup(false);

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
    };

    ws.onclose = () => {
      if (wsRef.current !== ws) return;
      wsRef.current = null;
      setStatus("disconnected");
      addMessage({ type: "status", text: "--- Disconnected ---" });
      if (!intentionalDisconnect.current && AppState.currentState === "active") {
        const delay = getReconnectDelay();
        retryCount.current++;
        reconnectTimer.current = setTimeout(connect, delay);
      }
    };

    ws.onerror = () => {
      if (wsRef.current !== ws) return;
      wsRef.current = null;
      setStatus("disconnected");
      addMessage({ type: "error", text: "Connection failed" });
      if (!intentionalDisconnect.current && AppState.currentState === "active") {
        const delay = getReconnectDelay();
        retryCount.current++;
        reconnectTimer.current = setTimeout(connect, delay);
      }
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
          historyLoadedRef.current = true;
          if (msg.rounds && Array.isArray(msg.rounds)) {
            msg.rounds.forEach((r, idx) => {
              if (idx > 0) addMessage({ type: "spacer" });
              addMessage({ type: "history-user", text: `> ${r.user}` });
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
            setSessionLabel(cur ? cur.title : "(auto)");
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
    if (!msg || status !== "connected") return;

    if (wsRef.current && wsRef.current.readyState === 1) {
      wsRef.current.send(JSON.stringify({
        type: "msg",
        dir: workDir,
        msg,
      }));
      addMessage({ type: "user", text: `> ${msg}` });
      setInputText("");
      setProcessing(true);
    }
  };

  const cancelTask = () => {
    if (wsRef.current && wsRef.current.readyState === 1) {
      wsRef.current.send(JSON.stringify({ type: "cancel" }));
    }
  };

  const answerQuestion = useCallback((answer) => {
    if (wsRef.current && wsRef.current.readyState === 1) {
      wsRef.current.send(JSON.stringify({ type: "msg", dir: workDir, msg: answer }));
      addMessage({ type: "user", text: `> ${answer}` });
      setProcessing(true);
    }
  }, [workDir]);

  const selectSession = (sessionId, title) => {
    setShowSessionPicker(false);
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

  const Wrapper = Platform.OS === "ios" ? KeyboardAvoidingView : View;
  const wrapperProps = Platform.OS === "ios" ? { behavior: "padding", keyboardVerticalOffset: 0 } : {};

  return (
    <Wrapper
      style={[styles.container, { paddingTop: insets.top }]}
      {...wrapperProps}
    >
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.headerToggle}
          onPress={() => setShowSetup(!showSetup)}
          activeOpacity={0.7}
        >
          <View style={[styles.statusDot, { backgroundColor: status === "connected" ? "#4ade80" : status === "connecting" ? "#facc15" : "#ef4444" }]} />
          <Text style={styles.headerTitle} numberOfLines={1}>
            {status === "connected" ? roomId : "Disconnected"}
          </Text>
        </TouchableOpacity>
      </View>

      {showSetup && (
        <View style={styles.setupBar}>
          <TextInput
            style={styles.setupInput}
            placeholder="Relay URL (default: wss://localhost:8766/vibecoding/ws)"
            placeholderTextColor="#525252"
            value={relayUrl}
            onChangeText={setRelayUrl}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TextInput
            style={styles.setupInput}
            placeholder="Token"
            placeholderTextColor="#525252"
            value={token}
            onChangeText={setToken}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
          />
          <TextInput
            style={styles.setupInput}
            placeholder="Room ID"
            placeholderTextColor="#525252"
            value={roomId}
            onChangeText={setRoomId}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TextInput
            style={styles.setupInput}
              placeholder="Work dir (e.g. /mnt/c/Users/YOU/projects)"
            placeholderTextColor="#525252"
            value={workDir}
            onChangeText={setWorkDir}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TouchableOpacity
            style={[
              styles.connectBtn,
              { backgroundColor: status === "connected" ? "#dc2626" : "#2563eb" },
              status === "connecting" && { opacity: 0.5 },
            ]}
            onPress={status === "connected" ? disconnect : connect}
            disabled={status === "connecting"}
            activeOpacity={0.8}
          >
            <Text style={styles.connectBtnText}>
              {status === "connected" ? "Disconnect" : status === "connecting" ? "Connecting..." : "Connect"}
            </Text>
          </TouchableOpacity>
          {status === "connected" && (
            <TouchableOpacity
              style={styles.sessionBtn}
              onPress={() => setShowSessionPicker(true)}
              activeOpacity={0.7}
            >
              <Text style={styles.sessionBtnLabel}>Session</Text>
              <Text style={styles.sessionBtnValue} numberOfLines={1}>{sessionLabel}</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

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
              <TouchableOpacity key={i} activeOpacity={1.0}>
                <Text style={styles.userLine} selectable>{msg.text}</Text>
              </TouchableOpacity>
            );
          }
          if (msg.type === "chunk" || msg.type === "history-assistant") {
            const parsed = tryParseQuestion(msg.text);
            const questions = parsed && Array.isArray(parsed.data.questions) ? parsed.data.questions : null;
            if (questions && questions.length > 0) {
              return <QuestionBlock key={i} questionData={parsed.data} beforeText={parsed.before} onAnswer={answerQuestion} />;
            }
            return <MarkdownBlock key={i} text={msg.text} />;
          }
          if (msg.type === "spacer") {
            return <View key={i} style={{ height: 16 }} />;
          }
          return <MarkdownBlock key={i} text={msg.text} />;
        })}
        {processing && (
          <View style={styles.thinkingBar}>
            <Text style={styles.thinkingText}>Thinking...</Text>
            <Text style={styles.thinkingDot}>{SPINNER_FRAMES[spinner]}</Text>
          </View>
        )}
      </ScrollView>

      <View style={[styles.inputBar, { paddingBottom: insets.bottom + 8 + kbHeight }]}>
        <TextInput
          style={[styles.input, styles.inputInner]}
          placeholder={status === "connected" ? "Type a message..." : "Not connected"}
          placeholderTextColor="#525252"
          value={inputText}
          onChangeText={setInputText}
          multiline
          numberOfLines={4}
          autoCapitalize="none"
          autoCorrect={false}
          editable={status === "connected"}
          onSubmitEditing={sendMessage}
          blurOnSubmit={false}
        />
        {processing ? (
          <TouchableOpacity style={styles.cancelBtn} onPress={cancelTask} activeOpacity={0.7}>
            <Text style={styles.cancelBtnText}>Stop</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.sendBtn, status !== "connected" && { opacity: 0.3 }]}
            onPress={sendMessage}
            disabled={status !== "connected"}
            activeOpacity={0.7}
          >
            <Text style={styles.sendBtnText}>Send</Text>
          </TouchableOpacity>
        )}
      </View>
      <Modal
        visible={showSessionPicker}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowSessionPicker(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Sessions</Text>
              <TouchableOpacity onPress={() => setShowSessionPicker(false)} activeOpacity={0.7}>
                <Text style={styles.modalClose}>Close</Text>
              </TouchableOpacity>
            </View>
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
                    {item.title}
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
    </Wrapper>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0a0a0a",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#1f1f1f",
  },
  headerToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flex: 1,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  headerTitle: {
    color: "#a3a3a3",
    fontSize: 14,
    fontWeight: "500",
    flex: 1,
  },
  setupBar: {
    padding: 12,
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#1f1f1f",
    backgroundColor: "#141414",
  },
  setupInput: {
    backgroundColor: "#1a1a1a",
    borderWidth: 1,
    borderColor: "#262626",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: "#e5e5e5",
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
    color: "#525252",
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
  userLine: {
    color: "#93c5fd",
    fontSize: 16,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    lineHeight: 24,
    marginTop: 4,
  },

  inputBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: 12,
    paddingTop: 8,
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#1f1f1f",
    backgroundColor: "#0a0a0a",
  },
  input: {
    flex: 1,
    backgroundColor: "#1a1a1a",
    borderWidth: 1,
    borderColor: "#262626",
    borderRadius: 12,
  },
  inputInner: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: "#e5e5e5",
    fontSize: 14,
    textAlignVertical: "top",
  },
  sendBtn: {
    backgroundColor: "#2563eb",
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
    color: "#a3a3a3",
    fontSize: 16,
    fontFamily: "monospace",
  },
  thinkingText: {
    color: "#525252",
    fontSize: 14,
    fontStyle: "italic",
  },
  sessionBtn: {
    backgroundColor: "#1a1a1a",
    borderWidth: 1,
    borderColor: "#262626",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  sessionBtnLabel: {
    color: "#737373",
    fontSize: 13,
  },
  sessionBtnValue: {
    color: "#e5e5e5",
    fontSize: 13,
    flex: 1,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "flex-end",
  },
  modalContent: {
    backgroundColor: "#141414",
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
    borderBottomColor: "#1f1f1f",
  },
  modalTitle: {
    color: "#e5e5e5",
    fontSize: 16,
    fontWeight: "600",
  },
  modalClose: {
    color: "#737373",
    fontSize: 14,
  },
  sessionItem: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#1f1f1f",
  },
  sessionItemActive: {
    backgroundColor: "#1a2a3a",
  },
  sessionItemTitle: {
    color: "#e5e5e5",
    fontSize: 14,
    fontWeight: "500",
  },
  sessionItemTitleActive: {
    color: "#93c5fd",
  },
  sessionItemDate: {
    color: "#525252",
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
    color: "#e5e5e5",
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 8,
  },
  optionBtn: {
    backgroundColor: "#1a1a2e",
    borderWidth: 1,
    borderColor: "#2a2a4a",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginTop: 6,
  },
  optionBtnUsed: {
    opacity: 0.5,
  },
  optionLabel: {
    color: "#93c5fd",
    fontSize: 14,
    fontWeight: "500",
  },
  optionDesc: {
    color: "#a3a3a3",
    fontSize: 12,
    marginTop: 3,
    lineHeight: 17,
  },
});
