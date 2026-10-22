import { getHarvestAttempt, listHarvestAttempts, listHarvestItems, listHarvestLogs, listHarvestRuns, reviewHarvests } from "./harvest.js";
import { markersFrom, renderWorldMap } from "./map.js";
import { getPassport, listVocabulary, searchPlatforms, searchShips } from "./oceanops.js";
import { getQcAnomaly, listQcAnomalies, listQcOffenders, reviewQc, suggestQcFills } from "./qc.js";

const status = await listVocabulary({ vocabulary: "ptf-statuses", limit: 5 });
const platforms = await searchPlatforms({ wmoId: "2900314", limit: 1 });
const northAtlantic = await searchPlatforms({ region: "north-atlantic", limit: 1 });
const passport = await getPassport({ wmoId: "2900314" });
const ships = await searchShips({ name: "Marion", limit: 2 });

if (status.items.length === 0) throw new Error("vocabulary empty");
if (platforms.total < 1) throw new Error("platform search missed 2900314");
if (northAtlantic.total < 1000) throw new Error("north-atlantic region returned too few platforms");
if (!northAtlantic.byStatus?.some((status) => status.code === "operational" && status.total > 0)) {
  throw new Error("north-atlantic status counts missed operational platforms");
}
if (passport.summary.wmo !== "2900314") throw new Error("passport summary missing wmo");
if (!Array.isArray(ships.items) || ships.items.length === 0) throw new Error("ship name search empty");
if ("passport" in passport && passport.passport !== undefined) throw new Error("full passport was returned by default");

const markers = markersFrom(passport);
if (!markers.some((marker) => marker.kind === "deployment")) throw new Error("map missed deployment");
if (!markers.some((marker) => marker.kind === "latest")) throw new Error("map missed last position");
const png = await renderWorldMap(markers);
if (!png || !Buffer.from(png, "base64").subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
  throw new Error("world map was not a PNG");
}

const harvestRuns = await listHarvestRuns({ limit: 5 });
if (harvestRuns.items.length === 0) throw new Error("harvest runs empty");
const harvestDay = harvestRuns.items[0].startedAt.slice(0, 10);
const harvestReview = await reviewHarvests({ date: harvestDay });
if (harvestReview.runCount < 1) throw new Error("harvest review empty");
const harvestLogs = await listHarvestLogs({ runId: harvestRuns.items[0].id, limit: 3 });
if (harvestLogs.items.length === 0) throw new Error("harvest logs empty");

const failedRun = harvestReview.failures[0];
let harvestFailure: { runId: number; itemKey: string; attemptId?: number } | undefined;
if (failedRun) {
  const failedItems = await listHarvestItems({ runId: failedRun.runId, status: "FAILED", limit: 2 });
  if (failedItems.items.length === 0) throw new Error("harvest failed items empty");
  const item = failedItems.items[0];
  const attempts = await listHarvestAttempts({ runId: failedRun.runId, itemId: item.id, limit: 2 });
  if (attempts.items.length === 0) throw new Error("harvest attempts empty");
  const attempt = await getHarvestAttempt({ attemptId: attempts.items[0].id });
  if (!attempt.item) throw new Error("harvest attempt missing");
  harvestFailure = { runId: failedRun.runId, itemKey: item.itemKey, attemptId: attempts.items[0].id };
}

const qcReview = await reviewQc();
if (qcReview.anomalyCount < 1) throw new Error("qc review empty");
const qcList = await listQcAnomalies({ historyDays: 3 });
if (qcList.items.length === 0) throw new Error("qc anomalies empty");
const qcOne = await getQcAnomaly({ code: qcList.items[0].code, historyDays: 5 });
if (!qcOne.item.current) throw new Error("qc anomaly missing current count");

let qcOffenders: { total: number; proposed?: number; sample?: string } | { unavailable: string } = {
  unavailable: "not deployed",
};
try {
  const offenders = await listQcOffenders({ code: "programs_without_wigos_code", limit: 3 });
  if (offenders.items.length === 0 && offenders.total > 0) throw new Error("qc offenders page empty");
  const fills = await suggestQcFills({ code: "programs_without_wigos_code", limit: 3 });
  qcOffenders = {
    total: offenders.total,
    proposed: fills.proposed,
    sample: String(offenders.items[0]?.code ?? offenders.items[0]?.ref ?? ""),
  };
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (!/\b404\b/.test(message)) throw error;
}

console.log(
  JSON.stringify(
    {
      statuses: status.total,
      platform: platforms.items[0],
      passport: passport.summary,
      ships: ships.items,
      harvest: {
        day: harvestDay,
        runCount: harvestReview.runCount,
        byStatus: harvestReview.byStatus,
        failure: harvestFailure,
      },
      qc: {
        date: qcReview.date,
        anomalyCount: qcReview.anomalyCount,
        calculationErrors: qcReview.calculationErrors,
        rising: qcReview.rising,
        sample: qcOne.item.code,
        sampleValue: qcOne.item.current?.value,
        offenders: qcOffenders,
      },
    },
    null,
    2,
  ),
);
