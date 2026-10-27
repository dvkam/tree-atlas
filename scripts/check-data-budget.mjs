import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
async function bytesIn(directory) {
  let total = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    total += entry.isDirectory() ? await bytesIn(path) : (await stat(path)).size;
  }
  return total;
}
const bytes = await bytesIn("public");
// Pages permits a 1 GB published site. Leave 5 MB for the application build.
if (bytes > 995_000_000)
  throw new Error(
    `Public data uses ${bytes} bytes and exceeds the GitHub Pages budget. Move data hosting before adding this release; do not delete published snapshots.`,
  );
console.log(`Public assets: ${(bytes / 1_000_000).toFixed(1)} MB of the 995 MB data budget.`);
