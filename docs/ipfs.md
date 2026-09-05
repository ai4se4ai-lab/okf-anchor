# IPFS storage (`STORAGE_PROVIDER=ipfs`)

OKF Anchor can store the complete OKF bundle and its derived artifacts in IPFS via a
[Kubo](https://github.com/ipfs/kubo) node, instead of the local filesystem. IPFS is a
storage backend only — it never replaces the blockchain anchor, and it never becomes
part of OKF semantics (CLAUDE.md §2, §5). See [`docs/storage-providers.md`](storage-providers.md)
for how the provider abstraction fits together.

## Start Kubo

Kubo runs as a Compose service behind the `ipfs` profile, so plain `docker compose up -d`
still runs the whole pipeline offline with no external network:

```bash
docker compose --profile ipfs up -d ipfs
```

This starts `ipfs/kubo:v0.32.1` with its RPC API and gateway bound to **loopback only**
(`127.0.0.1:55001` / `127.0.0.1:58080` on the host) — Kubo's RPC API has full
administrative capabilities and must never reach the public Internet. The app and
worker containers always talk to it over the compose network as `http://ipfs:5001`
(hardcoded in `docker-compose.yml`), regardless of what `.env` sets `IPFS_API_URL` to.

## Configure

```env
STORAGE_PROVIDER=ipfs
# From the host (pnpm dev against dockerized Kubo):
IPFS_API_URL=http://localhost:55001
# Inside docker compose --profile app, this is overridden to http://ipfs:5001 for you.

# Browser-facing link only — the server never fetches this itself (no SSRF surface):
IPFS_GATEWAY_URL=http://localhost:58080

IPFS_PIN_ON_PUBLISH=true        # pin() becomes a no-op when false
IPFS_CONNECT_TIMEOUT_MS=5000    # used only by the health check (`ipfs id`)
IPFS_REQUEST_TIMEOUT_MS=30000   # put / has / pin
IPFS_RETRIEVE_TIMEOUT_MS=60000  # get (bundles can be larger)
IPFS_MAX_BUNDLE_SIZE_MB=100     # enforced on both put() and get()
```

`STORAGE_PROVIDER` defaults to `local`, so none of this is required for normal
development — it only takes effect when explicitly opted into.

## How it stores content

`IpfsStorageProvider` (`packages/providers/src/ipfs-storage.ts`) uses Kubo's UnixFS
`add`/`cat` API (`cidVersion: 1`, `rawLeaves: true`), not the lower-level `block`
API — this keeps multi-block bundles resolvable through a plain gateway
(`/ipfs/{cid}`) with no OKF-specific knowledge, and keeps CIDs in the modern
`bafy.../bafk...` form. Content is content-addressed and deterministic: publishing the
same bytes twice always produces the same CID (verified by an integration test — same
bytes in, same CID out, byte-identical round-trip). Pinning is a separate, explicit step
gated on `IPFS_PIN_ON_PUBLISH` — a durability concern, not a cryptographic one; a CID
resolving does not by itself prove the content is authentic (see the verification page's
disclaimer).

A CID is always treated as an opaque, validated identifier — `get`/`has`/`pin` parse it
with `CID.parse()` before it ever reaches Kubo, and a malformed one is rejected (or, for
`has()`, reported as "not found") rather than forwarded.

## Verify the client library

Package name matters here: the IPFS project **deprecated** `js-kubo-rpc-client` in favor
of the unscoped `kubo-rpc-client` (same repository, same maintainers — confirm with
`npm view js-kubo-rpc-client deprecated`). This was verified against the installed
`kubo-rpc-client@7.1.0`'s shipped `.d.ts` files before writing the provider (CLAUDE.md §6)
— don't assume the API from memory or from the plan text; re-check
`node_modules/kubo-rpc-client/dist/src/index.d.ts` if you touch this code, especially
across a version bump.

## Retrieval

- `GET /api/v1/assets/{id}/bundle` (authenticated) and
  `GET /api/public/assets/{id}/bundle` (public) return the original source archive,
  resolved through OKF Anchor from the trusted `AssetVersion` record — never a raw
  Kubo/gateway URL a caller supplies. `?version=<n>` fetches a specific immutable
  version.
- The asset and verification pages show a "Retrieve bundle" link (using the routes
  above) and, when `IPFS_GATEWAY_URL` is set, an "Open in IPFS gateway" link the browser
  follows directly (the server never fetches this URL — no SSRF surface).

## Failure behavior

A storage failure happens before signing and anchoring in the publish pipeline
(`packages/pipeline/src/publish.ts`): if `put()` throws, the mint job fails with no
signature and no blockchain transaction — an anchor is never created for content that
isn't durably stored. See the `storage failure blocks anchoring` test in
`packages/pipeline/test/ipfs-storage.test.ts`.

## Garbage collection

None, deliberately. `AssetVersion` rows are immutable and every version may still be
needed for historical verification, so nothing auto-unpins an older version just because
a newer one exists. If retention limits are needed later, they should be an explicit,
separate policy — not something the storage provider decides on its own.

## Testing

```bash
docker compose --profile ipfs up -d ipfs
IPFS_API_URL=http://localhost:55001 pnpm --filter @okf-anchor/providers run test
IPFS_API_URL=http://localhost:55001 DATABASE_URL=... pnpm --filter @okf-anchor/pipeline run test
STORAGE_PROVIDER=ipfs IPFS_API_URL=http://localhost:55001 IPFS_GATEWAY_URL=http://localhost:58080 \
  pnpm --filter @okf-anchor/web run test:e2e
```

Every test in `packages/providers/test/ipfs-storage.test.ts` and
`packages/pipeline/test/ipfs-storage.test.ts` returns early when Kubo isn't reachable, so
`pnpm test` still passes without the compose stack (same convention as the Postgres
integration tests).
