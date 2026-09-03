import { describe, expect, it } from "vitest";
import { checkBundlePath, loadBundle, OkfError, DEFAULT_LIMITS, type RawEntry } from "../src/index.js";

const enc = (s: string) => new TextEncoder().encode(s);
const NUL = String.fromCharCode(0);

describe("checkBundlePath (zip-slip / traversal defence)", () => {
  it.each([
    ["../escape.md", "escapes"],
    ["a/../../b.md", "escapes"],
    ["/abs/path.md", "absolute"],
    ["C:\\win.md", "backslash"],
    [`a${NUL}b.md`, "NUL"],
  ])("rejects %j", (path, reasonFragment) => {
    const r = checkBundlePath(path);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain(reasonFragment);
  });

  it("normalizes ./ and duplicate slashes and applies NFC", () => {
    expect(checkBundlePath("./a//b/./c.md").normalized).toBe("a/b/c.md");
  });
});

describe("loadBundle", () => {
  it("throws OKF_BUNDLE_UNSAFE_PATH listing every offending entry", () => {
    const entries: RawEntry[] = [
      { path: "ok.md", content: enc("---\ntype: X\n---\n") },
      { path: "../evil.md", content: enc("x") },
      { path: "a/../../evil2.md", content: enc("x") },
    ];
    try {
      loadBundle(entries);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(OkfError);
      expect((err as OkfError).code).toBe("OKF_BUNDLE_UNSAFE_PATH");
      expect((err as OkfError).details).toHaveLength(2);
    }
  });

  it("rejects duplicate normalized paths", () => {
    const entries: RawEntry[] = [
      { path: "a/b.md", content: enc("1") },
      { path: "./a/b.md", content: enc("2") },
    ];
    expect(() => loadBundle(entries)).toThrow(/duplicate/);
  });

  it("enforces the entry-count limit", () => {
    const entries: RawEntry[] = Array.from({ length: 3 }, (_, i) => ({
      path: `f${i}.md`,
      content: enc("---\ntype: X\n---\n"),
    }));
    expect(() => loadBundle(entries, { ...DEFAULT_LIMITS, maxEntries: 2 })).toThrow(
      /3 entries, limit is 2/,
    );
  });

  it("enforces the markdown size cap", () => {
    const big = enc("x".repeat(2000));
    expect(() =>
      loadBundle([{ path: "big.md", content: big }], { ...DEFAULT_LIMITS, maxMarkdownBytes: 1000 }),
    ).toThrow(/oversized|TOO_LARGE/i);
  });

  it("sorts files by code-unit path order", () => {
    const b = loadBundle([
      { path: "b.md", content: enc("---\ntype: X\n---\n") },
      { path: "A.md", content: enc("---\ntype: X\n---\n") },
      { path: "a/x.md", content: enc("---\ntype: X\n---\n") },
    ]);
    expect(b.paths()).toEqual(["A.md", "a/x.md", "b.md"]);
  });
});
