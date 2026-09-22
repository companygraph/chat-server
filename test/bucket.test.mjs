import { test } from "node:test";
import assert from "node:assert/strict";
import { Bucket, clientAddress } from "../lib/bucket.mjs";

test("twenty an hour per address, then no more until an hour has passed", () => {
  let t = 0;
  const b = new Bucket({ perHour: 20, now: () => t });
  for (let i = 0; i < 20; i++) assert.equal(b.take("a"), true);
  assert.equal(b.take("a"), false);
  assert.equal(b.take("b"), true, "another address has its own bucket");
  t = 3600 * 1000 + 1;
  assert.equal(b.take("a"), true, "the hour has passed");
});

test("the address is the one before the trusted hops, or the socket's", () => {
  const req = (xff, remote = "10.0.0.9") => ({ headers: xff ? { "x-forwarded-for": xff } : {}, socket: { remoteAddress: remote } });
  assert.equal(clientAddress(req("203.0.113.5, 35.1.1.1"), 1), "203.0.113.5");
  assert.equal(clientAddress(req("1.2.3.4, 203.0.113.5, 35.1.1.1"), 1), "203.0.113.5", "what a client prepends is ignored");
  assert.equal(clientAddress(req("203.0.113.5, 35.1.1.1, 35.2.2.2"), 2), "203.0.113.5");
  assert.equal(clientAddress(req("203.0.113.5"), 1), "203.0.113.5", "fewer entries than hops: the first");
  assert.equal(clientAddress(req(null), 1), "10.0.0.9");
});
