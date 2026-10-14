"use strict";

const API_BASE = "https://testbackend.stupaevents.com/";
const EVENT_ID = "167";
const SOURCE_EVENT_ID = "5440";
const EVENT_URL = "https://www.ettu.tv/events/167/4/1/5/5";
const EVENT_START = "2026-10-11";
const EVENT_END = "2026-10-18";
const EVENT_NAME = "2026 European Individual Championships";

function assert(condition, message) {
  if (!condition) throw new Error(`ETTU results: ${message}`);
}

function categoryInfo(category) {
  const abbr = String(category.abbr || "").toUpperCase();
  const map = {
    MS: ["Men Singles", "singles", "men"], WS: ["Women Singles", "singles", "women"],
    MD: ["Men Doubles", "doubles", "men"], WD: ["Women Doubles", "doubles", "women"],
    XD: ["Mixed Doubles", "mixed", "mixed"],
  };
  assert(map[abbr], `unsupported category ${abbr}`);
  const [categoryName, discipline, gender] = map[abbr];
  return { categoryName, discipline, gender, subEventType: categoryName };
}

function normalizeEttuMatch(match, context = {}) {
  const category = context.category;
  assert(category, "category metadata is required");
  const info = categoryInfo(category);
  const isKo = Boolean(context.isKo);
  const published = isKo ? match?.leg_details?.some((leg) => leg?.score_published === true) : match?.score_published === true;
  const status = String(isKo ? (match?.leg_details || []).find((leg) => leg?.status)?.status : match?.status || "").toUpperCase();
  const wonByWalkover = ["WO", "W/O", "WALKOVER", "WALK OVER"].includes(status) || match?.participants?.some((p) => p?.walkover === true || String(p?.walkover_reason || "").toLowerCase().replace(/[ _-]/g, "") === "walkover");
  if (!published || (!wonByWalkover && status !== "SCORED")) return null;

  const participants = match?.participants;
  assert(Array.isArray(participants) && participants.length === 2, `completed match ${match?.id} must have two participants`);
  const identities = participants.map((p) => {
    const name = String(p?.participant_name || "").trim();
    assert(name && p?.participant_id != null, `completed match ${match?.id} has incomplete participant identity`);
    const details = Array.isArray(p.participant_details) ? p.participant_details : [];
    const parentsByRole = new Map((p?.selected_parents || []).map((parent) => [String(parent.user_role_id), parent]));
    const players = details.map((d, i) => {
      const parent = parentsByRole.get(String(d?.user_role_id)) || p?.selected_parents?.[0];
      return {
        id: d?.license_id ?? d?.meta_data?.license_id ?? p.participant_id,
        name: String(d?.name || (details.length === 1 ? name : "")).trim(),
        org: String(parent?.parent_name || d?.parent_name || d?.meta_data?.country || "").trim(),
        orgCode: parent?.parent_abbr || null,
        position: i + 1,
      };
    }).filter((x) => x.name);
    if (!players.length) players.push({ id: p.participant_id, name, org: String(p?.selected_parents?.[0]?.parent_name || ""), orgCode: p?.selected_parents?.[0]?.parent_abbr || null, position: 1 });
    const orgs = [...new Set(players.map((x) => x.org).filter(Boolean))];
    const isWalkoverLoser = wonByWalkover && String(p.participant_id) !== String(match.winner ?? match.match_winner);
    const orgCodes = [...new Set(players.map((player) => player.orgCode).filter(Boolean))];
    return { type: info.discipline === "singles" ? "player" : "pair", id: p.participant_id, name, org: orgs.length === 1 ? orgs[0] : "", orgCode: orgCodes.join("/") || null, irm: isWalkoverLoser ? "WO" : null, players };
  });

  let gameScores = [];
  if (!wonByWalkover) {
    let points;
    if (isKo) {
      points = participants.map((p) => p.participant_points);
    } else points = participants.map((p) => p.points);
    points = points.map((games) => Array.isArray(games) ? [...games] : games);
    assert(Array.isArray(points) && points.length === 2 && points.every(Array.isArray), `completed match ${match.id} has malformed game scores`);
    while (points[0].length && points[1].length && Number(points[0].at(-1)) === 0 && Number(points[1].at(-1)) === 0) {
      points[0].pop();
      points[1].pop();
    }
    const count = Math.max(points[0].length, points[1].length);
    assert(count >= 3 && count <= 7 && points[0].length === points[1].length, `completed match ${match.id} has invalid game count`);
    gameScores = points[0].map((a, i) => {
      const b = points[1][i];
      assert(Number.isInteger(Number(a)) && Number.isInteger(Number(b)), `completed match ${match.id} has nonnumeric points`);
      const x = Number(a), y = Number(b);
      const high = Math.max(x, y), low = Math.min(x, y);
      assert(low >= 0 && ((high === 11 && low <= 9) || (high > 11 && high - low === 2)), `completed match ${match.id} has invalid game score ${x}-${y}`);
      return `${x}-${y}`;
    });
    const sets = gameScores.reduce((wins, score) => { const [a, b] = score.split("-").map(Number); wins[a > b ? 0 : 1]++; return wins; }, [0, 0]);
    const declaredWinner = isKo ? match.match_winner : match.winner;
    const declaredId = typeof declaredWinner === "object" ? declaredWinner?.participant_id ?? declaredWinner?.id : declaredWinner;
    const maxSets = Math.max(...sets);
    assert([3, 4].includes(maxSets) && Math.min(...sets) < maxSets && count <= (maxSets === 3 ? 5 : 7), `completed match ${match.id} has nonterminal/invalid set score ${sets.join("-")}`);
    const expected = sets[0] > sets[1] ? participants[0].participant_id : participants[1].participant_id;
    assert(String(declaredId) === String(expected), `completed match ${match.id} winner disagrees with game scores`);
  }

  let roundLabel = String(isKo ? (context.roundName || "") : (context.groupName || "Group Stage")).trim() || "Group Stage";
  let roundKey;
  if (!isKo) roundKey = "group";
  else if (context.stageName === "Qual. Stage") {
    const qualifyingRound = Number(context.roundIndex) + 1;
    roundLabel = `Qualifying Round ${qualifyingRound}`;
    roundKey = `qualifying_round_${qualifyingRound}`;
  } else {
    const normalizedLabel = roundLabel.toLowerCase().replace(/[_-]+/g, " ");
    const knownRound = normalizedLabel.match(/round of (256|128|64|32|16|8)|quarter ?final|semi ?final|\bfinal\b/);
    if (knownRound) {
      const token = knownRound[0];
      if (/quarter/.test(token) || token === "round of 8") { roundKey = "quarterfinal"; roundLabel = "Quarterfinal"; }
      else if (/semi/.test(token)) { roundKey = "semifinal"; roundLabel = "Semifinal"; }
      else if (token === "final") { roundKey = "final"; roundLabel = "Final"; }
      else { const size = token.match(/\d+/)[0]; roundKey = `round_of_${size}`; roundLabel = `Round of ${size}`; }
    } else roundKey = normalizedLabel.replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  }
  const startTime = isKo ? (match.leg_details || []).find((x) => x?.start_time)?.start_time : match.start_time;
  const playedDate = startTime ? new Date(startTime) : null;
  assert(playedDate && !Number.isNaN(playedDate.getTime()), `completed match ${match.id} has invalid/missing date`);
  const date = String(startTime).slice(0, 10);
  assert(date >= EVENT_START && date <= EVENT_END, `match ${match.id} date ${date} is outside event dates`);

  const documentCode = `ETTU167-${context.stageId}-${match.id}`;
  const rawWinner = match.winner ?? match.match_winner;
  const winner = typeof rawWinner === "object" ? rawWinner?.participant_id ?? rawWinner?.id : rawWinner == null ? null : String(rawWinner);
  if (wonByWalkover) {
    assert(participants.some((p) => String(p.participant_id) === String(winner)), `walkover match ${match.id} lacks a verified winner`);
    const winnerFlags = participants.filter((p) => p?.walkover === true || String(p?.walkover_reason || "").toLowerCase().replace(/[ _-]/g, "") === "walkover");
    assert(winnerFlags.length === 1 && String(winnerFlags[0].participant_id) === String(winner), `walkover match ${match.id} does not identify its verified winning participant`);
  }
  const overallScore = wonByWalkover
    ? (String(participants[0].participant_id) === String(winner) ? "W-L" : "L-W")
    : `${gameScores.filter((s) => Number(s.split("-")[0]) > Number(s.split("-")[1])).length}-${gameScores.filter((s) => Number(s.split("-")[0]) < Number(s.split("-")[1])).length}`;

  return {
    matchType: "individual", id: String(match.id), eventId: SOURCE_EVENT_ID,
    documentCode, subEventType: info.subEventType, categoryName: info.categoryName,
    discipline: info.discipline, gender: info.gender, roundLabel,
    roundKey,
    matchNumber: Number(match.id), description: `${info.categoryName} - ${roundLabel}`,
    venue: null, table: null, overallScore, resultStatus: wonByWalkover ? "WO" : "1",
    isParaClass: false, teams: [], singles: [], competitors: identities,
    gameScores, source: "wtt", recordSource: "ettu", recordEventId: EVENT_ID,
    recordUrl: EVENT_URL, recordStartDate: EVENT_START, recordEndDate: EVENT_END,
    recordEventName: EVENT_NAME, date, startDateLocal: startTime, startDateUtc: null,
    raw: { id: match.id, status, winner: winner ?? match.match_winner ?? null, participants: participants.map((p) => ({ participant_id: p.participant_id, participant_name: p.participant_name, points: p.points ?? p.participant_points, sets: p.sets ?? p.participant_sets, sets_won: p.sets_won ?? p.aggregated?.sets_won_total, selected_parents: p.selected_parents?.map((x) => ({ parent_role: x.parent_role, parent_abbr: x.parent_abbr, parent_name: x.parent_name, user_role_id: x.user_role_id })) })), leg_details: isKo ? match.leg_details?.map((leg) => ({ status: leg.status, score_published: leg.score_published, start_time: leg.start_time, date: leg.date })) : undefined, start_time: startTime ?? null },
  };
}

async function fetchEttuOfficialResults(eventId, options = {}) {
  if (String(eventId) !== SOURCE_EVENT_ID) return [];
  const fetchImpl = options.fetchImpl || fetch;
  const request = async (path) => {
    const url = new URL(path, API_BASE);
    const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 15000;
    const response = await fetchImpl(url, { headers: { tenant: "ettu", language: "en" }, signal: AbortSignal.timeout(timeoutMs) });
    assert(response?.ok, `HTTP ${response?.status} for ${url.pathname}`);
    let body;
    try { body = await response.json(); } catch { throw new Error(`ETTU results: invalid JSON from ${url.pathname}`); }
    assert(body && typeof body === "object" && !Array.isArray(body), `malformed response from ${url.pathname}`);
    return body;
  };
  const unwrap = (body, key) => {
    const data = body.data;
    const value = key ? (Array.isArray(data) && key === "groups" ? data : data?.[key]) : data;
    assert(Array.isArray(value), `missing ${key || "data"} array`);
    const total = body.total ?? data?.total;
    if (Number.isFinite(total)) assert(value.length >= total, `truncated ${key || "data"} response`);
    return value;
  };

  const events = unwrap(await request("ott/v1/get_events?published=true&event_ids=167"));
  const event = events.find((x) => String(x.id) === EVENT_ID);
  assert(event && event.name === EVENT_NAME && String(event.event_start_date).slice(0, 10) === EVENT_START && String(event.event_end_date).slice(0, 10) === EVENT_END, "event metadata did not match verified event 167 identity/dates");
  const categories = unwrap(await request("ott/v1/get_events_categories?event_id=167&sort_by_id=true&include_subcategories=true"));
  const wanted = new Set(["MS", "WS", "MD", "WD", "XD"]);
  const categoryById = new Map();
  for (const category of categories) if (wanted.has(String(category.abbr).toUpperCase())) categoryById.set(String(category.id), category);
  assert(wanted.size === categoryById.size, "one or more expected event categories are missing");
  for (const category of categoryById.values()) assert(String(category.event_id) === EVENT_ID, `category ${category.id} belongs to another event`);
  const stages = unwrap(await request("ott/v1/get_stages?event_id=167"));
  const publishedStages = stages.filter((s) => s?.is_published === true);
  assert(publishedStages.length, "no published stages returned");
  const expectedStageIds = ["2491", "2492", "2493", "2494", "2495", "2514", "2515", "2519", "2520", "2523"];
  const publishedIds = new Set(publishedStages.map((stage) => String(stage.id)));
  assert(expectedStageIds.every((id) => publishedIds.has(id)), "one or more expected published stages are missing");
  const results = [];
  for (const stage of publishedStages) {
    const category = categoryById.get(String(stage.event_category_id));
    assert(category, `published stage ${stage.id} has unknown category`);
    const isKo = Number(stage.format_id) === 2;
    assert(isKo || Number(stage.format_id) === 1, `published stage ${stage.id} has unknown format`);
    const path = isKo
      ? `ott/v1/get_knockout_matches?stage_id=${encodeURIComponent(stage.id)}&only_published_rounds=true`
      : `ott/v1/get_group_matches?stage_id=${encodeURIComponent(stage.id)}&view=standard&show_matrix=true&fetch_point_system=true`;
    const payload = await request(path);
    const matches = [];
    if (isKo) {
      const data = payload.data;
      assert(data && typeof data === "object", `malformed knockout data for stage ${stage.id}`);
      assert(Array.isArray(data.main_bracket), `missing knockout bracket for stage ${stage.id}`);
      assert(!data.position_brackets || (Array.isArray(data.position_brackets) && data.position_brackets.length === 0), `unsupported position brackets for stage ${stage.id}`);
      for (let roundIndex = 0; roundIndex < data.main_bracket.length; roundIndex++) {
        const round = data.main_bracket[roundIndex];
        assert(Array.isArray(round.matches), `malformed knockout round in stage ${stage.id}`);
        for (const match of round.matches) matches.push({ match, roundName: round.round_name, roundIndex });
      }
      const totalMatches = payload.total ?? data.total_matches;
      if (Number.isFinite(totalMatches)) assert(matches.length >= totalMatches, `truncated knockout stage ${stage.id}`);
    } else {
      const groups = unwrap(payload, "groups");
      for (const group of groups) {
        assert(Array.isArray(group.matches), `malformed group matches in stage ${stage.id}`);
        matches.push(...group.matches.map((match) => ({ match, groupName: group.name })));
      }
    }
    for (const entry of matches) {
      const match = entry.match;
      const status = String(isKo ? (match?.leg_details || []).find((leg) => leg?.status)?.status : match?.status || "").toUpperCase();
      const published = isKo ? match?.leg_details?.some((leg) => leg?.score_published === true) : match?.score_published === true;
      if (match?.participants?.some((p) => String(p?.participant_name).toUpperCase() === "BYE" || (isKo && String(p?.participant_id) === "1"))) continue;
      if (!published || !["SCORED", "WO", "W/O", "WALKOVER", "WALK OVER"].includes(status)) continue;
      const normalized = normalizeEttuMatch(match, { category, isKo, stageId: stage.id, stageName: stage.name, roundName: entry.roundName, groupName: entry.groupName, roundIndex: entry.roundIndex, formatId: stage.format_id });
      if (normalized) results.push(normalized);
    }
  }
  return [...new Map(results.map((record) => [record.documentCode, record])).values()];
}

module.exports = { fetchEttuOfficialResults, normalizeEttuMatch };
