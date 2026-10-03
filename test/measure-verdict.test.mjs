// The measuring script, run against a fake TypeSafe so the suite reaches no live service: every
// case is run through the real loop and checked, and the curves are printed.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../scripts/measure-verdict.mjs", import.meta.url));
const run = (env) => new Promise((done, fail) => {
  const child = spawn(process.execPath, [script], { env });
  let out = "", err = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (err += d));
  child.on("error", fail);
  child.on("close", (code) => done({ code, out, err }));
});
const withoutKey = () => { const env = { ...process.env }; delete env.TYPESAFE_API_KEY; delete env.CHAT_TYPESAFE_URL; return env; };

test("without a key nothing is measured", async () => {
  const { code, err } = await run(withoutKey());
  assert.equal(code, 1);
  assert.match(err, /TYPESAFE_API_KEY is not set; nothing was measured\./);
});

test("every case is run through the loop and checked, in both languages, and both curves are printed", async () => {
  const seen = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      const body = JSON.parse(raw);
      seen.push(body);
      const answers = Object.fromEntries(Object.keys(body.questions).map((id) => [id, { type: "choice", choice: "supported", probabilities: { supported: 0.9 } }]));
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ answers }));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    const { code, out } = await run({ ...withoutKey(), TYPESAFE_API_KEY: "k", CHAT_TYPESAFE_URL: `http://127.0.0.1:${server.address().port}/v1/systemone` });
    assert.equal(code, 0, out);
    assert.equal(out.split("\n").filter((l) => /^ {2}(en|de) {2}/.test(l)).length, 32);
    assert.match(out, /^ {2}en {2}a title no tool returned, faulted: unsourced$/m);
    assert.match(out, /^en: the probability/m);
    assert.match(out, /^de: the probability/m);
    assert.match(out, /^not checked: 0 answers$/m);
    assert.ok(seen.length > 0 && seen.every((b) => b.model === "jev-1.13.0"));
  } finally {
    server.close();
  }
});
