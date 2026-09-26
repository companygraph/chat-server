#!/usr/bin/env node
// The process: the environment read once, the host connected, the model and the meter built,
// the server listening. PORT is what Cloud Run sets. An operator error — an unknown flag, a
// variable not set, a host that does not answer — is one line on stderr and exit 2, never a
// stack. `--model fake` answers every message with one sentence and calls no tool, for a local
// run without Vertex; `--meter` is CHAT_METER's, and `memory` is the local case.
import fs from "node:fs";
import { line } from "../lib/log.mjs";
import { parseArgs } from "node:util";
import { configFromEnv } from "../lib/config.mjs";
import { connectHost } from "../lib/host.mjs";
import { modelFor } from "../lib/model.mjs";
import { Meter, MemoryStore } from "../lib/meter.mjs";
import { FirestoreStore } from "../lib/firestore.mjs";
import { Bucket } from "../lib/bucket.mjs";
import { createHttpServer } from "../lib/http.mjs";

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
  const model = values.model === "fake" ? fakeModel : modelFor(config);
  const store = config.meter === "memory" ? new MemoryStore() : new FirestoreStore();
  const meter = new Meter(store, { monthTokens: config.monthTokens });
  const bucket = new Bucket();
  createHttpServer({ config, host, model, meter, bucket }, { pageCss, pageBrand, pageIcon }).listen(config.port, "0.0.0.0", function () {
    const port = this.address().port, commit = host.provenance?.commit ?? null;
    console.log(line("chat.start", "INFO", { kind: "start", message: `companygraph-chat-http on :${port}, host ${config.mcpUrl} at ${commit ?? "(none)"}, model ${model.name} via ${model.provider} (${model.credential}), meter ${config.meter}, origins ${config.origins.join(" ")}, hosts ${config.hosts ? config.hosts.join(" ") : "any"}`, port, host: config.mcpUrl, commit, model: model.name, provider: model.provider, credential: model.credential, meter: config.meter, origins: config.origins, hosts: config.hosts ?? null }));
  });
} catch (err) {
  console.error(err.message);
  process.exit(2);
}
