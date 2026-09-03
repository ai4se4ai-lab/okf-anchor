import { describe, expect, it } from "vitest";
import {
  conformanceIssue,
  parseConcept,
  serializeConcept,
  OkfDocumentError,
} from "../src/index.js";

const REAL = `---
type: SubmissionCategory
title: ICSE SEET 2027 — Replication Paper
description: "Replication paper category for ICSE SEET 2027: definition, page limit, and evaluation criteria."
tags:
  - icse
  - seet
  - replication-paper
sources:
  - files/icse-seet.txt
generated:
  by: dsh/unversioned
  at: 2026-09-03T18:31:12.862Z
---

# Replication Paper (ICSE SEET 2027)

Body text.
`;

describe("parseConcept", () => {
  it("parses a real MindPortalix concept, keeping timestamps as strings", () => {
    const { frontmatter, body } = parseConcept(REAL);
    expect(frontmatter["type"]).toBe("SubmissionCategory");
    expect(frontmatter["sources"]).toEqual(["files/icse-seet.txt"]);
    const generated = frontmatter["generated"] as Record<string, unknown>;
    expect(generated["by"]).toBe("dsh/unversioned");
    expect(generated["at"]).toBe("2026-09-03T18:31:12.862Z");
    expect(typeof generated["at"]).toBe("string");
    expect(body.startsWith("# Replication Paper")).toBe(true);
  });

  it("treats a file with no frontmatter as all body (index.md)", () => {
    const { frontmatter, body } = parseConcept("# Venue\n\n* [x](y.md)\n");
    expect(frontmatter).toEqual({});
    expect(body).toBe("# Venue\n\n* [x](y.md)\n");
  });

  it("throws on an unterminated frontmatter block", () => {
    expect(() => parseConcept("---\ntype: X\n\nbody")).toThrow(OkfDocumentError);
  });

  it("round-trips frontmatter key order", () => {
    const text = serializeConcept(parseConcept(REAL));
    const keysOrder = text
      .split("\n")
      .slice(1)
      .filter((l) => /^[a-z_]+:/.test(l))
      .map((l) => l.split(":")[0]);
    expect(keysOrder).toEqual(["type", "title", "description", "tags", "sources", "generated"]);
  });
});

describe("conformanceIssue", () => {
  it("passes a concept carrying only type", () => {
    expect(conformanceIssue({ type: "Anything" })).toBeNull();
  });
  it("fails a concept with no type", () => {
    expect(conformanceIssue({ title: "x" })).toMatch(/type/);
  });
  it("fails a non-string type", () => {
    expect(conformanceIssue({ type: 3 })).toMatch(/string/);
  });
});
