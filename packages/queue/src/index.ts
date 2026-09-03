/**
 * BullMQ wiring shared by the API (enqueues a mint) and the worker (runs it).
 * Blockchain anchoring must never block an HTTP request, so `POST /bundles`
 * returns a job id and this queue carries the work (plan §5, §27).
 */
import { Queue, Worker, type ConnectionOptions, type Job, type Processor } from "bullmq";

export const MINT_QUEUE = "okf-mint";

export interface MintJobData {
  readonly mintJobId: string;
}

export interface MintJobResultData {
  readonly state: string;
  readonly assetId?: string;
  readonly assetVersionId?: string;
  readonly error?: string;
}

function redisUrl(): string {
  return process.env["REDIS_URL"] ?? "redis://localhost:6379";
}

export function connection(): ConnectionOptions {
  const url = new URL(redisUrl());
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    ...(url.password ? { password: url.password } : {}),
    maxRetriesPerRequest: null,
  };
}

let queueSingleton: Queue<MintJobData, MintJobResultData> | undefined;

export function mintQueue(): Queue<MintJobData, MintJobResultData> {
  queueSingleton ??= new Queue<MintJobData, MintJobResultData>(MINT_QUEUE, {
    connection: connection(),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 2000 },
      removeOnComplete: { age: 3600, count: 500 },
      removeOnFail: { age: 86_400 },
    },
  });
  return queueSingleton;
}

export async function enqueueMint(mintJobId: string): Promise<string> {
  const job = await mintQueue().add("mint", { mintJobId }, { jobId: mintJobId });
  return job.id ?? mintJobId;
}

export function createMintWorker(
  processor: Processor<MintJobData, MintJobResultData>,
): Worker<MintJobData, MintJobResultData> {
  return new Worker<MintJobData, MintJobResultData>(MINT_QUEUE, processor, {
    connection: connection(),
    concurrency: Number(process.env["OKF_MINT_CONCURRENCY"] ?? 2),
  });
}

export type { Job };
