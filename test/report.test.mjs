import { test } from "node:test";
import assert from "node:assert/strict";
import { weekOf, weekRange, answered, renderReport, listEntries, runReport } from "../lib/report.mjs";

const entry = (over = {}) => ({ timestamp: "2026-09-23T10:00:00Z", kind: "question", question: "What is it?", lang: "en", cited: ["e1"], calls: 1, empty: 0, rounds: 2, refused: null, ...over });

test("weekOf names the ISO week in UTC, across a year's edge", () => {
  assert.equal(weekOf(new Date("2026-09-27T23:59:59Z")), "2026-W39");
  assert.equal(weekOf(new Date("2026-09-28T00:00:00Z")), "2026-W40");
  assert.equal(weekOf(new Date("2027-01-01T12:00:00Z")), "2026-W53");
  assert.equal(weekOf(new Date("2027-01-04T12:00:00Z")), "2027-W01");
});

test("weekRange is the ISO week's Monday midnight UTC to the next, and refuses a name that is not a week", () => {
  assert.deepEqual(weekRange("2026-W39"), { from: new Date("2026-09-21T00:00:00Z"), to: new Date("2026-09-28T00:00:00Z") });
  assert.deepEqual(weekRange("2027-W01"), { from: new Date("2027-01-04T00:00:00Z"), to: new Date("2027-01-11T00:00:00Z") });
  assert.deepEqual(weekRange("2026-W53"), { from: new Date("2026-12-28T00:00:00Z"), to: new Date("2027-01-04T00:00:00Z") });
  for (const bad of ["2026-W54", "2026-W00", "2026-39", "W39", "2025-W53", "last week"]) assert.throws(() => weekRange(bad), /a week is YYYY-Www/, bad);
});

test("answered is no refusal and either something cited or a call that found something", () => {
  assert.equal(answered(entry()), true);
  assert.equal(answered(entry({ refused: "over_day" })), false);
  assert.equal(answered(entry({ cited: ["e1"], refused: "host_down" })), false);
  // A list answer cites nothing, since a cite is made only from an entity answer, yet the model
  // had the rows: the calls that found something say so.
  assert.equal(answered(entry({ cited: [], calls: 4, empty: 1 })), true);
  assert.equal(answered(entry({ cited: [], calls: 2, empty: 2 })), false, "every call found nothing");
  assert.equal(answered(entry({ cited: [], calls: 0, empty: 0 })), false, "the model asked no tool");
  assert.equal(answered(entry({ cited: [], calls: undefined, empty: undefined })), false, "a line without the counts");
});

test("the report counts, splits by language, ranks the cited and lists the unanswered in full", () => {
  const entries = [
    entry(),
    entry({ question: "Was hat er gemacht?", lang: "de", cited: ["e1", "e2"] }),
    entry({ question: "Who is xqzv?", cited: [], empty: 1 }),
    entry({ question: "Ist das Modell offen?", lang: "de", cited: [], calls: 0, rounds: 0, refused: "closed" }),
  ];
  const md = renderReport(entries, { week: "2026-W39", from: new Date("2026-09-21T06:00:00Z"), to: new Date("2026-09-28T06:00:00Z") });
  assert.match(md, /^# Chat questions, week 2026-W39\n/);
  assert.match(md, /4 questions, 2 answered, 2 not\./);
  assert.match(md, /\| en \| 2 \| 1 \|/);
  assert.match(md, /\| de \| 2 \| 1 \|/);
  assert.match(md, /\| e1 \| 2 \|\n\| e2 \| 1 \|/);
  assert.match(md, /\| Who is xqzv\? \| en \| 1 \| 1 \| — \|/);
  assert.match(md, /\| Ist das Modell offen\? \| de \| 0 \| 0 \| closed \|/);
  assert.ok(!md.includes("Was hat er gemacht?"), "an answered question is not listed");
});

test("a question with a pipe or a newline keeps its row whole", () => {
  const md = renderReport([entry({ question: "a | b\nc", cited: [], empty: 1 })], { week: "2026-W39", from: new Date(0), to: new Date(0) });
  assert.match(md, /\| a \\\| b c \| en \| 1 \| 1 \| — \|/);
});

test("a backslash before a pipe stays a backslash, and the pipe stays escaped", () => {
  const md = renderReport([entry({ question: "a\\|b", cited: [], empty: 1 })], { week: "2026-W39", from: new Date(0), to: new Date(0) });
  assert.match(md, /\| a\\\\\\\|b \| en \|/);
});

test("a tag in a question is shown as text, never as markup", () => {
  const md = renderReport([entry({ question: "<img src=x onerror=alert(1)> & co", cited: [], empty: 1 })], { week: "2026-W39", from: new Date(0), to: new Date(0) });
  assert.ok(!md.includes("<img"), "no raw tag");
  assert.match(md, /&lt;img src=x onerror=alert\(1\)&gt; &amp; co/);
});

test("a week with no question still writes a report that says so", () => {
  const md = renderReport([], { week: "2026-W39", from: new Date("2026-09-21T06:00:00Z"), to: new Date("2026-09-28T06:00:00Z") });
  assert.match(md, /0 questions, 0 answered, 0 not\./);
  assert.ok(!md.includes("## Not answered"), "no empty table");
});

test("listEntries follows nextPageToken to the end and keeps only question entries", async () => {
  const bodies = [];
  const request = async (body) => {
    bodies.push(body);
    if (!body.pageToken) return { entries: [{ timestamp: "t1", jsonPayload: entry() }, { timestamp: "t2", textPayload: "noise" }], nextPageToken: "p2" };
    return { entries: [{ timestamp: "t3", jsonPayload: entry({ question: "second page" }) }] };
  };
  const from = new Date("2026-09-21T06:00:00Z"), to = new Date("2026-09-28T06:00:00Z");
  const got = await listEntries(request, "projects/p/locations/r/buckets/chat-questions/views/questions", { from, to });
  assert.deepEqual(got.map((e) => e.question), ["What is it?", "second page"]);
  assert.equal(got[0].timestamp, "t1");
  assert.equal(bodies.length, 2);
  assert.deepEqual(bodies[0].resourceNames, ["projects/p/locations/r/buckets/chat-questions/views/questions"]);
  assert.equal(bodies[0].filter, `timestamp >= "2026-09-21T06:00:00.000Z" AND timestamp < "2026-09-28T06:00:00.000Z"`);
  assert.equal(bodies[0].orderBy, "timestamp asc");
  assert.equal(bodies[0].pageSize, 1000);
  assert.equal(bodies[1].pageToken, "p2");
});

test("runReport covers the ISO week that holds yesterday, whatever the hour it runs, writes the file and prints counts only", async () => {
  const calls = { list: [], put: [], out: [] };
  const now = new Date("2026-09-28T09:47:00Z");
  const r = await runReport({
    list: async (range) => { calls.list.push(range); return [entry(), entry({ question: "secret words", cited: [], empty: 1 })]; },
    put: async (name, text) => { calls.put.push({ name, text }); },
    now,
    out: (s) => calls.out.push(s),
  });
  assert.deepEqual(r, { week: "2026-W39", total: 2, answered: 1 });
  assert.deepEqual(calls.list[0], { from: new Date("2026-09-21T00:00:00Z"), to: new Date("2026-09-28T00:00:00Z") });
  assert.equal(calls.put[0].name, "reports/2026-W39.md");
  assert.match(calls.put[0].text, /secret words/);
  assert.equal(calls.out.length, 1);
  assert.match(calls.out[0], /2026-W39: 2 questions, 1 answered/);
  assert.ok(!calls.out.join("").includes("secret words"), "no question on standard output");
});

test("runReport on a Sunday night names the week still running, so Monday's run rewrites the same file complete", async () => {
  const calls = [];
  const r = await runReport({ list: async (range) => { calls.push(range); return []; }, put: async () => {}, now: new Date("2026-09-27T23:30:00Z"), out: () => {} });
  assert.equal(r.week, "2026-W39");
  assert.deepEqual(calls[0], { from: new Date("2026-09-21T00:00:00Z"), to: new Date("2026-09-28T00:00:00Z") });
});

test("runReport takes a week by name and rebuilds it, and refuses a name that is not a week", async () => {
  const calls = { list: [], put: [] };
  const r = await runReport({ list: async (range) => { calls.list.push(range); return [entry()]; }, put: async (name) => { calls.put.push(name); }, now: new Date("2026-09-28T06:00:00Z"), out: () => {}, week: "2026-W37" });
  assert.deepEqual(r, { week: "2026-W37", total: 1, answered: 1 });
  assert.deepEqual(calls.list[0], { from: new Date("2026-09-07T00:00:00Z"), to: new Date("2026-09-14T00:00:00Z") });
  assert.deepEqual(calls.put, ["reports/2026-W37.md"]);
  await assert.rejects(runReport({ list: async () => [], put: async () => {}, week: "yesterday" }), /a week is YYYY-Www/);
});
