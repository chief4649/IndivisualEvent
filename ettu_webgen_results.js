"use strict";

const DEFAULT_TIMEOUT_MS = 15000;

function assert(condition, message) {
  if (!condition) throw new Error(`ETTU Webgen results: ${message}`);
}

function isCalendarDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&#(x[\da-f]+|\d+);/gi, (_, code) => {
      const number = /^x/i.test(code) ? parseInt(code.slice(1), 16) : parseInt(code, 10);
      return Number.isFinite(number) ? String.fromCodePoint(number) : _;
    })
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">");
}

function textContent(html) {
  return decodeHtml(String(html || "").replace(/<br\s*\/?>/gi, " ").replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ").trim();
}

function attribute(html, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(html || "").match(new RegExp(`\\b${escaped}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i"));
  return match ? decodeHtml(match[2]) : "";
}

function playerName(html) {
  const name = textContent(html.match(/<span\b[^>]*class=["'][^"']*\bname\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)?.[1] || "");
  const comma = name.indexOf(",");
  return comma > 0 ? `${name.slice(0, comma).trim()} ${name.slice(comma + 1).trim()}` : name;
}

function webgenPlayerId(eventId, sourceId) {
  const value = String(sourceId || "").trim();
  if (!value) return "";
  const namespace = String(eventId || "webgen").toUpperCase().replace(/[^A-Z0-9_-]/g, "_");
  return `WEBGEN:${namespace}:${value}`;
}

function parsePlayers(sideHtml, eventId) {
  return Array.from(String(sideHtml || "").matchAll(/<div\b[^>]*class=["'][^"']*\bplayer\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi), (match) => {
    const body = match[1];
    const name = playerName(body);
    if (!name) return null;
    const sourceId = textContent(body.match(/<span\b[^>]*class=["'][^"']*\bplnr\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)?.[1] || "");
    return {
      id: webgenPlayerId(eventId, sourceId),
      name,
      org: textContent(body.match(/<span\b[^>]*class=["'][^"']*\bassoc\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)?.[1] || ""),
    };
  }).filter(Boolean);
}

function parseSides(matchHtml, isTeam, eventId) {
  const nameCell = String(matchHtml || "").match(/<td\b[^>]*class=["'][^"']*\bname\b[^"']*["'][^>]*>([\s\S]*?)(?=<td\b[^>]*class=["'][^"']*\bresult\b)/i)?.[1] || "";
  const sideMatches = Array.from(nameCell.matchAll(/<div\b[^>]*class=["']((?:left|right)(?:\s+[^"']*)?)["'][^>]*>([\s\S]*?)(?=<div\b[^>]*class=["'](?:left|right)(?:\s+[^"']*)?["']|$)/gi));
  const sides = {};
  for (const match of sideMatches) {
    const side = /^left\b/i.test(match[1]) ? "left" : "right";
    const body = match[2];
    if (isTeam) {
      const name = textContent(body.match(/<span\b[^>]*class=["'][^"']*\bteamname\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)?.[1] || "");
      const org = textContent(body.match(/<span\b[^>]*class=["'][^"']*\bassoc\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)?.[1] || "");
      sides[side] = name ? { name, org, orgCode: org } : null;
    } else {
      const players = parsePlayers(body, eventId);
      const orgs = [...new Set(players.map((player) => player.org).filter(Boolean))];
      sides[side] = players.length ? {
        id: players.map((player) => player.id).filter(Boolean).join("/"),
        name: players.map((player) => player.name).join("/"),
        org: orgs.join("/"), orgCode: orgs.join("/"),
        type: players.length > 1 ? "pair" : "player",
        players: players.map((player, index) => ({ ...player, orgCode: player.org, position: index + 1 })),
      } : null;
    }
  }
  return sides;
}

function numericResult(matchHtml) {
  const resultCell = String(matchHtml || "").match(/<td\b[^>]*class=["'][^"']*\bresult\b[^"']*["'][^>]*>([\s\S]*?)<\/td>/i)?.[1];
  if (!resultCell) return null;
  const values = ["left", "right"].map((side) => {
    const value = resultCell.match(new RegExp(`<div\\b[^>]*class=["'][^"']*\\b${side}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/div>`, "i"))?.[1];
    return textContent(value || "");
  });
  if (values.every((value) => /^\d+$/.test(value))) return values.map(Number);
  return null;
}

function parseGameScores(matchHtml, allowPartial = false) {
  const cells = Array.from(String(matchHtml || "").matchAll(/<td\b[^>]*class=["'][^"']*\bgame(?!\s+empty)[^"']*["'][^>]*>([\s\S]*?)<\/td>/gi));
  const scores = [];
  const partialPoints = [];
  for (let index = 0; index < cells.length; index += 1) {
    const cell = cells[index];
    const sides = ["left", "right"].map((side) => {
      const raw = cell[1].match(new RegExp(`<div\\b[^>]*class=["'][^"']*\\b${side}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/div>`, "i"))?.[1];
      return textContent(raw || "");
    });
    if (sides.every((value) => value === "")) continue;
    if (allowPartial && sides.some((value) => value === "")) {
      assert(sides.every((value) => value === "" || /^\d+$/.test(value)), `malformed partial point score ${sides.join("-")}`);
      partialPoints.push({ gameNumber: index + 1, left: sides[0] === "" ? null : Number(sides[0]), right: sides[1] === "" ? null : Number(sides[1]) });
      continue;
    }
    assert(sides.every((value) => /^\d+$/.test(value)), `malformed point score ${sides.join("-")}`);
    const [left, right] = sides.map(Number);
    const high = Math.max(left, right), low = Math.min(left, right);
    assert(low >= 0 && (allowPartial || (high === 11 && low <= 9) || (high > 11 && high - low === 2)), `invalid point score ${left}-${right}`);
    scores.push(`${left}-${right}`);
    partialPoints.push({ gameNumber: index + 1, left, right });
  }
  return { gameScores: scores, partialPoints };
}

function scoreRow(matchHtml, sides, label, isTeam = false) {
  const text = textContent(matchHtml);
  const result = numericResult(matchHtml);
  const hasWalkover = /\bw\s*\/\s*o\b|\bwalk\s*over\b|data-i18n=["']result\.format\.short\.wo["']/i.test(matchHtml) || /\bW\/O\b|\bwalkover\b/i.test(text);
  const leftWinner = /\bwinner\b/i.test(matchHtml.match(/<div\b[^>]*class=["']left[^"']*["']/i)?.[0] || "");
  const rightWinner = /\bwinner\b/i.test(matchHtml.match(/<div\b[^>]*class=["']right[^"']*["']/i)?.[0] || "");
  if (hasWalkover) {
    assert(leftWinner !== rightWinner, `${label} walkover lacks an unambiguous winner`);
    return { overallScore: leftWinner ? "W-L" : "L-W", resultStatus: "WO", gameScores: [], partialPoints: [] };
  }
  if (!result) return null;
  if (isTeam) {
    assert(sides.left && sides.right, `${label} has a completed score but missing teams`);
    assert(Math.max(...result) >= 3 && Math.min(...result) < Math.max(...result), `${label} team score is not terminal`);
    return { overallScore: `${result[0]}-${result[1]}`, resultStatus: "1", gameScores: [], partialPoints: [] };
  }
  const markedResult = /\bdisqu(?:alified)?\.?(?=\W|$)/i.test(text) ? "DQ"
    : /\binj(?:ury)?\.?(?=\W|$)|\bret(?:ired|irement)?\.?(?=\W|$)/i.test(text) ? "RET" : "";
  const parsedGames = parseGameScores(matchHtml, Boolean(markedResult));
  const { gameScores, partialPoints } = parsedGames;
  if (result[0] === 0 && result[1] === 0 && gameScores.length === 0 && partialPoints.length === 0 && !markedResult) return null;
  if (markedResult) {
    assert(result[0] !== result[1], `${label} ${markedResult} result has no winner`);
    const winnerIndex = result[0] > result[1] ? 0 : 1;
    if (leftWinner !== rightWinner) {
      assert((leftWinner ? 0 : 1) === winnerIndex, `${label} ${markedResult} winner disagrees with the score`);
    }
    const loserIndex = result[0] < result[1] ? 0 : 1;
    if (sides[loserIndex === 0 ? "left" : "right"]) sides[loserIndex === 0 ? "left" : "right"].irm = markedResult;
    return { overallScore: `${result[0]}-${result[1]}`, resultStatus: markedResult, gameScores, partialPoints };
  }
  if (!sides.left || !sides.right) {
    const winnerIndex = result[0] > result[1] ? 0 : 1;
    const declaredWinnerIndex = leftWinner === rightWinner ? -1 : leftWinner ? 0 : 1;
    const completeDefaultGames = gameScores.length === result[winnerIndex]
      && result[winnerIndex] >= 3
      && gameScores.every((score) => {
        const points = score.split("-").map(Number);
        return winnerIndex === 0 ? points[0] === 11 && points[1] === 0 : points[0] === 0 && points[1] === 11;
      });
    assert(Boolean(sides.left || sides.right) && completeDefaultGames && declaredWinnerIndex === winnerIndex,
      `${label} has a completed score but missing competitors without a source-verified walkover`);
    return { overallScore: `${result[0]}-${result[1]}`, resultStatus: "WO", gameScores, partialPoints };
  }
  assert(gameScores.length >= 3 && gameScores.length <= 7, `${label} completed score has no valid game details`);
  const wins = gameScores.reduce((counts, score) => {
    const [left, right] = score.split("-").map(Number);
    counts[left > right ? 0 : 1] += 1;
    return counts;
  }, [0, 0]);
  assert(wins[0] === result[0] && wins[1] === result[1], `${label} overall score disagrees with game scores`);
  assert(Math.max(...wins) >= 3 && Math.min(...wins) < Math.max(...wins), `${label} score is not terminal`);
  return { overallScore: `${result[0]}-${result[1]}`, resultStatus: "1", gameScores, partialPoints };
}

function parseRound(span) {
  const key = attribute(span, "data-i18n");
  let options = {};
  try { options = JSON.parse(attribute(span, "data-i18n-options").replace(/&quot;/g, '"') || "{}"); } catch {}
  if (key === "rr.format.short.round" && options.round) return `Round ${options.round}`;
  if (key === "ko.format.short.roundof" && options.entries) return `Round of ${options.entries}`;
  return ({ "ko.format.short.final": "Final", "ko.format.short.semifinal": "Semifinal", "ko.format.short.quarterfinal": "Quarterfinal" })[key] || "";
}

function parseIdentity(eventId, date, sourceIndex, rowHtml, suffix = "") {
  const official = attribute(rowHtml, "data-webgen-match") || attribute(rowHtml, "data-bs-target").match(/data-webgen-match=["']?(\d+)/i)?.[1] || "";
  return official ? `${eventId}-${date}-webgen-${official}${suffix}` : `${eventId}-${date}-row-${sourceIndex}${suffix}`;
}

function metadata(config, date, id, documentCode, category, roundLabel, matchNumber, recordUrl) {
  const discipline = /\bteam/i.test(category) ? "teams" : /doubles?/i.test(category) ? "doubles" : "singles";
  const gender = /mixed/i.test(category) ? "mixed" : /women/i.test(category) ? "women" : /men/i.test(category) ? "men" : null;
  const normalizedRound = String(roundLabel || "").trim();
  const roundKey = /\bgroup\b|\bpool\b/i.test(normalizedRound) ? "group"
    : /^final$/i.test(normalizedRound) ? "final"
      : /^semi ?final$/i.test(normalizedRound) ? "semifinal"
        : /^quarter ?final$/i.test(normalizedRound) ? "quarterfinal"
          : normalizedRound.match(/^round of (\d+)$/i) ? `round_of_${normalizedRound.match(/^round of (\d+)$/i)[1]}`
            : normalizedRound ? normalizedRound.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") : null;
  return {
    id, eventId: String(config.eventId), documentCode, source: "wtt", recordSource: "webgen",
    recordEventId: String(config.eventId), recordUrl, recordStartDate: config.startDate,
    recordEndDate: config.endDate, recordEventName: config.eventName,
    subEventType: category, categoryName: category, discipline, gender,
    roundLabel, roundKey,
    matchNumber, description: `${category} - ${roundLabel || "Match"} - Match ${matchNumber}`,
    venue: "", table: "", startDateLocal: date, startDateUtc: "", searchDateTokens: [date], date,
  };
}

function parseDatePage(html, date, config, eventNames, recordUrl, counts) {
  const matches = [];
  const bodies = Array.from(String(html || "").matchAll(/<tbody\b[^>]*>([\s\S]*?)<\/tbody>/gi));
  let sourceIndex = 0;
  const seenParents = new Set();
  for (const bodyMatch of bodies) {
    const body = bodyMatch[1];
    const header = body.match(/<tr\b[^>]*class=["']header["'][^>]*>([\s\S]*?)<\/tr>/i)?.[1];
    if (!header) continue;
    const categoryCode = textContent(header.match(/<span\b[^>]*class=["'][^"']*\bevent\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)?.[1] || "");
    const category = eventNames[categoryCode];
    assert(category, `${date} references unknown event code ${categoryCode || "(empty)"}`);
    const group = textContent(header.match(/<span\b[^>]*class=["'][^"']*\bgroup\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)?.[1] || "");
    const roundSpan = header.match(/<span\b[^>]*class=["'][^"']*\bround\b[^"']*"[^>]*>[\s\S]*?<\/span>/i)?.[0] || "";
    const roundText = parseRound(roundSpan);
    const roundLabel = /^main draw$/i.test(group) ? roundText || group : group || roundText;
    const tableOptions = (() => { try { return JSON.parse(attribute(header.match(/<span\b[^>]*class=["'][^"']*\bmttable\b[^"']*"[^>]*>/i)?.[0] || "", "data-i18n-options") || "{}"); } catch { return {}; } })();
    const rows = Array.from(body.matchAll(/<tr\b([^>]*)>([\s\S]*?)<\/tr>/gi));
    const parents = [];
    for (const row of rows) {
      const classes = attribute(`<tr ${row[1]}>`, "class").split(/\s+/);
      if (classes.includes("header")) continue;
      const rowHtml = `<tr${row[1]}>${row[2]}</tr>`;
      sourceIndex += 1;
      if (classes.includes("individual") || classes.includes("collapse")) {
        const parentId = attribute(rowHtml, "data-webgen-match");
        const parent = parents.find((candidate) => candidate.webgenId && candidate.webgenId === parentId);
        if (!parent) { counts.skippedUnplayedChildren += 1; continue; }
        const childOrdinal = parent.childrenSeen++;
        const sides = parseSides(rowHtml, false, config.eventId);
        const score = scoreRow(rowHtml, sides, `child ${parent.id}`);
        if (!score) { counts.skippedUnplayedChildren += 1; continue; }
        const childId = parseIdentity(config.eventId, date, sourceIndex, rowHtml, `-single-${childOrdinal + 1}`);
        const child = {
          ...metadata(config, date, childId, `${parent.documentCode}-S${childOrdinal + 1}`, /\bmen\b/i.test(parent.category) ? "Men Singles" : "Women Singles", parent.roundLabel, childOrdinal + 1, recordUrl),
          order: parent.singles.length + 1, id: childId,
          documentCode: `${parent.documentCode}-S${childOrdinal + 1}`,
          description: `${sides.left?.name || ""} vs ${sides.right?.name || ""}`.trim(),
          overallScore: score.overallScore, resultStatus: score.resultStatus,
          gameScores: score.gameScores, partialPoints: score.partialPoints, competitors: [sides.left, sides.right],
          ...((!sides.left || !sides.right) ? { participantDetailMissing: true } : {}),
          categoryName: /\bmen\b/i.test(parent.category) ? "Men Singles" : "Women Singles",
          subEventType: /\bmen\b/i.test(parent.category) ? "Men Singles" : "Women Singles",
          matchNumber: childOrdinal + 1,
        };
        parent.singles.push(child);
        continue;
      }
      if (!classes.includes("match")) continue;
      const team = /\bteam/i.test(category) || /^(MT|WT)$/i.test(categoryCode);
      const sides = parseSides(rowHtml, team, config.eventId);
      const identity = parseIdentity(config.eventId, date, sourceIndex, rowHtml);
      const webgenId = attribute(rowHtml, "data-webgen-match") || attribute(rowHtml, "data-bs-target").match(/data-webgen-match=["']?(\d+)/i)?.[1] || "";
      if (webgenId && seenParents.has(webgenId)) { counts.duplicates += 1; continue; }
      const score = scoreRow(rowHtml, sides, `match ${identity}`, team);
      if (!score) { counts.skippedUnplayedMatches += 1; continue; }
      if (webgenId) seenParents.add(webgenId);
      const matchNumber = Number(webgenId) || sourceIndex;
      const documentCode = `WEBGEN-${config.eventId}-${date}-${webgenId || sourceIndex}`;
      const base = metadata(config, date, identity, documentCode, category, roundLabel, matchNumber, recordUrl);
      base.table = String(tableOptions.table || "");
      base.overallScore = score.overallScore;
      base.resultStatus = score.resultStatus;
      base.gameScores = team ? [] : score.gameScores;
      base.partialPoints = score.partialPoints;
      base.competitors = team ? [] : [sides.left, sides.right];
      if (!team && (!sides.left || !sides.right)) base.participantDetailMissing = true;
      base.teams = team ? [sides.left, sides.right] : [];
      base.singles = [];
      base.matchType = team ? "team" : "individual";
      const parent = { id: identity, documentCode, category, roundLabel, webgenId, childrenSeen: 0, singles: base.singles, teams: base.teams, score: score.overallScore };
      parents.push(parent);
      matches.push(base);
      if (team) counts.teams += 1; else counts.individual += 1;
    }
    for (const parent of parents.filter((candidate) => candidate.singles && candidate.teams && candidate.documentCode.startsWith(`WEBGEN-${config.eventId}-${date}-`))) {
      if (!parent.webgenId) continue;
      const match = matches.find((candidate) => candidate.id === parent.id);
      if (!match || match.matchType !== "team") continue;
      if (parent.singles.length === 0 && match.resultStatus === "WO") continue;
      assert(parent.singles.length > 0, `completed team match ${parent.id} has no completed individual details`);
      const [left, right] = parent.score.split("-").map(Number);
      const childWins = parent.singles.reduce((wins, single) => {
        const result = single.overallScore.split("-");
        const winnerIndex = result[0] === "W" ? 0 : result[1] === "W" ? 1 : Number(result[0]) > Number(result[1]) ? 0 : 1;
        wins[winnerIndex] += 1;
        return wins;
      }, [0, 0]);
      assert(childWins[0] === left && childWins[1] === right, `team match ${parent.id} score ${parent.score} disagrees with completed singles ${childWins.join("-")}`);
    }
  }
  return matches;
}

async function fetchText(fetchImpl, url, timeoutMs) {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
  assert(response && response.ok, `HTTP ${response?.status} for ${url}`);
  return response.text();
}

async function fetchPage(fetchImpl, url, timeoutMs, onPage) {
  const html = await fetchText(fetchImpl, url, timeoutMs);
  if (typeof onPage === "function") await onPage({ url, html });
  return html;
}

async function fetchEttuWebgenResults(config, options = {}) {
  assert(config && config.eventId != null && String(config.eventId).trim(), "eventId is required");
  assert(config.eventName && String(config.eventName).trim(), "eventName is required");
  assert(isCalendarDate(config.startDate) && isCalendarDate(config.endDate) && config.startDate <= config.endDate, "valid startDate and endDate are required");
  if (config.matchStartDate != null) assert(isCalendarDate(config.matchStartDate), "valid matchStartDate is required");
  if (config.matchEndDate != null) assert(isCalendarDate(config.matchEndDate), "valid matchEndDate is required");
  assert(config.baseUrl, "baseUrl is required");
  const baseUrl = new URL(config.baseUrl.endsWith("/") ? config.baseUrl : `${config.baseUrl}/`);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : DEFAULT_TIMEOUT_MS;
  const retainRawPages = options.retainRawPages !== false;
  assert(typeof fetchImpl === "function", "fetch implementation is required");
  const rawPages = { eventsHtml: "", datesHtml: "", datePages: [] };
  const eventsHtml = await fetchPage(fetchImpl, new URL("events.html", baseUrl).toString(), timeoutMs, options.onPage);
  const datesHtml = await fetchPage(fetchImpl, new URL("dates.html", baseUrl).toString(), timeoutMs, options.onPage);
  if (retainRawPages) {
    rawPages.eventsHtml = eventsHtml;
    rawPages.datesHtml = datesHtml;
  }
  const eventNames = {};
  for (const match of eventsHtml.matchAll(/<a\b[^>]*href=["']([^"']+\.html)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const code = decodeHtml(match[1].split("/").pop().replace(/\.html$/i, ""));
    const sourceName = textContent(match[2]);
    const name = code.toUpperCase() === "MT" ? "Men's Teams"
      : code.toUpperCase() === "WT" ? "Women's Teams" : sourceName;
    if (code && name) eventNames[code] = name;
  }
  assert(Object.keys(eventNames).length > 0, "events page contains no event links");
  const dateLinks = [...new Set(Array.from(datesHtml.matchAll(/href=["'](\d{4}-\d{2}-\d{2}\.html)["']/gi), (match) => match[1]))];
  assert(dateLinks.length > 0, "dates page contains no date links");
  const dates = dateLinks.map((href) => href.slice(0, 10));
  const matchStartDate = config.matchStartDate || config.startDate;
  const matchEndDate = config.matchEndDate || config.endDate;
  assert(matchStartDate <= matchEndDate, "source match date range must be valid");
  for (const date of dates) {
    assert(isCalendarDate(date), `invalid date link ${date}`);
    assert(date >= matchStartDate && date <= matchEndDate, `date ${date} is outside source match dates`);
  }
  const counts = { dates: dates.length, pages: 0, individual: 0, teams: 0, skippedUnplayedMatches: 0, skippedUnplayedChildren: 0, duplicates: 0 };
  const matches = [];
  const seen = new Set();
  for (let index = 0; index < dateLinks.length; index += 1) {
    const href = dateLinks[index];
    const url = new URL(href, baseUrl).toString();
    const html = await fetchPage(fetchImpl, url, timeoutMs, options.onPage);
    if (retainRawPages) rawPages.datePages.push({ date: dates[index], url, html });
    counts.pages += 1;
    const parsed = parseDatePage(html, dates[index], config, eventNames, url, counts);
    for (const match of parsed) {
      const key = match.id;
      if (seen.has(key)) { counts.duplicates += 1; continue; }
      seen.add(key);
      matches.push(match);
    }
  }
  counts.individual = matches.filter((match) => match.matchType === "individual").length;
  counts.teams = matches.filter((match) => match.matchType === "team").length;
  const sourceWarnings = matches.flatMap((match) => match.matchType === "team" ? match.singles : [match])
    .filter((match) => match.participantDetailMissing === true)
    .map((match) => ({ eventId: config.eventId, documentCode: match.documentCode,
      rowUrl: match.recordUrl, missingFields: ["participantNames"] }));
  return { matches, rawPages, counts, sourceWarnings };
}

module.exports = { fetchEttuWebgenResults };
