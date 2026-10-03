// Whether the answer check's probabilities mean what they say, measured before any threshold is
// written. Run by hand, with a key, never in CI, since the suite reaches no live service:
//
//   TYPESAFE_API_KEY=… node scripts/measure-verdict.mjs
//
// It runs the loop itself over the fixture host, the meta-model's worked example, with a
// scripted model: each case makes the tool calls a real answer would and writes one sentence,
// once as the evidence carries it and once with a fault planted in it — a wrong date, a skill the
// entity does not claim, a title no tool returned, an empty search said to be full — in English
// and in German. The check runs as the service runs it, budget and all. It prints each case's
// verdict, and, per tenth of probability, how often the verdict was right, which here means it
// counted a faulted sentence against the answer and a clean one not. Where that curve is near the
// diagonal, the threshold is read off it and written into the spec's §8; where it is not, the
// widget marks nothing and the kept counts are the whole use.
import { answer } from "../lib/loop.mjs";
import { connectHost } from "../lib/host.mjs";
import { Meter, MemoryStore } from "../lib/meter.mjs";
import { verdictCheck, isUnsupported } from "../lib/verdict.mjs";
import { typesafeJudge, MODEL } from "../lib/typesafe.mjs";
import { startFixtureHost } from "../test/helpers.mjs";

const key = process.env.TYPESAFE_API_KEY;
if (!key) {
  console.error("TYPESAFE_API_KEY is not set; nothing was measured.");
  process.exit(1);
}
// The measuring's own seam, so its test can stand a fake service in; the service has none.
const url = process.env.CHAT_TYPESAFE_URL;
const judge = typesafeJudge({ key, ...(url ? { url } : {}) });

const fixture = await startFixtureHost();
const host = await connectHost(fixture.url);
const idOf = async (name) => (await host.call("search", { query: name, match: "name" })).data.results[0].id;
const EXPERIENCE = "Splitting the billing domain";
const calls = {
  experience: async () => [["get_entity", { id: await idOf(EXPERIENCE) }]],
  experienceAndSkill: async () => [["get_entity", { id: await idOf(EXPERIENCE) }], ["search", { query: "Product Discovery", match: "name" }]],
  release: async () => [["get_entity", { id: await idOf("Release") }]],
  nothing: async () => [["search", { query: "quantum roadmap", match: "words" }]],
};

// Each case: the calls, and per language the clean sentence and the faulted one.
const CASES = [
  { name: "a wrong date", calls: "experience",
    en: [`${EXPERIENCE} began in February 2022.`, `${EXPERIENCE} began in March 2019.`],
    de: [`${EXPERIENCE} begann im Februar 2022.`, `${EXPERIENCE} begann im März 2019.`] },
  { name: "a skill the entity does not claim", calls: "experienceAndSkill",
    en: [`${EXPERIENCE} drew on Java Programming.`, `${EXPERIENCE} drew on Product Discovery.`],
    de: [`${EXPERIENCE} stützte sich auf Java Programming.`, `${EXPERIENCE} stützte sich auf Product Discovery.`] },
  { name: "a title no tool returned", calls: "release", faultCalls: "experience",
    en: ["Release watches the platform until the change has been exercised by real traffic.", "Release watches the platform until the change has been exercised by real traffic."],
    de: ["Release beobachtet die Plattform, bis echter Verkehr die Änderung durchlaufen hat.", "Release beobachtet die Plattform, bis echter Verkehr die Änderung durchlaufen hat."] },
  { name: "an empty search said to be full", calls: "nothing",
    en: ["The model holds nothing on a quantum roadmap.", "The quantum roadmap ships in 2027."],
    de: ["Das Modell enthält nichts zu einer Quanten-Roadmap.", "Die Quanten-Roadmap erscheint 2027."] },
];

const usage = { input_tokens: 0, output_tokens: 0 };
const run = async (toolCalls, sentence, lang) => {
  const script = [
    ...toolCalls.map(([name, input], i) => ({ content: [{ type: "tool_use", id: `tu_${i}`, name, input }], stop_reason: "tool_use", usage })),
    { content: [{ type: "text", text: sentence }], stop_reason: "end_turn", usage },
  ];
  const model = { name: "scripted", async turn(request, onText) { const msg = script.shift(); for (const c of msg.content) if (c.type === "text") onText(c.text); return msg; } };
  let event = null;
  const check = verdictCheck({ judge, titles: () => host.titles(), threshold: null, budget: 30_000 });
  await answer({ host, model, meter: new Meter(new MemoryStore(), { monthTokens: 1e9 }), verdict: async (m) => { const v = await check(m); event = v?.event ?? null; return v; } },
    { messages: [{ role: "user", content: "?" }], lang }, () => {});
  return event;
};

const points = [];
let failed = 0;
console.log(`TypeSafe ${MODEL}, over the fixture host's worked example\n`);
for (const lang of ["en", "de"]) {
  for (const c of CASES) {
    for (const [i, faulted] of [[0, false], [1, true]]) {
      const toolCalls = await calls[faulted && c.faultCalls ? c.faultCalls : c.calls]();
      const event = await run(toolCalls, c[lang][i], lang);
      const claim = event?.claims?.[0];
      if (!claim) { failed++; console.log(`  ${lang}  ${c.name}, ${faulted ? "faulted" : "clean"}: not checked`); continue; }
      const right = isUnsupported(claim.verdict) === faulted;
      console.log(`  ${lang}  ${c.name}, ${faulted ? "faulted" : "clean"}: ${claim.verdict}${claim.p === null ? "" : ` ${claim.p.toFixed(2)}`}${right ? "" : "  (wrong)"}`);
      if (claim.p !== null) points.push({ lang, p: claim.p, right });
    }
  }
}
for (const lang of ["en", "de"]) {
  console.log(`\n${lang}: the probability of the verdict, by tenth; right is how often the verdict counted the sentence as it should`);
  for (let t = 0; t < 10; t++) {
    const inside = points.filter((x) => x.lang === lang && Math.min(9, Math.floor(x.p * 10)) === t);
    console.log(`  ${(t / 10).toFixed(1)}–${((t + 1) / 10).toFixed(1)}  n=${String(inside.length).padStart(3)}  right ${inside.length ? (inside.filter((x) => x.right).length / inside.length).toFixed(2) : "—"}`);
  }
}
console.log(`\nnot checked: ${failed} answers`);
await host.close();
await fixture.close();
