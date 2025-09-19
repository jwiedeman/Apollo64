export function parseCsv(content) {
  const normalized = normalizeNewlines(content);
  const rows = [];
  let field = '';
  let row = [];
  let inQuotes = false;

  for (let i = 0; i < normalized.length; i += 1) {
    const char = normalized[i];
    const prevChar = i > 0 ? normalized[i - 1] : null;

    if (inQuotes) {
      if (char === '\\') {
        const nextChar = normalized[i + 1];
        if (nextChar === '"') {
          field += '"';
          i += 1;
          continue;
        }
      }

      if (char === '"') {
        const nextChar = normalized[i + 1];
        if (nextChar === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      if (!inQuotes && prevChar === '\\') {
        if (field.endsWith('\\')) {
          field = field.slice(0, -1);
        }
        field += '"';
        continue;
      }
      inQuotes = true;
      continue;
    }

    if (char === ',') {
      row.push(field);
      field = '';
      continue;
    }

    if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      continue;
    }

    field += char;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  if (rows.length === 0) {
    return [];
  }

  const headers = rows[0].map((header) => header.replace(/^\ufeff/, '').trim());
  const records = [];

  for (let i = 1; i < rows.length; i += 1) {
    const currentRow = rows[i];
    if (!currentRow || currentRow.length === 0 || currentRow.every((value) => value.trim().length === 0)) {
      continue;
    }

    const record = {};
    for (let j = 0; j < headers.length; j += 1) {
      const header = headers[j];
      const value = currentRow[j] ?? '';
      record[header] = value.trim();
    }
    records.push(record);
  }

  return records;
}

function normalizeNewlines(value) {
  return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}
