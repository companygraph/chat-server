import Anthropic from "@anthropic-ai/sdk";
import type { Config, Federation } from "./config.mjs";
export type Request = Anthropic.MessageStreamParams;
export type MessagesClient = {
    messages: {
        stream: (request: Request, options: {
            signal?: AbortSignal | undefined;
        }) => {
            on: (event: "text", listener: (delta: string) => void) => unknown;
            finalMessage: () => Promise<Anthropic.Message>;
        };
    };
};
export type Model = {
    name: string;
    provider: string;
    credential: string;
    turn: (request: Request, onText: (delta: string) => void, options?: {
        signal?: AbortSignal | undefined;
    }) => Promise<Anthropic.Message>;
};
/**
 * @import { Config, Federation } from "./config.mjs"
 * @import { IdentityTokenSource } from "./platform.mjs"
 */
/**
 * The request one turn sends: the Messages surface's own streaming parameters.
 * @typedef {Anthropic.MessageStreamParams} Request
 */
/**
 * The part of a client a turn uses, which the Anthropic SDK's client and the Vertex one share.
 * @typedef {{ messages: { stream: (request: Request, options: { signal?: AbortSignal | undefined }) => { on: (event: "text", listener: (delta: string) => void) => unknown; finalMessage: () => Promise<Anthropic.Message> } } }} MessagesClient
 */
/**
 * What the loop needs of a model: who it is, who answers for it and with what credential, and `turn`.
 * @typedef {{ name: string; provider: string; credential: string; turn: (request: Request, onText: (delta: string) => void, options?: { signal?: AbortSignal | undefined }) => Promise<Anthropic.Message> }} Model
 */
export declare const MODEL = "claude-sonnet-5";
export declare const EFFORT = "low";
export declare const WEIGHTS: {
    input: number;
    cacheWrite: number;
    cacheRead: number;
    output: number;
};
export declare const FINAL_NOTE = "No further tool can be called in this message. Write the answer now from what the tools have answered, naming the entities it rests on, and where they did not say, say the model does not say.";
/**
 * @param {{ system: string; tools: Anthropic.Tool[]; messages: Anthropic.MessageParam[]; final?: boolean }} turn
 * @returns {Request}
 */
export declare function params({ system, tools, messages, final }: {
    system: string;
    tools: Anthropic.Tool[];
    messages: Anthropic.MessageParam[];
    final?: boolean;
}): Request;
/**
 * @param {unknown} err
 * @param {() => number} [now]
 */
export declare const asChatError: (err: unknown, now?: () => number) => unknown;
/** @param {() => MessagesClient | Promise<MessagesClient>} build */
export declare const overForTest: (build: () => MessagesClient | Promise<MessagesClient>) => Model;
/** @param {{ project: string | null; region: string | null }} where */
export declare const vertexModel: ({ project, region }: {
    project: string | null;
    region: string | null;
}) => Model;
/**
 * @param {unknown} err
 * @returns {(Error & { statusCode?: number }) | null}
 */
export declare const credentialFault: (err: unknown) => (Error & {
    statusCode?: number;
}) | null;
/**
// A region, where one is given, rides on every request as `inference_geo`; none given, the
// request names none and the Console workspace's default decides.
/**
 * @param {{ apiKey?: string | undefined; federation?: Federation; identityToken?: ((fetchFn: typeof globalThis.fetch, options: { timeoutMs: number }) => () => Promise<string>) | undefined; fetch?: typeof globalThis.fetch; tokenTimeoutMs?: number; inferenceGeo?: "global" | "us" | null }} options
 */
export declare const anthropicModel: ({ apiKey, federation, identityToken, fetch: fetchFn, tokenTimeoutMs, inferenceGeo }: {
    apiKey?: string | undefined;
    federation?: Federation;
    identityToken?: ((fetchFn: typeof globalThis.fetch, options: {
        timeoutMs: number;
    }) => () => Promise<string>) | undefined;
    fetch?: typeof globalThis.fetch;
    tokenTimeoutMs?: number;
    inferenceGeo?: "global" | "us" | null;
}) => Model;
/**
 * @param {Config} config
 * @param {{ identityToken?: ((fetchFn: typeof globalThis.fetch, options: { timeoutMs: number }) => () => Promise<string>) | undefined; fetch?: typeof globalThis.fetch }} [options]
 */
export declare const modelFor: (config: Config, { identityToken, fetch }?: {
    identityToken?: ((fetchFn: typeof globalThis.fetch, options: {
        timeoutMs: number;
    }) => () => Promise<string>) | undefined;
    fetch?: typeof globalThis.fetch;
}) => Model;
