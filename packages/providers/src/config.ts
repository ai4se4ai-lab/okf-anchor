/**
 * Provider selection is configuration, not code branching in callers
 * (CLAUDE.md §5). Every provider defaults to its local, offline implementation
 * so `docker compose up` runs the whole pipeline with no external network.
 * Real IPFS / EVM / DKG / external-SPARQL implementations slot in here by env
 * without any change to the pipeline code that consumes the interfaces.
 */
import { join } from "node:path";
import { LocalAnchorProvider, type AnchorProvider } from "./anchor.js";
import { LocalGraphProvider, type GraphProvider } from "./graph.js";
import { LocalStorageProvider, type StorageProvider } from "./storage.js";
import { EnvSigner, type Signer } from "./signer.js";

export interface ProviderEnv {
  STORAGE_PROVIDER?: string;
  ANCHOR_PROVIDER?: string;
  GRAPH_PROVIDER?: string;
  SIGNER?: string;
  OKF_DATA_DIR?: string;
  SIGNER_PRIVATE_KEY_PEM?: string;
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
      // case "ipfs": return new IpfsStorageProvider(...)  — verify kubo-rpc-client API first
      default:
        throw new Error(`unknown STORAGE_PROVIDER: ${env.STORAGE_PROVIDER}`);
    }
  })();

  const anchor = ((): AnchorProvider => {
    switch (env.ANCHOR_PROVIDER ?? "local") {
      case "local":
        return new LocalAnchorProvider(join(dataDir, "anchor", "ledger.json"));
      // case "evm": return new EvmAnchorProvider(...)  — verify viem/contract ABI first
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
