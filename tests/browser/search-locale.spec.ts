import { expect, test } from "@playwright/test";

// Pin the release so the expected count survives a municipal inventory refresh.
const porto = "/?city=porto&release=porto-6be0471b6c303ac2&q=Tilia";

for (const locale of ["en-GB", "tr-TR"]) {
  test.describe(locale, () => {
    test.use({ locale });

    test("Porto keeps the same Tilia records when the query is uppercase", async ({ page }) => {
      await page.route("https://tile.openstreetmap.org/**", (route) => route.abort());
      await page.goto(porto);
      const count = page.getByRole("heading", { name: "2,676 records", exact: true });
      const rows = page.getByRole("list", { name: "Tree records" }).getByRole("button");
      await expect(count).toBeVisible();
      await expect(rows).toHaveCount(30);
      const ids = await rows.evaluateAll((buttons) => buttons.map((button) => button.id));
      const search = page.getByRole("combobox", { name: "Find a tree or place" });
      await search.fill("TILIA");
      await search.press("Enter");
      await expect(page).toHaveURL(/q=TILIA/u);
      await expect(page.getByText(/Across this published inventory · “TILIA”/u)).toBeVisible();
      await expect(count).toBeVisible();
      await expect
        .poll(() => rows.evaluateAll((buttons) => buttons.map((button) => button.id)))
        .toEqual(ids);
    });
  });
}
