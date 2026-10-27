import { useEffect, useEffectEvent, useRef, useState } from "react";
import L from "leaflet";
import type { Bounds, Dataset } from "./domain.ts";
import type { MapItem, Summary } from "./index-format.ts";

import "leaflet/dist/leaflet.css";

type Props = {
  dataset: Dataset;
  markers: readonly MapItem[];
  aggregated: boolean;
  preview: boolean;
  loading: boolean;
  updating: boolean;
  selectedTree: Summary | null;
  canopy: boolean;
  area: Bounds | null;
  onSelect: (tree: Summary) => void;
  onViewport: (bounds: Bounds, zoom: number) => void;
  onArea: (bounds: Bounds) => void;
};

export function TreeMap({
  dataset,
  markers,
  aggregated,
  preview,
  loading,
  updating,
  selectedTree,
  canopy,
  area,
  onSelect,
  onArea,
  onViewport,
}: Props) {
  const host = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const visibleLayers = useRef(new Map<string, L.Layer>());
  const [canopyError, setCanopyError] = useState(false);
  const [basemapError, setBasemapError] = useState(false);
  const select = useEffectEvent(onSelect);
  const reportViewport = useEffectEvent(onViewport);
  const commitArea = useEffectEvent(onArea);
  const [mapMessage, setMapMessage] = useState("");
  const areaKey = area?.join(",") ?? "";

  useEffect(() => {
    if (host.current === null) return undefined;
    const map = L.map(host.current, {
      preferCanvas: true,
      scrollWheelZoom: true,
      zoomControl: true,
      maxZoom: 19,
      worldCopyJump: true,
    }).setView([48.207, 16.394], 15);
    mapRef.current = map;
    const layers = visibleLayers.current;
    map.on("moveend", () => {
      setMapMessage("");
      reportViewport(viewportBounds(map), map.getZoom());
    });
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
      layers.clear();
    };
  }, []);

  useEffect(() => {
    const parts =
      areaKey === "" ? (dataset.viewBounds ?? dataset.bounds) : areaKey.split(",").map(Number);
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
    if (map === null) return;
    const layers = visibleLayers.current;
    const next = new Set<string>();
    const compact = new Intl.NumberFormat("en", {
      notation: "compact",
      maximumFractionDigits: 1,
    });
    for (const item of markers) {
      // Cluster IDs are local to a filtered index. Include their rendered content and action.
      const key = `${dataset.release}:${JSON.stringify(item)}`;
      next.add(key);
      if (layers.has(key)) continue;
      if (item.kind === "cluster") {
        const label = document.createElement("span");
        label.className = "cluster-count";
        label.textContent = compact.format(item.count);
        const marker = L.marker([item.position[1], item.position[0]], {
          icon: L.divIcon({
            className: "inventory-cluster",
            html: label,
            iconSize: [44, 44],
            iconAnchor: [22, 22],
          }),
          title: `${item.count.toLocaleString("en")} records; zoom in`,
          keyboard: true,
        }).addTo(map);
        marker
          .getElement()
          ?.setAttribute("aria-label", `${item.count.toLocaleString("en")} records; zoom in`);
        marker.on("click", () => {
          const nextZoom = Math.min(19, Math.max(map.getZoom() + 1, item.zoom));
          map.setView([item.position[1], item.position[0]], nextZoom, { animate: false });
          if (nextZoom === 19) {
            setMapMessage(
              "At the closest map scale, some records share a position. The result list provides their individual details.",
            );
            commitArea(viewportBounds(map));
          }
        });
        layers.set(key, marker);
        continue;
      }
      const tree = item.tree;
      if (tree.position === null) continue;
      const marker = L.circleMarker([tree.position[1], tree.position[0]], {
        radius: 4,
        color: "#1e543c",
        fillColor: "#438a5e",
        fillOpacity: 0.8,
        weight: 1,
      });
      const label = document.createElement("span");
      label.textContent = tree.commonName ?? tree.scientificName ?? `Record ${tree.sourceId}`;
      marker.bindTooltip(label);
      marker.on("click", () => select(tree));
      marker.addTo(map);
      layers.set(key, marker);
    }
    for (const [key, layer] of layers) {
      if (!next.has(key)) {
        layer.remove();
        layers.delete(key);
      }
    }
  }, [markers, dataset.release]);

  useEffect(() => {
    const map = mapRef.current;
    if (map === null || selectedTree === null || selectedTree.position === null) return undefined;
    const position: L.LatLngTuple = [selectedTree.position[1], selectedTree.position[0]];
    const marker = L.circleMarker(position, {
      radius: 9,
      color: "#713e20",
      fillColor: "#efac60",
      fillOpacity: 1,
      weight: 3,
    }).addTo(map);
    if (!map.getBounds().contains(position)) map.panTo(position, { animate: false });
    return () => {
      marker.remove();
    };
  }, [selectedTree]);

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
    const map = mapRef.current;
    if (map !== null) onArea(viewportBounds(map));
  }

  return (
    <section
      className="map-panel"
      aria-label="Tree map"
      aria-busy={loading || updating}
      data-city={dataset.id}
      data-filter-ready={!preview}
      data-marker-count={markers.length}
    >
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
          <i className="coverage-line" /> Published extent
        </span>
        {canopy && (
          <span>
            <i className="canopy-swatch" /> Canopy · 2021
          </span>
        )}
      </div>
      {loading && (
        <output className="map-loading">Opening {dataset.city}… You can still move the map.</output>
      )}
      {!loading && preview && (
        <p className="cluster-hint">Unfiltered map · groups may extend beyond the view</p>
      )}
      {!loading && !preview && aggregated && (
        <p className="cluster-hint">Grouped records · zoom in to explore</p>
      )}
      {mapMessage !== "" && (
        <p className="map-message" aria-live="polite">
          {mapMessage}
        </p>
      )}
      {(basemapError || (canopy && canopyError)) && (
        <p className="map-alert" aria-live="polite">
          {basemapError ? "Street-map tiles could not load. " : ""}
          {canopy && canopyError ? "Canopy tiles could not load. " : ""}
          The record list can be used without map tiles.
        </p>
      )}
    </section>
  );
}

function viewportBounds(map: L.Map): Bounds {
  const bounds = map.getBounds();
  return [
    Math.max(-180, bounds.getWest()),
    Math.max(-85, bounds.getSouth()),
    Math.min(180, bounds.getEast()),
    Math.min(85, bounds.getNorth()),
  ];
}
