// The Google Cloud the service runs on signs a token for its own account on request, for the
// audience the federation rule pins; `full` puts the account's email in it, which the rule
// matches beside the numeric id. The status and the token's shape are checked here because an
// error page sent on as an assertion comes back from the exchange as a bare 401, and the fetch
// has a deadline of its own, since it runs before the client's timeout starts counting.
import { ANTHROPIC_API, TOKEN_TIMEOUT_MS, credentialError, asToken } from "../../credential.mjs";

export const METADATA_IDENTITY_URL = `http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience=${ANTHROPIC_API}&format=full`;

export const googleIdentityToken = (fetchFn = fetch, { timeoutMs = TOKEN_TIMEOUT_MS } = {}) => async () => {
  let res;
  try {
    res = await fetchFn(METADATA_IDENTITY_URL, { headers: { "Metadata-Flavor": "Google" }, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    throw credentialError(`the metadata server could not be reached: ${(/** @type {Error} */ (err))?.message ?? err}`);
  }
  if (!res.ok) throw Object.assign(credentialError(`the metadata server answered ${res.status} when asked for an identity token`), { statusCode: res.status });
  return asToken(await res.text(), "the metadata server");
};
