import { describe, expect, it } from "vitest";
import {
  isAttested,
  isStale,
  normalizeSources,
  normalizeVerified,
  trustState,
  trustTier,
} from "../src/index.js";

describe("normalizeSources", () => {
  it("accepts bare strings (the real producer form)", () => {
    const out = normalizeSources({ sources: ["files/a.txt", "policies/b.md"] });
    expect(out).toEqual([
      { resource: "files/a.txt", bare: true },
      { resource: "policies/b.md", bare: true },
    ]);
  });

  it("accepts {id,resource,...} mappings (the reference-corpus form)", () => {
    const out = normalizeSources({
      sources: [
        { id: "rev", resource: "policies/rev.md", title: "Rev", usage_count: 10 },
        { title: "no resource" },
        "bare/path.md",
      ],
    });
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ id: "rev", resource: "policies/rev.md", usageCount: 10, bare: false });
    expect(out[1]).toEqual({ resource: "bare/path.md", bare: true });
  });
});

describe("trust tiers", () => {
  it("no verified → unverified (the common real-bundle case)", () => {
    expect(trustTier({ type: "X", generated: { by: "dsh/unversioned" } })).toBe("unverified");
  });
  it("machine actor → machine-confirmed", () => {
    expect(trustTier({ verified: { by: "process:nightly", at: "2026-01-01T00:00:00Z" } })).toBe(
      "machine-confirmed",
    );
  });
  it("human actor → human-reviewed", () => {
    expect(
      trustTier({ verified: [{ by: "process:x", at: "2026-01-01T00:00:00Z" }, { by: "human:jo" }] }),
    ).toBe("human-reviewed");
  });
  it("content newer than sign-off → verified-stale", () => {
    const fm = {
      generated: { by: "dsh/1", at: "2026-06-02T00:00:00Z" },
      verified: { by: "human:jo", at: "2026-06-01T00:00:00Z" },
    };
    expect(trustTier(fm)).toBe("human-reviewed");
    expect(trustState(fm)).toBe("verified-stale");
  });
});

describe("isStale", () => {
  it("ignores a date-only stale_after (ambiguous instant)", () => {
    expect(isStale({ stale_after: "2020-01-01" }, new Date("2030-01-01T00:00:00Z"))).toBe(false);
  });
  it("honours an offset-qualified stale_after", () => {
    expect(isStale({ stale_after: "2026-01-01T00:00:00Z" }, new Date("2026-02-01T00:00:00Z"))).toBe(
      true,
    );
  });
});

describe("isAttested", () => {
  it("true for type or runtime/executor/attester", () => {
    expect(isAttested({ type: "Attested Computation" })).toBe(true);
    expect(isAttested({ type: "Metric", runtime: "bigquery" })).toBe(true);
    expect(isAttested({ type: "Metric" })).toBe(false);
  });
});

describe("normalizeVerified", () => {
  it("treats a bare mapping as a one-element list (OKF §5.2)", () => {
    expect(normalizeVerified({ verified: { by: "human:jo", at: "2026-01-01T00:00:00Z" } })).toEqual([
      { by: "human:jo", at: "2026-01-01T00:00:00Z" },
    ]);
  });
});
