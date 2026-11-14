const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function toISODate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function todayISO(now = new Date()) {
  return toISODate(now);
}

export function parseISODate(value) {
  return new Date(`${value}T00:00:00`);
}

export function isValidISODate(value) {
  if (typeof value !== 'string' || !ISO_DATE_PATTERN.test(value)) return false;
  const date = parseISODate(value);
  return !Number.isNaN(date.getTime()) && toISODate(date) === value;
}

export function normalizeDate(value, fallback = todayISO()) {
  return isValidISODate(value) ? value : fallback;
}

export function shiftISODate(value, days) {
  const date = parseISODate(normalizeDate(value));
  date.setDate(date.getDate() + Number(days || 0));
  return toISODate(date);
}

export function formatLongDate(value) {
  const date = parseISODate(normalizeDate(value));
  const label = new Intl.DateTimeFormat('pt-BR', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  }).format(date);
  return label.charAt(0).toUpperCase() + label.slice(1);
}
