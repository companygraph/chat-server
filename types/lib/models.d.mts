export type Effort = "low" | "medium" | "high" | "xhigh" | "max";
export type Choice = {
    model: string;
    effort: Effort;
};
/** @typedef {"low" | "medium" | "high" | "xhigh" | "max"} Effort */
/** @typedef {{ model: string; effort: Effort }} Choice */
export declare const DEFAULT_MODEL = "claude-sonnet-5";
export declare const DEFAULT_EFFORT = "low";
/** @type {Record<string, { label: string; role: string | null; weights: { input: number; cacheWrite: number; cacheRead: number; output: number } }>} */
export declare const MODELS: Record<string, {
    label: string;
    role: string | null;
    weights: {
        input: number;
        cacheWrite: number;
        cacheRead: number;
        output: number;
    };
}>;
/** @type {Effort[]} */
export declare const EFFORTS: Effort[];
/** @type {Choice} */
export declare const DEFAULT_CHOICE: Choice;
/** @param {Effort} effort */
export declare const outputLimit: (effort: Effort) => number;
/** @param {Effort} effort */
export declare const callTimeoutMs: (effort: Effort) => 60000 | 840000;
