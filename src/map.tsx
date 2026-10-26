import { useEffect, useEffectEvent, useRef, useState } from "react";
import L from "leaflet";
import type { Bounds, Dataset, Tree } from "./domain.ts";
import { treeKey } from "./domain.ts";
import "leaflet/dist/leaflet.css";

type Props = {
  dataset: Dataset;
  trees: readonly Tree[];
  selected: string | null;
  canopy: boolean;
  area: Bounds | null;
  onSelect: (tree: Tree) => void;
  onArea: (bounds: Bounds) => void;
};

export function TreeMap({ dataset, trees, selected, canopy, area, onSelect, onArea }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const [canopyError, setCanopyError] = useState(false);
  const [basemapError, setBasemapError] = useState(false);
  const select = useEffectEvent(onSelect);
  const areaKey = area?.join(",") ?? "";

  useEffect(() => {
    if (host.current === null) return undefined;
    const map = L.map(host.current, {
      preferCanvas: true,
      scrollWheelZoom: true,
      zoomControl: true,
    }).setView([48.207, 16.394], 15);
    mapRef.current = map;
    const basemap = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    });
    basemap.on("loading", () => setBasemapError(false));
    basemap.on("tileerror", () => setBasemapError(true));
    basemap.addTo(map);
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(host.current);
    return () => {
      observer.disconnect();
      // Remove paths before their canvas renderer, so their final redraw is cancelled by map.remove().
      map.eachLayer((layer) => {
        if (layer instanceof L.Path) map.removeLayer(layer);
      });
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const parts = areaKey === "" ? dataset.bounds : areaKey.split(",").map(Number);
    const [w, s, e, n] = parts;
    if (w !== undefined && s !== undefined && e !== undefined && n !== undefined)
      mapRef.current?.fitBounds(
        [
          [s, w],
          [n, e],
        ],
        { animate: false, padding: areaKey === "" ? [25, 25] : [0, 0] },
      );
  }, [areaKey, dataset]);

  useEffect(() => {
    const map = mapRef.current;
    if (map === null) return undefined;
    const [w, s, e, n] = dataset.bounds;
    const bounds: L.LatLngBoundsExpression = [
      [s, w],
      [n, e],
    ];
    const outline = L.rectangle(bounds, {
      color: "#735f41",
      weight: 2,
      dashArray: "6 6",
      fill: false,
      interactive: false,
    }).addTo(map);
    return () => {
      outline.remove();
    };
  }, [dataset]);

  useEffect(() => {
    const map = mapRef.current;
    if (map === null) return undefined;
    const group = L.layerGroup().addTo(map);
    for (const tree of trees) {
      const active = treeKey(tree) === selected;
      const marker = L.circleMarker([tree.position[1], tree.position[0]], {
        radius: active ? 8 : 4,
        color: active ? "#713e20" : "#1e543c",
        fillColor: active ? "#efac60" : "#438a5e",
        fillOpacity: active ? 1 : 0.8,
        weight: active ? 3 : 1,
      });
      const label = document.createElement("span");
      label.textContent = tree.commonName ?? tree.scientificName ?? `Record ${tree.sourceId}`;
      marker.bindTooltip(label);
      marker.on("click", () => select(tree));
      marker.addTo(group);
    }
    return () => {
      group.remove();
    };
  }, [trees, selected]);

  useEffect(() => {
    const map = mapRef.current;
    if (map === null || !canopy) return undefined;
    const layer = L.tileLayer.wms("https://mapserver.dataspace.copernicus.eu/ogc", {
      layers: "UA_STL_2021_VECTOR",
      format: "image/png",
      transparent: true,
      version: "1.3.0",
      opacity: 0.55,
      attribution:
        'European Union’s Copernicus Land Monitoring Service information · <a href="https://land.copernicus.eu/en/products/urban-atlas/street-tree-layer-stl-2021">Street Tree Layer 2021</a>',
    });
    layer.on("tileerror", () => setCanopyError(true));
    layer.on("loading", () => setCanopyError(false));
    layer.addTo(map);
    return () => {
      layer.remove();
    };
  }, [canopy]);

  function searchArea() {
    const bounds = mapRef.current?.getBounds();
    if (bounds === undefined) return;
    onArea([bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()]);
  }

  return (
    <section className="map-panel" aria-label="Tree map">
      <div
        ref={host}
        className="map"
        aria-label="Interactive map. Use the result list for keyboard access to trees."
      />
      <button className="area-button" onClick={searchArea}>
        Search this area <span aria-hidden="true">↗</span>
      </button>
      <div className="map-key">
        <span>
          <i className="tree-dot" /> Inventory record
        </span>
        <span>
          <i className="coverage-line" /> Pilot boundary
        </span>
        {canopy && (
          <span>
            <i className="canopy-swatch" /> Canopy · 2021
          </span>
        )}
      </div>
      {(basemapError || (canopy && canopyError)) && (
        <p className="map-alert" aria-live="polite">
          {basemapError ? "Street-map tiles could not load. " : ""}
          {canopy && canopyError ? "Canopy tiles could not load. " : ""}
          Inventory records are still available.
        </p>
      )}
    </section>
  );
}
