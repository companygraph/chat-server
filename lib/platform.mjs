// Each port's adapters, named by the value that chooses them. An adapter is imported only when it
// is chosen, so a deployment loads the cloud SDK of the platform it runs on and no other, and the
// config reads the allowed values from the keys here rather than from a list of its own.
export const METERS = {
  firestore: null,
  memory: null,
};

export const IDENTITIES = {
  google: null,
};

export const QUESTIONS = {
  google: null,
};
