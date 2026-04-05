export const MONTHS = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

/** Parses a "DD/MM/YYYY" string into a Date (local time). */
export function parseDate(s) {
  const [d, m, y] = s.split('/');
  return new Date(+y, +m - 1, +d);
}

/** Returns true if the date string is strictly before today (midnight). */
export function isPastDate(s) {
  if (!s) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return parseDate(s) < today;
}

/** Formats "DD/MM/YYYY" as "DD de <month>" in Portuguese. */
export function formatarDataExtenso(dataStr) {
  if (!dataStr) return '';
  const p = dataStr.split('/');
  if (p.length !== 3) return dataStr;
  return `${p[0]} de ${MONTHS[+p[1] - 1]}`;
}
