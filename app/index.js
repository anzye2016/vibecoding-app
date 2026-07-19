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
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Clipboard from "expo-clipboard";
import MarkdownBlock from "./components/MarkdownBlock";

const RELAY_URL = "wss://wxysyn.com/vibecoding/ws";

const STORAGE_KEYS = {
  TOKEN: "vibecoding_token",
  ROOM: "vibecoding_room",
  DIR: "vibecoding_dir",
};

export default function ChatScreen() {
  const insets = useSafeAreaInsets();
  const scrollRef = useRef(null);
  const wsRef = useRef(null);

  const [token, setToken] = useState("");
  const [roomId, setRoomId] = useState("");
  const [workDir, setWorkDir] = useState("");
  const [status, setStatus] = useState("disconnected");
  const [processing, setProcessing] = useState(false);
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState("");
  const [showSetup, setShowSetup] = useState(true);
  const [kbHeight, setKbHeight] = useState(0);
  const [spinner, setSpinner] = useState(0);

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

  const addMessage = useCallback((msg) => {
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (msg.type === "chunk" && last && last.type === "chunk") {
        return [...prev.slice(0, -1), { ...last, text: last.text + msg.text }];
      }
      return [...prev, msg];
    });
  }, []);

  const connect = () => {
    if (!roomId.trim() || !token.trim()) return;

    disconnect();
    setStatus("connecting");
    setShowSetup(false);

    const url = `${RELAY_URL}?room=${encodeURIComponent(roomId.trim())}&role=phone&token=${encodeURIComponent(token.trim())}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus("connected");
      setMessages([]);
      addMessage({ type: "status", text: "--- Connected ---" });
      ws.send(JSON.stringify({ type: "load_history", dir: workDir }));
    };

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === "status") {
          if (msg.online) {
            addMessage({ type: "status", text: "--- PC online ---" });
          } else {
            addMessage({ type: "status", text: "--- PC offline ---" });
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
        } else if (msg.type === "history") {
          if (msg.rounds && Array.isArray(msg.rounds)) {
            msg.rounds.forEach((r, idx) => {
              if (idx > 0) addMessage({ type: "spacer" });
              addMessage({ type: "history-user", text: r.user });
              addMessage({ type: "history-assistant", text: r.assistant });
            });
            addMessage({ type: "status", text: "--- History loaded ---" });
          }
        }
      } catch (e) {
        console.warn("[ws] parse error:", e.message);
      }
    };

    ws.onclose = () => {
      setStatus("disconnected");
      setProcessing(false);
      wsRef.current = null;
      addMessage({ type: "status", text: "--- Disconnected ---" });
    };

    ws.onerror = () => {
      setStatus("disconnected");
      setProcessing(false);
      wsRef.current = null;
      addMessage({ type: "error", text: "Connection failed" });
    };
  };

  const disconnect = () => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
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

  const copyOutput = async (text) => {
    await Clipboard.setStringAsync(text);
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
            placeholder="Work dir (e.g. /mnt/c/Users/anzye/projects/cc)"
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
                <Text style={styles.userLine}>{msg.text}</Text>
              </TouchableOpacity>
            );
          }
          if (msg.type === "chunk" || msg.type === "history-assistant") {
            return (
              <TouchableOpacity key={i} activeOpacity={1.0} onLongPress={() => copyOutput(msg.text)}>
                <MarkdownBlock text={msg.text} />
              </TouchableOpacity>
            );
          }
          if (msg.type === "spacer") {
            return <View key={i} style={{ height: 16 }} />;
          }
          return (
            <TouchableOpacity
              key={i}
              activeOpacity={0.7}
              onLongPress={() => copyOutput(msg.text)}
            >
              <MarkdownBlock text={msg.text} />
            </TouchableOpacity>
          );
        })}
        {processing && (
          <View style={styles.thinkingBar}>
            <Text style={styles.thinkingText}>Thinking...</Text>
            <Text style={styles.thinkingDot}>{SPINNER_FRAMES[spinner]}</Text>
          </View>
        )}
      </ScrollView>

      <View style={[styles.inputBar, { paddingBottom: insets.bottom + 8 + kbHeight }]}>
        <TouchableOpacity
          style={[styles.input, { justifyContent: "center" }]}
          activeOpacity={0.7}
          onPress={() => scrollRef.current?.scrollToEnd({ animated: true })}
          disabled={status === "connected" && !processing}
        >
          <TextInput
            style={styles.inputInner}
            placeholder={status === "connected" ? "Type a message..." : "Not connected"}
            placeholderTextColor="#525252"
            value={inputText}
            onChangeText={setInputText}
            multiline
            autoCapitalize="none"
            autoCorrect={false}
            editable={status === "connected" && !processing}
            onSubmitEditing={sendMessage}
            blurOnSubmit={false}
          />
        </TouchableOpacity>
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
    maxHeight: 100,
  },
  inputInner: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: "#e5e5e5",
    fontSize: 14,
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
});
