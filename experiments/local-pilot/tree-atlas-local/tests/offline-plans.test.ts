import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { datasetSchema } from "../src/domain.ts";
import { offlinePlan } from "../src/offline-store.ts";
const lock = z
  .object({ datasets: z.array(datasetSchema) })
  .parse(
    JSON.parse(
      readFileSync(
        new URL("../../tree-atlas-contract-v1/baseline.lock.json", import.meta.url),
        "utf8",
      ),
    ),
  );
describe("complete pinned city package plans", () => {
  it("quotes all required stored bytes before downloading", () => {
    const expected: Readonly<Record<string, number>> = {
      london: 16139261,
      vienna: 4092520,
      geneva: 3845514,
      porto: 1042189,
    };
    for (const dataset of lock.datasets) {
      const plan = offlinePlan(dataset);
      expect(plan.bytes).toBe(expected[dataset.id]);
      expect(plan.assets.some((asset) => asset.file.includes("detail-"))).toBe(false);
      expect(plan.assets.some((asset) => asset.file.endsWith("map.bin"))).toBe(false);
      expect(plan.assets[0]?.sha256).toBe(dataset.sha256);
      expect(plan.assets.length).toBe(dataset.id === "london" ? 3 : 2);
    }
  });
  it("does not advertise a different or unsupported saved release as downloadable", () => {
    const dataset = lock.datasets[0];
    if (dataset === undefined) throw new Error("Missing frozen dataset");
    expect(() => offlinePlan({ ...dataset, release: "other-release" })).toThrow("pinned release");
    expect(() => offlinePlan({ ...dataset, sha256: "0".repeat(64) })).toThrow("pinned release");
  });
});
