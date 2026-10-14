"use strict";

const API_BASE = "https://testbackend.stupaevents.com/ott/v1/";
const API_EVENT_ID = "71";

function assert(condition, message) {
  if (!condition) throw new Error(`ETTU team results: ${message}`);
}

function requiredText(value, label) {
  const text = String(value ?? "").trim();
  assert(text, `config.${label} is required`);
  return text;
}

function getCategoryInfo(category) {
  const description = String(category?.category_description || "").trim();
  const match = description.match(/^(men|women)(?:'s)?\s+teams?$/i);
  assert(match, `unsupported team category description ${description || "(empty)"}`);
  const gender = match[1].toLowerCase();
  return { gender, categoryName: `${gender === "men" ? "Men" : "Women"} Teams` };
}

function idOf(value) {
  const id = value && typeof value === "object" ? value.participant_id ?? value.id : value;
  return id == null ? null : String(id);
}

function isWalkoverStatus(status) {
  return ["WO", "W/O", "WALKOVER", "WALK OVER"].includes(String(status || "").toUpperCase());
}

function hasWalkoverFlag(participant) {
  return participant?.walkover === true || String(participant?.walkover_reason || "").toLowerCase().replace(/[ _-]/g, "") === "walkover";
}

function memberAssociation(participant, label) {
  const parents = Array.isArray(participant?.selected_parents) ? participant.selected_parents : [];
  const association = parents.find((parent) => String(parent?.parent_role || "").trim().toLowerCase() === "member association");
  assert(association, `${label} has no Member Association identity`);
  const name = String(association.parent_name || "").trim();
  const code = String(association.parent_abbr || "").trim();
  assert(name && code, `${label} has incomplete Member Association identity`);
  return { name, code };
}

function teamIdentity(participant, label) {
  const id = participant?.participant_id;
  const name = String(participant?.participant_name || "").trim();
  assert(id != null && name, `${label} has incomplete team identity`);
  const association = memberAssociation(participant, label);
  return {
    id: String(id),
    name,
    org: association.name,
    orgCode: association.code,
  };
}

function childPlayerIdentity(participant, label) {
  const details = Array.isArray(participant?.participant_details) ? participant.participant_details : [];
  assert(details.length === 1, `${label} must identify exactly one singles player`);
  const detail = details[0];
  const name = String(detail?.name || "").trim();
  const licenseId = detail?.license_id ?? detail?.meta_data?.license_id;
  assert(name && licenseId != null && String(licenseId).trim(), `${label} has incomplete player/license identity`);
  const association = memberAssociation(participant, label);
  return {
    id: String(licenseId),
    name,
    org: association.name,
    orgCode: association.code,
    position: 1,
  };
}

function scoreGames(match, participants, label) {
  const points = participants.map((participant) => participant.points ?? participant.participant_points);
  assert(points.every(Array.isArray), `${label} has malformed game points`);
  const games = points.map((side) => [...side]);
  while (games[0].length && games[1].length && Number(games[0].at(-1)) === 0 && Number(games[1].at(-1)) === 0) {
    games[0].pop();
    games[1].pop();
  }
  assert(games[0].length === games[1].length && games[0].length >= 3 && games[0].length <= 5, `${label} has invalid game count`);
  const gameScores = games[0].map((sideA, index) => {
    const sideB = games[1][index];
    assert(Number.isInteger(Number(sideA)) && Number.isInteger(Number(sideB)), `${label} has nonnumeric game points`);
    const a = Number(sideA);
    const b = Number(sideB);
    const high = Math.max(a, b);
    const low = Math.min(a, b);
    assert(low >= 0 && ((high === 11 && low <= 9) || (high > 11 && high - low === 2)), `${label} has invalid game score ${a}-${b}`);
    return `${a}-${b}`;
  });
  const sets = gameScores.reduce((wins, score) => {
    const [a, b] = score.split("-").map(Number);
    wins[a > b ? 0 : 1]++;
    return wins;
  }, [0, 0]);
  assert(Math.max(...sets) === 3 && Math.min(...sets) < 3 && gameScores.length <= 5, `${label} has nonterminal/invalid game result ${sets.join("-")}`);
  const declaredWinner = idOf(match?.winner);
  const expectedWinner = String(participants[sets[0] > sets[1] ? 0 : 1].participant_id);
  assert(declaredWinner === expectedWinner, `${label} winner disagrees with game scores`);
  participants.forEach((participant, index) => {
    if (participant.sets_won != null) assert(Number(participant.sets_won) === sets[index], `${label} participant sets_won disagrees with game scores`);
  });
  return { gameScores, sets, winner: expectedWinner };
}

function normalizeSubMatch(match, order, parentTeams, categoryName, stageId) {
  const label = `stage ${stageId} sub-match ${match?.id ?? order}`;
  const participants = match?.participants;
  assert(Array.isArray(participants) && participants.length === 2, `${label} must have two participants`);
  const ids = participants.map((participant) => String(participant?.participant_id ?? ""));
  assert(ids.every((id) => parentTeams.some((team) => team.id === id)), `${label} participant is not one of its parent teams`);
  const status = String(match?.status || "").trim().toUpperCase();
  const winner = idOf(match?.winner);
  const played = status === "SCORED" || isWalkoverStatus(status) || participants.some(hasWalkoverFlag);
  assert(played, `${label} has unsupported status ${status || "(empty)"}`);
  assert(winner && participants.some((participant) => String(participant.participant_id) === winner), `${label} has no verified winner`);
  const winnerIndex = participants.findIndex((participant) => String(participant.participant_id) === winner);
  const wonByWalkover = isWalkoverStatus(status) || participants.some(hasWalkoverFlag);

  const competitors = participants.map((participant, index) => {
    const team = parentTeams.find((entry) => entry.id === String(participant.participant_id));
    const player = childPlayerIdentity(participant, label);
    return {
      type: "player",
      id: player.id,
      name: player.name,
      org: team.org,
      orgCode: team.orgCode,
      irm: wonByWalkover && index !== winnerIndex ? "WO" : null,
      players: [{ ...player, org: team.org, orgCode: team.orgCode }],
    };
  });
  const winnerOrg = competitors[winnerIndex].org;
  let gameScores = [];
  let overallScore;
  let resultStatus;
  if (wonByWalkover) {
    assert(participants.some((participant) => hasWalkoverFlag(participant) && String(participant.participant_id) === winner), `${label} walkover does not flag its verified winner`);
    overallScore = winnerIndex === 0 ? "W-L" : "L-W";
    resultStatus = "WO";
  } else {
    const scored = scoreGames(match, participants, label);
    gameScores = scored.gameScores;
    overallScore = scored.sets.join("-");
    resultStatus = "1";
  }
  const rawParticipants = participants.map((participant, index) => ({
    participant_id: participant.participant_id,
    player: competitors[index].players[0],
    points: wonByWalkover ? null : [...(participant.points ?? participant.participant_points)],
    sets_won: wonByWalkover ? null : (participant.sets_won ?? null),
  }));

  return {
    single: {
      order: Number(match.order ?? order),
      documentCode: `ETTU${API_EVENT_ID}-${stageId}-${match.id}`,
      description: `${categoryName} - Match ${Number(match.order ?? order)}`,
      overallScore,
      resultStatus,
      gameScores,
      competitors,
      winnerOrg,
    },
    winner,
    wonByWalkover,
    raw: { id: match.id, status, winner, participants: rawParticipants },
  };
}

function roundKey(label, isGroup) {
  if (isGroup) return "group";
  const normalized = String(label || "").trim().toLowerCase().replace(/[_-]+/g, " ");
  if (/^(quarter ?finals?)$/.test(normalized)) return "quarterfinal";
  if (/^(semi ?finals?)$/.test(normalized)) return "semifinal";
  if (/^finals?$/.test(normalized)) return "final";
  const round = normalized.match(/^round of (\d+)$/);
  if (round) return `round_of_${round[1]}`;
  return normalized.replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "unknown";
}

function normalizeParentMatch({ match, detailMatch, stage, category, groupName, roundName, config }) {
  const label = `stage ${stage.id} team match ${match?.id ?? "(unknown)"}`;
  const sourceMatch = detailMatch || match;
  const participants = sourceMatch?.participants;
  assert(Array.isArray(participants) && participants.length === 2, `${label} must have two teams`);
  const status = String(sourceMatch?.status || (match?.leg_details || []).find((leg) => leg?.status)?.status || "").trim().toUpperCase();
  const isPublished = Number(stage.format_id) === 2
    ? (match?.leg_details || []).some((leg) => leg?.score_published === true)
    : sourceMatch?.score_published === true;
  if (!isPublished) return { skipped: "unpublished" };
  if (["NOT_STARTED", "SCHEDULED", "LIVE", "IN_PROGRESS"].includes(status)) return { skipped: "unplayed" };
  const wonByWalkover = isWalkoverStatus(status) || participants.some(hasWalkoverFlag);
  assert(status === "SCORED" || wonByWalkover, `${label} has unsupported published status ${status || "(empty)"}`);
  const teams = participants.map((participant, index) => teamIdentity(participant, `${label} team ${index + 1}`));
  assert(teams[0].id !== teams[1].id, `${label} has duplicate teams`);
  const winner = idOf(sourceMatch?.winner ?? match?.match_winner);
  assert(winner && teams.some((team) => team.id === winner), `${label} has no verified team winner`);
  const bracketWinner = idOf(match?.match_winner);
  if (bracketWinner) assert(bracketWinner === winner, `${label} bracket winner disagrees with detailed match winner`);

  const children = sourceMatch?.sub_matches;
  assert(Array.isArray(children), `${label} is missing detailed sub_matches`);
  const playedChildren = children.filter((child) => String(child?.status || "").trim().toUpperCase() !== "NOT_STARTED");
  const singles = [];
  const childResults = [];
  for (const [index, child] of playedChildren.entries()) {
    const order = child?.order ?? (index + 1);
    const normalized = normalizeSubMatch(child, order, teams, category.categoryName, stage.id);
    singles.push(normalized.single);
    childResults.push(normalized);
  }

  let overallScore;
  let resultStatus;
  if (wonByWalkover) {
    overallScore = teams[0].id === winner ? "W-L" : "L-W";
    resultStatus = "WO";
  } else {
    assert(childResults.length > 0, `${label} has no played table matches`);
    const wins = teams.map((team) => childResults.filter((child) => child.winner === team.id).length);
    assert(wins[0] !== wins[1] && teams[wins[0] > wins[1] ? 0 : 1].id === winner, `${label} winner disagrees with played table matches`);
    participants.forEach((participant, index) => {
      assert(Number.isInteger(Number(participant.sets_won)) && Number(participant.sets_won) === wins[index], `${label} team sets_won disagrees with played table matches`);
    });
    overallScore = wins.join("-");
    resultStatus = "1";
  }

  const isGroup = Number(stage.format_id) === 1;
  const roundLabel = String(isGroup ? (groupName || "Group Stage") : (roundName || stage.name || "Knockout Stage")).trim();
  const startTime = isGroup
    ? (sourceMatch.start_time || sourceMatch.date)
    : ((match.leg_details || []).find((leg) => leg?.start_time)?.start_time || sourceMatch.start_time || sourceMatch.date);
  assert(startTime && !Number.isNaN(new Date(startTime).getTime()), `${label} has invalid/missing start time`);
  const date = String(startTime).slice(0, 10);
  assert(date >= config.startDate && date <= config.endDate, `${label} date ${date} is outside configured event dates`);

  const categoryDescription = category.category_description;
  const rawMatchNumber = sourceMatch.order ?? sourceMatch.match_order;
  const matchNumber = rawMatchNumber == null || rawMatchNumber === "" ? null : Number(rawMatchNumber);
  const rawParticipants = participants.map((participant, index) => ({
    participant_id: participant.participant_id,
    participant_name: participant.participant_name,
    sets_won: participant.sets_won ?? null,
    member_association: { name: teams[index].org, abbr: teams[index].orgCode },
  }));
  return {
    match: {
      matchType: "team",
      id: String(match.id),
      eventId: config.eventId,
      documentCode: `ETTU${config.recordEventId}-${stage.id}-${match.id}`,
      subEventType: categoryDescription,
      categoryName: category.categoryName,
      discipline: "teams",
      gender: category.gender,
      roundLabel,
      roundKey: roundKey(roundLabel, isGroup),
      matchNumber: Number.isInteger(matchNumber) ? matchNumber : null,
      description: `${category.categoryName} - ${roundLabel}`,
      venue: null,
      table: null,
      startDateLocal: startTime,
      startDateUtc: null,
      overallScore,
      resultStatus,
      teams: teams.map(({ id, name, org, orgCode }) => ({ id, name, org, orgCode })),
      singles,
      competitors: [],
      gameScores: [],
      source: "wtt",
      recordSource: "ettu",
      recordEventId: config.recordEventId,
      recordUrl: config.recordUrl,
      recordStartDate: config.startDate,
      recordEndDate: config.endDate,
      recordEventName: config.eventName,
      date,
      raw: {
        id: match.id,
        stage_id: stage.id,
        status,
        winner,
        participants: rawParticipants,
        sub_matches: childResults.map((child) => child.raw),
      },
    },
  };
}

async function fetchEttuTeamOfficialResults(config, options = {}) {
  assert(config && typeof config === "object" && !Array.isArray(config), "event config is required");
  const normalizedConfig = {
    eventId: requiredText(config.eventId, "eventId"),
    eventName: requiredText(config.eventName ?? config.name, "eventName"),
    startDate: requiredText(config.startDate, "startDate"),
    endDate: requiredText(config.endDate, "endDate"),
    recordEventId: requiredText(config.recordEventId, "recordEventId"),
    recordUrl: requiredText(config.recordUrl ?? config.recordURL, "recordUrl"),
  };
  assert(normalizedConfig.recordEventId === API_EVENT_ID, `recordEventId must be ${API_EVENT_ID}`);
  assert(/^\d{4}-\d{2}-\d{2}$/.test(normalizedConfig.startDate) && /^\d{4}-\d{2}-\d{2}$/.test(normalizedConfig.endDate) && normalizedConfig.startDate <= normalizedConfig.endDate, "configured event dates are invalid");
  let recordUrl;
  try { recordUrl = new URL(normalizedConfig.recordUrl); } catch { throw new Error("ETTU team results: config.recordUrl must be an absolute URL"); }
  assert(["http:", "https:"].includes(recordUrl.protocol), "config.recordUrl must use HTTP or HTTPS");

  const fetchImpl = options.fetchImpl || fetch;
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : 15000;
  const request = async (path) => {
    const url = new URL(path, API_BASE);
    let response;
    try {
      response = await fetchImpl(url, {
        headers: { tenant: "ettu", language: "en" },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw new Error(`ETTU team results: request failed for ${url.pathname}: ${error?.name === "TimeoutError" ? "timeout" : String(error?.message || error)}`);
    }
    assert(response?.ok, `HTTP ${response?.status} for ${url.pathname}`);
    let body;
    try { body = await response.json(); } catch { throw new Error(`ETTU team results: invalid JSON from ${url.pathname}`); }
    assert(body && typeof body === "object" && !Array.isArray(body), `malformed response from ${url.pathname}`);
    return body;
  };
  const unwrapArray = (body, key, path) => {
    const data = body.data;
    const array = Array.isArray(data) ? data : (key ? data?.[key] : null);
    assert(Array.isArray(array), `missing ${key || "data"} array from ${path}`);
    const total = body.total ?? (data && !Array.isArray(data) ? data.total : undefined);
    if (Number.isFinite(total)) assert(array.length >= total, `truncated ${key || "data"} response from ${path}`);
    return array;
  };

  const eventPath = "get_events?published=true&event_ids=71";
  const events = unwrapArray(await request(eventPath), null, "get_events");
  const event = events.find((entry) => String(entry?.id) === API_EVENT_ID);
  assert(event && String(event.name || "").trim() === normalizedConfig.eventName && String(event.event_start_date || "").slice(0, 10) === normalizedConfig.startDate && String(event.event_end_date || "").slice(0, 10) === normalizedConfig.endDate, "event metadata did not match configured event 71 identity/dates");

  const categoryPath = "get_events_categories?event_id=71&sort_by_id=true&include_subcategories=true";
  const categories = unwrapArray(await request(categoryPath), null, "get_events_categories");
  const categoryById = new Map();
  const categoriesByGender = new Set();
  for (const category of categories) {
    if (String(category?.event_id) !== API_EVENT_ID) continue;
    const info = getCategoryInfo(category);
    assert(!categoriesByGender.has(info.gender), `duplicate ${info.gender} team category`);
    categoriesByGender.add(info.gender);
    categoryById.set(String(category.id), { ...info, category_description: String(category.category_description).trim() });
  }
  assert(categoriesByGender.has("men") && categoriesByGender.has("women"), "missing men's or women's event category");

  const stagesPath = "get_stages?event_id=71";
  const stages = unwrapArray(await request(stagesPath), null, "get_stages");
  const publishedStages = stages.filter((stage) => stage?.is_published === true);
  assert(publishedStages.length > 0, "no published stages returned");
  const matches = [];
  const counts = {
    publishedStages: publishedStages.length,
    groupStages: 0,
    knockoutStages: 0,
    parentMatches: 0,
    publishedParentMatches: 0,
    completedParentMatches: 0,
    skippedUnpublished: 0,
    skippedUnplayed: 0,
    playedSubMatches: 0,
    skippedNotStartedSubMatches: 0,
  };

  for (const stage of publishedStages) {
    const category = categoryById.get(String(stage?.event_category_id));
    assert(category, `published stage ${stage?.id} has unknown event category`);
    const formatId = Number(stage.format_id);
    assert(formatId === 1 || formatId === 2, `published stage ${stage.id} has unknown format ${stage.format_id}`);
    const isKnockout = formatId === 2;
    if (isKnockout) counts.knockoutStages++;
    else counts.groupStages++;

    const matchEntries = [];
    let detailByMatchId = null;
    if (isKnockout) {
      const path = `get_knockout_matches?stage_id=${encodeURIComponent(stage.id)}&only_published_rounds=true`;
      const payload = await request(path);
      const data = payload.data;
      assert(data && typeof data === "object" && Array.isArray(data.main_bracket), `missing main bracket for stage ${stage.id}`);
      if (data.position_brackets != null) {
        assert(Array.isArray(data.position_brackets), `malformed position brackets for stage ${stage.id}`);
        assert(data.position_brackets.length === 0, `position brackets in stage ${stage.id} are not supported yet; refusing to omit published bracket matches`);
      }
      for (const round of data.main_bracket) {
        assert(Array.isArray(round?.matches), `malformed main bracket round in stage ${stage.id}`);
        for (const match of round.matches) matchEntries.push({ match, roundName: round.round_name });
      }
      const total = payload.total ?? data.total_matches;
      if (Number.isFinite(total)) assert(matchEntries.length >= total, `truncated knockout stage ${stage.id}`);

      const detailPath = `get_group_matches?stage_id=${encodeURIComponent(stage.id)}&view=standard&show_matrix=true&fetch_point_system=true`;
      const detailGroups = unwrapArray(await request(detailPath), "groups", "get_group_matches");
      detailByMatchId = new Map();
      for (const group of detailGroups) {
        assert(Array.isArray(group?.matches), `malformed detailed match list in stage ${stage.id}`);
        for (const detail of group.matches) {
          const id = String(detail?.id ?? "");
          assert(id, `detailed KO match in stage ${stage.id} has no ID`);
          assert(!detailByMatchId.has(id), `duplicate detailed KO match ${id} in stage ${stage.id}`);
          detailByMatchId.set(id, detail);
        }
      }
    } else {
      const path = `get_group_matches?stage_id=${encodeURIComponent(stage.id)}&view=standard&show_matrix=true&fetch_point_system=true`;
      const payload = await request(path);
      const groups = unwrapArray(payload, "groups", "get_group_matches");
      for (const group of groups) {
        assert(Array.isArray(group?.matches), `malformed group matches in stage ${stage.id}`);
        for (const match of group.matches) matchEntries.push({ match, groupName: group.name });
      }
    }

    const seen = new Set();
    for (const entry of matchEntries) {
      const matchId = String(entry.match?.id ?? "");
      assert(matchId, `parent match in stage ${stage.id} has no ID`);
      assert(!seen.has(matchId), `duplicate parent match ${matchId} in stage ${stage.id}`);
      seen.add(matchId);
      counts.parentMatches++;
      const detailMatch = detailByMatchId ? detailByMatchId.get(matchId) : null;
      if (detailByMatchId) assert(detailMatch, `missing detailed sub-match data for KO match ${matchId} in stage ${stage.id}`);
      const normalized = normalizeParentMatch({
        match: entry.match,
        detailMatch,
        stage,
        category,
        groupName: entry.groupName,
        roundName: entry.roundName,
        config: normalizedConfig,
      });
      if (normalized.skipped === "unpublished") {
        counts.skippedUnpublished++;
        continue;
      }
      counts.publishedParentMatches++;
      if (normalized.skipped === "unplayed") {
        counts.skippedUnplayed++;
        continue;
      }
      counts.completedParentMatches++;
      counts.playedSubMatches += normalized.match.singles.length;
      counts.skippedNotStartedSubMatches += Math.max(0, (detailMatch || entry.match).sub_matches.length - normalized.match.singles.length);
      matches.push(normalized.match);
    }
  }

  return { matches, counts };
}

module.exports = { fetchEttuTeamOfficialResults };
