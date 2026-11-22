import { expect, test } from "@playwright/test";

test.use({ hasTouch: true });

test("search keeps keyboard focus, announces the active choice and dismisses outside", async ({
  page,
}) => {
  await page.route("https://tile.openstreetmap.org/**", (route) => route.abort());
  await page.goto("/?city=porto");
  const field = page.getByRole("combobox", { name: "Find a tree or place" });
  const popup = page.getByRole("listbox", { name: "Search suggestions" });
  await field.fill("Vienna");
  await field.press("ArrowDown");
  const active = popup.getByRole("option", { selected: true });
  await expect(active).toHaveText(/Vienna.*Austria/u);
  await expect(field).toHaveAttribute(
    "aria-activedescendant",
    (await active.getAttribute("id")) ?? "",
  );
  await expect(field).toBeFocused();
  await field.press("Escape");
  await expect(popup).toHaveCount(0);
  await expect(field).toBeFocused();
  await field.click();
  await field.press("ArrowDown");
  await field.press("Tab");
  await expect(field).toHaveAttribute("aria-expanded", "false");
  expect(await field.getAttribute("aria-activedescendant")).toBeNull();
  await field.click();
  await expect(popup).toBeVisible();
  await page.getByRole("heading", { level: 1 }).click();
  await expect(popup).toHaveCount(0);
  await field.fill("Tilia");
  await field.press("Enter");
  await expect(page.getByRole("heading", { name: "2,676 records" })).toBeVisible();
  await expect(field).toBeFocused();
  await field.fill("Vienna");
  await field.press("ArrowDown");
  await field.dispatchEvent("keydown", { key: "Enter", isComposing: true, bubbles: true });
  await expect(popup).toBeVisible();
  await expect(page).toHaveURL(/city=porto/u);
  await field.press("Enter");
  await expect(page).toHaveURL(/city=vienna/u);
  await expect(field).toHaveValue("");
  await expect(popup).toHaveCount(0);
});

test("touch suggestions stay anchored to their input and honor reduced motion", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("https://tile.openstreetmap.org/**", (route) => route.abort());
  await page.goto("/?city=porto");
  const field = page.getByRole("combobox", { name: "Find a tree or place" });
  await field.scrollIntoViewIfNeeded();
  await field.fill("tilia");
  const popup = page.getByRole("listbox");
  await expect(popup).toBeVisible();
  const layout = await popup.evaluate((list) => {
    const input = document.getElementById("tree-search");
    if (!input) throw Error("Missing input");
    const a = input.getBoundingClientRect(),
      b = list.getBoundingClientRect();
    const [x, y] = getComputedStyle(list).transformOrigin.split(" ").map(parseFloat);
    return {
      source: a.left + a.width / 2,
      origin: b.left + (x ?? 0),
      edge: list.dataset["side"] === "above" ? b.height : 0,
      y,
      animation: getComputedStyle(list).animationName,
    };
  });
  expect(layout.animation).toBe("none");
  expect(Math.abs(layout.source - layout.origin)).toBeLessThan(2);
  expect(Math.abs((layout.y ?? 0) - layout.edge)).toBeLessThan(2);
  await field.evaluate((input) =>
    scrollBy(0, input.getBoundingClientRect().top - (innerHeight - 80)),
  );
  await expect(popup).toHaveAttribute("data-side", "above");
  await field.evaluate((input) => scrollBy(0, input.getBoundingClientRect().top - 70));
  await expect(popup).toHaveAttribute("data-side", "below");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(popup).toHaveCSS("animation-name", "atlas-reveal");
  await popup.getByRole("option", { name: /Search for/u }).tap();
  await expect(page.getByRole("heading", { name: "2,676 records" })).toBeVisible();
  await expect(popup).toHaveCount(0);
});
