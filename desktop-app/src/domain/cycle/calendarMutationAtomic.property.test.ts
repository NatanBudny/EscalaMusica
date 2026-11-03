// Feature: gestao-leiga-de-escalas, Property 4: Alterações do calendário são atômicas
//
// Property 4 (design.md):
// "Para todo ciclo e culto, adicionar um culto extraordinário válido inclui
//  exatamente esse culto e preserva os demais; remover um culto com motivo
//  válido exclui exatamente esse culto e registra o motivo; qualquer dia
//  informado divergente ou motivo inválido rejeita toda a operação e preserva
//  o estado anterior."
//
// Validates: Requirements 2.4, 2.5, 2.7, 2.10
//
// Estratégia: geradores inteligentes constroem um `CycleAggregate` válido para
// um período aleatório (ano/mês), com os cultos automáticos reais do mês e um
// subconjunto arbitrário marcado como removido. Sobre esse agregado testamos:
//
//   - APLICAÇÃO TOTAL de `addExtraordinaryService` com data válida do período:
//     exatamente um culto é incluído, nenhum culto existente muda (datas,
//     flags de remoção e IDs preservados) — Requisito 2.4.
//   - APLICAÇÃO TOTAL de `removeService` com motivo válido (1..500 após trim):
//     exatamente um culto passa a removido, o motivo (trim) e a auditoria ficam
//     registrados e nenhum outro culto muda — Requisito 2.5.
//   - REJEIÇÃO ATÔMICA: dia da semana informado divergente (2.7) e motivo
//     inválido/ausente/só-espaços/>500 (2.10), além de data fora do período e
//     data duplicada, deixam o agregado anterior byte-a-byte idêntico (nenhuma
//     mutação parcial).
//
// A corretude não reusa a lógica sob teste: a referência de "estado anterior"
// é um snapshot serializado (JSON canônico) capturado antes da operação, e o
// oráculo de dia-da-semana é uma enumeração manual independente de Zeller.

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  addExtraordinaryService,
  removeService,
  type CycleAggregate,
} from './cycleService';
import { daysInMonth, generateAutomaticDates, toIsoDate } from './calendar';
import { SCHEMA_VERSION } from '../schemas/models';
import type { MonthlyCycle, Service, Uuid, Weekday } from '../schemas/models';

// No mínimo 100 execuções (Notas do tasks.md); seed/replayPath aparecem em falha.
const RUNS = 300;

// --------------------------------------------------------------------------
// Oráculo independente de dia da semana (NÃO usa Zeller nem `Date`).
// 0001-01-01 é segunda no gregoriano proléptico (índice 0 em WEEKDAYS).
// --------------------------------------------------------------------------

const WEEKDAYS: readonly Weekday[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];

const isLeap = (year: number): boolean =>
  (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

const monthLength = (year: number, month: number): number =>
  ([31, isLeap(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] as number);

const dayNumber = (year: number, month: number, day: number): number => {
  let n = 0;
  for (let y = 1; y < year; y++) n += isLeap(y) ? 366 : 365;
  for (let m = 1; m < month; m++) n += monthLength(year, m);
  return n + day;
};

const oracleWeekday = (year: number, month: number, day: number): Weekday =>
  WEEKDAYS[(dayNumber(year, month, day) - 1) % 7] as Weekday;

// --------------------------------------------------------------------------
// Geradores inteligentes.
// --------------------------------------------------------------------------

const uuidArb = (tag: string): fc.Arbitrary<Uuid> =>
  fc
    .integer({ min: 0, max: 0xffffffff })
    .map((n) => `00000000-0000-4000-8000-${tag}${(n >>> 0).toString(16).padStart(6, '0')}` as Uuid);

// Período válido. Restringimos a anos recentes para manter os IDs e datas
// legíveis; a atomicidade não depende do valor absoluto do ano.
const yearArb = fc.integer({ min: 1900, max: 2400 });
const monthArb = fc.integer({ min: 1, max: 12 });

const isoInstantArb: fc.Arbitrary<string> = fc
  .integer({ min: 0, max: 3_155_760_000_000 })
  .map((offset) => new Date(Date.UTC(2000, 0, 1) + offset).toISOString());

/**
 * Agregado válido: ciclo com os cultos automáticos reais de (ano, mês), com um
 * subconjunto arbitrário marcado como removido. IDs determinísticos por índice.
 */
interface AggregateSpec {
  year: number;
  month: number;
  cycleId: Uuid;
  ruleSetVersionId: Uuid;
  removedFlags: boolean[];
  now: string;
}

function buildAggregate(spec: AggregateSpec): CycleAggregate {
  const dates = generateAutomaticDates(spec.year, spec.month);
  const services: Service[] = dates.map((d, i) => {
    const base: Service = {
      schemaVersion: SCHEMA_VERSION,
      id: `00000000-0000-4000-8000-5e5e${String(i).padStart(8, '0')}` as Uuid,
      cycleId: spec.cycleId,
      date: d.date,
      computedWeekday: d.weekday,
      kind: 'regular',
      externalInputIds: [],
    };
    if (spec.removedFlags[i] === true) {
      return {
        ...base,
        removed: {
          reason: 'motivo previo',
          removedAt: spec.now,
          operatorId: spec.ruleSetVersionId,
        },
      };
    }
    return base;
  });

  const cycle: MonthlyCycle = {
    schemaVersion: SCHEMA_VERSION,
    id: spec.cycleId,
    period: `${String(spec.year).padStart(4, '0')}-${String(spec.month).padStart(2, '0')}`,
    state: 'open',
    stage: 'opening',
    ruleSetVersionId: spec.ruleSetVersionId,
    currentDraftRevision: 'a'.repeat(64),
    serviceIds: services.map((s) => s.id),
    stageCompletions: [],
    createdAt: spec.now,
    updatedAt: spec.now,
  };

  return { cycle, services };
}

const aggregateArb: fc.Arbitrary<CycleAggregate> = fc
  .record({
    year: yearArb,
    month: monthArb,
    cycleId: uuidArb('aaaaaa'),
    ruleSetVersionId: uuidArb('bbbbbb'),
    now: isoInstantArb,
  })
  .chain((base) => {
    const count = generateAutomaticDates(base.year, base.month).length;
    return fc
      .array(fc.boolean(), { minLength: count, maxLength: count })
      .map((removedFlags) => buildAggregate({ ...base, removedFlags }));
  });

/** Snapshot canônico determinístico do agregado (ordena coleções sem semântica). */
function snapshot(aggregate: CycleAggregate): string {
  const servicesSorted = [...aggregate.services].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  return JSON.stringify({ cycle: aggregate.cycle, services: servicesSorted });
}

/** Índice (1-based) de um dia do período que não colide com culto ativo. */
function freeDayInPeriod(aggregate: CycleAggregate, year: number, month: number): number | null {
  const activeDates = new Set(
    aggregate.services.filter((s) => s.removed === undefined).map((s) => s.date),
  );
  const total = daysInMonth(year, month);
  for (let day = 1; day <= total; day++) {
    if (!activeDates.has(toIsoDate(year, month, day))) return day;
  }
  return null;
}

// --------------------------------------------------------------------------
// Parte A — Adição válida: aplica exatamente um culto, preserva os demais (2.4).
// --------------------------------------------------------------------------

describe('Property 4: alterações do calendário são atômicas (2.4, 2.5, 2.7, 2.10)', () => {
  it('adição válida inclui exatamente um culto e preserva todos os existentes (2.4)', () => {
    fc.assert(
      fc.property(aggregateArb, isoInstantArb, (agg, now) => {
        const parsed = parsePeriodOf(agg);
        // Escolhe o primeiro dia livre do período de forma determinística.
        const free = freeDayInPeriod(agg, parsed.year, parsed.month);
        // Pode não haver dia livre (mês inteiro já ocupado por cultos ativos);
        // nesse caso não há caso de adição válida a exercitar.
        fc.pre(free !== null);
        const day = free as number;

        const date = toIsoDate(parsed.year, parsed.month, day);
        const before = snapshot(agg);
        const beforeIds = new Set(agg.services.map((s) => s.id));
        const newId = `00000000-0000-4000-8000-c17a${String(day).padStart(8, '0')}` as Uuid;

        const result = addExtraordinaryService(agg, {
          date,
          serviceId: newId,
          now,
        });

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const next = result.value;

        // A entrada não foi mutada (atomicidade do caso de sucesso também não
        // altera o objeto original — pureza).
        expect(snapshot(agg)).toBe(before);

        // Exatamente um culto a mais.
        expect(next.services.length).toBe(agg.services.length + 1);

        // O novo culto é exatamente o inserido, com dia da semana do oráculo.
        const added = next.services.filter((s) => !beforeIds.has(s.id));
        expect(added.length).toBe(1);
        const only = added[0] as Service;
        expect(only.id).toBe(newId);
        expect(only.date).toBe(date);
        expect(only.kind).toBe('extraordinary');
        expect(only.computedWeekday).toBe(oracleWeekday(parsed.year, parsed.month, day));

        // Todos os cultos existentes permanecem idênticos (byte-a-byte via JSON).
        const beforeById = new Map(agg.services.map((s) => [s.id, JSON.stringify(s)]));
        for (const s of next.services) {
          if (beforeById.has(s.id)) {
            expect(JSON.stringify(s)).toBe(beforeById.get(s.id));
          }
        }

        // `serviceIds` do ciclo acompanha exatamente os cultos resultantes.
        expect(new Set(next.cycle.serviceIds)).toEqual(new Set(next.services.map((s) => s.id)));
      }),
      { numRuns: RUNS },
    );
  });

  // ------------------------------------------------------------------------
  // Parte B — Remoção válida: remove exatamente um culto e registra o motivo (2.5).
  // ------------------------------------------------------------------------

  it('remoção válida remove exatamente um culto e registra o motivo (trim) (2.5)', () => {
    const reasonArb = fc
      .tuple(
        fc.stringMatching(/^[ \t]{0,5}$/),
        fc.string({ minLength: 1, maxLength: 60 }).filter((s) => s.trim().length >= 1),
        fc.stringMatching(/^[ \t]{0,5}$/),
      )
      .map(([lead, core, trail]) => lead + core + trail);

    fc.assert(
      fc.property(aggregateArb, fc.nat(), reasonArb, isoInstantArb, uuidArb('0'), (agg, pick, reason, now, operatorId) => {
        const active = agg.services.filter((s) => s.removed === undefined);
        // Precisa existir ao menos um culto ativo para remover.
        fc.pre(active.length > 0);
        const target = active[pick % active.length] as Service;

        const before = snapshot(agg);
        const result = removeService(agg, {
          serviceId: target.id,
          reason,
          operatorId,
          now,
        });

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const next = result.value;

        // Entrada não mutada (pureza).
        expect(snapshot(agg)).toBe(before);

        // Mesmo número de cultos (remoção é lógica), apenas um novo removido.
        expect(next.services.length).toBe(agg.services.length);
        const activeBefore = active.length;
        const activeAfter = next.services.filter((s) => s.removed === undefined).length;
        expect(activeAfter).toBe(activeBefore - 1);

        // O alvo ficou removido com o motivo (trim) e a auditoria registrados.
        const updated = next.services.find((s) => s.id === target.id) as Service;
        expect(updated.removed).toBeDefined();
        expect(updated.removed?.reason).toBe(reason.trim());
        expect(updated.removed?.removedAt).toBe(now);
        expect(updated.removed?.operatorId).toBe(operatorId);
        // A data e demais campos imutáveis do culto não mudam.
        expect(updated.date).toBe(target.date);
        expect(updated.computedWeekday).toBe(target.computedWeekday);

        // Nenhum outro culto muda (byte-a-byte).
        const beforeById = new Map(agg.services.map((s) => [s.id, JSON.stringify(s)]));
        for (const s of next.services) {
          if (s.id !== target.id) {
            expect(JSON.stringify(s)).toBe(beforeById.get(s.id));
          }
        }
      }),
      { numRuns: RUNS },
    );
  });

  // ------------------------------------------------------------------------
  // Parte C — Rejeição atômica da adição: dia divergente (2.7), data fora do
  // período e data duplicada. O agregado anterior fica intacto.
  // ------------------------------------------------------------------------

  it('adição com dia da semana informado divergente é rejeitada sem mutação (2.7)', () => {
    fc.assert(
      fc.property(aggregateArb, uuidArb('d'), isoInstantArb, (agg, newId, now) => {
        const parsed = parsePeriodOf(agg);
        const free = freeDayInPeriod(agg, parsed.year, parsed.month);
        fc.pre(free !== null);
        const day = free as number;
        const date = toIsoDate(parsed.year, parsed.month, day);
        const correct = oracleWeekday(parsed.year, parsed.month, day);
        // Um dia da semana qualquer, porém diferente do correto.
        const wrong = WEEKDAYS.find((w) => w !== correct) as Weekday;

        const before = snapshot(agg);
        const result = addExtraordinaryService(agg, {
          date,
          serviceId: newId,
          declaredWeekday: wrong,
          now,
        });

        // Rejeição com código 2.7 e preservação total do estado anterior.
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.code).toBe('weekday-mismatch');
        expect(snapshot(agg)).toBe(before);
      }),
      { numRuns: RUNS },
    );
  });

  it('adição de data fora do período ou duplicada é rejeitada sem mutação', () => {
    fc.assert(
      fc.property(aggregateArb, uuidArb('e'), isoInstantArb, fc.boolean(), (agg, newId, now, chooseDuplicate) => {
        const parsed = parsePeriodOf(agg);
        const before = snapshot(agg);

        if (chooseDuplicate) {
          // Duplicar uma data de culto ativo existente.
          const active = agg.services.filter((s) => s.removed === undefined);
          fc.pre(active.length > 0);
          const dupDate = (active[0] as Service).date;
          const result = addExtraordinaryService(agg, { date: dupDate, serviceId: newId, now });
          expect(result.ok).toBe(false);
          if (result.ok) return;
          expect(result.error.code).toBe('duplicate-date');
          expect(snapshot(agg)).toBe(before);
        } else {
          // Data de um mês diferente (fora do período).
          const otherMonth = parsed.month === 12 ? 1 : parsed.month + 1;
          const outDate = toIsoDate(parsed.year, otherMonth, 1);
          const result = addExtraordinaryService(agg, { date: outDate, serviceId: newId, now });
          expect(result.ok).toBe(false);
          if (result.ok) return;
          expect(result.error.code).toBe('date-not-in-period');
          expect(snapshot(agg)).toBe(before);
        }
      }),
      { numRuns: RUNS },
    );
  });

  // ------------------------------------------------------------------------
  // Parte D — Rejeição atômica da remoção: motivo ausente, só-espaços ou > 500
  // após trim (2.10). O agregado anterior fica intacto.
  // ------------------------------------------------------------------------

  it('remoção com motivo inválido (ausente, só espaços ou > 500 após trim) é rejeitada sem mutação (2.10)', () => {
    const invalidReasonArb = fc.oneof(
      fc.constant(''), // ausente
      fc.stringMatching(/^[ \t\n]{1,10}$/), // só espaços
      fc.string({ minLength: 501, maxLength: 540 }).map((s) => {
        // Garante > 500 após trim preenchendo o miolo com não-espaços.
        const core = 'x'.repeat(501) + s.replace(/\s/g, 'x');
        return core;
      }),
    );

    fc.assert(
      fc.property(aggregateArb, fc.nat(), invalidReasonArb, isoInstantArb, uuidArb('1'), (agg, pick, reason, now, operatorId) => {
        const active = agg.services.filter((s) => s.removed === undefined);
        fc.pre(active.length > 0);
        const target = active[pick % active.length] as Service;

        const before = snapshot(agg);
        const result = removeService(agg, {
          serviceId: target.id,
          reason,
          operatorId,
          now,
        });

        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.code).toBe('removal-reason-length');
        // Preservação total: a data e seus dados permanecem (Requisito 2.10).
        expect(snapshot(agg)).toBe(before);
      }),
      { numRuns: RUNS },
    );
  });
});

// --------------------------------------------------------------------------
// Helper: período do agregado como componentes numéricos (independente do
// código sob teste; apenas decompõe `YYYY-MM`).
// --------------------------------------------------------------------------
function parsePeriodOf(aggregate: CycleAggregate): { year: number; month: number } {
  const [yy, mm] = aggregate.cycle.period.split('-');
  return { year: Number(yy), month: Number(mm) };
}
