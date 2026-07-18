import { Component } from "react";
import { View, Text, StyleSheet } from "react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.eb}>
          <Text style={styles.ebTitle}>Something went wrong</Text>
          <Text style={styles.ebMsg}>{String(this.state.error)}</Text>
        </View>
      );
    }
    return this.props.children;
  }
}

export default function RootLayout() {
  return (
    <ErrorBoundary>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false }} />
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  eb: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#0a0a0a", padding: 24 },
  ebTitle: { color: "#ff6b6b", fontSize: 18, fontWeight: "bold", marginBottom: 12 },
  ebMsg: { color: "#aaa", fontSize: 14, textAlign: "center" },
});
