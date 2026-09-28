import { test } from "node:test";
import assert from "node:assert/strict";
import { listRows, azureQuestions, QUERY } from "../lib/platform/azure/questions.mjs";

const range = { from: new Date("2026-09-21T00:00:00Z"), to: new Date("2026-09-28T00:00:00Z") };
const table = (rows) => ({ tables: [{ name: "PrimaryResult", columns: [{ name: "TimeGenerated", type: "datetime" }, { name: "Log", type: "string" }], rows }] });
const q = (question, extra = {}) => JSON.stringify({ severity: "INFO", logger: "chat.question", kind: "question", question, lang: "en", cited: [], calls: 1, empty: 0, rounds: 1, refused: null, ...extra });

test("the week's rows are asked for by their own interval, and each question line becomes an entry", async () => {
  let asked;
  const got = await listRows(async (body) => { asked = body; return table([["2026-09-22T10:00:00Z", q("Who?")], ["2026-09-23T10:00:00Z", q("Why?", { lang: "de" })]]); }, range);
  assert.deepEqual(asked, { query: QUERY, timespan: "2026-09-21T00:00:00.000Z/2026-09-28T00:00:00.000Z" });
  assert.deepEqual(got.map((e) => [e.timestamp, e.question, e.lang, e.logger]), [["2026-09-22T10:00:00Z", "Who?", "en", "chat.question"], ["2026-09-23T10:00:00Z", "Why?", "de", "chat.question"]]);
});

test("a line that is not JSON, or not a question, is passed over", async () => {
  const got = await listRows(async () => table([["t1", "Error: boom\n    at x (y.js:1:1)"], ["t2", JSON.stringify({ kind: "start" })], ["t3", q("Kept")], ["t4", null]]), range);
  assert.deepEqual(got.map((e) => e.question), ["Kept"]);
});

test("an answer in part is refused rather than counted short", async () => {
  await assert.rejects(listRows(async () => ({ ...table([]), error: { code: "PartialError", message: "some shards failed" } }), range), /^Error: Log Analytics answered only in part: some shards failed$/);
});

test("the source signs in once, queries the chat's workspace, and writes the week's file to the reports container", async () => {
  const calls = [];
  const credential = { getToken: async (scope) => { calls.push(["token", scope]); return { token: "tok" }; } };
  const fetchFn = async (url, init) => { calls.push(["fetch", url, init.headers.authorization, JSON.parse(init.body).timespan]); return new Response(JSON.stringify(table([["t", q("Q")]]))); };
  const uploads = [];
  const container = { getBlockBlobClient: (name) => ({ upload: async (text, length, opts) => uploads.push({ name, text, length, type: opts.blobHTTPHeaders.blobContentType }) }) };
  const s = await azureQuestions({ platform: "azure" }, { storage_account: "chatacct", questions_workspace_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" }, { credential, fetchFn, container });
  assert.equal(s.where, "https://chatacct.blob.core.windows.net/reports");
  assert.equal((await s.list(range)).length, 1);
  assert.deepEqual(calls[0], ["token", "https://api.loganalytics.io/.default"]);
  assert.deepEqual(calls[1], ["fetch", "https://api.loganalytics.azure.com/v1/workspaces/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/query", "Bearer tok", "2026-09-21T00:00:00.000Z/2026-09-28T00:00:00.000Z"]);
  await s.put("reports/2026-W39.md", "# Über\n");
  assert.deepEqual(uploads, [{ name: "reports/2026-W39.md", text: "# Über\n", length: 8, type: "text/markdown; charset=utf-8" }]);
});

test("a chat.json the apply has not yet filled in is named, before anything signs in", async () => {
  const credential = { getToken: async () => { throw new Error("signed in"); } };
  await assert.rejects(azureQuestions({}, { storage_account: "chatacct" }, { credential }), /^Error: chat.json names no questions_workspace_id; write the chat apply's questions_workspace_id output into it$/);
  await assert.rejects(azureQuestions({}, { questions_workspace_id: "x" }, { credential }), /^Error: chat.json names no storage_account$/);
});

test("a query the service refuses is named by its status", async () => {
  const credential = { getToken: async () => ({ token: "tok" }) };
  const s = await azureQuestions({}, { storage_account: "a", questions_workspace_id: "w" }, { credential, fetchFn: async () => new Response("no", { status: 403 }), container: {} });
  await assert.rejects(s.list(range), /^Error: Log Analytics answered 403$/);
});
