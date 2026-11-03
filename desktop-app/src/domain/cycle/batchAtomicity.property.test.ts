// Feature: gestao-leiga-de-escalas, Property 15: Lotes inválidos são atômicos
//
// Property 15 (design.md): Para todo arquivo suportado, se qualquer registro ou
// campo falhar no schema documentado, a importação completa preserva o estado
// anterior e relata, para cada erro, arquivo, posição, campo e motivo.
//
// Validates: Requirements 9.5, 9.6, 9.7
//
// Semântica verificada por esta propriedade, para TODO lote gerado (com registros
// válidos e/ou inválidos) e TODO estado de cadastro prévio:
//   (A) Atomicidade por validade do lote (9.5/9.6): `runImportPipeline` rejeita o
//       lote inteiro (`applied === false`) se e somente se ao menos um registro
//       falha na validação documentada. Caso contrário, o lote é aplicado
//       (`applied === true`).
//   (B) Nada aplicado em rejeição (9.6): quando rejeitado, nenhum item é
//       produzido, os totais somam exatamente o total lido em todas as
//       categorias zeradas (imported/transformed/rejected/pending = 0), e nenhum
//       efeito é observável sobre o estado anterior.
//   (C) Preservação do estado anterior (9.6): `runImportPipeline` é puro. O lote
//       de entrada, o cadastro de sujeitos e qualquer estado externo passado
//       permanecem idênticos (por hash estrutural) após a chamada, tanto em
//       rejeição quanto em aplicação.
//   (D) Relato completo por erro (9.7): para cada registro inválido, existe ao
//       menos um erro que informa sourceFile (arquivo), position (posição),
//       field (campo) e reason (motivo não vazio). O sourceFile de todo erro é o
//       do lote; a position de todo erro corresponde a um registro inválido; e
//       todo registro inválido contribui com pelo menos um erro.
//
// Estratégia dos geradores: um gerador inteligente constrói registros VÁLIDOS
// (name + position não vazios) e, com probabilidade controlada, injeta UMA
// violação conhecida por campo (name em branco/ausente, position em branco) e/ou
// usa um validador de formato customizado que exige um campo adicional de
// payload. O oráculo de validade é computado de forma independente do pipeline a
// partir do mesmo validador, e comparado com a decisão de `runImportPipeline`.
// Testes de propriedade não fazem I/O (funções puras do domínio).

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  defaultRecordValidator,
  runImportPipeline,
  type ImportBatch,
  type ImportRecord,
  type RecordValidator,
} from './importPipeline';
import type { IdentitySubject } from '../registry/identity';

// No mínimo 100 execuções (Notas do tasks.md); seed/replayPath visíveis em falha.
const RUNS = 300;

// --------------------------------------------------------------------------
// Cadastro de sujeitos (namespace de identidade) usado nas aplicações válidas.
// Alguns registros válidos casam por identidade exata, outros ficam pendentes;
// isso é irrelevante para a atomicidade, mas exercita o caminho de aplicação.
// --------------------------------------------------------------------------

const SUBJECTS: readonly IdentitySubject[] = [
  { id: 'p-andre', kind: 'person', canonicalName: 'André', aliases: ['Andre Silva'] },
  { id: 'p-dani', kind: 'person', canonicalName: 'Dani', aliases: [] },
  { id: 'd-louvor', kind: 'department', canonicalName: 'Louvor', aliases: [] },
];

// --------------------------------------------------------------------------
// Serialização estrutural estável para comparar estados (preservação / pureza).
// --------------------------------------------------------------------------

function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(v as Record<string, unknown>).sort()) {
        sorted[k] = (v as Record<string, unknown>)[k];
      }
      return sorted;
    }
    return v;
  });
}

// --------------------------------------------------------------------------
// Geradores inteligentes de registros e lotes.
// --------------------------------------------------------------------------

/** Posição não vazia e identificável. */
const validPositionArb = fc.string({ minLength: 1, maxLength: 6 }).map((s) => `linha ${s}`);
/** Nome não vazio (contém ao menos um caractere não-espaço). */
const validNameArb = fc.constantFrom('André', 'Andre Silva', 'Dani', 'Louvor', 'Fulano', 'Ciclano');

/** Valor em branco: vazio ou só espaços (viola a validação do campo). */
const blankArb = fc.constantFrom('', '   ', '\t', '\n  ');

/**
 * Gera um registro VÁLIDO ou com exatamente uma violação conhecida em um campo
 * (name ou position). Retorna também se o registro é válido segundo o validador
 * PADRÃO (name e position não vazios), para servir de referência local.
 */
const recordArb: fc.Arbitrary<ImportRecord> = fc.oneof(
  // Registro totalmente válido.
  { weight: 3, arbitrary: fc.record({ position: validPositionArb, name: validNameArb }) },
  // Violação: name em branco.
  { weight: 1, arbitrary: fc.record({ position: validPositionArb, name: blankArb }) },
  // Violação: position em branco.
  { weight: 1, arbitrary: fc.record({ position: blankArb, name: validNameArb }) },
  // Violação: ambos em branco.
  { weight: 1, arbitrary: fc.record({ position: blankArb, name: blankArb }) },
);

const sourceFileArb = fc.constantFrom('lote.json', 'externos.json', 'indisponibilidade-2026-02.json');

const batchArb: fc.Arbitrary<ImportBatch> = fc.record({
  sourceFile: sourceFileArb,
  records: fc.array(recordArb, { maxLength: 12 }),
});

// --------------------------------------------------------------------------
// Validador de formato opcional (exige payload.date), usado para exercitar a
// atomicidade de "qualquer campo" além dos campos mínimos (9.5/9.6).
// --------------------------------------------------------------------------

const strictDateValidator: RecordValidator = (record) => {
  const base = defaultRecordValidator(record);
  const date = (record.payload as { date?: unknown } | undefined)?.date;
  if (typeof date !== 'string' || date.trim().length === 0) {
    return [...base, { field: 'date', reason: 'data obrigatoria ausente ou vazia' }];
  }
  return base;
};

// --------------------------------------------------------------------------
// Propriedade
// --------------------------------------------------------------------------

describe('Property 15: Lotes inválidos são atômicos (9.5-9.7)', () => {
  it('rejeita o lote inteiro sse houver registro inválido; preserva estado; relata cada erro', () => {
    fc.assert(
      fc.property(batchArb, fc.boolean(), (batch, useStrict) => {
        const validate: RecordValidator = useStrict ? strictDateValidator : defaultRecordValidator;

        // Oráculo independente: erros por registro conforme o MESMO validador.
        const invalidPositions = batch.records
          .map((r, i) => ({ r, i }))
          .filter(({ r }) => validate(r).length > 0);
        const expectRejected = invalidPositions.length > 0;

        // Snapshots do estado anterior para checar preservação/pureza (C).
        const batchBefore = stableStringify(batch);
        const subjectsBefore = stableStringify(SUBJECTS);

        const result = runImportPipeline(batch, SUBJECTS, { validateRecord: validate });

        // (A) Atomicidade: rejeitado sse há ao menos um registro inválido.
        expect(result.applied).toBe(!expectRejected);

        // (C) Preservação do estado anterior: entrada e cadastro inalterados.
        expect(stableStringify(batch)).toBe(batchBefore);
        expect(stableStringify(SUBJECTS)).toBe(subjectsBefore);

        if (!result.applied) {
          // (B) Nada aplicado: totais somam o lido, tudo zerado.
          expect(result.totals).toEqual({
            read: batch.records.length,
            imported: 0,
            transformed: 0,
            rejected: 0,
            pending: 0,
          });
          expect(result.sourceFile).toBe(batch.sourceFile);

          // (D) Relato completo por erro: arquivo, posição, campo e motivo.
          expect(result.errors.length).toBeGreaterThan(0);
          for (const err of result.errors) {
            expect(err.sourceFile).toBe(batch.sourceFile);
            expect(typeof err.field).toBe('string');
            expect(err.field.length).toBeGreaterThan(0);
            expect(typeof err.reason).toBe('string');
            expect(err.reason.trim().length).toBeGreaterThan(0);
            // Todo erro aponta para a posição de um registro inválido.
            const owner = batch.records.find(
              (r) => r.position === err.position && validate(r).length > 0,
            );
            expect(owner).toBeDefined();
          }

          // Cada registro inválido contribui com ao menos um erro relatado.
          for (const { r } of invalidPositions) {
            const relatedField = (fieldErrors: ReturnType<RecordValidator>) =>
              fieldErrors.some((fe) =>
                result.errors.some((e) => e.position === r.position && e.field === fe.field),
              );
            expect(relatedField(validate(r))).toBe(true);
          }
        } else {
          // Lote válido aplicado: um item por registro e total lido coerente.
          expect(result.items).toHaveLength(batch.records.length);
          expect(result.totals.read).toBe(batch.records.length);
        }
      }),
      { numRuns: RUNS },
    );
  });

  it('um único registro inválido no meio de um lote válido rejeita tudo (9.6)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ position: validPositionArb, name: validNameArb }), {
          minLength: 1,
          maxLength: 8,
        }),
        fc.nat(),
        (validRecords, rawIndex) => {
          const at = rawIndex % (validRecords.length + 1);
          const corrupted: ImportRecord = { position: `linha ${at}`, name: '   ' };
          const records = [...validRecords.slice(0, at), corrupted, ...validRecords.slice(at)];
          const batch: ImportBatch = { sourceFile: 'misto.json', records };

          const result = runImportPipeline(batch, SUBJECTS);

          expect(result.applied).toBe(false);
          if (!result.applied) {
            // Nenhuma gravação: tudo zerado, tudo lido contabilizado.
            expect(result.totals).toEqual({
              read: records.length,
              imported: 0,
              transformed: 0,
              rejected: 0,
              pending: 0,
            });
            // O erro aponta o registro corrompido no campo name.
            expect(
              result.errors.some((e) => e.position === corrupted.position && e.field === 'name'),
            ).toBe(true);
          }
        },
      ),
      { numRuns: RUNS },
    );
  });

  it('lote totalmente válido é aplicado e produz exatamente um item por registro', () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ position: validPositionArb, name: validNameArb }), { maxLength: 10 }),
        (records) => {
          const batch: ImportBatch = { sourceFile: 'validos.json', records };
          const result = runImportPipeline(batch, SUBJECTS);

          expect(result.applied).toBe(true);
          if (result.applied) {
            expect(result.items).toHaveLength(records.length);
            const t = result.totals;
            expect(t.read).toBe(records.length);
            // Partição completa: a soma das categorias é igual ao total lido.
            expect(t.imported + t.transformed + t.rejected + t.pending).toBe(t.read);
            expect(t.rejected).toBe(0); // rejeição é sempre de lote inteiro.
          }
        },
      ),
      { numRuns: RUNS },
    );
  });
});
