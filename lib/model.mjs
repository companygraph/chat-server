// The model and what a request to it looks like. The name, the effort and the price weights
// live together so that they move together: the meter counts in this model's ratios, and a
// deployment does not choose the model.
//
// Two providers answer the same request: Vertex AI in the deployment's own project, or the
// Anthropic API direct, with a key or with the service's own identity traded for a short-lived
// token. Both speak the same Messages surface, so one `turn` covers every client; only how the
// client is built differs.
//
// Two marks carry the cache. The system text is one, and it covers the tools with it, since a
// request renders tools, then system, then messages, and a mark caches everything up to itself.
// The other is the last block of the last message, because the prefix up to the newest block is
// exactly what the next round and the next message of a conversation resend: mark the tail and
// each round pays the cache-hit price for every round before it.
import Anthropic from "@anthropic-ai/sdk";
import { oidcFederationProvider } from "@anthropic-ai/sdk/lib/credentials/oidc-federation";
import { WorkloadIdentityError } from "@anthropic-ai/sdk/lib/credentials/types";
import { MAX_OUTPUT_TOKENS } from "./shape.mjs";
import { ChatError } from "./errors.mjs";
import { ANTHROPIC_API, TOKEN_TIMEOUT_MS } from "./credential.mjs";

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

// The last request forbids a tool call, and says so. Told only by tool_choice, a model that
// still meant to call one answers with nothing, a message of no blocks and one output token,
// and the visitor reads no answer at all. So the final request adds this sentence after the
// last tool's answer, and the model writes from what it has.
export const FINAL_NOTE = "No further tool can be called in this message. Write the answer now from what the tools have answered, naming the entities it rests on, and where they did not say, say the model does not say.";

// On copies, like the mark: the loop reads its own array again on no round after the final one,
// but a caller's message is not this module's to rewrite.
function withFinalNote(messages) {
  if (messages.length === 0) return messages;
  const last = messages[messages.length - 1];
  if (last.role !== "user") return messages;
  const content = typeof last.content === "string" ? [{ type: "text", text: last.content }] : last.content;
  return [...messages.slice(0, -1), { ...last, content: [...content, { type: "text", text: FINAL_NOTE }] }];
}

export function params({ system, tools, messages, final = false }) {
  const r = {
    model: MODEL,
    max_tokens: MAX_OUTPUT_TOKENS,
    output_config: { effort: EFFORT },
    system: [{ type: "text", text: system, cache_control: ephemeral }],
    tools,
    messages: markTail(final ? withFinalNote(messages) : messages),
  };
  if (final) r.tool_choice = { type: "none" };
  return r;
}

// A 429 is the project's quota for the minute, which is the fence working rather than a defect,
// so the visitor gets the sentence that says to come back, and the moment one minute on, the
// quantum the quota is counted in; the SDK's error carries nothing more exact that this reads.
// Anything else is what it was.
export const asChatError = (err, now = Date.now) =>
  err?.status === 429 ? new ChatError("busy", "the model is busy; try again in a minute", { retryAt: now() + 60_000 }) : err;

// `turn` is the one thing the loop needs of a model: send a request, forward text as it comes,
// hand back the final message. A test's fake implements the same and nothing else.
//
// The client is built on the first turn and kept, not at start: the Vertex SDK is loaded only
// then, and its constructor begins resolving Google's credentials, which a process that never
// answers a message — a test run, a build — has none of. A build that failed is forgotten, so
// the next turn tries again rather than repeat one failure for the life of the process.
function over(provider, credential, build) {
  let client;
  return {
    name: MODEL,
    provider,
    credential,
    async turn(request, onText, { signal } = {}) {
      try {
        client ??= Promise.resolve().then(build).catch((err) => { client = undefined; throw err; });
        const c = await client;
        const stream = c.messages.stream(request, { signal });
        stream.on("text", (delta) => onText(delta));
        return await stream.finalMessage();
      } catch (err) {
        throw asChatError(err);
      }
    },
  };
}

export const overForTest = (build) => over("test", "none", build);

export const vertexModel = ({ project, region }) =>
  over("vertex", "google", async () => {
    const { AnthropicVertex } = await import("@anthropic-ai/vertex-sdk");
    return new AnthropicVertex({ projectId: project, region, maxRetries: 1, timeout: 60_000 });
  });

// The fault of a credential, this module's own or the SDK's about the exchange, on the error or
// the one it wraps; null for any other, whose message may repeat the request.
export const credentialFault = (err) => [err, err?.cause].find((e) => e?.name === "CredentialError" || e instanceof WorkloadIdentityError) ?? null;

// The Anthropic API direct: the same Messages surface and the same model id, with a key, or with
// the service's identity traded through workload identity federation for a token that lives
// minutes, which the SDK's own cache refreshes before it lapses. The key and the auth token are
// stated as null on the federated client, since the SDK otherwise reads a key from the
// environment and a key outranks every other credential. The key is the design's documented
// swap for a project whose Vertex quota is not granted, and either way the Console workspace's
// spend limit is the hard monthly stop. The identity token comes from the platform the service
// runs on, chosen by CHAT_IDENTITY and handed in, so this module names no cloud.
export const anthropicModel = ({ apiKey, federation, identityToken, fetch: fetchFn = globalThis.fetch, tokenTimeoutMs = TOKEN_TIMEOUT_MS }) => {
  if (!apiKey && !identityToken) throw new Error("a federated model needs an identity token source");
  return apiKey
    ? over("anthropic", "key", () => new Anthropic({ apiKey, maxRetries: 1, timeout: 60_000 }))
    : over("anthropic", "federation", () => new Anthropic({
      apiKey: null,
      authToken: null,
      credentials: oidcFederationProvider({
        identityTokenProvider: identityToken(fetchFn, { timeoutMs: tokenTimeoutMs }),
        federationRuleId: federation.ruleId,
        organizationId: federation.organizationId,
        serviceAccountId: federation.serviceAccountId,
        workspaceId: federation.workspaceId ?? undefined,
        baseURL: ANTHROPIC_API,
        fetch: (url, init = {}) => fetchFn(url, { ...init, signal: init.signal ?? AbortSignal.timeout(tokenTimeoutMs) }),
      }),
      fetch: fetchFn,
      maxRetries: 1,
      timeout: 60_000,
    }));
};

export const modelFor = (config, { identityToken } = {}) =>
  config.anthropicKey ? anthropicModel({ apiKey: config.anthropicKey })
    : config.anthropicFederation ? anthropicModel({ federation: config.anthropicFederation, identityToken })
      : vertexModel({ project: config.project, region: config.region });
