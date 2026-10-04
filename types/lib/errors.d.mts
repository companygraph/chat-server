export declare const CODES: {
    readonly bad_request: 400;
    readonly too_long: 400;
    readonly foreign: 403;
    readonly busy: 429;
    readonly over_day: 429;
    readonly over_month: 429;
    readonly host_down: 502;
    readonly closed: 503;
};
export type RefusalKind = keyof typeof CODES;
export type Signals = {
    cited: string[];
    calls: number;
    empty: number;
    rounds: number;
    claims?: number;
    unsupported?: number;
};
/** @typedef {keyof typeof CODES} RefusalKind */
/** @typedef {{ cited: string[]; calls: number; empty: number; rounds: number; claims?: number; unsupported?: number }} Signals */
export declare class ChatError extends Error {
    code: "bad_request" | "busy" | "closed" | "foreign" | "host_down" | "over_day" | "over_month" | "too_long";
    status: 400 | 403 | 429 | 502 | 503;
    retryAt: string | undefined;
    /**
     * @param {RefusalKind} code
     * @param {string} message
     * @param {{ retryAt?: number | string | Date | undefined }} [options]
     */
    constructor(code: RefusalKind, message: string, { retryAt }?: {
        retryAt?: number | string | Date | undefined;
    });
}
/** @param {ChatError} err */
export declare const refusal: (err: ChatError) => {
    error: {
        code: "bad_request" | "busy" | "closed" | "foreign" | "host_down" | "over_day" | "over_month" | "too_long";
        message: string;
        retryAt?: string;
    };
};
