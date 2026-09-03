/**
 * Minimal ambient types for `rdf-canonize` (the package ships JS only). We use a
 * single call: canonize an array of RDF/JS quads with the RDFC-1.0 algorithm and
 * get canonical N-Quads back.
 */
declare module "rdf-canonize" {
  import type { Quad } from "n3";

  interface CanonizeOptions {
    algorithm: "RDFC-1.0" | "URDNA2015" | "RDFC-1.0-sha384";
    inputFormat?: "application/n-quads";
    format?: "application/n-quads";
  }

  const rdfCanonize: {
    canonize(input: Quad[] | string, options: CanonizeOptions): Promise<string>;
  };

  export default rdfCanonize;
}
