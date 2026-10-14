"use strict";

const ROUND_ORDER = ["round_of_256", "round_of_128", "round_of_64", "round_of_32", "round_of_16", "quarterfinal", "semifinal", "final"];

function normalizeToken(value) {
  return String(value || "").normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
}

function getRoundKey(match) {
  const key = normalizeToken(match?.roundKey).replace(/[ -]+/g, "_");
  if (ROUND_ORDER.includes(key)) return key;
  const label = normalizeToken(match?.roundLabel || match?.description).replace(/[ -]+/g, "_");
  if (ROUND_ORDER.includes(label)) return label;
  const round = label.match(/(?:round_of_|r)(256|128|64|32|16)\b/);
  if (round) return `round_of_${round[1]}`;
  if (/quarter.?final|\bqf\b/.test(label)) return "quarterfinal";
  if (/semi.?final|\bsf\b/.test(label)) return "semifinal";
  if (/\bfinal\b/.test(label) && !/semi|quarter|group|qualif|consolation/.test(label)) return "final";
  return null;
}

function getParticipant(competitor) {
  if (!competitor || competitor.participantDetailMissing === true) return null;
  const players = Array.isArray(competitor.players) ? competitor.players : [];
  const namedPlayers = players.filter((player) => String(player?.name || "").trim());
  if (namedPlayers.length === 1 && players.length <= 1) {
    const name = normalizeToken(namedPlayers[0].name);
    const org = normalizeToken(namedPlayers[0].orgCode || namedPlayers[0].org || competitor.orgCode || competitor.org);
    return name && org ? `${name}\u0000${org}` : null;
  }
  if (players.length > 0) return null;
  const name = normalizeToken(competitor.name || competitor.playerName || competitor.competitorName || competitor.competitiorName);
  const org = normalizeToken(competitor.orgCode || competitor.org);
  return name && org ? `${name}\u0000${org}` : null;
}

function getParticipantName(competitor) {
  if (!competitor || competitor.participantDetailMissing === true) return "";
  const players = Array.isArray(competitor.players) ? competitor.players : [];
  if (players.length === 1 && String(players[0]?.name || "").trim()) return normalizeToken(players[0].name);
  if (players.length > 0) return "";
  return normalizeToken(competitor.name || competitor.playerName || competitor.competitorName || competitor.competitiorName);
}

function hasCompletedKnownResult(match) {
  if (!match || match.resultOutcomeMissing === true || match.recordWinnerIndex !== undefined) return false;
  if (/\b(?:wo|walkover|w\/o)\b/i.test(`${match.overallScore || ""} ${match.resultStatus || ""}`)) return false;
  const score = String(match.overallScore || "").trim().match(/^(\d+)\s*[-:]\s*(\d+)$/);
  if (score) {
    const winner = Math.max(Number(score[1]), Number(score[2]));
    const loser = Math.min(Number(score[1]), Number(score[2]));
    return (winner === 3 || winner === 4) && loser < winner;
  }
  const games = Array.isArray(match.gameScores) ? match.gameScores : [];
  let leftWins = 0;
  let rightWins = 0;
  for (const game of games) {
    const set = String(game || "").trim().match(/^(\d+)\s*[-:]\s*(\d+)$/);
    if (!set) continue;
    const left = Number(set[1]);
    const right = Number(set[2]);
    if (Math.max(left, right) < 11 || Math.abs(left - right) < 2) continue;
    if (left > right) leftWins += 1;
    else rightWins += 1;
  }
  return (leftWins >= 3 && rightWins <= 2) || (rightWins >= 3 && leftWins <= 2);
}

function isScopedMatch(match) {
  return match?.recordSource === "ettu" && match?.matchType === "individual"
    && !match?.recordTeamContext && normalizeToken(match?.discipline) === "singles"
    && Array.isArray(match.competitors) && match.competitors.length === 2
    && Boolean(match.eventId || match.recordEventId)
    && Boolean(String(match.categoryName || "").trim())
    && Boolean(String(match.gender || "").trim())
    && Boolean(String(match.discipline || "").trim())
    && Boolean(String(match.subEventType || "").trim())
    && !/group|pool|qualif|consolation/i.test(`${match.subEventType} ${match.roundLabel || ""} ${match.roundKey || ""}`)
    && Boolean(getRoundKey(match));
}

function isEligible(match) {
  return isScopedMatch(match) && match.participantDetailMissing !== true
    && match.competitors.every(getParticipant);
}

function identity(match) {
  return [
    normalizeToken(match.eventId || match.recordEventId),
    normalizeToken(match.categoryName),
    normalizeToken(match.gender),
    normalizeToken(match.discipline),
    String(match.subEventType).trim(),
  ].join("\u0001");
}

function resolveKnockoutOutcomes(matches) {
  const source = (Array.isArray(matches) ? matches : []).map((match) => {
    if (match?.recordWinnerEvidence?.method !== "knockout-next-round") return match;
    const { recordWinnerIndex, recordWinnerEvidence, ...original } = match;
    return original;
  });
  const eligible = source.map((match, index) => ({ match, index }))
    .filter(({ match }) => isScopedMatch(match))
    .map((entry) => ({ ...entry, roundKey: getRoundKey(entry.match) }));
  const currentEntries = eligible.filter(({ match }) => isEligible(match) && match.resultOutcomeMissing === true);
  const result = source.slice();
  for (const current of currentEntries) {
    const currentRoundIndex = ROUND_ORDER.indexOf(current.roundKey);
    if (currentRoundIndex < 0 || currentRoundIndex >= ROUND_ORDER.length - 1) continue;
    const nextRoundKey = ROUND_ORDER[currentRoundIndex + 1];
    const scope = eligible.filter((candidate) => identity(candidate.match) === identity(current.match));
    const previous = scope.filter((candidate) => candidate.roundKey === current.roundKey);
    const next = scope.filter((candidate) => candidate.roundKey === nextRoundKey);
    const participants = current.match.competitors.map(getParticipant);
    if (participants[0] === participants[1]) continue;
    const occurrenceCount = (participant) => previous.reduce((count, entry) => count + entry.match.competitors.filter((competitor) => getParticipant(competitor) === participant).length, 0);
    if (occurrenceCount(participants[0]) !== 1 || occurrenceCount(participants[1]) !== 1) continue;
    const names = current.match.competitors.map(getParticipantName);
    if (!names[0] || names[0] === names[1]) continue;
    const nameOccurrenceCount = (name, entries) => entries.reduce((count, entry) => count
      + entry.match.competitors.filter((competitor) => getParticipantName(competitor) === name).length, 0);
    if (nameOccurrenceCount(names[0], previous) !== 1 || nameOccurrenceCount(names[1], previous) !== 1
      || nameOccurrenceCount(names[0], next) > 1 || nameOccurrenceCount(names[1], next) > 1) continue;
    const nextEntriesFor = (participant) => next.filter((entry) => entry.match.competitors.some((competitor) => getParticipant(competitor) === participant));
    const leftEntries = nextEntriesFor(participants[0]);
    const rightEntries = nextEntriesFor(participants[1]);
    const leftAdvanced = leftEntries.length === 1 && rightEntries.length === 0;
    const rightAdvanced = rightEntries.length === 1 && leftEntries.length === 0;
    if (!leftAdvanced && !rightAdvanced) continue;
    const winnerNextEntry = leftAdvanced ? leftEntries[0] : rightEntries[0];
    if (!isEligible(winnerNextEntry.match) || !hasCompletedKnownResult(winnerNextEntry.match)) continue;
    const winnerIndex = leftAdvanced ? 0 : 1;
    const sourceCode = String(current.match.documentCode || "").trim();
    const nextCode = String(winnerNextEntry.match.documentCode || "").trim();
    if (!sourceCode || !nextCode) continue;
    result[current.index] = {
      ...current.match,
      recordWinnerIndex: winnerIndex,
      recordWinnerEvidence: {
        method: "knockout-next-round",
        eventId: String(current.match.eventId || current.match.recordEventId),
        sourceDocumentCode: sourceCode,
        nextDocumentCode: nextCode,
        nextRoundKey,
      },
    };
  }
  return result;
}

module.exports = { resolveKnockoutOutcomes };
