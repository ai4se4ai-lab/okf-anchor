/**
 * `StorageProvider` — content-addressed persistence for the canonical bundle,
 * the manifest, and the derived graph (CLAUDE.md §2, §5). It never holds secrets
 * and is never the source of truth for provenance.
 */
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { dirname, join } from "node:path";
import { sha256Hex } from "@okf-anchor/okf-core";

/** A content identifier. The local provider uses `okf1:<sha-256 hex>`; the IPFS
 * provider uses the real CID Kubo returns (`bafy...`). Callers must treat it as
 * an opaque string — never parse or construct one outside the owning provider. */
export type Cid = string;

export interface StorageHealth {
  readonly healthy: boolean;
  readonly latencyMs: number;
  readonly error?: string;
}

export interface StorageProvider {
  readonly kind: string;
  put(content: Uint8Array): Promise<Cid>;
  get(cid: Cid): Promise<Uint8Array>;
  has(cid: Cid): Promise<boolean>;
  pin(cid: Cid): Promise<void>;
  /** Cheap reachability check (never a full content fetch) for `/api/v1/storage/health`. */
  health?(): Promise<StorageHealth>;
}

const LOCAL_PREFIX = "okf1:";

export function localCidFor(content: Uint8Array): Cid {
  return LOCAL_PREFIX + sha256Hex(content);
}

/**
 * Filesystem CAS under a single base directory. Deterministic: the CID is the
 * SHA-256 of the content, so `put` is idempotent and `get` can re-verify.
 */
export class LocalStorageProvider implements StorageProvider {
  readonly kind = "local";
  private readonly baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
  }

  private pathFor(cid: Cid): string {
    if (!cid.startsWith(LOCAL_PREFIX)) throw new Error(`not a local CID: ${cid}`);
    const hex = cid.slice(LOCAL_PREFIX.length);
    if (!/^[0-9a-f]{64}$/.test(hex)) throw new Error(`malformed local CID: ${cid}`);
    return join(this.baseDir, hex.slice(0, 2), hex.slice(2, 4), hex);
  }

  async put(content: Uint8Array): Promise<Cid> {
    const cid = localCidFor(content);
    const path = this.pathFor(cid);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, { flag: "w" });
    return cid;
  }

  async get(cid: Cid): Promise<Uint8Array> {
    const bytes = new Uint8Array(await readFile(this.pathFor(cid)));
    if (localCidFor(bytes) !== cid) {
      throw new Error(`stored content for ${cid} fails its own hash check`);
    }
    return bytes;
  }

  async has(cid: Cid): Promise<boolean> {
    try {
      await access(this.pathFor(cid));
      return true;
    } catch {
      return false;
    }
  }

  async pin(_cid: Cid): Promise<void> {
    // Local FS storage is always "pinned"; nothing to do.
  }

  async health(): Promise<StorageHealth> {
    const start = Date.now();
    try {
      await mkdir(this.baseDir, { recursive: true });
      await access(this.baseDir);
      return { healthy: true, latencyMs: Date.now() - start };
    } catch (err) {
      return { healthy: false, latencyMs: Date.now() - start, error: (err as Error).message };
    }
  }
}
