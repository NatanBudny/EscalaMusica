import { jest } from '@jest/globals';
import { parseDate, isPastDate, formatarDataExtenso, MONTHS } from '../../src/utils/date.js';

// Pin system clock to 2026-03-05 for deterministic date comparisons
const FIXED_NOW = new Date(2026, 2, 5); // March 5, 2026

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(FIXED_NOW);
});
afterEach(() => jest.useRealTimers());

// ─── parseDate ────────────────────────────────────────────────────────────────

describe('parseDate', () => {
  test('returns a Date for a valid DD/MM/YYYY string', () => {
    const d = parseDate('07/03/2026');
    expect(d).toBeInstanceOf(Date);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(2); // 0-indexed March
    expect(d.getDate()).toBe(7);
  });

  test('handles first day of January', () => {
    const d = parseDate('01/01/2026');
    expect(d.getMonth()).toBe(0);
    expect(d.getDate()).toBe(1);
  });

  test('handles last day of December', () => {
    const d = parseDate('31/12/2025');
    expect(d.getFullYear()).toBe(2025);
    expect(d.getMonth()).toBe(11);
    expect(d.getDate()).toBe(31);
  });

  test('numeric day and month are parsed as integers', () => {
    const d = parseDate('09/09/2026');
    expect(d.getMonth()).toBe(8); // September = index 8
    expect(d.getDate()).toBe(9);
  });
});

// ─── isPastDate ───────────────────────────────────────────────────────────────

describe('isPastDate', () => {
  test('returns false for a future date', () => {
    expect(isPastDate('10/03/2026')).toBe(false);
  });

  test('returns false for today', () => {
    expect(isPastDate('05/03/2026')).toBe(false);
  });

  test('returns true for yesterday', () => {
    expect(isPastDate('04/03/2026')).toBe(true);
  });

  test('returns true for a date well in the past', () => {
    expect(isPastDate('01/01/2025')).toBe(true);
  });

  test('returns false for a falsy/empty value', () => {
    expect(isPastDate('')).toBe(false);
    expect(isPastDate(null)).toBe(false);
    expect(isPastDate(undefined)).toBe(false);
  });
});

// ─── formatarDataExtenso ──────────────────────────────────────────────────────

describe('formatarDataExtenso', () => {
  test('formats a standard date correctly', () => {
    expect(formatarDataExtenso('07/03/2026')).toBe('07 de março');
  });

  test('returns empty string for falsy input', () => {
    expect(formatarDataExtenso('')).toBe('');
    expect(formatarDataExtenso(null)).toBe('');
  });

  test('returns the original string if it cannot be parsed', () => {
    expect(formatarDataExtenso('not-a-date')).toBe('not-a-date');
  });

  test('handles all 12 months correctly', () => {
    const dates = [
      '01/01/2026', '01/02/2026', '01/03/2026', '01/04/2026',
      '01/05/2026', '01/06/2026', '01/07/2026', '01/08/2026',
      '01/09/2026', '01/10/2026', '01/11/2026', '01/12/2026',
    ];
    dates.forEach((d, i) => {
      expect(formatarDataExtenso(d)).toBe(`01 de ${MONTHS[i]}`);
    });
  });
});
