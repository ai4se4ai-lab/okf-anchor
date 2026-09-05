/**
 * Provider selection is configuration, not code branching in callers
 * (CLAUDE.md §5). Every provider defaults to its local, offline implementation
 * so `docker compose up` runs the whole pipeline with no external network.
 * Real IPFS / EVM / DKG / external-SPARQL implementations slot in here by env
 * without any change to the pipeline code that consumes the interfaces.
 */
import { join } from "node:path";
import type { Address, Hex } from "viem";
import { LocalAnchorProvider, type AnchorProvider } from "./anchor.js";
import { EvmAnchorProvider } from "./evm-anchor.js";
import { LocalGraphProvider, type GraphProvider } from "./graph.js";
import { LocalStorageProvider, type StorageProvider } from "./storage.js";
import { IpfsStorageProvider } from "./ipfs-storage.js";
import { EnvSigner, type Signer } from "./signer.js";

export interface ProviderEnv {
  STORAGE_PROVIDER?: string;
  ANCHOR_PROVIDER?: string;
  GRAPH_PROVIDER?: string;
  SIGNER?: string;
  OKF_DATA_DIR?: string;
  SIGNER_PRIVATE_KEY_PEM?: string;
  // --- IPFS (STORAGE_PROVIDER=ipfs) ---
  IPFS_API_URL?: string;
  IPFS_PIN_ON_PUBLISH?: string;
  IPFS_CONNECT_TIMEOUT_MS?: string;
  IPFS_REQUEST_TIMEOUT_MS?: string;
  IPFS_RETRIEVE_TIMEOUT_MS?: string;
  IPFS_MAX_BUNDLE_SIZE_MB?: string;
  // --- EVM (ANCHOR_PROVIDER=evm) ---
  EVM_RPC_URL?: string;
  EVM_CHAIN_ID?: string;
  EVM_ANCHOR_CONTRACT_ADDRESS?: string;
  EVM_SIGNER_PRIVATE_KEY?: string;
  EVM_CONFIRMATIONS?: string;
  EVM_REQUEST_TIMEOUT_MS?: string;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function parseBool(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined) return fallback;
  return raw === "1" || raw.toLowerCase() === "true";
}

export interface Providers {
  storage: StorageProvider;
  anchor: AnchorProvider;
  graph: GraphProvider;
  signer: Signer;
}

export function createProviders(env: ProviderEnv = process.env): Providers {
  const dataDir = env.OKF_DATA_DIR ?? join(process.cwd(), ".data", "okf");

  const storage = ((): StorageProvider => {
    switch (env.STORAGE_PROVIDER ?? "local") {
      case "local":
        return new LocalStorageProvider(join(dataDir, "storage"));
      case "ipfs": {
        const apiUrl = env.IPFS_API_URL ?? "http://ipfs:5001";
        return new IpfsStorageProvider({
          apiUrl,
          connectTimeoutMs: parsePositiveInt(env.IPFS_CONNECT_TIMEOUT_MS, 5_000),
          requestTimeoutMs: parsePositiveInt(env.IPFS_REQUEST_TIMEOUT_MS, 30_000),
          retrieveTimeoutMs: parsePositiveInt(env.IPFS_RETRIEVE_TIMEOUT_MS, 60_000),
          maxBundleSizeBytes: parsePositiveInt(env.IPFS_MAX_BUNDLE_SIZE_MB, 100) * 1024 * 1024,
          pinOnPublish: parseBool(env.IPFS_PIN_ON_PUBLISH, true),
        });
      }
      default:
        throw new Error(`unknown STORAGE_PROVIDER: ${env.STORAGE_PROVIDER}`);
    }
  })();

  const anchor = ((): AnchorProvider => {
    switch (env.ANCHOR_PROVIDER ?? "local") {
      case "local":
        return new LocalAnchorProvider(join(dataDir, "anchor", "ledger.json"));
      case "evm": {
        const rpcUrl = env.EVM_RPC_URL ?? "http://localhost:8545";
        const contractAddress = env.EVM_ANCHOR_CONTRACT_ADDRESS;
        const privateKey = env.EVM_SIGNER_PRIVATE_KEY;
        if (!contractAddress) throw new Error("EVM_ANCHOR_CONTRACT_ADDRESS is required for ANCHOR_PROVIDER=evm");
        if (!privateKey) throw new Error("EVM_SIGNER_PRIVATE_KEY is required for ANCHOR_PROVIDER=evm");
        return new EvmAnchorProvider({
          rpcUrl,
          chainId: parsePositiveInt(env.EVM_CHAIN_ID, 31337),
          contractAddress: contractAddress as Address,
          privateKey: privateKey as Hex,
          confirmations: parsePositiveInt(env.EVM_CONFIRMATIONS, 1),
          requestTimeoutMs: parsePositiveInt(env.EVM_REQUEST_TIMEOUT_MS, 30_000),
        });
      }
      // case "dkg": return new OriginTrailDkgAnchorProvider(...)  — verify dkg.js types first
      default:
        throw new Error(`unknown ANCHOR_PROVIDER: ${env.ANCHOR_PROVIDER}`);
    }
  })();

  const graph = ((): GraphProvider => {
    switch (env.GRAPH_PROVIDER ?? "local") {
      case "local":
        return new LocalGraphProvider(join(dataDir, "graph"));
      // case "sparql-endpoint": return new RemoteSparqlGraphProvider(...)
      default:
        throw new Error(`unknown GRAPH_PROVIDER: ${env.GRAPH_PROVIDER}`);
    }
  })();

  const signer = ((): Signer => {
    switch (env.SIGNER ?? "local") {
      case "local":
        return env.SIGNER_PRIVATE_KEY_PEM
          ? EnvSigner.fromPem(env.SIGNER_PRIVATE_KEY_PEM)
          : EnvSigner.ephemeral();
      default:
        throw new Error(`unknown SIGNER: ${env.SIGNER}`);
    }
  })();

  return { storage, anchor, graph, signer };
}
