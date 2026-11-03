// Feature: gestao-leiga-de-escalas, Property 17: Ignorar sugestão é identidade
//
// Teste baseado em propriedade (fast-check) da tarefa 6.4.
//
// Property 17 (design.md): "Para todo Rascunho, cadastro e sugestão, ignorar a
// sugestão preserva exatamente os hashes do Rascunho e Cadastro_Central."
//
// Validates: Requirements 5.6
//
// O helper `ignoreSuggestion(draft)` do modulo de elegibilidade e a IDENTIDADE:
// deve devolver exatamente o rascunho recebido, sem qualquer alteracao, e sem
// mutar o cadastro (que este modulo nunca toca). Esta propriedade verifica, em
// >= 100 execucoes com Rascunhos e cadastros arbitrarios, que:
//
//   1. o hash canonico do Rascunho e preservado byte a byte apos ignorar;
//   2. o hash canonico do Cadastro_Central e preservado byte a byte;
//   3. nenhuma mutacao estrutural ocorre (snapshot profundo inalterado);
//   4. a referencia do rascunho e preservada (identidade estrita), o que e a
//      garantia mais forte possivel de "nao alteracao".
//
// Em caso de falha, o seed e o replayPath do fast-check sao exibidos para
// reproducao deterministica.

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { ignoreSuggestion } from './eligibility';
import { canonicalBytes, canonicalHash, toHex } from '../schemas/canonical';
import { SCHEMA_VERSION } from '../schemas/models';
import type { Assignment, ScheduleDraft } from '../schemas/models';

const NUM_RUNS = 200;

// --------------------------------------------------------------------------
// Geradores inteligentes (constrangidos ao espaco de entrada real)
// --------------------------------------------------------------------------

/** Identificadores estaveis e nao vazios (ids, nomes, datas, revisoes). */
const idArb = fc.string({ minLength: 1, maxLength: 12 });

/** Revisao estilo SHA-256 (hex de 64 chars) — forma usada pelo dominio. */
const hexDigit = fc.constantFrom(...'0123456789abcdef'.split(''));
const revisionArb = fc
  .array(hexDigit, { minLength: 64, maxLength: 64 })
  .map((chars) => chars.join(''));

/**
 * Instante UTC ISO plausivel.
 *
 * Gerado a partir de um offset inteiro de milissegundos sobre uma epoca fixa,
 * em vez de `fc.date(...).toISOString()`. Essa abordagem nunca produz uma Date
 * invalida (evitando o "RangeError: Invalid time value" intermitente que
 * tornava o teste flaky) e sempre resulta em uma string RFC3339 UTC valida.
 */
const EPOCH_MIN_MS = Date.UTC(2020, 0, 1, 0, 0, 0); // 2020-01-01T00:00:00Z
const EPOCH_MAX_MS = Date.UTC(2030, 11, 31, 23, 59, 59); // 2030-12-31T23:59:59Z
const utcArb = fc
  .integer({ min: EPOCH_MIN_MS, max: EPOCH_MAX_MS })
  .map((ms) => new Date(ms).toISOString());

/** Sujeito de uma atribuicao: pessoa ou departamento. */
const subjectArb = fc.record({
  type: fc.constantFrom('person' as const, 'department' as const),
  id: idArb,
});

/** Uma atribuicao do rascunho (inclui campos opcionais em parte dos casos). */
const assignmentArb: fc.Arbitrary<Assignment> = fc.record(
  {
    id: idArb,
    serviceId: idArb,
    roleId: idArb,
    subject: subjectArb,
    source: fc.constantFrom('manual' as const, 'suggested' as const, 'imported' as const),
    slot: fc.option(idArb, { nil: undefined }),
    preferenceOverrideReason: fc.option(fc.string({ maxLength: 40 }), { nil: undefined }),
  },
  { requiredKeys: ['id', 'serviceId', 'roleId', 'subject', 'source'] },
) as fc.Arbitrary<Assignment>;

/** Campos publicos de um culto (colecao arbitraria, forma livre controlada). */
const publicFieldsArb = fc.array(
  fc.record({
    serviceId: idArb,
    fields: fc.dictionary(idArb, fc.string({ maxLength: 30 }), { maxKeys: 4 }),
  }),
  { maxLength: 4 },
) as unknown as fc.Arbitrary<ScheduleDraft['publicFields']>;

/** Notas privadas (colecao arbitraria). */
const privateNotesArb = fc.array(
  fc.record({ id: idArb, text: fc.string({ maxLength: 40 }), classification: idArb }),
  { maxLength: 4 },
) as unknown as fc.Arbitrary<ScheduleDraft['privateNotes']>;

/** Rascunho arbitrario, semanticamente plausivel. */
const draftArb: fc.Arbitrary<ScheduleDraft> = fc.record(
  {
    schemaVersion: fc.constant(SCHEMA_VERSION),
    cycleId: idArb,
    revision: revisionArb,
    parentRevision: fc.option(revisionArb, { nil: undefined }),
    assignments: fc.array(assignmentArb, { maxLength: 8 }),
    publicFields: publicFieldsArb,
    privateNotes: privateNotesArb,
    createdAt: utcArb,
  },
  { requiredKeys: ['schemaVersion', 'cycleId', 'revision', 'assignments', 'publicFields', 'privateNotes', 'createdAt'] },
) as fc.Arbitrary<ScheduleDraft>;

/**
 * Cadastro_Central arbitrario (snapshot livre, apenas para hashear): o modulo
 * de elegibilidade nunca muta o cadastro ao ignorar a sugestao, logo seu hash
 * deve permanecer identico. Usamos uma estrutura generica de pessoas e
 * departamentos para exercitar a propriedade sobre cadastros variados.
 */
const registryArb = fc.record({
  people: fc.array(
    fc.record({
      id: idArb,
      canonicalName: fc.string({ minLength: 1, maxLength: 20 }),
      capabilityIds: fc.array(idArb, { maxLength: 4 }),
    }),
    { maxLength: 6 },
  ),
  departments: fc.array(
    fc.record({ id: idArb, canonicalName: fc.string({ minLength: 1, maxLength: 20 }) }),
    { maxLength: 4 },
  ),
});

// --------------------------------------------------------------------------
// Propriedade 17
// --------------------------------------------------------------------------

describe('Property 17: Ignorar sugestão é identidade (Requisito 5.6)', () => {
  it('preserva exatamente os hashes do Rascunho e do Cadastro_Central ao ignorar a sugestão', () => {
    fc.assert(
      fc.property(draftArb, registryArb, (draft, registry) => {
        // Hashes canonicos ANTES de ignorar.
        const draftHashBefore = canonicalHash(draft);
        const registryHashBefore = canonicalHash(registry);
        // Bytes canonicos completos (comparacao byte a byte, nao so hash).
        const draftBytesBefore = toHex(canonicalBytes(draft));
        const registryBytesBefore = toHex(canonicalBytes(registry));

        // Ignorar a sugestao e a IDENTIDADE sobre o rascunho.
        const result = ignoreSuggestion(draft);

        // (4) Identidade estrita de referencia: nenhuma copia, nenhuma mutacao.
        expect(result).toBe(draft);

        // (1) Hash do Rascunho preservado byte a byte.
        expect(canonicalHash(result)).toBe(draftHashBefore);
        expect(toHex(canonicalBytes(result))).toBe(draftBytesBefore);

        // (2) Hash do Cadastro_Central preservado byte a byte (nunca tocado).
        expect(canonicalHash(registry)).toBe(registryHashBefore);
        expect(toHex(canonicalBytes(registry))).toBe(registryBytesBefore);

        // (3) Nenhuma mutacao estrutural observavel no rascunho de saida.
        expect(toHex(canonicalBytes(result))).toBe(draftBytesBefore);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
