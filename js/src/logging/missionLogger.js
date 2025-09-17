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

  getEntries(filterFn = null) {
    if (typeof filterFn !== 'function') {
      return [...this.entries];
    }
    return this.entries.filter(filterFn);
  }
}
