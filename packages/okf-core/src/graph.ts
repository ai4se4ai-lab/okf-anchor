/**
 * Derived knowledge graph (CLAUDE.md §2): RDF triples for SPARQL, reproducible
 * from the canonical representation and never authoritative. Provenance is
 * modelled with PROV-O; the bundle is a DCAT dataset; concepts are SKOS
 * concepts; a small `okf:` vocabulary carries the OKF-specific literals.
 *
 * `graphHash` is the SHA-256 of the RDFC-1.0 (`rdf-canonize`) canonical N-Quads,
 * so the same canonical input yields the same hash on every machine
 * (skill: okf-knowledge-graph).
 */
import { DataFactory, type Quad } from "n3";
import rdfCanonize from "rdf-canonize";
import type { LoadedBundle } from "./bundle.js";
import { parseConcept } from "./document.js";
import { OkfError } from "./errors.js";
import { extractConceptLinks, resolveInBundlePath } from "./links.js";
import {
  isAttested,
  normalizeSources,
  normalizeVerified,
  status,
  trustTier,
} from "./frontmatter.js";
import { sha256Hex } from "./hash.js";
import { conceptIdFromPath } from "./paths.js";

const { namedNode, literal, blankNode, quad, defaultGraph } = DataFactory;

export const NS = {
  okf: "https://okf.dev/ns#",
  prov: "http://www.w3.org/ns/prov#",
  dcat: "http://www.w3.org/ns/dcat#",
  skos: "http://www.w3.org/2004/02/skos/core#",
  rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
  rdfs: "http://www.w3.org/2000/01/rdf-schema#",
} as const;

const RDF_TYPE = namedNode(NS.rdf + "type");
const DECODER = new TextDecoder("utf-8", { fatal: false });

const BUNDLE_IRI = "urn:okf:bundle";

function conceptIri(conceptId: string): string {
  return `urn:okf:concept:${encodeURIComponent(conceptId)}`;
}
function fileIri(path: string): string {
  return `urn:okf:file:${encodeURIComponent(path)}`;
}
function actorIri(actor: string): string {
  return `urn:okf:actor:${encodeURIComponent(actor)}`;
}
function sourceIri(resource: string): string {
  return `urn:okf:source:${sha256Hex(resource)}`;
}

export interface DerivedGraph {
  readonly quads: Quad[];
  /** RDFC-1.0 canonical N-Quads. */
  readonly nquads: string;
  readonly graphHash: string;
}

interface Ctx {
  quads: Quad[];
  actorsSeen: Set<string>;
  sourcesSeen: Set<string>;
}

function addActor(ctx: Ctx, actor: string): string {
  const iri = actorIri(actor);
  if (!ctx.actorsSeen.has(actor)) {
    ctx.actorsSeen.add(actor);
    ctx.quads.push(quad(namedNode(iri), RDF_TYPE, namedNode(NS.prov + "Agent"), defaultGraph()));
    ctx.quads.push(quad(namedNode(iri), namedNode(NS.okf + "actor"), literal(actor), defaultGraph()));
    if (actor.startsWith("human:")) {
      ctx.quads.push(
        quad(namedNode(iri), RDF_TYPE, namedNode(NS.prov + "Person"), defaultGraph()),
      );
    }
  }
  return iri;
}

/** Resolve a link/source target to an existing node IRI, or null if not in the bundle. */
function resolveTargetIri(bundle: LoadedBundle, target: string): string | null {
  if (bundle.has(target)) {
    return /\.md$/i.test(target) ? conceptIri(conceptIdFromPath(target)) : fileIri(target);
  }
  const asIndex = target.replace(/\.md$/i, "") + "/index.md";
  if (bundle.has(asIndex)) return fileIri(asIndex);
  return null;
}

export async function deriveGraph(bundle: LoadedBundle, canonicalHash: string): Promise<DerivedGraph> {
  const ctx: Ctx = { quads: [], actorsSeen: new Set(), sourcesSeen: new Set() };
  const b = namedNode(BUNDLE_IRI);

  ctx.quads.push(quad(b, RDF_TYPE, namedNode(NS.dcat + "Dataset"), defaultGraph()));
  ctx.quads.push(quad(b, RDF_TYPE, namedNode(NS.okf + "KnowledgeBundle"), defaultGraph()));
  ctx.quads.push(quad(b, namedNode(NS.okf + "okfVersion"), literal("0.2"), defaultGraph()));
  ctx.quads.push(quad(b, namedNode(NS.okf + "derivedFrom"), literal(canonicalHash), defaultGraph()));

  // Payload (non-markdown) files as first-class nodes so sources can point at them.
  for (const file of bundle.files) {
    if (file.markdown && !file.reserved) continue;
    if (file.reserved) continue;
    const f = namedNode(fileIri(file.path));
    ctx.quads.push(quad(f, RDF_TYPE, namedNode(NS.okf + "File"), defaultGraph()));
    ctx.quads.push(quad(f, namedNode(NS.okf + "path"), literal(file.path), defaultGraph()));
    ctx.quads.push(quad(b, namedNode(NS.okf + "contains"), f, defaultGraph()));
  }

  const conceptTypes = new Map<string, string>();
  const parsed = new Map<
    string,
    { conceptId: string; frontmatter: Record<string, unknown>; body: string }
  >();

  for (const file of bundle.concepts()) {
    const text = DECODER.decode(file.content);
    let doc;
    try {
      doc = parseConcept(text);
    } catch {
      continue; // malformed concepts are a validation error, not a graph input
    }
    const conceptId = conceptIdFromPath(file.path);
    parsed.set(file.path, { conceptId, frontmatter: doc.frontmatter, body: doc.body });
    if (typeof doc.frontmatter["type"] === "string") {
      conceptTypes.set(conceptId, doc.frontmatter["type"]);
    }
  }

  for (const file of bundle.concepts()) {
    const entry = parsed.get(file.path);
    if (!entry) continue;
    const { conceptId, frontmatter: fm, body } = entry;
    const c = namedNode(conceptIri(conceptId));

    ctx.quads.push(quad(c, RDF_TYPE, namedNode(NS.skos + "Concept"), defaultGraph()));
    ctx.quads.push(quad(c, namedNode(NS.okf + "conceptId"), literal(conceptId), defaultGraph()));
    ctx.quads.push(quad(c, namedNode(NS.okf + "path"), literal(file.path), defaultGraph()));
    ctx.quads.push(quad(b, namedNode(NS.okf + "contains"), c, defaultGraph()));

    if (typeof fm["type"] === "string") {
      ctx.quads.push(quad(c, namedNode(NS.okf + "type"), literal(fm["type"]), defaultGraph()));
    }
    if (typeof fm["title"] === "string") {
      ctx.quads.push(
        quad(c, namedNode(NS.skos + "prefLabel"), literal(fm["title"]), defaultGraph()),
      );
    }
    if (typeof fm["description"] === "string") {
      ctx.quads.push(
        quad(c, namedNode(NS.okf + "description"), literal(fm["description"]), defaultGraph()),
      );
    }
    for (const tag of Array.isArray(fm["tags"]) ? fm["tags"] : []) {
      if (typeof tag === "string") {
        ctx.quads.push(quad(c, namedNode(NS.okf + "tag"), literal(tag), defaultGraph()));
      }
    }
    ctx.quads.push(
      quad(c, namedNode(NS.okf + "trustTier"), literal(trustTier(fm)), defaultGraph()),
    );
    ctx.quads.push(quad(c, namedNode(NS.okf + "status"), literal(status(fm)), defaultGraph()));
    if (typeof fm["stale_after"] === "string") {
      ctx.quads.push(
        quad(c, namedNode(NS.okf + "staleAfter"), literal(fm["stale_after"]), defaultGraph()),
      );
    }
    if (isAttested(fm)) {
      ctx.quads.push(
        quad(c, namedNode(NS.okf + "attested"), literal("true"), defaultGraph()),
      );
    }
    if (typeof fm["runtime"] === "string") {
      ctx.quads.push(
        quad(c, namedNode(NS.okf + "runtime"), literal(fm["runtime"]), defaultGraph()),
      );
    }

    // generated.by / generated.at
    const generated = fm["generated"];
    if (generated && typeof generated === "object" && !Array.isArray(generated)) {
      const by = (generated as Record<string, unknown>)["by"];
      const at = (generated as Record<string, unknown>)["at"];
      if (typeof by === "string" && by) {
        ctx.quads.push(
          quad(c, namedNode(NS.prov + "wasAttributedTo"), namedNode(addActor(ctx, by)), defaultGraph()),
        );
      }
      if (typeof at === "string" && at) {
        ctx.quads.push(
          quad(c, namedNode(NS.okf + "generatedAt"), literal(at), defaultGraph()),
        );
      }
    }

    // verified[] as PROV activities so `at` survives
    for (const ev of normalizeVerified(fm)) {
      const v = blankNode();
      ctx.quads.push(quad(v, RDF_TYPE, namedNode(NS.prov + "Activity"), defaultGraph()));
      ctx.quads.push(
        quad(v, namedNode(NS.prov + "wasAssociatedWith"), namedNode(addActor(ctx, ev.by)), defaultGraph()),
      );
      if (ev.at) {
        ctx.quads.push(quad(v, namedNode(NS.okf + "verifiedAt"), literal(ev.at), defaultGraph()));
      }
      ctx.quads.push(quad(c, namedNode(NS.okf + "verification"), v, defaultGraph()));
      ctx.quads.push(
        quad(c, namedNode(NS.okf + "verifiedBy"), namedNode(addActor(ctx, ev.by)), defaultGraph()),
      );
    }

    // sources → prov:wasDerivedFrom
    for (const src of normalizeSources(fm)) {
      const inBundle = resolveInBundlePath(file.path, src.resource);
      let targetIri: string | null = null;
      if (inBundle) targetIri = resolveTargetIri(bundle, inBundle);
      if (targetIri) {
        ctx.quads.push(
          quad(c, namedNode(NS.prov + "wasDerivedFrom"), namedNode(targetIri), defaultGraph()),
        );
      } else {
        const s = sourceIri(src.resource);
        if (!ctx.sourcesSeen.has(s)) {
          ctx.sourcesSeen.add(s);
          ctx.quads.push(quad(namedNode(s), RDF_TYPE, namedNode(NS.prov + "Entity"), defaultGraph()));
          ctx.quads.push(
            quad(namedNode(s), namedNode(NS.okf + "resource"), literal(src.resource), defaultGraph()),
          );
          if (src.title) {
            ctx.quads.push(
              quad(namedNode(s), namedNode(NS.rdfs + "label"), literal(src.title), defaultGraph()),
            );
          }
          if (src.author) {
            ctx.quads.push(
              quad(
                namedNode(s),
                namedNode(NS.prov + "wasAttributedTo"),
                namedNode(addActor(ctx, src.author)),
                defaultGraph(),
              ),
            );
          }
        }
        ctx.quads.push(
          quad(c, namedNode(NS.prov + "wasDerivedFrom"), namedNode(s), defaultGraph()),
        );
      }
    }

    // links → okf:linksTo (+ okf:usesComputation when the target is an Attested Computation)
    for (const target of extractConceptLinks(file.path, body)) {
      const targetId = conceptIdFromPath(target);
      const targetIri = conceptIri(targetId);
      ctx.quads.push(quad(c, namedNode(NS.okf + "linksTo"), namedNode(targetIri), defaultGraph()));
      if (conceptTypes.get(targetId) === "Attested Computation") {
        ctx.quads.push(
          quad(c, namedNode(NS.okf + "usesComputation"), namedNode(targetIri), defaultGraph()),
        );
      }
    }
  }

  let nquads: string;
  try {
    nquads = await rdfCanonize.canonize(ctx.quads, { algorithm: "RDFC-1.0" });
  } catch (err) {
    throw new OkfError("OKF_GRAPH_DERIVATION_FAILED", `RDF canonicalization failed: ${(err as Error).message}`);
  }

  return { quads: ctx.quads, nquads, graphHash: sha256Hex(nquads) };
}
