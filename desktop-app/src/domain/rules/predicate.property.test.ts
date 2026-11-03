// Feature: gestao-leiga-de-escalas, Task 5.1: DSL declarativa limitada e seguranca da avaliacao
//
// Este teste de propriedade apoia a tarefa 5.1 (DSL declarativa limitada):
// a DSL nao executa codigo arbitrario e sua avaliacao e TOTAL e DETERMINISTICA.
// Nao e uma das propriedades numeradas (22/23/24); cobre a invariante de
// seguranca/robustez exigida pela "Validacao objetiva" da tarefa:
//
//   Para todo predicado gerado a partir das operacoes conhecidas e todo
//   contexto arbitrario, a avaliacao:
//     (a) termina sem lancar (totalidade — nenhuma entrada quebra a avaliacao);
//     (b) retorna sempre o MESMO booleano para as mesmas entradas (determinismo);
//     (c) todo predicado gerado e aceito por validatePredicate (fechamento da DSL).
//
// Estrategia: geradores inteligentes constroem apenas predicados estruturalmente
// validos (apenas operacoes conhecidas, aridade correta, termos/caminhos bem
// formados) e contextos arbitrarios (inclusive campos ausentes e tipos mistos),
// de modo que o shrinking preserve as pre-condicoes.

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  contextFromMap,
  evaluatePredicate,
  isValidPredicate,
  type RulePredicate,
  type Scalar,
} from './predicate';

const RUNS = 300;

const KNOWN_PATHS = ['a.x', 'a.y', 'b.flag', 'b.n', 'list'] as const;

const scalarArb: fc.Arbitrary<Scalar> = fc.oneof(
  fc.string({ maxLength: 8 }),
  fc.integer({ min: -50, max: 50 }),
  fc.boolean(),
);

const pathArb: fc.Arbitrary<string> = fc.constantFrom(...KNOWN_PATHS);

/** Termo: escalar cru, literal embrulhado ou referencia de campo. */
const termArb: fc.Arbitrary<unknown> = fc.oneof(
  scalarArb,
  scalarArb.map((v) => ({ op: 'lit', args: [v] })),
  pathArb.map((p) => ({ op: 'field', args: [p] })),
);

/** Gera um predicado booleano estruturalmente valido ate uma profundidade. */
function predicateArb(depth: number): fc.Arbitrary<RulePredicate> {
  const leaves: fc.Arbitrary<RulePredicate>[] = [
    fc.constant<RulePredicate>({ op: 'true' }),
    fc.constant<RulePredicate>({ op: 'false' }),
    fc.tuple(termArb, termArb).map(([a, b]) => ({ op: 'eq', args: [a, b] })),
    fc.tuple(termArb, termArb).map(([a, b]) => ({ op: 'ne', args: [a, b] })),
    fc.tuple(termArb, termArb).map(([a, b]) => ({ op: 'lt', args: [a, b] })),
    fc.tuple(termArb, termArb).map(([a, b]) => ({ op: 'ge', args: [a, b] })),
    fc
      .tuple(termArb, fc.array(scalarArb, { maxLength: 4 }))
      .map(([a, set]) => ({ op: 'in', args: [a, set] })),
    fc.tuple(pathArb, termArb).map(([p, t]) => ({ op: 'includes', args: [p, t] })),
    pathArb.map((p) => ({ op: 'has', args: [p] })),
  ];
  if (depth <= 0) return fc.oneof(...leaves);
  const sub = predicateArb(depth - 1);
  return fc.oneof(
    ...leaves,
    fc.array(sub, { maxLength: 3 }).map((args) => ({ op: 'and', args })),
    fc.array(sub, { maxLength: 3 }).map((args) => ({ op: 'or', args })),
    sub.map((p) => ({ op: 'not', args: [p] })),
  );
}

/** Contexto arbitrario: alguns caminhos conhecidos presentes, outros ausentes. */
const contextArb = fc
  .record({
    'a.x': fc.option(scalarArb, { nil: undefined }),
    'a.y': fc.option(scalarArb, { nil: undefined }),
    'b.flag': fc.option(fc.boolean(), { nil: undefined }),
    'b.n': fc.option(fc.integer({ min: -50, max: 50 }), { nil: undefined }),
    list: fc.option(fc.array(scalarArb, { maxLength: 5 }), { nil: undefined }),
  })
  .map((raw) => {
    const map: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(raw)) if (v !== undefined) map[k] = v;
    return map;
  });

describe('Task 5.1: DSL limitada — avaliacao total e deterministica', () => {
  it('todo predicado gerado e valido; a avaliacao nao lanca e e deterministica', () => {
    fc.assert(
      fc.property(predicateArb(3), contextArb, (predicate, map) => {
        // (c) Fechamento da DSL: tudo que geramos e aceito pela validacao.
        expect(isValidPredicate(predicate)).toBe(true);

        const ctx = contextFromMap(map);

        // (a) Totalidade: nunca lanca.
        let first: boolean;
        expect(() => {
          first = evaluatePredicate(predicate, ctx);
        }).not.toThrow();

        // (b) Determinismo: o mesmo predicado e contexto dao o mesmo resultado.
        const second = evaluatePredicate(predicate, contextFromMap(map));
        expect(second).toBe(first!);
        expect(typeof second).toBe('boolean');
      }),
      { numRuns: RUNS },
    );
  });
});
