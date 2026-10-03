export type LogFormat = "google" | "plain";
/**
 * @typedef {"google" | "plain"} LogFormat
 */
export declare const LOG_FORMATS: {
    google: (logger: string, severity: string, fields: Record<string, unknown>) => {
        severity: string;
        "logging.googleapis.com/labels": {
            logger: string;
        };
    };
    plain: (logger: string, severity: string, fields: Record<string, unknown>) => {
        severity: string;
        logger: string;
    };
};
/**
 * @param {LogFormat} kind
 * @param {string} logger
 * @param {string} severity
 * @param {Record<string, unknown>} fields
 */
export declare const formatLine: (kind: LogFormat, logger: string, severity: string, fields: Record<string, unknown>) => string;
/** @param {string} kind */
export declare const useLogFormat: (kind: string) => void;
/**
 * @param {string} logger
 * @param {string} severity
 * @param {Record<string, unknown>} fields
 */
export declare const line: (logger: string, severity: string, fields: Record<string, unknown>) => string;
