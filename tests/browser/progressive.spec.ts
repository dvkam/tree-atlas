import { expect, test } from "@playwright/test";
import { gunzipSync } from "node:zlib";
import { manifestSchema, releaseSchema } from "../../src/domain.ts";
import { mapCatalogSchema } from "../../src/progressive-map.ts";

test.beforeEach(async ({ page }) => {
  await page.route("https://tile.openstreetmap.org/**", (route) => route.abort());
});

test("a cold map opens tree details while complete search is still downloading", async ({
  page,
}) => {
  let releaseIndex: (() => void) | undefined;
  const indexGate = new Promise<void>((resolve) => {
    releaseIndex = resolve;
  });
  let indexRequested = false;
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.context().route("**/index.bin", async (route) => {
    indexRequested = true;
    await indexGate;
    await route.continue();
  });
  try {
    const manifest = manifestSchema.parse(
      await (await page.request.get("/data/manifest.json")).json(),
    );
    const dataset = manifest.datasets.find((item) => item.id === "vienna");
    if (dataset?.map === undefined)
      throw new Error("Vienna needs published progressive map assets.");
    const catalogBytes = await (await page.request.get(`/data/${dataset.map.file}`)).body();
    const catalog = mapCatalogSchema.parse(JSON.parse(gunzipSync(catalogBytes).toString()));
    const asset = catalog.nodes.find((node) => node.asset !== undefined)?.asset;
    if (asset === undefined) throw new Error("Vienna needs a spatial leaf.");
    const leafBytes = await (await page.request.get(`/data/${asset.file}`)).body();
    const leaf = releaseSchema.parse(JSON.parse(gunzipSync(leafBytes).toString()));
    const position = leaf.trees[0]?.position;
    if (position == null) throw new Error("The spatial leaf needs a located tree.");
    const [lon, lat] = position;
    const area = [lon - 0.0001, lat - 0.0001, lon + 0.0001, lat + 0.0001].join(",");
    await page.goto(`/?city=vienna&area=${area}`);
    await expect.poll(() => indexRequested).toBe(true);
    await expect(page.getByText(/Preparing complete search/u)).toBeVisible();
    await expect(page.getByRole("list", { name: "Tree records" })).toHaveCount(0);
    const map = page.getByRole("region", { name: "Tree map" });
    await expect(map).toHaveAttribute("aria-busy", "false");
    await expect
      .poll(async () => Number(await map.getAttribute("data-marker-count")))
      .toBeGreaterThan(0);
    // Fit a tight area around a published tree, then click the canvas at its centre.
    // This exercises Leaflet hit testing without reading private map state.
    const canvasHost = page.locator(".map");
    const box = await canvasHost.boundingBox();
    if (box === null) throw new Error("The map must have a visible size.");
    await canvasHost.click({ position: { x: box.width / 2, y: box.height / 2 } });
    await expect(page.getByRole("region", { name: "Selected tree details" })).toBeVisible();
    await expect(page).toHaveURL(/tree=vienna%3A/u);
    const selectedId = new URL(page.url()).searchParams.get("tree")?.slice("vienna:".length);
    if (selectedId === undefined) throw new Error("Selecting a map tree must update the URL.");
    await page.getByRole("searchbox").fill(selectedId);
    await page.getByRole("searchbox").press("Enter");
    await expect(page.getByText(/Preparing complete search/u)).toBeVisible();
    await expect(page.getByText("No matching source records.", { exact: false })).toHaveCount(0);
    await expect(page.getByRole("list", { name: "Tree records" })).toHaveCount(0);
    releaseIndex?.();
    await expect(page.getByRole("list", { name: "Tree records" })).toBeVisible();
    await expect(page.getByText(/Preparing complete search/u)).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    releaseIndex?.();
  }
});

test("switching city during cold search does not expose the previous city", async ({ page }) => {
  let releaseIndex: (() => void) | undefined;
  const indexGate = new Promise<void>((resolve) => {
    releaseIndex = resolve;
  });
  let viennaRequested = false;
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.context().route("**/vienna-*/index.bin", async (route) => {
    viennaRequested = true;
    await indexGate;
    await route.continue().catch(() => undefined);
  });
  try {
    await page.goto("/?city=vienna");
    await expect.poll(() => viennaRequested).toBe(true);
    const locations = page.getByRole("navigation", { name: "Inventory locations" });
    await locations.getByRole("button", { name: /Geneva/u }).click();
    await locations.getByRole("button", { name: /Porto/u }).click();
    await expect(page).toHaveURL(/city=porto/u);
    releaseIndex?.();
    await expect(page.getByRole("list", { name: "Tree records" })).toBeVisible();
    await expect(page.locator('[id^="record-vienna:"]')).toHaveCount(0);
    await expect(page.locator('[id^="record-geneva:"]')).toHaveCount(0);
    await page.getByRole("list", { name: "Tree records" }).getByRole("button").first().click();
    await expect(page.getByRole("region", { name: "Selected tree details" })).toBeVisible();
    await expect(page).toHaveURL(/tree=porto%3A/u);
    expect(errors).toEqual([]);
  } finally {
    releaseIndex?.();
  }
});

test("a corrupt spatial catalogue reports fallback and keeps the full inventory usable", async ({
  page,
}) => {
  let corrupted = false;
  await page.context().route("**/map.bin", async (route) => {
    corrupted = true;
    await route.fulfill({ status: 200, body: "invalid spatial bytes" });
  });
  await page.goto("/?city=vienna");
  await expect.poll(() => corrupted).toBe(true);
  await expect(page.getByRole("heading", { name: "Early map data could not load" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Tree records" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Tree map" })).toHaveAttribute(
    "data-city",
    "vienna",
  );
  await expect
    .poll(async () =>
      Number(
        await page.getByRole("region", { name: "Tree map" }).getAttribute("data-marker-count"),
      ),
    )
    .toBeGreaterThan(0);
  await page.getByRole("list", { name: "Tree records" }).getByRole("button").first().click();
  await expect(page.getByRole("region", { name: "Selected tree details" })).toBeVisible();
});
