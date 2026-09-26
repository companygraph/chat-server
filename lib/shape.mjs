// The bounds of one request, which make one model call's cost a known ceiling whatever a
// visitor sends. Every number here is the design's; a change to one is a change to what a
// message can cost, and to docs/INTERFACE.md.
import { ChatError } from "./errors.mjs";

export const MAX_MESSAGE_CHARS = 1000;
export const HISTORY_TURNS = 8;
export const MAX_TOOL_RESULT_CHARS = 16000;
export const MAX_OUTPUT_TOKENS = 2400;
export const MAX_ROUNDS = 4;
export const MAX_BODY_BYTES = 64 * 1024;
// What the widget shows as a conversation's length. A courtesy to the reader, not a bound the
// server relies on: the window below is the bound.
export const CONVERSATION_MESSAGES = 20;

const bad = (m) => new ChatError("bad_request", m);

// A conversation is user and assistant turns alternating and ending in user, each a string.
// The strings are trimmed here, once, so the length that is judged is the length that is sent.
export function validateMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) throw bad("messages must be a non-empty list");
  const out = messages.map((m, i) => {
    if (!m || typeof m !== "object" || typeof m.content !== "string") throw bad(`message ${i} needs a string content`);
    const role = i % 2 === 0 ? "user" : "assistant";
    if (m.role !== role) throw bad(`message ${i} must be ${role}: turns alternate and begin with user`);
    return { role, content: m.content.trim() };
  });
  if (out[out.length - 1].role !== "user") throw bad("the conversation must end with the visitor's message");
  for (const m of out) if (m.role === "user" && m.content.length > MAX_MESSAGE_CHARS)
    throw new ChatError("too_long", `a message is over ${MAX_MESSAGE_CHARS} characters`);
  return out;
}

// At most the last HISTORY_TURNS turns. A conversation begins and ends with the visitor, so its
// length is odd and the last eight begin with an assistant turn, which the model may not be
// given first; that turn is dropped, and seven reach the model.
export function window(messages) {
  const tail = messages.slice(-HISTORY_TURNS);
  return tail[0]?.role === "assistant" ? tail.slice(1) : tail;
}

export function truncate(text) {
  if (text.length <= MAX_TOOL_RESULT_CHARS) return text;
  return text.slice(0, MAX_TOOL_RESULT_CHARS) + `\n\n[truncated at ${MAX_TOOL_RESULT_CHARS} characters; ask for one entity or a smaller page to see the rest]`;
}
