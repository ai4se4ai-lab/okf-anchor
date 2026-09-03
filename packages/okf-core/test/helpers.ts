import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { RawEntry } from "../src/index.js";

export const FIXTURES_DIR = fileURLToPath(new URL("../../../tests/fixtures/", import.meta.url));

/** Walk a fixture directory into the `{ path, content }` entries `loadBundle` expects. */
export function loadFixture(name: string): RawEntry[] {
  const root = join(FIXTURES_DIR, name);
  const entries: RawEntry[] = [];
  const walk = (dir: string): void => {
    for (const dirent of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, dirent.name);
      if (dirent.isDirectory()) {
        walk(abs);
      } else if (dirent.isFile()) {
        const rel = relative(root, abs).split(sep).join("/");
        entries.push({ path: rel, content: new Uint8Array(readFileSync(abs)) });
      }
    }
  };
  walk(root);
  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return entries;
}

export function fixtureExists(name: string): boolean {
  try {
    return statSync(join(FIXTURES_DIR, name)).isDirectory();
  } catch {
    return false;
  }
}
