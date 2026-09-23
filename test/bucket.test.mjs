import { test } from "node:test";
import assert from "node:assert/strict";
import { Bucket, clientAddress } from "../lib/bucket.mjs";

// The window slides: the twenty-first message waits until the oldest of the last twenty is an
// hour old, seconds or the whole hour, and the bucket is the one thing that knows which. Its
// refusal is that moment, so the route can say it rather than guess.
test("twenty an hour per address, then the moment the oldest leaves the window, then one more", () => {
  let t = 1000;
  const b = new Bucket({ perHour: 20, now: () => t });
  for (let i = 0; i < 20; i++) { assert.equal(b.take("a"), true); t += 1000; }
  const refused = b.take("a");
  assert.ok(refused instanceof Date, "a refusal is the moment, not false");
  assert.equal(refused.toISOString(), new Date(1000 + 3600 * 1000).toISOString(), "the first hit leaves the window an hour after it");
  assert.equal(b.take("b"), true, "another address has its own bucket");
  t = refused.getTime() - 1;
  assert.ok(b.take("a") instanceof Date, "a moment before, still refused");
  t = refused.getTime();
  assert.equal(b.take("a"), true, "at the moment, allowed");
});

test("the address is the one before the trusted hops, or the socket's", () => {
  const req = (xff, remote = "10.0.0.9") => ({ headers: xff ? { "x-forwarded-for": xff } : {}, socket: { remoteAddress: remote } });
  assert.equal(clientAddress(req("203.0.113.5, 35.1.1.1"), 1), "203.0.113.5");
  assert.equal(clientAddress(req("1.2.3.4, 203.0.113.5, 35.1.1.1"), 1), "203.0.113.5", "what a client prepends is ignored");
  assert.equal(clientAddress(req("203.0.113.5, 35.1.1.1, 35.2.2.2"), 2), "203.0.113.5");
  assert.equal(clientAddress(req("203.0.113.5"), 1), "203.0.113.5", "fewer entries than hops: the first");
  assert.equal(clientAddress(req(null), 1), "10.0.0.9");
});
