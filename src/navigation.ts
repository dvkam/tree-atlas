import { useNavigate, useSearch } from "@tanstack/react-router";
import { boundsSchema, datasetIdSchema } from "./domain.ts";
import type { Bounds, DatasetId } from "./domain.ts";

export type ViewState = {
  city: DatasetId;
  q: string;
  area: Bounds | null;
  tree: string | null;
  release: string | null;
  canopy: boolean;
};

export function parseView(raw: Record<string, unknown>): ViewState {
  const city = datasetIdSchema.safeParse(raw["city"]);
  const area = boundsSchema.safeParse(
    typeof raw["area"] === "string" ? raw["area"].split(",").map(Number) : null,
  );
  return {
    city: city.success ? city.data : "vienna",
    q: typeof raw["q"] === "string" ? raw["q"].slice(0, 160) : "",
    area: area.success ? area.data : null,
    tree: typeof raw["tree"] === "string" ? raw["tree"].slice(0, 200) : null,
    release:
      typeof raw["release"] === "string" && /^[a-zA-Z0-9-]+$/u.test(raw["release"])
        ? raw["release"]
        : null,
    canopy: raw["canopy"] === "1",
  };
}

export function viewParams(view: ViewState): Record<string, string> {
  const params: Record<string, string> = { city: view.city };
  if (view.q !== "") params["q"] = view.q;
  if (view.area !== null) params["area"] = view.area.join(",");
  if (view.tree !== null) params["tree"] = view.tree;
  if (view.release !== null) params["release"] = view.release;
  if (view.canopy) params["canopy"] = "1";
  return params;
}

export function useView(): [ViewState, (next: ViewState) => void] {
  const raw = useSearch({ strict: false });
  const navigate = useNavigate();
  return [
    parseView(raw),
    (next) => {
      void navigate({ to: "/", search: viewParams(next) });
    },
  ];
}
