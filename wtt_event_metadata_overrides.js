"use strict";

// Official calendar corrections that must take precedence over stale runtime
// copies of the generated WTT date and search indexes.
const WTT_EVENT_METADATA_OVERRIDES = Object.freeze({
  "TTE5449": Object.freeze({
    eventName: "2022 SOUTH AMERICAN GAMES - ODESUR",
    startDate: "2022-10-09",
    endDate: "2022-10-14",
    dateLabel: "2022/10/9-14",
    eventUrl: "https://results.ittf.com/ittf-web-results/html/TTE5449/results.html#/results",
    source: "ittf",
  }),
  "5449": Object.freeze({
    eventName: "XIII South American Games Santa Fe 2026",
    startDate: "2026-09-21",
    endDate: "2026-09-26",
    dateLabel: "2026/9/21-26",
    eventUrl: "https://results.santafe2026.org/#/discipline/TTE/results",
    resultSource: "south-american-games-2026",
    source: "wtt",
  }),
  "3473": Object.freeze({
    eventName: "Asian Games Aichi-Nagoya 2026",
    startDate: "2026-09-20",
    endDate: "2026-09-28",
    dateLabel: "2026/9/20-28",
    eventUrl: "https://results.asiangames2026.org/#/discipline/TTE/reports",
    resultSource: "asian-games-2026",
    source: "wtt",
  }),
  "2628": Object.freeze({
    eventName: "33rd ITTF-ATTU Asian Cup 2022",
    startDate: "2022-11-17",
    endDate: "2022-11-19",
    dateLabel: "2022/11/17-19",
    eventUrl: "https://asia.ittf.com/eventInfo?eventId=2628",
    resultSource: "attu",
    source: "wtt",
  }),
  "3372": Object.freeze({
    eventName: "WTT Feeder Tunis 2026",
    startDate: "2026-12-06",
    endDate: "2026-12-10",
    dateLabel: "2026/12/6-10",
    source: "calendar",
  }),
});

function applyWttEventMetadataOverride(eventId, entry = {}) {
  const override = WTT_EVENT_METADATA_OVERRIDES[String(eventId || "").trim()];
  const resolved = override ? { ...(entry || {}), ...override } : { ...(entry || {}) };
  const eventName = String(resolved.eventName || "").trim();
  if (eventName) resolved.title = eventName;
  return resolved;
}

module.exports = {
  WTT_EVENT_METADATA_OVERRIDES,
  applyWttEventMetadataOverride,
};
