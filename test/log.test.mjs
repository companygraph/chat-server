import { test } from "node:test";
import assert from "node:assert/strict";
import { line } from "../lib/log.mjs";

// Every line the service writes is one JSON object whose first two keys Cloud Logging lifts out
// of the payload: the severity, and the labels with the logger's name, so the console filters a
// kind of line by labels.logger the way a logger's name is filtered elsewhere.
test("a line opens with the severity and the logger label, then its fields in order", () => {
  const s = line("chat.question", "INFO", { kind: "question", question: "hi" });
  assert.deepEqual(JSON.parse(s), { severity: "INFO", "logging.googleapis.com/labels": { logger: "chat.question" }, kind: "question", question: "hi" });
  assert.deepEqual(Object.keys(JSON.parse(s)), ["severity", "logging.googleapis.com/labels", "kind", "question"]);
  assert.ok(!s.includes("\n"), "one line");
});
