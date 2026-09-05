import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { __setActivityRedisForTests } from "../src/redis.js";
import { createActivityRecorder, sanitizeDetail } from "../src/recorder.js";
import { readRecentRuns, readRun, streamIndex } from "../src/reader.js";
import { isValidRunId, INDEX_STREAM_KEY } from "../src/event.js";
import { FakeRedisStreams } from "./fake-redis.js";

let fake: FakeRedisStreams;

beforeEach(() => {
  fake = new FakeRedisStreams();
  __setActivityRedisForTests({ pooled: fake, blocking: () => fake });
});

afterEach(() => {
  __setActivityRedisForTests(null);
});

describe("sanitizeDetail", () => {
  it("drops secret-shaped keys and keeps the rest", () => {
    const out = sanitizeDetail({
      cid: "bafy123",
      privateKey: "0xdeadbeef",
      EVM_SIGNER_PRIVATE_KEY: "0xabc",
      authorization: "Bearer okf_x",
      token: "okf_secret",
      mnemonic: "twelve words",
      blockNumber: 42,
      ok: true,
      nothing: null,
    });
    expect(out).toEqual({ cid: "bafy123", blockNumber: 42, ok: true, nothing: null });
  });

  it("coerces away non-primitive values and truncates long strings", () => {
    const out = sanitizeDetail({
      obj: { a: 1 } as unknown as string,
      arr: [1, 2, 3] as unknown as string,
      long: "x".repeat(2000),
    });
    expect(out).toBeDefined();
    expect(out).not.toHaveProperty("obj");
    expect(out).not.toHaveProperty("arr");
    expect((out!["long"] as string).length).toBeLessThan(600);
  });
});

describe("ActivityRecorder", () => {
  it("records events to a per-run stream in seq order, with a TTL", async () => {
    const rec = createActivityRecorder();
    await rec.start({ runId: "run-1", kind: "mint" });
    await rec.event("run-1", { phase: "validate", level: "info", message: "a", layer: "okf" });
    await rec.event("run-1", { phase: "store", level: "info", message: "b", layer: "storage", detail: { cid: "bafy1" } });
    await rec.finish("run-1", { state: "done", assetId: "asset-1", versionNumber: 3 });

    const log = await readRun("run-1");
    expect(log.events.map((e) => e.phase)).toEqual(["validate", "store"]);
    expect(log.events.map((e) => e.seq)).toEqual([1, 2]);
    expect(log.events[1]!.detail).toEqual({ cid: "bafy1" });
    expect(fake.ttl.get("okf:activity:run:run-1")).toBeGreaterThan(0);
  });

  it("never writes a secret into the stream even if the pipeline emits one", async () => {
    const rec = createActivityRecorder();
    await rec.start({ runId: "run-2", kind: "mint" });
    await rec.event("run-2", {
      phase: "sign",
      level: "info",
      message: "signing",
      detail: { privateKey: "0xTHIS_MUST_NOT_LEAK", EVM_SIGNER_PRIVATE_KEY: "0xNOPE", publicKeyHex: "0xpub" },
    });
    const raw = JSON.stringify(fake.streams.get("okf:activity:run:run-2"));
    expect(raw).not.toContain("MUST_NOT_LEAK");
    expect(raw).not.toContain("0xNOPE");
    expect(raw).toContain("0xpub");
  });

  it("caps the per-run stream length", async () => {
    process.env["OKF_ACTIVITY_RUN_MAXLEN"] = "5";
    const rec = createActivityRecorder();
    await rec.start({ runId: "run-3", kind: "verify" });
    for (let i = 0; i < 20; i++) {
      await rec.event("run-3", { phase: `p${i}`, level: "info", message: `m${i}` });
    }
    expect(fake.streams.get("okf:activity:run:run-3")!.length).toBeLessThanOrEqual(5);
    delete process.env["OKF_ACTIVITY_RUN_MAXLEN"];
  });

  it("writes an index summary on start, phase change, and finish", async () => {
    const rec = createActivityRecorder();
    await rec.start({ runId: "run-4", kind: "mint" });
    await rec.event("run-4", { phase: "validate", level: "info", message: "a" });
    await rec.event("run-4", { phase: "validate", level: "info", message: "still validating" });
    await rec.event("run-4", { phase: "store", level: "info", message: "b" });
    await rec.finish("run-4", { state: "done" });

    const phases = fake.streams.get(INDEX_STREAM_KEY)!.map((e) => JSON.parse(e.fields[1]!).phase);
    expect(phases).toEqual(["start", "validate", "store", "done"]);
  });
});

describe("readers", () => {
  it("readRecentRuns collapses to the latest row per run, newest first", async () => {
    const rec = createActivityRecorder();
    await rec.start({ runId: "run-a", kind: "mint" });
    await rec.event("run-a", { phase: "store", level: "info", message: "x" });
    await rec.start({ runId: "run-b", kind: "verify" });
    await rec.finish("run-b", { state: "done" });
    await rec.finish("run-a", { state: "error", note: "boom" });

    const runs = await readRecentRuns(10);
    expect(runs.map((r) => r.runId)).toEqual(["run-a", "run-b"]);
    expect(runs[0]!.state).toBe("error");
    expect(runs[0]!.phase).toBe("error");
  });

  it("readRun rejects a malformed runId", async () => {
    await expect(readRun("../etc/passwd")).rejects.toThrow(/invalid runId/);
  });

  it("streamIndex yields index rows then ends when aborted", async () => {
    const rec = createActivityRecorder();
    await rec.start({ runId: "run-s", kind: "mint" });
    await rec.event("run-s", { phase: "store", level: "info", message: "x" });

    const ac = new AbortController();
    const seen: string[] = [];
    const iter = streamIndex({ signal: ac.signal, lastId: "0", blockMs: 5 });
    for await (const item of iter) {
      seen.push(item.summary.runId);
      if (seen.length >= 2) {
        ac.abort();
        break;
      }
    }
    expect(seen).toContain("run-s");
  });
});

describe("isValidRunId", () => {
  it("accepts uuids and short slugs, rejects path/space/long", () => {
    expect(isValidRunId(crypto.randomUUID())).toBe(true);
    expect(isValidRunId("mint-job-123")).toBe(true);
    expect(isValidRunId("../x")).toBe(false);
    expect(isValidRunId("has space")).toBe(false);
    expect(isValidRunId("x".repeat(65))).toBe(false);
  });
});
