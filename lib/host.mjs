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

async function open(url) {
  const client = new Client({ name: "companygraph-chat-server", version: "0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(url)));
  const instructions = client.getInstructions() ?? "";
  const title = client.getServerVersion()?.title ?? "";
  const { tools } = await client.listTools();
  const shaped = tools.map((t) => ({ name: t.name, description: t.description ?? "", input_schema: t.inputSchema }));
  const types = await client.callTool({ name: "list_types", arguments: {} });
  return { client, instructions, title, tools: shaped, provenance: types.structuredContent?.model ?? null, types: shapeTypes(types) };
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
      typesAt = conn.provenance?.commit ?? null;
    })().finally(() => { reopening = null; });
    return reopening;
  };

  let typeList = conn.types;
  let typesAt = conn.provenance?.commit ?? null;

  const host = {
    url,
    instructions: conn.instructions,
    title: conn.title,
    tools: conn.tools,
    provenance: conn.provenance,
    // The types as of the commit the host last answered from; a re-pin of the host moves the
    // provenance on the next answer, and the message after that reads the map again.
    async types() {
      const at = host.provenance?.commit ?? null;
      if (typeList.length && at === typesAt) return typeList;
      const r = await host.call("list_types", {});
      if (!r.isError) { typeList = shapeTypes({ structuredContent: r.data }); typesAt = r.data?.model?.commit ?? at; }
      return typeList;
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
