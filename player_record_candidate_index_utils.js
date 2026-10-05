function getCandidateIndexCoverageFallbackEventIds(manifest, files) {
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
    typeof manifest.eventMatchCounts !== "object"
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
    // Candidate manifests fingerprint the file used to build the candidate
    // entries, which is the parsed SLIM file when one is available.
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

function normalizePlayerRecordEventValue(value) {
  return String(value || "").normalize("NFKC").replace(/\s+/g, "").toLowerCase();
}

function getPlayerRecordEventIdentity(event) {
  const eventId = String(event?.event || event?.eventId || "").trim();
  const numericId = eventId.match(/^(?:TTE)?(\d+)$/i)?.[1];
  const eventName = normalizePlayerRecordEventValue(event?.eventName);
  const startDate = String(event?.startDate || "");
  const endDate = String(event?.endDate || "");
  if (eventName && startDate && endDate) {
    return ["event", eventName, startDate, endDate].join("\u0001");
  }
  if (!numericId) return eventId;
  return [
    "id",
    numericId,
    eventName,
    startDate,
    endDate,
  ].join("\u0001");
}

function getPlayerRecordEventMatchIdentity(match, eventIdentity) {
  return [
    eventIdentity,
    normalizePlayerRecordEventValue(match?.categoryName),
    normalizePlayerRecordEventValue(match?.roundLabel),
    normalizePlayerRecordEventValue(match?.documentCode),
    normalizePlayerRecordEventValue(match?.line),
  ].join("\u0001");
}

function mergePlayerRecordEventMatches(existingMatches, incomingMatches, eventIdentity) {
  const merged = Array.isArray(existingMatches) ? [...existingMatches] : [];
  const seen = new Set(merged.map((match) => eventIdentity
    ? getPlayerRecordEventMatchIdentity(match, eventIdentity)
    : JSON.stringify(match)));
  for (const match of Array.isArray(incomingMatches) ? incomingMatches : []) {
    const identity = eventIdentity
      ? getPlayerRecordEventMatchIdentity(match, eventIdentity)
      : JSON.stringify(match);
    if (!seen.has(identity)) {
      merged.push(match);
      seen.add(identity);
    }
  }
  return merged;
}

module.exports = {
  getCandidateIndexCoverageFallbackEventIds,
  getPlayerRecordTruncation,
  isDuplicatePlayerRecordIndexEntryId,
  getPlayerRecordEventIdentity,
  getPlayerRecordEventMatchIdentity,
  mergePlayerRecordEventMatches,
};
