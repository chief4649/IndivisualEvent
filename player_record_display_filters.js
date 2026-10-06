function isPlayerRecordDoublesMatch(match) {
  return /\bdoubles\b|ダブルス/i.test(String(match?.categoryName || ""));
}

module.exports = { isPlayerRecordDoublesMatch };
