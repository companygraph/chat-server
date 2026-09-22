// The MCP host, as a client sees it. One connection per process, made at start and made again
// when a call finds it gone, since the host scales to zero as this service does and a transport
// can be dropped between two messages. What the handshake gives every client is what the model
// is given: the instructions unchanged, the tools with their descriptions and schemas unchanged.
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
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

  const host = {
    url,
    instructions: conn.instructions,
    tools: conn.tools,
    provenance: conn.provenance,
    async call(name, args) {
      const once = async () => {
        const r = await conn.client.callTool({ name, arguments: args ?? {} });
        const text = r.content.filter((c) => c.type === "text").map((c) => c.text).join("\n");
        return { text, data: r.structuredContent ?? null, isError: r.isError === true };
      };
      try { return await once(); }
      catch (first) {
        try { conn.client.close().catch(() => {}); conn = await open(url); host.provenance = conn.provenance; }
        catch (err) { throw down(url, err); }
        try { return await once(); } catch (err) { throw down(url, err); }
      }
    },
    async close() { await conn.client.close(); },
  };
  return host;
}
