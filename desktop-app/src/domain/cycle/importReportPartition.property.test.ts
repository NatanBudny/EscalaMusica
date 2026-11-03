// Feature: gestao-leiga-de-escalas, Property 14: Relatórios de importação formam uma partição completa
//
// Property 14 (design.md): Para todo lote importado, cada item de origem recebe
// exatamente uma classificação permitida com motivo, e a soma dos totais
// importado/aceito, transformado/corrigido, rejeitado e pendente é igual ao
// total lido.
//
// Validates: Requirements 4.14, 9.13, 16.5
//
// Semântica verificada por esta propriedade, para TODO lote gerado (válido,
// inválido ou misto) e TODO cadastro de sujeitos gerado:
//   (A) Soma = lido (9.13): para todo lote APLICADO, imported + transformed +
//       rejected + pending é igual a read (= número de registros do lote). A
//       partição completa é propriedade do relatório aplicado; lotes rejeitados
//       preservam o estado sem classificar (atomicidade, Property 15), portanto
//       não formam partição — verificado separadamente.
//   (B) Exatamente uma classificação por item (4.14): em lote aplicado, há
//       exatamente um item por registro lido, cada item tem uma — e somente
//       uma — classificação dentre {imported, transformed, rejected, pending},
//       e os totais por categoria coincidem com a contagem real de itens
//       naquela categoria.
//   (C) Motivo presente quando pendente (4.14): todo item pendente carrega um
//       `reason` não vazio que justifica a classificação; todo item rejeitado
//       de lote (quando houver) é relatado com arquivo/posição/campo/motivo.
//   (D) Determinismo/reprodutibilidade (16.5): executar o mesmo lote duas vezes
//       produz relatórios idênticos (particão estável entre execuções).
//   (E) O helper canônico `isCompletePartition` concorda com a verificação
//       independente da partição feita aqui — nenhum modelo paralelo.
//
// Estratégia dos geradores: um gerador inteligente constrói um cadastro de
// sujeitos (com nomes, aliases e, deliberadamente, nomes duplicados para
// provocar ambiguidade) e um lote de registros cujos nomes são amostrados para
// cair em TODAS as cardinalidades de correspondência (0 = sem match, 1 = único,
// >1 = ambíguo), além de registros inválidos (nome/posição vazios) que forçam
// rejeição atômica do lote inteiro. Assim a particão é exercida nos quatro
// resultados possíveis. Testes de propriedade não fazem I/O (funções puras).

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  isCompletePartition,
  runImportPipeline,
  type ImportBatch,
  type ImportRecord,
  type ImportResult,
} from './importPipeline';
import type { IdentitySubject } from '../registry/identity';

// No mínimo 100 execuções (Notas do tasks.md); seed/replayPath visíveis em falha.
const RUNS = 300;

const CLASSIFICATIONS = ['imported', 'transformed', 'rejected', 'pending'] as const;

// --------------------------------------------------------------------------
// Verificação independente da partição (oráculo), espelhando 4.14 + 9.13 sem
// reusar a lógica interna do pipeline, para servir de contraprova ao helper.
// --------------------------------------------------------------------------

function partitionHoldsIndependently(result: Extract<ImportResult, { applied: true }>): boolean {
  const t = result.totals;

  // (A) Soma dos totais por categoria == total lido.
  if (t.imported + t.transformed + t.rejected + t.pending !== t.read) return false;

  // (B) Um item por registro lido.
  if (result.items.length !== t.read) return false;

  // (B) Contagem real por categoria a partir dos itens.
  const counts: Record<(typeof CLASSIFICATIONS)[number], number> = {
    imported: 0,
    transformed: 0,
    rejected: 0,
    pending: 0,
  };
  for (const { item } of result.items) {
    const c = item.classification;
    if (!CLASSIFICATIONS.includes(c)) return false; // classificação fora do domínio
    counts[c] += 1;
  }

  return (
    counts.imported === t.imported &&
    counts.transformed === t.transformed &&
    counts.rejected === t.rejected &&
    counts.pending === t.pending
  );
}

// --------------------------------------------------------------------------
// Geradores inteligentes
// --------------------------------------------------------------------------

/** Nomes base reutilizados como nomes canônicos e como nomes de registro. */
const UNIQUE_NAMES = ['André', 'Dani', 'Bia', 'Carlos', 'Louvor'] as const;
/** Nome deliberadamente duplicado entre sujeitos distintos (ambiguidade). */
const AMBIGUOUS_NAME = 'Ana';
/** Nomes que nunca correspondem a nenhum sujeito (cardinalidade 0). */
const UNMATCHED_NAMES = ['Fulano', 'Sicrano', 'Beltrano'] as const;

/**
 * Cadastro de sujeitos: um por nome único + dois sujeitos distintos com o mesmo
 * nome ambíguo. Isso garante que registros com `AMBIGUOUS_NAME` resolvam para
 * cardinalidade > 1 (pendente por ambiguidade).
 */
function buildSubjects(): IdentitySubject[] {
  const unique: IdentitySubject[] = UNIQUE_NAMES.map((name, i) => ({
    id: `p-${i}-${name}`,
    kind: i === UNIQUE_NAMES.length - 1 ? 'department' : 'person',
    canonicalName: name,
    aliases: [],
  }));
  const ambiguous: IdentitySubject[] = [
    { id: 'p-ana-1', kind: 'person', canonicalName: AMBIGUOUS_NAME, aliases: [] },
    { id: 'p-ana-2', kind: 'person', canonicalName: AMBIGUOUS_NAME, aliases: [] },
  ];
  return [...unique, ...ambiguous];
}

const SUBJECTS = buildSubjects();

/**
 * Gera um nome de registro que cobre todas as cardinalidades de correspondência
 * e também a variação de caixa/espaços (identidade exata insensível a caixa).
 */
const matchedNameArb: fc.Arbitrary<string> = fc.oneof(
  // Cardinalidade 1: nome único, possivelmente com caixa/espaços variados.
  fc.constantFrom(...UNIQUE_NAMES).chain((n) =>
    fc.constantFrom(n, `  ${n}  `, n.toLowerCase(), n.toUpperCase()),
  ),
  // Cardinalidade > 1: nome ambíguo.
  fc.constantFrom(AMBIGUOUS_NAME, AMBIGUOUS_NAME.toLowerCase()),
  // Cardinalidade 0: nome sem correspondência.
  fc.constantFrom(...UNMATCHED_NAMES),
);

/** Posição de origem não vazia e estável. */
const positionArb = fc.integer({ min: 0, max: 9999 }).map((i) => `linha ${i}`);

const SOURCE_FILES = ['indisponibilidade.json', 'externos.csv', 'lote-2026-02.json'] as const;

/**
 * Registro VÁLIDO (posição e nome não vazios). O nome cobre as três
 * cardinalidades de correspondência (0, 1, >1), exercendo imported/transformed
 * (via predicado) e pending na mesma partição de um lote aplicado.
 */
const validRecordArb: fc.Arbitrary<ImportRecord> = fc.record({
  position: positionArb,
  name: matchedNameArb,
});

/** Lote válido: todos os registros passam na validação objetiva → aplicado. */
const validBatchArb: fc.Arbitrary<ImportBatch> = fc.record({
  sourceFile: fc.constantFrom(...SOURCE_FILES),
  records: fc.array(validRecordArb, { minLength: 0, maxLength: 25 }),
});

/**
 * Lote com AO MENOS UM registro inválido (nome ou posição vazios), garantindo
 * rejeição atômica. Usado para verificar que lote rejeitado preserva o estado
 * sem classificar (atomicidade), e NÃO forma partição completa.
 */
const invalidBatchArb: fc.Arbitrary<ImportBatch> = fc
  .record({
    sourceFile: fc.constantFrom(...SOURCE_FILES),
    valids: fc.array(validRecordArb, { minLength: 0, maxLength: 10 }),
    invalids: fc.array(
      fc.oneof(
        positionArb.map((position) => ({ position, name: '   ' })),
        matchedNameArb.map((name) => ({ position: '', name })),
      ),
      { minLength: 1, maxLength: 5 },
    ),
  })
  .map(({ sourceFile, valids, invalids }) => ({
    sourceFile,
    records: [...valids, ...invalids],
  }));

// --------------------------------------------------------------------------
// Propriedade 14
// --------------------------------------------------------------------------

describe('Property 14: Relatórios de importação formam uma partição completa (4.14, 9.13, 16.5)', () => {
  it('cada item recebe exatamente uma classificação com motivo e os totais somam o lido', () => {
    fc.assert(
      fc.property(validBatchArb, (batch) => {
        const result = runImportPipeline(batch, SUBJECTS);
        const read = batch.records.length;

        // Lote válido é sempre aplicado; a partição completa é propriedade do
        // relatório aplicado (4.14/9.13).
        expect(result.applied).toBe(true);
        if (!result.applied) return;

        // (A) read reflete o número de registros do lote.
        expect(result.totals.read).toBe(read);

        // (A)+(B) Verificação independente da partição concorda com o helper
        // canônico (E) — nenhum modelo paralelo de verdade.
        expect(partitionHoldsIndependently(result)).toBe(true);
        expect(isCompletePartition(result)).toBe(true);

        // (B) Um item por registro lido.
        expect(result.items).toHaveLength(read);

        for (const { item } of result.items) {
          // Exatamente uma classificação dentro do domínio permitido.
          expect(CLASSIFICATIONS).toContain(item.classification);

          // (C) Item pendente sempre justifica com motivo não vazio.
          if (item.classification === 'pending') {
            expect(typeof item.reason).toBe('string');
            expect((item.reason ?? '').trim().length).toBeGreaterThan(0);
          }
        }

        // Nenhum item rejeitado surge no caminho aplicado (rejeição é sempre
        // de lote inteiro) — mantém a partição coerente com o design.
        expect(result.totals.rejected).toBe(0);
      }),
      { numRuns: RUNS },
    );
  });

  it('lote rejeitado preserva o estado sem classificar e não forma partição completa (atomicidade)', () => {
    fc.assert(
      fc.property(invalidBatchArb, (batch) => {
        const result = runImportPipeline(batch, SUBJECTS);
        const read = batch.records.length;

        // Com ao menos um registro inválido, o lote inteiro é rejeitado.
        expect(result.applied).toBe(false);
        if (result.applied) return;

        // (C) Cada erro identifica arquivo/posição/campo/motivo.
        expect(result.errors.length).toBeGreaterThan(0);
        for (const e of result.errors) {
          expect(e.sourceFile).toBe(batch.sourceFile);
          expect(typeof e.position).toBe('string');
          expect(e.field.length).toBeGreaterThan(0);
          expect(e.reason.length).toBeGreaterThan(0);
        }

        // Nada aplicado: todas as categorias zeradas, tudo contabilizado como lido.
        expect(result.totals).toEqual({
          read,
          imported: 0,
          transformed: 0,
          rejected: 0,
          pending: 0,
        });

        // Lote rejeitado NÃO classifica os registros: quando há registros, a
        // soma (0) difere do lido, logo não é partição completa (isso é
        // atomicidade/Property 15, não partição/Property 14).
        if (read > 0) {
          expect(isCompletePartition(result)).toBe(false);
        }
      }),
      { numRuns: RUNS },
    );
  });

  it('a partição é estável entre execuções do mesmo lote (determinismo, 16.5)', () => {
    fc.assert(
      fc.property(validBatchArb, (batch) => {
        const r1 = runImportPipeline(batch, SUBJECTS);
        const r2 = runImportPipeline(batch, SUBJECTS);
        // (D) Relatórios idênticos: totais e classificação por item reproduzíveis.
        expect(r2).toEqual(r1);
        expect(r1.totals).toEqual(r2.totals);
      }),
      { numRuns: RUNS },
    );
  });

  it('classifica como transformed sob predicado e ainda mantém partição completa', () => {
    // needsTransform desloca correspondências únicas de imported -> transformed;
    // a soma imported + transformed + rejected + pending deve seguir == read.
    fc.assert(
      fc.property(validBatchArb, fc.boolean(), (batch, transformAll) => {
        const result = runImportPipeline(batch, SUBJECTS, {
          needsTransform: () => transformAll,
        });
        expect(result.applied).toBe(true);
        if (!result.applied) return;

        expect(isCompletePartition(result)).toBe(true);
        expect(partitionHoldsIndependently(result)).toBe(true);

        if (transformAll) {
          // Quando tudo que casa unicamente é transformado, não sobra imported.
          expect(result.totals.imported).toBe(0);
        }
      }),
      { numRuns: RUNS },
    );
  });
});
