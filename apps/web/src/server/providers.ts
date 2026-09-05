/**
 * Process-wide provider + Prisma singletons for the app. Provider selection is
 * driven entirely by env (`*_PROVIDER=local` by default), never by code here.
 */
import "server-only";
import { createProviders, type Providers } from "@okf-anchor/providers";

declare global {
  var __okfProviders: Providers | undefined;
}

export const providers: Providers = globalThis.__okfProviders ?? createProviders();
if (process.env.NODE_ENV !== "production") globalThis.__okfProviders = providers;

export { prisma } from "@okf-anchor/db";

export const publicBaseUrl =
  process.env.OKF_PUBLIC_BASE_URL ?? process.env.NEXTAUTH_URL ?? "http://localhost:3000";

/** Browser-facing gateway link only — the server never fetches this URL itself
 * (CLAUDE.md §3 SSRF rule); it just builds an "open in gateway" link for the UI. */
export const ipfsGatewayUrl = process.env.IPFS_GATEWAY_URL ?? null;
