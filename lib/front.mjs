// Which addresses are Google's own front ends. A chat on Google is reached two ways: through
// Firebase Hosting, which writes the visitor's address into X-Forwarded-For and calls Cloud Run
// from Google's own network, where Cloud Run's front end appends Hosting's address after it; and
// directly at the run.app address, where Cloud Run's front end appends the caller's own address
// and nothing else. Both requests name the same host, so no header tells them apart, and every
// header a direct caller sends is theirs to write. The last entry is the one thing they cannot
// choose, so a hop is skipped only where that entry is one of Google's own addresses: Google's
// published ranges less the ranges its cloud customers rent, from which no caller of ours can
// connect.
//
// The ranges are fetched as the service starts and again each day. Until a fetch has succeeded
// the check answers `null`, which the address reader takes as the deployment's own hop count, so
// a start while gstatic.com is down answers as before and says so in one warning.
import { BlockList, isIP } from "node:net";

export const GOOGLE_RANGES = "https://www.gstatic.com/ipranges/goog.json";
export const CLOUD_RANGES = "https://www.gstatic.com/ipranges/cloud.json";

/**
 * @param {unknown} json
 * @returns {BlockList}
 */
export function rangesFrom(json) {
  const prefixes = /** @type {{ prefixes?: unknown }} */ (json)?.prefixes;
  if (!Array.isArray(prefixes) || prefixes.length === 0) throw new Error("the range list holds no prefixes");
  const list = new BlockList();
  for (const p of prefixes) {
    const v4 = /** @type {{ ipv4Prefix?: unknown }} */ (p)?.ipv4Prefix, v6 = /** @type {{ ipv6Prefix?: unknown }} */ (p)?.ipv6Prefix;
    const cidr = typeof v4 === "string" ? v4 : typeof v6 === "string" ? v6 : null;
    if (!cidr) continue;
    const [net, bits] = cidr.split("/");
    list.addSubnet(/** @type {string} */ (net), Number(bits), typeof v4 === "string" ? "ipv4" : "ipv6");
  }
  return list;
}

/**
 * @param {BlockList} list
 * @param {string} address
 */
const holds = (list, address) => {
  const v = isIP(address);
  return v !== 0 && list.check(address, v === 4 ? "ipv4" : "ipv6");
};

/**
 * Google's own front addresses, kept fresh. `isFront` is `true` for an address in Google's ranges
 * and not in its cloud customers', `false` for any other, and `null` until the first fetch.
 * @param {{ fetchFn?: typeof globalThis.fetch; warn?: (fields: { reason: string }) => void; timeoutMs?: number; refreshMs?: number; retryMs?: number }} [options]
 */
export function googleFront({ fetchFn = fetch, warn, timeoutMs = 10_000, refreshMs = 24 * 3600 * 1000, retryMs = 3600 * 1000 } = {}) {
  /** @type {{ google: BlockList; cloud: BlockList } | null} */
  let ranges = null;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let timer = null;
  /** @param {string} url */
  const get = async (url) => {
    const res = await fetchFn(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error(`${url} answered ${res.status}`);
    return rangesFrom(await res.json());
  };
  const front = {
    /** @param {string} address */
    isFront(address) {
      if (!ranges) return null;
      return holds(ranges.google, address) && !holds(ranges.cloud, address);
    },
    /** One fetch of both lists; a failure keeps what was had and is one warning. */
    async load() {
      try {
        const [google, cloud] = await Promise.all([get(GOOGLE_RANGES), get(CLOUD_RANGES)]);
        ranges = { google, cloud };
        return true;
      } catch (err) {
        warn?.({ reason: String((/** @type {Error} */ (err))?.message ?? err) });
        return false;
      }
    },
    /** The first load, then a refresh each day, or each hour while none has succeeded. */
    async start() {
      const arm = () => {
        timer = setTimeout(async () => { await front.load(); arm(); }, ranges ? refreshMs : retryMs);
        timer.unref?.();
      };
      const ok = await front.load();
      arm();
      return ok;
    },
    stop() { if (timer) clearTimeout(timer); timer = null; },
  };
  return front;
}
