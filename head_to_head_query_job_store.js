const fs = require("fs");
const path = require("path");

const JOB_ID_PATTERN = /^[a-f0-9]{32}$/i;

function createHeadToHeadQueryJobStore(options = {}) {
  const directory = options.directory;
  const ttlMs = Math.max(1, Number(options.ttlMs) || 10 * 60_000);
  const maxJobs = Math.max(1, Number(options.maxJobs) || 64);
  const now = typeof options.now === "function" ? options.now : Date.now;

  function filePath(id) {
    return JOB_ID_PATTERN.test(String(id || ""))
      ? path.join(directory, `${id}.json`)
      : null;
  }

  function read(id) {
    const target = filePath(id);
    if (!target) return null;
    try {
      const record = JSON.parse(fs.readFileSync(target, "utf8"));
      return record?.id === id ? record : null;
    } catch {
      return null;
    }
  }

  function write(record) {
    const target = filePath(record?.id);
    if (!target) throw new Error("Invalid H2H query job ID");
    fs.mkdirSync(directory, { recursive: true });
    const temporary = `${target}.${process.pid}.${now()}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(record)}\n`, "utf8");
    fs.renameSync(temporary, target);
  }

  function prune() {
    let entries;
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map((entry) => ({
          name: entry.name,
          record: read(entry.name.slice(0, -5)),
        }));
    } catch {
      return;
    }

    const currentTime = now();
    entries.forEach(({ name, record }) => {
      const createdAt = Date.parse(String(record?.createdAt || ""));
      if (!record || !Number.isFinite(createdAt) || currentTime - createdAt >= ttlMs) {
        fs.rmSync(path.join(directory, name), { force: true });
      }
    });

    entries = entries.filter(({ record }) => {
      const createdAt = Date.parse(String(record?.createdAt || ""));
      return record && Number.isFinite(createdAt) && currentTime - createdAt < ttlMs;
    });
    if (entries.length <= maxJobs) return;

    entries
      .filter(({ record }) => record.status !== "processing")
      .sort((left, right) => Date.parse(left.record.createdAt) - Date.parse(right.record.createdAt))
      .slice(0, entries.length - maxJobs)
      .forEach(({ name }) => fs.rmSync(path.join(directory, name), { force: true }));
  }

  return { read, write, prune };
}

module.exports = { createHeadToHeadQueryJobStore };
