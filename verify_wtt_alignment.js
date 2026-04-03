#!/usr/bin/env node

const {
  getProcessedMatches,
} = require("./extract_individual_matches");

const SUBEVENTS_API_URL = "https://liveeventsapi.worldtabletennis.com/api/cms/GetAllLiveOrActiveSubEventsDetails";
const EVENT_NAME_API_URL = "https://liveeventsapi.worldtabletennis.com/api/cms/GetEventName";
const API_HEADERS = {
  accept: "application/json, text/plain, */*",
  origin: "https://www.worldtabletennis.com",
  referer: "https://www.worldtabletennis.com/",
  "user-agent": "Mozilla/5.0 (compatible; Codex/1.0)",
  secapimkey: "S_WTT_882jjh7basdj91834783mds8j2jsd81",
};

function parseArgs(argv) {
  const args = { event: null, take: 1200 };
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if ((current === "--event" || current === "-e") && argv[index + 1]) {
      args.event = argv[index + 1];
      index += 1;
      continue;
    }
    if (current === "--take" && argv[index + 1]) {
      args.take = Number(argv[index + 1]) || args.take;
      index += 1;
    }
  }
  return args;
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: API_HEADERS });
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

async function fetchEventName(eventId) {
  try {
    const payload = await fetchJson(`${EVENT_NAME_API_URL}/${encodeURIComponent(eventId)}`);
    return typeof payload === "string" ? payload : payload?.eventName || null;
  } catch {
    return null;
  }
}

async function fetchSubevents(eventId) {
  const payload = await fetchJson(`${SUBEVENTS_API_URL}/${encodeURIComponent(eventId)}`);
  return Array.isArray(payload) ? payload : [];
}

function getRoundBucket(roundKey) {
  if (
    roundKey === "round_of_128" ||
    roundKey === "round_of_64" ||
    roundKey === "round_of_32" ||
    roundKey === "round_of_16" ||
    roundKey === "quarterfinal" ||
    roundKey === "semifinal" ||
    roundKey === "final"
  ) {
    return "knockout";
  }
  if (
    roundKey === "group" ||
    String(roundKey || "").startsWith("group ") ||
    String(roundKey || "").endsWith("_group")
  ) {
    return "group";
  }
  if (
    roundKey === "preliminary_round" ||
    String(roundKey || "").startsWith("qualifying_round_") ||
    String(roundKey || "").includes("qualification")
  ) {
    return "qualifying";
  }
  return "other";
}

function buildCategoryReport(matches) {
  const rounds = [...new Set(matches.map((match) => match.roundLabel).filter(Boolean))];
  const buckets = new Set(matches.map((match) => getRoundBucket(match.roundKey)));
  return {
    matches: matches.length,
    rounds,
    hasKnockout: buckets.has("knockout"),
    hasGroup: buckets.has("group"),
    hasQualifying: buckets.has("qualifying"),
    hasOther: buckets.has("other"),
  };
}

function compareSets(leftValues, rightValues) {
  const left = new Set(leftValues);
  const right = new Set(rightValues);
  return {
    onlyLeft: [...left].filter((value) => !right.has(value)),
    onlyRight: [...right].filter((value) => !left.has(value)),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.event) {
    throw new Error("--event is required");
  }

  const [eventName, subevents, processed] = await Promise.all([
    fetchEventName(args.event),
    fetchSubevents(args.event),
    getProcessedMatches({ event: args.event, take: args.take }),
  ]);

  const nonParaMatches = processed.normalized.filter((match) => !match.isParaClass);
  const sourceCategories = [...new Set(subevents.map((item) => item.subEventName).filter(Boolean))];
  const appCategories = [...new Set(nonParaMatches.map((match) => match.categoryName).filter(Boolean))];
  const categoryDiff = compareSets(sourceCategories, appCategories);

  const perCategory = sourceCategories.map((categoryName) => {
    const sourceMatches = nonParaMatches.filter((match) => match.categoryName === categoryName);
    const report = buildCategoryReport(sourceMatches);
    return {
      categoryName,
      sourceSubevent: subevents.find((item) => item.subEventName === categoryName) || null,
      ...report,
      suspicious: [
        report.hasGroup && report.hasKnockout ? "group_and_knockout_mixed" : null,
        report.hasOther ? "unknown_round_bucket" : null,
        report.matches === 0 ? "listed_but_no_matches" : null,
      ].filter(Boolean),
    };
  });

  const suspiciousCategories = perCategory.filter((item) => item.suspicious.length > 0);

  console.log(`# WTT Alignment Check`);
  console.log(`eventId: ${args.event}`);
  if (eventName) {
    console.log(`eventName: ${eventName}`);
  }
  console.log(`subevents_in_wtt: ${sourceCategories.length}`);
  console.log(`categories_in_app: ${appCategories.length}`);
  console.log("");

  console.log(`## Category Diff`);
  console.log(`only_in_wtt: ${categoryDiff.onlyLeft.length ? categoryDiff.onlyLeft.join(" | ") : "-"}`);
  console.log(`only_in_app: ${categoryDiff.onlyRight.length ? categoryDiff.onlyRight.join(" | ") : "-"}`);
  console.log("");

  console.log(`## Suspicious Categories`);
  if (!suspiciousCategories.length) {
    console.log("-");
  } else {
    for (const item of suspiciousCategories) {
      console.log(`- ${item.categoryName}: ${item.suspicious.join(", ")}`);
      console.log(`  rounds: ${item.rounds.join(" | ") || "-"}`);
      console.log(`  matches: ${item.matches}`);
    }
  }
  console.log("");

  console.log(`## Category Summary`);
  for (const item of perCategory) {
    const drawType = item.sourceSubevent?.subEventDrawTypeId || "-";
    console.log(`- ${item.categoryName}`);
    console.log(`  drawType: ${drawType}`);
    console.log(`  matches: ${item.matches}`);
    console.log(`  rounds: ${item.rounds.join(" | ") || "-"}`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
