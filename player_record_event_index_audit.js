const crypto = require("crypto");

function getPlayerRecordEventIndexAuditSignature(snapshot) {
  const source = (Array.isArray(snapshot) ? snapshot : [])
    .map((file) => [
      String(file.eventId || ""),
      Number(file.size || 0),
      Number(file.mtimeMs || 0),
      String(file.parseSource || "raw"),
      Number(file.parseSize || file.size || 0),
      Number(file.parseMtimeMs || file.mtimeMs || 0),
    ].join(":"))
    .sort()
    .join("\n");
  return crypto.createHash("sha256").update(source).digest("hex");
}

function getPlayerRecordEventIndexAuditQueue(existing, signature, discoveredStaleEventIds) {
  if (existing?.version === 1 && existing.signature === signature && Array.isArray(existing.pendingEventIds)) {
    return [...new Set(existing.pendingEventIds.map(String))];
  }
  return [...new Set((Array.isArray(discoveredStaleEventIds) ? discoveredStaleEventIds : []).map(String))];
}

function finishPlayerRecordEventIndexAuditBatch(pendingEventIds, batchEventIds, failedEventIds) {
  const batch = new Set((Array.isArray(batchEventIds) ? batchEventIds : []).map(String));
  const failed = new Set((Array.isArray(failedEventIds) ? failedEventIds : []).map(String));
  const pending = (Array.isArray(pendingEventIds) ? pendingEventIds : []).map(String);
  const remaining = pending.filter((eventId) => !batch.has(eventId));
  remaining.push(...pending.filter((eventId) => batch.has(eventId) && failed.has(eventId)));
  return [...new Set(remaining)];
}

module.exports = {
  finishPlayerRecordEventIndexAuditBatch,
  getPlayerRecordEventIndexAuditQueue,
  getPlayerRecordEventIndexAuditSignature,
};
