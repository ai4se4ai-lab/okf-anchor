/**
 * `Signer` — the single narrow interface behind which private key material
 * lives (CLAUDE.md §3, skill: okf-blockchain-anchor). Application code asks the
 * signer to sign bytes and never handles the key. `EnvSigner` loads an Ed25519
 * key from an environment variable for local dev only; production wires a
 * KMS-backed implementation here without touching callers.
 */
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto";

export interface PublicKeyInfo {
  readonly algorithm: "ed25519";
  /** Raw 32-byte public key, hex. */
  readonly publicKeyHex: string;
}

export interface Signature {
  readonly algorithm: "ed25519";
  /** 64-byte signature, hex. */
  readonly signatureHex: string;
  readonly publicKeyHex: string;
}

export interface Signer {
  readonly kind: string;
  sign(bytes: Uint8Array): Promise<Signature>;
  publicKey(): Promise<PublicKeyInfo>;
}

function rawPublicKeyHex(keyObject: ReturnType<typeof createPublicKey>): string {
  // DER SubjectPublicKeyInfo for Ed25519 is a fixed 12-byte prefix + 32-byte key.
  const der = keyObject.export({ type: "spki", format: "der" });
  return Buffer.from(der.subarray(der.length - 32)).toString("hex");
}

export class EnvSigner implements Signer {
  readonly kind = "env";
  private readonly privateKey: ReturnType<typeof createPrivateKey>;
  private readonly pubHex: string;

  private constructor(privateKey: ReturnType<typeof createPrivateKey>) {
    this.privateKey = privateKey;
    this.pubHex = rawPublicKeyHex(createPublicKey(privateKey));
  }

  /** From a PKCS#8 PEM string (dev `.env` only). */
  static fromPem(pem: string): EnvSigner {
    return new EnvSigner(createPrivateKey({ key: pem, format: "pem" }));
  }

  /** Generate an ephemeral key — used when no dev key is configured. */
  static ephemeral(): EnvSigner {
    const { privateKey } = generateKeyPairSync("ed25519");
    return new EnvSigner(privateKey);
  }

  async sign(bytes: Uint8Array): Promise<Signature> {
    const sig = sign(null, Buffer.from(bytes), this.privateKey);
    return {
      algorithm: "ed25519",
      signatureHex: sig.toString("hex"),
      publicKeyHex: this.pubHex,
    };
  }

  async publicKey(): Promise<PublicKeyInfo> {
    return { algorithm: "ed25519", publicKeyHex: this.pubHex };
  }
}

/** Verify a detached Ed25519 signature given the raw 32-byte public key hex. */
export function verifySignature(bytes: Uint8Array, signatureHex: string, publicKeyHex: string): boolean {
  const spkiPrefix = Buffer.from("302a300506032b6570032100", "hex");
  const der = Buffer.concat([spkiPrefix, Buffer.from(publicKeyHex, "hex")]);
  const key = createPublicKey({ key: der, format: "der", type: "spki" });
  try {
    return verify(null, Buffer.from(bytes), key, Buffer.from(signatureHex, "hex"));
  } catch {
    return false;
  }
}
