"use strict";

// Official calendar corrections that must take precedence over stale runtime
// copies of the generated WTT date and search indexes.
const WTT_EVENT_METADATA_OVERRIDES = Object.freeze({
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
  return override ? { ...(entry || {}), ...override } : { ...(entry || {}) };
}

module.exports = {
  WTT_EVENT_METADATA_OVERRIDES,
  applyWttEventMetadataOverride,
};
