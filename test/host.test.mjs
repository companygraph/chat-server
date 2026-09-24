import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createHttpServer } from "companygraph-mcp-server/http";
import { connectHost } from "../lib/host.mjs";
import { startFixtureHost, exampleSnapshot, COMMIT, EXAMPLE_ROOT, QUESTION_TITLES } from "./helpers.mjs";
import { REFRESH_FAILURE_COOLDOWN_MS } from "../lib/host.mjs";

// A clock this suite moves by hand, so a cooldown measured in real seconds is proven without the
// suite itself waiting on one.
function fakeClock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

let fixture, host;
before(async () => { fixture = await startFixtureHost(); host = await connectHost(fixture.url); });
after(async () => { await host.close(); await fixture.close(); });

test("the handshake gives the instructions, the tools in the model's shape, and where the model is", () => {
  assert.match(host.instructions, /Terms the tools use/);
  assert.match(host.instructions, /adds nothing/);
  assert.equal(host.title, EXAMPLE_ROOT);
  const names = host.tools.map((t) => t.name);
  assert.ok(names.includes("search") && names.includes("get_entity") && names.includes("list_types"));
  for (const t of host.tools) {
    assert.equal(typeof t.description, "string");
    assert.equal(t.input_schema.type, "object");
  }
  assert.equal(host.provenance.commit, COMMIT);
  assert.equal(host.provenance.repo, "companygraph/meta-model");
});

test("the host's types are read at connect, kept while the commit stands, and read again when it moves", async () => {
  const types = await host.types();
  assert.ok(types.length > 0);
  for (const t of types) { assert.equal(typeof t.type, "string"); assert.equal(typeof t.count, "number"); }
  assert.ok(types.some((t) => t.count > 0));
  const again = await host.types();
  assert.strictEqual(again, types, "the same list while the commit stands");
  host.provenance = { ...host.provenance, commit: "f".repeat(40) };
  const fresh = await host.types();
  assert.notStrictEqual(fresh, types, "read again once the commit moved");
  assert.deepEqual(fresh, types);
  assert.equal(host.provenance.commit, COMMIT, "and the read put the host's real commit back");
});

test("a call answers text and data, and a refusal is data with isError", async () => {
  const r = await host.call("search", { query: EXAMPLE_ROOT, match: "name" });
  assert.equal(r.isError, false);
  assert.ok(r.data.results.length > 0);
  assert.equal(JSON.parse(r.text).model.commit, COMMIT);
  const bad = await host.call("fetch", { id: "nothing/here" });
  assert.equal(bad.isError, true);
  assert.equal(typeof bad.data.error.code, "string");
});

// The rule that sends a search with match "words" needs a host that has the mode, which is the
// server package from v0.26.0; a host below it refuses the value, and this holds the pin to it.
test("a search by words is answered, with the words the host read", async () => {
  const r = await host.call("search", { query: EXAMPLE_ROOT, match: "words" });
  assert.equal(r.isError, false);
  assert.ok(r.data.results.length > 0);
  assert.ok(r.data.words.length > 0 && r.data.words.every((w) => typeof w.stem === "string" && typeof w.common === "boolean"));
});

test("a call answers with the host's provenance as this call reports it", async () => {
  host.provenance = null;
  const r = await host.call("list_types", {});
  assert.deepEqual(host.provenance, r.data.model);
  assert.equal(host.provenance.commit, COMMIT);
});

// The fixture host behind a counter, so a reconnect can be seen: opening one costs several
// requests where a call costs one.
async function countedHost() {
  const inner = createHttpServer(exampleSnapshot());
  let requests = 0;
  const server = http.createServer((req, res) => { requests += 1; inner.emit("request", req, res); });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const h = await connectHost(`http://127.0.0.1:${server.address().port}/mcp`);
  return { host: h, since: () => { const n = requests; requests = 0; return n; }, close: async () => { await h.close(); server.close(); } };
}

test("a tool the host does not have is the host refusing, not the host gone: no reconnect", async () => {
  const c = await countedHost();
  try {
    c.since();
    await c.host.call("list_types", {});
    const good = c.since();
    assert.equal(good, 1, "an answered call is one request; opening a connection is several");
    await assert.rejects(() => c.host.call("no_such_tool", {}), (e) => {
      assert.notEqual(e.code, "host_down");
      assert.match(e.message, /no_such_tool/);
      return true;
    });
    assert.equal(c.since(), good, "a refused call costs what an answered one costs, so nothing was reopened");
    assert.equal((await c.host.call("list_types", {})).isError, false, "and the connection is still the one it was");
  } finally {
    await c.close();
  }
});

// The example carries the real type `question` (core 0.40.0, meta-model v0.45.0) with three
// entities, so the ordinary fixture host answers the question-index tests without any fixture
// of their own. Each opens its own connection over the shared fixture so an override of `call`
// or a forced commit never leaks into the module-level `host` the other tests share.
//
// Forcing `h.provenance.commit` alone is not enough to make a test's own commit move real: the
// fixture is one static snapshot with one real commit, so the very next list_types call would
// answer with that same real commit and correct the fake one straight back — indistinguishable,
// to the cache, from the commit never having moved at all. `mockCommit` instead answers
// list_types itself with a commit of the test's choosing, genuinely different from whatever is
// cached, so the staleness a test means to create is the staleness the cache actually sees.
function mockCommit(h, commit, types, { onOther, calls } = {}) {
  const orig = h.call;
  h.provenance = { ...h.provenance, commit };
  h.call = async (name, args) => {
    calls?.push(name);
    if (name === "list_types") return { text: "", isError: false, data: { types, model: { commit, repo: null, core: "0", parser: "0" } } };
    if (onOther) return onOther(name, args, orig);
    return orig(name, args);
  };
  return orig;
}

test("the real model's question titles are read at connect, cached while the commit stands, and refreshed when it moves", async () => {
  const h = await connectHost(fixture.url);
  try {
    const first = await h.questions();
    assert.deepEqual(first, { titles: QUESTION_TITLES, more: false }, "every title the example carries, in id order, and nothing left out");
    const again = await h.questions();
    assert.strictEqual(again.titles, first.titles, "the same array while the commit stands");
    const realTypes = await h.types();
    mockCommit(h, "f".repeat(40), realTypes);
    const fresh = await h.questions();
    assert.notStrictEqual(fresh.titles, first.titles, "read again once the commit moved");
    assert.deepEqual(fresh, { titles: QUESTION_TITLES, more: false });
  } finally {
    await h.close();
  }
});

// The example holds only three questions, too few to span the host's own default page of fifty,
// so the two pages here are a minimal fake of `list_entities`'s own answer: everything else —
// the connection, the handshake, the real type map — is the real fixture host.
test("question titles are read across the host's own pages, following nextCursor while hasMore", async () => {
  const h = await connectHost(fixture.url);
  try {
    const realTypes = await h.types();
    const page1 = Array.from({ length: 3 }, (_, i) => ({ id: `question/p1-${i}`, type: "question", name: `Fake question ${i}?`, tagline: "", owner: null }));
    const page2 = [{ id: "question/p2-0", type: "question", name: "Fake question 3?", tagline: "", owner: null }];
    mockCommit(h, "c".repeat(40), realTypes, {
      onOther: (name, args) => {
        if (name === "list_entities" && args?.type === "question") {
          if (!args.cursor) return { text: "", isError: false, data: { type: "question", entities: page1, page: { total: 4, returned: 3, hasMore: true, nextCursor: "page2" } } };
          assert.equal(args.cursor, "page2", "the cursor the first page answered with is the one the next call carries");
          return { text: "", isError: false, data: { type: "question", entities: page2, page: { total: 4, returned: 1, hasMore: false, nextCursor: null } } };
        }
        throw new Error(`unexpected call: ${name}`);
      },
    });
    assert.deepEqual(await h.questions(), { titles: ["Fake question 0?", "Fake question 1?", "Fake question 2?", "Fake question 3?"], more: false });
  } finally {
    await h.close();
  }
});

// A host whose page never runs out on its own: hasMore stays true and the cursor it answers
// with is the very one it was just sent, forever. The fetch must still return, with whatever it
// read before it noticed, and more: true, rather than following the same page endlessly.
test("a host answering an endless same-cursor page terminates, with more: true", async () => {
  const h = await connectHost(fixture.url);
  try {
    const realTypes = await h.types();
    let requests = 0;
    mockCommit(h, "9".repeat(40), realTypes, {
      onOther: (name, args) => {
        if (name === "list_entities" && args?.type === "question") {
          requests++;
          return { text: "", isError: false, data: { type: "question", entities: [{ id: "question/same", type: "question", name: "Repeated question?", tagline: "", owner: null }], page: { total: 999999, returned: 1, hasMore: true, nextCursor: "stuck" } } };
        }
        throw new Error(`unexpected call: ${name}`);
      },
    });
    const result = await h.questions();
    assert.equal(result.more, true, "it gives up rather than following the same page forever");
    assert.deepEqual(result.titles, ["Repeated question?"]);
    assert.ok(requests <= 20, `it stopped well inside the fixed page limit; made ${requests} requests`);
  } finally {
    await h.close();
  }
});

// A host that keeps genuinely progressing, page after page, past what the cap could ever hold:
// the fetch stops once the titles read so far, quoted and joined, would already fill the line,
// and says more: true, even though every page it did read made real progress.
test("a many-page model stops fetching once the cap is full, and says more: true", async () => {
  // A small cap of its own, so the stop is reached in a couple of pages rather than needing
  // thousands of them to fill the family's default of 4000.
  const h = await connectHost(fixture.url, { questionCap: 200 });
  try {
    const realTypes = await h.types();
    let requests = 0;
    mockCommit(h, "8".repeat(40), realTypes, {
      onOther: (name, args) => {
        if (name === "list_entities" && args?.type === "question") {
          requests++;
          const n = Number(args.cursor ?? "0");
          return { text: "", isError: false, data: { type: "question", entities: [{ id: `question/p${n}`, type: "question", name: `Question number ${n} asked at some length so it spends the cap quickly?`, tagline: "", owner: null }], page: { total: 999999, returned: 1, hasMore: true, nextCursor: String(n + 1) } } };
        }
        throw new Error(`unexpected call: ${name}`);
      },
    });
    const result = await h.questions();
    assert.equal(result.more, true);
    assert.ok(result.titles.length > 0 && result.titles.length < 999999, "some titles, not the host's whole unbounded claim");
    assert.ok(requests > 0 && requests < 999999, `far fewer requests than pages the host claimed; made ${requests}`);
  } finally {
    await h.close();
  }
});

// A host whose titles are short enough that the cap never binds, and whose cursor genuinely
// advances every page — no repeat, no shortage of room — so the only thing that can stop this
// is the fixed page limit itself, at exactly twenty requests, with more: true.
test("a host that keeps genuinely advancing its cursor forever stops at the fixed page limit, with more: true", async () => {
  const h = await connectHost(fixture.url);
  try {
    const realTypes = await h.types();
    let requests = 0;
    mockCommit(h, "6".repeat(40), realTypes, {
      onOther: (name, args) => {
        if (name === "list_entities" && args?.type === "question") {
          requests++;
          const n = Number(args.cursor ?? "0");
          return { text: "", isError: false, data: { type: "question", entities: [{ id: `question/p${n}`, type: "question", name: `Q${n}?`, tagline: "", owner: null }], page: { total: 999999, returned: 1, hasMore: true, nextCursor: String(n + 1) } } };
        }
        throw new Error(`unexpected call: ${name}`);
      },
    });
    const result = await h.questions();
    assert.equal(result.more, true, "the host never ran out and the cap never bound; only the page limit stopped it");
    assert.equal(requests, 20, "exactly the fixed page limit, not one page more");
    assert.deepEqual(result.titles, Array.from({ length: 20 }, (_, i) => `Q${i}?`), "every title the twenty pages gave, none dropped by the cap");
  } finally {
    await h.close();
  }
});

test("a host whose type map carries no question is asked nothing named list_entities to find its titles", async () => {
  const h = await connectHost(fixture.url);
  try {
    const realTypes = await h.types();
    const withoutQuestion = realTypes.filter((t) => t.type !== "question");
    const calls = [];
    mockCommit(h, "e".repeat(40), withoutQuestion, { calls, onOther: (name) => { throw new Error(`unexpected call: ${name}`); } });
    assert.deepEqual(await h.questions(), { titles: [], more: false }, "no question type, so no index");
    assert.ok(calls.includes("list_types"), "the refresh itself happened");
    assert.ok(!calls.includes("list_entities"), `list_entities should not be called; calls were ${calls.join(", ")}`);
  } finally {
    await h.close();
  }
});

test("a failing list_entities yields no index and no throw, and does not stop the types from refreshing", async () => {
  const h = await connectHost(fixture.url);
  try {
    assert.deepEqual(await h.questions(), { titles: QUESTION_TITLES, more: false }, "the index is there to start");
    const realTypes = await h.types();
    mockCommit(h, "d".repeat(40), realTypes, { onOther: (name) => (name === "list_entities" ? { text: "", data: { error: { code: "boom" } }, isError: true } : (() => { throw new Error(`unexpected call: ${name}`); })()) });
    await assert.doesNotReject(() => h.questions());
    const result = await h.questions();
    assert.deepEqual(result.titles, QUESTION_TITLES, "the previous titles are kept, not cleared, while the fetch fails");
    const types = await h.types();
    assert.ok(types.some((t) => t.type === "question"), "the type refresh itself still succeeded");
  } finally {
    await h.close();
  }
});

// A commit move where list_types succeeds but list_entities then fails leaves the titles from
// before in place; the next call, still on that same commit, must retry the question fetch
// alone — no further list_types call, since types are already fresh — and not clear the titles
// meanwhile.
test("a failing list_entities marks only the questions stale; the next call once the cooldown passes retries them alone, not the types", async () => {
  const clock = fakeClock();
  const h = await connectHost(fixture.url, { now: clock.now });
  try {
    const before = await h.questions();
    assert.deepEqual(before.titles, QUESTION_TITLES, "the index is there to start");
    const realTypes = await h.types();
    const NEW_COMMIT = "d".repeat(40);
    let calls = [];
    const orig = mockCommit(h, NEW_COMMIT, realTypes, { calls, onOther: (name) => (name === "list_entities" ? { text: "", isError: true, data: { error: { code: "boom" } } } : (() => { throw new Error(`unexpected call: ${name}`); })()) });
    const duringFailure = await h.questions();
    assert.deepEqual(duringFailure.titles, QUESTION_TITLES, "kept, not cleared, while the fetch fails");

    // The cooldown the failed fetch just started holds off a retry on the very next call; past
    // it, the retry happens and is the questions half alone, the types already fresh.
    clock.advance(REFRESH_FAILURE_COOLDOWN_MS + 1);
    calls = [];
    mockCommit(h, NEW_COMMIT, realTypes, { calls, onOther: (name, args) => orig(name, args) }); // list_entities now answered for real
    const after = await h.questions();
    assert.deepEqual(after.titles, QUESTION_TITLES);
    assert.ok(!calls.includes("list_types"), `list_types should not be called again, since types were already fresh; calls were ${calls.join(", ")}`);
    assert.ok(calls.includes("list_entities"), "the question fetch alone is retried");
  } finally {
    await h.close();
  }
});

// Two calls that both find the cache stale, fired together rather than one after the other,
// must not each run their own refresh: the second joins the first's, in flight, the way a lost
// connection's reopen is already shared.
test("two requests together after a commit move cause one list_types call", async () => {
  const h = await connectHost(fixture.url);
  try {
    const realTypes = await h.types();
    const calls = [];
    mockCommit(h, "b".repeat(40), realTypes, { calls, onOther: (name, args, orig) => orig(name, args) });
    const [a, b] = await Promise.all([h.types(), h.types()]);
    assert.strictEqual(a, b, "both calls got the very same fresh list");
    assert.equal(calls.filter((n) => n === "list_types").length, 1, `list_types should be called once; calls were ${calls.join(", ")}`);
  } finally {
    await h.close();
  }
});

// Sharing one refresh cuts both ways: if it fails, both callers waiting on it see the failure,
// not one told and the other left hanging or, worse, silently given stale data. A refresh that
// then succeeds is not sharing the failed one — the next call is a fresh attempt of its own.
test("a shared refresh that fails rejects both concurrent callers, and the next call, once the cooldown passes, recovers", async () => {
  const clock = fakeClock();
  const h = await connectHost(fixture.url, { now: clock.now });
  try {
    const realTypes = await h.types();
    h.provenance = { ...h.provenance, commit: "5".repeat(40) };
    const orig = h.call;
    let failNext = true;
    h.call = async (name, args) => {
      if (name === "list_types" && failNext) { failNext = false; throw new Error("boom"); }
      if (name === "list_types") return { text: "", isError: false, data: { types: realTypes, model: { commit: "5".repeat(40), repo: null, core: "0", parser: "0" } } };
      return orig(name, args);
    };
    const [a, b] = await Promise.allSettled([h.types(), h.types()]);
    assert.equal(a.status, "rejected", "the first caller sees the failure");
    assert.equal(b.status, "rejected", "the second, sharing the same in-flight refresh, sees it too");
    assert.equal(a.reason.message, "boom");
    assert.equal(b.reason.message, "boom");
    // Immediately after, the failure's own cooldown would hold off a retry and answer the stale
    // cache instead; advancing past it is what makes this a genuine second attempt.
    clock.advance(REFRESH_FAILURE_COOLDOWN_MS + 1);
    const after = await h.types();
    assert.ok(after.some((t) => t.type === "question"), "the next call is a fresh attempt, not the failed one shared again, and it recovers");
  } finally {
    await h.close();
  }
});

// A title too long for even one entity to fit is logged once, at the fetch — a commit move, not
// a chat message — and not again while the commit stands, however many messages read the cache.
test("a title alone longer than the cap is logged once, naming CHAT_QUESTION_INDEX_CHARS, and not again while the commit stands", async () => {
  // 250 comfortably fits the example's own three real titles at connect (so connecting alone
  // logs nothing), and does not fit the one long title the mocked commit below answers with.
  const h = await connectHost(fixture.url, { questionCap: 250 });
  try {
    const realTypes = await h.types();
    const longTitle = "A question worded at some real length, deliberately padded further so that it comfortably exceeds a cap of two hundred fifty characters on its own, well past it?";
    mockCommit(h, "7".repeat(40), realTypes, {
      onOther: (name, args) => {
        if (name === "list_entities" && args?.type === "question") {
          return { text: "", isError: false, data: { type: "question", entities: [{ id: "question/long", type: "question", name: longTitle, tagline: "", owner: null }], page: { total: 1, returned: 1, hasMore: false, nextCursor: null } } };
        }
        throw new Error(`unexpected call: ${name}`);
      },
    });
    const logs = [];
    const origError = console.error;
    console.error = (...args) => logs.push(args);
    try {
      const first = await h.questions();
      assert.deepEqual(first, { titles: [], more: true });
      const again = await h.questions();
      assert.deepEqual(again, { titles: [], more: true });
    } finally {
      console.error = origError;
    }
    assert.equal(logs.length, 1, `logged once, not per request; logged ${logs.length} times`);
    assert.equal(logs[0][0], "chat: question index");
    assert.match(logs[0][1], /CHAT_QUESTION_INDEX_CHARS/);
  } finally {
    await h.close();
  }
});

test("a call after the host went away reconnects once, and a host that is gone is host_down", async () => {
  const second = await startFixtureHost();
  const h = await connectHost(second.url);
  await second.close();
  await assert.rejects(() => h.call("list_types", {}), (e) => e.code === "host_down");
  await h.close();
  await assert.rejects(() => connectHost("http://127.0.0.1:1/mcp"), (e) => e.code === "host_down");
});

// A degraded host's list_types is a real reconnect underneath — close, a full open(): handshake,
// listTools, list_types, and up to twenty pages of question titles — so during an outage, each
// chat message that finds the cache stale would otherwise re-enter that whole reconnect before
// failing, and a busy moment's concurrent messages would multiply that load on a host that is
// already failing. These four tests hold host.call under a stub that counts its own calls, moving
// a fake clock by hand rather than waiting on a real cooldown.
test("a failed refresh is tried once, not on every call, within the cooldown, and the next call after it tries again", async () => {
  const clock = fakeClock();
  const h = await connectHost(fixture.url, { now: clock.now });
  try {
    const realTypes = await h.types();
    h.provenance = { ...h.provenance, commit: "1".repeat(40) };
    const calls = [];
    let fail = true;
    // Once list_types succeeds, the example's own types carry `question`, so a fresh commit
    // also asks list_entities; that call is stubbed to succeed trivially, since this test counts
    // list_types attempts, the call whose failure is the expensive one this cooldown guards.
    h.call = async (name) => {
      calls.push(name);
      if (name === "list_types") {
        if (fail) throw new Error("boom");
        return { text: "", isError: false, data: { types: realTypes, model: { commit: "1".repeat(40), repo: null, core: "0", parser: "0" } } };
      }
      if (name === "list_entities") return { text: "", isError: false, data: { type: "question", entities: [], page: { total: 0, returned: 0, hasMore: false, nextCursor: null } } };
      throw new Error(`unexpected call: ${name}`);
    };
    const typesCalls = () => calls.filter((n) => n === "list_types").length;
    await assert.rejects(() => h.types(), /boom/, "the failing attempt itself still rejects");
    assert.equal(typesCalls(), 1, "the one attempt this failure made");
    for (let i = 0; i < 5; i++) {
      const t = await h.types();
      assert.strictEqual(t, realTypes, "the last good types, unchanged, while the cooldown holds");
    }
    assert.equal(typesCalls(), 1, "none of those five calls attempted a refresh");
    clock.advance(REFRESH_FAILURE_COOLDOWN_MS + 1);
    fail = false;
    const after = await h.types();
    assert.ok(after.some((t) => t.type === "question"), "a fresh, successful attempt");
    assert.equal(typesCalls(), 2, "the first call once the cooldown passed tried again");
  } finally {
    await h.close();
  }
});

test("a failed titles fetch that keeps the types is retried once within the cooldown, then tried again once it passes", async () => {
  const clock = fakeClock();
  const h = await connectHost(fixture.url, { now: clock.now });
  try {
    const before = await h.questions();
    assert.deepEqual(before.titles, QUESTION_TITLES);
    const realTypes = await h.types();
    const NEW_COMMIT = "2".repeat(40);
    h.provenance = { ...h.provenance, commit: NEW_COMMIT };
    const calls = [];
    let fail = true;
    h.call = async (name, args) => {
      calls.push(name);
      if (name === "list_types") return { text: "", isError: false, data: { types: realTypes, model: { commit: NEW_COMMIT, repo: null, core: "0", parser: "0" } } };
      if (name === "list_entities" && args?.type === "question") {
        if (fail) return { text: "", isError: true, data: { error: { code: "boom" } } };
        return { text: "", isError: false, data: { type: "question", entities: [{ id: "question/x", type: "question", name: "New question?", tagline: "", owner: null }], page: { total: 1, returned: 1, hasMore: false, nextCursor: null } } };
      }
      throw new Error(`unexpected call: ${name}`);
    };
    const first = await h.questions();
    assert.deepEqual(first.titles, QUESTION_TITLES, "kept, not cleared, while the fetch fails");
    assert.equal(calls.filter((n) => n === "list_entities").length, 1);
    for (let i = 0; i < 4; i++) await h.questions();
    assert.equal(calls.filter((n) => n === "list_entities").length, 1, "no retry of the titles fetch within the cooldown");
    assert.equal(calls.filter((n) => n === "list_types").length, 1, "types were already fresh; never retried regardless of the cooldown");
    clock.advance(REFRESH_FAILURE_COOLDOWN_MS + 1);
    fail = false;
    const after = await h.questions();
    assert.deepEqual(after.titles, ["New question?"]);
    assert.equal(calls.filter((n) => n === "list_entities").length, 2, "the first call once the cooldown passed tried the titles fetch again");
  } finally {
    await h.close();
  }
});

test("a success clears the cooldown, so a further commit move right after it is tried immediately", async () => {
  const clock = fakeClock();
  const h = await connectHost(fixture.url, { now: clock.now });
  try {
    const realTypes = await h.types();
    let commit = "3".repeat(40);
    h.provenance = { ...h.provenance, commit };
    const calls = [];
    let fail = true;
    h.call = async (name) => {
      calls.push(name);
      if (name === "list_types") {
        if (fail) throw new Error("boom");
        return { text: "", isError: false, data: { types: realTypes, model: { commit, repo: null, core: "0", parser: "0" } } };
      }
      if (name === "list_entities") return { text: "", isError: false, data: { type: "question", entities: [], page: { total: 0, returned: 0, hasMore: false, nextCursor: null } } };
      throw new Error(`unexpected call: ${name}`);
    };
    const typesCalls = () => calls.filter((n) => n === "list_types").length;
    await assert.rejects(() => h.types());
    clock.advance(REFRESH_FAILURE_COOLDOWN_MS + 1);
    fail = false;
    await h.types();
    assert.equal(typesCalls(), 2, "the cooldown passed and this attempt recovered");
    commit = "4".repeat(40);
    h.provenance = { ...h.provenance, commit };
    fail = true;
    await assert.rejects(() => h.types());
    assert.equal(typesCalls(), 3, "tried immediately: the success just above cleared the cooldown rather than leaving it set");
  } finally {
    await h.close();
  }
});

test("many concurrent callers during a failure share one attempt, and many concurrent callers within the cooldown afterward cost no further attempt", async () => {
  const clock = fakeClock();
  const h = await connectHost(fixture.url, { now: clock.now });
  try {
    const realTypes = await h.types();
    h.provenance = { ...h.provenance, commit: "9".repeat(40) };
    const calls = [];
    h.call = async (name) => { calls.push(name); throw new Error("boom"); };
    const failed = await Promise.allSettled([h.types(), h.types(), h.types()]);
    assert.ok(failed.every((r) => r.status === "rejected"), "every concurrent caller sees the one shared attempt fail");
    assert.equal(calls.length, 1, "the three concurrent callers shared one refresh attempt");
    const settled = await Promise.all([h.types(), h.types(), h.types()]);
    for (const t of settled) assert.strictEqual(t, realTypes, "the cached types, not a further attempt");
    assert.equal(calls.length, 1, "still the one attempt; the cooldown held for all three concurrent callers");
  } finally {
    await h.close();
  }
});
