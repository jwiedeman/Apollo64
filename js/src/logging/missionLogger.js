import fs from 'fs/promises';
import path from 'path';
import { formatGET } from '../utils/time.js';

export class MissionLogger {
  constructor({ silent = false } = {}) {
    this.silent = silent;
    this.entries = [];
  }

  log(getSeconds, message, context = {}) {
    const entry = {
      getSeconds,
      message,
      context,
    };
    this.entries.push(entry);

    if (!this.silent) {
      const prefix = `[GET ${formatGET(getSeconds)}]`;
      if (context && Object.keys(context).length > 0) {
        console.log(`${prefix} ${message}`, context);
      } else {
        console.log(`${prefix} ${message}`);
      }
    }
  }

  logPerformance(getSeconds, snapshot, options = {}) {
    if (!snapshot || typeof snapshot !== 'object') {
      return;
    }
    const { message = 'UI performance snapshot', severity = 'info', extraContext = null } = options ?? {};
    const context = {
      logSource: 'ui',
      logCategory: 'performance',
      logSeverity: severity,
      snapshot,
    };
    if (snapshot.overview) {
      context.overview = snapshot.overview;
    }
    if (extraContext && typeof extraContext === 'object') {
      Object.assign(context, extraContext);
    }
    this.log(getSeconds, message, context);
  }

  getEntries(filterFn = null) {
    if (typeof filterFn !== 'function') {
      return [...this.entries];
    }
    return this.entries.filter(filterFn);
  }

  async flushToFile(filePath, { pretty = false } = {}) {
    if (!filePath) {
      return;
    }

    const absolutePath = path.resolve(filePath);
    const directory = path.dirname(absolutePath);
    await fs.mkdir(directory, { recursive: true });
    const payload = pretty ? JSON.stringify(this.entries, null, 2) : JSON.stringify(this.entries);
    await fs.writeFile(absolutePath, payload, 'utf8');
  }
}
