import { describe, expect, it } from "vitest";
import { canonicalize } from "../src/index.js";

describe("JCS canonicalize (RFC 8785 subset)", () => {
  it("sorts object keys by code unit", () => {
    expect(canonicalize({ b: 1, a: 2, A: 3 })).toBe('{"A":3,"a":2,"b":1}');
  });
  it("preserves array order", () => {
    expect(canonicalize([3, 1, 2])).toBe("[3,1,2]");
  });
  it("escapes control characters and quotes", () => {
    expect(canonicalize("a\tb\"c\\")).toBe('"a\\tb\\"c\\\\"');
  });
  it("drops undefined object members", () => {
    expect(canonicalize({ a: 1, b: undefined })).toBe('{"a":1}');
  });
  it("rejects non-finite numbers", () => {
    expect(() => canonicalize(Number.NaN)).toThrow();
    expect(() => canonicalize(Number.POSITIVE_INFINITY)).toThrow();
  });
  it("is stable regardless of insertion order", () => {
    const a = canonicalize({ x: [{ q: 1, p: 2 }], m: "k" });
    const b = canonicalize({ m: "k", x: [{ p: 2, q: 1 }] });
    expect(a).toBe(b);
  });
});
