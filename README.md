# OKF Anchor

**OKF Anchor is an open-source platform for publishing, verifying, preserving, and querying Open Knowledge Format (OKF) knowledge bundles as trusted knowledge assets.**

It provides a bridge between **OKF-based knowledge systems and decentralized trust infrastructure**, allowing servers and applications that generate OKF bundles to securely publish them, create cryptographic commitments, anchor their state on blockchain/DKG infrastructure, and make the resulting knowledge assets independently verifiable and queryable.

### Key Capabilities

* **OKF Bundle Validation** — Validate structure, metadata, provenance, trust information, links, and other OKF requirements before publication.
* **Canonicalization & Integrity** — Produce deterministic representations and cryptographic hashes of OKF bundles so that their integrity can be independently verified.
* **Decentralized Storage** — Store published knowledge bundles and derived representations using content-addressed infrastructure such as IPFS.
* **Blockchain Anchoring** — Anchor knowledge-asset state and cryptographic commitments on blockchain/DKG infrastructure.
* **Verifiable Provenance** — Preserve sources, generation information, verification status, publisher identity, and publication history.
* **Immutable Versioning** — Treat published knowledge as versioned assets rather than silently overwriting previously published content.
* **Knowledge Graph Generation** — Transform OKF bundles into machine-queryable semantic representations.
* **SPARQL Querying** — Enable deterministic queries over the published knowledge graph.
* **Independent Verification** — Allow third parties to retrieve an asset, reproduce its hashes, verify its provenance, and compare its state against the blockchain anchor.
* **Server-to-Server Publishing** — Provide authenticated APIs through which OKF-producing servers can automatically publish knowledge bundles.
* **Human & Machine Interfaces** — Provide a web interface, APIs, and potentially a CLI for publishing, inspecting, verifying, and querying knowledge assets.

### Concept

```text
OKF-Producing Server
        │
        │ Publish OKF Bundle
        ▼
┌─────────────────────┐
│     OKF Anchor      │
│                     │
│ Validate            │
│ Canonicalize        │
│ Hash                │
│ Build Knowledge KG  │
│ Sign / Attest       │
└─────────┬───────────┘
          │
     ┌────┴─────────────┐
     ▼                  ▼
   IPFS             Blockchain / DKG
     │                  │
     └────────┬─────────┘
              ▼
       Verifiable Knowledge
            Asset
              │
       ┌──────┴───────┐
       ▼              ▼
   Verification    SPARQL / KG
```

### Design Goal

OKF Anchor separates **knowledge content, semantic representation, storage, and trust anchoring**.

The blockchain is used as a **trust and integrity anchor**, rather than as the database for the knowledge itself. The OKF bundle remains the authoritative knowledge artifact, decentralized/content-addressed storage provides durable access to the artifact, the knowledge graph provides semantic queryability, and blockchain/DKG infrastructure provides an independently verifiable record of the published asset's state.

This makes it possible to build applications where knowledge is not merely *stored*, but can be **proven, traced, verified, and queried**.

### Example Use Case

A medical-AI research server generates an OKF bundle containing clinical knowledge, scientific claims, sources, provenance, computational results, and verification information.

The server publishes the bundle to OKF Anchor. The platform validates and canonicalizes the bundle, computes its cryptographic commitments, stores the content through content-addressed infrastructure, generates a queryable knowledge graph, and anchors the asset state on blockchain/DKG infrastructure.

Later, another researcher can:

1. Retrieve the published knowledge asset.
2. Verify that the content has not been modified.
3. Verify its provenance and publisher.
4. Compare its cryptographic state with the blockchain anchor.
5. Inspect previous versions.
6. Query the knowledge graph using SPARQL.
7. Trace individual claims back to their sources and supporting knowledge.

**OKF Anchor turns OKF bundles into durable, verifiable, and queryable knowledge assets.**