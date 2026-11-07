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

// Container Apps' ingress appends the client's address and nothing after it, so a chat there
// trusts no hop: what a caller wrote before the ingress's entry is ignored, as it is on Google.
test("with no trusted hop the address is the last entry, the one the ingress appended", () => {
  const req = (xff) => ({ headers: { "x-forwarded-for": xff }, socket: { remoteAddress: "10.0.0.9" } });
  assert.equal(clientAddress(req("203.0.113.5"), 0), "203.0.113.5");
  assert.equal(clientAddress(req("198.51.100.7, 203.0.113.5"), 0), "203.0.113.5", "a forged entry is ignored");
  assert.equal(clientAddress(req("198.51.100.7, 198.51.100.9, 203.0.113.5"), 0), "203.0.113.5", "two forged entries are ignored");
});

// On Google a caller reaches the service through Hosting, whose own address Cloud Run's front end
// appends after the visitor's, or directly, where the last entry is the caller's own. A hop is
// skipped only where its entry is a front address, so the direct caller cannot choose the key.
test("a hop is skipped only for the front end's own address", () => {
  const req = (xff) => ({ headers: { "x-forwarded-for": xff }, socket: { remoteAddress: "10.0.0.9" } });
  const front = (a) => a === "74.125.212.66";
  assert.equal(clientAddress(req("203.0.113.5, 74.125.212.66"), 1, front), "203.0.113.5", "through Hosting: the visitor");
  assert.equal(clientAddress(req("198.51.100.7, 203.0.113.5, 74.125.212.66"), 1, front), "203.0.113.5", "through Hosting, forged: the visitor");
  assert.equal(clientAddress(req("203.0.113.5"), 1, front), "203.0.113.5", "direct: the caller");
  assert.equal(clientAddress(req("198.51.100.7, 203.0.113.5"), 1, front), "203.0.113.5", "direct, forged: still the caller");
  assert.equal(clientAddress(req("198.51.100.7, 203.0.113.5"), 1, () => null), "198.51.100.7", "ranges unknown: the hop count alone, as before");
});
