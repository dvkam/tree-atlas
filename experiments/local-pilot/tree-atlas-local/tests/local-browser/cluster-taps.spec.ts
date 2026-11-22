import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { blockExternalTiles, ready, url } from "./helpers.ts";

async function openLargestLondonCluster(page: Page, touch: boolean) {
  const map = page.getByRole("region", { name: "Tree map", exact: true });
  await map.scrollIntoViewIfNeeded();
  const clusters = map.locator(".inventory-cluster");
  const targets = await clusters.evaluateAll((icons) =>
    icons.map((icon, index) => {
      const box = icon.getBoundingClientRect();
      const x = box.x + box.width / 2,
        y = box.y + box.height / 2;
      const count = Number(icon.getAttribute("aria-label")?.split(" ")[0]?.replaceAll(",", ""));
      const points = [
        [x, y],
        [x - 15, y],
        [x + 15, y],
        [x, y - 15],
        [x, y + 15],
      ];
      return {
        index,
        count,
        x,
        y,
        reachable: points.every(
          ([px, py]) =>
            px !== undefined &&
            py !== undefined &&
            document.elementFromPoint(px, py)?.closest(".inventory-cluster") === icon,
        ),
      };
    }),
  );
  expect(targets.length).toBeGreaterThan(1);
  expect(targets.filter((t) => !t.reachable)).toEqual([]);
  const largest = targets.toSorted((a, b) => b.count - a.count)[0];
  if (!largest || largest.count <= 60) throw new Error("Expected a paged London cluster.");
  if (touch) await page.touchscreen.tap(largest.x, largest.y);
  else await page.mouse.click(largest.x, largest.y);
  const panel = page.getByRole("region", { name: "Cluster records", exact: true });
  const heading = panel.getByRole("heading", {
    name: largest.count.toLocaleString("en") + " records in this cluster",
    exact: true,
  });
  await expect(heading).toBeFocused();
  await expect(heading).toBeInViewport();
  const members = panel.getByRole("list", { name: "Cluster members" }).getByRole("button");
  await expect(members).toHaveCount(30);
  const first = await members.evaluateAll((items) => items.map((item) => item.id));
  await panel.getByRole("button", { name: "Next", exact: true }).click();
  await expect(members.first()).not.toHaveAttribute("id", first[0] ?? "");
  await expect(members).toHaveCount(30);
  const second = await members.evaluateAll((items) => items.map((item) => item.id));
  expect(new Set([...first, ...second]).size).toBe(60);
  expect([...first, ...second].every((id) => id.startsWith("cluster-record-london:"))).toBe(true);
  await panel.getByRole("button", { name: "Close cluster records" }).click();
  await expect(clusters.nth(largest.index)).toBeFocused();
  return { clusters: targets.length, largest: largest.count, first, second };
}

for (const profile of [
  { width: 390, height: 844, touch: true },
  { width: 1280, height: 800, touch: false },
]) {
  test.describe("London map at " + profile.width + " px", () => {
    test.use({
      viewport: { width: profile.width, height: profile.height },
      hasTouch: profile.touch,
      isMobile: profile.touch,
    });
    test("each group has a separate target that opens its exact records", async ({
      page,
      context,
    }) => {
      test.setTimeout(180000);
      await blockExternalTiles(context);
      await page.goto(url("london"));
      await ready(page, "london");
      const online = await openLargestLondonCluster(page, profile.touch);
      test.info().annotations.push({
        type: "London cluster hit test",
        description: `${online.clusters} cluster targets, five points each. Largest group: ${online.largest} records.`,
      });
      if (!profile.touch) return;
      await page
        .getByRole("button", { name: "Download city for offline use", exact: true })
        .click();
      await expect(page.getByText(/^Offline pack ready/u).first()).toBeVisible({ timeout: 90000 });
      await page.getByRole("button", { name: "Use downloaded city", exact: true }).click();
      await ready(page, "london");
      await context.setOffline(true);
      await page.reload();
      await ready(page, "london");
      expect(await openLargestLondonCluster(page, true)).toEqual(online);
    });
  });
}
