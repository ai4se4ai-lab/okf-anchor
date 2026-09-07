/**
 * `IpfsStorageProvider` — content-addressed persistence backed by a Kubo node's
 * HTTP RPC API (CLAUDE.md §5, §6; skill: okf-security). Speaks to a single,
 * operator-configured endpoint (`IPFS_API_URL`) only: it never accepts a
 * caller-supplied host, so there is no SSRF surface here (skill: okf-security).
 *
 * Verified against `kubo-rpc-client@7.1.0`'s shipped type declarations before
 * writing this (CLAUDE.md §6) — note the package name: the IPFS project
 * deprecated `js-kubo-rpc-client` in favor of the unscoped `kubo-rpc-client`.
 *
 * Uses the top-level `add`/`cat` (UnixFS) API rather than the lower-level
 * `block.put`/`block.get` so multi-block bundles round-trip transparently and
 * resolve through a plain IPFS gateway (`/ipfs/{cid}`) with no OKF-specific
 * knowledge. `cidVersion: 1` + `rawLeaves: true` keeps CIDs in the modern
 * `bafy...` form. Pinning is a separate, explicit step (`pin()`) gated on
 * `IPFS_PIN_ON_PUBLISH` — CLAUDE.md's point that pinning is a durability
 * concern, not a cryptographic one.
 */
import { create as createKuboClient, CID, type KuboRPCClient } from "kubo-rpc-client";
import type { Cid, StorageHealth, StorageProvider } from "./storage.js";

export interface IpfsStorageOptions {
  readonly apiUrl: string;
  readonly connectTimeoutMs: number;
  readonly requestTimeoutMs: number;
  readonly retrieveTimeoutMs: number;
  readonly maxBundleSizeBytes: number;
  readonly pinOnPublish: boolean;
}

export class InvalidCidError extends Error {
  constructor(cid: string) {
    super(`malformed CID: ${cid}`);
    this.name = "InvalidCidError";
  }
}

function parseCid(cid: Cid): CID {
  try {
    return CID.parse(cid);
  } catch {
    throw new InvalidCidError(cid);
  }
}

/**
 * Filesystem CAS backed by a Kubo node. `put`/`get`/`has` are the only paths the
 * OKF pipeline uses; `pin` is a durability step the pipeline calls after every
 * `put` (CLAUDE.md §13) and is a no-op here when `IPFS_PIN_ON_PUBLISH=false`.
 */
export class IpfsStorageProvider implements StorageProvider {
  readonly kind = "ipfs";
  private readonly client: KuboRPCClient;
  private readonly opts: IpfsStorageOptions;

  constructor(opts: IpfsStorageOptions) {
    this.opts = opts;
    this.client = createKuboClient({ url: opts.apiUrl, timeout: opts.requestTimeoutMs });
  }

  async put(content: Uint8Array): Promise<Cid> {
    if (content.byteLength > this.opts.maxBundleSizeBytes) {
      throw new Error(
        `content is ${content.byteLength} bytes, exceeding IPFS_MAX_BUNDLE_SIZE_MB (${this.opts.maxBundleSizeBytes} bytes)`,
      );
    }
    const result = await this.client.add(content, {
      cidVersion: 1,
      rawLeaves: true,
      // Pinning is a separate, explicit step — see pin() below.
      pin: false,
      timeout: this.opts.requestTimeoutMs,
    });
    return result.cid.toString();
  }

  async get(cid: Cid): Promise<Uint8Array> {
    const parsed = parseCid(cid);
    const chunks: Uint8Array[] = [];
    let total = 0;
    for await (const chunk of this.client.cat(parsed, { timeout: this.opts.retrieveTimeoutMs })) {
      total += chunk.byteLength;
      if (total > this.opts.maxBundleSizeBytes) {
        throw new Error(
          `content for ${cid} exceeds IPFS_MAX_BUNDLE_SIZE_MB (${this.opts.maxBundleSizeBytes} bytes) while retrieving`,
        );
      }
      chunks.push(chunk);
    }
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return out;
  }

  async has(cid: Cid): Promise<boolean> {
    // A malformed CID is treated as "not found", matching LocalStorageProvider.
    try {
      await this.client.block.stat(parseCid(cid), { timeout: this.opts.requestTimeoutMs });
      return true;
    } catch {
      return false;
    }
  }

  async pin(cid: Cid): Promise<void> {
    if (!this.opts.pinOnPublish) return;
    const parsed = parseCid(cid);
    await this.client.pin.add(parsed, { timeout: this.opts.requestTimeoutMs });
  }

  /** Reachability only (`ipfs id`) — never a content fetch (CLAUDE.md §22). */
  async health(): Promise<StorageHealth> {
    const start = Date.now();
    try {
      await this.client.id({ timeout: this.opts.connectTimeoutMs });
      return { healthy: true, latencyMs: Date.now() - start };
    } catch (err) {
      return { healthy: false, latencyMs: Date.now() - start, error: (err as Error).message };
    }
  }
}
