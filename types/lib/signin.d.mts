import type { JWTVerifyGetKey } from "jose";
import type { SignIn } from "./config.mjs";
export type Reader = {
    sub: string;
    models: Set<string>;
};
/**
 * The reader behind an `Authorization` header: `null` without one, a visitor's; the reader and
 * the models their roles open on this site with a valid token; `signed_out` otherwise. The
 * issuer's keys default to its published set, which jose fetches once and keeps.
 * @param {SignIn} signIn
 * @param {{ jwks?: JWTVerifyGetKey; warn?: (fields: { reason: string }) => void }} [options]
 */
export declare function signInVerifier(signIn: SignIn, { jwks, warn }?: {
    jwks?: JWTVerifyGetKey;
    warn?: (fields: {
        reason: string;
    }) => void;
}): {
    /**
     * @param {string | undefined} authorization
     * @returns {Promise<Reader | null>}
     */
    reader(authorization: string | undefined): Promise<Reader | null>;
};
/**
 * The key a reader's month is kept under: the token's `sub` signed with the deployment's secret,
 * so the meter holds nothing the identity service would recognize.
 * @param {string} sub
 * @param {string} secret
 */
export declare const readerKey: (sub: string, secret: string) => string;
