import { View, Text, TextInput, Modal, TouchableOpacity } from "react-native";

export default function QuickDirEditModal({ editingQuick, quickDirs, onChange, onToggle, onDone, C, styles }) {
  return (
    <Modal transparent animationType="none" visible onRequestClose={onDone}>
      <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={onDone}>
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "rgba(0,0,0,0.4)" }}>
          <TouchableOpacity activeOpacity={1} onPress={() => {}} style={{ backgroundColor: C.cardAlt, borderRadius: 14, padding: 20, width: "80%" }}>
            <Text style={{ color: C.textBright, fontSize: 16, fontWeight: "600", marginBottom: 12 }}>Edit Quick Dir</Text>
            {["name", "path", "showStats"].map(field => (
              <View key={field} style={{ marginBottom: 8 }}>
                {field === "showStats" ? (
                  <TouchableOpacity
                    style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 6 }}
                    onPress={() => onToggle(field)}
                    activeOpacity={0.7}
                  >
                    <Text style={{ color: C.text2, fontSize: 13 }}>Show token usage</Text>
                    <View style={{ width: 40, height: 22, borderRadius: 11, backgroundColor: quickDirs[editingQuick]?.[field] ? C.accent : C.border, justifyContent: "center", paddingHorizontal: 2 }}>
                      <View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: "#fff", alignSelf: quickDirs[editingQuick]?.[field] ? "flex-end" : "flex-start" }} />
                    </View>
                  </TouchableOpacity>
                ) : (
                  <TextInput
                    style={[styles.setupInput, { marginTop: 4 }]}
                    value={quickDirs[editingQuick]?.[field] || ""}
                    onChangeText={(v) => onChange(field, v)}
                    placeholder={field}
                    placeholderTextColor={C.placeholder}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                )}
              </View>
            ))}
            <TouchableOpacity style={[styles.connectBtn, { backgroundColor: C.accent, marginTop: 8 }]} onPress={onDone} activeOpacity={0.7}>
              <Text style={styles.connectBtnText}>Done</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    </Modal>
  );
}
