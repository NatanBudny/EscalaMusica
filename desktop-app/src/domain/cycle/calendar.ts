// Calendario gregoriano puro para a geracao de cultos do Ciclo_Mensal.
//
// TypeScript puro, sem I/O, deterministico. Responsavel por:
//  - determinar o dia da semana gregoriano de uma data civil (Requisito 2.6);
//  - enumerar, para um periodo (ano/mes), todas as datas que sejam
//    quarta-feira, sabado ou domingo, sem duplicidade (Requisito 2.3).
//
// O calculo do dia da semana NAO usa `Date` do runtime para evitar qualquer
// dependencia de fuso horario, locale ou do relogio da maquina. Usa o algoritmo
// de congruencia de Zeller, valido para o calendario gregoriano proleptico, o
// que cobre todo o intervalo de ano permitido (1 a 9999).

import type { IsoDate, Weekday } from '../schemas/models';

/** Limites inteiros de ano e mes aceitos na abertura (Requisitos 2.1, 2.9). */
export const YEAR_MIN = 1;
export const YEAR_MAX = 9999;
export const MONTH_MIN = 1;
export const MONTH_MAX = 12;

// Dias da semana indexados conforme a convencao ISO: 1 = segunda ... 7 = domingo.
const WEEKDAY_BY_ISO: Record<number, Weekday> = {
  1: 'monday',
  2: 'tuesday',
  3: 'wednesday',
  4: 'thursday',
  5: 'friday',
  6: 'saturday',
  7: 'sunday',
};

/** Dias da semana gerados automaticamente (Requisito 2.3). */
export const AUTO_GENERATED_WEEKDAYS: readonly Weekday[] = ['wednesday', 'saturday', 'sunday'];

/** `true` quando `year` e um ano bissexto no calendario gregoriano. */
export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * Numero de dias do mes (1-12) no ano informado. Fevereiro depende do ano
 * bissexto; os demais meses sao fixos.
 */
export function daysInMonth(year: number, month: number): number {
  switch (month) {
    case 1:
      return 31;
    case 2:
      return isLeapYear(year) ? 29 : 28;
    case 3:
      return 31;
    case 4:
      return 30;
    case 5:
      return 31;
    case 6:
      return 30;
    case 7:
      return 31;
    case 8:
      return 31;
    case 9:
      return 30;
    case 10:
      return 31;
    case 11:
      return 30;
    case 12:
      return 31;
    default:
      throw new RangeError(`mes invalido: ${month}`);
  }
}

/** `true` quando `year` e inteiro no intervalo [1, 9999]. */
export function isValidYear(year: number): boolean {
  return Number.isInteger(year) && year >= YEAR_MIN && year <= YEAR_MAX;
}

/** `true` quando `month` e inteiro no intervalo [1, 12]. */
export function isValidMonth(month: number): boolean {
  return Number.isInteger(month) && month >= MONTH_MIN && month <= MONTH_MAX;
}

/**
 * Dia da semana gregoriano de uma data (ano, mes 1-12, dia 1-31), usando a
 * congruencia de Zeller. Independe de `Date`, fuso, locale e relogio.
 *
 * Lanca `RangeError` se o ano/mes/dia nao formarem uma data civil valida.
 */
export function weekdayOf(year: number, month: number, day: number): Weekday {
  if (!isValidYear(year)) throw new RangeError(`ano fora do intervalo 1-9999: ${year}`);
  if (!isValidMonth(month)) throw new RangeError(`mes fora do intervalo 1-12: ${month}`);
  const maxDay = daysInMonth(year, month);
  if (!Number.isInteger(day) || day < 1 || day > maxDay) {
    throw new RangeError(`dia invalido para ${year}-${month}: ${day}`);
  }

  // Zeller: janeiro e fevereiro sao tratados como meses 13 e 14 do ano anterior.
  let y = year;
  let m = month;
  if (m < 3) {
    m += 12;
    y -= 1;
  }
  const k = y % 100;
  const j = Math.floor(y / 100);
  // h: 0 = sabado, 1 = domingo, 2 = segunda, ... 6 = sexta.
  const h =
    (day + Math.floor((13 * (m + 1)) / 5) + k + Math.floor(k / 4) + Math.floor(j / 4) + 5 * j) % 7;
  // Converte h de Zeller para o indice ISO (1 = segunda ... 7 = domingo).
  // h:        0=Sab 1=Dom 2=Seg 3=Ter 4=Qua 5=Qui 6=Sex
  const isoByZeller: Record<number, number> = { 0: 6, 1: 7, 2: 1, 3: 2, 4: 3, 5: 4, 6: 5 };
  return WEEKDAY_BY_ISO[isoByZeller[h] as number] as Weekday;
}

/** Formata ano/mes/dia como data civil ISO `YYYY-MM-DD` (ano com 4 digitos). */
export function toIsoDate(year: number, month: number, day: number): IsoDate {
  const yy = String(year).padStart(4, '0');
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/** Decompoe uma data ISO `YYYY-MM-DD` em componentes numericos. */
export function parseIsoDate(date: IsoDate): { year: number; month: number; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (!isValidYear(year) || !isValidMonth(month)) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

/** Periodo canonico `YYYY-MM` de um ano/mes validos. */
export function toPeriod(year: number, month: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
}

/** Decompoe um periodo `YYYY-MM` em ano/mes, ou `null` se invalido. */
export function parsePeriod(period: string): { year: number; month: number } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (!isValidYear(year) || !isValidMonth(month)) return null;
  return { year, month };
}

/** Uma data gerada do calendario, com seu dia da semana computado. */
export interface CalendarDate {
  date: IsoDate;
  weekday: Weekday;
}

/**
 * Enumera, em ordem cronologica, todas as datas do mes (ano/mes) cujo dia da
 * semana esteja em `AUTO_GENERATED_WEEKDAYS` (quarta, sabado, domingo). Cada
 * data aparece no maximo uma vez (Requisito 2.3) e carrega o dia da semana
 * gregoriano correto (Requisito 2.6).
 *
 * Lanca `RangeError` quando ano/mes estao fora dos intervalos permitidos.
 */
export function generateAutomaticDates(year: number, month: number): CalendarDate[] {
  if (!isValidYear(year)) throw new RangeError(`ano fora do intervalo 1-9999: ${year}`);
  if (!isValidMonth(month)) throw new RangeError(`mes fora do intervalo 1-12: ${month}`);

  const auto = new Set<Weekday>(AUTO_GENERATED_WEEKDAYS);
  const out: CalendarDate[] = [];
  const total = daysInMonth(year, month);
  for (let day = 1; day <= total; day++) {
    const weekday = weekdayOf(year, month, day);
    if (auto.has(weekday)) {
      out.push({ date: toIsoDate(year, month, day), weekday });
    }
  }
  return out;
}
