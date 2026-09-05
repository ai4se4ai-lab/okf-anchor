# EVM anchor (`ANCHOR_PROVIDER=evm`)

OKF Anchor can write the blockchain commitment to a real EVM-compatible chain — Anvil
(Foundry's local dev node) for local/CI use, any EVM chain in production — instead of the
offline `LocalAnchorProvider` ledger. The chain is a trust anchor only: it stores one
`bytes32` commitment hash plus a storage CID pointer, never the OKF bundle, the derived
graph, or any PII (CLAUDE.md §2, §8; skill: okf-blockchain-anchor).

## Start Anvil

Anvil runs as a Compose service behind the `chain` profile, so plain `docker compose up -d`
still runs the whole pipeline offline with no external network:

```bash
docker compose --profile chain up -d chain
```

This starts `ghcr.io/foundry-rs/foundry:v1.0.0` running `anvil --chain-id 31337
--block-time 1`, RPC on the host at `http://localhost:58545`. The app and worker
containers always talk to it over the compose network as `http://chain:8545`
(hardcoded in `docker-compose.yml`), regardless of what `.env` sets `EVM_RPC_URL` to —
same convention as `IPFS_API_URL` (see `docs/ipfs.md`).

## Deploy the contract (one time per chain)

`ANCHOR_PROVIDER=evm` needs `OKFAnchor.sol` (`contracts/src/OKFAnchor.sol`) already
deployed — the provider only ever calls an existing contract, it never deploys one.
See [`contracts/README.md`](../contracts/README.md) for the one-time Foundry setup, then:

```bash
EVM_SIGNER_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
  pnpm contracts:deploy:anvil
```

Copy the printed address into `EVM_ANCHOR_CONTRACT_ADDRESS`. On a fresh Anvil container
(e.g. `docker compose --profile chain up -d --force-recreate chain`) the chain's state —
and with it the deployed contract — resets, so this is a re-deploy, not a one-time setup,
whenever the dev chain is recreated.

## Configure

```env
ANCHOR_PROVIDER=evm
EVM_RPC_URL=http://localhost:58545
# Inside docker compose --profile app, this is overridden to http://chain:8545 for you.

EVM_CHAIN_ID=31337
EVM_ANCHOR_CONTRACT_ADDRESS=0x...       # from the deploy step above

# Anvil's well-known, publicly documented dev account #0 — dev only:
EVM_SIGNER_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80

EVM_CONFIRMATIONS=1        # blocks `anchor()` waits for; `status()` reports live progress against this
EVM_REQUEST_TIMEOUT_MS=30000
```

`ANCHOR_PROVIDER` defaults to `local`, so none of this is required for normal
development — it only takes effect when explicitly opted into.

## Key custody

`EVM_SIGNER_PRIVATE_KEY` signs EVM transactions — a different key from the Ed25519
`SIGNER_PRIVATE_KEY_PEM` that signs the OKF commitment itself (`packages/providers/src/signer.ts`).
Dev uses Anvil's published throwaway account; production must inject a real key the same
way — via an environment variable populated from a secrets manager / KMS — and never
commit one, log one, or store one in PostgreSQL (CLAUDE.md §3).

## What actually goes on-chain

`OKFAnchor.sol` stores, per `(assetId, version)`:

```solidity
struct Anchor {
    bytes32 commitment;   // = commitmentHash(...) from packages/okf-core/src/commitment.ts
    string bundleCid;     // pointer back into StorageProvider (IPFS or local)
    address publisher;
    uint256 timestamp;
}
```

`commitment` already binds `canonicalHash`, `merkleRoot`, `graphHash`, `manifestHash`,
`storageCid`, `assetId`, `versionNumber` and `publisher` (see `commitmentHash()`), so those
fields are deliberately **not** duplicated on-chain — CLAUDE.md §8's "do not put the OKF
bundle on EVM, store a compact commitment" applies to sub-hashes too. `EvmAnchorProvider`
(`packages/providers/src/evm-anchor.ts`) derives the on-chain `assetId` key as
`keccak256(assetId)` since the contract only accepts `bytes32`, not an arbitrary string.

An anchor is immutable once written: the contract reverts with `AlreadyAnchored` on a
second write to the same `(assetId, version)`, and a changed asset publishes a new
version with its own anchor rather than overwriting one (CLAUDE.md §3).

`anchor()` is further gated by OpenZeppelin `AccessControl`'s `ANCHOR_ROLE` — only
addresses holding that role may write, which stops an unrelated address from squatting an
`(assetId, version)` before the real publisher does. `EVM_SIGNER_PRIVATE_KEY`'s address is
granted the role automatically at deploy time (see
[`contracts/README.md`](../contracts/README.md#access-control-anchor_role)), so no extra
config is needed for the default single-signer setup; granting the role to additional
addresses is how a per-build-server EVM key (e.g. per MindPortalix deployment,
`docs/integration/mindportalix.md`) would be authorized instead.

## How `anchor()` / `verify()` / `status()` work

- **`anchor(commitment)`** reads the contract first. Nothing anchored yet → submits
  `anchor(...)` and waits for `EVM_CONFIRMATIONS` confirmations before returning. Already
  anchored with the *same* commitment (a re-publish of identical content) → idempotent,
  no new transaction; the original tx hash is recovered from the `Anchored` event logs
  rather than cached locally, since the chain is the only source of truth. Already
  anchored with a *different* commitment → throws loudly (an overwrite attempt).
- **`verify(ref, commitment)`** recomputes the commitment hash from the caller-supplied
  `commitment` and reads the contract's current state for `(assetId, version)` fresh —
  it never trusts a previously stored hash (skill: okf-blockchain-anchor).
- **`status(ref)`** reads the transaction receipt, counts confirmations against the
  current block, and decodes the committed hash from the `Anchored` event.

## Testing

```bash
docker compose --profile chain up -d chain
pnpm contracts:build && pnpm contracts:test          # Solidity tests (needs Foundry)
EVM_SIGNER_PRIVATE_KEY=0x... pnpm contracts:deploy:anvil

EVM_RPC_URL=http://localhost:58545 \
EVM_ANCHOR_CONTRACT_ADDRESS=<deployed address> \
EVM_SIGNER_PRIVATE_KEY=0x... \
  pnpm --filter @okf-anchor/providers run test
```

Every test in `packages/providers/test/evm-anchor.test.ts` returns early when Anvil isn't
reachable or the contract isn't deployed, so `pnpm test` still passes without the compose
stack (same convention as the Postgres and IPFS integration tests). The pure helper
(`assetIdToBytes32`) and the constructor's network-id derivation are covered by
unconditional unit tests in the same file that need no network at all.
