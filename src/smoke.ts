import { getPassport, listVocabulary, searchPlatforms, searchShips } from "./oceanops.js";

const status = await listVocabulary({ vocabulary: "ptf-statuses", limit: 5 });
const platforms = await searchPlatforms({ wmoId: "2900314", limit: 1 });
const passport = await getPassport({ wmoId: "2900314" });
const ships = await searchShips({ name: "Marion", limit: 2 });

if (status.items.length === 0) throw new Error("vocabulary empty");
if (platforms.total < 1) throw new Error("platform search missed 2900314");
if (passport.summary.wmo !== "2900314") throw new Error("passport summary missing wmo");
if (!Array.isArray(ships.items) || ships.items.length === 0) throw new Error("ship name search empty");
if ("passport" in passport && passport.passport !== undefined) throw new Error("full passport was returned by default");

console.log(
  JSON.stringify(
    {
      statuses: status.total,
      platform: platforms.items[0],
      passport: passport.summary,
      ships: ships.items,
    },
    null,
    2,
  ),
);
