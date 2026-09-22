// The model and what a request to it looks like. The name, the effort and the price weights
// live together so that they move together: the meter counts in this model's ratios, and a
// deployment does not choose the model.
//
// The prefix is marked for caching in two places, the system text and the last tool, so the
// rounds of one message and the messages of one conversation within five minutes pay the
// cache-hit price for what they resend. The conversation itself is not marked: its tail is
// new on every round.
import { AnthropicVertex } from "@anthropic-ai/vertex-sdk";
import { MAX_OUTPUT_TOKENS } from "./shape.mjs";

export const MODEL = "claude-sonnet-5";
export const EFFORT = "low";
export const WEIGHTS = { input: 1, cacheWrite: 1.25, cacheRead: 0.1, output: 5 };

const ephemeral = { type: "ephemeral" };

export function params({ system, tools, messages, final = false }) {
  const marked = tools.map((t, i) => (i === tools.length - 1 ? { ...t, cache_control: ephemeral } : t));
  const r = {
    model: MODEL,
    max_tokens: MAX_OUTPUT_TOKENS,
    output_config: { effort: EFFORT },
    system: [{ type: "text", text: system, cache_control: ephemeral }],
    tools: marked,
    messages,
  };
  if (final) r.tool_choice = { type: "none" };
  return r;
}

// `turn` is the one thing the loop needs of a model: send a request, forward text as it comes,
// hand back the final message. A test's fake implements the same and nothing else.
export function vertexModel({ project, region }) {
  const client = new AnthropicVertex({ projectId: project, region });
  return {
    name: MODEL,
    async turn(request, onText) {
      const stream = client.messages.stream(request);
      stream.on("text", (delta) => onText(delta));
      return await stream.finalMessage();
    },
  };
}
