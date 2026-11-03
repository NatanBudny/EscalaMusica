import { describe, expect, it } from 'vitest';

import {
  AUTO_GENERATED_WEEKDAYS,
  daysInMonth,
  generateAutomaticDates,
  isLeapYear,
  isValidMonth,
  isValidYear,
  parseIsoDate,
  parsePeriod,
  toIsoDate,
  toPeriod,
  weekdayOf,
} from './calendar';
import type { Weekday } from '../schemas/models';

describe('calendario gregoriano', () => {
  describe('isLeapYear', () => {
    it('aplica a regra gregoriana (4/100/400)', () => {
      expect(isLeapYear(2000)).toBe(true); // divisivel por 400
      expect(isLeapYear(1900)).toBe(false); // divisivel por 100, nao 400
      expect(isLeapYear(2024)).toBe(true); // divisivel por 4
      expect(isLeapYear(2023)).toBe(false);
      expect(isLeapYear(2400)).toBe(true);
      expect(isLeapYear(2100)).toBe(false);
    });
  });

  describe('daysInMonth', () => {
    it('fevereiro depende do ano bissexto', () => {
      expect(daysInMonth(2024, 2)).toBe(29);
      expect(daysInMonth(2023, 2)).toBe(28);
      expect(daysInMonth(1900, 2)).toBe(28);
      expect(daysInMonth(2000, 2)).toBe(29);
    });
    it('demais meses sao fixos', () => {
      expect(daysInMonth(2025, 1)).toBe(31);
      expect(daysInMonth(2025, 4)).toBe(30);
      expect(daysInMonth(2025, 12)).toBe(31);
    });
    it('rejeita mes invalido', () => {
      expect(() => daysInMonth(2025, 0)).toThrow(RangeError);
      expect(() => daysInMonth(2025, 13)).toThrow(RangeError);
    });
  });

  describe('validacao de ano e mes (Requisitos 2.1, 2.9)', () => {
    it('ano: bordas 0/1/9999/10000', () => {
      expect(isValidYear(0)).toBe(false);
      expect(isValidYear(1)).toBe(true);
      expect(isValidYear(9999)).toBe(true);
      expect(isValidYear(10000)).toBe(false);
      expect(isValidYear(1.5)).toBe(false);
    });
    it('mes: bordas 0/1/12/13', () => {
      expect(isValidMonth(0)).toBe(false);
      expect(isValidMonth(1)).toBe(true);
      expect(isValidMonth(12)).toBe(true);
      expect(isValidMonth(13)).toBe(false);
      expect(isValidMonth(6.5)).toBe(false);
    });
  });

  describe('weekdayOf (Requisito 2.6)', () => {
    it('datas de referencia conhecidas', () => {
      // 2000-01-01 foi sabado.
      expect(weekdayOf(2000, 1, 1)).toBe<Weekday>('saturday');
      // 2024-02-29 (bissexto) foi quinta-feira.
      expect(weekdayOf(2024, 2, 29)).toBe<Weekday>('thursday');
      // 2025-01-01 foi quarta-feira.
      expect(weekdayOf(2025, 1, 1)).toBe<Weekday>('wednesday');
      // 2023-12-31 foi domingo.
      expect(weekdayOf(2023, 12, 31)).toBe<Weekday>('sunday');
    });
    it('bordas extremas de ano', () => {
      // 0001-01-01 no calendario gregoriano proleptico e segunda-feira.
      expect(weekdayOf(1, 1, 1)).toBe<Weekday>('monday');
      // 9999-12-31 e sexta-feira (gregoriano proleptico).
      expect(weekdayOf(9999, 12, 31)).toBe<Weekday>('friday');
    });
    it('rejeita dia invalido (29/02 em ano nao bissexto)', () => {
      expect(() => weekdayOf(2023, 2, 29)).toThrow(RangeError);
    });
  });

  describe('generateAutomaticDates (Requisito 2.3)', () => {
    it('gera apenas quartas, sabados e domingos, em ordem e sem duplicidade', () => {
      const dates = generateAutomaticDates(2025, 1); // janeiro de 2025
      // Deve conter somente dias cujo weekday esta em AUTO_GENERATED_WEEKDAYS.
      for (const d of dates) {
        expect(AUTO_GENERATED_WEEKDAYS).toContain(d.weekday);
      }
      // Ordem cronologica estrita.
      const sorted = [...dates].map((d) => d.date).sort();
      expect(dates.map((d) => d.date)).toEqual(sorted);
      // Sem duplicidade.
      expect(new Set(dates.map((d) => d.date)).size).toBe(dates.length);
    });

    it('fevereiro bissexto inclui o dia 29 quando cai em dia gerado', () => {
      // 2024-02-29 foi quinta -> nao e gerado. Mas verificamos que fev/2024
      // considerou 29 dias e nenhuma data de marco apareceu.
      const feb2024 = generateAutomaticDates(2024, 2);
      for (const d of feb2024) {
        expect(d.date.startsWith('2024-02-')).toBe(true);
      }
      // 2020-02-29 foi sabado -> deve ser gerado.
      const feb2020 = generateAutomaticDates(2020, 2);
      expect(feb2020.map((d) => d.date)).toContain('2020-02-29');
    });

    it('fevereiro nao bissexto nunca inclui 29', () => {
      const feb2023 = generateAutomaticDates(2023, 2);
      expect(feb2023.map((d) => d.date)).not.toContain('2023-02-29');
    });

    it('contagem casa com a enumeracao manual do mes', () => {
      const year = 2025;
      const month = 3;
      const total = daysInMonth(year, month);
      const manual: string[] = [];
      for (let day = 1; day <= total; day++) {
        const wd = weekdayOf(year, month, day);
        if (AUTO_GENERATED_WEEKDAYS.includes(wd)) manual.push(toIsoDate(year, month, day));
      }
      expect(generateAutomaticDates(year, month).map((d) => d.date)).toEqual(manual);
    });

    it('rejeita ano/mes fora do intervalo', () => {
      expect(() => generateAutomaticDates(0, 1)).toThrow(RangeError);
      expect(() => generateAutomaticDates(2025, 13)).toThrow(RangeError);
    });
  });

  describe('formatacao e parsing de datas e periodos', () => {
    it('toIsoDate preenche com zeros', () => {
      expect(toIsoDate(1, 2, 3)).toBe('0001-02-03');
      expect(toIsoDate(2025, 12, 31)).toBe('2025-12-31');
    });
    it('parseIsoDate aceita datas validas e rejeita invalidas', () => {
      expect(parseIsoDate('2024-02-29')).toEqual({ year: 2024, month: 2, day: 29 });
      expect(parseIsoDate('2023-02-29')).toBeNull();
      expect(parseIsoDate('2025-13-01')).toBeNull();
      expect(parseIsoDate('2025-1-1')).toBeNull(); // sem zero-pad
      expect(parseIsoDate('abc')).toBeNull();
    });
    it('toPeriod/parsePeriod sao inversos', () => {
      expect(toPeriod(2025, 2)).toBe('2025-02');
      expect(parsePeriod('2025-02')).toEqual({ year: 2025, month: 2 });
      expect(parsePeriod('2025-13')).toBeNull();
    });
  });
});
