import { expect, test } from "@playwright/test";

let browserErrors: string[] = [];
let detailRequests: string[] = [];

test.beforeEach(async ({ page }) => {
  browserErrors = [];
  detailRequests = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.context().on("request", (request) => {
    if (/\/detail-\d+\.bin/u.test(request.url())) detailRequests.push(request.url());
  });
  // Basemap availability is outside these local-data user journeys.
  await page.route("https://tile.openstreetmap.org/**", (route) => route.abort());
  await page.goto("/");
  await expect(page.getByRole("list", { name: "Tree records" })).toBeVisible();
});

test.afterEach(() => {
  expect(browserErrors).toEqual([]);
});

test("selection, closing details and browser history retain the filtered map context", async ({
  page,
}) => {
  const search = page.getByRole("searchbox", { name: "Find a tree or place" });
  await search.fill("Acer");
  await expect(page.locator("#search-suggestions")).toBeVisible();
  await search.press("Enter");
  await expect(page).toHaveURL(/q=Acer/u);
  const results = page.getByRole("list", { name: "Tree records" });
  const first = results.getByRole("button").first();
  await first.click();
  await expect(page.getByRole("region", { name: "Selected tree details" })).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Selected tree details" }).getByRole("heading"),
  ).toBeFocused();
  await expect(page).toHaveURL(/tree=vienna%3A/u);
  await expect(page).toHaveURL(/release=/u);
  await expect(page.getByRole("region", { name: "Tree map" })).toBeVisible();
  await page.getByRole("button", { name: "Close tree details" }).click();
  await expect(page.getByRole("region", { name: "Selected tree details" })).toHaveCount(0);
  await expect(search).toHaveValue("Acer");
  await page.goBack();
  await expect(page.getByRole("region", { name: "Selected tree details" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("region", { name: "Selected tree details" })).toBeVisible();
});

test("city changes do not display results or selections from the previous city", async ({
  page,
}) => {
  await page.getByRole("list", { name: "Tree records" }).getByRole("button").first().click();
  await page
    .getByRole("button", { name: /Geneva/u, exact: false })
    .first()
    .click();
  await expect(page).toHaveURL(/city=geneva/u);
  await expect(page.getByRole("region", { name: "Selected tree details" })).toHaveCount(0);
  await expect(page.getByRole("list", { name: "Tree records" })).toBeVisible();
  await page.getByRole("list", { name: "Tree records" }).getByRole("button").first().click();
  await expect(page).toHaveURL(/tree=geneva%3A/u);
  await page.getByRole("button", { name: /Porto/u, exact: false }).first().click();
  await expect(page).toHaveURL(/city=porto/u);
  await expect(page.getByRole("list", { name: "Tree records" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Selected tree details" })).toHaveCount(0);
});

test("mouse wheel zoom changes the committed map area", async ({ page }) => {
  await page.getByRole("button", { name: "Search this area" }).click();
  const before = new URL(page.url()).searchParams.get("area");
  expect(before).not.toBeNull();
  await page.locator(".map").hover({ position: { x: 300, y: 220 } });
  await page.mouse.wheel(0, -600);
  // Leaflet's debounced wheel zoom settles before an area is committed.
  await page.waitForTimeout(600);
  await page.getByRole("button", { name: "Search this area" }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get("area")).not.toBe(before);
});

test("a missing saved release is explicit and never substituted silently", async ({ page }) => {
  await page.goto("/?city=porto&release=missing&tree=porto%3A1");
  await expect(
    page.getByRole("heading", { name: "This saved release is unavailable" }),
  ).toBeVisible();
  await expect(page.getByRole("list", { name: "Tree records" })).toHaveCount(0);
  await page.getByRole("button", { name: "Open the current release" }).click();
  await expect(page.getByRole("list", { name: "Tree records" })).toBeVisible();
  expect(new URL(page.url()).searchParams.has("tree")).toBe(false);
});

test("mobile layout remains usable without horizontal scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("region", { name: "Tree map" })).toBeVisible();
  await expect(page.getByRole("searchbox")).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);
});

test("full inventories use bounded map markers and list pages, fetching details only on selection", async ({
  page,
}) => {
  const cases = [
    { name: "Vienna", minimum: 200_000 },
    { name: "Geneva", minimum: 200_000 },
    { name: "Porto", minimum: 70_000 },
  ];
  for (const item of cases) {
    await page
      .getByRole("navigation", { name: "Inventory locations" })
      .getByRole("button", { name: new RegExp(item.name, "u") })
      .click();
    await expect
      .poll(async () =>
        Number((await page.locator(".results-heading h2").innerText()).replace(/\D/gu, "")),
      )
      .toBeGreaterThan(item.minimum);
    await expect(
      page.getByRole("list", { name: "Tree records" }).getByRole("listitem"),
    ).toHaveCount(30);
    await expect
      .poll(async () =>
        Number(
          await page.getByRole("region", { name: "Tree map" }).getAttribute("data-marker-count"),
        ),
      )
      .toBeGreaterThan(0);
    expect(
      Number(
        await page.getByRole("region", { name: "Tree map" }).getAttribute("data-marker-count"),
      ),
    ).toBeLessThanOrEqual(1000);
  }
  const first = await page
    .getByRole("list", { name: "Tree records" })
    .getByRole("button")
    .first()
    .innerText();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "Results pages" })).toContainText("31–60");
  await expect(page.getByRole("list", { name: "Tree records" }).getByRole("listitem")).toHaveCount(
    30,
  );
  await expect(
    page.getByRole("list", { name: "Tree records" }).getByRole("button").first(),
  ).not.toHaveText(first);
  expect(detailRequests).toHaveLength(0);
  await page.getByRole("list", { name: "Tree records" }).getByRole("button").first().click();
  await expect(page.getByRole("region", { name: "Selected tree details" })).toBeVisible();
  expect(detailRequests).toHaveLength(1);
});

test("an original Geneva study link keeps its snapshot and offers the full inventory", async ({
  page,
}) => {
  await page.goto("/?city=geneva&release=geneva-d4250459b8e3aba6");
  await expect(page.getByRole("heading", { name: "4,685 records" })).toBeVisible();
  await expect(page.getByText("You are viewing a saved release")).toBeVisible();
  await page.getByRole("button", { name: "Open full inventory" }).click();
  await expect
    .poll(async () =>
      Number((await page.locator(".results-heading h2").innerText()).replace(/\D/gu, "")),
    )
    .toBeGreaterThan(200_000);
  expect(new URL(page.url()).searchParams.get("release")).not.toBe("geneva-d4250459b8e3aba6");
  await expect(page.getByText("You are viewing a saved release")).toHaveCount(0);
});

test("cluster selection zooms the viewport without committing a new search until requested", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Search this area" }).click();
  const before = new URL(page.url()).searchParams.get("area");
  expect(before).not.toBeNull();
  await page
    .getByRole("button", { name: /records; zoom in/u })
    .first()
    .click();
  expect(new URL(page.url()).searchParams.get("area")).toBe(before);
  await page.getByRole("button", { name: "Search this area" }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get("area")).not.toBe(before);
  expect(
    Number(await page.getByRole("region", { name: "Tree map" }).getAttribute("data-marker-count")),
  ).toBeLessThanOrEqual(1000);
});
