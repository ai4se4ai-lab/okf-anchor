/**
 * Server-to-server authentication for build servers. A request carries
 * `Authorization: Bearer <token>`; we look the credential up by its 12-char
 * prefix, then compare the full token's SHA-256 in constant time. Optionally the
 * request is Ed25519-signed (`X-OKF-Signature` over the raw body) and verified
 * against the build server's registered public key (skill: okf-security).
 */
import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { verifySignature } from "@okf-anchor/providers";
import { prisma } from "@okf-anchor/db";

export interface AuthedServer {
  buildServerId: string;
  publisherId: string;
  organizationId: string;
  credentialId: string;
}

export class AuthError extends Error {
  readonly status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.status = status;
  }
}

function sha256Hex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

export async function authenticateServer(req: Request, rawBody?: Uint8Array): Promise<AuthedServer> {
  const header = req.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) throw new AuthError("missing bearer token");
  const token = match[1]!.trim();
  if (token.length < 16 || token.length > 200) throw new AuthError("malformed token");

  const credential = await prisma.apiCredential.findUnique({
    where: { tokenPrefix: token.slice(0, 12) },
    include: { buildServer: true },
  });
  if (!credential || credential.revokedAt) throw new AuthError("invalid token");
  if (credential.buildServer.disabledAt) throw new AuthError("build server disabled", 403);

  const provided = Buffer.from(sha256Hex(token), "hex");
  const stored = Buffer.from(credential.tokenHash, "hex");
  if (provided.length !== stored.length || !timingSafeEqual(provided, stored)) {
    throw new AuthError("invalid token");
  }

  const signature = req.headers.get("x-okf-signature");
  if (signature) {
    if (!credential.buildServer.publicKeyHex) {
      throw new AuthError("request is signed but no public key is registered", 400);
    }
    if (!rawBody) throw new AuthError("cannot verify signature without a raw body", 400);
    if (!verifySignature(rawBody, signature, credential.buildServer.publicKeyHex)) {
      throw new AuthError("signature verification failed");
    }
  }

  await prisma.apiCredential.update({
    where: { id: credential.id },
    data: { lastUsedAt: new Date() },
  });

  return {
    buildServerId: credential.buildServerId,
    publisherId: credential.buildServer.publisherId,
    organizationId: credential.buildServer.organizationId,
    credentialId: credential.id,
  };
}

export async function recordAudit(input: {
  actorType: "HUMAN" | "BUILD_SERVER" | "SYSTEM";
  actorId: string;
  action: string;
  subjectType: string;
  subjectId: string;
  ip?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await prisma.auditEvent.create({
    data: {
      actorType: input.actorType,
      actorId: input.actorId,
      action: input.action,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      ip: input.ip ?? null,
      metadata: input.metadata ? (input.metadata as object) : undefined,
    },
  });
}
