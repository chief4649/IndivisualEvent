"use strict";

// These are ETTU identities, not inferred WTT or Bornan numeric IDs.
const ETTU_HISTORY_EVENTS = Object.freeze({
  ETTU2024I: Object.freeze({
    eventId: "ETTU2024I", eventName: "2024 European Individual Championships Linz",
    startDate: "2024-10-15", endDate: "2024-10-20", provider: "webgen",
    baseUrl: "https://www.ttm.co.at/results/ec2024/",
  }),
  ETTU2023T: Object.freeze({
    eventId: "ETTU2023T", eventName: "2023 European Team Championships Malmo",
    startDate: "2023-09-10", endDate: "2023-09-17", provider: "webgen",
    baseUrl: "https://www.ttm.co.at/results/ec2023/",
  }),
  ETTU2022I: Object.freeze({
    eventId: "ETTU2022I", eventName: "2022 European Individual Championships Munich",
    startDate: "2022-08-13", endDate: "2022-08-21", provider: "webgen",
    baseUrl: "https://www.ttm.co.at/results/ec2022/",
  }),
  ETTU2025T: Object.freeze({
    eventId: "ETTU2025T", eventName: "2025 European Team Championships",
    startDate: "2025-10-12", endDate: "2025-10-19", provider: "stupa-team",
    recordEventId: "71", recordUrl: "https://www.ettu.tv/events/71/50/2/5/5",
  }),
  ETTU2025TQ1: Object.freeze({
    eventId: "ETTU2025TQ1", eventName: "2025 European Team Championships Qualification Stage 1 Sarajevo",
    startDate: "2025-01-21", endDate: "2025-01-25", provider: "webgen",
    baseUrl: "https://www.ttm.co.at/results/ectq2025/",
  }),
  ETTU2023TQ2: Object.freeze({
    eventId: "ETTU2023TQ2", eventName: "2023 European Team Championships Qualification Stage 2 Osijek",
    startDate: "2023-05-05", endDate: "2023-05-07", provider: "webgen",
    baseUrl: "https://www.ttm.co.at/results/ec2023s2/",
  }),
  ETTU2023TQ1C: Object.freeze({
    eventId: "ETTU2023TQ1C", eventName: "2023 European Team Championships Qualification Stage 1 C Groups",
    startDate: "2022-03-31", endDate: "2022-04-03", provider: "webgen",
    baseUrl: "https://www.ttm.co.at/results/ec2023s1c/",
  }),
  ETTU2023TQ1: Object.freeze({
    eventId: "ETTU2023TQ1", eventName: "2023 European Team Championships Qualification Stage 1 A and B Groups",
    startDate: "2022-10-01", endDate: "2023-02-15", matchStartDate: "2022-10-01", matchEndDate: "2023-03-29",
    provider: "webgen", baseUrl: "https://www.ttm.co.at/results/ec2023s1/",
  }),
});

function getEttuHistoryEvent(eventId) {
  const id = String(eventId || "").trim().toUpperCase();
  if (ETTU_HISTORY_EVENTS[id]) return ETTU_HISTORY_EVENTS[id];
  const legacy = id.match(/^ETTU(\d{4})([IT])$/);
  if (!legacy) return null;
  const year = Number(legacy[1]);
  const type = legacy[2];
  const years = type === "I"
    ? [2008, 2009, 2010, 2011, 2012, 2013, 2015, 2016, 2018, 2020]
    : [2008, 2009, 2010, 2011, 2013, 2014, 2015, 2017, 2019, 2021];
  if (!years.includes(year)) return null;
  return {
    eventId: id, year, type, provider: "archive",
    eventName: `${year} European ${type === "I" ? "Individual" : "Team"} Championships`,
    // The historical archive supplies a championship year, not a match date.
    startDate: null, endDate: null,
    recordUrl: `https://results.ettu.site/index.php?option=com_fabrik&view=list&listid=${type === "I" ? 14 : 29}&Itemid=${type === "I" ? 114 : 116}`,
  };
}

function getEttuHistoryMetadata(eventId) {
  const config = getEttuHistoryEvent(eventId);
  if (!config) return null;
  return {
    eventName: config.eventName, title: config.eventName,
    startDate: config.startDate, endDate: config.endDate,
    eventUrl: config.recordUrl || config.baseUrl,
    resultSource: "ettu-history", source: "wtt",
  };
}

module.exports = { ETTU_HISTORY_EVENTS, getEttuHistoryEvent, getEttuHistoryMetadata };
