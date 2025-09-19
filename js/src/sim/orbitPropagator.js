import { DEFAULT_ORBIT_OPTIONS, DEFAULT_ORBIT_STATE, EARTH_BODY } from '../config/orbit.js';

const DEFAULT_HISTORY_OPTIONS = {
  enabled: true,
  sampleIntervalSeconds: 60,
  maxSamples: 360,
};

const VECTOR_ZERO = [0, 0, 0];
const TWO_PI = Math.PI * 2;
const EPSILON = 1e-9;

export class OrbitPropagator {
  constructor(options = {}) {
    const {
      primaryBody = DEFAULT_ORBIT_OPTIONS.primaryBody,
      initialState = DEFAULT_ORBIT_OPTIONS.initialState,
      history = DEFAULT_ORBIT_OPTIONS.history,
      maxImpulseHistory = DEFAULT_ORBIT_OPTIONS.maxImpulseHistory ?? 32,
      logger = null,
    } = options ?? {};

    this.logger = logger ?? null;
    this.options = {
      maxImpulseHistory: Number.isFinite(maxImpulseHistory) && maxImpulseHistory > 0
        ? Math.floor(maxImpulseHistory)
        : 32,
      maxSubstepSeconds: 5,
    };

    this.primary = this.#normalizeBody(primaryBody);
    this.state = {
      position: [...DEFAULT_ORBIT_STATE.position],
      velocity: [...DEFAULT_ORBIT_STATE.velocity],
    };
    this.timeSeconds = 0;
    this.currentGetSeconds = Number.isFinite(initialState?.epochSeconds)
      ? initialState.epochSeconds
      : 0;

    this.metrics = {
      totalDeltaVMps: 0,
      impulses: [],
      lastImpulse: null,
    };

    this.historyOptions = normalizeHistoryOptions(history);
    this.history = createHistoryContainer(this.historyOptions);

    this.setState(initialState ?? DEFAULT_ORBIT_STATE, { resetTime: true });
  }

  setPrimaryBody(body) {
    this.primary = this.#normalizeBody(body);
    return this.primary;
  }

  setState(state, { resetTime = false } = {}) {
    if (!state || typeof state !== 'object') {
      return this.snapshot();
    }

    const position = this.#normalizeVector(state.position, this.state.position);
    const velocity = this.#normalizeVector(state.velocity, this.state.velocity);

    this.state = { position, velocity };

    if (resetTime) {
      this.timeSeconds = 0;
      this.currentGetSeconds = Number.isFinite(state.epochSeconds) ? state.epochSeconds : 0;
      resetHistory(this.history);
    } else if (Number.isFinite(state.epochSeconds)) {
      this.currentGetSeconds = state.epochSeconds;
    }

    this.#recordHistorySample(this.currentGetSeconds, { force: true });
    return this.snapshot();
  }

  snapshot() {
    return {
      body: { ...this.primary },
      position: [...this.state.position],
      velocity: [...this.state.velocity],
      timeSeconds: this.timeSeconds,
      epochSeconds: this.currentGetSeconds,
    };
  }

  summary() {
    const { position, velocity } = this.state;
    const mu = this.primary.mu;
    const radius = vectorMagnitude(position);
    const speed = vectorMagnitude(velocity);
    const altitude = radius - (Number.isFinite(this.primary.radius) ? this.primary.radius : 0);
    const elements = computeOrbitalElements(position, velocity, mu, this.primary.radius);
    const energy = 0.5 * speed * speed - (mu / (radius || 1));

    return {
      body: { ...this.primary },
      position: {
        vector: [...position],
        radius,
        altitude,
        altitudeKm: Number.isFinite(altitude) ? altitude / 1000 : null,
      },
      velocity: {
        vector: [...velocity],
        speed,
        speedKmPerSec: Number.isFinite(speed) ? speed / 1000 : null,
      },
      elements,
      energy: {
        specificMechanical: energy,
      },
      metrics: {
        totalDeltaVMps: this.metrics.totalDeltaVMps,
        impulseCount: this.metrics.impulses.length,
        lastImpulse: this.metrics.lastImpulse ? { ...this.metrics.lastImpulse } : null,
      },
      timeSeconds: this.timeSeconds,
      epochSeconds: this.currentGetSeconds,
    };
  }

  historySnapshot() {
    if (!this.historyOptions.enabled) {
      return {
        meta: { ...this.history.meta, enabled: false },
        samples: [],
      };
    }
    return {
      meta: { ...this.history.meta },
      samples: this.history.samples.map((sample) => ({ ...sample })),
    };
  }

  update(dtSeconds, { getSeconds = null, acceleration = VECTOR_ZERO } = {}) {
    if (!Number.isFinite(dtSeconds) || dtSeconds <= 0) {
      if (Number.isFinite(getSeconds)) {
        this.currentGetSeconds = getSeconds;
      }
      return this.snapshot();
    }

    const mu = this.primary.mu;
    const extAccel = this.#normalizeVector(acceleration, VECTOR_ZERO);
    let remaining = dtSeconds;

    while (remaining > EPSILON) {
      const step = Math.min(remaining, this.options.maxSubstepSeconds);
      const next = rk4Step(this.state, step, mu, extAccel);
      this.state = next;
      remaining -= step;
      this.timeSeconds += step;
    }

    if (Number.isFinite(getSeconds)) {
      this.currentGetSeconds = getSeconds;
    } else {
      this.currentGetSeconds += dtSeconds;
    }

    this.#recordHistorySample(this.currentGetSeconds);
    return this.snapshot();
  }

  applyDeltaV(deltaVMps, {
    direction = null,
    vector = null,
    frame = 'prograde',
    getSeconds = null,
    metadata = null,
  } = {}) {
    const magnitude = Number(deltaVMps);
    if (!Number.isFinite(magnitude) || magnitude === 0) {
      return null;
    }

    let deltaVector = null;
    let unitDirection = null;

    if (Array.isArray(vector)) {
      deltaVector = this.#normalizeVector(vector, null);
      if (deltaVector) {
        unitDirection = normalizeVector(deltaVector);
      }
    }

    if (!deltaVector) {
      if (Array.isArray(direction)) {
        unitDirection = normalizeVector(direction);
      }
      if (!unitDirection) {
        unitDirection = this.#resolveFrameDirection(frame);
      }
      if (!unitDirection) {
        return null;
      }
      deltaVector = scaleVector(unitDirection, magnitude);
    }

    const appliedAt = Number.isFinite(getSeconds) ? getSeconds : this.currentGetSeconds;
    if (Number.isFinite(getSeconds)) {
      this.currentGetSeconds = getSeconds;
    }

    this.state = {
      position: [...this.state.position],
      velocity: addVectors(this.state.velocity, deltaVector),
    };

    const impulse = {
      magnitude: Math.abs(magnitude),
      vector: [...deltaVector],
      unitDirection: unitDirection ? [...unitDirection] : normalizeVector(deltaVector),
      frame: unitDirection ? frame ?? 'custom' : frame ?? 'custom',
      appliedAtSeconds: appliedAt,
      metadata: metadata ? { ...metadata } : null,
    };

    this.metrics.totalDeltaVMps += Math.abs(magnitude);
    this.metrics.lastImpulse = impulse;
    this.metrics.impulses.push(impulse);
    if (this.metrics.impulses.length > this.options.maxImpulseHistory) {
      this.metrics.impulses.splice(0, this.metrics.impulses.length - this.options.maxImpulseHistory);
    }

    this.#recordHistorySample(appliedAt, { force: true });
    return impulse;
  }

  registerImpulse(impulse) {
    if (!impulse || typeof impulse !== 'object') {
      return;
    }
    const magnitude = Number(impulse.magnitude ?? impulse.deltaV ?? impulse.deltaVMps);
    if (!Number.isFinite(magnitude)) {
      return;
    }
    const vector = this.#normalizeVector(impulse.vector ?? impulse.deltaVector, null);
    this.applyDeltaV(magnitude, {
      vector,
      frame: impulse.frame ?? 'prograde',
      direction: impulse.direction ?? null,
      getSeconds: impulse.appliedAtSeconds ?? impulse.getSeconds ?? null,
      metadata: impulse.metadata ?? null,
    });
  }

  #recordHistorySample(getSeconds, { force = false } = {}) {
    if (!this.historyOptions.enabled) {
      return;
    }

    const now = Number.isFinite(getSeconds) ? getSeconds : this.currentGetSeconds;
    const meta = this.history.meta;

    if (!force && meta.lastSampleSeconds != null) {
      const interval = this.historyOptions.sampleIntervalSeconds;
      if (interval > 0 && now < meta.lastSampleSeconds + interval - EPSILON) {
        return;
      }
    }

    const radius = vectorMagnitude(this.state.position);
    const speed = vectorMagnitude(this.state.velocity);
    const altitude = radius - (Number.isFinite(this.primary.radius) ? this.primary.radius : 0);

    const sample = {
      seconds: now,
      radius,
      altitude,
      altitudeKm: Number.isFinite(altitude) ? altitude / 1000 : null,
      speed,
      speedKmPerSec: Number.isFinite(speed) ? speed / 1000 : null,
    };

    meta.lastSampleSeconds = now;
    this.history.samples.push(sample);
    if (this.history.samples.length > this.historyOptions.maxSamples) {
      this.history.samples.splice(0, this.history.samples.length - this.historyOptions.maxSamples);
    }
  }

  #normalizeVector(value, fallback) {
    if (Array.isArray(value) && value.length === 3) {
      const normalized = value.map((component) => {
        const numeric = Number(component);
        return Number.isFinite(numeric) ? numeric : 0;
      });
      return normalized;
    }
    if (typeof value === 'object' && value !== null) {
      const { x, y, z } = value;
      if ([x, y, z].every((component) => Number.isFinite(component))) {
        return [Number(x), Number(y), Number(z)];
      }
    }
    return fallback ? [...fallback] : null;
  }

  #normalizeBody(body) {
    const fallback = { ...EARTH_BODY };
    if (!body || typeof body !== 'object') {
      return fallback;
    }
    const normalized = {
      id: typeof body.id === 'string' ? body.id : fallback.id,
      name: typeof body.name === 'string' ? body.name : fallback.name,
      mu: Number.isFinite(body.mu) && body.mu > 0 ? body.mu : fallback.mu,
      radius: Number.isFinite(body.radius) && body.radius > 0 ? body.radius : fallback.radius,
      soiRadius: Number.isFinite(body.soiRadius) && body.soiRadius > 0 ? body.soiRadius : fallback.soiRadius,
    };
    return normalized;
  }

  #resolveFrameDirection(frame) {
    const label = typeof frame === 'string' ? frame.toLowerCase() : 'prograde';
    switch (label) {
      case 'prograde':
        return normalizeVector(this.state.velocity);
      case 'retrograde':
        return scaleVector(normalizeVector(this.state.velocity), -1);
      case 'normal':
        return normalizeVector(vectorCross(this.state.position, this.state.velocity));
      case 'antinormal':
      case 'anti-normal':
        return scaleVector(normalizeVector(vectorCross(this.state.position, this.state.velocity)), -1);
      case 'radial_out':
      case 'radial-out':
      case 'radial':
        return normalizeVector(this.state.position);
      case 'radial_in':
      case 'radial-in':
        return scaleVector(normalizeVector(this.state.position), -1);
      default:
        return normalizeVector(this.state.velocity);
    }
  }
}

function rk4Step(state, dt, mu, externalAcceleration) {
  const accel = externalAcceleration ?? VECTOR_ZERO;
  const k1 = derivative(state, mu, accel);
  const k2 = derivative(applyDerivative(state, k1, dt / 2), mu, accel);
  const k3 = derivative(applyDerivative(state, k2, dt / 2), mu, accel);
  const k4 = derivative(applyDerivative(state, k3, dt), mu, accel);

  const position = addVectors(
    state.position,
    scaleVector(
      addVectors(
        addVectors(scaleVector(k1.position, 1), scaleVector(k2.position, 2)),
        addVectors(scaleVector(k3.position, 2), scaleVector(k4.position, 1)),
      ),
      dt / 6,
    ),
  );

  const velocity = addVectors(
    state.velocity,
    scaleVector(
      addVectors(
        addVectors(scaleVector(k1.velocity, 1), scaleVector(k2.velocity, 2)),
        addVectors(scaleVector(k3.velocity, 2), scaleVector(k4.velocity, 1)),
      ),
      dt / 6,
    ),
  );

  return { position, velocity };
}

function derivative(state, mu, externalAcceleration) {
  const radius = state.position;
  const velocity = state.velocity;
  const r = vectorMagnitude(radius);
  let gravitational = VECTOR_ZERO;
  if (r > EPSILON && Number.isFinite(mu) && mu > 0) {
    const factor = -mu / (r * r * r);
    gravitational = scaleVector(radius, factor);
  }
  const totalAcceleration = addVectors(gravitational, externalAcceleration ?? VECTOR_ZERO);
  return {
    position: [...velocity],
    velocity: [...totalAcceleration],
  };
}

function applyDerivative(state, derivativeValue, dt) {
  return {
    position: addVectors(state.position, scaleVector(derivativeValue.position, dt)),
    velocity: addVectors(state.velocity, scaleVector(derivativeValue.velocity, dt)),
  };
}

function computeOrbitalElements(position, velocity, mu, bodyRadius) {
  const rVec = position;
  const vVec = velocity;
  const r = vectorMagnitude(rVec);
  const v = vectorMagnitude(vVec);

  if (!(Number.isFinite(mu) && mu > 0 && r > 0)) {
    return emptyElements();
  }

  const hVec = vectorCross(rVec, vVec);
  const h = vectorMagnitude(hVec);
  const energy = 0.5 * v * v - mu / r;
  const semiMajorAxis = Math.abs(energy) > EPSILON ? -mu / (2 * energy) : null;

  const eVec = subtractVectors(
    scaleVector(vectorCross(vVec, hVec), 1 / mu),
    scaleVector(rVec, 1 / r),
  );
  const eccentricity = vectorMagnitude(eVec);

  const inclination = h > EPSILON ? Math.acos(clamp(hVec[2] / h, -1, 1)) : 0;
  const nVec = vectorCross([0, 0, 1], hVec);
  const n = vectorMagnitude(nVec);

  let raan = 0;
  if (n > EPSILON) {
    raan = Math.acos(clamp(nVec[0] / n, -1, 1));
    if (nVec[1] < 0) {
      raan = TWO_PI - raan;
    }
  }

  let argumentOfPeriapsis = 0;
  if (n > EPSILON && eccentricity > EPSILON) {
    argumentOfPeriapsis = Math.acos(clamp(vectorDot(nVec, eVec) / (n * eccentricity), -1, 1));
    if (eVec[2] < 0) {
      argumentOfPeriapsis = TWO_PI - argumentOfPeriapsis;
    }
  }

  let trueAnomaly = 0;
  if (eccentricity > EPSILON) {
    trueAnomaly = Math.acos(clamp(vectorDot(eVec, rVec) / (eccentricity * r), -1, 1));
    if (vectorDot(rVec, vVec) < 0) {
      trueAnomaly = TWO_PI - trueAnomaly;
    }
  } else if (n > EPSILON) {
    trueAnomaly = Math.acos(clamp(vectorDot(nVec, rVec) / (n * r), -1, 1));
    if (rVec[2] < 0) {
      trueAnomaly = TWO_PI - trueAnomaly;
    }
  }

  let periapsisRadius = null;
  let apoapsisRadius = null;
  if (eccentricity < 1 - 1e-6 && semiMajorAxis != null) {
    periapsisRadius = semiMajorAxis * (1 - eccentricity);
    apoapsisRadius = semiMajorAxis * (1 + eccentricity);
  } else if (Math.abs(eccentricity - 1) <= 1e-6 && h > EPSILON) {
    periapsisRadius = (h * h) / (2 * mu);
    apoapsisRadius = null;
  } else if (eccentricity > 1 && semiMajorAxis != null) {
    periapsisRadius = Math.abs(semiMajorAxis) * (eccentricity - 1);
    apoapsisRadius = null;
  }

  const periodSeconds = semiMajorAxis != null && eccentricity < 1
    ? TWO_PI * Math.sqrt(Math.pow(semiMajorAxis, 3) / mu)
    : null;

  return {
    semiMajorAxis,
    eccentricity,
    inclinationRad: inclination,
    inclinationDeg: inclination * (180 / Math.PI),
    raanRad: raan,
    raanDeg: raan * (180 / Math.PI),
    argumentOfPeriapsisRad: argumentOfPeriapsis,
    argumentOfPeriapsisDeg: argumentOfPeriapsis * (180 / Math.PI),
    trueAnomalyRad: trueAnomaly,
    trueAnomalyDeg: trueAnomaly * (180 / Math.PI),
    periapsisRadius,
    apoapsisRadius,
    periapsisAltitude: periapsisRadius != null && Number.isFinite(bodyRadius)
      ? periapsisRadius - bodyRadius
      : null,
    apoapsisAltitude: apoapsisRadius != null && Number.isFinite(bodyRadius)
      ? apoapsisRadius - bodyRadius
      : null,
    periodSeconds,
    specificAngularMomentum: h,
    specificEnergy: energy,
  };
}

function emptyElements() {
  return {
    semiMajorAxis: null,
    eccentricity: null,
    inclinationRad: null,
    inclinationDeg: null,
    raanRad: null,
    raanDeg: null,
    argumentOfPeriapsisRad: null,
    argumentOfPeriapsisDeg: null,
    trueAnomalyRad: null,
    trueAnomalyDeg: null,
    periapsisRadius: null,
    apoapsisRadius: null,
    periapsisAltitude: null,
    apoapsisAltitude: null,
    periodSeconds: null,
    specificAngularMomentum: null,
    specificEnergy: null,
  };
}

function normalizeHistoryOptions(raw) {
  if (raw === false) {
    return { ...DEFAULT_HISTORY_OPTIONS, enabled: false, maxSamples: 0 };
  }
  const normalized = { ...DEFAULT_HISTORY_OPTIONS };
  if (raw && typeof raw === 'object') {
    if (raw.enabled === false) {
      normalized.enabled = false;
    } else if (raw.enabled === true) {
      normalized.enabled = true;
    }
    if (Number.isFinite(raw.sampleIntervalSeconds) && raw.sampleIntervalSeconds > 0) {
      normalized.sampleIntervalSeconds = raw.sampleIntervalSeconds;
    }
    if (Number.isFinite(raw.maxSamples) && raw.maxSamples >= 0) {
      normalized.maxSamples = Math.floor(raw.maxSamples);
    }
  }
  return normalized;
}

function createHistoryContainer(options) {
  return {
    meta: {
      enabled: Boolean(options.enabled),
      sampleIntervalSeconds: options.sampleIntervalSeconds,
      maxSamples: options.maxSamples,
      lastSampleSeconds: null,
    },
    samples: [],
  };
}

function resetHistory(history) {
  if (!history) {
    return;
  }
  history.samples.length = 0;
  history.meta.lastSampleSeconds = null;
}

function vectorMagnitude(vector) {
  if (!Array.isArray(vector)) {
    return 0;
  }
  const [x, y, z] = vector;
  return Math.sqrt((x ?? 0) ** 2 + (y ?? 0) ** 2 + (z ?? 0) ** 2);
}

function addVectors(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) {
    return [...(a ?? VECTOR_ZERO)];
  }
  return [
    (a[0] ?? 0) + (b[0] ?? 0),
    (a[1] ?? 0) + (b[1] ?? 0),
    (a[2] ?? 0) + (b[2] ?? 0),
  ];
}

function subtractVectors(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) {
    return [...(a ?? VECTOR_ZERO)];
  }
  return [
    (a[0] ?? 0) - (b[0] ?? 0),
    (a[1] ?? 0) - (b[1] ?? 0),
    (a[2] ?? 0) - (b[2] ?? 0),
  ];
}

function scaleVector(vector, scalar) {
  if (!Array.isArray(vector)) {
    return VECTOR_ZERO;
  }
  const value = Number(scalar);
  if (!Number.isFinite(value)) {
    return [...vector];
  }
  return vector.map((component) => (component ?? 0) * value);
}

function vectorDot(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) {
    return 0;
  }
  return (a[0] ?? 0) * (b[0] ?? 0) + (a[1] ?? 0) * (b[1] ?? 0) + (a[2] ?? 0) * (b[2] ?? 0);
}

function vectorCross(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) {
    return [...VECTOR_ZERO];
  }
  const [ax, ay, az] = a.map((value) => value ?? 0);
  const [bx, by, bz] = b.map((value) => value ?? 0);
  return [
    ay * bz - az * by,
    az * bx - ax * bz,
    ax * by - ay * bx,
  ];
}

function normalizeVector(vector) {
  const magnitude = vectorMagnitude(vector);
  if (!(magnitude > EPSILON)) {
    return null;
  }
  return scaleVector(vector, 1 / magnitude);
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) {
    return min;
  }
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}
