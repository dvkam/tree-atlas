import { createHash } from "node:crypto";
import { deserialize } from "flatgeobuf/lib/mjs/geojson.js";
import proj4 from "proj4";

const projection =
  "+proj=laea +lat_0=52 +lon_0=10 +x_0=4321000 +y_0=3210000 +ellps=GRS80 +units=m +no_defs";
export const canopyWindow = [16.38, 48.2, 16.41, 48.22] as const;
type Position = [number, number];
type Polygon = { type: "Polygon"; coordinates: Position[][] };
type MultiPolygon = { type: "MultiPolygon"; coordinates: Position[][][] };
type CanopyFeature = {
  type: "Feature";
  id: string;
  geometry: Polygon | MultiPolygon;
  properties: { kind: "canopy"; referenceYear: 2021; sourceIndex: number };
};

function project(position: number[]): Position {
  const [x, y] = position;
  if (x === undefined || y === undefined || !Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error("Invalid canopy coordinate");
  }
  const [longitude, latitude] = proj4(projection, "EPSG:4326", [x, y]);
  if (
    longitude === undefined ||
    latitude === undefined ||
    !Number.isFinite(longitude) ||
    !Number.isFinite(latitude) ||
    Math.abs(longitude) > 180 ||
    Math.abs(latitude) > 90
  ) {
    throw new Error("Canopy projection produced invalid coordinates");
  }
  return [longitude, latitude];
}

function projectRing(ring: number[][]): Position[] {
  const first = ring[0];
  const last = ring.at(-1);
  if (
    ring.length < 4 ||
    first === undefined ||
    last === undefined ||
    first[0] !== last[0] ||
    first[1] !== last[1]
  ) {
    throw new Error("Expected a closed ring with at least four coordinates");
  }
  return ring.map(project);
}

/** Parse an official EPSG:3035 FGB; retain complete geometries whose envelopes overlap the pilot. */
export async function importCanopy(bytes: Uint8Array) {
  const checksum = createHash("sha256").update(bytes).digest("hex");
  let declaredCount: number | undefined;
  let visited = 0;
  const features: CanopyFeature[] = [];
  for await (const feature of deserialize(bytes, {
    headerMetaFn(header) {
      if (header.crs?.code !== 3035) throw new Error("Expected EPSG:3035 canopy file");
      declaredCount = header.featuresCount;
    },
  })) {
    visited += 1;
    const input = feature.geometry;
    let geometry: Polygon | MultiPolygon;
    if (input.type === "Polygon") {
      geometry = { type: "Polygon", coordinates: input.coordinates.map(projectRing) };
    } else if (input.type === "MultiPolygon") {
      geometry = {
        type: "MultiPolygon",
        coordinates: input.coordinates.map((polygon) => polygon.map(projectRing)),
      };
    } else {
      throw new Error(`Expected canopy polygon, received ${input.type}`);
    }
    const points =
      geometry.type === "Polygon" ? geometry.coordinates.flat() : geometry.coordinates.flat(2);
    if (points.length < 4) throw new Error("Empty canopy polygon");
    let west = Infinity;
    let east = -Infinity;
    let south = Infinity;
    let north = -Infinity;
    for (const [x, y] of points) {
      west = Math.min(west, x);
      east = Math.max(east, x);
      south = Math.min(south, y);
      north = Math.max(north, y);
    }
    if (
      east < canopyWindow[0] ||
      west > canopyWindow[2] ||
      north < canopyWindow[1] ||
      south > canopyWindow[3]
    )
      continue;
    features.push({
      type: "Feature",
      id: `copernicus-stl2021:${checksum.slice(0, 16)}:${visited}`,
      geometry,
      properties: { kind: "canopy", referenceYear: 2021, sourceIndex: visited },
    });
  }
  if (declaredCount === undefined || (declaredCount > 0 && declaredCount !== visited))
    throw new Error("Canopy file count mismatch");
  if (features.length === 0)
    throw new Error("No canopy polygons in pilot window; previous data retained");
  return {
    type: "FeatureCollection" as const,
    features,
    metadata: {
      sourceSha256: checksum,
      sourceFeatureCount: visited,
      importedFeatureCount: features.length,
      sourceCrs: "EPSG:3035",
      outputCrs: "EPSG:4326",
      window: canopyWindow,
      selection: "geometry-envelope overlap; complete polygons retained",
      identity: "release-scoped",
      referenceYear: 2021,
      transformations: ["reprojection", "spatial subset", "properties reduced"],
    },
  };
}
