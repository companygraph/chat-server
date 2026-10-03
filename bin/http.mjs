#!/usr/bin/env node
// The process: the environment read once, the host connected, the model and the meter built,
// the server listening. PORT is what the platform sets. An operator error — an unknown flag, a
// variable not set, a host that does not answer — is one line on stderr and exit 2, never a
// stack. `--model fake` answers every message with one sentence and calls no tool, for a local
// run without a model; the meter, the identity and the log line are CHAT_METER's, CHAT_IDENTITY's
// and CHAT_LOG's, and CHAT_METER=memory is the local case.
import fs from "node:fs";
import { line, useLogFormat } from "../lib/log.mjs";
import { parseArgs } from "node:util";
import { configFromEnv } from "../lib/config.mjs";
import { connectHost } from "../lib/host.mjs";
import { modelFor } from "../lib/model.mjs";
import { Meter } from "../lib/meter.mjs";
import { Bucket } from "../lib/bucket.mjs";
import { meterStore, identityTokenSource } from "../lib/platform.mjs";
import { createHttpServer } from "../lib/http.mjs";
import { verdictCheck } from "../lib/verdict.mjs";
import { typesafeJudge } from "../lib/typesafe.mjs";

const ICON_TYPES = { ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon" };

const fakeModel = {
  name: "fake",
  provider: "fake",
  credential: "none",
  async turn(request, onText) {
    const text = "This is a local run without a model; the host answered the handshake and nothing was asked of it.";
    onText(text);
    return { content: [{ type: "text", text }], stop_reason: "end_turn", usage: { input_tokens: 0, output_tokens: 0 } };
  },
};

try {
  const { values } = parseArgs({ options: { "page-css": { type: "string" }, "page-brand": { type: "string" }, "page-icon": { type: "string" }, model: { type: "string" } } });
  const config = configFromEnv();
  useLogFormat(config.log);
  const pageCss = values["page-css"] ? fs.readFileSync(values["page-css"], "utf8") : null;
  const pageBrand = values["page-brand"] ? fs.readFileSync(values["page-brand"], "utf8").trim() : null;
  let pageIcon = null;
  if (values["page-icon"]) {
    const ext = values["page-icon"].slice(values["page-icon"].lastIndexOf(".")).toLowerCase();
    const type = ICON_TYPES[ext];
    if (!type) { console.error(`--page-icon: ${ext || "no extension"} is not one of ${Object.keys(ICON_TYPES).join(" ")}`); process.exit(2); }
    pageIcon = `data:${type};base64,${fs.readFileSync(values["page-icon"]).toString("base64")}`;
  }
  const host = await connectHost(config.mcpUrl, { questionCap: config.questionIndexChars });
  // The model calls a source as (fetch, { timeoutMs }); the platform's own values ride along.
  const source = values.model !== "fake" && config.anthropicFederation ? await identityTokenSource(config.identity) : undefined;
  const identityToken = source && ((fetchFn, options) => source(fetchFn, { ...options, ...config.identityOptions }));
  const model = values.model === "fake" ? fakeModel : modelFor(config, { identityToken });
  const store = await meterStore(config.meter, config.meterOptions);
  const meter = new Meter(store, { monthTokens: config.monthTokens });
  const bucket = new Bucket();
  // The answer check, where the deployment turned it on; the title index is read as the service
  // comes up, so the first answer does not wait on it.
  // A check that could not run is one warning line with its reason, never the answer or the key.
  const warn = (fields) => console.log(line("chat.verdict", "WARNING", { kind: "verdict", ...fields }));
  const verdict = config.verdict
    ? verdictCheck({ judge: typesafeJudge({ key: config.typesafeKey }), titles: () => host.titles(), promptTitles: async () => (await host.questions()).titles, threshold: config.verdictThreshold, warn })
    : null;
  if (verdict) host.refreshTitles().catch(() => {});
  createHttpServer({ config, host, model, meter, bucket, verdict }, { pageCss, pageBrand, pageIcon }).listen(config.port, "0.0.0.0", function () {
    const port = this.address().port, commit = host.provenance?.commit ?? null;
    console.log(line("chat.start", "INFO", { kind: "start", message: `companygraph-chat-http on :${port}, host ${config.mcpUrl} at ${commit ?? "(none)"}, model ${model.name} via ${model.provider} (${model.credential}), meter ${config.meter}, origins ${config.origins.join(" ")}, hosts ${config.hosts ? config.hosts.join(" ") : "any"}, answer check ${config.verdict ? "on" : "off"}`, port, host: config.mcpUrl, commit, model: model.name, provider: model.provider, credential: model.credential, meter: config.meter, origins: config.origins, hosts: config.hosts ?? null, verdict: config.verdict }));
  });
} catch (err) {
  console.error(err.message);
  process.exit(2);
}
