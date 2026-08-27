#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const {
  normalizeOfficialResultItem,
  normalizePreNormalizedMatch,
} = require("./extract_individual_matches");
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : __dirname;
function getEventArchiveDir(dataDir, source, kind = "raw") {
  const normalizedSource = String(source || "").trim().toLowerCase() === "ittf" ? "ittf" : "wtt";
  return path.join(dataDir, `${normalizedSource}-records${kind === "slim" ? "-slim" : ""}`);
}

const SOURCE_DIR = process.env.WTT_RECORDS_DIR
  ? path.resolve(process.env.WTT_RECORDS_DIR)
  : path.join(DATA_DIR, "wtt-records");
const ITTF_SOURCE_DIR = process.env.ITTF_RECORDS_DIR
  ? path.resolve(process.env.ITTF_RECORDS_DIR)
  : getEventArchiveDir(DATA_DIR, "ittf", "raw");
const OUTPUT_DIR = process.env.WTT_SLIM_RECORDS_DIR
  ? path.resolve(process.env.WTT_SLIM_RECORDS_DIR)
  : path.join(DATA_DIR, "wtt-records-slim");
const ITTF_OUTPUT_DIR = process.env.ITTF_SLIM_RECORDS_DIR
  ? path.resolve(process.env.ITTF_SLIM_RECORDS_DIR)
  : getEventArchiveDir(DATA_DIR, "ittf", "slim");

function readJsonArray(filePath) {
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return Array.isArray(parsed) ? parsed : [];
}

function cleanObject(value) {
  if (Array.isArray(value)) {
    return value.map(cleanObject).filter((entry) => entry !== undefined);
  }
  if (!value || typeof value !== "object") {
    return value === undefined ? undefined : value;
  }

  const result = {};
  for (const [key, entry] of Object.entries(value)) {
    const cleaned = cleanObject(entry);
    if (
      cleaned === undefined ||
      cleaned === null ||
      cleaned === "" ||
      (Array.isArray(cleaned) && cleaned.length === 0)
    ) {
      continue;
    }
    result[key] = cleaned;
  }
  return result;
}

function slimPlayer(player) {
  return cleanObject({
    id: player?.id,
    name: player?.name || player?.playerName,
    org: player?.org,
    orgCode: player?.orgCode,
    position: player?.position,
  });
}

function slimCompetitor(competitor) {
  return cleanObject({
    type: competitor?.type,
    id: competitor?.id,
    name: competitor?.name || competitor?.playerName || competitor?.competitorName || competitor?.competitiorName,
    org: competitor?.org,
    orgCode: competitor?.orgCode,
    irm: competitor?.irm,
    players: Array.isArray(competitor?.players) ? competitor.players.map(slimPlayer) : [],
  });
}

function slimSingle(single) {
  return cleanObject({
    order: single?.order,
    documentCode: single?.documentCode,
    description: single?.description,
    overallScore: single?.overallScore,
    resultStatus: single?.resultStatus,
    gameScores: single?.gameScores,
    competitors: Array.isArray(single?.competitors) ? single.competitors.map(slimCompetitor) : [],
    winnerOrg: single?.winnerOrg,
  });
}

function slimTeam(team) {
  return cleanObject({
    name: team?.name,
    org: team?.org,
    orgCode: team?.orgCode,
  });
}

function slimMatch(match) {
  const result = cleanObject({
    matchType: match?.matchType,
    id: match?.id,
    eventId: match?.eventId,
    documentCode: match?.documentCode,
    subEventType: match?.subEventType,
    categoryName: match?.categoryName,
    discipline: match?.discipline,
    gender: match?.gender,
    roundLabel: match?.roundLabel,
    roundKey: match?.roundKey,
    matchNumber: match?.matchNumber,
    description: match?.description,
    overallScore: match?.overallScore,
    resultStatus: match?.resultStatus,
    isParaClass: match?.isParaClass,
    source: match?.source,
  });
  result.teams = Array.isArray(match?.teams) ? match.teams.map(slimTeam) : [];
  result.singles = Array.isArray(match?.singles) ? match.singles.map(slimSingle) : [];
  result.competitors = Array.isArray(match?.competitors) ? match.competitors.map(slimCompetitor) : [];
  result.gameScores = Array.isArray(match?.gameScores) ? match.gameScores : [];
  return result;
}

function normalizeArchiveItem(item) {
  if (item && typeof item === "object" && typeof item.matchType === "string" && Array.isArray(item.competitors)) {
    return normalizePreNormalizedMatch(item);
  }
  return normalizeOfficialResultItem(item);
}

function listSourceFiles(args) {
  const explicit = args.filter((arg) => arg.endsWith(".json"));
  if (explicit.length > 0) {
    return explicit.map((arg) => path.resolve(arg));
  }
  return [SOURCE_DIR, ITTF_SOURCE_DIR]
    .filter((dirPath, index, dirs) => dirPath && dirs.indexOf(dirPath) === index && fs.existsSync(dirPath))
    .flatMap((dirPath) => fs.readdirSync(dirPath)
      .filter((fileName) => /^(?:TTE)?\d+\.json$/i.test(fileName))
      .map((fileName) => path.join(dirPath, fileName)))
    .sort((left, right) => path.basename(left).localeCompare(path.basename(right), "en", { numeric: true }));
}

function buildSlimRecord(sourcePath) {
  const payload = readJsonArray(sourcePath);
  const matches = payload
    .map(normalizeArchiveItem)
    .filter(Boolean)
    .map(slimMatch);
  const outputDir = /^TTE\d+\.json$/i.test(path.basename(sourcePath)) ? ITTF_OUTPUT_DIR : OUTPUT_DIR;
  const outputPath = path.join(outputDir, path.basename(sourcePath));
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  if (payload.length > 0 && matches.length === 0) {
    throw new Error(`slim conversion produced no matches for non-empty source: ${sourcePath}`);
  }
  const tempPath = `${outputPath}.tmp-${process.pid}`;
  fs.writeFileSync(tempPath, `${JSON.stringify(matches)}\n`, "utf8");
  fs.renameSync(tempPath, outputPath);
  return {
    sourcePath,
    outputPath,
    sourceBytes: fs.statSync(sourcePath).size,
    outputBytes: fs.statSync(outputPath).size,
    matchCount: matches.length,
  };
}

function main() {
  const files = listSourceFiles(process.argv.slice(2));
  let sourceTotal = 0;
  let outputTotal = 0;
  let matchTotal = 0;

  files.forEach((filePath) => {
    const result = buildSlimRecord(filePath);
    sourceTotal += result.sourceBytes;
    outputTotal += result.outputBytes;
    matchTotal += result.matchCount;
    console.log(`${path.basename(result.sourcePath)} ${result.matchCount} matches ${result.sourceBytes} -> ${result.outputBytes}`);
  });

  console.log(`total ${files.length} files ${matchTotal} matches ${sourceTotal} -> ${outputTotal}`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.stack || error.message || error);
    process.exit(1);
  }
}
