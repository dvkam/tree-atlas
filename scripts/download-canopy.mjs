import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { resolve, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { importCanopy } from "./canopy.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const product = "CLMS_UA_STL_S2021_V005ha_AT001L3_WIEN_03035_V01_R02_20251121";
const sourcePage = "https://land.copernicus.eu/en/products/urban-atlas/street-tree-layer-stl-2021";
const [mode, file, extra] = process.argv.slice(2);

if (mode !== "--file" || file === undefined || extra !== undefined) {
  throw new Error(
    "Usage: node scripts/download-canopy.mjs --file /path/to/CLMS_UA_STL_S2021_V005ha_AT001L3_WIEN_03035_V01_R02_20251121.fgb\nDownload and extract the official Vienna file after signing in at " +
      sourcePage +
      ". The public WMS overlay works without this optional import.",
  );
}
if (!basename(file).startsWith(product) || !file.endsWith(".fgb")) {
  throw new Error(
    "Select the extracted official Vienna STL2021 FlatGeobuf file; ZIP archives and other products are not accepted.",
  );
}
const imported = await importCanopy(await readFile(resolve(file)));
const output = resolve(root, "data/raw/copernicus-vienna.geojson");
await mkdir(dirname(output), { recursive: true });
const candidate = output + ".pending";
await writeFile(
  candidate,
  JSON.stringify({
    ...imported,
    metadata: {
      ...imported.metadata,
      importedAt: new Date().toISOString(),
      sourcePage,
      sourceFile: basename(file),
      product,
      sourceAuthenticity:
        "local operator supplied; checksum recorded, not authenticated against CDSE",
      attribution:
        "Generated using European Union's Copernicus Land Monitoring Service information; https://doi.org/10.2909/ed0018c3-5ad0-4721-b5e4-0042aeaf9d00",
      licence: "https://land.copernicus.eu/en/data-policy",
    },
  }) + "\n",
);
await rename(candidate, output);
console.info(
  `Imported ${imported.features.length} canopy polygons to data/raw/copernicus-vienna.geojson. This candidate is not automatically published or used by the app.`,
);
