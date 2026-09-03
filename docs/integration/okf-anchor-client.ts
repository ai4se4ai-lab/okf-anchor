/**
 * Reference OKF Anchor client — a copy-paste module for a build server (e.g. to
 * drop into MindPortalix `src/services/okf/`). Zero dependencies; Node 20+ (uses
 * global `fetch`/`FormData`/`Blob`). Not imported by OKF Anchor itself.
 */

export interface OkfAnchorClientOptions {
  /** e.g. https://anchor.example.com */
  baseUrl: string;
  /** Bearer token issued by OKF Anchor for your build server. */
  token: string;
  fetchImpl?: typeof fetch;
}

export interface PublishResponse {
  jobId: string;
  state: string;
  statusUrl: string;
}

export interface MintJobStatus {
  jobId: string;
  state:
    | "RECEIVED" | "VALIDATING" | "INVALID" | "VALID" | "CANONICALIZING" | "HASHING"
    | "GRAPHING" | "UPLOADING" | "SIGNING" | "SUBMITTING" | "CONFIRMING" | "MINTED" | "FAILED";
  error: string | null;
  asset: AssetSummary | null;
}

export interface AssetSummary {
  assetId: string;
  slug: string;
  name: string;
  verificationUrl: string;
  currentVersion: {
    assetVersionId: string;
    versionNumber: number;
    canonicalHash: string;
    merkleRoot: string;
    graphHash: string;
    manifestHash: string;
    commitmentHash: string;
    storageCids: Record<string, string>;
    anchor: { provider: string; network: string; ref: string; state: string } | null;
  } | null;
  versions: Array<{ assetVersionId: string; versionNumber: number; canonicalHash: string }>;
}

export interface VerificationReport {
  passed: boolean;
  contentIntegrity: boolean;
  manifestIntegrity: boolean;
  anchorIntegrity: boolean;
  signatureIntegrity: boolean;
  storageIntegrity: boolean;
  graphIntegrity: boolean;
  changedFiles: string[];
  addedFiles: string[];
  removedFiles: string[];
  expected: Record<string, string>;
  actual: Record<string, string>;
}

export class OkfAnchorError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = "OkfAnchorError";
  }
}

export class OkfAnchorClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: OkfAnchorClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.token = opts.token;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${this.token}`, ...(init.headers ?? {}) },
    });
    const text = await res.text();
    const body = text ? JSON.parse(text) : {};
    if (!res.ok) {
      const err = body.error ?? { code: "HTTP_ERROR", message: res.statusText };
      throw new OkfAnchorError(res.status, err.code, err.message);
    }
    return body as T;
  }

  /** Publish a bundle archive (`.zip` or `.tgz` bytes). Returns a job to poll. */
  publish(
    archive: Uint8Array | ArrayBuffer,
    opts: { slug: string; filename?: string; contentType?: string; idempotencyKey?: string },
  ): Promise<PublishResponse> {
    return this.request<PublishResponse>("/api/v1/bundles", {
      method: "POST",
      headers: {
        "content-type": opts.contentType ?? "application/octet-stream",
        "x-okf-asset-slug": opts.slug,
        ...(opts.filename ? { "x-okf-filename": opts.filename } : {}),
        ...(opts.idempotencyKey ? { "idempotency-key": opts.idempotencyKey } : {}),
      },
      body: archive instanceof Uint8Array ? archive : new Uint8Array(archive),
    });
  }

  mintStatus(jobId: string): Promise<MintJobStatus> {
    return this.request<MintJobStatus>(`/api/v1/mint-jobs/${jobId}`, { method: "GET" });
  }

  /** Poll until the job reaches a terminal state. */
  async waitForMint(jobId: string, opts: { intervalMs?: number; timeoutMs?: number } = {}): Promise<MintJobStatus> {
    const interval = opts.intervalMs ?? 1000;
    const deadline = Date.now() + (opts.timeoutMs ?? 120_000);
    for (;;) {
      const status = await this.mintStatus(jobId);
      if (["MINTED", "FAILED", "INVALID"].includes(status.state)) return status;
      if (Date.now() > deadline) throw new OkfAnchorError(408, "TIMEOUT", "mint did not finish in time");
      await new Promise((r) => setTimeout(r, interval));
    }
  }

  retrieve(assetId: string): Promise<AssetSummary> {
    return this.request<AssetSummary>(`/api/v1/assets/${assetId}`, { method: "GET" });
  }

  /** Re-derive and verify from stored content. */
  verify(assetId: string): Promise<VerificationReport> {
    return this.request<VerificationReport>("/api/v1/assets/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ assetId }),
    });
  }

  /** Compare a local archive to what was anchored (tamper detection). */
  verifyBundle(assetId: string, archive: Uint8Array, filename = "bundle.tgz"): Promise<VerificationReport> {
    const form = new FormData();
    form.set("assetId", assetId);
    form.set("bundle", new Blob([archive as BlobPart], { type: "application/gzip" }), filename);
    return this.request<VerificationReport>("/api/v1/assets/verify", { method: "POST", body: form });
  }

  query(sparql: string, assetVersionId?: string): Promise<unknown> {
    return this.request("/api/v1/query", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sparql, assetVersionId }),
    });
  }
}
