import http from "node:http";
import type { Config } from "./config.mjs";
import type { Host } from "./host.mjs";
import type { Model } from "./model.mjs";
import type { Meter } from "./meter.mjs";
import type { Bucket } from "./bucket.mjs";
import type { verdictCheck } from "./verdict.mjs";
export type Services = {
    config: Config;
    host: Host;
    model: Model;
    meter: Meter;
    bucket: Bucket;
    log?: (line: string) => void;
    verdict?: ReturnType<typeof verdictCheck> | null;
};
export type PageOptions = {
    pageCss?: string | null;
    pageBrand?: string | null;
    pageIcon?: string | null;
};
/**
 * @param {Services} services
 * @param {PageOptions} [page]
 */
export declare function createHttpServer({ config, host, model, meter, bucket, log, verdict }: Services, { pageCss, pageBrand, pageIcon }?: PageOptions): http.Server<typeof http.IncomingMessage, typeof http.ServerResponse>;
