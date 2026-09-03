/**
 * OKF v0.2 conformance (§11) — deliberately permissive. A bundle is conformant
 * if every non-reserved `.md` file has a parseable YAML frontmatter mapping with
 * a non-empty string `type`. Consumers MUST NOT reject for unknown fields,
 * unknown `type` values, broken links, or missing `index.md` (§11), so this
 * function reports those as `info`, never as errors.
 */
import type { LoadedBundle } from "./bundle.js";
import { conformanceIssue, parseConcept } from "./document.js";
import { OkfDocumentError } from "./errors.js";
import { extractConceptLinks } from "./links.js";
import { trustTier, isAttested } from "./frontmatter.js";
import { conceptIdFromPath } from "./paths.js";

export interface ValidationFinding {
  readonly path: string;
  readonly code: string;
  readonly message: string;
}

export interface ConceptSummary {
  readonly path: string;
  readonly conceptId: string;
  readonly type: string | null;
  readonly title: string | null;
  readonly trustTier: string;
  readonly attested: boolean;
  readonly links: string[];
}

export interface ValidationResult {
  readonly conformant: boolean;
  readonly okfVersion: string;
  readonly errors: ValidationFinding[];
  /** Non-blocking observations: broken links, missing index files, etc. */
  readonly info: ValidationFinding[];
  readonly concepts: ConceptSummary[];
  readonly stats: {
    readonly fileCount: number;
    readonly conceptCount: number;
    readonly payloadFileCount: number;
    readonly brokenLinkCount: number;
  };
}

const DECODER = new TextDecoder("utf-8", { fatal: false });

export function validateBundle(bundle: LoadedBundle): ValidationResult {
  const errors: ValidationFinding[] = [];
  const info: ValidationFinding[] = [];
  const concepts: ConceptSummary[] = [];

  const conceptIdSet = new Set(bundle.concepts().map((f) => conceptIdFromPath(f.path)));
  const filePathSet = new Set(bundle.paths());
  let brokenLinkCount = 0;

  for (const file of bundle.concepts()) {
    const text = DECODER.decode(file.content);
    let parsed;
    try {
      parsed = parseConcept(text);
    } catch (err) {
      const message = err instanceof OkfDocumentError ? err.message : "unparseable concept document";
      errors.push({ path: file.path, code: "OKF-VAL-001", message });
      continue;
    }

    const issue = conformanceIssue(parsed.frontmatter);
    if (issue) {
      errors.push({ path: file.path, code: "OKF-VAL-002", message: issue });
      continue;
    }

    const links = extractConceptLinks(file.path, parsed.body);
    for (const target of links) {
      const targetId = conceptIdFromPath(target);
      if (!filePathSet.has(target) && !conceptIdSet.has(targetId)) {
        brokenLinkCount++;
        info.push({
          path: file.path,
          code: "OKF-INFO-001",
          message: `link target not in bundle: ${target}`,
        });
      }
    }

    const fm = parsed.frontmatter;
    concepts.push({
      path: file.path,
      conceptId: conceptIdFromPath(file.path),
      type: typeof fm["type"] === "string" ? fm["type"] : null,
      title: typeof fm["title"] === "string" ? fm["title"] : null,
      trustTier: trustTier(fm),
      attested: isAttested(fm),
      links,
    });
  }

  if (!bundle.has("index.md")) {
    info.push({ path: "index.md", code: "OKF-INFO-002", message: "no bundle-root index.md" });
  }

  const payloadFileCount = bundle.files.filter((f) => !f.markdown).length;

  return {
    conformant: errors.length === 0,
    okfVersion: "0.2",
    errors,
    info,
    concepts,
    stats: {
      fileCount: bundle.files.length,
      conceptCount: concepts.length,
      payloadFileCount,
      brokenLinkCount,
    },
  };
}
