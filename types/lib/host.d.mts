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
/**
 * @param {string} url
 * @param {{ questionCap?: number; now?: () => number }} [options]
 * @returns {Promise<Host>}
 */
export declare function connectHost(url: string, { questionCap, now }?: {
    questionCap?: number;
    now?: () => number;
}): Promise<Host>;
