// Who a signed-in reader is and which models they may pick, read from the access token the
// identity service issued them. This is the boundary between a visitor, who gets the default and
// costs the site little, and a reader who may spend on a dearer model: a token passes only with
// a signature by one of the issuer's published keys, this issuer, an audience holding this
// project and an expiry still ahead. What fails is `signed_out`, whose sentence names nothing of
// the token, since it reaches the client; why it failed is not returned, and goes only to `warn`,
// as the one reason jose gives and never the token, its header or a claim. The issuer's key
// endpoint failing is no fault of the token, and a reader told to sign in again would sign in to
// the same failure: it is `host_down`, the identity service down, and its sentence names nothing
// of the token either.
import { createHmac } from "node:crypto";
import { createRemoteJWKSet, jwtVerify, errors } from "jose";
import { ChatError } from "./errors.mjs";
import { DEFAULT_MODEL, MODELS } from "./models.mjs";

/** @import { JWTVerifyGetKey } from "jose" */
/** @import { SignIn } from "./config.mjs" */

/** @typedef {{ sub: string; models: Set<string> }} Reader */

// The claim ZITADEL writes a token's roles into, as `{ <role>: { <organization id>: <domain> } }`,
// one entry per organization the role is granted in.
const ROLES_CLAIM = "urn:zitadel:iam:org:project:roles";

const BEARER = /^Bearer (\S+)$/i;

const signedOut = () => new ChatError("signed_out", "Your sign-in could not be confirmed; sign in again.");
const keysDown = () => new ChatError("host_down", "The sign-in service could not be reached; try again in a moment.");

// What jose throws when the key set could not be had: the endpoint timed out, answered with
// something other than 200, or answered with no key set. A generic JOSEError comes only from the
// remote key set, at jose 6. Every other JOSE error is the token's.
const KEY_FAULTS = new Set(["ERR_JWKS_TIMEOUT", "ERR_JWKS_INVALID", "ERR_JOSE_GENERIC"]);
/** @param {unknown} err */
const tokenFault = (err) => err instanceof errors.JOSEError && !KEY_FAULTS.has(err.code);

/**
 * The reader behind an `Authorization` header: `null` without one, a visitor's; the reader and
 * the models their roles open on this site with a valid token; `host_down` where the issuer's
 * keys could not be had, and `signed_out` for any other failure. The issuer's keys default to
 * its published set, which jose fetches once and keeps.
 * @param {SignIn} signIn
 * @param {{ jwks?: JWTVerifyGetKey; warn?: (fields: { reason: string }) => void }} [options]
 */
export function signInVerifier(signIn, { jwks = issuerKeys(signIn.issuer), warn } = {}) {
  return {
    /**
     * @param {string | undefined} authorization
     * @returns {Promise<Reader | null>}
     */
    async reader(authorization) {
      if (authorization === undefined) return null;
      const token = BEARER.exec(authorization)?.[1];
      if (!token) throw signedOut();
      let payload;
      try {
        // ZITADEL signs access tokens with RS256; naming it keeps a key set that serves other
        // algorithms from being asked to accept one. jose checks an expiry only where the token
        // has one, so it is required, or a token without one would pass forever.
        ({ payload } = await jwtVerify(token, jwks, { issuer: signIn.issuer, audience: signIn.projectId, algorithms: ["RS256"], requiredClaims: ["exp"] }));
      } catch (err) {
        const e = /** @type {{ code?: unknown; name?: unknown }} */ (err);
        warn?.({ reason: typeof e?.code === "string" ? e.code : String(e?.name ?? "Error") });
        throw tokenFault(err) ? signedOut() : keysDown();
      }
      if (typeof payload.sub !== "string" || payload.sub === "") throw signedOut();
      return { sub: payload.sub, models: grantedModels(payload[ROLES_CLAIM], signIn) };
    },
  };
}

// The issuer's published keys. The identity service scales to zero, so its first answer after a
// quiet spell can take longer than jose's five seconds; the keys are kept a day, and a token
// signed by a key not yet seen still fetches them again, within jose's cooldown.
/** @param {string} issuer */
const issuerKeys = (issuer) => createRemoteJWKSet(new URL(issuer + "/oauth/v2/keys"), { timeoutDuration: 20_000, cacheMaxAge: 24 * 60 * 60 * 1000 });

// The default, which every signed-in reader may pick, and each model whose role the claim
// grants here. Where the project keeps one role per site, the site's roles carry its prefix and
// hold for this site wherever they are granted; otherwise a role holds only where it is granted
// in this site's organization, so a grant on another site opens nothing here. A claim that is
// absent or not an object grants nothing.
/**
 * @param {unknown} claim
 * @param {SignIn} signIn
 */
function grantedModels(claim, signIn) {
  const roles = isObject(claim) ? claim : {};
  const models = new Set([DEFAULT_MODEL]);
  for (const [id, { role }] of Object.entries(MODELS)) {
    if (role === null) continue;
    const granted = signIn.rolePrefix !== null
      ? Object.hasOwn(roles, signIn.rolePrefix + role)
      : Object.hasOwn(roles, role) && isObject(roles[role]) && Object.hasOwn(roles[role], signIn.orgId);
    if (granted) models.add(id);
  }
  return models;
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The key a reader's month is kept under: the token's `sub` signed with the deployment's secret,
 * so the meter holds nothing the identity service would recognize.
 * @param {string} sub
 * @param {string} secret
 */
export const readerKey = (sub, secret) => createHmac("sha256", secret).update(sub).digest("hex");
