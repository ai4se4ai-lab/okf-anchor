import { readRecentRuns, streamIndex } from "@okf-anchor/activity";
import { apiError } from "@/server/api";
import { rateLimit } from "@/server/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A single SSE connection is closed after this long; the browser's EventSource reconnects on its own. */
const MAX_CONNECTION_MS = 5 * 60_000;
const HEARTBEAT_MS = 15_000;
const STREAM_ID = /^\d+-\d+$/;

/**
 * Server-Sent Events tail of the global mint/verify activity index. Read-only
 * and unauthenticated, exactly like `/api/public/chain/live`: every row is a
 * redacted `ActivityRunSummary` of already-public pipeline metadata — never a
 * knowledge payload, an asset slug, or a secret (CLAUDE.md §2, §3). Honours
 * `Last-Event-ID` for resume; heartbeats keep proxies from idling the socket.
 */
export async function GET(req: Request): Promise<Response> {
  const ip = req.headers.get("x-forwarded-for") ?? "anon";
  const rl = await rateLimit(`activitystream:${ip}`, 20, 60);
  if (!rl.ok) return apiError("RATE_LIMITED", "too many stream connections", 429);

  const headerLastId = req.headers.get("last-event-id") ?? "";
  const lastId = STREAM_ID.test(headerLastId) ? headerLastId : "$";

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const send = (chunk: string): void => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          open = false;
        }
      };

      send("retry: 3000\n\n");

      // Seed the client with current state (oldest-first so newest ends on top).
      try {
        const seed = await readRecentRuns(30);
        for (const summary of seed.reverse()) {
          send(`event: run\ndata: ${JSON.stringify(summary)}\n\n`);
        }
      } catch {
        /* seeding is best-effort */
      }

      const ac = new AbortController();
      const onClientAbort = (): void => ac.abort();
      req.signal.addEventListener("abort", onClientAbort, { once: true });
      const heartbeat = setInterval(() => send(`: ping ${Date.now()}\n\n`), HEARTBEAT_MS);
      const deadline = setTimeout(() => ac.abort(), MAX_CONNECTION_MS);

      try {
        for await (const { id, summary } of streamIndex({ signal: ac.signal, lastId })) {
          send(`id: ${id}\nevent: run\ndata: ${JSON.stringify(summary)}\n\n`);
        }
      } catch {
        /* stream ended or Redis dropped — fall through to cleanup, client reconnects */
      } finally {
        open = false;
        clearInterval(heartbeat);
        clearTimeout(deadline);
        req.signal.removeEventListener("abort", onClientAbort);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
