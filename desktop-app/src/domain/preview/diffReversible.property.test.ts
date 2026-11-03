// Feature: gestao-leiga-de-escalas, Property 32: Diff da prévia é completo e reversível
//
// Property 32 (design.md, secao "Correctness Properties"):
// "Para toda escala vigente e candidata, o diff identifica exatamente cada
//  inclusão, remoção e alteração por culto/campo; aplicar o diff à vigente
//  produz a candidata e aplicar o diff inverso produz a vigente."
// Valida: Requisitos 8.2, 8.4, 14.6, 16.9.
//
// Estrategia: geramos projecoes publicas (`PublicProjectionDTO`) arbitrarias
// para a vigente (`current`) e a candidata (`candidate`) sobre um POOL comum de
// identificadores de culto e de nomes/valores de campo, de modo que inclusoes,
// remocoes e alteracoes ocorram organicamente. Sobre esses pares verificamos:
//
//   1. Completude: o conjunto de (culto, campo) alterados pelo diff e EXATAMENTE
//      o conjunto calculado por um oraculo independente (comparacao direta dos
//      mapas achatados `toFieldState`), com a classificacao added/removed/changed
//      correta por campo.
//   2. Reversibilidade: applyDiff(currentState, diff) === candidateState e
//      applyDiff(candidateState, invertDiff(diff)) === currentState.
//   3. Pureza: applyDiff nao muta os estados de entrada.
//   4. Estados iguais produzem diff vazio.
//
// Determinismo: nenhuma data e derivada de `Date`/`toISOString`. As datas sao
// strings ISO validas geradas por aritmetica civil pura, e todos os demais
// campos sao escolhidos de pools finitos e fixos.

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  applyDiff,
  computeDiff,
  invertDiff,
  toFieldState,
  type PublicFieldState,
} from './previewService';
import type { PublicAssignment, PublicProjectionDTO } from '../projection/publicProjection';
import { canonicalStringify } from '../schemas/canonical';
import type { Weekday } from '../schemas/models';

// --------------------------------------------------------------------------
// Pools finitos e geradores deterministicos
// --------------------------------------------------------------------------

// Pool pequeno e compartilhado de serviceIds: forcar colisao/sobreposicao entre
// vigente e candidata para que added/removed/changed apareçam com frequencia.
const SERVICE_IDS = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
] as const;

const ROLE_IDS = [
  'aaaa1111-1111-4111-8111-111111111111',
  'bbbb2222-2222-4222-8222-222222222222',
] as const;

const SLOTS = [undefined, 'A', 'B'] as const;

const FIELD_NAMES = ['TEMA', 'LOUVOR', 'AVISO'] as const;
const FIELD_VALUES = ['alpha', 'beta', 'gamma', 'delta'] as const;

const INPUT_TYPES = ['theme', 'observation', 'song-request'] as const;
const INPUT_VALUES = ['x', 'y', 'z'] as const;

const ASSIGNMENT_NAMES: Array<string | null> = ['Ana', 'Bruno', 'Carla', null];

const WEEKDAYS: readonly Weekday[] = ['wednesday', 'saturday', 'sunday'];
const KINDS = ['regular', 'extraordinary'] as const;

/**
 * Data civil ISO `YYYY-MM-DD` valida gerada por aritmetica pura (sem `Date`).
 * O dia e restringido a [1, 28] para ser valido em qualquer mes, evitando
 * qualquer dependencia de calendario ou de `toISOString`.
 */
const isoDateArb = fc
  .record({
    year: fc.integer({ min: 2024, max: 2030 }),
    month: fc.integer({ min: 1, max: 12 }),
    day: fc.integer({ min: 1, max: 28 }),
  })
  .map(({ year, month, day }) => {
    const yy = String(year).padStart(4, '0');
    const mm = String(month).padStart(2, '0');
    const dd = String(day).padStart(2, '0');
    return `${yy}-${mm}-${dd}`;
  });

/** Mapa de campos publicos do rascunho (nomes nao secretos, pool fixo). */
const publicFieldsArb = fc.dictionary(
  fc.constantFrom(...FIELD_NAMES),
  fc.constantFrom(...FIELD_VALUES),
  { maxKeys: FIELD_NAMES.length },
);

/** Insumos publicos: lista estavel de {type, value}. */
const publicInputsArb = fc.array(
  fc.record({
    type: fc.constantFrom(...INPUT_TYPES),
    value: fc.constantFrom(...INPUT_VALUES),
  }),
  { maxLength: 4 },
);

/**
 * Atribuicoes publicas: {serviceId, roleId, slot?, name?, subjectType}.
 *
 * `slot` e `name` sao OPCIONAIS no `PublicAssignment` (slot?: string, name?:
 * string). Com `exactOptionalPropertyTypes`, atribuir `undefined`/`null` a
 * essas chaves nao e equivalente a OMITI-LAS. Por isso construimos o registro
 * sem a chave quando o valor sorteado for ausente, preservando exatamente a
 * semantica de propriedade opcional do DTO.
 */
const assignmentArb = (serviceId: string): fc.Arbitrary<PublicAssignment> =>
  fc
    .record({
      roleId: fc.constantFrom(...ROLE_IDS),
      slot: fc.constantFrom(...SLOTS),
      name: fc.constantFrom(...ASSIGNMENT_NAMES),
      subjectType: fc.constantFrom<'person' | 'department'>('person', 'department'),
    })
    .map(({ roleId, slot, name, subjectType }): PublicAssignment => {
      const base: PublicAssignment = { serviceId, roleId, subjectType };
      const withSlot = slot === undefined ? base : { ...base, slot };
      return name === null ? withSlot : { ...withSlot, name };
    });

/** Um culto publico arbitrario para um serviceId fixo. */
const serviceDtoArb = (serviceId: string) =>
  fc.record({
    serviceId: fc.constant(serviceId),
    date: isoDateArb,
    weekday: fc.constantFrom(...WEEKDAYS),
    kind: fc.constantFrom(...KINDS),
    publicFields: publicFieldsArb,
    publicInputs: publicInputsArb,
    assignments: fc.array(assignmentArb(serviceId), { maxLength: 3 }),
  });

/**
 * Uma projecao publica arbitraria: um SUBCONJUNTO do pool de serviceIds (para
 * que a vigente e a candidata possam divergir no conjunto de cultos presentes).
 */
const projectionArb = fc
  .subarray([...SERVICE_IDS], { minLength: 0, maxLength: SERVICE_IDS.length })
  .chain((ids) =>
    fc
      .tuple(...ids.map((id) => serviceDtoArb(id)))
      .map(
        (services): PublicProjectionDTO => ({
          period: '2026-02',
          services,
          contacts: [],
        }),
      ),
  );

// --------------------------------------------------------------------------
// Oraculo independente de diff (nao reusa computeDiff)
// --------------------------------------------------------------------------

type ExpectedChange = 'added' | 'removed' | 'changed';

/**
 * Deriva, a partir dos estados achatados, o conjunto esperado de mudancas por
 * chave composta. Independente de `computeDiff`: usa apenas os mapas gerados
 * por `toFieldState` e comparacao canonica por valor.
 */
function oracleChanges(
  currentState: PublicFieldState,
  candidateState: PublicFieldState,
): Map<string, ExpectedChange> {
  const changes = new Map<string, ExpectedChange>();
  const keys = new Set<string>([...currentState.keys(), ...candidateState.keys()]);
  for (const key of keys) {
    const inCurrent = currentState.has(key);
    const inCandidate = candidateState.has(key);
    if (inCurrent && inCandidate) {
      const same =
        canonicalStringify(currentState.get(key)) === canonicalStringify(candidateState.get(key));
      if (!same) changes.set(key, 'changed');
    } else if (inCandidate) {
      changes.set(key, 'added');
    } else {
      changes.set(key, 'removed');
    }
  }
  return changes;
}

/** Serializa um Map de campos de forma estavel para comparacao semantica. */
function stableSerialize(state: PublicFieldState): string {
  const obj: Record<string, unknown> = {};
  for (const k of [...state.keys()].sort()) obj[k] = state.get(k);
  return canonicalStringify(obj);
}

/** Chave composta usada por computeDiff/applyDiff: `serviceId\u0000field`. */
function keyOf(serviceId: string, field: string): string {
  return `${serviceId}\u0000${field}`;
}

const PBT_OPTIONS = { numRuns: 300 } as const;

// --------------------------------------------------------------------------
// Property 32
// --------------------------------------------------------------------------

describe('Property 32: diff da previa e completo e reversivel', () => {
  it('completude: o diff captura exatamente cada inclusao, remocao e alteracao por culto/campo', () => {
    try {
      fc.assert(
        fc.property(projectionArb, projectionArb, (current, candidate) => {
          const currentState = toFieldState(current);
          const candidateState = toFieldState(candidate);

          const diff = computeDiff(current, candidate);
          const expected = oracleChanges(currentState, candidateState);

          // Mesma cardinalidade: nenhuma mudanca a mais, nenhuma a menos.
          expect(diff.length).toBe(expected.size);

          // Cada entrada do diff corresponde EXATAMENTE a uma mudanca esperada,
          // com a classificacao correta e before/after coerentes.
          const seen = new Set<string>();
          for (const entry of diff) {
            const key = keyOf(entry.serviceId, entry.field);
            expect(expected.has(key)).toBe(true);
            expect(entry.change).toBe(expected.get(key));
            expect(seen.has(key)).toBe(false); // sem chave repetida
            seen.add(key);

            if (entry.change === 'added') {
              expect(canonicalStringify(entry.after)).toBe(
                canonicalStringify(candidateState.get(key)),
              );
            } else if (entry.change === 'removed') {
              expect(canonicalStringify(entry.before)).toBe(
                canonicalStringify(currentState.get(key)),
              );
            } else {
              expect(canonicalStringify(entry.before)).toBe(
                canonicalStringify(currentState.get(key)),
              );
              expect(canonicalStringify(entry.after)).toBe(
                canonicalStringify(candidateState.get(key)),
              );
            }
          }

          // Cobertura reversa: toda mudanca esperada aparece no diff.
          expect(seen.size).toBe(expected.size);
        }),
        PBT_OPTIONS,
      );
    } catch (error) {
      // Superficie o seed/replayPath para reproducao deterministica da falha.
      console.error('Property 32 (completude) falhou. Detalhes de replay:', error);
      throw error;
    }
  });

  it('reversibilidade: aplicar o diff a vigente produz a candidata; o inverso produz a vigente', () => {
    try {
      fc.assert(
        fc.property(projectionArb, projectionArb, (current, candidate) => {
          const currentState = toFieldState(current);
          const candidateState = toFieldState(candidate);

          const diff = computeDiff(current, candidate);

          // Snapshots para checar ausencia de mutacao das entradas.
          const currentSnapshot = stableSerialize(currentState);
          const candidateSnapshot = stableSerialize(candidateState);

          // applyDiff(vigente, diff) === candidata.
          const forward = applyDiff(currentState, diff);
          expect(stableSerialize(forward)).toBe(candidateSnapshot);

          // applyDiff(candidata, invertDiff(diff)) === vigente.
          const backward = applyDiff(candidateState, invertDiff(diff));
          expect(stableSerialize(backward)).toBe(currentSnapshot);

          // Pureza: nenhuma das entradas foi mutada por applyDiff.
          expect(stableSerialize(currentState)).toBe(currentSnapshot);
          expect(stableSerialize(candidateState)).toBe(candidateSnapshot);
        }),
        PBT_OPTIONS,
      );
    } catch (error) {
      console.error('Property 32 (reversibilidade) falhou. Detalhes de replay:', error);
      throw error;
    }
  });

  it('estados iguais produzem diff vazio e sao reversiveis trivialmente', () => {
    try {
      fc.assert(
        fc.property(projectionArb, (projection) => {
          const diff = computeDiff(projection, projection);
          expect(diff).toEqual([]);

          const state = toFieldState(projection);
          const snapshot = stableSerialize(state);
          // Aplicar um diff vazio (e seu inverso) preserva o estado.
          expect(stableSerialize(applyDiff(state, diff))).toBe(snapshot);
          expect(stableSerialize(applyDiff(state, invertDiff(diff)))).toBe(snapshot);
        }),
        PBT_OPTIONS,
      );
    } catch (error) {
      console.error('Property 32 (diff vazio) falhou. Detalhes de replay:', error);
      throw error;
    }
  });
});
