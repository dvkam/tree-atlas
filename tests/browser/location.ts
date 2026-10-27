import type { Page } from "@playwright/test";
export async function chooseInventory(page: Page, id: string, city: string) {
  const picker = page.getByRole("combobox", { name: "Inventory location", exact: true });
  if (await picker.count()) await picker.selectOption(id);
  else
    await page
      .getByRole("navigation", { name: "Inventory locations" })
      .getByRole("button", { name: new RegExp(city.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u") })
      .click();
}
