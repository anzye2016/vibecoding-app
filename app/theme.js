export const THEME_PALETTES = {
  zinc: {
    name: "Zinc", desc: "翡翠绿 · 专业中性",
    dark: { bg: "#09090b", text: "#fafafa", accent: "#34d399", text2: "#a1a1aa" },
    light: { bg: "#fafafa", text: "#3f3f46", accent: "#10b981", text2: "#a1a1aa" },
  },
  slate: {
    name: "Slate", desc: "湛蓝 · 冷静克制",
    dark: { bg: "#020617", text: "#f8fafc", accent: "#60a5fa", text2: "#94a3b8" },
    light: { bg: "#f8fafc", text: "#334155", accent: "#3b82f6", text2: "#94a3b8" },
  },
  forest: {
    name: "Forest", desc: "森林绿 · 自然深邃",
    dark: { bg: "#052e16", text: "#f0fdf4", accent: "#22c55e", text2: "#86efac" },
    light: { bg: "#f0fdf4", text: "#166534", accent: "#16a34a", text2: "#4ade80" },
  },
  rose: {
    name: "Rose", desc: "玫瑰红 · 温暖大胆",
    dark: { bg: "#1f0a0c", text: "#fff1f2", accent: "#fb7185", text2: "#fda4af" },
    light: { bg: "#fff1f2", text: "#881337", accent: "#e11d48", text2: "#e11d48" },
  },
  amber: {
    name: "Amber", desc: "琥珀黄 · 温暖明亮",
    dark: { bg: "#1c1402", text: "#fffbeb", accent: "#fbbf24", text2: "#fde68a" },
    light: { bg: "#fffbeb", text: "#78350f", accent: "#d97706", text2: "#b45309" },
  },
};

export function hexToRgb(h) { return { r: parseInt(h.slice(1,3),16), g: parseInt(h.slice(3,5),16), b: parseInt(h.slice(5,7),16) }; }
export function rgbToHex(r,g,b) { return `#${Math.min(255,Math.max(0,Math.round(r))).toString(16).padStart(2,"0")}${Math.min(255,Math.max(0,Math.round(g))).toString(16).padStart(2,"0")}${Math.min(255,Math.max(0,Math.round(b))).toString(16).padStart(2,"0")}`; }
export function lighten(h, amt) { const c=hexToRgb(h); return rgbToHex(c.r+amt, c.g+amt, c.b+amt); }
export function darken(h, amt) { const c=hexToRgb(h); return rgbToHex(c.r-amt, c.g-amt, c.b-amt); }
export function isLightHex(h) { const c=hexToRgb(h); return c.r*0.299 + c.g*0.587 + c.b*0.114 > 160; }

export function buildPalette(p) {
  const light = isLightHex(p.bg);
  return {
    bg: p.bg, text: p.text, accent: p.accent, text2: p.text2,
    card: light ? lighten(p.bg, 20) : lighten(p.bg, 12),
    cardAlt: light ? lighten(p.bg, 12) : lighten(p.bg, 8),
    textBright: p.text,
    border: light ? `rgba(0,0,0,0.08)` : `rgba(255,255,255,0.08)`,
    input: light ? darken(p.bg, 6) : lighten(p.bg, 8),
    placeholder: light ? "rgba(0,0,0,0.35)" : "rgba(255,255,255,0.35)",
    accentLight: light ? darken(p.accent, 10) : lighten(p.accent, 20),
    codeBg: light ? `rgba(0,0,0,0.04)` : `rgba(0,0,0,0.15)`,
  };
}
