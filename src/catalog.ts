import { manifestSchema, releaseSchema, datasetSchema, contains } from "./domain.ts";
import type { Bounds, Dataset, Manifest, Release, Tree } from "./domain.ts";

export async function loadDataset(
  base: string,
  id: string,
  release: string,
  signal?: AbortSignal,
): Promise<Dataset> {
  if (!/^[a-zA-Z0-9-]+$/u.test(release)) throw new Error("Invalid release link");
  const response = await fetch(
    new URL(`releases/${release}/dataset.json`, base),
    signal ? { signal } : {},
  );
  if (!response.ok)
    throw new Error("This saved release is unavailable. Open the latest catalogue to continue.");
  const dataset = datasetSchema.parse(await response.json());
  if (dataset.id !== id || dataset.release !== release)
    throw new Error("Saved release identity mismatch");
  return dataset;
}

export async function loadManifest(base: string, signal?: AbortSignal): Promise<Manifest> {
  const response = await fetch(new URL("manifest.json", base), signal ? { signal } : {});
  if (!response.ok) throw new Error(`Catalogue unavailable (${response.status}). Try again.`);
  return manifestSchema.parse(await response.json());
}

export async function loadRelease(
  base: string,
  dataset: Dataset,
  signal?: AbortSignal,
): Promise<Release> {
  const response = await fetch(new URL(dataset.file, base), signal ? { signal } : {});
  if (!response.ok)
    throw new Error(
      `This release is unavailable (${response.status}). Reload the catalogue or try again.`,
    );
  const bytes = await response.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hash = Array.from(new Uint8Array(digest), (v) => v.toString(16).padStart(2, "0")).join("");
  if (hash !== dataset.sha256)
    throw new Error("The downloaded release failed its integrity check. Try again.");
  const release = releaseSchema.parse(JSON.parse(new TextDecoder().decode(bytes)));
  if (
    release.dataset !== dataset.id ||
    release.release !== dataset.release ||
    release.trees.length !== dataset.count
  )
    throw new Error("The release does not match the catalogue.");
  const ids = new Set<string>();
  for (const tree of release.trees) {
    if (
      tree.dataset !== dataset.id ||
      (tree.position !== null && !contains(dataset.bounds, tree.position)) ||
      ids.has(tree.sourceId)
    )
      throw new Error("The release contains invalid or duplicate records.");
    ids.add(tree.sourceId);
  }
  return release;
}

export function normalizeText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase()
    .trim();
}

export function searchInventory(
  release: Release,
  area: Bounds | null,
  text: string,
): readonly Tree[] {
  const term = normalizeText(text);
  return release.trees.filter(
    (tree) =>
      (area === null || (tree.position !== null && contains(area, tree.position))) &&
      (term === "" ||
        [tree.scientificName, tree.commonName, tree.location, tree.tag, tree.sourceId].some(
          (field) => field !== null && normalizeText(field).includes(term),
        )),
  );
}
