// Whether the output limits and the call times per effort hold on every model, measured before
// the release names them done (the plan's Task B8). A paid replay, run by hand, with the owner's
// key in the shell, never in CI:
//
//   node scripts/measure-effort.mjs                 prints what a replay would cost; calls nothing
//   node scripts/measure-effort.mjs --estimate      the same
//   ANTHROPIC_API_KEY=… node scripts/measure-effort.mjs --run [--questions N]
//
// It runs the loop itself, `answer()`, over the fixture host, the meta-model's worked example,
// with the real model, asking each of the example's own questions once per model and effort:
// every model at `low`, and Fable 5.1 and Opus 5.5 at every effort. Each message is a signed-in
// reader's, with a reader's meter beside the site's, since only a reader is offered anything but
// Sonnet 5 at `low` and only a reader's call is bound whole by its effort's time. It records per
// message the rounds, the seconds, the last call's stop reason, whether that call was cut by the
// output limit, whether the message's deadline made a round final before the rounds ran out, and
// what the completed calls cost in the meter's units and in dollars. The table it prints is also
// written to `.superpowers/measure-effort-<date>.md`, which git ignores. Where a cut or a deadline
// shows, the effort's limit or its rounds are changed in `lib/models.mjs` and the replay is run
// again, and the final table goes into the spec's section 6 with its date.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { answer } from "../lib/loop.mjs";
import { connectHost } from "../lib/host.mjs";
import { anthropicModel } from "../lib/model.mjs";
import { Meter, ReaderMeter, MemoryStore, estimateFor, units, ESTIMATE_INPUT } from "../lib/meter.mjs";
import { MODELS, EFFORTS, outputLimit } from "../lib/models.mjs";
import { MAX_ROUNDS } from "../lib/shape.mjs";
import { startFixtureHost, QUESTION_TITLES } from "../test/helpers.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
// The meter's unit is one Sonnet 5 input token, $2 a million.
const DOLLARS_PER_UNIT = 2 / 1_000_000;
// A month no replay comes near, so the meter never refuses and only counts.
const MONTH = 1e12;
// The most calls one message can make: a call in each round up to the cap and the final one. A
// silence asked again jumps to the final round, so it adds none.
const MOST_CALLS = MAX_ROUNDS + 1;
// What the likely figure assumes: one round that calls the tools, then the answer, each writing a
// quarter of what the effort allows.
const LIKELY_CALLS = 2;
const LIKELY_OUTPUT_SHARE = 0.25;

const usage = (problem) => {
  console.error(`${problem}\nusage: node scripts/measure-effort.mjs [--estimate | --run] [--questions N]`);
  process.exit(2);
};
const args = process.argv.slice(2);
let mode = null, take = QUESTION_TITLES.length;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--estimate" || a === "--run") {
    if (mode && mode !== a) usage("--estimate and --run are each other's opposite; name one.");
    mode = a;
  } else if (a === "--questions") {
    const n = Number(args[++i]);
    if (!Number.isInteger(n) || n < 1) usage("--questions takes a whole number of at least 1.");
    take = Math.min(n, QUESTION_TITLES.length);
  } else usage(`unknown argument ${a}`);
}
mode ??= "--estimate";
const questions = QUESTION_TITLES.slice(0, take);

// Every model at `low`, then Fable 5.1 and Opus 5.5 at each effort above it.
const choices = [
  ...Object.keys(MODELS).map((model) => ({ model, effort: "low" })),
  ...["claude-fable-5-1", "claude-opus-5-5"].flatMap((model) => EFFORTS.filter((e) => e !== "low").map((effort) => ({ model, effort }))),
];

const n = (x) => Math.round(x).toLocaleString("en-US");
const usd = (u, digits = 2) => `$${(u * DOLLARS_PER_UNIT).toFixed(digits)}`;
const label = (c) => MODELS[c.model].label;

if (mode === "--estimate") {
  const rows = choices.map((c) => {
    const w = MODELS[c.model].weights;
    const call = estimateFor(c);
    const likelyCall = ESTIMATE_INPUT * w.input + LIKELY_OUTPUT_SHARE * outputLimit(c.effort) * w.output;
    return { c, call, upper: call * MOST_CALLS * questions.length, likely: Math.ceil(likelyCall * LIKELY_CALLS * questions.length) };
  });
  const upper = rows.reduce((s, r) => s + r.upper, 0), likely = rows.reduce((s, r) => s + r.likely, 0);
  console.log(`measure-effort: ${choices.length} choices × ${questions.length} questions = ${choices.length * questions.length} messages; nothing was called.`);
  console.log("");
  console.log(`Upper bound: every call held at the meter's estimate, ${n(ESTIMATE_INPUT)} input tokens at the model's input weight and the effort's whole output limit at its output weight, with nothing read from the cache, and every message taking the most calls one can, ${MOST_CALLS} (${MAX_ROUNDS} rounds that call tools and the answer). A round whose prompt grows past ${n(ESTIMATE_INPUT)} tokens costs more input than this counts.`);
  console.log(`Likely: one round that calls the tools and then the answer, ${LIKELY_CALLS} calls a message, each with ${n(ESTIMATE_INPUT)} input tokens uncached and writing ${LIKELY_OUTPUT_SHARE * 100}% of the effort's output limit.`);
  console.log("");
  console.log("| Model | Effort | Output limit | Estimate a call | Upper bound | Likely |");
  console.log("| --- | --- | ---: | ---: | ---: | ---: |");
  for (const r of rows) console.log(`| ${label(r.c)} | ${r.c.effort} | ${n(outputLimit(r.c.effort))} | ${n(r.call)} | ${n(r.upper)} (${usd(r.upper)}) | ${n(r.likely)} (${usd(r.likely)}) |`);
  console.log("");
  console.log(`Total: upper bound ${n(upper)} units (${usd(upper)}), likely ${n(likely)} units (${usd(likely)}), at $2 a million units, one Sonnet 5 input token each.`);
  process.exit(0);
}

const key = process.env.ANTHROPIC_API_KEY;
if (!key) {
  console.error("ANTHROPIC_API_KEY is not set; nothing was measured.");
  process.exit(1);
}

const fixture = await startFixtureHost();
const host = await connectHost(fixture.url);
// The title index answers at once from what it has read, so the measuring reads it first, as the
// service does when it comes up.
await host.refreshTitles();
const model = anthropicModel({ apiKey: key });
const meter = new Meter(new MemoryStore(), { monthTokens: MONTH });
const reader = new ReaderMeter(new MemoryStore(), { monthTokens: MONTH });

const rows = [];
let total = 0;
for (const choice of choices) {
  for (const question of questions) {
    /** What each completed call of this message stopped with and cost. */
    const calls = [];
    let index = 0, deadline = false;
    // The loop's own model, watched: a request that forbids a tool call before the cap's round is
    // one the deadline made final. A silence asked again is the cap's round and sends no
    // tool_choice, so it is not counted as the deadline's.
    const watched = {
      ...model,
      async turn(request, onText, options) {
        if (request.tool_choice?.type === "none" && index < MAX_ROUNDS) deadline = true;
        index++;
        const msg = await model.turn(request, onText, options);
        calls.push({ stop: msg.stop_reason, units: units(msg.usage, choice.model) });
        return msg;
      },
    };
    const started = performance.now();
    let rounds = 0, error = "";
    try {
      ({ rounds } = await answer({ host, model: watched, meter }, { messages: [{ role: "user", content: question }], lang: "en", choice, reader }, () => {}));
    } catch (err) {
      error = err.code ?? (err.status ? `HTTP ${err.status}` : err.message);
      rounds = err.signals?.rounds ?? calls.length;
    }
    const seconds = (performance.now() - started) / 1000;
    const spent = calls.reduce((s, c) => s + c.units, 0);
    total += spent;
    const stop = calls.at(-1)?.stop ?? "—";
    const row = { choice, question, rounds, seconds, stop, cut: stop === "max_tokens", deadline, units: spent, error };
    rows.push(row);
    console.error(`${label(choice)} ${choice.effort}: ${question} — ${rounds} rounds, ${seconds.toFixed(1)} s, ${stop}${error ? `, ${error}` : ""}`);
  }
}
await host.close();
await fixture.close();

const date = new Date().toISOString().slice(0, 10);
const lines = [
  `# Effort on every model, measured on ${date}`,
  "",
  `The example's questions asked once each through \`answer()\` over the fixture host, as a signed-in reader. Units are the meter's, one Sonnet 5 input token at $2 a million, and count the calls that completed; a call cut by its time reports no usage and counts nothing here.`,
  "",
  "| Model | Effort | Question | Rounds | Seconds | Stop | Cut | Deadline final | Units | Dollars | Error |",
  "| --- | --- | --- | ---: | ---: | --- | --- | --- | ---: | ---: | --- |",
  ...rows.map((r) => `| ${label(r.choice)} | ${r.choice.effort} | ${r.question} | ${r.rounds} | ${r.seconds.toFixed(1)} | ${r.stop} | ${r.cut ? "yes" : "no"} | ${r.deadline ? "yes" : "no"} | ${n(r.units)} | ${usd(r.units, 4)} | ${r.error} |`),
  "",
  `Total spent: ${n(total)} units (${usd(total)}).`,
];
const text = lines.join("\n") + "\n";
console.log(text);
const out = path.join(ROOT, ".superpowers", `measure-effort-${date}.md`);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, text);
console.error(`written to ${path.relative(ROOT, out)}`);
