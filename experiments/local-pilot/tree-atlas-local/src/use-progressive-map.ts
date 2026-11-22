import { useEffect, useState } from "react";
import type { Dataset } from "./domain.ts";
import { openProgressiveMap } from "./progressive-map.ts";
import type { ProgressiveMapSession } from "./progressive-map.ts";

type MapState = { key: string; client: ProgressiveMapSession | null; error: string | null };
export function useProgressiveMap(base: string, dataset: Dataset) {
  const key = `${dataset.id}:${dataset.release}:${dataset.map?.sha256 ?? "none"}`;
  const [state, setState] = useState<MapState | null>(null);
  useEffect(() => {
    if (dataset.map === undefined) return undefined;
    const controller = new AbortController();
    let client: ProgressiveMapSession | null = null;
    void openProgressiveMap(base, dataset, controller.signal)
      .then((created) => {
        if (controller.signal.aborted) {
          created.dispose();
          return;
        }
        client = created;
        setState({ key, client, error: null });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setState({
            key,
            client: null,
            error: error instanceof Error ? error.message : "Map data could not load.",
          });
      });
    return () => {
      controller.abort();
      client?.dispose();
    };
  }, [base, dataset, key]);
  const current = state?.key === key ? state : null;
  return { key, client: current?.client ?? null, error: current?.error ?? null };
}
