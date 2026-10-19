export type OceanRegion = {
  name: string;
  locLatFrom: string;
  locLatTo: string;
  locLonFrom?: string;
  locLonTo?: string;
  note: string;
};

/** Latest-position boxes the public platform search can apply as one filter. */
export const REGIONS = {
  "north-atlantic": {
    name: "North Atlantic",
    locLatFrom: "0",
    locLatTo: "65",
    locLonFrom: "-80",
    locLonTo: "0",
    note: "Latest position from 0–65°N and 80°W–0°.",
  },
  "south-atlantic": {
    name: "South Atlantic",
    locLatFrom: "-60",
    locLatTo: "0",
    locLonFrom: "-70",
    locLonTo: "20",
    note: "Latest position from 60°S–0° and 70°W–20°E.",
  },
  mediterranean: {
    name: "Mediterranean",
    locLatFrom: "30",
    locLatTo: "46",
    locLonFrom: "-6",
    locLonTo: "36",
    note: "Latest position from 30–46°N and 6°W–36°E.",
  },
  "indian-ocean": {
    name: "Indian Ocean",
    locLatFrom: "-40",
    locLatTo: "30",
    locLonFrom: "20",
    locLonTo: "120",
    note: "Latest position from 40°S–30°N and 20–120°E.",
  },
  "western-north-pacific": {
    name: "Western North Pacific",
    locLatFrom: "0",
    locLatTo: "65",
    locLonFrom: "120",
    locLonTo: "180",
    note: "Latest position from 0–65°N and 120–180°E. This box stops at the date line.",
  },
  arctic: {
    name: "Arctic",
    locLatFrom: "66",
    locLatTo: "89",
    note: "Latest position north of 66°N, all longitudes.",
  },
  "southern-ocean": {
    name: "Southern Ocean",
    locLatFrom: "-80",
    locLatTo: "-60",
    note: "Latest position south of 60°S, all longitudes.",
  },
} as const satisfies Record<string, OceanRegion>;

export type RegionId = keyof typeof REGIONS;

export function regionBox(id: string): OceanRegion & { id: RegionId } {
  if (!(id in REGIONS)) {
    throw new Error(`Unknown region "${id}". Use one of: ${Object.keys(REGIONS).join(", ")}.`);
  }
  const regionId = id as RegionId;
  return { id: regionId, ...REGIONS[regionId] };
}

export function regionFilters(region: OceanRegion): Record<string, string> {
  const filters: Record<string, string> = {
    locLatFrom: region.locLatFrom,
    locLatTo: region.locLatTo,
  };
  if (region.locLonFrom) filters.locLonFrom = region.locLonFrom;
  if (region.locLonTo) filters.locLonTo = region.locLonTo;
  return filters;
}
