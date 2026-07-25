import { View, Text, ScrollView, StyleSheet, Platform, Linking } from "react-native";
import { useMemo, useState, useCallback } from "react";
import { convertLatexInText } from "../../lib/latex-to-text.js";

function splitRow(line) {
  return line.split("|").slice(1, -1).map(s => s.trim());
}

function isSep(line) {
  return /^\|[\s\-:|]+\|$/.test(line);
}

function TableBlock({ rows, style: s }) {
  const header = rows[0];
  const body = rows.slice(1);
  const colCount = header.length;
  const [tableH, setTableH] = useState(0);

  const colWidths = header.map((_, ci) => {
    const all = rows.map(r => (r[ci] || "").length);
    const maxLen = Math.max(...all, 1);
    return Math.max(80, Math.min(maxLen * 9, 250));
  });
  const totalWidth = colWidths.reduce((a, b) => a + b, 0) + colCount;

  const onContentLayout = useCallback((e) => {
    const h = e.nativeEvent.layout.height;
    if (h > 10 && h !== tableH) setTableH(h);
  }, [tableH]);

  return (
    <View style={{ maxHeight: tableH > 0 ? tableH + 4 : undefined }}>
      <ScrollView horizontal showsHorizontalScrollIndicator>
        <View style={{ width: totalWidth }} onLayout={onContentLayout}>
          <View style={s.tableRow}>
            {header.map((h, ci) => (
              <View key={ci} style={[s.tableCell, s.tableHeader, { width: colWidths[ci] }]}>
                <Text style={s.tableHeaderText} selectable>{renderInline(convertLatexInText(h), s.tableHeaderText, s)}</Text>
              </View>
            ))}
          </View>
          {body.map((row, ri) => (
            <View key={ri} style={[s.tableRow, ri % 2 === 1 && s.tableRowAlt]}>
              {row.map((cell, ci) => (
                <View key={ci} style={[s.tableCell, { width: colWidths[ci] }]}>
                  <Text style={s.tableCellText} selectable>{renderInline(convertLatexInText(cell), s.tableCellText, s)}</Text>
                </View>
              ))}
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

function renderInline(line, baseStyle, s) {
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

    let bestIdx = Infinity, bestMatch = null, bestPattern = null;
    for (const p of patterns) {
      const m = remaining.match(p.regex);
      if (m && m.index < bestIdx) { bestIdx = m.index; bestMatch = m; bestPattern = p; }
    }

    if (!bestMatch) {
      segments.push(<Text key={key++} style={baseStyle}>{remaining}</Text>);
      break;
    }

    if (bestMatch.index > 0) {
      segments.push(<Text key={key++} style={baseStyle}>{remaining.slice(0, bestMatch.index)}</Text>);
    }

    if (bestPattern.style === "bold") {
      segments.push(
        <Text key={key++} style={[baseStyle, s.bold]}>{renderInline(bestMatch[1], baseStyle, s)}</Text>
      );
    } else if (bestPattern.style === "italic") {
      segments.push(
        <Text key={key++} style={[baseStyle, s.italic]}>{renderInline(bestMatch[1], baseStyle, s)}</Text>
      );
    } else if (bestPattern.style === "code") {
      segments.push(<Text key={key++} style={[baseStyle, s.inlineCode]}>{bestMatch[1]}</Text>);
    } else if (bestPattern.style === "link") {
      segments.push(
        <Text key={key++} style={[baseStyle, s.link]} onPress={() => Linking.openURL(bestMatch[2])}>{bestMatch[1]}</Text>
      );
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

function renderLine(line, idx, s) {
  const base = detectLineStyle(line);
  const content = base ? line.slice(line.indexOf(line.trimStart()) + base.offset) : line;
  const converted = convertLatexInText(content);

  if (base && base.style === "blockquote") {
    return (
      <View key={idx} style={s.blockquote}>
        <Text style={s.blockquoteText} selectable>{renderInline(converted, s.blockquoteText, s)}</Text>
      </View>
    );
  }

  let lineStyle;
  if (!base) {
    lineStyle = s.line;
  } else if (base.style === "h1") {
    lineStyle = s.h1;
  } else if (base.style === "h2") {
    lineStyle = s.h2;
  } else if (base.style === "h3") {
    lineStyle = s.h3;
  } else {
    lineStyle = s.line;
  }

  const prefix = base?.prefix || "";
  const segments = renderInline(converted, lineStyle, s);
  if (prefix) {
    segments.unshift(<Text key="pre" style={lineStyle}>{prefix}</Text>);
  }

  return <Text key={idx} style={lineStyle} selectable>{segments}</Text>;
}

export default function MarkdownBlock({ text, C }) {
  if (!text) return null;

  const s = useMemo(() => markdownStyles(C), [C]);

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
          elements.push(renderLine(tl, elements.length, s));
        } else if (dl) {
          const trimmed = tl.trimStart();
          elements.push(renderLine(trimmed, elements.length, s));
        } else {
          elements.push(renderLine(tl, elements.length, s));
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
          <View key={elements.length} style={s.codeBlock}>
            <Text style={s.codeText} selectable>{codeLines.join("\n")}</Text>
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
      elements.push(<TableBlock key={elements.length} rows={tableRows} style={s} />);
      continue;
    }

    textLines.push(line);
  }

  flushText();

  if (inCode) {
    elements.push(
      <View key={elements.length} style={s.codeBlock}>
        <Text style={s.codeText} selectable>{codeLines.join("\n")}</Text>
      </View>
    );
  }

  return <View style={s.container}>{elements}</View>;
}

function markdownStyles(C) {
  const isDark = (function(bg) {
    const r=parseInt(bg.slice(1,3),16), g=parseInt(bg.slice(3,5),16), b=parseInt(bg.slice(5,7),16);
    return r*0.299 + g*0.587 + b*0.114 <= 160;
  })(C.bg);
  const codeBg = isDark ? "#1a1a1a" : "#E8E8E8";
  const codeColor = isDark ? "#93c5fd" : "#1d4ed8";
  const linkColor = isDark ? "#60a5fa" : "#1d4ed8";
  const blockBg = isDark ? "#111111" : "#F0EFEC";
  const altBg = isDark ? "#111111" : "#F0EFEC";

  return StyleSheet.create({
  container: {
    paddingVertical: 2,
  },
  line: {
    color: C.textBright,
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
    backgroundColor: codeBg,
    color: codeColor,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    fontSize: 15,
  },
  link: {
    color: linkColor,
    textDecorationLine: "underline",
  },
  h1: {
    color: C.textBright,
    fontSize: 20,
    lineHeight: 28,
    fontWeight: "700",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    marginTop: 8,
    marginBottom: 2,
  },
  h2: {
    color: C.textBright,
    fontSize: 18,
    lineHeight: 26,
    fontWeight: "600",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    marginTop: 6,
    marginBottom: 2,
  },
  h3: {
    color: C.textBright,
    fontSize: 16,
    lineHeight: 24,
    fontWeight: "600",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    marginTop: 4,
    marginBottom: 1,
  },
  blockquote: {
    borderLeftWidth: 2,
    borderLeftColor: C.placeholder,
    paddingLeft: 12,
    marginVertical: 4,
  },
  blockquoteText: {
    color: C.text,
    fontSize: 15,
    lineHeight: 22,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    fontStyle: "italic",
  },
  codeBlock: {
    backgroundColor: blockBg,
    borderLeftWidth: 2,
    borderLeftColor: codeColor,
    padding: 10,
    marginVertical: 8,
    borderRadius: 6,
  },
  codeText: {
    color: C.textBright,
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
    backgroundColor: altBg,
  },
  tableCell: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.border,
    paddingHorizontal: 8,
    paddingVertical: 6,
    justifyContent: "center",
  },
  tableHeader: {
    backgroundColor: codeBg,
  },
  tableHeaderText: {
    color: codeColor,
    fontSize: 15,
    fontWeight: "600",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  tableCellText: {
    color: C.textBright,
    fontSize: 15,
    lineHeight: 22,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
});
}