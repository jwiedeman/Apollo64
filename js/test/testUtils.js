export function createTestLogger() {
  const entries = [];
  return {
    entries,
    log(getSeconds, message, data = {}) {
      entries.push({ getSeconds, message, data });
    },
  };
}

export function sumByKey(records, key) {
  return records.reduce((total, record) => total + (Number(record[key]) || 0), 0);
}
