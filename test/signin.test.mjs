import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, jwtVerify } from "jose";
import { signInVerifier, readerKey } from "../lib/signin.mjs";
import { ChatError } from "../lib/errors.mjs";

const ISSUER = "https://id.example.test";
const PROJECT = "project-1";
const SITE_ORG = "org-site";
const OTHER_ORG = "org-other";
const ROLES = "urn:zitadel:iam:org:project:roles";

const { publicKey, privateKey } = await generateKeyPair("RS256");
const publicJwk = { ...(await exportJWK(publicKey)), alg: "RS256", kid: "k1" };
const jwks = createLocalJWKSet({ keys: [publicJwk] });
const foreign = await generateKeyPair("RS256");

/** @type {import("../lib/config.mjs").SignIn} */
const SIGN_IN = { issuer: ISSUER, projectId: PROJECT, orgId: SITE_ORG, userMonthTokens: 5000000, readerSecret: "s", rolePrefix: null };

/**
 * @param {Record<string, unknown>} claims
 * @param {{ key?: CryptoKey; issuer?: string; audience?: string | string[]; expires?: string | number }} [options]
 */
async function token(claims = {}, { key = privateKey, issuer = ISSUER, audience = [PROJECT, "client-1"], expires = "1h" } = {}) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setSubject("reader-1")
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime(expires)
    .sign(key);
}

/** @param {Promise<unknown>} promise */
async function signedOut(promise) {
  await assert.rejects(promise, (err) => {
    assert.ok(err instanceof ChatError);
    assert.equal(err.code, "signed_out");
    assert.equal(err.status, 401);
    return true;
  });
}

test("noHeaderIsVisitor", async () => {
  assert.equal(await signInVerifier(SIGN_IN, { jwks }).reader(undefined), null);
});

test("notBearerSignedOut", async () => {
  const v = signInVerifier(SIGN_IN, { jwks });
  await signedOut(v.reader("Basic abc"));
  await signedOut(v.reader("Bearer "));
  await signedOut(v.reader(`Token ${await token()}`));
});

test("badSignatureSignedOut", async () => {
  await signedOut(signInVerifier(SIGN_IN, { jwks }).reader(`Bearer ${await token({}, { key: foreign.privateKey })}`));
});

test("foreignIssuerSignedOut", async () => {
  await signedOut(signInVerifier(SIGN_IN, { jwks }).reader(`Bearer ${await token({}, { issuer: "https://id.elsewhere.test" })}`));
});

test("otherAudienceSignedOut", async () => {
  await signedOut(signInVerifier(SIGN_IN, { jwks }).reader(`Bearer ${await token({}, { audience: "another-project" })}`));
});

test("expiredSignedOut", async () => {
  await signedOut(signInVerifier(SIGN_IN, { jwks }).reader(`Bearer ${await token({}, { expires: Math.floor(Date.now() / 1000) - 600 })}`));
});

test("signedOutSaysNothingOfTheToken", async () => {
  await assert.rejects(signInVerifier(SIGN_IN, { jwks }).reader(`Bearer ${await token({}, { issuer: "https://id.elsewhere.test" })}`), (err) => {
    assert.ok(err instanceof Error);
    assert.doesNotMatch(err.message, /iss|elsewhere|claim|signature|exp/i);
    return true;
  });
});

test("roleOfThisSite", async () => {
  const reader = await signInVerifier(SIGN_IN, { jwks }).reader(`Bearer ${await token({ [ROLES]: { opus: { [SITE_ORG]: "blust.ch" } } })}`);
  assert.equal(reader?.sub, "reader-1");
  assert.deepEqual([...(reader?.models ?? [])].sort(), ["claude-opus-5-5", "claude-sonnet-5"]);
});

test("roleOfAnotherSite", async () => {
  const reader = await signInVerifier(SIGN_IN, { jwks }).reader(`Bearer ${await token({ [ROLES]: { opus: { [OTHER_ORG]: "x" } } })}`);
  assert.deepEqual([...(reader?.models ?? [])], ["claude-sonnet-5"]);
});

test("noRolesIsSonnetOnly", async () => {
  const v = signInVerifier(SIGN_IN, { jwks });
  for (const claims of [{}, { [ROLES]: "opus" }, { [ROLES]: null }, { [ROLES]: ["opus"] }]) {
    const reader = await v.reader(`Bearer ${await token(claims)}`);
    assert.deepEqual([...(reader?.models ?? [])], ["claude-sonnet-5"], JSON.stringify(claims));
  }
});

test("prefixVariant", async () => {
  const v = signInVerifier({ ...SIGN_IN, rolePrefix: "blust-ch-" }, { jwks });
  const granted = await v.reader(`Bearer ${await token({ [ROLES]: { "blust-ch-fable": { [OTHER_ORG]: "blust.ch" } } })}`);
  assert.deepEqual([...(granted?.models ?? [])].sort(), ["claude-fable-5-1", "claude-sonnet-5"]);
  const other = await v.reader(`Bearer ${await token({ [ROLES]: { "companygraph-io-fable": { [OTHER_ORG]: "blust.ch" } } })}`);
  assert.deepEqual([...(other?.models ?? [])], ["claude-sonnet-5"]);
  // With a prefix the unprefixed role opens nothing, even granted in the site's organization.
  const bare = await v.reader(`Bearer ${await token({ [ROLES]: { fable: { [SITE_ORG]: "blust.ch" } } })}`);
  assert.deepEqual([...(bare?.models ?? [])], ["claude-sonnet-5"]);
});

test("emptySubSignedOut", async () => {
  const v = signInVerifier(SIGN_IN, { jwks });
  for (const claims of [{}, { sub: "" }, { sub: 7 }]) {
    const t = await new SignJWT(claims).setProtectedHeader({ alg: "RS256", kid: "k1" }).setIssuer(ISSUER).setAudience(PROJECT).setExpirationTime("1h").sign(privateKey);
    await signedOut(v.reader(`Bearer ${t}`));
  }
});

test("onlyRs256", async () => {
  // A key set whose key names no algorithm serves PS256 as readily as RS256, and the token below
  // verifies when no algorithm is required; the verifier still takes RS256 only.
  const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const loose = createLocalJWKSet({ keys: [{ ...(await exportJWK(pair.publicKey)), kid: "k2" }] });
  const ps = await new SignJWT({}).setProtectedHeader({ alg: "PS256", kid: "k2" }).setSubject("reader-1").setIssuer(ISSUER).setAudience(PROJECT).setExpirationTime("1h").sign(pair.privateKey);
  await jwtVerify(ps, loose, { issuer: ISSUER, audience: PROJECT });
  await signedOut(signInVerifier(SIGN_IN, { jwks: loose }).reader(`Bearer ${ps}`));
});

test("readerKeyIsStable", () => {
  const a = readerKey("reader-1", "secret-a");
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.equal(readerKey("reader-1", "secret-a"), a);
  assert.notEqual(readerKey("reader-1", "secret-b"), a);
  assert.notEqual(readerKey("reader-2", "secret-a"), a);
});
