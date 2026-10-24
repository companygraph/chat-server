// The paid replay's estimate, which calls nothing: the suite runs the script without a key and
// with its base address on a port nothing answers, so no call could reach a model even by mistake.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { estimateFor } from "../lib/meter.mjs";
import { MODELS, EFFORTS } from "../lib/models.mjs";
import { MAX_ROUNDS } from "../lib/shape.mjs";
import { QUESTION_TITLES } from "./helpers.mjs";

const script = fileURLToPath(new URL("../scripts/measure-effort.mjs", import.meta.url));
const run = (args, env) => new Promise((done, fail) => {
  const child = spawn(process.execPath, [script, ...args], { env });
  let out = "", err = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (err += d));
  child.on("error", fail);
  child.on("close", (code) => done({ code, out, err }));
});
const offline = () => { const env = { ...process.env, ANTHROPIC_BASE_URL: "http://127.0.0.1:9" }; delete env.ANTHROPIC_API_KEY; return env; };

// Every model at low, and Fable and Opus at the four efforts above it.
const matrix = [...Object.keys(MODELS).map((model) => ({ model, effort: "low" })), ...["claude-fable-5-1", "claude-opus-5-5"].flatMap((model) => EFFORTS.slice(1).map((effort) => ({ model, effort })))];
const upper = (questions) => matrix.reduce((s, c) => s + estimateFor(c) * (MAX_ROUNDS + 1) * questions, 0).toLocaleString("en-US");

test("with no flag the script estimates, calls nothing, and holds every call at its estimate for the most calls a message can make", async () => {
  const { code, out } = await run([], offline());
  assert.equal(code, 0, out);
  const q = QUESTION_TITLES.length;
  assert.match(out, new RegExp(`^measure-effort: 13 choices × ${q} questions = ${13 * q} messages; nothing was called\\.$`, "m"));
  assert.equal(out.split("\n").filter((l) => /^\| (Sonnet|Opus|Fable|Haiku) /.test(l)).length, 13);
  const fableMax = estimateFor({ model: "claude-fable-5-1", effort: "max" }).toLocaleString("en-US");
  assert.ok(out.split("\n").some((l) => l.startsWith(`| Fable 5.1 | max | 64,000 | ${fableMax} |`)), out);
  assert.match(out, new RegExp(`^Total: upper bound ${upper(q)} units`, "m"));
  assert.match(out, /^Likely: one round that calls the tools and then the answer/m);
});

test("--questions takes the first questions only, and --run refuses without a key", async () => {
  const { code, out } = await run(["--estimate", "--questions", "2"], offline());
  assert.equal(code, 0, out);
  assert.match(out, /^measure-effort: 13 choices × 2 questions = 26 messages/m);
  assert.match(out, new RegExp(`^Total: upper bound ${upper(2)} units`, "m"));
  const refused = await run(["--run"], offline());
  assert.equal(refused.code, 1);
  assert.match(refused.err, /ANTHROPIC_API_KEY is not set; nothing was measured\./);
  assert.equal((await run(["--questions", "0"], offline())).code, 2);
});
