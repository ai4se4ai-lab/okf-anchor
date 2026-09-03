import { describe, expect, it } from "vitest";
import { extractConceptLinks, resolveInBundlePath } from "../src/index.js";

describe("extractConceptLinks", () => {
  it("appends .md to extensionless relative links (the real producer form)", () => {
    const body = `
See [IEEE formatting policy](policies/formatting-ieee) and
[venue](../seet-2027) and [topics](topics).
`;
    expect(extractConceptLinks("icse/seet-2027/evaluation-criteria.md", body)).toEqual([
      "icse/seet-2027.md",
      "icse/seet-2027/policies/formatting-ieee.md",
      "icse/seet-2027/topics.md",
    ]);
  });

  it("resolves ../../ relative links from the concept directory (as written, even if broken)", () => {
    // Real replication-paper.md links `[venue](../../seet-2027)` (resolves) and
    // `[criterion definitions](../../evaluation-criteria)` (the producer emitted
    // one `../` too many — it resolves to a non-existent path, tolerated per §11).
    const body = "[venue](../../seet-2027) and [criteria](../../evaluation-criteria)";
    expect(
      extractConceptLinks("icse/seet-2027/categories/replication-paper.md", body),
    ).toEqual(["icse/evaluation-criteria.md", "icse/seet-2027.md"]);
  });

  it("ignores URLs, anchors and mailto", () => {
    const body = "[site](https://example.com) [a](#x) [m](mailto:a@b.c)";
    expect(extractConceptLinks("a.md", body)).toEqual([]);
  });

  it("returns [] for reserved files", () => {
    expect(extractConceptLinks("index.md", "* [x](y.md)")).toEqual([]);
  });
});

describe("resolveInBundlePath", () => {
  it("resolves an in-bundle relative source", () => {
    expect(resolveInBundlePath("computations/revenue-ytd.md", "policies/rev.md")).toBe(
      "computations/policies/rev.md",
    );
    expect(resolveInBundlePath("computations/revenue-ytd.md", "../policies/rev.md")).toBe(
      "policies/rev.md",
    );
  });
  it("returns null for a URL or a scope descriptor that escapes root", () => {
    expect(resolveInBundlePath("a/b.md", "https://x.test/y")).toBeNull();
    expect(resolveInBundlePath("a/b.md", "../../escape")).toBeNull();
  });
});
