import { describe, expect, it } from "vitest";
import { looksLikeIpfsCid, relativeTime, truncateHex } from "./format";

describe("truncateHex", () => {
  it("shortens a long hex value to lead…tail", () => {
    expect(truncateHex("0x1234567890abcdef1234567890abcdef12345678")).toBe("0x123456…345678");
  });

  it("leaves a short value untouched", () => {
    expect(truncateHex("0xabc")).toBe("0xabc");
  });
});

describe("relativeTime", () => {
  const now = 1_700_000_000_000;

  it("reports 'just now' for very recent timestamps", () => {
    expect(relativeTime(1_700_000_000 - 2, now)).toBe("just now");
  });

  it("reports seconds, then minutes, then hours as the gap grows", () => {
    expect(relativeTime(1_700_000_000 - 30, now)).toBe("30s ago");
    expect(relativeTime(1_700_000_000 - 120, now)).toBe("2m ago");
    expect(relativeTime(1_700_000_000 - 7200, now)).toBe("2h ago");
  });
});

describe("looksLikeIpfsCid", () => {
  it("accepts a CIDv0 (Qm...) and CIDv1 (bafy...) shape", () => {
    expect(looksLikeIpfsCid("QmSnuWmxptJZdLJpKRarxBMS2Ju2oANVrgbr2xWbie9b2D")).toBe(true);
    expect(looksLikeIpfsCid("bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi")).toBe(true);
  });

  it("rejects the local offline storage provider's CID format", () => {
    expect(looksLikeIpfsCid("okf1:" + "a".repeat(64))).toBe(false);
  });
});
