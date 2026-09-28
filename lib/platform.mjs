// Each port's adapters, named by the value that chooses them. An adapter is imported only when it
// is chosen, so a deployment loads the cloud SDK of the platform it runs on and no other, and the
// config reads the allowed values from the keys here rather than from a list of its own.
// A package an adapter needs and the image does not hold is an operator's error, said in one
// sentence naming the choice that asked for it; any other failure is the adapter's own.
export async function load(variable, value, importer) {
  try {
    return await importer();
  } catch (err) {
    if (err?.code === "ERR_MODULE_NOT_FOUND") throw new Error(`${variable}=${value} needs a package that is not installed: ${String(err.message).split("\n")[0]}`);
    throw err;
  }
}

export const METERS = {
  firestore: async () => new (await import("./platform/google/meter.mjs")).FirestoreStore(),
  memory: async () => new (await import("./meter.mjs")).MemoryStore(),
};

export const meterStore = (kind, adapters = METERS) => load("CHAT_METER", kind, adapters[kind]);

export const IDENTITIES = {
  google: async () => (await import("./platform/google/identity.mjs")).googleIdentityToken,
};

export const identityTokenSource = (kind, adapters = IDENTITIES) => load("CHAT_IDENTITY", kind, adapters[kind]);

export const QUESTIONS = {
  google: null,
};
