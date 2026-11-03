// Feature: gestao-leiga-de-escalas, Property 2: Abertura mensal é única e idempotente
//
// Property 2 (design.md): Para todo ano inteiro entre 1 e 9999 e mês inteiro
// entre 1 e 12, abrir o período uma ou mais vezes produz exatamente um
// Ciclo_Mensal; depois da primeira abertura, novas aberturas preservam
// integralmente seu estado e Rascunho.
//
// Validates: Requirements 2.1, 2.2
//
// Estratégia: geradores inteligentes restringem ano a [1, 9999] e mês a [1, 12]
// (o espaço de entrada válido do critério 2.1) e um número arbitrário de
// reaberturas. A primeira abertura cria exatamente um ciclo identificado pelo
// par ano/mês. Cada reabertura é feita com ids e revisão de rascunho DIFERENTES
// que, por serem ignorados, provam que a reabertura não cria outro ciclo nem
// altera dados, rascunho ou estado do ciclo existente (2.2).

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { openCycle, type CycleAggregate, type OpenCycleInput } from './cycleService';
import { toPeriod } from './calendar';
import type { Uuid } from '../schemas/models';

// No mínimo 100 execuções (Notas do tasks.md); seed/replayPath visíveis em falha.
const RUNS = 300;

const NOW = '2026-01-15T12:00:00Z';

/** UUID v4 determinístico a partir de um inteiro, para ids de teste. */
const uuid = (n: number): Uuid =>
  `00000000-0000-4000-8000-${(n >>> 0).toString(16).padStart(12, '0')}` as Uuid;

/**
 * Entrada de abertura para uma dada tentativa. Cada tentativa usa ids e revisão
 * de rascunho distintos; a reabertura deve ignorá-los e preservar os do ciclo
 * já existente.
 */
function makeInput(year: number, month: number, attempt: number): OpenCycleInput {
  return {
    year,
    month,
    cycleId: uuid(1_000_000 + attempt),
    ruleSetVersionId: uuid(2_000_000 + attempt),
    serviceId: (i) => uuid(3_000_000 + attempt * 1000 + i),
    initialDraftRevision: String(attempt % 10).repeat(64).slice(0, 64),
    now: NOW,
  };
}

describe('Property 2: Abertura mensal é única e idempotente (2.1, 2.2)', () => {
  it('primeira abertura cria um ciclo único; reaberturas preservam estado e rascunho', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 9999 }),
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 0, max: 6 }),
        (year, month, reopens) => {
          const period = toPeriod(year, month);

          // ---- 2.1: primeira abertura cria EXATAMENTE um ciclo único. ----
          const firstInput = makeInput(year, month, 0);
          const first = openCycle(firstInput, null);
          expect(first.ok).toBe(true);
          if (!first.ok) return;

          const created: CycleAggregate = first.value;

          // Identificado de forma única pela combinação ano/mês.
          expect(created.cycle.period).toBe(period);
          // Recém-criado: aberto, na etapa de abertura.
          expect(created.cycle.state).toBe('open');
          expect(created.cycle.stage).toBe('opening');
          // Usa os ids/revisão da PRIMEIRA abertura.
          expect(created.cycle.id).toBe(firstInput.cycleId);
          expect(created.cycle.ruleSetVersionId).toBe(firstInput.ruleSetVersionId);
          expect(created.cycle.currentDraftRevision).toBe(firstInput.initialDraftRevision);

          // Snapshot canônico imutável: nada pode mudar depois da criação.
          const snapshot = JSON.stringify(created);

          // ---- 2.2: reaberturas do mesmo período são idempotentes. ----
          let store: CycleAggregate = created;
          for (let attempt = 1; attempt <= reopens; attempt++) {
            // Propõe ids/revisão diferentes, que devem ser ignorados.
            const again = openCycle(makeInput(year, month, attempt), store);
            expect(again.ok).toBe(true);
            if (!again.ok) return;

            // Abre o único ciclo existente sem criar outro: mesma referência
            // e bytes idênticos aos da criação.
            expect(again.value).toBe(store);
            expect(JSON.stringify(again.value)).toBe(snapshot);

            // Dados, rascunho e estado inalterados em relação à criação.
            expect(again.value.cycle.id).toBe(created.cycle.id);
            expect(again.value.cycle.period).toBe(period);
            expect(again.value.cycle.state).toBe(created.cycle.state);
            expect(again.value.cycle.stage).toBe(created.cycle.stage);
            expect(again.value.cycle.currentDraftRevision).toBe(created.cycle.currentDraftRevision);
            expect(again.value.cycle.ruleSetVersionId).toBe(created.cycle.ruleSetVersionId);
            expect(again.value.cycle.serviceIds).toEqual(created.cycle.serviceIds);
            expect(again.value.services).toEqual(created.services);
            expect(again.value.cycle.stageCompletions).toEqual(created.cycle.stageCompletions);
            expect(again.value.cycle.updatedAt).toBe(created.cycle.updatedAt);

            store = again.value;
          }

          // Após todas as reaberturas, continua existindo exatamente o mesmo ciclo.
          expect(JSON.stringify(store)).toBe(snapshot);
        },
      ),
      { numRuns: RUNS },
    );
  });
});
