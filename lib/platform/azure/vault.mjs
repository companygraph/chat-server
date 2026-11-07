// The reader secret on Azure, read from its key vault as the app's own identity when the service
// starts. It is not a Container Apps secret, because Container Apps hands a secret's value, even
// one that only references a vault, to anyone allowed to list the app's secrets, and the
// pull-request plan identity is allowed to. The vault is read by role, and only the app's
// identity and the owner hold one there. No error names the value, and none names the token.
import { azureIdentityToken } from "./identity.mjs";

const VAULT_AUDIENCE = "https://vault.azure.net";
const API_VERSION = "7.4";

/**
 * The secret at a vault URL without a version, the latest one. A rotation reaches each replica
 * as it starts, and Container Apps starts one on each scale from zero and on each revision.
 * @param {string} url
 * @param {{ fetchFn?: typeof globalThis.fetch; timeoutMs?: number; identityEndpoint?: string; identityHeader?: string; clientId?: string }} [options]
 * @returns {Promise<string>}
 */
export async function vaultSecret(url, { fetchFn = fetch, timeoutMs = 10_000, ...identity } = {}) {
  const token = await azureIdentityToken(fetchFn, { ...identity, audience: VAULT_AUDIENCE, timeoutMs })();
  const at = new URL(url);
  at.searchParams.set("api-version", API_VERSION);
  let res;
  try {
    res = await fetchFn(at, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    throw new Error(`the key vault could not be reached: ${(/** @type {Error} */ (err))?.message ?? err}`);
  }
  if (!res.ok) throw new Error(`the key vault answered ${res.status} for ${at.origin}${at.pathname}`);
  let body;
  try {
    body = await res.json();
  } catch {
    throw new Error("the key vault answered something that is not JSON");
  }
  const value = /** @type {{ value?: unknown } | undefined} */ (body)?.value;
  if (typeof value !== "string" || value === "") throw new Error(`the key vault holds no value at ${at.origin}${at.pathname}`);
  return value;
}
