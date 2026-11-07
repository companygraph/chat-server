import { test } from "node:test";
import assert from "node:assert/strict";
import { vaultSecret } from "../lib/platform/azure/vault.mjs";

const URL_ = "https://chatexample.vault.azure.net/secrets/chat-reader-secret";
const OPTIONS = { identityEndpoint: "http://localhost:42356/msi/token", identityHeader: "h", clientId: "c" };
const TOKEN = "eyJ.vault.token";

// The identity endpoint signs a token for the vault's audience; the vault answers with the value.
const fetchOf = (vault, seen = []) => async (url, init) => {
  const u = new URL(url);
  seen.push(u);
  if (u.host === "localhost:42356") return { ok: true, status: 200, json: async () => ({ access_token: TOKEN }) };
  assert.equal(init.headers.Authorization, `Bearer ${TOKEN}`);
  return vault;
};

test("the secret is read with a token for the vault, at the latest version", async () => {
  const seen = [];
  const value = await vaultSecret(URL_, { ...OPTIONS, fetchFn: fetchOf({ ok: true, status: 200, json: async () => ({ value: "the-value" }) }, seen) });
  assert.equal(value, "the-value");
  assert.equal(seen[0].searchParams.get("resource"), "https://vault.azure.net");
  assert.equal(seen[0].searchParams.get("client_id"), "c");
  assert.equal(seen[1].origin + seen[1].pathname, URL_);
  assert.equal(seen[1].searchParams.get("api-version"), "7.4");
});

test("a vault that refuses, answers no JSON or holds no value says so and names neither value nor token", async () => {
  const cases = [
    [{ ok: false, status: 403, json: async () => ({}) }, /the key vault answered 403 for https:\/\/chatexample.vault.azure.net\/secrets\/chat-reader-secret/],
    [{ ok: true, status: 200, json: async () => { throw new Error("x"); } }, /not JSON/],
    [{ ok: true, status: 200, json: async () => ({ value: "" }) }, /holds no value/],
  ];
  for (const [answer, re] of cases) {
    await assert.rejects(vaultSecret(URL_, { ...OPTIONS, fetchFn: fetchOf(answer) }), (e) => re.test(e.message) && !e.message.includes(TOKEN));
  }
});
