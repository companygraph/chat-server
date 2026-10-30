import { Client } from "@modelcontextprotocol/client";
import type Anthropic from "@anthropic-ai/sdk";
import type { TypeCount } from "./prompt.mjs";
export type Provenance = {
    commit: string | null;
    repo: string | null;
    core: string;
    parser: string;
};
export type HostTool = Anthropic.Tool;
export type Title = {
    id: string;
    title: string;
};
export type HostAnswer = {
    text: string;
    data: any;
    isError: boolean;
};
export type CallFn = (name: string, args?: Record<string, unknown>) => Promise<{
    data: any;
    isError: boolean;
}>;
export type Conn = {
    client: Client;
    instructions: string;
    title: string;
    tools: HostTool[];
    provenance: Provenance | null;
    types: TypeCount[];
    questionTitles: string[];
    questionsMore: boolean;
    questionsResolved: boolean;
};
export type Host = {
    url: string;
    instructions: string;
    title: string;
    tools: HostTool[];
    provenance: Provenance | null;
    types: () => Promise<TypeCount[]>;
    questions: () => Promise<{
        titles: string[];
        more: boolean;
    }>;
    titles: () => Title[];
    refreshTitles: () => Promise<Title[]>;
    call: (name: string, args?: Record<string, unknown>) => Promise<HostAnswer>;
    close: () => Promise<void>;
};
/** @param {unknown} err */
export declare const staleTools: (err: unknown) => boolean;
export declare const REFRESH_FAILURE_COOLDOWN_MS = 30000;
export declare const START_WAITS_MS: number[];
export declare const START_ATTEMPT_MS = 10000;
export type StartWarning = {
    message: string;
    attempt: number;
    attempts: number;
    reason: string;
    retry_in_ms: number | null;
};
/**
 * @param {string} url
 * @param {{ questionCap?: number; now?: () => number; sleep?: (ms: number) => Promise<void>; warn?: (fields: StartWarning) => void; attemptMs?: number }} [options]
 * @returns {Promise<Host>}
 */
export declare function connectHost(url: string, { questionCap, now, sleep, warn, attemptMs }?: {
    questionCap?: number;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
    warn?: (fields: StartWarning) => void;
    attemptMs?: number;
}): Promise<Host>;
