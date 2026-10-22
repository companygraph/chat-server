import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_MESSAGE_CHARS, HISTORY_TURNS, MAX_TOOL_RESULT_CHARS, validateMessages, window, truncate, chosen } from "../lib/shape.mjs";
import { DEFAULT_CHOICE } from "../lib/models.mjs";

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
  assert.match(cut, new RegExp(`truncated at ${MAX_TOOL_RESULT_CHARS} characters`));
  assert.equal(truncate("short"), "short");
});

// What a request may choose: the default for a visitor whatever they name, and for a signed-in
// reader any effort on a model their roles open. A name the table does not hold is a malformed
// request, whoever sends it; a name it holds and the sender may not have is not granted.
const reader = (...models) => ({ sub: "reader-1", models: new Set(["claude-sonnet-5", ...models]) });
const code = (c) => (e) => e.code === c;

test("chosenDefault", () => {
  assert.deepEqual(chosen({}, null), DEFAULT_CHOICE);
  assert.deepEqual(chosen({}, reader()), DEFAULT_CHOICE);
  assert.deepEqual(chosen({ effort: "high" }, reader("claude-opus-5-5")), { model: "claude-sonnet-5", effort: "high" }, "an absent field is its default");
});

test("chosenUnknownModelBadRequest", () => {
  assert.throws(() => chosen({ model: "claude-unknown" }, reader()), code("bad_request"));
  assert.throws(() => chosen({ model: "claude-unknown" }, null), code("bad_request"));
  assert.throws(() => chosen({ effort: "extreme" }, reader()), code("bad_request"));
  assert.throws(() => chosen({ model: 5 }, reader()), code("bad_request"));
  assert.throws(() => chosen({ effort: null }, null), code("bad_request"));
  assert.throws(() => chosen({ model: "toString" }, reader()), code("bad_request"), "a name the table inherits is not one it holds");
});

test("visitorNamingDefaultIsAnswered", () => {
  assert.deepEqual(chosen({ model: "claude-sonnet-5", effort: "low" }, null), DEFAULT_CHOICE);
});

test("visitorOtherModelNotGranted", () => {
  assert.throws(() => chosen({ model: "claude-opus-5-5" }, null), code("not_granted"));
});

test("visitorOtherEffortNotGranted", () => {
  assert.throws(() => chosen({ effort: "medium" }, null), code("not_granted"));
});

test("readerUngrantedModelNotGranted", () => {
  assert.throws(() => chosen({ model: "claude-fable-5-1", effort: "low" }, reader("claude-opus-5-5")), code("not_granted"));
});

test("readerGrantedAnyEffort", () => {
  for (const effort of ["low", "medium", "high", "xhigh", "max"]) {
    assert.deepEqual(chosen({ model: "claude-opus-5-5", effort }, reader("claude-opus-5-5")), { model: "claude-opus-5-5", effort });
    assert.deepEqual(chosen({ effort }, reader("claude-opus-5-5")), { model: "claude-sonnet-5", effort }, "a role opens every effort, on the default too");
  }
});

// A reader who holds no role gets what a visitor gets: effort comes with a grant, and a sign-in
// alone is no grant.
test("roleLessReaderLowOnly", () => {
  assert.deepEqual(chosen({ model: "claude-sonnet-5", effort: "low" }, reader()), DEFAULT_CHOICE);
  assert.deepEqual(chosen({}, reader()), DEFAULT_CHOICE);
  for (const effort of ["medium", "high", "xhigh", "max"]) assert.throws(() => chosen({ effort }, reader()), code("not_granted"));
});
