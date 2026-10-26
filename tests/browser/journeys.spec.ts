import { expect, test } from "@playwright/test";

let browserErrors: string[] = [];

test.beforeEach(async ({ page }) => {
  browserErrors = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
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
