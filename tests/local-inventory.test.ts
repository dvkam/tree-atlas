import { expect, it } from "vitest";
import type { Dataset } from "../src/domain.ts";
import { inventoryAt } from "../src/local-inventory.ts";
const base: Dataset = {
  id: "london",
  city: "London",
  country: "United Kingdom",
  center: [0, 51.5],
  bounds: [-1, 51, 1, 52],
  count: 1,
  release: "london-test",
  file: "releases/london-test/london.json",
  sha256: "0".repeat(64),
  fetchedAt: "2026-10-27T00:00:00Z",
  sourceUrl: "https://example.org/source",
  attribution: "Synthetic fixture",
  license: "Test only",
  licenseUrl: "https://example.org/licence",
  coverage: "Synthetic bounds",
};
it("prefers local coverage independently of manifest order", () => {
  const camden: Dataset = { ...base, id: "camden", bounds: [-0.2, 51.5, -0.1, 51.6] };
  expect(inventoryAt([base, camden], [-0.15, 51.55])?.id).toBe("camden");
  expect(inventoryAt([camden, base], [-0.15, 51.55])?.id).toBe("camden");
});
it("uses the intended camera extent when distant source outliers enlarge raw bounds", () => {
  const amsterdam: Dataset = {
    ...base,
    id: "amsterdam",
    bounds: [4, 47, 6, 53],
    viewBounds: [4.7, 52.25, 5.1, 52.45],
  };
  expect(inventoryAt([amsterdam], [4.9, 48])).toBeUndefined();
  expect(inventoryAt([amsterdam], [4.9, 52.35])?.id).toBe("amsterdam");
});
it("does not claim coverage outside all published extents", () => {
  expect(inventoryAt([base], [16.4, 48.2])).toBeUndefined();
});
