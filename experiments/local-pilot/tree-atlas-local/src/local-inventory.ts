import { contains } from "./domain.ts";
import type { Dataset, Position } from "./domain.ts";

/** Prefer a local inventory over a regional compilation; extents are not coverage boundaries. */
export function inventoryAt(datasets: readonly Dataset[], position: Position): Dataset | undefined {
  return datasets
    .filter((dataset) => contains(dataset.viewBounds ?? dataset.bounds, position))
    .toSorted((a, b) => {
      const area = (dataset: Dataset) => {
        const [west, south, east, north] = dataset.viewBounds ?? dataset.bounds;
        return (east - west) * (north - south);
      };
      return area(a) - area(b);
    })[0];
}
