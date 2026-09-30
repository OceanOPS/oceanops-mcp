import { clampLimit, clampOffset } from "./config.js";
import { oceanopsGet, oceanopsPost, OceanOpsError } from "./client.js";

const PLATFORM_FIELDS = [
  "ref",
  "name",
  "status",
  "program",
  "country",
  "wmoId",
  "wigosId",
  "family",
  "lastLocDate",
  "lastLocLat",
  "lastLocLon",
  "deplDate",
];

export const VOCABULARIES = {
  programs: "/vocab/programs",
  countries: "/vocab/countries",
  "ptf-statuses": "/vocab/ptf-statuses",
  "ptf-families": "/vocab/ptf-families",
  "goos-observing-networks": "/vocab/goos-observing-networks",
  "ship-statuses": "/vocab/ship-statuses",
  "ship-types": "/vocab/ship-types",
} as const;

export type Vocabulary = keyof typeof VOCABULARIES;

type Page<T> = { limit: number; offset: number; total: number; items: T[] };

type VocabItem = { id?: number; code?: string; name?: string; nameShort?: string };

type PlatformFilters = {
  wmoId?: string;
  wigosId?: string;
  ref?: string;
  exactRef?: string;
  internalId?: string;
  name?: string;
  statusCode?: string;
  programCode?: string;
  countryCode2?: string;
  networkCode?: string;
  deplDateFrom?: string;
  deplDateTo?: string;
  limit?: number;
  offset?: number;
};

export async function searchPlatforms(input: PlatformFilters) {
  const filters = await platformFilters(input);
  const limit = clampLimit(input.limit);
  const offset = clampOffset(input.offset);
  const page = await oceanopsPost<Page<Record<string, unknown>>>("/oceanjson/platforms/search", {
    filters,
    fields: PLATFORM_FIELDS,
    limit,
    offset,
    view: "flat",
  });
  return {
    limit,
    offset,
    total: page.total,
    filters,
    items: (page.items ?? []).map(trimPlatform),
  };
}

export async function getPlatform(input: { ptfId?: number; wmoId?: string; wigosId?: string; ref?: string }) {
  const filters: Record<string, string> = {};
  if (input.wmoId) filters.wmoId = input.wmoId;
  if (input.wigosId) filters.wigosId = input.wigosId;
  if (input.ref) filters.exactRef = input.ref;
  if (input.ptfId !== undefined && Object.keys(filters).length === 0) {
    const passport = await getPassport({ ptfId: input.ptfId, full: false });
    return { source: "passport-summary", ...passport };
  }
  const page = await oceanopsPost<Page<Record<string, unknown>>>("/oceanjson/platforms/search", {
    filters,
    fields: PLATFORM_FIELDS,
    limit: 2,
    offset: 0,
    view: "flat",
  });
  const items = (page.items ?? []).map(trimPlatform);
  if (items.length === 0) {
    throw new OceanOpsError("No platform matched that identifier.");
  }
  return { total: page.total, item: items[0], extraMatches: Math.max(0, (page.total ?? items.length) - 1) };
}

export async function getPassport(input: {
  ptfId?: number;
  wmoId?: string;
  wigosId?: string;
  internalId?: string;
  full?: boolean;
}) {
  const body: Record<string, unknown> = {
    paginationEnabled: true,
    limit: 1,
    offset: 0,
  };
  if (input.ptfId !== undefined) body.ptfIds = [input.ptfId];
  if (input.internalId) body.internalIds = [input.internalId];
  const filters: Record<string, string> = {};
  if (input.wmoId) filters.wmoId = input.wmoId;
  if (input.wigosId) filters.wigosId = input.wigosId;
  if (Object.keys(filters).length > 0) body.filters = filters;

  const page = await oceanopsPost<{
    items: Array<Record<string, unknown>>;
    total: number;
  }>("/passports/search", body);

  const item = page.items?.[0];
  if (!item) throw new OceanOpsError("No passport matched that identifier.");

  return {
    total: page.total,
    summary: summarizePassport(item),
    passport: input.full ? item.passport : undefined,
  };
}

export async function searchShips(input: {
  name?: string;
  imo?: string;
  type?: string;
  country?: string;
  status?: string;
  limit?: number;
  offset?: number;
}) {
  const limit = clampLimit(input.limit);
  const offset = clampOffset(input.offset);

  if (input.name && !input.imo && !input.type && !input.country && !input.status) {
    const matches = await oceanopsGet<Array<{ id: number; value: string }>>("/ships/search", {
      field: "name",
      q: input.name,
      limit,
    });
    return {
      mode: "name-search",
      limit,
      items: matches.slice(0, limit),
      note: "Name search returns ship id and name. Call again with imo for country, type, and status.",
    };
  }

  const page = await oceanopsGet<Page<Record<string, unknown>>>("/ships", {
    name: input.name,
    imo: input.imo,
    type: input.type,
    country: input.country,
    status: input.status,
    limit,
    offset,
  });
  return { mode: "list", limit, offset, total: page.total, items: page.items ?? [] };
}

export async function listVocabulary(input: { vocabulary: Vocabulary; q?: string; limit?: number; offset?: number }) {
  const path = VOCABULARIES[input.vocabulary];
  const limit = clampLimit(input.limit, 20);
  const offset = clampOffset(input.offset);
  const page = await oceanopsGet<Page<VocabItem>>(path, { q: input.q, limit, offset });
  return {
    vocabulary: input.vocabulary,
    limit,
    offset,
    total: page.total,
    items: (page.items ?? []).map((item) => ({
      id: item.id,
      code: item.code,
      name: item.name,
      nameShort: item.nameShort,
    })),
  };
}

async function platformFilters(input: PlatformFilters): Promise<Record<string, string>> {
  const filters: Record<string, string> = {};
  if (input.wmoId) filters.wmoId = input.wmoId;
  if (input.wigosId) filters.wigosId = input.wigosId;
  if (input.ref) filters.ref = input.ref;
  if (input.exactRef) filters.exactRef = input.exactRef;
  if (input.internalId) filters.internalId = input.internalId;
  if (input.name) filters.name = input.name;
  if (input.deplDateFrom) filters.deplDateFrom = input.deplDateFrom;
  if (input.deplDateTo) filters.deplDateTo = input.deplDateTo;
  if (input.statusCode) filters.status = String((await vocabByCode("/vocab/ptf-statuses", input.statusCode)).id);
  if (input.programCode) filters.programs = String((await vocabByCode("/vocab/programs", input.programCode)).id);
  if (input.countryCode2) filters.country = String((await vocabByCode("/vocab/countries", input.countryCode2)).id);
  if (input.networkCode) {
    filters.masterNetworks = String((await vocabByCode("/vocab/goos-observing-networks", input.networkCode)).id);
  }
  return filters;
}

async function vocabByCode(collection: string, code: string): Promise<VocabItem> {
  try {
    return await oceanopsGet<VocabItem>(`${collection}/${encodeURIComponent(code)}`);
  } catch (error) {
    if (error instanceof OceanOpsError && error.status === 404) {
      throw new OceanOpsError(
        `No ${collection} entry with code "${code}". Use list_vocabulary to find the code.`,
        404,
      );
    }
    throw error;
  }
}

function trimPlatform(row: Record<string, unknown>) {
  const { editable: _editable, deletable: _deletable, row_num: _rowNum, ...rest } = row;
  return rest;
}

function summarizePassport(item: Record<string, unknown>) {
  const passport = (item.passport ?? {}) as Record<string, any>;
  const sensors = (passport.hardware?.sensorSetups ?? []) as Array<{ variable?: { code?: string; name?: string } }>;
  const variables = [
    ...new Map(
      sensors
        .filter((sensor) => sensor.variable?.code)
        .map((sensor) => [sensor.variable!.code, { code: sensor.variable!.code, name: sensor.variable?.name }]),
    ).values(),
  ];
  const deployment = passport.operations?.deployment;
  return {
    ptfId: item.ptfId,
    version: item.version,
    cacheUpdatedAt: item.cacheUpdatedAt,
    schemaVersion: item.schemaVersion,
    reference: passport.identification?.reference,
    passportId: passport.identification?.passportId,
    category: passport.identification?.platformCategory,
    status: passport.status?.reportingStatus,
    latestObservation: passport.status?.latestObservation,
    wmo: passport.hardware?.platform?.asset?.wmo,
    model: passport.hardware?.platform?.asset?.model
      ? {
          code: passport.hardware.platform.asset.model.code,
          name: passport.hardware.platform.asset.model.name,
          type: passport.hardware.platform.asset.model.type?.name,
        }
      : undefined,
    variables,
    deployment: deployment
      ? {
          timestamp: deployment.timestamp,
          latitude: deployment.latitude,
          longitude: deployment.longitude,
          shipName: deployment.ship?.registration?.name,
          imo: deployment.ship?.hull?.imoNumber,
        }
      : undefined,
    endTimestamp: passport.operations?.endTimestamp,
    program: passport.affiliation?.supervisingProgram
      ? {
          id: passport.affiliation.supervisingProgram.id,
          code: passport.affiliation.supervisingProgram.code,
          name: passport.affiliation.supervisingProgram.name,
          country: passport.affiliation.supervisingProgram.country?.name,
        }
      : undefined,
    networks: passport.affiliation?.goosObservingNetworks,
    networkTags: passport.affiliation?.networkTags,
  };
}
