import { test } from "node:test";
import assert from "node:assert/strict";
import { line, formatLine, useLogFormat, LOG_FORMATS } from "../lib/log.mjs";

// Every line the service writes is one JSON object whose first two keys Cloud Logging lifts out
// of the payload: the severity, and the labels with the logger's name, so the console filters a
// kind of line by labels.logger the way a logger's name is filtered elsewhere.
test("a line opens with the severity and the logger label, then its fields in order", () => {
  const s = line("chat.question", "INFO", { kind: "question", question: "hi" });
  assert.deepEqual(JSON.parse(s), { severity: "INFO", "logging.googleapis.com/labels": { logger: "chat.question" }, kind: "question", question: "hi" });
  assert.deepEqual(Object.keys(JSON.parse(s)), ["severity", "logging.googleapis.com/labels", "kind", "question"]);
  assert.ok(!s.includes("\n"), "one line");
});

test("Google's line is today's, to the byte", () => {
  assert.equal(formatLine("google", "chat.question", "INFO", { kind: "question", question: "hi" }),
    '{"severity":"INFO","logging.googleapis.com/labels":{"logger":"chat.question"},"kind":"question","question":"hi"}');
});

test("the plain line carries the severity and the logger at the top, then the fields", () => {
  const s = formatLine("plain", "chat.question", "INFO", { kind: "question", question: "hi" });
  assert.deepEqual(Object.keys(JSON.parse(s)), ["severity", "logger", "kind", "question"]);
  assert.deepEqual(JSON.parse(s), { severity: "INFO", logger: "chat.question", kind: "question", question: "hi" });
});

test("the chosen format holds for every later line, and Google's is the default", () => {
  assert.equal(line("chat.start", "INFO", { kind: "start" }), formatLine("google", "chat.start", "INFO", { kind: "start" }));
  useLogFormat("plain");
  try {
    assert.equal(JSON.parse(line("chat.start", "INFO", { kind: "start" })).logger, "chat.start");
  } finally {
    useLogFormat("google");
  }
  assert.throws(() => useLogFormat("json"), /^Error: CHAT_LOG is not one of google plain: json$/);
  assert.deepEqual(Object.keys(LOG_FORMATS), ["google", "plain"]);
});
