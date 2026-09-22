// The model and what a request to it looks like. The name, the effort and the price weights
// live together so that they move together: the meter counts in this model's ratios, and a
// deployment does not choose the model.
//
// Two marks carry the cache. The system text is one, and it covers the tools with it, since a
// request renders tools, then system, then messages, and a mark caches everything up to itself.
// The other is the last block of the last message, because the prefix up to the newest block is
// exactly what the next round and the next message of a conversation resend: mark the tail and
// each round pays the cache-hit price for every round before it.
import { AnthropicVertex } from "@anthropic-ai/vertex-sdk";
import { MAX_OUTPUT_TOKENS } from "./shape.mjs";
import { ChatError } from "./errors.mjs";

export const MODEL = "claude-sonnet-5";
export const EFFORT = "low";
export const WEIGHTS = { input: 1, cacheWrite: 1.25, cacheRead: 0.1, output: 5 };

const ephemeral = { type: "ephemeral" };

// The caller's conversation is the loop's own array, and it is read again on the next round, so
// the mark is written on copies: a new list, a new last message, a new last block.
function markTail(messages) {
  if (messages.length === 0) return messages;
  const last = messages[messages.length - 1];
  const content = typeof last.content === "string"
    ? [{ type: "text", text: last.content, cache_control: ephemeral }]
    : last.content.map((b, i) => (i === last.content.length - 1 ? { ...b, cache_control: ephemeral } : b));
  return [...messages.slice(0, -1), { ...last, content }];
}

export function params({ system, tools, messages, final = false }) {
  const r = {
    model: MODEL,
    max_tokens: MAX_OUTPUT_TOKENS,
    output_config: { effort: EFFORT },
    system: [{ type: "text", text: system, cache_control: ephemeral }],
    tools,
    messages: markTail(messages),
  };
  if (final) r.tool_choice = { type: "none" };
  return r;
}

// A 429 is the project's quota for the minute, which is the fence working rather than a defect,
// so the visitor gets the sentence that says to come back; anything else is what it was.
export const asChatError = (err) =>
  err?.status === 429 ? new ChatError("busy", "the model is busy; try again in a minute") : err;

// `turn` is the one thing the loop needs of a model: send a request, forward text as it comes,
// hand back the final message. A test's fake implements the same and nothing else.
//
// The client is built on the first turn and kept, not at start: its constructor begins resolving
// Google's credentials, and a process that never answers a message — a test run, a build — has
// none and must not be asked for them.
export function vertexModel({ project, region }) {
  let client;
  return {
    name: MODEL,
    async turn(request, onText, { signal } = {}) {
      client ??= new AnthropicVertex({ projectId: project, region, maxRetries: 1, timeout: 60_000 });
      try {
        const stream = client.messages.stream(request, { signal });
        stream.on("text", (delta) => onText(delta));
        return await stream.finalMessage();
      } catch (err) {
        throw asChatError(err);
      }
    },
  };
}
