import { test } from "node:test";
import assert from "node:assert/strict";
import { escapeArg, escapeDir } from "../client/escapes.js";

test("escapeArg escapes double quotes", () => {
  assert.equal(escapeArg('a"b'), 'a\\"b');
});

test("escapeArg escapes backslash", () => {
  assert.equal(escapeArg("a\\b"), "a\\\\b");
});

test("escapeArg escapes dollar and backtick", () => {
  assert.equal(escapeArg("$HOME `id`"), "\\$HOME \\`id\\`");
});

test("escapeArg escapes bang (history expansion)", () => {
  assert.equal(escapeArg("!x"), "\\!x");
});

test("escapeArg leaves plain text unchanged", () => {
  assert.equal(escapeArg("hello world"), "hello world");
});

test("escapeArg handles empty and non-string input", () => {
  assert.equal(escapeArg(""), "");
  assert.equal(escapeArg(123), "123");
});

test("escapeDir escapes quotes, backslash, dollar, backtick", () => {
  assert.equal(escapeDir('C:\\x"y$z`q'), 'C:\\\\x\\"y\\$z\\`q');
});

test("escapeDir does not escape bang (preserves original dir behavior)", () => {
  assert.equal(escapeDir("a!b"), "a!b");
});

test("escaped values stay inside a double-quoted shell string", () => {
  // Simulate the WSL command construction: an injected quote must not
  // terminate the argument.
  const msg = 'hi"; rm -rf ~; echo "oops';
  const cmd = `opencode run "${escapeArg(msg)}"`;
  assert.ok(!/hi";/.test(cmd));
  assert.ok(cmd.includes('hi\\"; rm -rf ~; echo \\"oops'));
});
