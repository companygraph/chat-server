// The MCP host, as a client sees it. One connection per process, made at start and made again
// when a call finds it gone, since the host scales to zero as this service does and a transport
// can be dropped between two messages. What the handshake gives every client is what the model
// is given: the instructions unchanged, the tools with their descriptions and schemas unchanged.
//
// A protocol error is the host answering — it is up, and it refused, an unknown tool name being
// the usual reason — so it is thrown on as it stands and nothing is reopened. Only an error that
// is not the host speaking reopens, and two calls that fail together share the one reopening
// rather than each making a connection of their own.
//
// Every answer carries the commit the host reports, and this service is stateless where the host
// is re-pinned under it, so the provenance is taken from each answer rather than from the
// handshake alone.
import { Client, StreamableHTTPClientTransport, ProtocolError } from "@modelcontextprotocol/client";
import { ChatError } from "./errors.mjs";

const down = (url, err) => new ChatError("host_down", `the MCP host at ${url} did not answer: ${err.message}`);

// The map of types the prompt carries: which types the model declares and how many entities
// each holds, so the model lists a type when asked about a kind of thing instead of searching
// for a word no entity says. Read at connect, and again when the host's commit moves, because
// the host is re-pinned without a deploy of this service.
const shapeTypes = (r) => (r.structuredContent?.types ?? []).map((t) => ({ type: t.type, count: t.count ?? 0, owner: t.owner ?? null }));

// The model's question titles, beside the types: an older host carries no type `question` and
// would refuse it, so this is called only where `types` already says the type exists. `callFn`
// is `client.callTool` wrapped the same shape `host.call` answers in, `{ data, isError }`, so
// this reads the same whether it runs during the handshake or later over the open connection.
// A page follows `page.nextCursor` while `page.hasMore`, the entity's title arriving as `name`,
// the field every list_entities answer gives it. A failure anywhere in the pages — a refusal or
// a call that throws — is not this function's to raise: the index is a pointer, not a fact the
// chat rests an answer on, so it comes back empty and lets the caller carry on.
async function fetchQuestionTitles(callFn) {
  try {
    const titles = [];
    let cursor;
    for (;;) {
      const r = await callFn("list_entities", cursor ? { type: "question", cursor } : { type: "question" });
      if (r.isError) return [];
      const data = r.data ?? {};
      for (const e of data.entities ?? []) if (typeof e.name === "string") titles.push(e.name);
      if (!data.page?.hasMore || !data.page?.nextCursor) return titles;
      cursor = data.page.nextCursor;
    }
  } catch {
    return [];
  }
}

async function open(url) {
  const client = new Client({ name: "companygraph-chat-server", version: "0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(url)));
  const instructions = client.getInstructions() ?? "";
  const title = client.getServerVersion()?.title ?? "";
  const { tools } = await client.listTools();
  const shaped = tools.map((t) => ({ name: t.name, description: t.description ?? "", input_schema: t.inputSchema }));
  const callTool = async (name, args) => {
    const r = await client.callTool({ name, arguments: args ?? {} });
    return { data: r.structuredContent ?? null, isError: r.isError === true };
  };
  const types = await callTool("list_types", {});
  const shapedTypes = shapeTypes({ structuredContent: types.data });
  const questions = shapedTypes.some((t) => t.type === "question") ? await fetchQuestionTitles(callTool) : [];
  return { client, instructions, title, tools: shaped, provenance: types.data?.model ?? null, types: shapedTypes, questions };
}

export async function connectHost(url) {
  let conn;
  try { conn = await open(url); } catch (err) { throw down(url, err); }

  let reopening = null;
  const reopen = () => {
    reopening ??= (async () => {
      conn.client.close().catch(() => {});
      conn = await open(url);
      host.provenance = conn.provenance;
      host.title = conn.title;
      typeList = conn.types;
      questionTitles = conn.questions;
      typesAt = conn.provenance?.commit ?? null;
    })().finally(() => { reopening = null; });
    return reopening;
  };

  let typeList = conn.types;
  let questionTitles = conn.questions;
  let typesAt = conn.provenance?.commit ?? null;

  // Types and the question index refreshed together, gated by one commit, so the two can never
  // disagree about which commit of the model they describe. A failed list_types leaves both
  // caches exactly as they were — as if this type did not exist — and is retried on the next
  // call, as before. A list_types that succeeds but a question fetch that then fails does not
  // undo the type refresh: the index is a pointer a visitor's answer can do without, the types
  // are not, and the chat reads as it does on a model with no such type, not as broken.
  const ensureFresh = async () => {
    const at = host.provenance?.commit ?? null;
    if (typeList.length && at === typesAt) return;
    const r = await host.call("list_types", {});
    if (r.isError) return;
    const freshTypes = shapeTypes({ structuredContent: r.data });
    const freshQuestions = freshTypes.some((t) => t.type === "question") ? await fetchQuestionTitles(host.call) : [];
    typeList = freshTypes;
    questionTitles = freshQuestions;
    typesAt = r.data?.model?.commit ?? at;
  };

  const host = {
    url,
    instructions: conn.instructions,
    title: conn.title,
    tools: conn.tools,
    provenance: conn.provenance,
    // The types as of the commit the host last answered from; a re-pin of the host moves the
    // provenance on the next answer, and the message after that reads the map again.
    async types() {
      await ensureFresh();
      return typeList;
    },
    // The model's question titles as of the same commit as types(), read the same way and kept
    // beside it; empty wherever the type map carries no question, or the fetch failed.
    async questions() {
      await ensureFresh();
      return questionTitles;
    },
    async call(name, args) {
      const once = async () => {
        const r = await conn.client.callTool({ name, arguments: args ?? {} });
        if (r.structuredContent?.model) host.provenance = r.structuredContent.model;
        const text = r.content.filter((c) => c.type === "text").map((c) => c.text).join("\n");
        return { text, data: r.structuredContent ?? null, isError: r.isError === true };
      };
      try { return await once(); }
      catch (err) {
        if (err instanceof ProtocolError) throw err;
        try { await reopen(); } catch (e) { throw down(url, e); }
        try { return await once(); } catch (e) { if (e instanceof ProtocolError) throw e; throw down(url, e); }
      }
    },
    async close() { await conn.client.close(); },
  };
  return host;
}
