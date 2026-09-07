# Minting and Verifying OKF Bundles: How OKF Anchor's Features Work Together

This document walks through **how OKF Anchor's actual, implemented features** — the
canonicalization/hashing pipeline, the `OKFAnchor.sol` smart contract, the EVM anchor
provider, and the IPFS storage provider — combine to mint and independently verify an
OKF knowledge bundle. Every code reference below points at a real file in this repo, not
a hypothetical design.

The running example throughout is a request from **MindPortalix**, an OKF-producing
server that already ships `GET /api/okf/export?filter=usable&format=tgz`
(see [`docs/integration/mindportalix.md`](integration/mindportalix.md)). Ten concrete,
numbered examples close out the document.

---

## 1. The five things that make "minting" mean something

Per [`CLAUDE.md`](../CLAUDE.md) §2, OKF Anchor keeps five layers strictly separate. Minting
is the pipeline that moves a bundle through all five without ever collapsing them:

| Layer | What it holds | Where in the repo |
| --- | --- | --- |
| OKF source | The raw archive MindPortalix sent, byte-for-byte | `sourceCid` in IPFS |
| Canonical representation | Deterministic form used for hashing | `packages/okf-core/src/jcs.ts` |
| Derived knowledge graph | RDF/JSON-LD (PROV-O/DCAT/SKOS), RDFC-1.0 canonicalized | `packages/okf-core/src/graph.ts` |
| Decentralized storage | Content-addressed CIDs for all four artifacts | `packages/providers/src/ipfs-storage.ts` |
| Blockchain anchor | One `bytes32` commitment + CID pointer, nothing else | `contracts/src/OKFAnchor.sol` |

Nothing about a smart contract or IPFS makes an OKF bundle trustworthy on its own. What
makes it trustworthy is that **all five layers are independently re-derivable and
re-checkable** by a stranger who trusts none of OKF Anchor's infrastructure — only the
math.

---

## 2. What "minting" actually does, step by step

A mint job moves through an explicit state machine (`packages/pipeline/src/mint-job.ts`):

```
RECEIVED → VALIDATING → CANONICALIZING → GRAPHING → UPLOADING
         → SIGNING → SUBMITTING → CONFIRMING → MINTED
                                              ↘ INVALID / FAILED
```

1. **RECEIVED** — `POST /api/v1/bundles` authenticates the build server, stores the raw
   archive bytes to `StorageProvider.put()` (→ `sourceCid`), and creates a `MintJob` row.
   The HTTP response is `202` with a `jobId` — **anchoring never blocks the request**.
2. **VALIDATING** — the archive is unpacked under strict limits (size, depth, entry
   count, path-traversal rejection) and checked against OKF v0.2 (`type` is the only
   hard requirement per the MindPortalix compatibility notes).
3. **CANONICALIZING** — every file is deterministically serialized (`jcs.ts`, JSON
   Canonicalization Scheme), SHA-256'd per file, and folded into a domain-separated
   Merkle root (`merkleRoot`) plus a `canonicalHash` over the whole tree and a
   `manifestHash` over the file listing.
4. **GRAPHING** — the bundle is turned into RDF triples and canonicalized with RDFC-1.0
   to get a stable `graphHash`, independent of triple ordering.
5. **UPLOADING** — the canonical form, the graph (N-Quads), and the manifest are each
   put into `StorageProvider` (IPFS in production) and pinned.
6. **SIGNING** — an Ed25519 `Signer` (`packages/providers/src/signer.ts`) signs the
   `Commitment` — a compact record binding `assetId`, `versionNumber`, `okfVersion`,
   `canonicalHash`, `merkleRoot`, `graphHash`, `manifestHash`, `storageCid`, and
   `publisher` (`packages/okf-core/src/commitment.ts`).
7. **SUBMITTING / CONFIRMING** — `AnchorProvider.anchor(commitment)` writes
   `commitmentHash(commitment)` on-chain (or to the local ledger in dev) and waits for
   confirmations.
8. **MINTED** — the `AssetVersion` is finalized; the response includes the asset id and
   a public verification URL.

If validation fails, the job ends in **INVALID** (a bundle-content problem) rather than
**FAILED** (an infrastructure problem) — this distinction is what lets a build server
tell "your bundle is malformed" apart from "try again later."

---

## 3. How the smart contract (`OKFAnchor.sol`) helps

The contract is deliberately tiny — it is a **trust anchor, not a database**
(`contracts/src/OKFAnchor.sol`):

```solidity
struct Anchor {
    bytes32 commitment;   // = commitmentHash(...) — one hash, nothing else
    string bundleCid;     // pointer back into IPFS
    address publisher;
    uint256 timestamp;
}
mapping(bytes32 => mapping(uint256 => Anchor)) private _anchors; // assetId => version => Anchor
```

What it buys you:

- **Immutability by construction.** `anchor()` reverts with `AlreadyAnchored` on a
  second write to the same `(assetId, version)` — there is no code path that lets
  anyone, including the deployer, silently overwrite a minted commitment. A changed
  bundle must mint a **new version**, which gets its own row and its own anchor.
- **Access control without gatekeeping reads.** OpenZeppelin's `AccessControl` gates
  `anchor()` behind `ANCHOR_ROLE` — only registered publisher keys (e.g. one EVM signer
  per build server) can write. `getAnchor()` is unrestricted on purpose: **verification
  must work for anyone, unauthenticated**, which is what makes "independently
  verifiable" true rather than aspirational.
- **A tiny, auditable trust base.** The whole contract is ~90 lines built on one
  audited OpenZeppelin import. There is no business logic on-chain to exploit — the
  entire pipeline's complexity (validation, canonicalization, graph derivation) stays
  off-chain where it can be tested with normal unit tests, and the chain only ever
  answers one question: "what hash did publisher X commit to for
  (assetId, version) at time T?"

---

## 4. How EVM is used

EVM is used purely as **the settlement layer for that one write/read**, via
`EvmAnchorProvider` (`packages/providers/src/evm-anchor.ts`), which implements the
provider-abstraction rule from `CLAUDE.md` §5 — application code never touches `viem`
directly, only the `AnchorProvider` interface.

- **`assetIdToBytes32`** — the contract only accepts `bytes32`, but asset ids are
  Prisma cuids (strings), so the provider derives the on-chain key as
  `keccak256(assetId)`.
- **Idempotent re-publish.** Before writing, `anchor()` reads the existing on-chain
  record. If it's already there with the *same* commitment, no new transaction is sent
  — the original tx hash is recovered from the `Anchored` event logs instead
  (`findAnchoredTxHash`). If it's there with a *different* commitment, the provider
  throws rather than silently proceeding — this is `CLAUDE.md` §3's "overwrite attempts
  must fail loud" enforced at the provider layer, on top of the contract's own revert.
- **`verify()` never trusts a cache.** Every verification call re-reads
  `getAnchor()` from the chain and re-derives `commitmentHash()` from the caller's
  content, then compares. There is no "trust our database's copy of the anchor" path.
- **`status()` reports live confirmation depth** against the configured
  `EVM_CONFIRMATIONS`, so a UI can show "1 of 3 confirmations" instead of a binary
  minted/not-minted flag.
- **Local dev needs no real chain.** `ANCHOR_PROVIDER=local` uses
  `LocalAnchorProvider` — a JSON-file ledger with identical semantics (immutable,
  idempotent, hash-verified) — so the entire pipeline runs offline. Switching to EVM is
  a config change (`ANCHOR_PROVIDER=evm` + RPC URL + contract address), never a code
  change, exactly per `CLAUDE.md` §5.
- **Key separation.** `EVM_SIGNER_PRIVATE_KEY` (transaction signing) is a completely
  different key from the Ed25519 `SIGNER_PRIVATE_KEY_PEM` (commitment signing) — losing
  one does not compromise the other, and neither is ever stored in PostgreSQL
  (`CLAUDE.md` §3, `docs/evm-anchor.md`).

---

## 5. How IPFS helps

`IpfsStorageProvider` (`packages/providers/src/ipfs-storage.ts`) is the
content-addressed layer that makes "the chain only stores a pointer" workable:

- **Content addressing = free tamper-evidence.** A CID is derived from the content's
  own bytes (`cidVersion: 1`, `rawLeaves: true`). If a single byte of a stored artifact
  changes, its CID changes — you cannot serve different bytes under an already-anchored
  CID, which is exactly the property the on-chain `bundleCid` pointer relies on.
- **Four separate CIDs per version**, one per artifact: the raw source archive, the
  canonical form, the RDF graph (N-Quads), and the manifest. Each is independently
  fetchable and independently hash-checkable — a verifier doesn't need to trust that
  "the bundle" is one opaque blob.
- **UnixFS `add`/`cat`**, not raw block storage, so any stored artifact resolves
  through a plain IPFS gateway (`/ipfs/{cid}`) with zero OKF-specific tooling — anyone
  can fetch a bundle with `curl` or a public gateway, not just OKF Anchor's own API.
- **Pinning is explicit and separate from storage.** `put()` writes content; `pin()` is
  a distinct call gated on `IPFS_PIN_ON_PUBLISH` — durability is treated as an
  operational concern, not something baked into the cryptographic guarantee.
- **No SSRF surface.** The provider only ever talks to one operator-configured
  `IPFS_API_URL` — it never accepts a caller-supplied host, closing off the classic
  "fetch this attacker-controlled URL" vector (`CLAUDE.md` §3, skill `okf-security`).
- **Size-bounded both ways.** `put()` and `get()` both enforce
  `IPFS_MAX_BUNDLE_SIZE_MB`, so a malicious or malformed bundle can't exhaust memory
  on ingest or on retrieval.
- **Swappable for local dev.** The same `StorageProvider` interface has a
  filesystem-backed implementation for offline development — `docker compose up` runs
  the full pipeline with no external network, and switching to real IPFS is a
  config flag (`STORAGE_PROVIDER=ipfs`), not a rewrite (`docs/storage-providers.md`).

---

## 6. Verification: re-derive, never trust

Independent verification (`GET /api/public/assets/:id/verify`, or
`POST /api/v1/assets/verify` for tamper-checking a local copy) runs **six checks**, each
re-derived from stored content rather than read from a cache:

| Check | What it re-derives and compares |
| --- | --- |
| `contentIntegrity` | Re-hash retrieved bundle files vs. stored `merkleRoot` |
| `manifestIntegrity` | Re-hash the file listing vs. stored `manifestHash` |
| `graphIntegrity` | Re-derive RDF + RDFC-1.0 canonicalize vs. stored `graphHash` |
| `signatureIntegrity` | Verify the Ed25519 signature over the commitment |
| `storageIntegrity` | Confirm all four CIDs actually resolve in `StorageProvider` |
| `anchorIntegrity` | Re-read the chain and compare `commitmentHash()` to `getAnchor()` |

A failure names the specific offending file paths (e.g. `["metrics/revenue.md"]") and
shows `expected` vs. `actual` hashes — verification is diagnostic, not just pass/fail.

---

## 7. Walkthrough: a request from MindPortalix, step by step

MindPortalix exposes `GET /api/okf/export?filter=usable&format=tgz`. Here is exactly
what happens when that export is minted and later verified.

**Step 1 — MindPortalix streams its export.**
```bash
curl -s "https://mindportalix.example.com/api/okf/export?filter=usable&format=tgz" \
  -o bundle.tgz
```
No code changes needed on the MindPortalix side — OKF Anchor accepts the archive as-is.

**Step 2 — A registered build server credential authenticates the publish.**
An operator registered `build-server:mindportalix-prod` in the OKF Anchor UI once and
received a bearer token. (Local dev ships a seeded token,
`okf_dev_local_...`, for exactly this flow with no setup.)

**Step 3 — The bundle is submitted.**
```bash
curl -s -X POST "$OKF_ANCHOR/api/v1/bundles" \
  -H "Authorization: Bearer $TOKEN" \
  -H "x-okf-asset-slug: mindportalix-kb" \
  -H "x-okf-filename: bundle.tgz" \
  --data-binary @bundle.tgz
# → 202 { "jobId": "...", "statusUrl": "/api/v1/mint-jobs/..." }
```
`POST /api/v1/bundles` (`apps/web/src/app/api/v1/bundles/route.ts`) immediately stores
the raw bytes to `StorageProvider.put()` → `sourceCid`, creates the `MintJob` row in
state `RECEIVED`, and enqueues the mint — the HTTP call returns before any hashing,
graphing, or chain interaction happens.

**Step 4 — The pipeline runs asynchronously.**
The mint worker walks `VALIDATING → CANONICALIZING → GRAPHING → UPLOADING → SIGNING →
SUBMITTING → CONFIRMING`, exactly as in §2. MindPortalix's export needs no special
handling: its bundles have YAML frontmatter with a `type` field on every concept file
(the one hard OKF v0.2 requirement), string-or-object `sources` entries, and
extension-less cross-links — all explicitly tolerated by the graph deriver.

**Step 5 — The client polls for completion.**
```bash
curl -s "$OKF_ANCHOR/api/v1/mint-jobs/$JOB_ID" -H "Authorization: Bearer $TOKEN"
```
until `state: "MINTED"`.

**Step 6 — Anyone retrieves the minted asset, no token required.**
```bash
curl -s "$OKF_ANCHOR/api/public/assets/$ASSET_ID"
```
returns `canonicalHash`, `merkleRoot`, `graphHash`, `manifestHash`, `commitmentHash`,
all four storage CIDs, the Ed25519 signature, and the on-chain anchor reference.

**Step 7 — Anyone verifies it, no token required, no trust in OKF Anchor's servers.**
```bash
curl -s "$OKF_ANCHOR/api/public/assets/$ASSET_ID/verify"
```
This re-fetches the bundle from IPFS by CID, re-canonicalizes it, re-derives the graph,
re-reads `OKFAnchor.getAnchor()` on-chain, and compares every value fresh. A "verified"
result means: *the bytes MindPortalix produced, the hash OKF Anchor committed to, and
the hash the chain has on record are all provably the same thing* — not "OKF Anchor
says so."

**Step 8 — Tamper detection, if MindPortalix's content later changes.**
```bash
curl -s -X POST "$OKF_ANCHOR/api/v1/assets/verify" \
  -H "Authorization: Bearer $TOKEN" \
  -F "assetId=$ASSET_ID" -F "bundle=@./newer-export.tgz;type=application/gzip"
```
If MindPortalix's live knowledge base has drifted from what was minted, this returns
`passed: false` with the exact changed file paths — the asset itself never
silently updates; a real change requires a new, separately-anchored version.

---

## 8. Ten concrete examples

1. **First publish of a new knowledge base.** MindPortalix exports `filter=all` for the
   first time; `POST /api/v1/bundles` creates `AssetVersion` 1, anchors
   `commitmentHash` for `(assetId, version=1)`, and `OKFAnchor.sol` records it forever.

2. **A second, identical publish (no-op, not a new version).** MindPortalix's CI
   re-runs the same export unchanged. `EvmAnchorProvider.anchor()` sees the existing
   on-chain commitment matches, sends **no transaction**, and returns the original tx
   hash — proving re-publishing identical content never creates version churn.

3. **A content update becomes version 2.** A MindPortalix editor changes one Markdown
   file and re-exports. The new `canonicalHash`/`merkleRoot` differ, so minting creates
   `AssetVersion` 2 with its own anchor; `AssetVersion` 1's anchor is untouched and still
   independently verifiable at its original hash.

4. **An accidental duplicate-write attempt is rejected loudly.** If a bug in the worker
   retried `anchor()` for `(assetId, version=2)` with *different* bytes, `OKFAnchor.sol`
   reverts with `AlreadyAnchored` and the provider raises an error — the failure is
   visible in the mint job's `error` field, never a silent overwrite.

5. **A malformed bundle is rejected before it ever reaches the chain.** MindPortalix
   accidentally exports a `.tar.gz` with a path-traversal entry
   (`../../etc/passwd`). Validation rejects it during `VALIDATING`; the job ends
   `INVALID` with zero IPFS writes and zero chain interaction — untrusted input never
   reaches storage or EVM.

6. **A stranger verifies a MindPortalix asset with no OKF Anchor account.**
   `GET /api/public/assets/:id/verify` re-derives everything from the four IPFS CIDs
   and the on-chain `getAnchor()` call — no bearer token, because `getAnchor()` is
   deliberately unrestricted for reads.

7. **Someone tampers with a MindPortalix-sourced local copy and it's caught.** A
   downstream consumer edits `metrics/revenue.md` in their local copy of the exported
   bundle and tries to pass it off as the anchored version.
   `POST /api/v1/assets/verify` returns `contentIntegrity: false`, names
   `metrics/revenue.md` as the changed file, and shows the expected vs. actual
   `merkleRoot`.

8. **Querying MindPortalix's knowledge without touching MindPortalix again.** Once
   minted, the derived RDF graph is queryable directly against OKF Anchor:
   `POST /api/public/query` with a read-only SPARQL `SELECT` — MindPortalix's original
   server is never hit for this.

9. **Switching MindPortalix's build server from dev to production EVM.** Dev uses
   `ANCHOR_PROVIDER=local` (JSON ledger, offline). Going to production is
   `ANCHOR_PROVIDER=evm` + a deployed `OKFAnchor.sol` address + a KMS-backed
   `EVM_SIGNER_PRIVATE_KEY` granted `ANCHOR_ROLE` — no pipeline code changes, per the
   provider-abstraction rule.

10. **Pull-mode ingestion when MindPortalix can't push outbound.** If MindPortalix's
    infrastructure can only be polled, not push to OKF Anchor, a build server can be
    registered with MindPortalix's base URL and a scoped token; OKF Anchor's validation
    worker fetches the export itself through an SSRF-guarded allow-list — the same
    minting pipeline runs, just triggered by a pull instead of a push.

---

## 9. Why this combination matters

No single layer here provides "trust" by itself:

- The **smart contract** alone would just be an expensive way to store a hash — it
  says nothing about whether that hash corresponds to real, well-formed knowledge.
- **IPFS** alone gives you content-addressing but no notion of *when* a given CID
  became the official version of an asset, or who was authorized to publish it.
- **EVM** alone is just a transaction ledger — it needs a canonicalization scheme
  upstream, or "the same knowledge, differently formatted" would mint as different
  assets.

Combined — deterministic canonicalization feeding a Merkle root, a graph hash, an
Ed25519 signature, all folded into one compact commitment, stored at content-addressed
CIDs, and anchored immutably on-chain behind role-gated writes but open reads — a
request as ordinary as a MindPortalix export becomes a knowledge asset that any third
party can fetch, re-derive, and check without ever having to trust OKF Anchor's own
servers.
