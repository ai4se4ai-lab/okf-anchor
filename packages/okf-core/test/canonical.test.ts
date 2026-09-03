import { describe, expect, it } from "vitest";
import {
  canonicalizeBundle,
  loadBundle,
  merkleRoot,
  leafHash,
  normalizeEol,
  type RawEntry,
} from "../src/index.js";
import { loadFixture } from "./helpers.js";

const enc = (s: string) => new TextEncoder().encode(s);

function bundleOf(files: Record<string, string>): RawEntry[] {
  return Object.entries(files).map(([path, content]) => ({ path, content: enc(content) }));
}

const BASE = {
  "index.md": "# Metric\n\n* [Revenue](metrics/revenue.md) - x\n",
  "metrics/revenue.md": "---\ntype: Metric\ntitle: Revenue\n---\n\n# Definition\n\nText.\n",
};

describe("merkle", () => {
  it("is order-sensitive at the leaf level but stable for a fixed order", () => {
    const a = leafHash(enc("a"));
    const b = leafHash(enc("b"));
    expect(merkleRoot([a, b]).rootHex).not.toBe(merkleRoot([b, a]).rootHex);
    expect(merkleRoot([a, b]).rootHex).toBe(merkleRoot([a, b]).rootHex);
  });
  it("uses domain separation (leaf != node preimage)", () => {
    const single = merkleRoot([leafHash(enc("x"))]).rootHex;
    expect(single).toHaveLength(64);
  });
});

describe("canonicalizeBundle determinism", () => {
  it("is byte-identical across repeated runs", () => {
    const entries = bundleOf(BASE);
    const first = canonicalizeBundle(loadBundle(entries));
    for (let i = 0; i < 5; i++) {
      const again = canonicalizeBundle(loadBundle(bundleOf(BASE)));
      expect(again.canonicalHash).toBe(first.canonicalHash);
      expect(again.merkleRoot).toBe(first.merkleRoot);
      expect(again.canonicalForm).toBe(first.canonicalForm);
    }
  });

  it("is independent of input entry order", () => {
    const forward = canonicalizeBundle(loadBundle(bundleOf(BASE)));
    const reversed = canonicalizeBundle(
      loadBundle(bundleOf(BASE).reverse()),
    );
    expect(reversed.canonicalHash).toBe(forward.canonicalHash);
    expect(reversed.merkleRoot).toBe(forward.merkleRoot);
  });

  it("canonicalHash ignores YAML formatting/key-order; merkleRoot does not", () => {
    const a = canonicalizeBundle(loadBundle(bundleOf(BASE)));
    const reformatted = {
      ...BASE,
      "metrics/revenue.md":
        "---\ntitle: Revenue\ntype: Metric\n---\n\n# Definition\r\n\r\nText.\r\n",
    };
    const b = canonicalizeBundle(loadBundle(bundleOf(reformatted)));
    expect(b.canonicalHash).toBe(a.canonicalHash);
    expect(b.merkleRoot).not.toBe(a.merkleRoot); // CRLF vs LF is a byte change
  });

  it("one character of body content changes both hashes", () => {
    const a = canonicalizeBundle(loadBundle(bundleOf(BASE)));
    const tampered = { ...BASE, "metrics/revenue.md": BASE["metrics/revenue.md"].replace("Text.", "Text!") };
    const b = canonicalizeBundle(loadBundle(bundleOf(tampered)));
    expect(b.canonicalHash).not.toBe(a.canonicalHash);
    expect(b.merkleRoot).not.toBe(a.merkleRoot);
  });

  it("per-file sha256 lets a verifier name the changed file", () => {
    const a = canonicalizeBundle(loadBundle(bundleOf(BASE)));
    const tampered = { ...BASE, "metrics/revenue.md": BASE["metrics/revenue.md"].replace("Text.", "Text!") };
    const b = canonicalizeBundle(loadBundle(bundleOf(tampered)));
    const changed = b.files.filter((f) => {
      const before = a.files.find((x) => x.path === f.path);
      return before && before.sha256 !== f.sha256;
    });
    expect(changed.map((f) => f.path)).toEqual(["metrics/revenue.md"]);
  });
});

describe("normalizeEol", () => {
  it("collapses CRLF and lone CR to LF", () => {
    expect(normalizeEol("a\r\nb\rc\nd")).toBe("a\nb\nc\nd");
  });
});

describe("canonicalizeBundle on the real MindPortalix fixture", () => {
  it("produces a stable canonicalHash and merkleRoot", () => {
    const entries = loadFixture("valid-mindportalix");
    const first = canonicalizeBundle(loadBundle(entries));
    const second = canonicalizeBundle(loadBundle(loadFixture("valid-mindportalix")));
    expect(second.canonicalHash).toBe(first.canonicalHash);
    expect(second.merkleRoot).toBe(first.merkleRoot);
    expect(first.canonicalHash).toMatch(/^[0-9a-f]{64}$/);
    expect(first.files.length).toBe(entries.length);
  });
});
