"use strict";

const ASTANA_FINAL_CODE = "TTEMSINGLES-----------FNL-000100----------";

function supplementVerifiedWttResults(eventId, matches) {
  if (String(eventId) !== "3254" || !Array.isArray(matches) ||
      matches.some(match => match.documentCode === ASTANA_FINAL_CODE)) return matches;

  // Both finalists must match the event's actual semifinals before adding the
  // final omitted by the result API. Scores come from WTT's linked final report.
  const finalists = ["132992", "114715"];
  const verifiedSemifinals = finalists.every((id, index) => matches.some(match =>
    String(match.eventId) === "3254" && match.categoryName === "Men Singles" &&
    match.documentCode === `TTEMSINGLES-----------SFNL000${index + 1}00----------` &&
    /^09\/20\/2026\b/.test(match.startDateLocal || "") &&
    match.competitors?.some(competitor => String(competitor.id) === id),
  ));
  if (!verifiedSemifinals) return matches;

  const competitor = (id, name, org, position) => ({
    type: position === 1 ? "H" : "A", id, name, org, orgCode: org,
    players: [{ id, name, org, orgCode: org, position }],
  });
  return [...matches, {
    matchType: "individual", eventId: "3254", documentCode: ASTANA_FINAL_CODE,
    subEventType: "Men Singles", categoryName: "Men Singles", discipline: "singles", gender: "men",
    roundLabel: "Final", roundKey: "final", matchNumber: 1,
    description: "Men's Singles - Final - Match 1", overallScore: "4-2",
    startDateLocal: "09/20/2026", teams: [], singles: [],
    competitors: [competitor("114715", "QIU Dang", "GER", 1), competitor("132992", "LEBRUN Alexis", "FRA", 2)],
    gameScores: ["6-11", "11-5", "5-11", "11-6", "11-6", "11-4"],
    recordSource: "wtt-official-report", sourceUrl: "https://www.worldtabletennis.com/description?artId=6620",
    sourceMatchUrl: `https://www.worldtabletennis.com/PostMatchCenter?eventId=3254&docCode=${ASTANA_FINAL_CODE}&type=official`,
    sourceWarnings: ["Result API omits this final; supplemented from WTT's official final report."],
  }];
}

module.exports = { supplementVerifiedWttResults, ASTANA_FINAL_CODE };
