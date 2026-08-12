import { test } from "node:test";
import assert from "node:assert/strict";
import { withId, capMessages, mergeMsg, sessionLabelFor, genTabId, MAX_MESSAGES } from "../app/chatModel.js";

test("withId keeps an existing _id", () => {
  const msg = { type: "user", text: "hi", _id: "abc" };
  assert.equal(withId(msg), msg);
});

test("withId adds a stable _id", () => {
  const msg = withId({ type: "status", text: "x" });
  assert.ok(msg._id);
  assert.equal(withId(msg)._id, msg._id);
});

test("genTabId returns unique ids", () => {
  assert.notEqual(genTabId(), genTabId());
});

test("capMessages keeps last MAX_MESSAGES", () => {
  const prev = Array.from({ length: MAX_MESSAGES + 20 }, (_, i) => ({ type: "status", text: String(i), _id: String(i) }));
  const capped = capMessages(prev);
  assert.equal(capped.length, MAX_MESSAGES);
  assert.equal(capped[0].text, String(20));
  assert.equal(capped[capped.length - 1].text, String(MAX_MESSAGES + 19));
});

test("mergeMsg appends a new message with _id", () => {
  const prev = [];
  const next = mergeMsg(prev, { type: "user", text: "hello" });
  assert.equal(next.length, 1);
  assert.equal(next[0].text, "hello");
  assert.ok(next[0]._id);
});

test("mergeMsg merges consecutive chunks", () => {
  const a = mergeMsg([], { type: "chunk", text: "foo" });
  const b = mergeMsg(a, { type: "chunk", text: "bar" });
  assert.equal(b.length, 1);
  assert.equal(b[0].text, "foobar");
  assert.equal(b[0]._id, a[0]._id);
});

test("mergeMsg does not merge a chunk after a user message", () => {
  const a = mergeMsg([], { type: "user", text: "q" });
  const b = mergeMsg(a, { type: "chunk", text: "ans" });
  assert.equal(b.length, 2);
  assert.equal(b[1].text, "ans");
});

test("mergeMsg appends a status cost line at the end (real flow)", () => {
  const prev = [{ type: "user", text: "q", _id: "1" }, { type: "chunk", text: "a", _id: "2" }];
  const next = mergeMsg(prev, { type: "status", text: "c=100 o=200" });
  assert.equal(next.length, 3);
  assert.equal(next[2].text, "c=100 o=200");
});

test("mergeMsg Connected status clears failed/disconnected/offline markers", () => {
  const prev = [
    { type: "error", text: "Connection failed", _id: "1" },
    { type: "status", text: "--- Disconnected ---", _id: "2" },
    { type: "status", text: "--- PC offline ---", _id: "3" },
    { type: "status", text: "--- PC online ---", _id: "4" },
  ];
  const next = mergeMsg(prev, { type: "status", text: "--- Connected ---" });
  assert.ok(!next.some(m => m.text === "Connection failed" || m.text === "--- Disconnected ---" || m.text === "--- PC offline ---"));
  assert.ok(next.some(m => m.text === "--- PC online ---"));
});

test("mergeMsg dedupes consecutive Disconnected status", () => {
  const prev = [{ type: "status", text: "--- Disconnected ---", _id: "1" }];
  const next = mergeMsg(prev, { type: "status", text: "--- Disconnected ---" });
  assert.equal(next.length, 1);
});

test("sessionLabelFor resolves labels", () => {
  const sessions = [{ id: "s1", title: "Alpha" }, { id: "s2", title: "" }];
  assert.equal(sessionLabelFor(null, sessions), "(new)");
  assert.equal(sessionLabelFor("s1", sessions), "Alpha");
  assert.equal(sessionLabelFor("s2", sessions), "(unnamed)");
  assert.equal(sessionLabelFor("nope", sessions), "(auto)");
  assert.equal(sessionLabelFor("s1", undefined), "(auto)");
});
