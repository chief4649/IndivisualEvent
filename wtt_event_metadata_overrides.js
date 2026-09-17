"use strict";

// Official calendar corrections that must take precedence over stale runtime
// copies of the generated WTT date and search indexes.
const WTT_EVENT_METADATA_OVERRIDES = Object.freeze({
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
