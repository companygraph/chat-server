import type { Host, Title } from "./host.mjs";
import type { Model } from "./model.mjs";
import type { Meter } from "./meter.mjs";
import type { Signals } from "./errors.mjs";
import type { verdictCheck } from "./verdict.mjs";
export type Cite = {
    id: string;
    title: string;
    type: string | null;
    url: string | null;
};
export type Diagram = {
    shape: unknown;
    title: unknown;
    mermaid: string;
    nodes: {
        node: string;
        id: string;
        title: string;
        type?: unknown;
    }[];
    omitted: unknown;
    links: {
        from: string;
        to: string;
        label: string;
    }[];
    everyType?: {
        via: string;
        to: string;
        multiplicity: string;
    }[];
    core?: string | null;
    edges?: unknown;
};
export declare const NAME_CAP = 300;
/**
 * @param {any} data
 * @param {Title[]} [out]
 * @returns {Title[]}
 */
export declare function namesIn(data: any, out?: Title[]): Title[];
/** @param {{ isError?: boolean; data?: any }} r */
export declare function foundNothing(r: {
    isError?: boolean;
    data?: any;
}): boolean;
/**
 * @param {string} name
 * @param {{ isError?: boolean; data?: any } | null | undefined} r
 * @returns {Diagram | null}
 */
export declare function diagramOf(name: string, r: {
    isError?: boolean;
    data?: any;
} | null | undefined): Diagram | null;
/** @param {Diagram} d */
export declare const diagramNote: (d: Diagram) => string;
/**
 * @param {Host} host
 * @param {any} data
 * @returns {Promise<Title[]>}
 */
export declare function namesPastTheCap(host: Host, data: any): Promise<Title[]>;
/**
 * @param {{ host: Host; model: Model; meter: Meter; questionCap?: number; verdict?: ReturnType<typeof verdictCheck> | null }} services
 * @param {{ messages: unknown; lang?: string | null | undefined; signal?: AbortSignal | undefined }} request
 * @param {(event: string, data: unknown) => void} emit
 * @returns {Promise<Signals & { spent: number }>}
 */
export declare function answer({ host, model, meter, questionCap, verdict }: {
    host: Host;
    model: Model;
    meter: Meter;
    questionCap?: number;
    verdict?: ReturnType<typeof verdictCheck> | null;
}, { messages, lang, signal }: {
    messages: unknown;
    lang?: string | null | undefined;
    signal?: AbortSignal | undefined;
}, emit: (event: string, data: unknown) => void): Promise<Signals & {
    spent: number;
}>;
