import { test } from "node:test";
import assert from "node:assert/strict";
import { hexToRgb, rgbToHex, lighten, darken, isLightHex, buildPalette, THEME_PALETTES } from "../app/theme.js";

test("hexToRgb parses hex", () => {
  assert.deepEqual(hexToRgb("#336699"), { r: 51, g: 102, b: 153 });
});

test("rgbToHex round-trips with hexToRgb", () => {
  assert.equal(rgbToHex(51, 102, 153), "#336699");
});

test("lighten increases channel values", () => {
  const c = hexToRgb(lighten("#000000", 40));
  assert.ok(c.r >= 40 && c.g >= 40 && c.b >= 40);
});

test("darken decreases channel values but clamps at 0", () => {
  assert.equal(darken("#000000", 50), "#000000");
  const c = hexToRgb(darken("#ffffff", 60));
  assert.ok(c.r <= 195 && c.g <= 195 && c.b <= 195);
});

test("isLightHex threshold", () => {
  assert.equal(isLightHex("#ffffff"), true);
  assert.equal(isLightHex("#000000"), false);
});

test("buildPalette produces expected keys and light/dark variants", () => {
  const dark = buildPalette(THEME_PALETTES.zinc.dark);
  const light = buildPalette(THEME_PALETTES.zinc.light);
  for (const key of ["bg", "text", "accent", "text2", "card", "cardAlt", "textBright", "border", "input", "placeholder", "accentLight", "codeBg"]) {
    assert.ok(key in dark, `dark missing ${key}`);
    assert.ok(key in light, `light missing ${key}`);
  }
  assert.notEqual(dark.card, dark.bg, "card should differ from bg");
  assert.ok(dark.codeBg.includes("rgba"), "codeBg should be rgba");
});

test("buildPalette with custom bg derives light/dark cards", () => {
  const onDark = buildPalette({ bg: "#111111", text: "#eee", accent: "#0af", text2: "#888" });
  assert.ok(isLightHex(onDark.card) === false || onDark.card !== onDark.bg);
});
