import { test } from "node:test";
import assert from "node:assert/strict";
import { ChatError, CODES, refusal } from "../lib/errors.mjs";

test("every code the interface names has a status, and a refusal carries code and sentence", () => {
  assert.deepEqual(Object.keys(CODES).sort(),
    ["bad_request", "busy", "closed", "foreign", "host_down", "over_day", "over_month", "too_long"]);
  const e = new ChatError("too_long", "the message is over 1000 characters");
  assert.equal(e.status, 400);
  assert.deepEqual(refusal(e), { error: { code: "too_long", message: "the message is over 1000 characters" } });
});

test("a code the table does not know is a programming error, not a refusal", () => {
  assert.throws(() => new ChatError("nope", "x"), /unknown code/);
  assert.throws(() => new ChatError("toString", "x"), /unknown code/);
});

// A refusal for a limit says when the limit lifts, from the one place that knows; a refusal for
// anything else has no moment and writes no field, so a client reading code and message reads
// what it read.
test("a refusal with a moment writes retryAt as an ISO time in UTC, and one without writes no field", () => {
  const at = new Date("2026-09-23T14:05:00.500Z");
  const e = new ChatError("busy", "too many messages from this address", { retryAt: at });
  assert.equal(e.retryAt, "2026-09-23T14:05:00.500Z");
  assert.deepEqual(refusal(e), { error: { code: "busy", message: "too many messages from this address", retryAt: "2026-09-23T14:05:00.500Z" } });
  const ms = new ChatError("over_day", "today's share is spent", { retryAt: Date.UTC(2026, 8, 24) });
  assert.equal(ms.retryAt, "2026-09-24T00:00:00.000Z", "a millisecond count is the same moment");
  const none = new ChatError("foreign", "not a page this chat answers");
  assert.ok(!("retryAt" in none), "no moment, no property");
  assert.deepEqual(Object.keys(refusal(none).error), ["code", "message"]);
});
