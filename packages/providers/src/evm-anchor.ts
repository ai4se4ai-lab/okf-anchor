/**
 * `EvmAnchorProvider` — writes the commitment to an EVM-compatible chain via the
 * `OKFAnchor` contract (`contracts/src/OKFAnchor.sol`), and never anything else:
 * the chain records one `bytes32` hash plus the storage CID it points at, never
 * the bundle or the derived graph (CLAUDE.md §2, §8; skill: okf-blockchain-anchor).
 *
 * Verified against `viem@2.56.0`'s current docs before writing this (CLAUDE.md
 * §6): `defineChain` for the custom local chain, `privateKeyToAccount` for the
 * hoisted wallet account, `writeContract` + `waitForTransactionReceipt({
 * confirmations })` for submit-and-confirm, and `getContractEvents` /
 * `parseEventLogs` for finding and decoding the `Anchored` event.
 *
 * Key custody: `privateKey` is the EVM transaction-signing key — a different
 * concern from the Ed25519 `Signer` that signs the OKF commitment itself. It is
 * read once from `EVM_SIGNER_PRIVATE_KEY` (dev: Anvil's public throwaway
 * account) and never logged, returned, or persisted; production should inject
 * the same env var from a secrets manager / KMS rather than committing a real
 * key anywhere (CLAUDE.md §3).
 */
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  keccak256,
  parseAbi,
  parseEventLogs,
  stringToHex,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { commitmentHash, type Commitment } from "@okf-anchor/okf-core";
import type { AnchorProvider, AnchorRef, AnchorStatus, VerificationResult } from "./anchor.js";

export const OKF_ANCHOR_ABI = parseAbi([
  "struct Anchor { bytes32 commitment; string bundleCid; address publisher; uint256 timestamp; }",
  "function anchor(bytes32 assetId, uint256 version, bytes32 commitment, string bundleCid) external",
  "function getAnchor(bytes32 assetId, uint256 version) external view returns (Anchor)",
  "event Anchored(bytes32 indexed assetId, uint256 version, bytes32 commitment, string bundleCid, address indexed publisher)",
  "error AlreadyAnchored(bytes32 assetId, uint256 version)",
]);

export interface EvmAnchorOptions {
  readonly rpcUrl: string;
  readonly chainId: number;
  readonly contractAddress: Address;
  /** Dev-only throwaway key or a secrets-manager-injected value; never in source (CLAUDE.md §3). */
  readonly privateKey: Hex;
  /** Confirmations `anchor()` waits for before returning; `status()` reports live confirmations against this. */
  readonly confirmations: number;
  readonly requestTimeoutMs: number;
}

/** `assetId` is an opaque string (a Prisma cuid); the contract only accepts `bytes32`. */
export function assetIdToBytes32(assetId: string): Hex {
  return keccak256(stringToHex(assetId));
}

function commitmentToBytes32(commitment: Commitment): Hex {
  return `0x${commitmentHash(commitment)}`;
}

export class EvmAnchorProvider implements AnchorProvider {
  readonly kind = "evm";
  readonly network: string;
  private readonly chain: Chain;
  private readonly contractAddress: Address;
  private readonly confirmations: number;
  private readonly requestTimeoutMs: number;
  private readonly account: PrivateKeyAccount;
  private readonly publicClient: PublicClient;
  private readonly walletClient: WalletClient;

  constructor(opts: EvmAnchorOptions) {
    this.network = `eip155:${opts.chainId}`;
    this.contractAddress = opts.contractAddress;
    this.confirmations = opts.confirmations;
    this.requestTimeoutMs = opts.requestTimeoutMs;
    this.chain = defineChain({
      id: opts.chainId,
      name: "okf-anchor-evm",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [opts.rpcUrl] } },
    });
    this.account = privateKeyToAccount(opts.privateKey);
    const transport = http(opts.rpcUrl, { timeout: opts.requestTimeoutMs });
    this.publicClient = createPublicClient({ chain: this.chain, transport });
    this.walletClient = createWalletClient({ account: this.account, chain: this.chain, transport });
  }

  private async findAnchoredTxHash(assetIdHash: Hex, version: bigint): Promise<Hex | null> {
    const logs = await this.publicClient.getContractEvents({
      address: this.contractAddress,
      abi: OKF_ANCHOR_ABI,
      eventName: "Anchored",
      args: { assetId: assetIdHash },
      fromBlock: 0n,
      toBlock: "latest",
    });
    const match = logs.find((log) => log.args.version === version);
    return match?.transactionHash ?? null;
  }

  async anchor(commitment: Commitment): Promise<AnchorRef> {
    const assetIdHash = assetIdToBytes32(commitment.assetId);
    const version = BigInt(commitment.versionNumber);
    const expectedBytes32 = commitmentToBytes32(commitment);

    const existing = await this.publicClient.readContract({
      address: this.contractAddress,
      abi: OKF_ANCHOR_ABI,
      functionName: "getAnchor",
      args: [assetIdHash, version],
    });

    if (existing.timestamp !== 0n) {
      if (existing.commitment.toLowerCase() !== expectedBytes32.toLowerCase()) {
        throw new Error(
          `EVM anchor for assetId=${commitment.assetId} version=${commitment.versionNumber} ` +
            `already exists with a different commitment — an anchor is immutable once written`,
        );
      }
      // Idempotent re-publish of identical content: no new transaction. Recover
      // the original tx hash from the chain itself rather than caching one
      // locally — the chain is the only source of truth here.
      const ref = await this.findAnchoredTxHash(assetIdHash, version);
      return {
        provider: this.kind,
        network: this.network,
        ref: ref ?? `${this.network}:${assetIdHash}:${commitment.versionNumber}`,
      };
    }

    const txHash = await this.walletClient.writeContract({
      address: this.contractAddress,
      abi: OKF_ANCHOR_ABI,
      functionName: "anchor",
      args: [assetIdHash, version, expectedBytes32, commitment.storageCid],
      account: this.account,
      chain: this.chain,
    });

    const receipt = await this.publicClient.waitForTransactionReceipt({
      hash: txHash,
      confirmations: this.confirmations,
      timeout: this.requestTimeoutMs,
    });
    if (receipt.status !== "success") {
      throw new Error(`EVM anchor transaction reverted: ${txHash}`);
    }

    return { provider: this.kind, network: this.network, ref: txHash };
  }

  async verify(ref: AnchorRef, commitment: Commitment): Promise<VerificationResult> {
    const expectedHash = commitmentHash(commitment);
    if (ref.provider !== this.kind || ref.network !== this.network) {
      return { ok: false, expectedHash, anchoredHash: null, reason: "anchor ref is not for this EVM network" };
    }

    const assetIdHash = assetIdToBytes32(commitment.assetId);
    const version = BigInt(commitment.versionNumber);
    // Recomputed and read fresh from the chain every time — never trusts a
    // stored copy of the hash (skill: okf-blockchain-anchor).
    const existing = await this.publicClient.readContract({
      address: this.contractAddress,
      abi: OKF_ANCHOR_ABI,
      functionName: "getAnchor",
      args: [assetIdHash, version],
    });

    if (existing.timestamp === 0n) {
      return { ok: false, expectedHash, anchoredHash: null, reason: "anchor not found on chain" };
    }
    const anchoredHash = existing.commitment.slice(2).toLowerCase();
    const ok = anchoredHash === expectedHash.toLowerCase();
    return ok
      ? { ok, expectedHash, anchoredHash }
      : { ok, expectedHash, anchoredHash, reason: "anchored commitment does not match content" };
  }

  async status(ref: AnchorRef): Promise<AnchorStatus> {
    if (ref.provider !== this.kind || ref.network !== this.network) {
      return { state: "failed", confirmations: 0, committedHash: null, error: "anchor ref is not for this EVM network" };
    }
    if (!ref.ref.startsWith("0x")) {
      // A synthetic ref (no tx hash could be recovered from logs) — treat the
      // on-chain record itself as the source of truth for "confirmed".
      return { state: "confirmed", confirmations: this.confirmations, committedHash: null };
    }

    let receipt;
    try {
      receipt = await this.publicClient.getTransactionReceipt({ hash: ref.ref as Hex });
    } catch {
      return { state: "submitted", confirmations: 0, committedHash: null };
    }

    const currentBlock = await this.publicClient.getBlockNumber();
    const confirmations = Number(currentBlock - receipt.blockNumber + 1n);

    if (receipt.status !== "success") {
      return {
        state: "failed",
        confirmations,
        committedHash: null,
        blockNumber: Number(receipt.blockNumber),
        error: "transaction reverted",
      };
    }

    const [anchoredEvent] = parseEventLogs({ abi: OKF_ANCHOR_ABI, eventName: "Anchored", logs: receipt.logs });
    const committedHash = anchoredEvent ? anchoredEvent.args.commitment.slice(2).toLowerCase() : null;

    return {
      state: confirmations >= this.confirmations ? "confirmed" : "submitted",
      confirmations,
      committedHash,
      blockNumber: Number(receipt.blockNumber),
    };
  }
}
