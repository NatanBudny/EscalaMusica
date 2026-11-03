// Feature: gestao-leiga-de-escalas, Property 5: Estado do ciclo é exclusivo
//
// Property 5 (design.md): Para toda sequência válida de transições, um
// Ciclo_Mensal possui exatamente um estado entre aberto, publicado e arquivado,
// e sua editabilidade e relação com a escala vigente correspondem à definição
// desse estado.
//
// Validates: Requirements 2.8
//
// Semântica do Requisito 2.8 (cada ciclo recebe exatamente um dos estados
// mutuamente exclusivos):
//   - aberto (open):      Rascunho editável E versão atual não é a Escala vigente;
//   - publicado (published): versão confirmada é a Escala vigente E sem edição direta (somente leitura);
//   - arquivado (archived):  não é a Escala vigente E somente leitura.
//
// Estratégia dos geradores: um gerador inteligente constrói ciclos válidos cujo
// `state` é exatamente um dos três valores permitidos, mais uma *sequência* de
// transições de estado (open -> published -> archived, etc.). Para cada ciclo
// alcançado por qualquer sequência, verificamos:
//   1. exclusividade — `state` é exatamente um dos três e os fatos derivados
//      identificam um único estado;
//   2. semântica — editabilidade (draftEditable), relação com a Escala vigente
//      (isCurrentSchedule) e somente-leitura (readOnly) correspondem à
//      definição do estado.
// Testes de propriedade não fazem I/O (funções puras do domínio).

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { cycleStateFacts, hasExclusiveState } from './cycleService';
import { SCHEMA_VERSION } from '../schemas/models';
import type { CycleStage, MonthlyCycle, Uuid } from '../schemas/models';

// No mínimo 100 execuções (Notas do tasks.md); seed/replayPath visíveis em falha.
const RUNS = 300;

const NOW = '2026-01-15T12:00:00Z';

type CycleState = MonthlyCycle['state'];

const STATES: readonly CycleState[] = ['open', 'published', 'archived'];

const STAGES: readonly CycleStage[] = [
  'opening',
  'collection',
  'assembly',
  'validation',
  'approval',
  'publication',
  'closing',
];

/** UUID v4 determinístico a partir de um inteiro, para ids de teste. */
const uuid = (n: number): Uuid =>
  `00000000-0000-4000-8000-${(n >>> 0).toString(16).padStart(12, '0')}` as Uuid;

/** Hash de revisão de 64 hex determinístico a partir de um inteiro. */
const rev = (n: number): string => (n >>> 0).toString(16).padStart(64, '0').slice(0, 64);

/** Constrói um `MonthlyCycle` válido com o estado e a etapa informados. */
function makeCycle(state: CycleState, stage: CycleStage, seed: number): MonthlyCycle {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: uuid(10 + seed),
    period: `${String((seed % 9999) + 1).padStart(4, '0')}-${String((seed % 12) + 1).padStart(2, '0')}`,
    state,
    stage,
    ruleSetVersionId: uuid(1000 + seed),
    currentDraftRevision: rev(seed),
    serviceIds: [],
    stageCompletions: [],
    createdAt: NOW,
    updatedAt: NOW,
  };
}

/**
 * Verifica a exclusividade e a semântica do estado de um ciclo (Requisito 2.8).
 * Separado para ser reutilizado por ambos os casos (estado isolado e sequência).
 */
function assertExclusiveAndCoherent(cycle: MonthlyCycle): void {
  // ---- Exclusividade: exatamente um dos três estados permitidos. ----
  expect(hasExclusiveState(cycle)).toBe(true);
  // Exatamente um valor da união coincide com o estado atual.
  const matches = STATES.filter((s) => s === cycle.state);
  expect(matches).toHaveLength(1);

  const facts = cycleStateFacts(cycle);
  expect(facts.state).toBe(cycle.state);

  // ---- Semântica por estado (editabilidade e relação com a Escala vigente). ----
  switch (cycle.state) {
    case 'open':
      // aberto: Rascunho editável e NÃO é a Escala vigente; portanto não é só-leitura.
      expect(facts.draftEditable).toBe(true);
      expect(facts.isCurrentSchedule).toBe(false);
      expect(facts.readOnly).toBe(false);
      break;
    case 'published':
      // publicado: é a Escala vigente e somente leitura (sem edição direta).
      expect(facts.draftEditable).toBe(false);
      expect(facts.isCurrentSchedule).toBe(true);
      expect(facts.readOnly).toBe(true);
      break;
    case 'archived':
      // arquivado: NÃO é a Escala vigente e somente leitura.
      expect(facts.draftEditable).toBe(false);
      expect(facts.isCurrentSchedule).toBe(false);
      expect(facts.readOnly).toBe(true);
      break;
    default: {
      const never: never = cycle.state;
      throw new Error(`estado inesperado: ${String(never)}`);
    }
  }

  // Invariantes transversais derivadas da exclusividade:
  //  - exatamente um estado implica que editável e só-leitura são opostos;
  //  - só o estado publicado corresponde à Escala vigente.
  expect(facts.draftEditable).toBe(!facts.readOnly);
  expect(facts.isCurrentSchedule).toBe(cycle.state === 'published');
}

describe('Property 5: Estado do ciclo é exclusivo (2.8)', () => {
  it('todo ciclo válido tem exatamente um estado com a semântica correspondente', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...STATES),
        fc.constantFrom(...STAGES),
        fc.integer({ min: 0, max: 100_000 }),
        (state, stage, seed) => {
          const cycle = makeCycle(state, stage, seed);
          assertExclusiveAndCoherent(cycle);
        },
      ),
      { numRuns: RUNS },
    );
  });

  it('para toda sequência válida de transições, cada ciclo alcançado mantém a exclusividade', () => {
    // Transições válidas do ciclo de vida: aberto -> publicado -> arquivado.
    // O gerador produz uma sequência arbitrária de avanços a partir de "open";
    // cada passo avança no máximo uma posição no ciclo de vida (ou permanece).
    const lifecycle: readonly CycleState[] = ['open', 'published', 'archived'];

    fc.assert(
      fc.property(
        fc.array(fc.boolean(), { minLength: 0, maxLength: 8 }),
        fc.constantFrom(...STAGES),
        fc.integer({ min: 0, max: 100_000 }),
        (advances, stage, seed) => {
          let lifeIndex = 0; // começa em "open"
          let current = makeCycle(lifecycle[lifeIndex] as CycleState, stage, seed);

          // Estado inicial é exclusivo e coerente.
          assertExclusiveAndCoherent(current);

          for (const doAdvance of advances) {
            if (doAdvance && lifeIndex < lifecycle.length - 1) {
              lifeIndex += 1;
            }
            const nextState = lifecycle[lifeIndex] as CycleState;
            // Nova "versão" do ciclo após a transição (função pura: novo objeto).
            current = { ...current, state: nextState, updatedAt: NOW };

            // Cada estado alcançado por qualquer sequência permanece exclusivo
            // e coerente com a definição do Requisito 2.8.
            assertExclusiveAndCoherent(current);
          }
        },
      ),
      { numRuns: RUNS },
    );
  });
});
