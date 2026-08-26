const path = require("path");

function normalizeEventStorageSource(source, eventId = "") {
  const sourceText = String(source || "").trim().toLowerCase();
  const idText = String(eventId || "").trim();
  if (sourceText === "ittf" || sourceText === "bornan" || /^TTE\d+$/i.test(idText)) {
    return "ittf";
  }
  return "wtt";
}

function normalizeStoredEventId(source, eventId) {
  const normalizedSource = normalizeEventStorageSource(source, eventId);
  const idText = String(eventId || "").trim();
  if (normalizedSource === "ittf") {
    return /^TTE/i.test(idText) ? `TTE${idText.replace(/^TTE/i, "")}` : `TTE${idText}`;
  }
  return idText.replace(/^TTE/i, "");
}

function getEventStorageKey(source, eventId) {
  const normalizedSource = normalizeEventStorageSource(source, eventId);
  return `${normalizedSource}:${normalizeStoredEventId(normalizedSource, eventId)}`;
}

function getEventArchiveDir(dataDir, source, kind = "raw") {
  const normalizedSource = normalizeEventStorageSource(source);
  const suffix = kind === "slim" ? "-slim" : "";
  return path.join(dataDir, `${normalizedSource}-records${suffix}`);
}

function getEventArchiveFilePath(dataDir, source, eventId, kind = "raw") {
  const normalizedSource = normalizeEventStorageSource(source, eventId);
  const dir = getEventArchiveDir(dataDir, normalizedSource, kind);
  return path.join(dir, `${normalizeStoredEventId(normalizedSource, eventId)}.json`);
}

module.exports = {
  getEventArchiveDir,
  getEventArchiveFilePath,
  getEventStorageKey,
  normalizeEventStorageSource,
  normalizeStoredEventId,
};
