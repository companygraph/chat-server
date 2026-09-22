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
