"use strict";

const BASE_URL = "https://results.ettu.site/index.php";
const LISTS = {
  singles: { listId: 14, itemId: 114, yearField: "vw_ec_indv___yr", title: "singles" },
  doubles: { listId: 15, itemId: 115, yearField: "vw_ec_indv___yr", title: "doubles" },
  team: { listId: 29, itemId: 116, yearField: "vw_ec_teams___yr", title: "team" },
};
const PAGE_SIZE = 100;

function assert(condition, message) {
  if (!condition) throw new Error(`ETTU archive: ${message}`);
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&#x([\da-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function textOnly(value) {
  return decodeHtml(String(value || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ")).trim();
}

function archiveConfig(config) {
  assert(config && typeof config === "object", "event config is required");
  const type = String(config.type || "").toLowerCase();
  assert(LISTS[type], `unsupported archive type ${type || "(missing)"}`);
  const year = String(config.year || "");
  assert(/^\d{4}$/.test(year), "a four-digit archive year is required");
  assert(String(config.eventId || "").trim(), "verified eventId is required");
  assert(String(config.eventName || "").trim(), "verified eventName is required");
  for (const key of ["startDate", "endDate"]) {
    if (config[key] != null) assert(/^\d{4}-\d{2}-\d{2}$/.test(String(config[key])), `${key} must be YYYY-MM-DD or null`);
  }
  if (config.startDate && config.endDate) assert(config.startDate <= config.endDate, "startDate is after endDate");
  return { ...config, type, year, eventId: String(config.eventId), eventName: String(config.eventName).trim() };
}

function listUrl(type, year, start = 0) {
  const list = LISTS[type];
  const params = new URLSearchParams({
    option: "com_fabrik",
    view: "list",
    listid: String(list.listId),
    Itemid: String(list.itemId),
    resetfilters: "1",
    [`${list.yearField}[value]`]: String(year),
    [`limit${list.listId}`]: String(PAGE_SIZE),
    [`limitstart${list.listId}`]: String(start),
  });
  return `${BASE_URL}?${params}`;
}

function parseYears(html, type) {
  const field = LISTS[type]?.yearField;
  assert(field, `unsupported archive type ${type}`);
  const select = String(html).match(new RegExp(`<select\\b(?=[^>]*data-filter-name=["']${field}["'])[^>]*>[\\s\\S]*?<\\/select>`, "i"));
  assert(select, `year filter ${field} was not found`);
  const years = [...select[0].matchAll(/<option\b[^>]*value=["'](\d{4})["']/gi)].map((match) => match[1]);
  assert(years.length > 0 && new Set(years).size === years.length, `invalid year options for ${type}`);
  return years;
}

function parseTotal(html) {
  const match = String(html).match(/\bTotal:\s*([\d,]+)/i);
  assert(match, "advertised Total was missing");
  return Number(match[1].replace(/,/g, ""));
}

function parseRows(html, listId, fields) {
  const rows = [];
  const rowPattern = new RegExp(`<tr\\b[^>]*id=["']list_${listId}_com_fabrik_${listId}_row_(\\d+)["'][^>]*>([\\s\\S]*?)<\\/tr>`, "gi");
  for (const rowMatch of String(html).matchAll(rowPattern)) {
    const cells = {};
    const cellPattern = /<td\b[^>]*class=["']([^"']+)["'][^>]*>([\s\S]*?)<\/td>/gi;
    for (const cell of rowMatch[2].matchAll(cellPattern)) {
      const fieldMatch = cell[1].match(/(?:^|\s)(vw_[a-z0-9_]+___[a-z0-9_]+)(?:\s|$)/i);
      if (fieldMatch) cells[fieldMatch[1]] = textOnly(cell[2]);
    }
    const links = [...rowMatch[2].matchAll(/<a\b([^>]*\btitle=["']Individual Matches Results["'][^>]*)>/gi)];
    const detailHref = links[0]?.[1].match(/\bhref=["']([^"']+)["']/i)?.[1] || null;
    rows.push({ id: rowMatch[1], cells, detailHref: detailHref ? decodeHtml(detailHref) : null });
  }
  return rows;
}

function parseName(value, fallbackOrg) {
  const name = String(value || "").trim();
  if (!name) return { id: null, name: "", org: "", orgCode: "", position: null };
  const match = name.match(/^(.*?)\s*\(([A-Z]{3})\)\s*$/);
  return { id: null, name: (match?.[1] || name).trim(), org: match?.[2] || fallbackOrg || "", orgCode: match?.[2] || fallbackOrg || "", position: null };
}

function parseGames(value, { allowPartialFinalGame = false } = {}) {
  const raw = String(value || "").trim();
  if (!raw) return [];
  const games = [];
  const partialScores = [];
  const tokens = raw.split(/\s+/).filter((token) => token && token !== ":");
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const match = token.match(/^(\d+):(\d+)$/);
    assert(match, `malformed game token ${token}`);
    const left = Number(match[1]);
    const right = Number(match[2]);
    const high = Math.max(left, right);
    const low = Math.min(left, right);
    const validScore = (high === 11 && low <= 9) || (high > 11 && high < 21 && high - low === 2)
      || (high === 21 && low <= 19) || (high > 21 && high - low === 2);
    if (!validScore && allowPartialFinalGame && index === tokens.length - 1) {
      partialScores.push(`${left}-${right}`);
      continue;
    }
    assert(validScore, `invalid game score ${token}`);
    games.push(`${left}-${right}`);
  }
  Object.defineProperty(games, "partialScores", { value: partialScores, enumerable: false });
  return games;
}

function parseResult(value, other) {
  const left = String(value ?? "").trim();
  const right = String(other ?? "").trim();
  for (const side of [left, right]) assert(!side || /^\d+$/.test(side), `invalid set result ${side}`);
  if (!left || !right) return { score: null, missing: true, sets: [left ? Number(left) : null, right ? Number(right) : null] };
  return { score: `${Number(left)}-${Number(right)}`, missing: false, sets: [Number(left), Number(right)] };
}

function hasPlausibleTerminalSetScore(score, { bestOfFiveOnly = false } = {}) {
  const [left, right] = score.split("-").map(Number);
  const winner = Math.max(left, right);
  const loser = Math.min(left, right);
  return (winner === 3 && loser < 3) || (!bestOfFiveOnly && winner === 4 && loser < 4);
}

function isWalkover(...values) {
  return values.some((value) => /^(?:wo|w\/o|walkover|walk over)$/i.test(String(value || "").trim()));
}

function officialStatus(...values) {
  const marker = values.map((value) => String(value || "").trim()).find((value) => value && !["-", "0", "N/A"].includes(value.toUpperCase()));
  if (!marker) return null;
  const normalized = marker.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const statuses = {
    WO: "WO", WALKOVER: "WO",
    DQ: "DQ", DISQUALIFIED: "DQ", RET: "RET", RETIREMENT: "RET",
    DEF: "DEF", DEFAULT: "DEF", DNS: "DNS", ABN: "ABN",
  };
  assert(statuses[normalized], `unsupported official result status ${marker}`);
  return statuses[normalized];
}

function isUnplayedPlaceholder(row, prefix) {
  const cells = row.cells || {};
  if (officialStatus(cells[`${prefix}___wo`], cells[`${prefix}___wo_a`], cells[`${prefix}___wo_x`])) return false;
  const scores = String(cells[`${prefix}___games`] || "").match(/\d+:\d+/g) || [];
  const result = parseResult(cells[`${prefix}___res_a`], cells[`${prefix}___res_x`]);
  const nameKeys = prefix === "vw_teams_indv_res"
    ? ["name_a", "name_b", "name_x", "name_y"]
    : ["player_id_a", "player_id_b", "player_id_x", "player_id_y"];
  const hasNamedParticipant = nameKeys.some((key) => String(cells[`${prefix}___${key}`] || "").trim());
  return scores.length > 0 && scores.every((score) => score === "0:0")
    && !hasNamedParticipant
    && (result.missing || result.score === "0-0");
}

function missingRecordFields(record, row, prefix, type) {
  const missingFields = [];
  const nameKeys = prefix === "vw_teams_indv_res"
    ? ["name_a", "name_x"]
    : type === "doubles" ? ["player_id_a", "player_id_b", "player_id_x", "player_id_y"] : ["player_id_a", "player_id_x"];
  for (const key of nameKeys) if (!String(row.cells[`${prefix}___${key}`] || "").trim()) missingFields.push(`${prefix}___${key}`);
  if (record.resultOutcomeMissing) missingFields.push("resultOutcome");
  if (record.scoreDetailMissing) missingFields.push("gameScores");
  return missingFields;
}

function recordWarning(record, row, config, prefix, type, teamRowId = null) {
  const missingFields = missingRecordFields(record, row, prefix, type);
  if (!missingFields.length) return null;
  return {
    eventId: config.eventId,
    year: config.year,
    type: config.type,
    sourceRowId: String(row.id),
    rowUrl: row.sourceUrl || null,
    ...(teamRowId ? { teamRowId: String(teamRowId) } : {}),
    missingFields,
  };
}

function sourceRowDetails(row, prefix, type = "singles") {
  const cells = row.cells || {};
  const leftKeys = prefix === "vw_teams_indv_res" ? ["name_a", "name_b"] : type === "doubles" ? ["player_id_a", "player_id_b"] : ["player_id_a"];
  const rightKeys = prefix === "vw_teams_indv_res" ? ["name_x", "name_y"] : type === "doubles" ? ["player_id_x", "player_id_y"] : ["player_id_x"];
  return {
    players: {
      left: leftKeys.map((key) => cells[`${prefix}___${key}`]).filter(Boolean),
      right: rightKeys.map((key) => cells[`${prefix}___${key}`]).filter(Boolean),
    },
    declaredSetScore: [cells[`${prefix}___res_a`], cells[`${prefix}___res_x`]].filter((value) => value != null && value !== "").join("-"),
    rawGames: cells[`${prefix}___games`] ?? null,
    officialStatus: [cells[`${prefix}___wo`], cells[`${prefix}___wo_a`], cells[`${prefix}___wo_x`]].filter(Boolean).join(" / ") || null,
  };
}

function category(event, type) {
  const label = String(event || "").trim();
  const gender = /women/i.test(label) ? "women" : /men/i.test(label) ? "men" : /mixed/i.test(label) ? "mixed" : null;
  assert(gender, `unrecognized event category ${label || "(empty)"}`);
  if (type === "team") return { categoryName: `${gender === "women" ? "Women" : gender === "mixed" ? "Mixed" : "Men"} Teams`, discipline: "teams", gender };
  const discipline = type === "doubles" || /doubles/i.test(label) ? "doubles" : "singles";
  const genderLabel = gender === "women" ? "Women" : gender === "mixed" ? "Mixed" : "Men";
  return { categoryName: `${genderLabel} ${discipline === "doubles" ? "Doubles" : "Singles"}`, discipline, gender };
}

function normalizeRound(value) {
  const roundLabel = String(value || "").trim();
  const normalized = roundLabel.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  const code = normalized.toUpperCase().replace(/\s+/g, "");
  const archiveRound = {
    R256: ["Round of 256", "round_of_256"], R128: ["Round of 128", "round_of_128"],
    R64: ["Round of 64", "round_of_64"], R32: ["Round of 32", "round_of_32"],
    R16: ["Round of 16", "round_of_16"], R8: ["Quarterfinal", "quarterfinal"],
    QF: ["Quarterfinal", "quarterfinal"], SF: ["Semifinal", "semifinal"], F: ["Final", "final"],
  }[code];
  if (archiveRound) return { roundLabel: archiveRound[0], roundKey: archiveRound[1] };
  const match = normalized.match(/round of (256|128|64|32|16|8)|quarter ?final|semi ?final|\bfinal\b/);
  if (!match) return { roundLabel: roundLabel || "Unknown", roundKey: normalized.replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "unknown" };
  const token = match[0];
  if (/quarter/.test(token) || token === "round of 8") return { roundLabel: "Quarterfinal", roundKey: "quarterfinal" };
  if (/semi/.test(token)) return { roundLabel: "Semifinal", roundKey: "semifinal" };
  if (token === "final") return { roundLabel: "Final", roundKey: "final" };
  const size = token.match(/\d+/)[0];
  return { roundLabel: `Round of ${size}`, roundKey: `round_of_${size}` };
}

function metadata(config, type, sourceRowId) {
  const base = listUrl(type, config.year, 0).split("&limit")[0];
  return {
    eventId: config.eventId,
    recordEventId: config.eventId,
    recordEventName: config.eventName,
    recordStartDate: config.startDate || null,
    recordEndDate: config.endDate || null,
    recordYear: config.year,
    recordUrl: base,
    sourceRowId: String(sourceRowId),
    source: "wtt",
    recordSource: "ettu",
  };
}

function normalizeIndividualRow(row, config, { prefix = "vw_ec_indv", type = config.type, teamContext = null } = {}) {
  const cells = row.cells;
  const info = teamContext?.info || category(cells[`${prefix}___event`], type);
  if (!teamContext) assert(String(cells[`${prefix}___yr`] || "") === config.year, `row ${row.id} year does not match ${config.year}`);
  const round = normalizeRound(cells[`${prefix}___rnd`] || "");
  const left = [];
  const right = [];
  if (teamContext) {
    left.push(parseName(cells[`${prefix}___name_a`], teamContext.context.teams[0].orgCode));
    right.push(parseName(cells[`${prefix}___name_x`], teamContext.context.teams[1].orgCode));
  } else if (type === "doubles") {
    for (const key of ["player_id_a", "player_id_b"]) left.push(parseName(cells[`${prefix}___${key}`]));
    for (const key of ["player_id_x", "player_id_y"]) right.push(parseName(cells[`${prefix}___${key}`]));
  } else {
    left.push(parseName(cells[`${prefix}___player_id_a`]));
    right.push(parseName(cells[`${prefix}___player_id_x`]));
  }
  const playersPerSide = info.discipline === "doubles" ? 2 : 1;
  assert(left.length === playersPerSide && right.length === playersPerSide, `row ${row.id} has invalid participant slots`);
  const resultStatus = officialStatus(cells[`${prefix}___wo`], cells[`${prefix}___wo_a`], cells[`${prefix}___wo_x`]);
  const parsedResult = parseResult(cells[`${prefix}___res_a`], cells[`${prefix}___res_x`]);
  const setScore = parsedResult.score;
  const rawGameScores = String(cells[`${prefix}___games`] ?? "");
  let parsedGames;
  let gameScoreParseError = null;
  try {
    parsedGames = resultStatus === "WO" ? [] : parseGames(rawGameScores, { allowPartialFinalGame: Boolean(resultStatus) });
  } catch (error) {
    if (resultStatus) throw error;
    parsedGames = [];
    gameScoreParseError = error;
  }
  const isWo = resultStatus === "WO";
  let gameScores = isWo ? [] : parsedGames;
  let scoreDetailMissing = false;
  if (gameScoreParseError && (!setScore || setScore === "0-0") && !/^(?:0:0|\s|:)*$/.test(rawGameScores)) {
    throw gameScoreParseError;
  }
  if (!resultStatus && setScore && setScore !== "0-0") {
    const declared = setScore.split("-").map(Number);
    const expectedGameCount = declared[0] + declared[1];
    const observedGameWins = gameScores.reduce((wins, score) => {
      const [a, x] = score.split("-").map(Number);
      wins[a > x ? 0 : 1] += 1;
      return wins;
    }, [0, 0]);
    const pointDetailsIncomplete = gameScoreParseError || gameScores.length === 0 || (
      gameScores.length < expectedGameCount
      && observedGameWins[0] <= declared[0]
      && observedGameWins[1] <= declared[1]
    );
    if (pointDetailsIncomplete) {
      assert(hasPlausibleTerminalSetScore(setScore, { bestOfFiveOnly: Boolean(teamContext) }), `row ${row.id} has incomplete game scores and no plausible terminal set result ${setScore}`);
      scoreDetailMissing = true;
      gameScores = [];
    } else {
      assert(observedGameWins[0] === declared[0] && observedGameWins[1] === declared[1], `row ${row.id} game wins ${observedGameWins.join("-")} disagree with declared result ${setScore}`);
    }
  }
  const declaredSets = parsedResult.sets;
  const outcomeMissing = parsedResult.missing || setScore === "0-0";
  if (setScore === "0-0" && gameScores.length) {
    assert(false, `row ${row.id} point games contradict declared result 0-0`);
  }
  if (setScore === "0-0" && !gameScores.length && !resultStatus) scoreDetailMissing = true;
  const woWinnerKnown = isWo && !outcomeMissing && declaredSets[0] !== declaredSets[1] && Math.max(...declaredSets) > 0;
  const result = {
    matchType: "individual",
    id: String(row.id),
    documentCode: `ETTU-ARCHIVE-${config.year}-${config.type}-${row.id}`,
    ...metadata(config, config.type, row.id),
    subEventType: teamContext ? `${teamContext.context.event} - ${teamContext.context.stage || "Team stage"}` : cells[`${prefix}___event`],
    ...info,
    roundLabel: teamContext ? teamContext.roundLabel : round.roundLabel,
    roundKey: teamContext ? teamContext.roundKey : round.roundKey,
    matchNumber: null,
    description: `${info.categoryName} - ${teamContext ? teamContext.roundLabel : round.roundLabel}`,
    venue: null,
    table: null,
    overallScore: isWo && woWinnerKnown ? (declaredSets[0] > declaredSets[1] ? "W-L" : "L-W") : setScore,
    resultStatus: resultStatus || "1",
    isParaClass: false,
    teams: [],
    singles: [],
    competitors: [left, right].map((players, side) => {
      const first = players[0];
      const orgs = [...new Set(players.map((player) => player.orgCode).filter(Boolean))];
      return {
        type: info.discipline === "singles" ? "player" : "pair",
        id: null,
        name: players.map((player) => player.name).join(" / "),
        org: players.every((player) => !player.name) ? "" : orgs.length === 1 ? orgs[0] : "",
        orgCode: players.every((player) => !player.name) || !orgs.length ? null : orgs.join("/"),
        irm: woWinnerKnown && declaredSets[side] < declaredSets[1 - side] ? "WO" : null,
        players: players.map((player, index) => ({ ...player, position: index + 1 })),
        ...(players.every((player) => !player.name) ? { participantDetailMissing: true } : {}),
      };
    }),
    gameScores,
    date: null,
    startDateLocal: null,
    startDateUtc: null,
  };
  if (teamContext) result.recordTeamContext = teamContext.context;
  if (left.some((player) => !player.name) || right.some((player) => !player.name)) result.participantDetailMissing = true;
  if (outcomeMissing) result.resultOutcomeMissing = true;
  if (parsedResult.missing) result.rawSetScores = {
    left: cells[`${prefix}___res_a`] ?? null,
    right: cells[`${prefix}___res_x`] ?? null,
  };
  if (scoreDetailMissing) result.scoreDetailMissing = true;
  if (scoreDetailMissing || outcomeMissing) result.rawGameScores = rawGameScores;
  if (!isWo && parsedGames.partialScores?.length) result.partialGameScores = parsedGames.partialScores;
  return result;
}

function parseTeamContext(row, config) {
  const c = row.cells;
  assert(String(c.vw_ec_teams___yr || "") === config.year, `team row ${row.id} year does not match ${config.year}`);
  const info = category(c.vw_ec_teams___event, "team");
  const a = c.vw_ec_teams___assoc_a || "";
  const x = c.vw_ec_teams___assoc_x || "";
  const teamResultPresent = /^\d+$/.test(c.vw_ec_teams___res_team_a || "") && /^\d+$/.test(c.vw_ec_teams___res_team_x || "");
  const group = c.vw_ec_teams___group_ || null;
  const stage = c.vw_ec_teams___stage || null;
  const roundNumber = c.vw_ec_teams___rnd || null;
  const roundLabel = [stage, group ? `Group ${group}` : null, roundNumber ? `Round ${roundNumber}` : null].filter(Boolean).join(" - ") || info.categoryName;
  const roundKey = roundLabel.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  return {
    info,
    roundLabel,
    roundKey,
    teams: [
      { name: a, org: a, orgCode: a },
      { name: x, org: x, orgCode: x },
    ],
    context: {
      source: "ETTU results list 29",
      sourceRowId: String(row.id),
      year: config.year,
      event: c.vw_ec_teams___event || null,
      group,
      stage,
      round: roundNumber,
      teams: [{ name: a, orgCode: a }, { name: x, orgCode: x }],
      parentAggregateScore: teamResultPresent ? `${Number(c.vw_ec_teams___res_team_a)}-${Number(c.vw_ec_teams___res_team_x)}` : null,
      parentAggregateMissing: !teamResultPresent,
      detailHref: row.detailHref,
    },
  };
}

async function fetchHtml(url, options) {
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 20000;
  const response = await (options.fetchImpl || fetch)(url, {
    headers: { accept: "text/html,application/xhtml+xml", "user-agent": "Mozilla/5.0 (compatible; ETTUArchiveResults/1.0)" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  assert(response?.ok, `HTTP ${response?.status} for ${new URL(url).pathname}`);
  const html = await response.text();
  assert(/<html\b/i.test(html), `non-HTML response for ${new URL(url).pathname}`);
  if (typeof options.onPage === "function") await options.onPage({ url: String(url), html });
  return html;
}

async function fetchEttuArchiveYears(options = {}) {
  const years = {};
  for (const type of ["singles", "doubles", "team"]) {
    const url = listUrl(type, "2008", 0);
    years[type] = parseYears(await fetchHtml(url, options), type);
  }
  return years;
}

async function fetchListRows(type, year, options = {}) {
  const listId = LISTS[type].listId;
  const all = [];
  const ids = new Set();
  let advertisedTotal = null;
  for (let start = 0; ; start += PAGE_SIZE) {
    const pageUrl = listUrl(type, year, start);
    const html = await fetchHtml(pageUrl, options);
    const total = parseTotal(html);
    if (advertisedTotal == null) advertisedTotal = total;
    assert(total === advertisedTotal, `${type} ${year} advertised Total changed between pages`);
    const page = parseRows(html, listId, []);
    assert(page.length <= PAGE_SIZE, `${type} ${year} page exceeded ${PAGE_SIZE} rows`);
    for (const row of page) {
      assert(!ids.has(row.id), `${type} ${year} duplicate row id ${row.id}`);
      ids.add(row.id);
      const rowYearField = type === "team" ? "vw_ec_teams___yr" : "vw_ec_indv___yr";
      assert(row.cells[rowYearField] === String(year), `${type} row ${row.id} has year ${row.cells[rowYearField] || "(missing)"}, expected ${year}`);
      row.sourceUrl = pageUrl;
      all.push(row);
    }
    assert(all.length <= advertisedTotal, `${type} ${year} returned more rows than advertised Total`);
    if (all.length === advertisedTotal) break;
    assert(page.length > 0, `${type} ${year} pagination stopped at ${all.length} of ${advertisedTotal}`);
    assert(start + PAGE_SIZE < advertisedTotal, `${type} ${year} pagination did not reach advertised Total`);
  }
  assert(all.length === advertisedTotal, `${type} ${year} returned ${all.length} rows; advertised Total ${advertisedTotal}`);
  Object.defineProperty(all, "advertisedTotal", { value: advertisedTotal, enumerable: true });
  return all;
}

function detailUrl(href, config, parentId) {
  assert(href, `team row ${parentId} has no individual-match detail link`);
  const url = new URL(href, BASE_URL);
  assert(url.origin === new URL(BASE_URL).origin && url.searchParams.get("listid") === "31", `team row ${parentId} has an unexpected detail link`);
  assert(url.searchParams.get("vw_teams_indv_res___yr") === config.year, `team row ${parentId} detail year does not match ${config.year}`);
  return url.toString();
}

async function fetchTeamSubmatches(parent, config, options) {
  const parsed = parseTeamContext(parent, config);
  const url = detailUrl(parent.detailHref, config, parent.id);
  const html = await fetchHtml(url, options);
  const rows = parseRows(html, 31, []);
  const ids = new Set();
  const teamContext = { roundLabel: parsed.roundLabel, roundKey: parsed.roundKey, context: parsed.context };
  const results = [];
  const errors = [];
  const unplayed = [];
  const warnings = [];
  for (const row of rows) {
    row.sourceUrl = url;
    try {
      if (isUnplayedPlaceholder(row, "vw_teams_indv_res")) {
        unplayed.push({ teamRowId: String(parent.id), sourceRowId: String(row.id), ...sourceRowDetails(row, "vw_teams_indv_res"), reason: "all listed game scores are 0:0 placeholders; no exceptional status is published" });
        continue;
      }
      assert(!ids.has(row.id), `team detail for ${parent.id} contains duplicate submatch id ${row.id}`);
      ids.add(row.id);
      const record = normalizeIndividualRow(row, config, { prefix: "vw_teams_indv_res", type: "singles", teamContext: { ...teamContext, info: parsed.info } });
      record.id = `${config.eventId}-T-${row.id}`;
      record.documentCode = `ETTU-ARCHIVE-${config.year}-team-${parent.id}-submatch-${row.id}`;
      record.subEventType = `${parsed.info.categoryName} - ${parsed.context.stage || "Team stage"}`;
      record.categoryName = `${parsed.info.gender === "women" ? "Women" : parsed.info.gender === "mixed" ? "Mixed" : "Men"} Singles`;
      record.discipline = "singles";
      record.gender = parsed.info.gender;
      record.competitors.forEach((competitor, index) => {
        const teamCode = parsed.teams[index].orgCode;
        competitor.org = teamCode;
        competitor.orgCode = teamCode;
        competitor.players.forEach((player) => { player.org = teamCode; player.orgCode = teamCode; });
      });
      record.recordTeamContext = {
        ...parsed.context,
        sourceDetailRowId: String(row.id),
        teamSideScore: record.overallScore,
      };
      results.push(record);
      const warning = recordWarning(record, row, config, "vw_teams_indv_res", "singles", parent.id);
      if (warning) warnings.push(warning);
    } catch (error) {
      const entry = { eventId: config.eventId, year: config.year, type: config.type, teamRowId: String(parent.id), sourceRowId: String(row.id), ...sourceRowDetails(row, "vw_teams_indv_res"), error: error.message };
      errors.push(entry);
      if (typeof options.onError === "function") await options.onError(entry);
    }
  }
  return { matches: results, errors, unplayed, warnings, sourceRows: rows.length };
}

async function fetchEttuArchiveResults(inputConfig, options = {}) {
  const config = archiveConfig(inputConfig);
  const rows = await fetchListRows(config.type, config.year, options);
  const records = [];
  const errors = [];
  const unplayed = [];
  const warnings = [];
  let detailRowsObserved = 0;
  if (config.type !== "team") {
    for (const row of rows) {
      try {
        if (isUnplayedPlaceholder(row, "vw_ec_indv")) {
          unplayed.push({ sourceRowId: String(row.id), ...sourceRowDetails(row, "vw_ec_indv", config.type), reason: "all listed game scores are 0:0 placeholders; no exceptional status is published" });
          continue;
        }
        const record = normalizeIndividualRow(row, config);
        records.push(record);
        const warning = recordWarning(record, row, config, "vw_ec_indv", config.type);
        if (warning) warnings.push(warning);
      } catch (error) {
        const entry = { eventId: config.eventId, year: config.year, type: config.type, sourceRowId: String(row.id), ...sourceRowDetails(row, "vw_ec_indv", config.type), error: error.message };
        errors.push(entry);
        if (typeof options.onError === "function") await options.onError(entry);
      }
    }
  } else {
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      try {
        const detail = await fetchTeamSubmatches(row, config, options);
        records.push(...detail.matches);
        errors.push(...detail.errors);
        unplayed.push(...detail.unplayed);
        warnings.push(...detail.warnings);
        detailRowsObserved += detail.sourceRows;
      } catch (error) {
        const entry = { eventId: config.eventId, year: config.year, type: config.type, teamRowId: String(row.id), error: error.message };
        errors.push(entry);
        if (typeof options.onError === "function") await options.onError(entry);
      }
      if (typeof options.onProgress === "function") {
        await options.onProgress({ eventId: config.eventId, year: config.year, type: config.type, parentRowsCompleted: index + 1, parentRowsTotal: rows.length, verifiedMatches: records.length, unplayed: unplayed.length, errors: errors.length });
      }
    }
  }
  Object.defineProperties(records, {
    errors: { value: errors, enumerable: true },
    unplayed: { value: unplayed, enumerable: true },
    warnings: { value: warnings, enumerable: true },
    counts: { value: { advertised: rows.advertisedTotal, parsed: records.length, unplayed: unplayed.length, rejected: errors.length, warnings: warnings.length, detailRowsObserved }, enumerable: true },
  });
  return records;
}

async function fetchEttuArchiveEvents(configs, options = {}) {
  assert(Array.isArray(configs), "event configs must be an array");
  const results = [];
  const errors = [];
  const warnings = [];
  for (const input of configs) {
    let config;
    try {
      config = archiveConfig(input);
      const matches = await fetchEttuArchiveResults(config, options);
      results.push({ eventId: config.eventId, eventName: config.eventName, year: config.year, type: config.type, matches, errors: matches.errors || [], counts: matches.counts, unplayed: matches.unplayed || [], warnings: matches.warnings || [] });
      errors.push(...(matches.errors || []));
      warnings.push(...(matches.warnings || []));
    } catch (error) {
      const entry = { eventId: input?.eventId ?? null, eventName: input?.eventName ?? null, year: input?.year == null ? null : String(input.year), type: input?.type ?? null, error: error.message };
      errors.push(entry);
      results.push({ ...entry, matches: [] });
    }
  }
  return { results, errors, warnings };
}

module.exports = {
  fetchEttuArchiveEvents,
  fetchEttuArchiveResults,
  fetchEttuArchiveYears,
  normalizeIndividualRow,
  normalizeRound,
  parseGames,
  parseRows,
  parseYears,
};
