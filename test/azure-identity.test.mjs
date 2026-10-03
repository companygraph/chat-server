import { test } from "node:test";
import assert from "node:assert/strict";
import { azureIdentityToken } from "../lib/platform/azure/identity.mjs";

const opts = { identityEndpoint: "http://localhost:42356/msi/token", identityHeader: "hdr-1", clientId: "11111111-2222-3333-4444-555555555555", audience: "api://66666666-7777-8888-9999-000000000000" };
const answer = (status, body) => async (url, init) => { answer.last = { url: String(url), init }; return new Response(typeof body === "string" ? body : JSON.stringify(body), { status }); };

test("the token is asked of the endpoint Container Apps gives, for the audience, as the user-assigned identity", async () => {
  const token = await azureIdentityToken(answer(200, { access_token: "h.p.s", expires_on: "1790000000" }), opts)();
  assert.equal(token, "h.p.s");
  const u = new URL(answer.last.url);
  assert.equal(u.origin + u.pathname, "http://localhost:42356/msi/token");
  assert.equal(u.searchParams.get("api-version"), "2019-08-01");
  assert.equal(u.searchParams.get("resource"), opts.audience);
  assert.equal(u.searchParams.get("client_id"), opts.clientId);
  assert.equal(answer.last.init.headers["X-IDENTITY-HEADER"], "hdr-1");
});

test("an answer that is not a token is a credential error naming the endpoint, before any exchange", async () => {
  await assert.rejects(azureIdentityToken(answer(401, { error: "invalid_request" }), opts)(), (e) => e.name === "CredentialError" && e.statusCode === 401 && /managed identity endpoint answered 401/.test(e.message));
  await assert.rejects(azureIdentityToken(answer(200, "<html>"), opts)(), (e) => e.name === "CredentialError" && /not JSON/.test(e.message));
  await assert.rejects(azureIdentityToken(answer(200, { token_type: "Bearer" }), opts)(), (e) => e.name === "CredentialError" && /not a token/.test(e.message));
  await assert.rejects(azureIdentityToken(answer(200, { access_token: "<html>.<p>.x y" }), opts)(), /not a token/);
});

test("an endpoint that cannot be reached, or does not answer in time, is named as such", { timeout: 3000 }, async () => {
  const down = async () => { throw new TypeError("fetch failed"); };
  // AbortSignal.timeout's timer does not keep the event loop alive, so on Node 22 this promise
  // would still be pending when the loop ends; a held timer, cleared on abort, keeps it alive for
  // exactly as long as the request is outstanding.
  const hang = (url, { signal }) => new Promise((_, reject) => {
    const held = setTimeout(() => {}, 5000);
    signal.addEventListener("abort", () => { clearTimeout(held); reject(signal.reason); });
  });
  await assert.rejects(azureIdentityToken(down, opts)(), (e) => e.name === "CredentialError" && /could not be reached: fetch failed/.test(e.message));
  await assert.rejects(azureIdentityToken(hang, { ...opts, timeoutMs: 50 })(), (e) => e.name === "CredentialError" && /could not be reached/.test(e.message));
});
