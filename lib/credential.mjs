// What every identity-token source shares: the audience Anthropic's rule names on Google, a
// deadline of its own for the fetch, the error a credential's fault is named by, and the check
// that an answer is a token at all. A credential's fault says so in a sentence of this module's
// own, which holds nothing the visitor sent, so the route may log it where it logs no other
// error's message.
export const ANTHROPIC_API = "https://api.anthropic.com";
export const TOKEN_TIMEOUT_MS = 10_000;

/** @param {string} message */
export const credentialError = (message) => Object.assign(new Error(message), { name: "CredentialError" });

// Three parts, each base64url and none empty: counting the dots alone would pass a page of HTML
// that happens to hold two, and send it on to the exchange.
/**
 * @param {string} text
 * @param {string} source
 */
export function asToken(text, source) {
  const token = text.trim();
  const parts = token.split(".");
  if (parts.length !== 3 || !parts.every((p) => /^[A-Za-z0-9_-]+$/.test(p))) throw credentialError(`${source} answered something that is not a token`);
  return token;
}
