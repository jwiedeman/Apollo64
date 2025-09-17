const GET_PATTERN = /^(\d{3}):(\d{2}):(\d{2})$/;

export function parseGET(value) {
  if (!value || typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  const match = GET_PATTERN.exec(trimmed);
  if (!match) {
    return null;
  }
  const [, h, m, s] = match;
  const hours = Number.parseInt(h, 10);
  const minutes = Number.parseInt(m, 10);
  const seconds = Number.parseInt(s, 10);
  if (Number.isNaN(hours) || Number.isNaN(minutes) || Number.isNaN(seconds)) {
    return null;
  }
  return (hours * 3600) + (minutes * 60) + seconds;
}

export function formatGET(totalSeconds) {
  const seconds = Math.max(0, Math.floor(totalSeconds ?? 0));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return `${hours.toString().padStart(3, '0')}:${minutes.toString().padStart(2, '0')}:${remainder
    .toString()
    .padStart(2, '0')}`;
}

export function secondsBetween(a, b) {
  if (a == null || b == null) {
    return null;
  }
  return Math.abs(a - b);
}
