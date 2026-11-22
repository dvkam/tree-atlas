import { expectTypeOf, it } from "vitest";
import type { Dataset } from "../src/domain.ts";
import type { InventorySearchProps } from "../src/inventory-search.tsx";

it("requires a city record for navigation and a text query for submission", () => {
  expectTypeOf<InventorySearchProps["onCity"]>().parameter(0).toEqualTypeOf<Dataset>();
  expectTypeOf<InventorySearchProps["onSearch"]>().parameter(0).toEqualTypeOf<string>();
  expectTypeOf<{ client: { query: string } }>().not.toMatchTypeOf<
    Pick<InventorySearchProps, "client">
  >();
  expectTypeOf<Omit<InventorySearchProps, "onCity">>().not.toMatchTypeOf<InventorySearchProps>();
});
