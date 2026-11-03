// Feature: gestao-leiga-de-escalas, Property 23: Aplicabilidade temporal é inclusiva
//
// Tarefa 5.4. Property 23 (design.md): "Para toda regra ou exceção com vigência
// e toda data de culto, ela se aplica se e somente se a data pertence ao
// intervalo inclusivo; regra sem qualquer interseção com o ciclo não produz
// achado, e exceção fora da vigência nunca suprime Bloqueio."
//
// Valida: Requisitos 6.5, 6.8.
//
// Esta propriedade exercita a INCLUSIVIDADE nas duas bordas da vigência,
// comparando o comportamento das duas operações do RuleSetService contra um
// oráculo independente derivado diretamente da definição do intervalo fechado:
//
//  (A) Vigência de regra × datas do ciclo (6.5):
//      `applicableRules(versionId, cycleServiceDates)` retorna as regras da
//      versão se e somente se a vigência [validFrom, validUntil] da versão
//      intersecta ALGUMA data de culto do ciclo (inclusive). Sem interseção, o
//      conjunto é vazio — a regra é desconsiderada e não produz achado.
//
//      O oráculo `anyDateInWindow` recomputa a interseção de forma independente
//      (itera as datas e testa `from <= d <= until`). O resultado do serviço
//      deve coincidir com o oráculo para TODAS as combinações geradas.
//
//  (B) Vigência de exceção × data do culto (6.8):
//      `assertExceptionApplicable(exceptionId, serviceDate)` aceita se e somente
//      se `validFrom <= serviceDate <= validUntil` (intervalo fechado). Qualquer
//      data fora — mesmo um único dia antes do início ou após o fim — é rejeitada
//      com `exception-out-of-validity`, de modo que a exceção NUNCA suprime um
//      Bloqueio fora da vigência.
//
//      O oráculo `inClosedInterval` recomputa a pertinência de forma independente.
//
// Geradores inteligentes constroem datas ISO válidas e janelas de vigência
// bem formadas (validUntil >= validFrom), cobrindo explicitamente as bordas
// (exatamente validFrom, exatamente validUntil, um dia fora de cada lado) e
// janelas de um único dia (validFrom === validUntil). O shrinking preserva as
// pré-condições (datas válidas, janela não invertida).

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { RuleSetService, type RuleSetResult } from './rule-set-service';
import { field, lit } from './predicate';
import type { IsoDate, Rule, RulePredicate, Uuid } from '../schemas/models';

const RUNS = 300;

const NOW = '2026-01-15T12:00:00Z';
const APPROVED_AT = '2026-01-16T09:00:00Z';
const APPROVER: Uuid = '00000000-0000-4000-8000-0000000000aa';

const toId = (n: number): Uuid =>
  `00000000-0000-4000-8000-${(n >>> 0).toString(16).padStart(12, '0')}`;

function must<T>(r: RuleSetResult<T>, ctx: string): T {
  if (!r.ok) throw new Error(`${ctx} falhou: ${JSON.stringify(r.error)}`);
  return r.value;
}

// --------------------------------------------------------------------------
// Datas: conversão determinística dia <-> ISO (oráculo independente)
// --------------------------------------------------------------------------

const DAY_MS = 86_400_000;
/** Epoch de referência arbitrário dentro do intervalo civil suportado. */
const BASE_EPOCH_DAY = Date.UTC(2026, 0, 1) / DAY_MS; // 2026-01-01

/** Converte um deslocamento inteiro de dias em uma data ISO `YYYY-MM-DD`. */
function isoFromOffset(offsetDays: number): IsoDate {
  const ms = (BASE_EPOCH_DAY + offsetDays) * DAY_MS;
  return new Date(ms).toISOString().slice(0, 10) as IsoDate;
}

/**
 * Oráculo: `true` se alguma data do conjunto pertence ao intervalo fechado
 * [from, until] (until ausente => aberto à direita). Recalcula a interseção
 * de forma independente do serviço, usando comparação lexicográfica de ISO
 * (equivalente à cronológica para `YYYY-MM-DD`).
 */
function anyDateInWindow(from: IsoDate, until: IsoDate | undefined, dates: readonly IsoDate[]): boolean {
  return dates.some((d) => d >= from && (until === undefined || d <= until));
}

/** Oráculo: pertinência a um intervalo fechado [from, until]. */
function inClosedInterval(date: IsoDate, from: IsoDate, until: IsoDate): boolean {
  return date >= from && date <= until;
}

// --------------------------------------------------------------------------
// Geradores
// --------------------------------------------------------------------------

/** Deslocamento de dia dentro de uma faixa ampla, porém determinística. */
const offsetArb = fc.integer({ min: -400, max: 400 });

/** Uma regra fundamental bem formada (predicados válidos da DSL). */
const RULE: Rule = {
  id: toId(0x10),
  kind: 'fundamental',
  severity: 'blocking',
  applicability: { op: 'eq', args: [field('service.weekday'), lit('wednesday')] },
  assertion: { op: 'includes', args: ['subject.capabilityIds', lit('regente')] } as RulePredicate,
  messageTemplate: 'exige regente habilitado',
  allowedExceptionTypeIds: [],
};

/**
 * Janela de vigência bem formada (validUntil >= validFrom quando presente),
 * expressa como deslocamentos relativos ao epoch base.
 */
const windowArb: fc.Arbitrary<{ from: number; until: number | undefined }> = fc
  .tuple(offsetArb, fc.option(fc.integer({ min: 0, max: 200 }), { nil: undefined }))
  .map(([from, span]) => ({ from, until: span === undefined ? undefined : from + span }));

/**
 * Conjunto de datas do ciclo (como deslocamentos) de tamanho 1..6, cobrindo
 * bordas: inclui, com alta probabilidade, as extremidades exatas da janela e
 * pontos imediatamente fora dela.
 */
function cycleDatesArb(win: { from: number; until: number | undefined }): fc.Arbitrary<number[]> {
  const end = win.until ?? win.from + 30;
  const candidates = fc.constantFrom(
    win.from, // borda inicial exata
    win.from - 1, // um dia antes (fora)
    end, // borda final exata
    end + 1, // um dia depois (fora)
    Math.trunc((win.from + end) / 2), // ponto interior
  );
  return fc
    .array(fc.oneof(candidates, offsetArb), { minLength: 1, maxLength: 6 })
    .map((xs) => [...xs]);
}

// --------------------------------------------------------------------------
// (A) Vigência de regra × datas do ciclo (6.5)
// --------------------------------------------------------------------------

describe('Property 23: Aplicabilidade temporal é inclusiva', () => {
  it('(A) regra aplica-se sse a vigência intersecta alguma data do ciclo, inclusive (6.5)', () => {
    fc.assert(
      fc.property(
        windowArb.chain((win) =>
          fc.record({ win: fc.constant(win), cycle: cycleDatesArb(win) }),
        ),
        ({ win, cycle }) => {
          const from = isoFromOffset(win.from);
          const until = win.until === undefined ? undefined : isoFromOffset(win.until);
          const dates = cycle.map(isoFromOffset);

          const svc = new RuleSetService();
          must(
            svc.defineVersion({
              id: toId(0xaaa0),
              version: 'v1',
              validFrom: from,
              ...(until !== undefined ? { validUntil: until } : {}),
              rules: [RULE],
              now: NOW,
            }),
            'defineVersion',
          );
          must(
            svc.approveVersion({ id: toId(0xaaa0), approvedBy: APPROVER, approvedAt: APPROVED_AT }),
            'approveVersion',
          );

          const res = must(svc.applicableRules(toId(0xaaa0), dates), 'applicableRules');
          const expectedApplies = anyDateInWindow(from, until, dates);

          // O serviço concorda com o oráculo independente: aplica <=> interseção.
          expect(res.length).toBe(expectedApplies ? 1 : 0);
          // Sem interseção, a regra é desconsiderada (nenhum achado): conjunto vazio.
          if (!expectedApplies) expect(res).toHaveLength(0);
        },
      ),
      { numRuns: RUNS },
    );
  });

  it('(A-bordas) data exatamente na borda da vigência torna a regra aplicável', () => {
    fc.assert(
      fc.property(windowArb, (win) => {
        const from = isoFromOffset(win.from);
        const until = win.until === undefined ? undefined : isoFromOffset(win.until);

        const svc = new RuleSetService();
        must(
          svc.defineVersion({
            id: toId(0xaaa1),
            version: 'v1',
            validFrom: from,
            ...(until !== undefined ? { validUntil: until } : {}),
            rules: [RULE],
            now: NOW,
          }),
          'defineVersion',
        );
        must(
          svc.approveVersion({ id: toId(0xaaa1), approvedBy: APPROVER, approvedAt: APPROVED_AT }),
          'approveVersion',
        );

        // Borda inicial: sempre dentro (inclusiva).
        expect(must(svc.applicableRules(toId(0xaaa1), [from]), 'from')).toHaveLength(1);
        // Um dia antes do início: fora.
        const dayBefore = isoFromOffset(win.from - 1);
        expect(must(svc.applicableRules(toId(0xaaa1), [dayBefore]), 'before')).toHaveLength(0);

        if (until !== undefined) {
          // Borda final: sempre dentro (inclusiva).
          expect(must(svc.applicableRules(toId(0xaaa1), [until]), 'until')).toHaveLength(1);
          // Um dia depois do fim: fora.
          const dayAfter = isoFromOffset((win.until as number) + 1);
          expect(must(svc.applicableRules(toId(0xaaa1), [dayAfter]), 'after')).toHaveLength(0);
        }
      }),
      { numRuns: RUNS },
    );
  });

  // ------------------------------------------------------------------------
  // (B) Vigência de exceção × data do culto (6.8)
  // ------------------------------------------------------------------------

  /** Monta um serviço com uma RF e UMA exceção na janela [from, until]. */
  function serviceWithException(from: IsoDate, until: IsoDate): RuleSetService {
    const svc = new RuleSetService();
    must(
      svc.defineVersion({
        id: toId(0xbbb0),
        version: 'v1',
        validFrom: '2020-01-01',
        validUntil: '2030-12-31',
        rules: [RULE],
        now: NOW,
      }),
      'defineVersion',
    );
    must(
      svc.approveVersion({ id: toId(0xbbb0), approvedBy: APPROVER, approvedAt: APPROVED_AT }),
      'approveVersion',
    );
    must(
      svc.registerException({
        id: toId(0x100),
        fundamentalRuleId: RULE.id,
        condition: { op: 'eq', args: [field('assignment.roleId'), lit('regente')] },
        validFrom: from,
        validUntil: until,
        justification: 'janela de vigência',
        approvedBy: APPROVER,
        approvedAt: APPROVED_AT,
      }),
      'registerException',
    );
    return svc;
  }

  it('(B) exceção aplica-se sse a data do culto está em [validFrom, validUntil], inclusive (6.8)', () => {
    fc.assert(
      fc.property(
        fc
          // Janela sempre bem formada: validUntil >= validFrom.
          .tuple(offsetArb, fc.integer({ min: 0, max: 200 }))
          .chain(([from, span]) => {
            const until = from + span;
            const probe = fc.oneof(
              fc.constantFrom(from, from - 1, until, until + 1, Math.trunc((from + until) / 2)),
              offsetArb,
            );
            return fc.record({
              from: fc.constant(from),
              until: fc.constant(until),
              probe,
            });
          }),
        ({ from, until, probe }) => {
          const fromIso = isoFromOffset(from);
          const untilIso = isoFromOffset(until);
          const dateIso = isoFromOffset(probe);

          const svc = serviceWithException(fromIso, untilIso);
          const res = svc.assertExceptionApplicable(toId(0x100), dateIso);
          const expected = inClosedInterval(dateIso, fromIso, untilIso);

          // Concordância com o oráculo: aceita <=> data no intervalo fechado.
          expect(res.ok).toBe(expected);
          if (!res.ok) {
            // Fora da vigência: a exceção NUNCA suprime o Bloqueio.
            expect(res.error.code).toBe('exception-out-of-validity');
          }
        },
      ),
      { numRuns: RUNS },
    );
  });

  it('(B-bordas) bordas exatas são aceitas; um dia fora de cada lado é rejeitado (6.8)', () => {
    fc.assert(
      fc.property(
        fc.tuple(offsetArb, fc.integer({ min: 0, max: 200 })),
        ([from, span]) => {
          const until = from + span;
          const fromIso = isoFromOffset(from);
          const untilIso = isoFromOffset(until);
          const svc = serviceWithException(fromIso, untilIso);

          // Bordas inclusivas.
          expect(svc.assertExceptionApplicable(toId(0x100), fromIso).ok).toBe(true);
          expect(svc.assertExceptionApplicable(toId(0x100), untilIso).ok).toBe(true);

          // Um dia antes do início: fora, não suprime Bloqueio.
          const before = svc.assertExceptionApplicable(toId(0x100), isoFromOffset(from - 1));
          expect(before.ok).toBe(false);
          if (!before.ok) expect(before.error.code).toBe('exception-out-of-validity');

          // Um dia depois do fim: fora, não suprime Bloqueio.
          const after = svc.assertExceptionApplicable(toId(0x100), isoFromOffset(until + 1));
          expect(after.ok).toBe(false);
          if (!after.ok) expect(after.error.code).toBe('exception-out-of-validity');
        },
      ),
      { numRuns: RUNS },
    );
  });
});
