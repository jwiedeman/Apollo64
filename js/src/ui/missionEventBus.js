export class MissionEventBus {
  constructor() {
    this.listeners = new Map();
    this.listenerId = 0;
  }

  on(eventName, handler) {
    const normalized = this.#normalizeEventName(eventName);
    if (!normalized || typeof handler !== 'function') {
      return () => {};
    }

    const entry = { id: this.#nextListenerId(), handler };
    let bucket = this.listeners.get(normalized);
    if (!bucket) {
      bucket = new Set();
      this.listeners.set(normalized, bucket);
    }
    bucket.add(entry);

    return () => {
      bucket.delete(entry);
      if (bucket.size === 0) {
        this.listeners.delete(normalized);
      }
    };
  }

  off(eventName, handler) {
    const normalized = this.#normalizeEventName(eventName);
    if (!normalized) {
      return;
    }
    const bucket = this.listeners.get(normalized);
    if (!bucket) {
      return;
    }
    for (const entry of bucket) {
      if (entry.handler === handler) {
        bucket.delete(entry);
      }
    }
    if (bucket.size === 0) {
      this.listeners.delete(normalized);
    }
  }

  emit(eventName, payload = null) {
    const normalized = this.#normalizeEventName(eventName);
    if (!normalized) {
      return;
    }
    const bucket = this.listeners.get(normalized);
    if (!bucket || bucket.size === 0) {
      return;
    }
    const snapshot = Array.from(bucket);
    for (const entry of snapshot) {
      entry.handler(payload);
    }
  }

  clear(eventName = null) {
    if (eventName == null) {
      this.listeners.clear();
      return;
    }
    const normalized = this.#normalizeEventName(eventName);
    if (normalized) {
      this.listeners.delete(normalized);
    }
  }

  listenerCount(eventName = null) {
    if (eventName == null) {
      let total = 0;
      for (const bucket of this.listeners.values()) {
        total += bucket.size;
      }
      return total;
    }
    const normalized = this.#normalizeEventName(eventName);
    if (!normalized) {
      return 0;
    }
    return this.listeners.get(normalized)?.size ?? 0;
  }

  #normalizeEventName(value) {
    if (typeof value !== 'string') {
      return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  #nextListenerId() {
    this.listenerId += 1;
    return this.listenerId;
  }
}
