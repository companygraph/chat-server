// Twenty messages an hour per address, in memory, per instance. It stops the casual loop and
// costs nothing; it does not stop many addresses, which is what the meter is for. A refusal
// names the moment the window opens again, because the widget's sentence is only as true as
// what the server tells it.
//
// The address is read from X-Forwarded-For at the position the trusted proxies write: the
// front ends append their own hop, so the client's address is `hops` entries from the end, and
// anything a client prepended sits before it and is ignored. How many hops sit in front is the
// deployment's to state, checked once against the live headers rather than assumed.
export class Bucket {
  constructor({ perHour = 20, now = () => Date.now() } = {}) {
    this.perHour = perHour;
    this.now = now;
    this.hits = new Map();
  }

  // A refusal is the moment the oldest hit leaves the window, the first instant at which the
  // filter below drops it, so a take at exactly that moment is allowed; `true` is a message
  // taken. The two are told apart by comparing against `true`, since a Date is truthy.
  take(address) {
    const t = this.now(), since = t - 3600 * 1000;
    const list = (this.hits.get(address) ?? []).filter((x) => x > since);
    if (list.length >= this.perHour) { this.hits.set(address, list); return new Date(list[0] + 3600 * 1000); }
    list.push(t);
    this.hits.set(address, list);
    if (this.hits.size > 10000) for (const [k, v] of this.hits) if (!v.some((x) => x > since)) this.hits.delete(k);
    return true;
  }
}

export function clientAddress(req, hops = 1) {
  const raw = req.headers["x-forwarded-for"];
  if (!raw) return req.socket?.remoteAddress ?? "unknown";
  const list = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return list[Math.max(0, list.length - 1 - hops)] ?? req.socket?.remoteAddress ?? "unknown";
}
