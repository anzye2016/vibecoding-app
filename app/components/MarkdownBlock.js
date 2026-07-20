import { View, Text, StyleSheet } from "react-native";

export default function MarkdownBlock({ text }) {
  if (!text) return null;

  const elements = [];
  const lines = text.split("\n");
  let inCode = false;
  let codeLines = [];
  let textLines = [];

  function flushText() {
    if (textLines.length > 0) {
      elements.push(
        <Text key={elements.length} style={styles.line} selectable>{textLines.join("\n")}</Text>
      );
      textLines = [];
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.match(/^```/)) {
      if (!inCode) {
        flushText();
        inCode = true;
        codeLines = [];
      } else {
        inCode = false;
        elements.push(
          <View key={elements.length} style={styles.codeBlock}>
            <Text style={styles.codeText} selectable>{codeLines.join("\n")}</Text>
          </View>
        );
      }
      continue;
    }

    if (inCode) {
      codeLines.push(line);
      continue;
    }

    textLines.push(line);
  }

  flushText();

  if (inCode) {
    elements.push(
      <View key={elements.length} style={styles.codeBlock}>
        <Text style={styles.codeText} selectable>{codeLines.join("\n")}</Text>
      </View>
    );
  }

  return <View style={styles.container}>{elements}</View>;
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: 2,
  },
  line: {
    color: "#d4d4d4",
    fontSize: 16,
    lineHeight: 24,
    fontFamily: "monospace",
  },
  codeBlock: {
    backgroundColor: "#111111",
    borderLeftWidth: 2,
    borderLeftColor: "#2563eb",
    padding: 10,
    marginVertical: 8,
    borderRadius: 6,
  },
  codeText: {
    color: "#a3a3a3",
    fontFamily: "monospace",
    fontSize: 14,
    lineHeight: 21,
  },
});
