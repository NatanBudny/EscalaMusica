// Feature: gestao-leiga-de-escalas, Property 1: Ordem e pendências do ciclo são derivadas do estado
//
// Property 1 (design.md): Para todo Ciclo_Mensal válido, as etapas apresentadas
// estão na ordem abertura, coleta, montagem, validação, aprovação, publicação e
// fechamento, e o conjunto de pendências bloqueantes é exatamente o conjunto de
// pré-condições não atendidas da etapa atual.
//
// Validates: Requirements 1.4, 1.5, 1.6
//
// Estratégia: geradores inteligentes constroem um Ciclo_Mensal válido com uma
// etapa atual qualquer das sete e um conjunto arbitrário de fatos observáveis
// (StageFacts). O teste verifica que:
//   - a ordem apresentada é sempre a ordem fixa (Req 1.4), independentemente do
//     estado;
//   - o conjunto de pendências bloqueantes materializado é uma função pura e
//     determinística do par (etapa atual, fatos) — derivado do estado (Req 1.5);
//   - esse conjunto coincide exatamente com as pré-condições não atendidas da
//     etapa atual, calculadas por um oráculo independente (Req 1.5);
//   - `canAdvance`/`nextStage` são coerentes com as pendências e com a posição
//     na ordem fixa.

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { pendingForStage, stageIndex, wizardView, type StageFacts } from './cycleService';
import { SCHEMA_VERSION } from '../schemas/models';
import type { CycleStage, MonthlyCycle, Uuid } from '../schemas/models';

// No mínimo 100 execuções (Notas do tasks.md) e seed/replayPath visíveis em falha.
const RUNS = 200;

// Ordem fixa esperada, declarada de forma independente do código sob teste
// para que a propriedade realmente fixe o contrato da ordem (Req 1.4).
const EXPECTED_ORDER: readonly CycleStage[] = [
  'opening',
  'collection',
  'assembly',
  'validation',
  'approval',
  'publication',
  'closing',
];

// --------------------------------------------------------------------------
// Oráculo independente das pré-condições não atendidas de cada etapa.
//
// Deriva diretamente do critério 1.5 e do mapeamento etapa -> pré-condições
// descrito no domínio. É escrito de forma independente de `pendingForStage`
// para que a propriedade compare duas derivações distintas do mesmo estado.
// Retorna o conjunto de identificadores estáveis esperados.
// --------------------------------------------------------------------------
function expectedPendingIds(stage: CycleStage, f: StageFacts): Set<string> {
  const ids = new Set<string>();
  switch (stage) {
    case 'opening':
      if (!f.hasActiveService) ids.add('opening.no-active-service');
      break;
    case 'collection':
      if (!f.collectionComplete) ids.add('collection.incomplete');
      break;
    case 'assembly':
      if (!f.assemblyComplete) ids.add('assembly.incomplete');
      break;
    case 'validation':
      if (!f.validationCleared) ids.add('validation.has-blocking');
      break;
    case 'approval':
      if (!f.validationCleared) ids.add('approval.needs-validation');
      if (!f.approvalValid) ids.add('approval.missing');
      break;
    case 'publication':
      if (!f.approvalValid) ids.add('publication.needs-approval');
      if (!f.publicationConfirmed) ids.add('publication.unconfirmed');
      break;
    case 'closing':
      if (!f.publicationConfirmed) ids.add('closing.needs-publication');
      break;
  }
  return ids;
}

// --------------------------------------------------------------------------
// Geradores inteligentes restritos ao espaço de entrada válido.
// --------------------------------------------------------------------------

const uuidArb: fc.Arbitrary<Uuid> = fc
  .integer({ min: 0, max: 0xffffffff })
  .map((n) => `00000000-0000-4000-8000-${(n >>> 0).toString(16).padStart(12, '0')}` as Uuid);

const stageArb: fc.Arbitrary<CycleStage> = fc.constantFrom(...EXPECTED_ORDER);

const factsArb: fc.Arbitrary<StageFacts> = fc.record({
  hasActiveService: fc.boolean(),
  collectionComplete: fc.boolean(),
  assemblyComplete: fc.boolean(),
  validationCleared: fc.boolean(),
  approvalValid: fc.boolean(),
  publicationConfirmed: fc.boolean(),
});

// Instante UTC válido. Gerado a partir de um offset em milissegundos sobre uma
// época fixa para evitar datas inválidas; o valor é irrelevante para a ordem e
// as pendências (serve apenas para compor um Ciclo_Mensal bem formado).
const EPOCH_MS = Date.UTC(2000, 0, 1);
const isoInstantArb: fc.Arbitrary<string> = fc
  .integer({ min: 0, max: 3_155_760_000_000 }) // ~100 anos em ms
  .map((offset) => new Date(EPOCH_MS + offset).toISOString());

// Um Ciclo_Mensal válido com etapa atual arbitrária. Os demais campos usam
// valores válidos porém irrelevantes para a ordem/pendências derivadas.
const cycleArb: fc.Arbitrary<MonthlyCycle> = fc
  .record({
    stage: stageArb,
    state: fc.constantFrom('open', 'published', 'archived') as fc.Arbitrary<
      MonthlyCycle['state']
    >,
    id: uuidArb,
    ruleSetVersionId: uuidArb,
    year: fc.integer({ min: 1, max: 9999 }),
    month: fc.integer({ min: 1, max: 12 }),
    now: isoInstantArb,
  })
  .map(
    (r): MonthlyCycle => ({
      schemaVersion: SCHEMA_VERSION,
      id: r.id,
      period: `${String(r.year).padStart(4, '0')}-${String(r.month).padStart(2, '0')}`,
      state: r.state,
      stage: r.stage,
      ruleSetVersionId: r.ruleSetVersionId,
      currentDraftRevision: 'a'.repeat(64),
      serviceIds: [],
      stageCompletions: [],
      createdAt: r.now,
      updatedAt: r.now,
    }),
  );

describe('Property 1: Ordem e pendências do ciclo são derivadas do estado (1.4, 1.5, 1.6)', () => {
  it('apresenta sempre a ordem fixa e pendências iguais às pré-condições não atendidas', () => {
    fc.assert(
      fc.property(cycleArb, factsArb, (cycle, facts) => {
        const view = wizardView(cycle, facts);

        // Req 1.4: a ordem apresentada é sempre a ordem fixa das sete etapas,
        // independentemente do estado (etapa atual, estado do ciclo, etc.).
        expect(view.stages).toEqual(EXPECTED_ORDER);
        expect(view.stages.length).toBe(7);

        // A etapa atual exposta coincide com a do ciclo.
        expect(view.currentStage).toBe(cycle.stage);

        // Req 1.5: o conjunto de pendências é derivado puramente do estado.
        // Comparação por conjunto de IDs com o oráculo independente.
        const oracle = expectedPendingIds(cycle.stage, facts);
        const actualIds = new Set(view.pending.map((p) => p.id));
        expect(actualIds).toEqual(oracle);

        // Cada pendência traz ação e motivo não vazios (Req 1.5: ação não
        // concluída e motivo que impede o avanço).
        for (const p of view.pending) {
          expect(p.action.length).toBeGreaterThan(0);
          expect(p.reason.length).toBeGreaterThan(0);
        }

        // IDs de pendência são únicos dentro da etapa.
        expect(view.pending.length).toBe(actualIds.size);

        // canAdvance é verdadeiro se e somente se não há pendências.
        expect(view.canAdvance).toBe(view.pending.length === 0);

        // nextStage deriva da posição na ordem fixa: null apenas no fechamento.
        const idx = stageIndex(cycle.stage);
        const expectedNext =
          idx >= 0 && idx < EXPECTED_ORDER.length - 1 ? EXPECTED_ORDER[idx + 1] : null;
        expect(view.nextStage).toBe(expectedNext ?? null);
      }),
      { numRuns: RUNS },
    );
  });

  it('pendências são uma função pura e determinística do estado (chamadas repetidas coincidem)', () => {
    fc.assert(
      fc.property(stageArb, factsArb, (stage, facts) => {
        const a = pendingForStage(stage, facts);
        const b = pendingForStage(stage, facts);
        // Determinismo: mesma entrada -> mesma saída estrutural.
        expect(a).toEqual(b);
        // Pureza observável: coincide com o oráculo independente.
        const oracle = expectedPendingIds(stage, facts);
        expect(new Set(a.map((p) => p.id))).toEqual(oracle);
      }),
      { numRuns: RUNS },
    );
  });

  it('quando todas as pré-condições da etapa estão satisfeitas, não há pendências', () => {
    const allTrue: StageFacts = {
      hasActiveService: true,
      collectionComplete: true,
      assemblyComplete: true,
      validationCleared: true,
      approvalValid: true,
      publicationConfirmed: true,
    };
    fc.assert(
      fc.property(stageArb, (stage) => {
        expect(pendingForStage(stage, allTrue)).toEqual([]);
      }),
      { numRuns: RUNS },
    );
  });
});
