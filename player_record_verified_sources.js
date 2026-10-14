"use strict";

// These two archives were compared against the production match records.
const VERIFIED_TEAM_SOURCES = new Set(["5067", "ETTU2019T"]);

function slotKey(documentCode, left, right) {
  const side = s => [String(s?.name || "").trim().toLowerCase(), String(s?.orgCode || "").toUpperCase()].join("|");
  return JSON.stringify([documentCode, ...[side(left), side(right)].sort()]);
}

function getVerifiedUnplayedTeamSlots(payload) {
  const keys = new Set();
  for (const team of Array.isArray(payload) ? payload : []) {
    const score = String(team.overallScore || "").match(/^(\d+)-(\d+)$/);
    if (team.matchType !== "team" || !score || Math.max(+score[1], +score[2]) !== 3) continue;
    if (!team.teams?.[0]?.orgCode || !team.teams?.[1]?.orgCode || !team.documentCode) continue;
    const singles = team.singles || [];
    const decidedCount = +score[1] + +score[2];
    if (singles.length !== 5 || decidedCount < 3 || decidedCount > 5) continue;
    const tally = [0, 0];
    let valid = true;
    for (let i = 0; i < decidedCount; i++) {
      const single = singles[i], s = String(single.overallScore || "").match(/^(\d+)-(\d+)$/);
      if (!s || +s[1] === +s[2] || Math.max(+s[1], +s[2]) < 3 ||
          single.resultOutcomeMissing || !single.gameScores?.length ||
          single.competitors?.[0]?.orgCode !== team.teams?.[0]?.orgCode ||
          single.competitors?.[1]?.orgCode !== team.teams?.[1]?.orgCode) { valid = false; break; }
      tally[+s[1] > +s[2] ? 0 : 1]++;
      if (i < decidedCount - 1 && Math.max(...tally) >= 3) { valid = false; break; }
    }
    if (!valid || tally[0] !== +score[1] || tally[1] !== +score[2]) continue;
    for (const single of singles.slice(decidedCount)) {
      if (single.overallScore !== "0-0" || single.gameScores?.length || single.resultStatus ||
          single.resultOutcomeMissing || single.scoreDetailMissing || single.recordWinnerEvidence) continue;
      if (!single.competitors?.every(s => s?.name && s?.orgCode) || single.competitors.length !== 2) continue;
      keys.add(slotKey(team.documentCode, single.competitors?.[0], single.competitors?.[1]));
    }
  }
  return keys;
}

function isVerifiedUnplayedTeamSlot(match, keys) {
  const record = match?.record;
  return record?.overallScore === "0-0" && !record.resultOutcomeMissing && !record.scoreDetailMissing &&
    !record.resultStatus && !record.gameScores?.length &&
    keys.has(slotKey(match.documentCode, record.left, record.right));
}

function matchKey(match) {
  const r = match?._sourceRecord;
  if (!r || r.resultOutcomeMissing || r.scoreDetailMissing || r.participantDetailMissing || match.participantDetailMissing) return null;
  if ([r.left, r.right].some(s => s?.participantDetailMissing || s?.players?.some(p => p?.participantDetailMissing))) return null;
  if ((r.left?.players?.length || 1) !== 1 || (r.right?.players?.length || 1) !== 1) return null;
  const side = s => {
    const name = String(s?.name || "").normalize("NFKC").trim().toLowerCase();
    const org = String(s?.orgCode || "").trim().toUpperCase();
    return name && org ? `${name}\u0001${org}` : null;
  };
  const left = side(r.left), right = side(r.right);
  const score = String(r.overallScore || ""), games = r.gameScores;
  if (!left || !right || !/^\d+-\d+$/.test(score) || score === "0-0" ||
      !Array.isArray(games) || !games.length || !games.every(g => /^\d+-\d+$/.test(g))) return null;
  const reverse = left > right;
  const orient = value => reverse ? value.split("-").reverse().join("-") : value;
  const gender = String(match.categoryName || "").match(/^(Men|Women) (?:Singles|Teams)$/i)?.[1]?.toLowerCase();
  if (!gender) return null;
  return JSON.stringify([gender, ...[left, right].sort(), orient(score), games.map(orient)]);
}

function reconcileVerifiedCareerSources(events) {
  const list = Array.isArray(events) ? events : [];
  const eligible = list.filter(e => VERIFIED_TEAM_SOURCES.has(String(e.event)) &&
    /2019/.test(e.eventName || "") && /european/i.test(e.eventName || ""));
  if (eligible.length !== 2 || new Set(eligible.map(e => String(e.event))).size !== 2) return list;
  const primary = eligible.find(e => String(e.event) === "5067");
  const secondary = eligible.find(e => String(e.event) === "ETTU2019T");
  const counts = matches => {
    const map = new Map();
    for (const m of matches || []) {
      const key = matchKey(m);
      if (key) map.set(key, (map.get(key) || 0) + 1);
    }
    return map;
  };
  const a = counts(primary.matches), b = counts(secondary.matches);
  // Repeated pair/score combinations are retained, not guessed.
  const extra = (secondary.matches || []).filter(m => {
    const key = matchKey(m);
    return !key || a.get(key) !== 1 || b.get(key) !== 1;
  });
  return list.filter(e => e !== secondary).map(e => e === primary
    ? { ...e, matches: [...(e.matches || []), ...extra] }
    : e);
}

module.exports = { reconcileVerifiedCareerSources, getVerifiedUnplayedTeamSlots, isVerifiedUnplayedTeamSlot };
