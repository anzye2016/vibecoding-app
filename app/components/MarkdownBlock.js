import { View, Text, ScrollView, StyleSheet } from "react-native";

function splitRow(line) {
  return line.split("|").slice(1, -1).map(s => s.trim());
}

function isSep(line) {
  return /^\|[\s\-:|]+\|$/.test(line);
}

function TableBlock({ rows }) {
  const header = rows[0];
  const body = rows.slice(1);
  const colCount = header.length;

  // Calculate column widths (min 80, max based on content)
  const colWidths = header.map((_, ci) => {
    const all = rows.map(r => (r[ci] || "").length);
    const maxLen = Math.max(...all, 1);
    return Math.max(80, Math.min(maxLen * 9, 250));
  });
  const totalWidth = colWidths.reduce((a, b) => a + b, 0) + colCount;

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator style={styles.tableScroll}>
      <View style={{ width: totalWidth }}>
        <View style={styles.tableRow}>
          {header.map((h, ci) => (
            <View key={ci} style={[styles.tableCell, styles.tableHeader, { width: colWidths[ci] }]}>
              <Text style={styles.tableHeaderText} selectable numberOfLines={1}>{h}</Text>
            </View>
          ))}
        </View>
        {body.map((row, ri) => (
          <View key={ri} style={[styles.tableRow, ri % 2 === 1 && styles.tableRowAlt]}>
            {row.map((cell, ci) => (
              <View key={ci} style={[styles.tableCell, { width: colWidths[ci] }]}>
                <Text style={styles.tableCellText} selectable>{cell}</Text>
              </View>
            ))}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

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

    // Detect table: current line starts with | and next line is separator
    if (line.startsWith("|") && i + 1 < lines.length && isSep(lines[i + 1])) {
      flushText();
      const tableRows = [splitRow(line)];
      i++;
      while (++i < lines.length && lines[i].startsWith("|") && !isSep(lines[i])) {
        tableRows.push(splitRow(lines[i]));
      }
      i--;
      elements.push(<TableBlock key={elements.length} rows={tableRows} />);
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
  tableScroll: {
    marginVertical: 8,
  },
  tableRow: {
    flexDirection: "row",
  },
  tableRowAlt: {
    backgroundColor: "#111111",
  },
  tableCell: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#2a2a2a",
    paddingHorizontal: 8,
    paddingVertical: 6,
    justifyContent: "center",
  },
  tableHeader: {
    backgroundColor: "#1a2a3a",
  },
  tableHeaderText: {
    color: "#93c5fd",
    fontSize: 15,
    fontWeight: "600",
    fontFamily: "monospace",
  },
  tableCellText: {
    color: "#d4d4d4",
    fontSize: 15,
    lineHeight: 22,
    fontFamily: "monospace",
  },
});
