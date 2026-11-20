import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  blockExternalTiles,
  chooseCity,
  city,
  datasets,
  ready,
  reference,
  references,
  url,
} from "./helpers.ts";

test.use({ serviceWorkers: "block" });
test.beforeEach(async ({ context }) => {
  await blockExternalTiles(context);
});

test("API cities and search stay pinned without downloading complete inventory assets", async ({
  page,
}) => {
  const errors: string[] = [];
  const requests: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => requests.push(request.url()));
  await page.goto(url("vienna"));
  await ready(page, "vienna");
  for (const dataset of datasets) {
    await chooseCity(page, dataset.id);
    const expected = reference(dataset.id, "common-genus");
    const search = page.getByRole("searchbox", { name: "Find a tree or place" });
    await search.fill(expected.q);
    await search.press("Enter");
    await ready(page, dataset.id, expected.total);
    await expect(page).toHaveURL(new RegExp(`release=${dataset.release}`, "u"));
    const firstId = expected.pages.find((item) => item.kind === "first")?.ids[0];
    if (firstId === undefined) throw new Error("The chosen genus fixture needs a record");
    await page.getByRole("list", { name: "Tree records" }).getByRole("button").first().click();
    await expect(page.getByRole("region", { name: "Selected tree details" })).toBeVisible();
    expect(new URL(page.url()).searchParams.get("tree")).toBe(`${dataset.id}:${firstId}`);
    await page.getByRole("button", { name: "Close tree details" }).click();
    await page.getByRole("button", { name: "Clear filters" }).click();
    await ready(page, dataset.id);
  }
  expect(requests.some((value) => value.includes("/api/v1/query"))).toBe(true);
  expect(requests.some((value) => value.includes("/api/v1/detail"))).toBe(true);
  expect(requests.filter((value) => /\/(?:text|index|geometry)\.bin(?:\?|$)/u.test(value))).toEqual(
    [],
  );
  expect(requests.filter((value) => /\/detail-\d+\.bin(?:\?|$)/u.test(value))).toEqual([]);
  expect(errors).toEqual([]);
});

test("switching cities discards an older held search response", async ({ page }) => {
  await page.goto(url("vienna"));
  await ready(page, "vienna");
  let held = false;
  let release: (() => void) | undefined;
  const gate = new Promise<void>((accept) => {
    release = accept;
  });
  const completed: Promise<void>[] = [];
  await page.route("**/api/v1/query", async (route) => {
    const input: unknown = route.request().postDataJSON();
    if (
      typeof input !== "object" ||
      input === null ||
      !("dataset" in input) ||
      input.dataset !== "vienna" ||
      !("q" in input) ||
      input.q !== "acer"
    ) {
      await route.continue();
      return;
    }
    const work = (async () => {
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      held = true;
      await gate;
      try {
        await route.fulfill({ response });
      } catch {
        /* A correctly cancelled old browser request may already be gone. */
      }
    })();
    completed.push(work);
    await work;
  });
  try {
    const search = page.getByRole("searchbox", { name: "Find a tree or place" });
    await search.fill("acer");
    await search.press("Enter");
    await expect.poll(() => held).toBe(true);
    await chooseCity(page, "porto");
    release?.();
    await Promise.all(completed);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => resolve());
          });
        }),
    );
    await ready(page, "porto");
    await expect(page.getByRole("region", { name: "Tree map", exact: true })).toHaveAttribute(
      "data-city",
      "porto",
    );
    await page.getByRole("list", { name: "Tree records" }).getByRole("button").first().click();
    expect(new URL(page.url()).searchParams.get("tree")?.startsWith("porto:")).toBe(true);
  } finally {
    release?.();
  }
});

test("an unavailable local API never becomes an empty successful inventory", async ({ page }) => {
  await page.route("**/api/**", (route) => route.abort());
  await page.goto(url("porto"));
  await expect(
    page
      .getByRole("heading", {
        name: /^(?:Records could not load|The search could not complete|The local API is unavailable)$/iu,
      })
      .first(),
  ).toBeVisible();
  await expect(page.getByRole("list", { name: "Tree records" })).toHaveCount(0);
  await expect(page.locator(".results-heading h2")).not.toHaveText("0 records");
});

test("a missing saved release stays unavailable instead of opening latest", async ({ page }) => {
  await page.goto(`/?city=porto&release=missing-release&tree=porto%3A1`);
  await expect(
    page
      .getByRole("heading", {
        name: /^(?:This saved release is unavailable|Saved release unavailable)$/iu,
      })
      .first(),
  ).toBeVisible();
  await expect(page.getByRole("list", { name: "Tree records" })).toHaveCount(0);
  expect(new URL(page.url()).searchParams.get("release")).toBe("missing-release");
  expect(city("porto").release).not.toBe("missing-release");
});

test("clicking an API cluster exposes each coincident record individually", async ({ page }) => {
  const lon = 6.118538645727521;
  const lat = 46.208396950661125;
  const area = [lon - 0.00000001, lat - 0.00000001, lon + 0.00000001, lat + 0.00000001];
  const tokenResponse = await page.request.post("/api/attempt");
  expect(tokenResponse.ok()).toBe(true);
  const token = z.object({ id: z.string() }).parse(await tokenResponse.json());
  const response = await page.request.post("/api/v1/query", {
    headers: { "X-Request-ID": token.id },
    data: {
      contractVersion: "1.0.0",
      dataset: "geneva",
      release: city("geneva").release,
      q: "",
      area,
      viewport: area,
      zoom: 24,
      offset: 0,
      limit: 100,
      requestKey: randomUUID(),
    },
  });
  expect(response.ok()).toBe(true);
  const expected = z
    .object({
      total: z.literal(2),
      releaseFingerprint: z.string(),
      items: z.array(z.object({ sourceId: z.string() })).length(2),
    })
    .parse(await response.json());
  expect(expected.releaseFingerprint).toBe(
    references.find((item) => item.dataset === "geneva")?.contentSha256,
  );
  await page.goto(url("geneva", { area: area.join(",") }));
  await ready(page, "geneva", 2);
  for (let index = 0; index < expected.items.length; index++) {
    const panel = page.getByRole("region", { name: "Cluster records", exact: true });
    if (!(await panel.isVisible())) await page.locator(".inventory-cluster").first().click();
    await expect(
      panel.getByRole("heading", { name: "2 records in this cluster", exact: true }),
    ).toBeVisible();
    const members = panel
      .getByRole("list", { name: "Cluster members", exact: true })
      .getByRole("button");
    await expect(members).toHaveCount(2);
    await members.nth(index).click();
    await expect(page.getByRole("region", { name: "Selected tree details" })).toBeVisible();
    expect(new URL(page.url()).searchParams.get("tree")).toBe(
      `geneva:${expected.items[index]?.sourceId}`,
    );
    await page.getByRole("button", { name: "Close tree details" }).click();
  }
});
