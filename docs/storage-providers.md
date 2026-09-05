# Storage providers

CLAUDE.md §5 requires every external concern to sit behind a provider interface with a
working local/offline implementation. `StorageProvider` (`packages/providers/src/storage.ts`)
is the one that holds the complete OKF bundle and its derived artifacts:

```ts
export interface StorageProvider {
  readonly kind: string;
  put(content: Uint8Array): Promise<Cid>;
  get(cid: Cid): Promise<Uint8Array>;
  has(cid: Cid): Promise<boolean>;
  pin(cid: Cid): Promise<void>;
  health?(): Promise<StorageHealth>;
}
```

The publish pipeline (`packages/pipeline/src/publish.ts`) only ever calls these five
methods — it has no idea whether it's talking to the filesystem or a Kubo node. Provider
selection happens in exactly one place, `packages/providers/src/config.ts`, driven by
`STORAGE_PROVIDER`:

| `STORAGE_PROVIDER` | Implementation | Needs |
| --- | --- | --- |
| `local` (default) | `LocalStorageProvider` — SHA-256 CAS on disk under `OKF_DATA_DIR/storage` | nothing external |
| `ipfs` | `IpfsStorageProvider` — a real Kubo node over its HTTP RPC API | `docker compose --profile ipfs up -d ipfs` |

## What gets stored

A publish stores four artifacts, each as its own content-addressed object (never one
opaque "bundle" blob) — see the `StorageObject` rows on an `AssetVersion`:

- `SOURCE_ARCHIVE` — the exact bytes that were uploaded, byte-for-byte.
- `CANONICAL_BUNDLE` — the deterministic canonical serialization used for hashing.
- `GRAPH_NQUADS` — the derived RDF graph (canonical N-Quads).
- `MANIFEST` — the per-file manifest.

`GET /api/v1/assets/{id}/bundle` (authenticated) and `GET /api/public/assets/{id}/bundle`
(public) return the `SOURCE_ARCHIVE` — the complete, original OKF bundle — resolved from
the trusted `AssetVersion.storageObjects` record, never from a CID a caller supplies.
`?version=<n>` retrieves a specific immutable version.

## Local (default)

```env
STORAGE_PROVIDER=local
OKF_DATA_DIR=./.data/okf
```

CIDs look like `okf1:<sha-256 hex>`. Content lives under `OKF_DATA_DIR/storage/<aa>/<bb>/<hash>`.
`pin()` is a no-op — filesystem storage is always durable.

## IPFS

See [`docs/ipfs.md`](ipfs.md) for the full setup, security notes, and troubleshooting.

## Health

`GET /api/v1/storage/health` reports `{ provider, healthy, latencyMs }` — a cheap
reachability check (`ipfs id` for the IPFS provider), never a content fetch. Every
provider is expected to implement `health()`; if it doesn't, the endpoint reports
healthy with `latencyMs: 0`.

## Adding another provider

Implement `StorageProvider`, add a `case` in `createProviders()` (`config.ts`), and add
any new env vars there. Nothing else in the pipeline, API routes, or UI needs to change —
that's the point of the interface boundary.
