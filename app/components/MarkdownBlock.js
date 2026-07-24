import { View, Text, ScrollView, StyleSheet, Platform } from "react-native";

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
              <Text style={styles.tableHeaderText} selectable>{h}</Text>
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

function renderInline(line, baseStyle) {
  const segments = [];
  let remaining = line;
  let key = 0;

  while (remaining.length > 0) {
    const patterns = [
      { regex: /\*\*(.+?)\*\*/, style: "bold" },
      { regex: /\*(.+?)\*/, style: "italic" },
      { regex: /`(.+?)`/, style: "code" },
      { regex: /\[(.+?)\]\((.+?)\)/, style: "link" },
    ];

    let best = null, bestMatch = null, bestPattern = null;
    for (const p of patterns) {
      const m = remaining.match(p.regex);
      if (m && (!best || m.index < best)) { best = m.index; bestMatch = m; bestPattern = p; }
    }

    if (!bestMatch) {
      segments.push(<Text key={key++} style={baseStyle}>{remaining}</Text>);
      break;
    }

    if (bestMatch.index > 0) {
      segments.push(<Text key={key++} style={baseStyle}>{remaining.slice(0, bestMatch.index)}</Text>);
    }

    if (bestPattern.style === "bold") {
      segments.push(<Text key={key++} style={[baseStyle, styles.bold]}>{bestMatch[1]}</Text>);
    } else if (bestPattern.style === "italic") {
      segments.push(<Text key={key++} style={[baseStyle, styles.italic]}>{bestMatch[1]}</Text>);
    } else if (bestPattern.style === "code") {
      segments.push(<Text key={key++} style={[baseStyle, styles.inlineCode]}>{bestMatch[1]}</Text>);
    } else if (bestPattern.style === "link") {
      segments.push(<Text key={key++} style={[baseStyle, styles.link]}>{bestMatch[1]}</Text>);
    }

    remaining = remaining.slice(bestMatch.index + bestMatch[0].length);
  }

  return segments;
}

function detectLineStyle(line) {
  const trimmed = line.trimStart();
  if (trimmed.startsWith("# ")) return { style: "h1", offset: 2 };
  if (trimmed.startsWith("## ")) return { style: "h2", offset: 3 };
  if (trimmed.startsWith("### ")) return { style: "h3", offset: 4 };
  if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) return { style: "list", offset: 2, prefix: "  \u2022 " };
  if (/^\d+\.\s/.test(trimmed)) return { style: "list", offset: trimmed.match(/^\d+\.\s/)[0].length, prefix: "  " };
  if (trimmed.startsWith("> ")) return { style: "blockquote", offset: 2 };
  return null;
}

function renderLine(line, idx) {
  const base = detectLineStyle(line);
  const content = base ? line.slice(line.indexOf(line.trimStart()) + base.offset) : line;

  if (base && base.style === "blockquote") {
    return (
      <View key={idx} style={styles.blockquote}>
        <Text style={styles.blockquoteText} selectable>{renderInline(content, styles.blockquoteText)}</Text>
      </View>
    );
  }

  let lineStyle;
  if (!base) {
    lineStyle = styles.line;
  } else if (base.style === "h1") {
    lineStyle = styles.h1;
  } else if (base.style === "h2") {
    lineStyle = styles.h2;
  } else if (base.style === "h3") {
    lineStyle = styles.h3;
  } else {
    lineStyle = styles.line;
  }

  const prefix = base?.prefix || "";
  const segments = renderInline(content, lineStyle);
  if (prefix) {
    segments.unshift(<Text key="pre" style={lineStyle}>{prefix}</Text>);
  }

  return <Text key={idx} style={lineStyle} selectable>{segments}</Text>;
}

export default function MarkdownBlock({ text }) {
  if (!text) return null;

  const elements = [];
  const lines = text.split("\n");
  let inCode = false;
  let codeLines = [];
  let textLines = [];
  let textIdx = 0;

  function flushText() {
    if (textLines.length > 0) {
      for (const tl of textLines) {
        const dl = detectLineStyle(tl);
        if (dl && dl.style === "blockquote") {
          elements.push(renderLine(tl, elements.length));
        } else if (dl) {
          const trimmed = tl.trimStart();
          elements.push(renderLine(trimmed, elements.length));
        } else {
          elements.push(renderLine(tl, elements.length));
        }
      }
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
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  bold: {
    fontWeight: "700",
  },
  italic: {
    fontStyle: "italic",
  },
  inlineCode: {
    backgroundColor: "#1a1a1a",
    color: "#93c5fd",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    fontSize: 15,
  },
  link: {
    color: "#60a5fa",
    textDecorationLine: "underline",
  },
  h1: {
    color: "#e5e5e5",
    fontSize: 20,
    lineHeight: 28,
    fontWeight: "700",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    marginTop: 8,
    marginBottom: 2,
  },
  h2: {
    color: "#e5e5e5",
    fontSize: 18,
    lineHeight: 26,
    fontWeight: "600",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    marginTop: 6,
    marginBottom: 2,
  },
  h3: {
    color: "#e5e5e5",
    fontSize: 16,
    lineHeight: 24,
    fontWeight: "600",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    marginTop: 4,
    marginBottom: 1,
  },
  blockquote: {
    borderLeftWidth: 2,
    borderLeftColor: "#525252",
    paddingLeft: 12,
    marginVertical: 4,
  },
  blockquoteText: {
    color: "#a3a3a3",
    fontSize: 15,
    lineHeight: 22,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    fontStyle: "italic",
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
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
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
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  tableCellText: {
    color: "#d4d4d4",
    fontSize: 15,
    lineHeight: 22,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
});