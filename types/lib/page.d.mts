import type { Provenance } from "./host.mjs";
export type PageInput = {
    config: {
        mcpUrl: string;
        origins: string[];
        monthTokens: number;
        provider?: string;
    };
    host: {
        title?: string;
        instructions?: string;
        provenance: Provenance | null;
    };
    origin: string;
    css?: string | null;
    brand?: string | null;
    icon?: string | null;
};
/** @param {PageInput} input */
export declare function renderPage({ config, host, origin, css, brand, icon }: PageInput): string;
