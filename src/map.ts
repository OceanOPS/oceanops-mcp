import { createRequire } from "node:module";
import { geoEquirectangular, geoGraticule, geoPath } from "d3-geo";
import type { GeoPermissibleObjects } from "d3-geo";
import sharp from "sharp";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";

const require = createRequire(import.meta.url);

const WIDTH = 960;
const HEIGHT = 480;

export type MapMarker = {
  lat: number;
  lon: number;
  kind: "deployment" | "latest";
};

const KIND_COLOR = {
  deployment: "#e39b2b",
  latest: "#d64545",
} as const;

export function markersFrom(value: unknown): MapMarker[] {
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  const markers: MapMarker[] = [];

  const summary = record.summary;
  if (summary && typeof summary === "object") {
    const body = summary as Record<string, unknown>;
    pushPair(markers, body.latestObservation, "latest");
    pushPair(markers, body.deployment, "deployment");
  }

  const rows = Array.isArray(record.items) ? record.items : record.item ? [record.item] : [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const item = row as Record<string, unknown>;
    const point = coordinate(item.lastLocLat, item.lastLocLon);
    if (point) markers.push({ ...point, kind: "latest" });
  }

  return markers;
}

export async function renderWorldMap(markers: MapMarker[]): Promise<string | undefined> {
  if (markers.length === 0) return undefined;
  const png = await sharp(Buffer.from(worldSvg(markers))).png().toBuffer();
  return png.toString("base64");
}

function pushPair(markers: MapMarker[], source: unknown, kind: MapMarker["kind"]) {
  if (!source || typeof source !== "object") return;
  const point = source as Record<string, unknown>;
  const coord = coordinate(point.latitude, point.longitude);
  if (coord) markers.push({ ...coord, kind });
}

function coordinate(lat: unknown, lon: unknown): { lat: number; lon: number } | undefined {
  const latitude = asNumber(lat);
  let longitude = asNumber(lon);
  if (latitude === undefined || longitude === undefined) return undefined;
  if (latitude < -90 || latitude > 90) return undefined;
  if (longitude > 180) longitude -= 360;
  if (longitude < -180 || longitude > 180) return undefined;
  return { lat: latitude, lon: longitude };
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function worldSvg(markers: MapMarker[]): string {
  const topology = require("world-atlas/countries-110m.json") as Topology<{
    countries: GeometryCollection;
  }>;
  const land = feature(topology, topology.objects.countries) as GeoPermissibleObjects;
  const projection = geoEquirectangular()
    .scale(WIDTH / (2 * Math.PI))
    .translate([WIDTH / 2, HEIGHT / 2]);
  const path = geoPath(projection);
  const landPath = path(land) ?? "";
  const graticulePath = path(geoGraticule().step([30, 30])()) ?? "";

  const dots = markers
    .map((marker) => {
      const xy = projection([marker.lon, marker.lat]);
      if (!xy) return "";
      const [x, y] = xy;
      return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="6" fill="${KIND_COLOR[marker.kind]}" stroke="#ffffff" stroke-width="2"/>`;
    })
    .join("");

  const legend = legendEntries(markers)
    .map(
      (entry, index) =>
        `<circle cx="24" cy="${28 + index * 22}" r="6" fill="${entry.color}" stroke="#ffffff" stroke-width="2"/>` +
        `<text x="38" y="${32 + index * 22}" fill="#163044" font-family="sans-serif" font-size="14">${entry.label}</text>`,
    )
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <rect width="${WIDTH}" height="${HEIGHT}" fill="#d5e4ef"/>
  <path d="${graticulePath}" fill="none" stroke="#b7c9d6" stroke-width="0.6"/>
  <path d="${landPath}" fill="#e7efe4" stroke="#8aa0a8" stroke-width="0.6"/>
  ${dots}
  ${legend}
</svg>`;
}

function legendEntries(markers: MapMarker[]): Array<{ label: string; color: string }> {
  const kinds = new Set(markers.map((marker) => marker.kind));
  const entries: Array<{ label: string; color: string }> = [];
  if (kinds.has("deployment")) entries.push({ label: "Deployment", color: KIND_COLOR.deployment });
  if (kinds.has("latest")) entries.push({ label: "Last position", color: KIND_COLOR.latest });
  return entries;
}
