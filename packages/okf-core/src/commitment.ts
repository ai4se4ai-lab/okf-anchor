/**
 * The commitment: the compact record whose hash is what actually gets written
 * on-chain by an `AnchorProvider`. It binds the asset identity and version to
 * every hash in the pipeline. `AnchorProvider.verify()` recomputes this from
 * retrieved canonical content and compares — it never trusts a stored hash
 * (skill: okf-blockchain-anchor).
 */
import { sha256Hex } from "./hash.js";
import { canonicalize } from "./jcs.js";

export interface Commitment {
  readonly assetId: string;
  readonly versionNumber: number;
  readonly okfVersion: string;
  readonly canonicalHash: string;
  readonly merkleRoot: string;
  readonly graphHash: string;
  readonly manifestHash: string;
  readonly storageCid: string;
  /** Publisher identifier (e.g. build-server id or wallet address). */
  readonly publisher: string;
}

export function commitmentHash(commitment: Commitment): string {
  return sha256Hex(
    canonicalize({
      assetId: commitment.assetId,
      versionNumber: commitment.versionNumber,
      okfVersion: commitment.okfVersion,
      canonicalHash: commitment.canonicalHash,
      merkleRoot: commitment.merkleRoot,
      graphHash: commitment.graphHash,
      manifestHash: commitment.manifestHash,
      storageCid: commitment.storageCid,
      publisher: commitment.publisher,
    }),
  );
}
