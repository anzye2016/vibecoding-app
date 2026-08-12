import { View, Text, TextInput, TouchableOpacity, Modal, ScrollView, Alert } from "react-native";
import Slider from "@react-native-community/slider";
import * as ImagePicker from "expo-image-picker";
import { THEME_PALETTES } from "../theme";

export default function SettingsModal({
  visible,
  onClose,
  status,
  sessionLabel,
  relayUrl, setRelayUrl,
  token, setToken,
  roomId, setRoomId,
  workDir, setWorkDir,
  showStats, setShowStats,
  onConnectPress,
  onOpenSessions,
  themeName, setThemeName,
  customColors, setCustomColors,
  isDark, setIsDark,
  palette, C, styles, insets,
  quickDirs,
  onSwitchDirPress,
  onEditDir,
  onDeleteDir,
  onAddDir,
  bgImage, setBgImage,
  bgOpacity, setBgOpacity,
}) {
  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: C.cardAlt, paddingTop: insets.top }}>
        <TouchableOpacity style={styles.modalHeader} onPress={onClose} activeOpacity={0.7}>
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
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Text style={{ color: C.text2, fontSize: 12 }}>Show token usage</Text>
            <TouchableOpacity
              style={{ width: 44, height: 24, borderRadius: 12, backgroundColor: showStats ? C.accent : C.border, justifyContent: "center", paddingHorizontal: 2 }}
              onPress={() => setShowStats(v => !v)}
              activeOpacity={0.7}
            >
              <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: "#fff", alignSelf: showStats ? "flex-end" : "flex-start" }} />
            </TouchableOpacity>
          </View>
          <View style={{ height: 8 }} />
          <TouchableOpacity style={[styles.connectBtn, { backgroundColor: status === "connected" || status === "connecting" ? "#dc2626" : C.accent }, status === "connecting" && { opacity: 0.5 }]} onPress={onConnectPress} activeOpacity={0.8}>
            <Text style={styles.connectBtnText}>{status === "connected" ? "Disconnect" : status === "connecting" ? "Cancel" : "Connect"}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.connectBtn, { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, marginTop: 8 }]} onPress={onOpenSessions} activeOpacity={0.7}>
            <Text style={[styles.connectBtnText, { color: C.text }]}>Session: {sessionLabel}{status !== "connected" ? " (fetch)" : ""}</Text>
          </TouchableOpacity>

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
          <Text style={styles.sectionLabel}>Quick Launch</Text>
          <Text style={{ color: C.placeholder, fontSize: 11, marginTop: 2, marginBottom: 8 }}>Tap to connect, long-press to rename</Text>
          {quickDirs.map((q, i) => (
            <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <TouchableOpacity
                style={[styles.connectBtn, { flex: 1, backgroundColor: C.accent }]}
                onPress={() => onSwitchDirPress(q, i)}
                onLongPress={() => onEditDir(i)}
                activeOpacity={0.7}
              >
                <Text style={styles.connectBtnText} numberOfLines={1}>{q.name}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => onDeleteDir(i)} activeOpacity={0.6}>
                <Text style={{ color: C.placeholder, fontSize: 18 }}>✕</Text>
              </TouchableOpacity>
            </View>
          ))}
          <TouchableOpacity
            style={[styles.connectBtn, { backgroundColor: C.card, borderWidth: 1, borderColor: C.border }]}
            onPress={onAddDir}
            activeOpacity={0.7}
          >
            <Text style={[styles.connectBtnText, { color: C.text }]}>+ Add current dir</Text>
          </TouchableOpacity>

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
  );
}
