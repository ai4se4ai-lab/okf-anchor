# Connecting MindPortalix to OKF Anchor

MindPortalix produces conformant **OKF v0.2** bundles and already exposes

```
GET /api/okf/export?filter=all|stable|human-reviewed|usable&format=zip|tgz
```

which streams the bundle sub‑tree as a real `.zip` / `.tgz`. OKF Anchor takes that
archive and **validates → canonicalizes → hashes (Merkle) → derives an RDF graph →
stores content‑addressed → anchors a cryptographic commitment**, then hands back a
permanent asset id that anyone can retrieve, verify, and query.

No change to the MindPortalix repo is required — the three options below all work with
the export endpoint as it ships today.

---

## 1. Get a credential

In the OKF Anchor UI, open **Build servers → Register a build server**. Give it a
`publisherId` (e.g. `build-server:mindportalix-prod`) and, optionally, an Ed25519 public
key for signed requests. You receive an API token **once**:

```
Authorization: Bearer okf_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

For local development the seed creates `build-server:demo-01` with the well‑known token
`okf_dev_local_0000000000000000000000000000`.

---

## 2. Publish

### a. One‑liner (curl)

```bash
OKF_ANCHOR=https://anchor.example.com
TOKEN=okf_...
MP=https://mindportalix.example.com

curl -s "$MP/api/okf/export?filter=usable&format=tgz" \
| curl -s -X POST "$OKF_ANCHOR/api/v1/bundles" \
    -H "Authorization: Bearer $TOKEN" \
    -H "x-okf-asset-slug: my-knowledge-base" \
    -H "x-okf-filename: bundle.tgz" \
    --data-binary @-
# → 202 { "jobId": "...", "statusUrl": "/api/v1/mint-jobs/..." }
```

Poll the job until `MINTED`:

```bash
curl -s "$OKF_ANCHOR/api/v1/mint-jobs/$JOB_ID" -H "Authorization: Bearer $TOKEN"
# state: RECEIVED → VALIDATING → CANONICALIZING → GRAPHING → UPLOADING
#        → SIGNING → SUBMITTING → CONFIRMING → MINTED
```

### b. CLI (`@okf/publisher`)

```bash
okf login "$OKF_ANCHOR" --token "$TOKEN"
okf publish --from-mindportalix "$MP" --filter usable --slug my-knowledge-base --wait
```

`okf validate <dir|archive>` and `okf hash <dir|archive>` run the same deterministic
pipeline locally with no server, so CI can gate on conformance before publishing.

### c. Pull mode (no MindPortalix code, no outbound push)

Register your MindPortalix base URL + a scoped token on the build server, and OKF
Anchor's validation worker fetches the export archive itself (SSRF‑guarded allow‑list).
Use this when the build server cannot make outbound calls to the anchor.

---

## 3. Retrieve

```bash
curl -s "$OKF_ANCHOR/api/v1/assets/$ASSET_ID" -H "Authorization: Bearer $TOKEN"
# or, unauthenticated:
curl -s "$OKF_ANCHOR/api/public/assets/$ASSET_ID"
```

Returns `canonicalHash`, `merkleRoot`, `graphHash`, `manifestHash`, `commitmentHash`,
the four storage CIDs (source archive, canonical form, graph N‑Quads, manifest), the
Ed25519 publisher signature, the anchor reference + state, and the full version history.

---

## 4. Verify

Independent verification re‑derives every hash from stored canonical content and compares
it to the on‑chain commitment — it never trusts a stored hash.

```bash
# By id — full re-derivation from stored content:
curl -s "$OKF_ANCHOR/api/public/assets/$ASSET_ID/verify"

# Compare a local bundle to what was anchored (tamper detection):
curl -s -X POST "$OKF_ANCHOR/api/v1/assets/verify" \
  -H "Authorization: Bearer $TOKEN" \
  -F "assetId=$ASSET_ID" \
  -F "bundle=@./local-bundle.tgz;type=application/gzip"
```

Response — six checks, each `true`/`false`, plus the offending file paths on mismatch:

```json
{
  "passed": false,
  "contentIntegrity": false,
  "manifestIntegrity": false,
  "anchorIntegrity": false,
  "signatureIntegrity": true,
  "storageIntegrity": true,
  "graphIntegrity": false,
  "changedFiles": ["metrics/revenue.md"],
  "expected": { "merkleRoot": "a482…" },
  "actual":   { "merkleRoot": "29dd…" }
}
```

A public page is available too: `GET /verify/{assetId}` (no authentication).

---

## 5. Query

```bash
curl -s -X POST "$OKF_ANCHOR/api/public/query" \
  -H 'content-type: application/json' \
  -d '{"sparql":"PREFIX okf:<https://okf.dev/ns#> PREFIX skos:<http://www.w3.org/2004/02/skos/core#> SELECT ?type (COUNT(?c) AS ?n) WHERE { ?c a skos:Concept ; okf:type ?type } GROUP BY ?type"}'
```

Read‑only: `SELECT` / `ASK` / `CONSTRUCT` / `DESCRIBE` only. `UPDATE` / `LOAD` / `DROP` /
`INSERT` / `DELETE` and `SERVICE` (federation) are rejected. Add `"assetVersionId": "…"`
to scope a query to one published version.

---

## What OKF Anchor relies on in a MindPortalix bundle

- Every non‑reserved `.md` file has parseable YAML frontmatter with a non‑empty string
  `type` (OKF v0.2 §11). Nothing else is required.
- `sources` entries may be **bare strings** (`- files/icse-seet.txt`) or
  `{ id, resource, … }` mappings — both are accepted.
- Cross‑links may omit the `.md` extension (`[x](policies/formatting-ieee)`); a `.md` is
  appended during graph derivation. Broken links and missing referenced payload files are
  tolerated.
- `index.md` / `log.md` are treated as generated files and are never parsed as concepts.
- Timestamps (including millisecond precision) and free‑form actor strings such as
  `dsh/unversioned` are preserved verbatim.

A bundle that is entirely `unverified` still mints and verifies — the anchor proves
**integrity and provenance of publication**, which is independent of per‑concept
`verified` state.
