/**
 * SSRF guard (CLAUDE.md §3, skill: okf-security). No outbound request to a
 * user-supplied URL without an explicit scheme + host allow-list, and private /
 * loopback / link-local / cloud-metadata address ranges are always blocked —
 * checked on the hostname and again on every resolved IP and redirect hop by
 * the caller. Applies to the MindPortalix pull URL, IPFS gateways, EVM RPC
 * endpoints, and DKG nodes.
 */
import { isIP } from "node:net";
import { lookup } from "node:dns/promises";

export interface SsrfPolicy {
  readonly allowedSchemes: ReadonlySet<string>;
  /** Exact hostnames (lowercase). Empty = allow any public host. */
  readonly allowedHosts: ReadonlySet<string>;
  readonly allowPrivate: boolean;
}

export const DEFAULT_POLICY: SsrfPolicy = {
  allowedSchemes: new Set(["https:"]),
  allowedHosts: new Set(),
  allowPrivate: false,
};

export interface SsrfCheck {
  readonly ok: boolean;
  readonly reason?: string;
  readonly url?: URL;
}

function isBlockedIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split(".").map(Number) as [number, number, number, number];
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true; // link-local + 169.254.169.254 metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    return false;
  }
  if (v === 6) {
    const lower = ip.toLowerCase();
    if (lower === "::1" || lower === "::") return true;
    if (lower.startsWith("fe80")) return true; // link-local
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // ULA
    if (lower.startsWith("::ffff:")) return isBlockedIp(lower.slice(7));
    return false;
  }
  return false;
}

export function checkUrlSyntax(raw: string, policy: SsrfPolicy = DEFAULT_POLICY): SsrfCheck {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "not a valid URL" };
  }
  if (!policy.allowedSchemes.has(url.protocol)) {
    return { ok: false, reason: `scheme ${url.protocol} not allowed` };
  }
  const host = url.hostname.toLowerCase();
  if (policy.allowedHosts.size > 0 && !policy.allowedHosts.has(host)) {
    return { ok: false, reason: `host ${host} not on the allow-list` };
  }
  if (!policy.allowPrivate) {
    if (host === "localhost") return { ok: false, reason: "localhost is blocked" };
    if (isIP(host) && isBlockedIp(host)) {
      return { ok: false, reason: "literal private/loopback address is blocked" };
    }
  }
  return { ok: true, url };
}

/** Full check: syntax + DNS resolution against the private-range block-list. */
export async function checkUrl(raw: string, policy: SsrfPolicy = DEFAULT_POLICY): Promise<SsrfCheck> {
  const syntax = checkUrlSyntax(raw, policy);
  if (!syntax.ok || !syntax.url) return syntax;
  if (policy.allowPrivate) return syntax;

  const host = syntax.url.hostname;
  if (isIP(host)) return syntax; // already checked

  try {
    const records = await lookup(host, { all: true });
    for (const rec of records) {
      if (isBlockedIp(rec.address)) {
        return { ok: false, reason: `${host} resolves to a blocked address`, url: syntax.url };
      }
    }
  } catch {
    return { ok: false, reason: `DNS resolution failed for ${host}` };
  }
  return syntax;
}
