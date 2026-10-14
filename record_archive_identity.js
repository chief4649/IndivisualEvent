const RECORD_ARCHIVE_FILENAME_PATTERN = /^(?:TTE\d+|\d+|ETTU\d{4}[ITC](?:Q[12]C?)?)\.json$/i;
const RECORD_EVENT_ID_PATTERN = /^(?:TTE\d+|\d+|ETTU\d{4}[ITC](?:Q[12]C?)?)$/i;

function isRecordArchiveFilename(fileName) {
  return typeof fileName === "string" && RECORD_ARCHIVE_FILENAME_PATTERN.test(fileName);
}

function isRecordEventId(eventId) {
  return typeof eventId === "string" && RECORD_EVENT_ID_PATTERN.test(eventId);
}

function normalizeRecordEventId(eventId) {
  const id = String(eventId || "").trim();
  return /^ETTU/i.test(id) ? id.toUpperCase() : id;
}

module.exports = { isRecordArchiveFilename, isRecordEventId, normalizeRecordEventId };
