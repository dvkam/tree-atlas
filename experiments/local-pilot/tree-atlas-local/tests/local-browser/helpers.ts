import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { expect } from "@playwright/test";
import type { BrowserContext, Page } from "@playwright/test";

const bounds = z.tuple([z.number(), z.number(), z.number(), z.number()]);
const dataset = z.object({
  id: z.string(),
  city: z.string(),
  release: z.string(),
  count: z.number(),
});
const query = z.object({
  name: z.string(),
  q: z.string(),
  area: bounds.nullable(),
  total: z.number(),
  pages: z.array(
    z.object({ kind: z.string(), offset: z.number(), limit: z.number(), ids: z.array(z.string()) }),
  ),
});
const referenceDataset = z.object({
  dataset: z.string(),
  release: z.string(),
  contentSha256: z.string(),
  queries: z.array(query),
});
const frozen = resolve(process.cwd(), "../tree-atlas-contract-v1");
export const datasets = z
  .object({ datasets: z.array(dataset) })
  .parse(JSON.parse(readFileSync(resolve(frozen, "baseline.lock.json"), "utf8"))).datasets;
export const references = z
  .object({ datasets: z.array(referenceDataset) })
  .parse(
    JSON.parse(readFileSync(resolve(frozen, "reference/reference-results.json"), "utf8")),
  ).datasets;
export function city(id: string) {
  const result = datasets.find((item) => item.id === id);
  if (result === undefined) throw new Error(`Missing frozen city: ${id}`);
  return result;
}
export function reference(id: string, name: string) {
  const result = references
    .find((item) => item.dataset === id)
    ?.queries.find((item) => item.name === name);
  if (result === undefined) throw new Error(`Missing frozen query: ${id}/${name}`);
  return result;
}
export async function blockExternalTiles(context: BrowserContext) {
  await context.route("https://tile.openstreetmap.org/**", (route) => route.abort());
  await context.route("https://mapserver.dataspace.copernicus.eu/**", (route) => route.abort());
}
export async function ready(page: Page, id: string, count = city(id).count) {
  await expect(page.getByRole("region", { name: "Tree map", exact: true })).toHaveAttribute(
    "data-city",
    id,
  );
  await expect
    .poll(async () =>
      Number((await page.locator(".results-heading h2").innerText()).replace(/\D/gu, "")),
    )
    .toBe(count);
  await expect(page.getByRole("list", { name: "Tree records" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Tree map", exact: true })).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await expect(page.getByRole("region", { name: "Tree map", exact: true })).toHaveAttribute(
    "data-filter-ready",
    "true",
  );
  await expect(page.getByRole("region", { name: "Tree map", exact: true })).toHaveAttribute(
    "data-marker-count",
    /^[1-9]\d*$/u,
  );
}
export async function chooseCity(page: Page, id: string) {
  await page
    .getByRole("navigation", { name: "Inventory locations" })
    .getByRole("button", { name: new RegExp(city(id).city, "u") })
    .click();
  await ready(page, id);
}
export function url(id: string, extra: Record<string, string> = {}) {
  return `/?${new URLSearchParams({ city: id, release: city(id).release, ...extra })}`;
}
