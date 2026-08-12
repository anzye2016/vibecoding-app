import { View, Text, FlatList, Modal, TouchableOpacity } from "react-native";

export default function SessionPickerModal({ visible, onClose, sessions, currentSessionId, onSelect, C, styles, insets }) {
  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: C.cardAlt, paddingTop: insets.top }}>
        <TouchableOpacity style={styles.modalHeader} onPress={onClose} activeOpacity={0.7}>
          <Text style={styles.modalTitle}>Sessions</Text>
          <Text style={styles.modalClose}>Close</Text>
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <TouchableOpacity
            style={[styles.sessionItem, !currentSessionId && styles.sessionItemActive]}
            onPress={() => onSelect(null, null)}
            activeOpacity={0.7}
          >
            <Text style={[styles.sessionItemTitle, !currentSessionId && styles.sessionItemTitleActive]}>+ New session</Text>
          </TouchableOpacity>
          <FlatList
            data={sessions}
            keyExtractor={(item) => item.id || `session-${item.updated || ""}-${item.title || ""}`}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={[styles.sessionItem, currentSessionId === item.id && styles.sessionItemActive]}
                onPress={() => onSelect(item.id, item.title)}
                activeOpacity={0.7}
              >
                <Text style={[styles.sessionItemTitle, currentSessionId === item.id && styles.sessionItemTitleActive]} numberOfLines={1}>
                  {item.title || "(unnamed)"}
                </Text>
                <Text style={styles.sessionItemDate}>
                  {item.updated ? new Date(item.updated).toLocaleDateString() : ""}
                </Text>
              </TouchableOpacity>
            )}
          />
        </View>
      </View>
    </Modal>
  );
}
