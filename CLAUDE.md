# CLAUDE.md — OKF Anchor

Development rules and context for working on **OKF Anchor**: an open-source platform for
publishing, verifying, preserving, and querying Open Knowledge Format (OKF) knowledge
bundles as trusted, independently verifiable knowledge assets.

Read this file before writing code. These rules are binding. When a rule here conflicts
with a convenient shortcut, the rule wins.

---

## 1. What we are building

An OKF-producing server publishes an OKF bundle to OKF Anchor. The platform:

1. **Validates** bundle structure, metadata, provenance, trust info, and links.
2. **Canonicalizes** the bundle into a deterministic representation.
3. **Hashes** the canonical form to produce cryptographic commitments.
4. **Builds a knowledge graph** (RDF / JSON-LD) for semantic querying via SPARQL.
5. **Stores** content on decentralized / content-addressed storage (IPFS).
6. **Anchors** the asset's state and commitments on blockchain / DKG infrastructure.

The blockchain is a **trust and integrity anchor only** — never the database for the
knowledge itself. The OKF bundle remains the authoritative artifact.

---

## 2. Architecture: keep the layers separate

These five concerns are **logically separate** and must not be collapsed into one another.
Separate modules, separate interfaces, separate storage, separate tests.

| Layer | Responsibility | Never does |
| --- | --- | --- |
| **OKF source** | The raw uploaded bundle as received | Interpretation, execution, mutation |
| **Canonical representation** | Deterministic serialization used for hashing | Semantic enrichment |
| **Derived knowledge graph** | RDF/JSON-LD triples for SPARQL | Being treated as authoritative content |
| **Decentralized storage** | Content-addressed persistence (IPFS) | Holding secrets or acting as source of truth for provenance |
| **Blockchain anchor** | On-chain commitment to asset state | Storing knowledge payloads or PII |

A change in one layer must not silently rewrite another. Re-deriving the knowledge graph
must be reproducible from the canonical representation.

---

## 3. Security rules (mandatory)

Treat every uploaded OKF bundle as **hostile input from an untrusted party**.

- **Never execute code contained inside an uploaded OKF bundle.** No `eval`, no dynamic
  `import()` / `require()` of bundle paths, no shelling out to bundle contents, no
  templating engines that execute expressions, no deserialization of executable objects.
- **Treat all uploaded Markdown and YAML as untrusted input.** Parse with safe,
  non-executing parsers (`yaml` safe load — never a schema that constructs arbitrary
  types; Markdown rendered without raw HTML pass-through unless explicitly sanitized).
- **Validate and sanitize all external input** at the boundary: uploaded bundles, API
  request bodies, query params, headers, webhook payloads, SPARQL queries, IPFS CIDs,
  chain identifiers, and file names. Validate against an explicit schema; reject unknown
  fields; enforce size and depth limits.
- **Prevent path traversal.** Never join user-controlled strings into filesystem paths.
  Resolve, then verify the resolved path is inside an allow-listed base directory. Reject
  `..`, absolute paths, symlinks, and null bytes.
- **Prevent SSRF.** No outbound request to a user-supplied URL without an allow-list of
  schemes and hosts. Block private, loopback, link-local, and metadata IP ranges. This
  applies to link resolution in bundles, IPFS gateway selection, and RPC endpoints.
- **Prevent command injection.** Never build shell strings from input. Use `execFile` /
  argument arrays with a fixed binary and validated args, or a native library instead.
- **Prevent arbitrary code execution** generally: no dynamic code loading from data, no
  prototype-pollution-prone merges, keep dependencies pinned and audited.
- Run untrusted parsing / canonicalization in the most constrained context available
  (worker, resource limits, no network, no filesystem write outside a scratch dir).

### Keys and secrets

- **Never expose blockchain private keys** — not in logs, errors, API responses,
  client bundles, test fixtures, or committed files.
- **Never store private keys in PostgreSQL.** Use a dedicated secrets manager / KMS /
  HSM, or at minimum environment-injected secrets that never touch the database.
- **Keep secrets in environment variables or a secrets manager, never in source code.**
  No secrets in `CLAUDE.md`, `.env` committed files, migrations, seeds, or fixtures.
  Commit a `.env.example` with placeholder values only.
- Signing should happen behind a narrow interface (a signer service / provider) so the
  key material has exactly one home.

### Immutability and versioning

- **Published OKF assets are immutable and versioned.** A new publication of the same
  logical asset creates a new version with its own hash and anchor.
- **Never silently overwrite a published OKF asset.** Re-publishing identical content is
  a no-op that returns the existing version; different content requires an explicit new
  version and must be recorded in publication history. Overwrite attempts must fail loud.

---

## 4. Tech stack

- **Frontend:** Next.js (App Router) + React + TypeScript, Tailwind CSS, shadcn/ui.
- **Backend:** Node.js (TypeScript), REST APIs, authenticated server-to-server publishing.
- **Datastores:** PostgreSQL via Prisma (metadata, versions, provenance, publication
  history — *not* secrets); Redis (caching, queues, rate limiting, idempotency keys).
- **Knowledge graph:** RDF / JSON-LD, SPARQL endpoint over the derived graph.
- **Decentralized storage:** IPFS (content-addressed).
- **Trust anchor:** blockchain / EVM and OriginTrail DKG.
- **Dev/infra:** Docker + Docker Compose, GitHub, GitHub Actions.
- **Testing:** Vitest (unit/integration), Playwright (E2E + UI + accessibility + visual
  regression), API tests, security tests.

Prefer TypeScript everywhere. Strict mode on. No `any` without a written reason.

---

## 5. Provider abstractions

Blockchain, decentralized storage, and knowledge-graph services must sit behind
**provider interfaces**. Application code depends on the interface, never on a vendor SDK
directly.

- `StorageProvider` — e.g. `put(content) -> CID`, `get(CID)`, `pin(CID)`. Implementations:
  local/dev in-memory or filesystem, IPFS (Kubo / Helia), pinning service.
- `AnchorProvider` — e.g. `anchor(commitment) -> anchorRef`, `verify(anchorRef, commitment)`.
  Implementations: local/dev fake, EVM chain, OriginTrail DKG.
- `GraphProvider` — e.g. `upsert(graph)`, `query(sparql)`. Implementations: in-process
  triplestore for dev, external SPARQL store for production.

Every provider needs a working local/dev implementation so the full pipeline runs with
no external network. Provider selection is configuration, not code changes.

---

## 6. OriginTrail DKG — verify before you build

**Do not assume OriginTrail DKG APIs or SDKs.** Their interfaces, method names, network
identifiers, and asset model change between versions. Before implementing anything against
the DKG:

1. Check the current official documentation and the installed SDK version's actual types.
2. Confirm method signatures, auth, network/blockchain selection, and cost model.
3. Write an adapter behind `AnchorProvider`; keep DKG specifics out of the rest of the app.
4. Add integration tests against a testnet or a documented mock — never hardcode
   assumptions about response shapes.

The same "verify the current interface" discipline applies to IPFS clients, EVM RPC
libraries, and SPARQL store APIs.

---

## 7. Testing requirements

- **All important functionality must have automated tests.** Validation, canonicalization,
  hashing, versioning/immutability enforcement, provenance handling, provider adapters,
  and every REST endpoint.
- **All UI functionality must have Playwright coverage** — user-facing flows for
  publishing, inspecting, verifying, and querying, plus accessibility checks
  (`@axe-core/playwright`) and visual regression (`toHaveScreenshot`).
- Canonicalization and hashing must have **determinism tests** (same input → identical
  bytes and hash across runs and platforms).
- Immutability tests must prove that a second publish with changed content does **not**
  overwrite and instead produces a new version.
- Security tests: path traversal, SSRF, command injection, code-execution, and
  malicious-YAML/Markdown payloads are rejected safely.
- CI (GitHub Actions) runs lint, typecheck, unit/integration tests, E2E, and a security
  scan (Semgrep) on every PR. Do not merge red.

---

## 8. Local development

- **Use Docker for reproducible development.** `docker compose up` must bring up
  PostgreSQL, Redis, an IPFS node, and any local chain/graph services needed for the
  full pipeline to run offline.
- App config comes from environment variables loaded from `.env` (git-ignored).
  `.env.example` is the checked-in template with safe placeholders.
- Database schema changes go through Prisma migrations. Never edit the database by hand.
- Provide `make`/npm scripts for: `dev`, `test`, `test:e2e`, `lint`, `typecheck`,
  `db:migrate`, `db:seed`, `compose:up`, `compose:down`.

---

## 9. Coding conventions

- Match existing file style, naming, and structure. Small, focused modules.
- Errors are typed and never leak secrets or internal paths to API responses.
- Log structured events; redact keys, tokens, and PII.
- Every new capability ships with its tests and a short doc note.
- Keep the five architectural layers (§2) in separate directories.

---

## 10. Tooling available in this environment

- **context7** MCP — pull up-to-date docs for Next.js, React, Prisma, Tailwind, shadcn,
  Redis, viem/ethers, Helia/IPFS, RDF/JSON-LD/SPARQL libraries, and the OriginTrail DKG
  SDK. Use it instead of relying on memory for library APIs.
- **Playwright** MCP + plugin — browser automation and E2E/UI/accessibility/visual tests.
- **GitHub** MCP — issues, PRs, reviews, Actions.
- **Prisma** MCP — schema, migrations, SQL, connection strings.
- **redis-development** skills — Redis data structures, caching, security, observability.
- **Semgrep Guardian** + **security-guidance** — automatic scanning of generated code for
  injection, SSRF, XSS, hardcoded secrets, path traversal, and related classes.
- **typescript-lsp** — type-aware navigation and diagnostics.
- **vercel** plugin skills — Next.js App Router, shadcn/ui, React best practices.

No maintained Claude Code plugin exists for RDF/SPARQL, generic EVM/Web3, IPFS, or
OriginTrail DKG — use `context7` for their docs and verify SDK interfaces directly.

### Project skills (`.claude/skills/`)

Auto-loaded for this repo; consult the relevant one before working in that area:

- `okf-prisma-postgres` — data-model layer separation, immutable versioning schema,
  migrations, no-secrets-in-DB.
- `okf-docker-dev` — Compose topology (Postgres/Redis/IPFS/local chain), offline pipeline.
- `okf-blockchain-anchor` — `AnchorProvider` abstraction, EVM + OriginTrail DKG adapters,
  key custody, verify-the-SDK discipline.
- `okf-knowledge-graph` — canonicalization/hashing determinism, RDF/JSON-LD derivation,
  `GraphProvider`, safe read-only SPARQL.
- `okf-security` — the untrusted-bundle threat model as a pre-code / pre-PR checklist.

Next.js, React, Tailwind/shadcn are covered by the `vercel`, `frontend-design`, and
`ui-ux-pro-max` plugin skills; generic Postgres by
`supabase:supabase-postgres-best-practices`.
