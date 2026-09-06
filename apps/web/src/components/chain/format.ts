export function truncateHex(value: string, lead = 8, tail = 6): string {
  if (value.length <= lead + tail + 3) return value;
  return `${value.slice(0, lead)}…${value.slice(-tail)}`;
}

export function relativeTime(unixSec: number, nowMs = Date.now()): string {
  const diffSec = Math.max(0, Math.round(nowMs / 1000 - unixSec));
  if (diffSec < 5) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  const min = Math.floor(diffSec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  return `${hr}h ago`;
}

/** `true` only for a real IPFS CID (v0 or v1) — the local offline storage provider's CIDs use an unrelated "okf1:" prefix and never resolve on a gateway. */
export function looksLikeIpfsCid(cid: string): boolean {
  return /^Qm[1-9A-HJ-NP-Za-km-z]{44}$/.test(cid) || /^ba[a-z2-7]{20,}$/.test(cid);
}

/**
 * A browser-openable `/ipfs/<cid>` URL for a bundle CID, or `null` when there is
 * no configured gateway or the CID is not a real IPFS CID (e.g. the offline
 * `okf1:` local-storage format). The server never fetches this itself — it is a
 * link handed to the viewer so they can download and independently verify the
 * anchored bundle (CID == content hash).
 */
export function ipfsGatewayHref(gatewayUrl: string | null | undefined, cid: string): string | null {
  if (!gatewayUrl || !looksLikeIpfsCid(cid)) return null;
  return `${gatewayUrl.replace(/\/+$/, "")}/ipfs/${cid}`;
}
