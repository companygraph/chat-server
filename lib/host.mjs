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

async function open(url) {
  const client = new Client({ name: "companygraph-chat-server", version: "0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(url)));
  const instructions = client.getInstructions() ?? "";
  const { tools } = await client.listTools();
  const shaped = tools.map((t) => ({ name: t.name, description: t.description ?? "", input_schema: t.inputSchema }));
  const types = await client.callTool({ name: "list_types", arguments: {} });
  return { client, instructions, tools: shaped, provenance: types.structuredContent?.model ?? null };
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
    })().finally(() => { reopening = null; });
    return reopening;
  };

  const host = {
    url,
    instructions: conn.instructions,
    tools: conn.tools,
    provenance: conn.provenance,
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
