// Azure's Container Apps give an app a local endpoint that signs a token for the app's managed
// identity, for any audience the tenant knows: here the app registration standing for the Claude
// API, api://<client id>, since Entra issues no token for an audience it does not hold. The app
// has only its user-assigned identity, so the request names it by client id, or the endpoint would
// look for a system-assigned one. The status, the JSON and the token's shape are checked here, and
// the fetch has a deadline of its own, as the Google source does.
import { TOKEN_TIMEOUT_MS, credentialError, asToken } from "../../credential.mjs";

const SOURCE = "the managed identity endpoint";

export const azureIdentityToken = (fetchFn = fetch, { timeoutMs = TOKEN_TIMEOUT_MS, identityEndpoint, identityHeader, clientId, audience } = {}) => async () => {
  const url = new URL(identityEndpoint);
  url.searchParams.set("api-version", "2019-08-01");
  url.searchParams.set("resource", audience);
  url.searchParams.set("client_id", clientId);
  let res;
  try {
    res = await fetchFn(url, { headers: { "X-IDENTITY-HEADER": identityHeader }, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    throw credentialError(`${SOURCE} could not be reached: ${err?.message ?? err}`);
  }
  if (!res.ok) throw Object.assign(credentialError(`${SOURCE} answered ${res.status} when asked for an identity token`), { statusCode: res.status });
  let body;
  try {
    body = await res.json();
  } catch {
    throw credentialError(`${SOURCE} answered something that is not JSON`);
  }
  return asToken(String(body?.access_token ?? ""), SOURCE);
};
