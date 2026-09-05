import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createLogger } from "./index.js";

describe("createLogger", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // The repo's eslint no-console rule only allows warn/error, so debug/info/warn
    // all route through console.warn and only "error" uses console.error.
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("writes info/debug/warn to console.warn and only error to console.error", () => {
    const logger = createLogger("test");
    logger.info("hello");
    logger.warn("careful");
    logger.error("boom");

    expect(warnSpy).toHaveBeenCalledTimes(2);
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it("tags every line with the service name and an ISO timestamp", () => {
    createLogger("worker").info("ready");
    const line = warnSpy.mock.calls[0]?.[0] as string;
    expect(line).toContain("[worker]");
    expect(line).toContain("ready");
    expect(line).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/);
  });

  it("redacts secret-shaped keys in meta", () => {
    createLogger("test").info("login", { token: "abc123", userId: "u1" });
    const line = warnSpy.mock.calls[0]?.[0] as string;
    expect(line).not.toContain("abc123");
    expect(line).toContain("token=***");
    expect(line).toContain("userId=u1");
  });

  it("child() merges bindings into every subsequent call", () => {
    const child = createLogger("test").child({ jobId: "j1" });
    child.info("start");
    const line = warnSpy.mock.calls[0]?.[0] as string;
    expect(line).toContain("jobId=j1");
  });

  it("formats Error meta values as name: message and appends the stack", () => {
    createLogger("test").error("failed", { err: new Error("kaboom") });
    const line = errorSpy.mock.calls[0]?.[0] as string;
    expect(line).toContain("err=Error: kaboom");
    expect(line).toContain("Error: kaboom\n"); // stack trace appended
  });
});
