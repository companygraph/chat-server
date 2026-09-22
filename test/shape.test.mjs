import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_MESSAGE_CHARS, HISTORY_TURNS, MAX_TOOL_RESULT_CHARS, validateMessages, window, truncate } from "../lib/shape.mjs";

const turn = (role, content) => ({ role, content });

test("a conversation alternates and ends in user, or it is refused with a code", () => {
  const ok = validateMessages([turn("user", "hi"), turn("assistant", "hello"), turn("user", "who?")]);
  assert.equal(ok.length, 3);
  assert.throws(() => validateMessages([]), (e) => e.code === "bad_request");
  assert.throws(() => validateMessages([turn("assistant", "x")]), (e) => e.code === "bad_request");
  assert.throws(() => validateMessages([turn("user", "a"), turn("user", "b")]), (e) => e.code === "bad_request");
  assert.throws(() => validateMessages([turn("user", 3)]), (e) => e.code === "bad_request");
  assert.throws(() => validateMessages("nope"), (e) => e.code === "bad_request");
});

test("a message over the limit is too_long, and whitespace does not count", () => {
  assert.throws(() => validateMessages([turn("user", "x".repeat(MAX_MESSAGE_CHARS + 1))]), (e) => e.code === "too_long");
  assert.equal(validateMessages([turn("user", "  " + "x".repeat(MAX_MESSAGE_CHARS) + " ")])[0].content.length, MAX_MESSAGE_CHARS);
});

test("the window is at most the last eight turns, begins with the visitor and ends with the visitor", () => {
  const long = [];
  for (let i = 0; i < 25; i++) long.push(turn(i % 2 ? "assistant" : "user", `t${i}`));
  const w = window(long);
  // A valid conversation has an odd length, so the last eight always begin with an assistant
  // turn, which is dropped: seven reach the model, the first the visitor's.
  assert.equal(w.length, HISTORY_TURNS - 1);
  assert.equal(w[0].role, "user");
  assert.equal(w[0].content, "t18");
  assert.equal(w[w.length - 1].role, "user");
  assert.equal(w[w.length - 1].content, "t24");
  assert.equal(window(long.slice(0, 5)).length, 5, "a short conversation is sent whole");
  assert.equal(window(long.slice(0, 9)).length, 7, "nine turns: the last eight, less the leading assistant turn");
});

test("a tool answer over the cap is cut with a line that says so", () => {
  const big = "a".repeat(MAX_TOOL_RESULT_CHARS * 2);
  const cut = truncate(big);
  assert.ok(cut.length < big.length);
  assert.ok(cut.startsWith("a".repeat(MAX_TOOL_RESULT_CHARS)));
  assert.match(cut, /truncated at 16000 characters/);
  assert.equal(truncate("short"), "short");
});
