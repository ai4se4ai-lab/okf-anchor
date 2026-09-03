/**
 * `AnchorProvider` — writes an immutable on-chain commitment to an
 * `AssetVersion`'s state and verifies it later (CLAUDE.md §5,
 * skill: okf-blockchain-anchor). The chain stores a hash, never knowledge or
 * PII. `verify()` recomputes the commitment from canonical content and compares
 * to what is anchored — it never trusts a stored hash alone.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { commitmentHash, type Commitment } from "@okf-anchor/okf-core";

export type { Commitment } from "@okf-anchor/okf-core";

export type AnchorState = "pending" | "submitted" | "confirmed" | "failed";

export interface AnchorRef {
  readonly provider: string;
  /** Network / chain identifier (e.g. `local`, `eip155:31337`, `otp:2160`). */
  readonly network: string;
  /** Provider-specific locator: a tx hash, a UAL, a ledger key. */
  readonly ref: string;
}

export interface AnchorStatus {
  readonly state: AnchorState;
  readonly confirmations: number;
  readonly committedHash: string | null;
  readonly blockNumber?: number;
  readonly error?: string;
}

export interface VerificationResult {
  readonly ok: boolean;
  readonly expectedHash: string;
  readonly anchoredHash: string | null;
  readonly reason?: string;
}

export interface AnchorProvider {
  readonly kind: string;
  readonly network: string;
  anchor(commitment: Commitment): Promise<AnchorRef>;
  verify(ref: AnchorRef, commitment: Commitment): Promise<VerificationResult>;
  status(ref: AnchorRef): Promise<AnchorStatus>;
}

interface LedgerRow {
  ref: string;
  committedHash: string;
  assetId: string;
  versionNumber: number;
  state: AnchorState;
  createdAt: string;
  blockNumber: number;
}

/**
 * Deterministic in-process anchor for the offline pipeline and tests. Persists a
 * JSON ledger so a restart keeps prior anchors. An anchor is `confirmed`
 * immediately (no network), and is append-only: re-anchoring the same commitment
 * returns the existing row.
 */
export class LocalAnchorProvider implements AnchorProvider {
  readonly kind = "local";
  readonly network = "local";
  private readonly ledgerPath: string;
  private ledger: Map<string, LedgerRow> = new Map();
  private loaded = false;

  constructor(ledgerPath: string) {
    this.ledgerPath = ledgerPath;
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const raw = await readFile(this.ledgerPath, "utf8");
      const rows = JSON.parse(raw) as LedgerRow[];
      this.ledger = new Map(rows.map((r) => [r.committedHash, r]));
    } catch {
      this.ledger = new Map();
    }
    this.loaded = true;
  }

  private async persist(): Promise<void> {
    await mkdir(dirname(this.ledgerPath), { recursive: true });
    await writeFile(this.ledgerPath, JSON.stringify([...this.ledger.values()], null, 2), "utf8");
  }

  async anchor(commitment: Commitment): Promise<AnchorRef> {
    await this.load();
    const hash = commitmentHash(commitment);
    let row = this.ledger.get(hash);
    if (!row) {
      row = {
        ref: `local:${hash}`,
        committedHash: hash,
        assetId: commitment.assetId,
        versionNumber: commitment.versionNumber,
        state: "confirmed",
        createdAt: new Date().toISOString(),
        blockNumber: this.ledger.size + 1,
      };
      this.ledger.set(hash, row);
      await this.persist();
    }
    return { provider: this.kind, network: this.network, ref: row.ref };
  }

  async verify(ref: AnchorRef, commitment: Commitment): Promise<VerificationResult> {
    await this.load();
    const expectedHash = commitmentHash(commitment);
    const row = [...this.ledger.values()].find((r) => r.ref === ref.ref);
    if (!row) {
      return { ok: false, expectedHash, anchoredHash: null, reason: "anchor ref not found on ledger" };
    }
    const ok = row.committedHash === expectedHash;
    return ok
      ? { ok, expectedHash, anchoredHash: row.committedHash }
      : {
          ok,
          expectedHash,
          anchoredHash: row.committedHash,
          reason: "anchored commitment does not match content",
        };
  }

  async status(ref: AnchorRef): Promise<AnchorStatus> {
    await this.load();
    const row = [...this.ledger.values()].find((r) => r.ref === ref.ref);
    if (!row) {
      return { state: "failed", confirmations: 0, committedHash: null, error: "not found" };
    }
    return {
      state: row.state,
      confirmations: 1,
      committedHash: row.committedHash,
      blockNumber: row.blockNumber,
    };
  }
}
