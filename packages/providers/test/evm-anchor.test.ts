/**
 * Integration tests against a real Anvil node (`docker compose --profile chain
 * up -d chain`, RPC on `EVM_RPC_URL` / default `http://localhost:58545`) with
 * `OKFAnchor.sol` deployed at `EVM_ANCHOR_CONTRACT_ADDRESS` (see
 * `contracts/README.md`). Every test returns early when either isn't available,
 * so `pnpm test` still runs without Foundry installed (same convention as
 * `packages/providers/test/ipfs-storage.test.ts`).
 */
import { createPublicClient, http, isHex, type Hex } from "viem";
import { beforeAll, describe, expect, it } from "vitest";
import {
  assetIdToBytes32,
  createProviders,
  EvmAnchorProvider,
  MAX_LIVE_ANCHORS,
  MAX_LIVE_BLOCKS,
  type Commitment,
  type Providers,
} from "../src/index.js";

const EVM_RPC_URL = process.env["EVM_RPC_URL"] ?? "http://localhost:58545";
const EVM_ANCHOR_CONTRACT_ADDRESS = process.env["EVM_ANCHOR_CONTRACT_ADDRESS"];
// Anvil's well-known, publicly documented dev account #0 — never used for real funds.
const EVM_SIGNER_PRIVATE_KEY =
  process.env["EVM_SIGNER_PRIVATE_KEY"] ?? "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

let providers: Providers | null = null;
let chainUp = false;

function makeCommitment(overrides: Partial<Commitment> = {}): Commitment {
  return {
    assetId: `asset_${Math.random().toString(36).slice(2)}`,
    versionNumber: 1,
    okfVersion: "0.2",
    canonicalHash: "a".repeat(64),
    merkleRoot: "b".repeat(64),
    graphHash: "c".repeat(64),
    manifestHash: "d".repeat(64),
    storageCid: "okf1:" + "e".repeat(64),
    publisher: "build-server:demo",
    ...overrides,
  };
}

beforeAll(async () => {
  if (!EVM_ANCHOR_CONTRACT_ADDRESS) {
    console.warn(
      "skipping EvmAnchorProvider tests: EVM_ANCHOR_CONTRACT_ADDRESS not set (deploy OKFAnchor.sol first — see contracts/README.md)",
    );
    return;
  }
  try {
    const client = createPublicClient({ transport: http(EVM_RPC_URL) });
    const code = await client.getCode({ address: EVM_ANCHOR_CONTRACT_ADDRESS as Hex });
    chainUp = !!code && code !== "0x";
    if (!chainUp) {
      console.warn(`skipping EvmAnchorProvider tests: no contract code at ${EVM_ANCHOR_CONTRACT_ADDRESS}`);
      return;
    }
    providers = createProviders({
      ANCHOR_PROVIDER: "evm",
      EVM_RPC_URL,
      EVM_ANCHOR_CONTRACT_ADDRESS,
      EVM_SIGNER_PRIVATE_KEY,
      EVM_CHAIN_ID: "31337",
      EVM_CONFIRMATIONS: "1",
    });
  } catch (err) {
    console.warn(`skipping EvmAnchorProvider tests: Anvil not reachable at ${EVM_RPC_URL} (${(err as Error).message})`);
  }
});

// Anvil's default 1s block time (docker-compose.yml `chain` service) means each
// anchor transaction takes several seconds to confirm — well past vitest's 5s
// default test timeout, so every test here gets explicit headroom.
const TX_TIMEOUT_MS = 15_000;

describe("EvmAnchorProvider (real Anvil)", () => {
  it(
    "anchors a commitment on-chain and verifies it",
    async () => {
      if (!chainUp || !providers) return;
      const commitment = makeCommitment();
      const ref = await providers.anchor.anchor(commitment);
      expect(ref.provider).toBe("evm");
      expect(ref.network).toBe("eip155:31337");
      expect(ref.ref).toMatch(/^0x[0-9a-f]{64}$/);

      const status = await providers.anchor.status(ref);
      expect(status.state).toBe("confirmed");
      expect(status.committedHash).toBeTruthy();

      const result = await providers.anchor.verify(ref, commitment);
      expect(result.ok).toBe(true);
      expect(result.anchoredHash).toBe(result.expectedHash);
    },
    TX_TIMEOUT_MS,
  );

  it(
    "rejects verification against tampered content",
    async () => {
      if (!chainUp || !providers) return;
      const commitment = makeCommitment();
      const ref = await providers.anchor.anchor(commitment);
      const tampered = { ...commitment, canonicalHash: "f".repeat(64) };
      const result = await providers.anchor.verify(ref, tampered);
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/does not match/);
    },
    TX_TIMEOUT_MS,
  );

  it(
    "re-anchoring identical content is idempotent (no revert, same on-chain state)",
    async () => {
      if (!chainUp || !providers) return;
      const commitment = makeCommitment();
      const a = await providers.anchor.anchor(commitment);
      const b = await providers.anchor.anchor(commitment);
      expect(b.ref).toBe(a.ref);
    },
    TX_TIMEOUT_MS,
  );

  it(
    "fails loud when re-anchoring the same (assetId, version) with different content",
    async () => {
      if (!chainUp || !providers) return;
      const commitment = makeCommitment();
      await providers.anchor.anchor(commitment);
      const changed = { ...commitment, canonicalHash: "f".repeat(64) };
      await expect(providers.anchor.anchor(changed)).rejects.toThrow(/already exists with a different commitment/);
    },
    TX_TIMEOUT_MS,
  );

  it("verify() reports not-found for an assetId that was never anchored", async () => {
    if (!chainUp || !providers) return;
    const commitment = makeCommitment();
    const result = await providers.anchor.verify(
      { provider: "evm", network: "eip155:31337", ref: "0x" + "0".repeat(64) },
      commitment,
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/not found/);
  });

  it(
    "each version of the same asset gets its own independent anchor",
    async () => {
      if (!chainUp || !providers) return;
      const assetId = `asset_${Math.random().toString(36).slice(2)}`;
      const v1 = makeCommitment({ assetId, versionNumber: 1 });
      const v2 = makeCommitment({ assetId, versionNumber: 2, canonicalHash: "1".repeat(64) });
      const refV1 = await providers.anchor.anchor(v1);
      const refV2 = await providers.anchor.anchor(v2);
      expect(refV1.ref).not.toBe(refV2.ref);
      expect((await providers.anchor.verify(refV1, v1)).ok).toBe(true);
      expect((await providers.anchor.verify(refV2, v2)).ok).toBe(true);
    },
    20_000,
  );

  it(
    "getLiveSnapshot returns recent blocks and the anchors written to them",
    async () => {
      if (!chainUp || !providers) return;
      const evm = providers.anchor as EvmAnchorProvider;
      const commitment = makeCommitment();
      const ref = await evm.anchor(commitment);

      const snapshot = await evm.getLiveSnapshot({ blockCount: 5, anchorCount: 5 });
      expect(snapshot.chainId).toBe(31337);
      expect(snapshot.network).toBe("eip155:31337");
      expect(snapshot.blocks.length).toBeGreaterThan(0);
      expect(snapshot.blocks.length).toBeLessThanOrEqual(5);
      // Descending by block number, most recent first.
      for (let i = 1; i < snapshot.blocks.length; i++) {
        expect(snapshot.blocks[i]!.number).toBeLessThan(snapshot.blocks[i - 1]!.number);
      }
      expect(snapshot.latestBlockNumber).toBe(snapshot.blocks[0]!.number);

      const anchoredTxHash = ref.ref;
      const found = snapshot.anchors.find((a) => a.transactionHash.toLowerCase() === anchoredTxHash.toLowerCase());
      expect(found).toBeTruthy();
      expect(found!.bundleCid).toBe(commitment.storageCid);
      expect(found!.versionNumber).toBe(commitment.versionNumber);
    },
    TX_TIMEOUT_MS,
  );

  it("getLiveSnapshot clamps out-of-range counts instead of trusting the caller", async () => {
    if (!chainUp || !providers) return;
    const evm = providers.anchor as EvmAnchorProvider;
    const snapshot = await evm.getLiveSnapshot({ blockCount: 10_000, anchorCount: -5 });
    expect(snapshot.blocks.length).toBeLessThanOrEqual(MAX_LIVE_BLOCKS);
    expect(snapshot.anchors.length).toBeLessThanOrEqual(MAX_LIVE_ANCHORS);
  });
});

describe("assetIdToBytes32 (pure, no network)", () => {
  it("is deterministic and produces a 32-byte hex value", () => {
    const a = assetIdToBytes32("asset_1");
    const b = assetIdToBytes32("asset_1");
    expect(a).toBe(b);
    expect(isHex(a)).toBe(true);
    expect(a.length).toBe(66); // "0x" + 64 hex chars
  });

  it("different asset ids hash to different values", () => {
    expect(assetIdToBytes32("asset_1")).not.toBe(assetIdToBytes32("asset_2"));
  });
});

describe("EvmAnchorProvider construction (no network required)", () => {
  it("derives the eip155 network id from the configured chain id", () => {
    const provider = new EvmAnchorProvider({
      rpcUrl: "http://127.0.0.1:1", // never contacted in this test
      chainId: 31337,
      contractAddress: "0x0000000000000000000000000000000000000001",
      privateKey: EVM_SIGNER_PRIVATE_KEY as Hex,
      confirmations: 1,
      requestTimeoutMs: 1000,
    });
    expect(provider.kind).toBe("evm");
    expect(provider.network).toBe("eip155:31337");
  });
});
