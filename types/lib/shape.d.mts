export declare const MAX_MESSAGE_CHARS = 1000;
export declare const HISTORY_TURNS = 8;
export declare const MAX_TOOL_RESULT_CHARS = 16000;
export declare const MAX_OUTPUT_TOKENS = 2400;
export declare const MAX_ROUNDS = 4;
export declare const MAX_BODY_BYTES: number;
export type Message = {
    role: "user" | "assistant";
    content: string;
};
/**
 * One turn of a conversation: the visitor's or the model's.
 * @typedef {{ role: "user" | "assistant"; content: string }} Message
 */
/**
 * @param {unknown} messages
 * @returns {Message[]}
 */
export declare function validateMessages(messages: unknown): Message[];
/** @param {Message[]} messages */
export declare function window(messages: Message[]): Message[];
/** @param {string} text */
export declare function truncate(text: string): string;
