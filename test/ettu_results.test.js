"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { fetchEttuOfficialResults, normalizeEttuMatch } = require("../ettu_results");

const categories = ["MS", "WS", "MD", "WD", "XD"].map((abbr, i) => ({ id: 787 + i, event_id: 167, abbr, name: "2026 European Individual Championships" }));
const stageSpecs = [
  [2491, 788, 1, "Group Stage"], [2492, 787, 1, "Group Stage"], [2493, 791, 2, "Qual. Stage"],
  [2494, 789, 2, "Qual. Stage"], [2495, 790, 2, "Qual. Stage"], [2514, 791, 2, "Main Draw"],
  [2515, 787, 2, "Main Draw"], [2519, 789, 2, "Main Draw"], [2520, 790, 2, "Main Draw"], [2523, 788, 2, "Main Draw"],
];
const stages = stageSpecs.map(([id, event_category_id, format_id, name]) => ({ id, event_category_id, format_id, name, is_published: true }));
const pair = (id, name, points, country = "Belgium") => ({ participant_id: id, participant_name: name, points, participant_sets: points?.length, sets_won: 2, participant_details: [{ name, user_role_id: 1, meta_data: { license_id: `${id}-lic`, country } }], selected_parents: [{ parent_role: "Member Association", parent_abbr: country === "Belgium" ? "BEL" : "FRA", parent_name: country, user_role_id: 2 }] });
const groupMatch = { id: 9001, status: "SCORED", winner: 2, participants: [pair(1, "MLADENOVIC", [9, 7, 11, 11, 8]), pair(2, "KAHN", [11, 11, 8, 6, 11], "France")], start_time: "2026-10-12T09:00:00Z", score_published: true, round: { name: "Group 1", meta: { round_notation: "GP01" } } };
const doublesMatch = { id: 9002, status: "SCORED", winner: 3, participants: [pair(3, "MLADE / DEVOS", [14, 11, 11], "Belgium"), pair(4, "Doubles pair", [12, 8, 9], "France")], start_time: "2026-10-13T09:00:00Z", score_published: true, round: { name: "Quarterfinal" } };

function fixture(overrides = {}) {
  const data = {
    events: [{ id: 167, name: "2026 European Individual Championships", event_start_date: "2026-10-11", event_end_date: "2026-10-18" }],
    categories,
    stages,
    groups: [{ group_id: 1, name: "Group 1", matches: [groupMatch] }],
    knockout: { main_bracket: [{ round_name: "Round of 64", position_range_end: 64, matches: [{ id: 9003, participants: [{ ...pair(5, "One", undefined), participant_points: [11, 9, 11, 11] }, { ...pair(6, "Two", undefined, "France"), participant_points: [8, 11, 7, 5] }], match_winner: 5, leg_details: [{ status: "SCORED", score_published: true, start_time: "2026-10-14T09:00:00Z" }], total_legs: 1 }] }], position_brackets: [], point_system: {} },
  };
  Object.assign(data, overrides);
  return async (url, init) => {
    assert.equal(init.headers.tenant, "ettu");
    assert.equal(init.headers.language, "en");
    const path = new URL(url).pathname;
    let body;
    if (path.endsWith("get_events")) body = { data: data.events };
    else if (path.endsWith("get_events_categories")) body = { data: data.categories };
    else if (path.endsWith("get_stages")) body = { data: data.stages };
    else if (path.endsWith("get_group_matches")) body = { data: data.groups };
    else if (path.endsWith("get_knockout_matches")) body = { data: data.knockout };
    else throw new Error(`unexpected ${path}`);
    return { ok: true, status: 200, json: async () => body };
  };
}

test("only maps source event 5440 and returns group, deuce, doubles, and knockout scores", async () => {
  assert.deepEqual(await fetchEttuOfficialResults("5441", { fetchImpl: fixture() }), []);
  const data = fixture();
  const records = await fetchEttuOfficialResults(5440, { fetchImpl: data });
  const group = records.find((x) => x.id === "9001");
  assert.deepEqual(group.gameScores, ["9-11", "7-11", "11-8", "11-6", "8-11"]);
  assert.equal(group.overallScore, "2-3");
  assert.equal(group.documentCode, "ETTU167-2491-9001");
  assert.equal(group.recordEventId, "167");
  assert.equal(group.recordUrl, "https://www.ettu.tv/events/167/4/1/5/5");
  const doubles = normalizeEttuMatch({ ...doublesMatch, participants: [pair(3, "MLADE / DEVOS", [14, 11, 11]), pair(4, "Opponent", [12, 8, 9], "France")] }, { category: categories[2], stageId: 22, formatId: 1, groupName: "Group 1" });
  assert.equal(doubles.categoryName, "Men Doubles");
  assert.equal(doubles.competitors[0].type, "pair");
  assert.equal(doubles.gameScores[0], "14-12");
  assert.equal(doubles.roundKey, "group");
  const mixedDoubles = normalizeEttuMatch({ ...doublesMatch, winner: 30, participants: [
    { ...pair(30, "Greek player / Scottish player", [11, 11, 11], "Greece"), participant_details: [{ name: "Greek player", user_role_id: 301, meta_data: { country: "Greece" } }, { name: "Scottish player", user_role_id: 302, meta_data: { country: "Scotland" } }], selected_parents: [{ user_role_id: 301, parent_abbr: "GRE", parent_name: "Greece" }, { user_role_id: 302, parent_abbr: "SCO", parent_name: "Scotland" }] },
    { ...pair(31, "Opponents", [8, 8, 8], "France"), selected_parents: [{ user_role_id: 2, parent_abbr: "FRA", parent_name: "France" }] },
  ] }, { category: categories[4], stageId: 23, formatId: 1, groupName: "Group 1" });
  assert.deepEqual(mixedDoubles.competitors[0].players.map((player) => player.orgCode), ["GRE", "SCO"]);
  assert.equal(mixedDoubles.competitors[0].orgCode, "GRE/SCO");
});

test("rejects mismatched event identity, dates, malformed completed scores, and missing published stage data", async () => {
  await assert.rejects(fetchEttuOfficialResults(5440, { fetchImpl: fixture({ events: [{ id: 167, name: "Wrong", event_start_date: "2026-10-11", event_end_date: "2026-10-18" }] }) }), /identity\/dates/);
  await assert.rejects(fetchEttuOfficialResults(5440, { fetchImpl: fixture({ events: [{ id: 167, name: "2026 European Individual Championships", event_start_date: "2026-10-10", event_end_date: "2026-10-18" }] }) }), /identity\/dates/);
  const malformed = { ...groupMatch, winner: 1, participants: [pair(1, "One", [11, 8, 11]), pair(2, "Two", [8, 11, 8], "France")] };
  assert.throws(() => normalizeEttuMatch(malformed, { category: categories[0], stageId: 1, formatId: 1 }), /nonterminal/);
  const dateBad = { ...groupMatch, start_time: "2027-01-01T00:00:00Z" };
  assert.throws(() => normalizeEttuMatch(dateBad, { category: categories[0], stageId: 1, formatId: 1 }), /outside event dates/);
  await assert.rejects(fetchEttuOfficialResults(5440, { fetchImpl: fixture({ stages: [] }) }), /no published stages/);
});

test("fails on HTTP errors and malformed completed match scores", async () => {
  await assert.rejects(fetchEttuOfficialResults(5440, { fetchImpl: async () => ({ ok: false, status: 504 }) }), /HTTP 504/);
  const badScore = { ...groupMatch, participants: [pair(1, "One", [11, 8, 8]), pair(2, "Two", [8, 11, 8], "France")] };
  assert.throws(() => normalizeEttuMatch(badScore, { category: categories[0], stageId: 1, formatId: 1 }), /invalid game score/);
  const impossibleDeuce = { ...groupMatch, participants: [pair(1, "One", [14, 11, 11]), pair(2, "Two", [10, 8, 8])] };
  assert.throws(() => normalizeEttuMatch(impossibleDeuce, { category: categories[0], stageId: 1, formatId: 1 }), /invalid game score/);
});

test("passes timeout signals to fetch and rejects incomplete published-stage ledgers", async () => {
  const requests = [];
  const baseFetch = fixture();
  const fetchImpl = async (...args) => {
    requests.push(args);
    return baseFetch(...args);
  };
  const records = await fetchEttuOfficialResults(5440, { fetchImpl, timeoutMs: 1234 });
  assert(records.length > 0);
  assert(requests.every(([, init]) => init.signal instanceof AbortSignal));
  assert.equal(requests[0][1].signal.aborted, false);
  await assert.rejects(fetchEttuOfficialResults(5440, { fetchImpl: fixture({ stages: stages.slice(1) }) }), /expected published stages are missing/);
});

test("removes trailing zero padding, accepts verified SCORED walkovers, and canonicalizes rounds", () => {
  const padded = { ...groupMatch, winner: 1, participants: [pair(1, "One", [11, 11, 11, 0, 0]), pair(2, "Two", [8, 8, 8, 0, 0], "France")] };
  const normalized = normalizeEttuMatch(padded, { category: categories[0], stageId: 1, formatId: 1, groupName: "Group 1" });
  assert.deepEqual(normalized.gameScores, ["11-8", "11-8", "11-8"]);
  assert.equal(normalized.overallScore, "3-0");
  assert.equal(normalized.roundKey, "group");
  assert.equal(normalized.startDateLocal, padded.start_time);
  assert.equal(normalized.startDateUtc, null);

  const walkover = { ...groupMatch, id: 73145, participants: [{ ...pair(11, "NODINA Alexia", [11, 11, 11]), walkover: true, walkover_reason: "walk_over" }, pair(12, "VENDELBO Emma", [0, 0, 0], "Denmark")], winner: 11 };
  const walkoverRecord = normalizeEttuMatch(walkover, { category: categories[1], stageId: 1, formatId: 1, groupName: "Group 1" });
  assert.deepEqual(walkoverRecord.gameScores, []);
  assert.equal(walkoverRecord.overallScore, "W-L");
  assert.equal(walkoverRecord.resultStatus, "WO");
  assert.equal(walkoverRecord.competitors[0].irm, null);
  assert.equal(walkoverRecord.competitors[1].irm, "WO");
  const reversedWalkover = normalizeEttuMatch({ ...walkover, participants: [...walkover.participants].reverse(), winner: 11 }, { category: categories[1], stageId: 1, formatId: 1, groupName: "Group 1" });
  assert.equal(reversedWalkover.overallScore, "L-W");
  assert.equal(reversedWalkover.competitors[0].irm, "WO");

  const koRoundMatch = { ...groupMatch, round: undefined, match_winner: 1, leg_details: [{ status: "SCORED", score_published: true, start_time: "2026-10-12T09:00:00Z" }], participants: [{ ...pair(1, "One"), participant_points: [11, 11, 11] }, { ...pair(2, "Two", undefined, "France"), participant_points: [8, 8, 8] }] };
  const qualification = normalizeEttuMatch(koRoundMatch, { category: categories[0], stageId: 2, formatId: 2, isKo: true, stageName: "Qual. Stage", roundName: "Round of 64", roundIndex: 0 });
  assert.equal(qualification.roundKey, "qualifying_round_1");
  assert.equal(qualification.roundLabel, "Qualifying Round 1");
  const quarterfinal = normalizeEttuMatch(koRoundMatch, { category: categories[0], stageId: 3, formatId: 2, isKo: true, stageName: "Main Draw", roundName: "Quarterfinals", roundIndex: 0 });
  assert.equal(quarterfinal.roundKey, "quarterfinal");
  assert.equal(quarterfinal.roundLabel, "Quarterfinal");
});
