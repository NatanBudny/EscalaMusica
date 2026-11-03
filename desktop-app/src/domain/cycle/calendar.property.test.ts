import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  AUTO_GENERATED_WEEKDAYS,
  daysInMonth,
  generateAutomaticDates,
  toIsoDate,
  weekdayOf,
} from './calendar';
import type { Weekday } from '../schemas/models';

// Feature: gestao-leiga-de-escalas, Property 3: Calendário mensal é completo e correto

// Property 3 (design.md):
// "Para todo período válido, os cultos gerados automaticamente correspondem
//  exatamente, sem duplicidade, às datas gregorianas do mês que sejam
//  quartas-feiras, sábados ou domingos, e cada data tem o dia da semana
//  gregoriano correto."
// Valida: Requisitos 2.3, 2.6.

// --- Oracle independente -----------------------------------------------------
//
// A corretude do teste depende de NAO reutilizar a mesma logica do codigo sob
// teste. `generateAutomaticDates`/`weekdayOf` usam a congruencia de Zeller.
// A enumeracao manual abaixo deriva o dia da semana por contagem de dias desde
// uma ancora conhecida (0001-01-01, que no gregoriano proleptico e segunda),
// usando aritmetica de dias totalmente independente de Zeller e de `Date`.

const WEEKDAYS: readonly Weekday[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];

/** Ano bissexto gregoriano, derivado de forma independente do codigo sob teste. */
const isLeap = (year: number): boolean =>
  (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

/** Dias de cada mes, com fevereiro dependente do ano bissexto. */
const monthLength = (year: number, month: number): number => {
  const base = [31, isLeap(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return base[month - 1] as number;
};

/**
 * Numero ordinal do dia (1 = 0001-01-01) para uma data civil. Soma os dias de
 * todos os anos e meses anteriores. Independente de Zeller e de `Date`.
 */
const dayNumber = (year: number, month: number, day: number): number => {
  let n = 0;
  for (let y = 1; y < year; y++) n += isLeap(y) ? 366 : 365;
  for (let m = 1; m < month; m++) n += monthLength(year, m);
  return n + day;
};

/**
 * Dia da semana por contagem de dias desde a ancora. 0001-01-01 e segunda, cujo
 * indice em `WEEKDAYS` e 0; portanto (dayNumber - 1) mod 7 mapeia diretamente.
 */
const oracleWeekday = (year: number, month: number, day: number): Weekday =>
  WEEKDAYS[(dayNumber(year, month, day) - 1) % 7] as Weekday;

/** Enumeracao manual, independente, das datas auto-geradas do mes. */
const oracleAutomaticDates = (year: number, month: number): { date: string; weekday: Weekday }[] => {
  const auto = new Set<Weekday>(AUTO_GENERATED_WEEKDAYS);
  const out: { date: string; weekday: Weekday }[] = [];
  const total = monthLength(year, month);
  for (let day = 1; day <= total; day++) {
    const wd = oracleWeekday(year, month, day);
    if (auto.has(wd)) {
      const yy = String(year).padStart(4, '0');
      const mm = String(month).padStart(2, '0');
      const dd = String(day).padStart(2, '0');
      out.push({ date: `${yy}-${mm}-${dd}`, weekday: wd });
    }
  }
  return out;
};

// Geradores: ano inteiro em [1, 9999] e mes inteiro em [1, 12].
const validYear = fc.integer({ min: 1, max: 9999 });
const validMonth = fc.integer({ min: 1, max: 12 });

const PBT_OPTIONS = { numRuns: 500 } as const;

describe('Propriedade 3: calendario mensal e completo e correto', () => {
  it('as datas auto-geradas correspondem exatamente a enumeracao manual independente', () => {
    fc.assert(
      fc.property(validYear, validMonth, (year, month) => {
        const generated = generateAutomaticDates(year, month);
        const oracle = oracleAutomaticDates(year, month);

        // Completo e correto: mesma sequencia de datas e dias da semana que a
        // enumeracao manual, na mesma ordem.
        expect(generated).toEqual(oracle);
      }),
      PBT_OPTIONS,
    );
  });

  it('todas as datas geradas pertencem ao mes, sao quarta/sabado/domingo, unicas e cronologicas', () => {
    fc.assert(
      fc.property(validYear, validMonth, (year, month) => {
        const generated = generateAutomaticDates(year, month);
        const yy = String(year).padStart(4, '0');
        const mm = String(month).padStart(2, '0');

        const isoDates = generated.map((d) => d.date);

        for (const { date, weekday } of generated) {
          // Nada fora do mes: prefixo YYYY-MM exato.
          expect(date.startsWith(`${yy}-${mm}-`)).toBe(true);
          // Somente dias auto-gerados (quarta, sabado, domingo).
          expect(AUTO_GENERATED_WEEKDAYS).toContain(weekday);
          // Dia da semana gregoriano correto (Requisito 2.6), verificado pela
          // congruencia de Zeller exposta por weekdayOf.
          const [, , dd] = date.split('-');
          expect(weekdayOf(year, month, Number(dd))).toBe(weekday);
        }

        // Sem duplicidade (Requisito 2.3).
        expect(new Set(isoDates).size).toBe(isoDates.length);

        // Ordem cronologica estrita: cada data e estritamente maior que a
        // anterior. Como todas tem o mesmo prefixo YYYY-MM, a ordenacao
        // lexicografica coincide com a cronologica.
        for (let i = 1; i < isoDates.length; i++) {
          expect((isoDates[i - 1] as string) < (isoDates[i] as string)).toBe(true);
        }
      }),
      PBT_OPTIONS,
    );
  });

  it('nenhuma data do mes auto-gerada e omitida (completude por cobertura)', () => {
    fc.assert(
      fc.property(validYear, validMonth, (year, month) => {
        const generated = new Set(generateAutomaticDates(year, month).map((d) => d.date));
        const auto = new Set<Weekday>(AUTO_GENERATED_WEEKDAYS);
        const total = daysInMonth(year, month);

        // Varre o mes dia a dia: toda quarta/sabado/domingo deve estar presente,
        // e nenhum outro dia pode estar.
        for (let day = 1; day <= total; day++) {
          const iso = toIsoDate(year, month, day);
          const wd = oracleWeekday(year, month, day);
          if (auto.has(wd)) {
            expect(generated.has(iso)).toBe(true);
          } else {
            expect(generated.has(iso)).toBe(false);
          }
        }
      }),
      PBT_OPTIONS,
    );
  });
});
