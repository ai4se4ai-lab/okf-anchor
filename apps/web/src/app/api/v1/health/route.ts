import { NextResponse } from "next/server";
import { prisma } from "@/server/providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  let db = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    db = true;
  } catch {
    db = false;
  }
  return NextResponse.json({
    status: db ? "ok" : "degraded",
    service: "okf-anchor",
    time: new Date().toISOString(),
    checks: { database: db },
  });
}
