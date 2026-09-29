function isPlayerRecordEventIndexForFile(index, file) {
  if (!file) {
    return true;
  }

  const indexSourceSize = Number(index?.sourceSize || 0);
  const fileSourceSize = Number(file.parseSize || file.size || 0);
  if (indexSourceSize > 0 && fileSourceSize > 0 && indexSourceSize !== fileSourceSize) {
    return false;
  }

  const indexSourceMtimeMs = Number(index?.sourceMtimeMs || 0);
  const fileSourceMtimeMs = Number(file.parseMtimeMs || file.mtimeMs || 0);
  if (indexSourceMtimeMs > 0 && fileSourceMtimeMs > 0 && indexSourceMtimeMs !== fileSourceMtimeMs) {
    return false;
  }

  return true;
}

module.exports = { isPlayerRecordEventIndexForFile };
