export const EARTH_BODY = {
  id: 'earth',
  name: 'Earth',
  mu: 3.986004418e14, // m^3/s^2
  radius: 6_378_137, // m
  soiRadius: 924_000_000, // Approximate sphere of influence radius (m)
};

export const MOON_BODY = {
  id: 'moon',
  name: 'Moon',
  mu: 4.9048695e12, // m^3/s^2
  radius: 1_737_400, // m
  soiRadius: 66_100_000, // Approximate sphere of influence radius (m)
};

export function circularOrbitVelocity(mu, radius) {
  if (!(Number.isFinite(mu) && Number.isFinite(radius) && mu > 0 && radius > 0)) {
    return 0;
  }
  return Math.sqrt(mu / radius);
}

export function createCircularOrbitState({
  altitudeMeters = 185_000,
  body = EARTH_BODY,
} = {}) {
  const baseRadius = Number.isFinite(body?.radius) ? body.radius : EARTH_BODY.radius;
  const mu = Number.isFinite(body?.mu) ? body.mu : EARTH_BODY.mu;
  const orbitalRadius = Math.max(baseRadius + Math.max(0, altitudeMeters), 1);
  const velocity = circularOrbitVelocity(mu, orbitalRadius);
  return {
    position: [orbitalRadius, 0, 0],
    velocity: [0, velocity, 0],
    epochSeconds: 0,
    frame: 'ECI',
  };
}

export const DEFAULT_ORBIT_STATE = createCircularOrbitState();

export const DEFAULT_ORBIT_OPTIONS = {
  primaryBody: EARTH_BODY,
  initialState: DEFAULT_ORBIT_STATE,
  history: {
    enabled: true,
    sampleIntervalSeconds: 60,
    maxSamples: 360,
  },
  maxImpulseHistory: 32,
};
