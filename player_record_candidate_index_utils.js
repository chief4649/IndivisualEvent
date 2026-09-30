function getCandidateIndexCoverageFallbackEventIds(manifest, files, configSignature) {
  const snapshot = Array.isArray(files) ? files : [];
  if (snapshot.length === 0) {
    return [];
  }

  const allEventIds = snapshot.map((file) => String(file?.eventId || "")).filter(Boolean);
  if (
    manifest?.formatVersion !== 2 ||
    manifest?.complete !== true ||
    !manifest?.sourceFiles ||
    typeof manifest.sourceFiles !== "object" ||
    !manifest?.eventMatchCounts ||
    typeof manifest.eventMatchCounts !== "object" ||
    manifest.configSignature !== configSignature
  ) {
    return allEventIds;
  }

  const fallbackEventIds = [];
  const sourceFiles = manifest.sourceFiles;
  const matchCounts = manifest.eventMatchCounts;
  snapshot.forEach((file) => {
    const eventId = String(file?.eventId || "");
    const signature = String(sourceFiles[eventId] || "");
    const match = signature.match(/^(\d+):(\d+):([^:]+):/);
    const sourceIsSlim = /(?:^|-)slim$/.test(match?.[3] || "");
    const fileIsSlim = file?.parseSource === "slim";
    const expectedSize = Number(file?.parseSize || file?.size || 0);
    const expectedMtime = Number(file?.parseMtimeMs || file?.mtimeMs || 0);
    if (
      !eventId ||
      !match ||
      !Object.prototype.hasOwnProperty.call(matchCounts, eventId) ||
      Number(match[1]) !== expectedSize ||
      Number(match[2]) !== expectedMtime ||
      sourceIsSlim !== fileIsSlim
    ) {
      if (eventId) {
        fallbackEventIds.push(eventId);
      }
    }
  });

  return fallbackEventIds;
}

function getPlayerRecordTruncation(events, eventLimit, matchLimit) {
  const list = Array.isArray(events) ? events : [];
  const matchCount = list.reduce((sum, event) => sum + (Array.isArray(event?.matches) ? event.matches.length : 0), 0);
  return {
    truncatedByEventLimit: list.length > eventLimit,
    truncatedByMatchLimit: matchCount > matchLimit,
  };
}

function isDuplicatePlayerRecordIndexEntryId(entry, seenEntryIds) {
  if (typeof entry !== "string") return false;
  if (seenEntryIds.has(entry)) return true;
  seenEntryIds.add(entry);
  return false;
}

module.exports = {
  getCandidateIndexCoverageFallbackEventIds,
  getPlayerRecordTruncation,
  isDuplicatePlayerRecordIndexEntryId,
};
