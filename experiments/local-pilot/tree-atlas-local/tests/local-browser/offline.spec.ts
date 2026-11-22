import { expect, test } from "@playwright/test";
import { blockExternalTiles, city, ready, reference, url } from "./helpers.ts";

test("a complete pinned pack survives an offline refresh, with saved details only", async ({
  page,
  context,
}) => {
  test.setTimeout(180_000);
  await blockExternalTiles(context);
  const expected = reference("porto", "leading-zeros");
  const firstPage = expected.pages.find((item) => item.kind === "first");
  const savedId = firstPage?.ids[0];
  const unsavedId = firstPage?.ids[1];
  if (savedId === undefined || unsavedId === undefined)
    throw new Error("Offline fixture needs two known records");
  await page.goto(url("porto", { q: expected.q }));
  await ready(page, "porto", expected.total);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.getByRole("button", { name: "Download city for offline use", exact: true }).click();
  await expect(page.getByText(/^Offline pack ready/u).first()).toBeVisible({ timeout: 90_000 });
  await page.getByRole("list", { name: "Tree records" }).getByRole("button").first().click();
  expect(new URL(page.url()).searchParams.get("tree")).toBe(`porto:${savedId}`);
  await expect(page.getByRole("region", { name: "Selected tree details" })).toBeVisible();
  await page.getByRole("button", { name: "Save details for offline use", exact: true }).click();
  await expect(page.getByText("Details saved for offline use.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Use downloaded city", exact: true }).click();
  await ready(page, "porto", expected.total);
  const offlineApiRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/")) offlineApiRequests.push(request.url());
  });
  await context.setOffline(true);
  try {
    await page.reload();
    await ready(page, "porto", expected.total);
    await expect(page.getByRole("region", { name: "Selected tree details" })).toBeVisible();
    await page.getByRole("button", { name: "Close tree details" }).click();
    await page.getByRole("button", { name: "Clear filters" }).click();
    await ready(page, "porto", city("porto").count);
    const common = reference("porto", "common-genus");
    const search = page.getByRole("combobox", { name: "Find a tree or place" });
    await search.fill(common.q);
    await search.press("Enter");
    await ready(page, "porto", common.total);
    const central = reference("porto", "central-area");
    if (central.area === null) throw new Error("Central-area oracle requires bounds");
    await page.goto(url("porto", { area: central.area.join(",") }));
    await ready(page, "porto", central.total);
    await expect(page.getByRole("region", { name: "Tree map", exact: true })).toHaveAttribute(
      "data-marker-count",
      /[1-9]\d*/u,
    );
    await page.goto(url("porto", { q: expected.q, tree: `porto:${unsavedId}` }));
    await ready(page, "porto", expected.total);
    await expect(
      page.getByText("These details were not saved for offline use.", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Record not found in this release" }),
    ).toHaveCount(0);
    await page.goto(url("porto", { q: expected.q, tree: `porto:${savedId}` }));
    await ready(page, "porto", expected.total);
    await expect(page.getByRole("region", { name: "Selected tree details" })).toBeVisible();
    expect(offlineApiRequests).toEqual([]);
    // Simulate IndexedDB eviction while retaining the cached app shell and mode.
    const session = await context.newCDPSession(page);
    try {
      await session.send("Storage.clearDataForOrigin", {
        origin: new URL(page.url()).origin,
        storageTypes: "indexeddb",
      });
    } finally {
      await session.detach();
    }
    await page.reload();
    await expect(
      page
        .getByRole("heading", { name: /could not load|not ready|unavailable|incomplete/iu })
        .first(),
    ).toBeVisible();
    await expect(page.getByRole("list", { name: "Tree records" })).toHaveCount(0);
    await expect(page.locator(".results-heading h2")).not.toHaveText("0 records");
    expect(offlineApiRequests).toEqual([]);
  } finally {
    await context.setOffline(false);
  }
});
