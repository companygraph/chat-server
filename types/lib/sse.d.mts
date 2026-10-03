/** @param {import("node:http").ServerResponse} res */
export declare function sse(res: import("node:http").ServerResponse): {
    /**
     * @param {string} event
     * @param {unknown} data
     */
    send(event: string, data: unknown): void;
    readonly opened: boolean;
    end(): void;
};
