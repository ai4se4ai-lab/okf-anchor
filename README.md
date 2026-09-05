# OKF Anchor

Publish, canonicalize, hash, graph, store, and **blockchain‑anchor** Open Knowledge
Format (OKF v0.2) knowledge bundles as trusted, independently verifiable knowledge
assets.

An OKF‑producing server (for example [MindPortalix](docs/integration/mindportalix.md))
sends a bundle. OKF Anchor:

1. **Validates** it against OKF v0.2 (permissive — `type` is the only hard requirement).
2. **Canonicalizes** it deterministically — two servers emitting the same knowledge with
   different YAML whitespace converge to the same `canonicalHash`.
3. **Hashes** it: per‑file SHA‑256, a domain‑separated **Merkle root**, a manifest hash.
4. **Derives an RDF knowledge graph** (PROV‑O / DCAT / SKOS), canonicalized with RDFC‑1.0.
5. **Stores** the source archive, canonical form, graph, and manifest in content‑addressed
   storage.
6. **Signs** a commitment (Ed25519) and **anchors** it on a blockchain / DKG.

The blockchain records a *commitment to state*, never the knowledge itself. The OKF
bundle stays authoritative. Anyone can later retrieve the asset, **re‑derive every hash
from stored content, and compare it to the anchor** — trusting no part of this service.

---

## Quickstart

```bash
pnpm install
docker compose up -d                       # Postgres + Redis (offset host ports 55432 / 56379)
pnpm --filter @okf-anchor/db generate
pnpm build                                  # all packages + workers + web

# create your local .env (see "Environment" below), then:
pnpm db:migrate
pnpm db:seed                                # prints a well-known dev API token
pnpm dev                                     # Next.js on :3000 + the mint worker
```

Open <http://localhost:3000>. Or drive it headless:

```bash
export ANCHOR=http://localhost:3000
TOKEN=okf_dev_local_0000000000000000000000000000

# publish a bundle (a directory, .zip, or .tgz — e.g. a MindPortalix export)
pnpm --filter @okf-anchor/publisher-cli exec node dist/main.js login $ANCHOR --token $TOKEN
pnpm --filter @okf-anchor/publisher-cli exec node dist/main.js publish ./tests/fixtures/valid-mindportalix --slug demo --wait

# verify (re-derived from stored content) / tamper-check / query
okf verify <assetId>
okf verify <assetId> ./local-bundle.tgz     # compare a local copy to what was anchored
okf query 'PREFIX okf:<https://okf.dev/ns#> SELECT ?t (COUNT(?c) AS ?n) WHERE { ?c okf:type ?t } GROUP BY ?t'
```

The public verification page for any asset is `/verify/{assetId}` (no auth).

---

## Architecture — five layers, kept separate (`CLAUDE.md` §2)

| Layer | Package / dir | Artifact |
| --- | --- | --- |
| OKF source (raw upload, never executed) | `packages/providers` (bytes) · `OkfSource` | source archive CID |
| Canonical representation | `packages/okf-core/src/canonical` | `canonicalHash`, per‑file SHA‑256, `merkleRoot` |
| Derived knowledge graph (non‑authoritative) | `packages/okf-core/src/graph` · `GraphProvider` | `graphHash` (RDFC‑1.0 N‑Quads) |
| Decentralized storage | `packages/providers/src/storage` | `storageCid` |
| Blockchain anchor (commitment only) | `packages/providers/src/anchor` | `anchorRef`, `commitmentHash` |

```
packages/
  okf-core/       parse · validate · canonicalize · Merkle · manifest · RDF derive   (pure, no I/O)
  providers/      StorageProvider · AnchorProvider · GraphProvider · Signer  (+ Local, offline)
  db/             Prisma schema, immutable-versioning triggers, client
  queue/          BullMQ wiring (producer + consumer)
  pipeline/       archive extraction · publish orchestration · verification
  publisher-cli/  `okf` — validate / hash / publish / status / verify / query
workers/          the mint worker (runs the pipeline off the HTTP path)
apps/web/         Next.js App Router — S2S API (/api/v1), public API, and the UI
```

Every provider ships a **local, offline implementation** selected by env
(`STORAGE_PROVIDER` / `ANCHOR_PROVIDER` / `GRAPH_PROVIDER` / `SIGNER`, all `local` by
default), so `docker compose up` runs the whole pipeline with no external network. Real
IPFS (Kubo, `STORAGE_PROVIDER=ipfs` — see [`docs/ipfs.md`](docs/ipfs.md)), EVM (anvil),
and an external SPARQL store slot in behind the same interfaces via Compose profiles; an
OriginTrail DKG adapter is stubbed pending SDK verification.

---

## Immutability

`Asset` (logical identity) → many append‑only `AssetVersion` rows. A unique
`(assetId, canonicalHash)` constraint makes re‑publishing identical content a no‑op that
returns the existing version — **never** an update, **never** a second anchor. Changed
content becomes a new numbered version with its own hashes and anchor. A database trigger
rejects any `UPDATE`/`DELETE` on a published version or a confirmed anchor, loudly.

---

## API

Server‑to‑server (Bearer token, optional Ed25519 body signature):

| | |
| --- | --- |
| `POST /api/v1/bundles` | publish an archive → `202 { jobId }` |
| `POST /api/v1/bundles/validate` | validate + hash only, no persistence |
| `GET  /api/v1/mint-jobs/{id}` | mint state machine + the asset once `MINTED` |
| `GET  /api/v1/assets/{id}` | hashes, CIDs, signature, anchor, version history |
| `GET  /api/v1/assets/{id}/bundle` | retrieve the complete published bundle (`?version=n`) |
| `POST /api/v1/assets/verify` | verify by id, or against an uploaded bundle |
| `POST /api/v1/query` | read‑only SPARQL |
| `GET  /api/v1/storage/health` | storage provider reachability (never a content fetch) |

Public, unauthenticated: `GET /api/public/assets/{id}`, `.../verify`, `.../bundle`,
`POST /api/public/query`, and the pages `GET /verify/{assetId}` and `GET /assets/{id}`.

Full spec: [`docs/integration/openapi.yaml`](docs/integration/openapi.yaml).
MindPortalix wiring, curl one‑liners, and a reference client:
[`docs/integration/mindportalix.md`](docs/integration/mindportalix.md).

---

## Environment

`.env` is git‑ignored; create it from this list (placeholders only — no real secrets):

```
NODE_ENV=development
DATABASE_URL=postgresql://okf:okf_local_dev@localhost:55432/okf_anchor
REDIS_URL=redis://localhost:56379
STORAGE_PROVIDER=local
ANCHOR_PROVIDER=local
GRAPH_PROVIDER=local
SIGNER=local
OKF_DATA_DIR=./.data/okf
OKF_PUBLIC_BASE_URL=http://localhost:3000
NEXTAUTH_SECRET=dev-only-change-me
# Optional dev EVM key for ANCHOR_PROVIDER=evm — never in production:
# ANCHOR_SIGNER_KEY_REF=...
# SIGNER_PRIVATE_KEY_PEM=...
# OKF_INLINE_MINT=1   # run the pipeline in-process (no separate worker), for dev/CI

# --- IPFS (STORAGE_PROVIDER=ipfs; see docs/ipfs.md) ---
# docker compose --profile ipfs up -d ipfs
# STORAGE_PROVIDER=ipfs
# IPFS_API_URL=http://localhost:55001
# IPFS_GATEWAY_URL=http://localhost:58080
# IPFS_PIN_ON_PUBLISH=true
# IPFS_CONNECT_TIMEOUT_MS=5000
# IPFS_REQUEST_TIMEOUT_MS=30000
# IPFS_RETRIEVE_TIMEOUT_MS=60000
# IPFS_MAX_BUNDLE_SIZE_MB=100
```

Signer key material is referenced by `*_KEY_REF` and lives in a secrets manager — never
in Postgres, logs, responses, or fixtures.

---

## Testing

```bash
pnpm lint
pnpm typecheck
pnpm --filter @okf-anchor/okf-core --filter @okf-anchor/providers run test   # unit, no DB
pnpm --filter @okf-anchor/pipeline run test                                   # integration, needs Postgres
pnpm --filter @okf-anchor/web run test:e2e                                    # Playwright (a11y + flows)
```

Coverage includes deterministic‑hashing tests (byte‑identical across runs), golden bundle
fixtures (the real MindPortalix ICSE‑SEET bundle plus the OKF reference corpus),
immutability (a changed re‑publish creates v2, v1 unchanged), tamper detection, and
security (path traversal / zip‑slip, SSRF, SPARQL write‑form rejection).
