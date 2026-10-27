import { chooseInventory } from "./location.ts";
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
  let detailRequests = 0;
  await page.context().route(/\/vienna-[^/]+\/detail-[0-9]+\.bin$/u, async (route) => {
    detailRequests++;
    await route.fulfill({ status: 503, body: "Detail revalidation unavailable" });
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.context().route(/\/(?:index|text)\.bin$/u, async (route) => {
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
    expect(detailRequests).toBe(0);
    await expect(page.getByText(/Preparing complete search/u)).toBeVisible();
    await expect(page.getByText("No matching source records.", { exact: false })).toHaveCount(0);
    await expect(page.getByRole("list", { name: "Tree records" })).toHaveCount(0);
    releaseIndex?.();
    await expect(page.getByRole("list", { name: "Tree records" })).toBeVisible();
    await expect(page.getByText(/Preparing complete search/u)).toHaveCount(0);
    // The early spatial detail must be revalidated by the exact inventory after handoff.
    // Failure must replace it with an error, rather than retaining the early cached value.
    await expect(page.getByRole("heading", { name: "Details could not load" })).toBeVisible({
      timeout: 30000,
    });
    await expect(page.getByRole("region", { name: "Selected tree details" })).toHaveCount(0);
    expect(detailRequests).toBeGreaterThan(0);
    await expect(page).toHaveURL(
      new RegExp(`tree=vienna%3A${encodeURIComponent(selectedId)}`, "u"),
    );
    expect(errors).toEqual([]);
  } finally {
    releaseIndex?.();
  }
});

test("area search waits without queuing viewport queries while geometry loads", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    const counts = { areaQueries: 0 };
    Object.defineProperty(window, "atlasWorkerCounts", { value: counts });
    const original: unknown = Object.getOwnPropertyDescriptor(
      Worker.prototype,
      "postMessage",
    )?.value;
    if (typeof original !== "function") throw new Error("Worker messaging is unavailable");
    Worker.prototype.postMessage = function (
      message: unknown,
      options?: Transferable[] | StructuredSerializeOptions,
    ) {
      if (
        typeof message === "object" &&
        message !== null &&
        "kind" in message &&
        message.kind === "query" &&
        "query" in message &&
        typeof message.query === "object" &&
        message.query !== null &&
        "area" in message.query &&
        message.query.area !== null
      )
        counts.areaQueries++;
      Reflect.apply(original, this, [message, options]);
    };
  });
  let releaseGeometry = () => {};
  const gate = new Promise<void>((resolve) => {
    releaseGeometry = resolve;
  });
  let requested = false;
  await page.context().route(/\/london-[^/]+\/geometry\.bin$/u, async (route) => {
    requested = true;
    await gate;
    await route.continue().catch(() => undefined);
  });
  const sent = () =>
    page.evaluate(() => {
      const counts: unknown = Reflect.get(window, "atlasWorkerCounts");
      if (
        typeof counts !== "object" ||
        counts === null ||
        !("areaQueries" in counts) ||
        typeof counts.areaQueries !== "number"
      )
        throw new Error("Worker counts are unavailable");
      return counts.areaQueries;
    });
  try {
    await page.goto("/?city=london&area=-0.15,51.48,-0.1,51.52");
    await expect.poll(() => requested).toBe(true);
    await expect(page.getByText(/Preparing exact results for this area/u)).toBeVisible();
    const map = page.locator(".map");
    const box = await map.boundingBox();
    if (box === null) throw new Error("Expected visible map");
    for (let i = 0; i < 3; i++) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + 50, box.y + box.height / 2 + 30, { steps: 5 });
      await page.mouse.up();
    }
    expect(await sent()).toBe(0);
    releaseGeometry();
    await expect.poll(sent, { timeout: 60000 }).toBeGreaterThan(0);
    await expect(page.getByRole("list", { name: "Tree records" })).toBeVisible();
  } finally {
    releaseGeometry();
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
  await page.context().route(/\/vienna-[^/]+\/(?:index|text)\.bin$/u, async (route) => {
    viennaRequested = true;
    await indexGate;
    await route.continue().catch(() => undefined);
  });
  try {
    await page.goto("/?city=vienna");
    await expect.poll(() => viennaRequested).toBe(true);
    await chooseInventory(page, "geneva", "Geneva");
    await chooseInventory(page, "porto", "Porto");
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

test("London complete text search and exact details work before geometry; area results wait", async ({
  page,
}) => {
  test.setTimeout(120_000);
  let releaseGeometry = () => {};
  const gate = new Promise<void>((resolve) => {
    releaseGeometry = resolve;
  });
  let requested = false;
  await page.context().route(/\/london-[^/]+\/geometry\.bin$/u, async (route) => {
    requested = true;
    await gate;
    await route.continue().catch(() => undefined);
  });
  const manifest = manifestSchema.parse(
    await (await page.request.get("/data/manifest.json")).json(),
  );
  const dataset = manifest.datasets.find((item) => item.id === "london");
  if (dataset === undefined) throw new Error("London must be published for this regression.");
  try {
    await page.goto("/?city=london");
    await expect.poll(() => requested).toBe(true);
    await expect(
      page.getByRole("heading", {
        name: `${dataset.count.toLocaleString("en")} records`,
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByText(/All records are searchable/u)).toBeVisible();
    const map = page.getByRole("region", { name: "Tree map" });
    await expect(map).toHaveAttribute("data-filter-ready", "false");
    await page.getByRole("list", { name: "Tree records" }).getByRole("button").first().click();
    await expect(page.getByRole("region", { name: "Selected tree details" })).toBeVisible();
    await page.goto(`/?city=london&area=${dataset.bounds.join(",")}`);
    await expect(page.getByText(/Preparing exact results for this area/u)).toBeVisible();
    await expect(
      page.getByRole("heading", {
        name: `${dataset.count.toLocaleString("en")} records`,
        exact: true,
      }),
    ).toHaveCount(0);
    releaseGeometry();
    await expect(
      page.getByRole("heading", {
        name: `${dataset.count.toLocaleString("en")} records`,
        exact: true,
      }),
    ).toBeVisible({ timeout: 60_000 });
    await expect(map).toHaveAttribute("data-filter-ready", "true");
  } finally {
    releaseGeometry();
  }
});

test("failed exact geometry keeps complete text search and can be retried", async ({ page }) => {
  test.setTimeout(120_000);
  let failed = false;
  await page.context().route(/\/london-[^/]+\/geometry\.bin$/u, async (route) => {
    if (!failed) {
      failed = true;
      await route.fulfill({ status: 503, body: "Unavailable" });
    } else await route.continue();
  });
  await page.goto("/?city=london");
  const error = page.getByRole("heading", { name: "Exact map search could not load" });
  await expect(error).toBeVisible();
  await expect(page.getByRole("list", { name: "Tree records" })).toBeVisible();
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(error).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Tree map" })).toHaveAttribute(
    "data-filter-ready",
    "true",
    { timeout: 60_000 },
  );
});

test("complete London text search does not depend on detail downloads", async ({ page }) => {
  test.setTimeout(120_000);
  let releaseGeometry = () => {};
  const gate = new Promise<void>((resolve) => {
    releaseGeometry = resolve;
  });
  let detailRequests = 0;
  await page.context().route(/\/london-[^/]+\/geometry\.bin$/u, async (route) => {
    await gate;
    await route.continue().catch(() => undefined);
  });
  await page.context().route(/\/london-[^/]+\/detail-[0-9]+\.bin$/u, async (route) => {
    detailRequests++;
    await route.fulfill({ status: 503, body: "Unavailable" });
  });
  try {
    await page.goto("/?city=london");
    const list = page.getByRole("list", { name: "Tree records" });
    await expect(list).toBeVisible();
    for (const text of ["Acer", "Quercus", ""]) {
      await page.getByRole("searchbox").fill(text);
      await page.getByRole("searchbox").press("Enter");
      await expect(list).toBeVisible();
    }
    expect(detailRequests).toBe(0);
    await list.getByRole("button").first().click();
    await expect(page.getByRole("heading", { name: "Details could not load" })).toBeVisible({
      timeout: 30000,
    });
    await expect(list).toBeVisible();
    expect(detailRequests).toBeGreaterThan(0);
  } finally {
    releaseGeometry();
  }
});
