// The Prisma client is generated JS/D.TS (tsc does not process it), so copy it
// next to the compiled entrypoint that imports it.
import { cpSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const src = fileURLToPath(new URL("../src/generated", import.meta.url));
const dst = fileURLToPath(new URL("../dist/generated", import.meta.url));

if (!existsSync(src)) {
  console.error("prisma client not generated; run `pnpm --filter @okf-anchor/db generate`");
  process.exit(1);
}
cpSync(src, dst, { recursive: true });
