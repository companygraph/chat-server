import { test } from "node:test";
import assert from "node:assert/strict";
import { googleFront, rangesFrom, GOOGLE_RANGES, CLOUD_RANGES } from "../lib/front.mjs";

// Google's lists in their published shape: one prefix of Google's own, one its cloud customers
// rent inside it, and an IPv6 prefix.
const GOOGLE = { prefixes: [{ ipv4Prefix: "74.125.0.0/16" }, { ipv4Prefix: "34.0.0.0/8" }, { ipv6Prefix: "2001:4860::/32" }] };
const CLOUD = { prefixes: [{ ipv4Prefix: "34.64.0.0/10", service: "Google Cloud" }] };

const fetchOf = (answers, calls = []) => async (url) => {
  calls.push(String(url));
  const a = answers[String(url)];
  if (a instanceof Error) throw a;
  return { ok: a !== undefined, status: a === undefined ? 404 : 200, json: async () => a };
};

test("an address is a front address in Google's ranges and outside its customers'", async () => {
  const front = googleFront({ fetchFn: fetchOf({ [GOOGLE_RANGES]: GOOGLE, [CLOUD_RANGES]: CLOUD }) });
  assert.equal(front.isFront("74.125.212.66"), null, "nothing is known before the first fetch");
  assert.equal(await front.load(), true);
  assert.equal(front.isFront("74.125.212.66"), true);
  assert.equal(front.isFront("2001:4860:4860::8888"), true);
  assert.equal(front.isFront("34.65.1.2"), false, "a customer's address inside Google's range is not a front");
  assert.equal(front.isFront("203.0.113.5"), false);
  assert.equal(front.isFront("not an address"), false);
});

test("a failed fetch is one warning and keeps what was known", async () => {
  const warned = [];
  const answers = { [GOOGLE_RANGES]: GOOGLE, [CLOUD_RANGES]: CLOUD };
  const front = googleFront({ fetchFn: fetchOf(answers), warn: (f) => warned.push(f.reason) });
  await front.load();
  answers[CLOUD_RANGES] = new Error("offline");
  assert.equal(await front.load(), false);
  assert.equal(front.isFront("74.125.212.66"), true, "the last lists still answer");
  const cold = googleFront({ fetchFn: fetchOf({}), warn: (f) => warned.push(f.reason) });
  assert.equal(await cold.load(), false);
  assert.equal(cold.isFront("74.125.212.66"), null, "with none ever fetched, unknown");
  assert.deepEqual(warned, ["offline", `${GOOGLE_RANGES} answered 404`]);
});

test("start loads once and arms a refresh that stop clears", async () => {
  const calls = [];
  const front = googleFront({ fetchFn: fetchOf({ [GOOGLE_RANGES]: GOOGLE, [CLOUD_RANGES]: CLOUD }, calls), refreshMs: 5, retryMs: 5 });
  assert.equal(await front.start(), true);
  await new Promise((r) => setTimeout(r, 30));
  front.stop();
  const seen = calls.length;
  assert.ok(seen >= 4, "the refresh fetched again");
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(calls.length, seen, "nothing after stop");
});

test("a list with no prefixes is refused rather than read as no front", () => {
  assert.throws(() => rangesFrom({ prefixes: [] }), /no prefixes/);
  assert.throws(() => rangesFrom({}), /no prefixes/);
});
