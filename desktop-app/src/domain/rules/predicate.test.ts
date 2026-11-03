// Testes unitarios da DSL declarativa limitada de predicados (design.md ->
// "Data Models", "Limites e seguranca de entrada": a DSL nao executa codigo
// arbitrario; apenas um conjunto fechado de operacoes conhecidas).
//
// Cobrem:
//  - conjunto fechado de operacoes (operacao desconhecida e invalida);
//  - aridade e tipos de argumentos;
//  - referencia a campo desconhecido (allowlist) => predicado invalido;
//  - avaliacao pura e deterministica das operacoes logicas, comparacoes,
//    pertinencia e consulta de campo;
//  - rejeicao estrutural de predicados malformados.

import { describe, expect, it } from 'vitest';

import {
  contextFromMap,
  evaluatePredicate,
  field,
  isValidPredicate,
  lit,
  validatePredicate,
  type RulePredicate,
} from './predicate';

const FIELDS = new Set<string>([
  'service.weekday',
  'assignment.roleId',
  'subject.capabilityIds',
  'team.size',
]);

describe('DSL: validacao do conjunto fechado de operacoes', () => {
  it('aceita operacoes logicas bem formadas', () => {
    const p: RulePredicate = {
      op: 'and',
      args: [{ op: 'true' }, { op: 'not', args: [{ op: 'false' }] }],
    };
    expect(validatePredicate(p)).toEqual([]);
    expect(isValidPredicate(p)).toBe(true);
  });

  it('rejeita operacao desconhecida (sem execucao de codigo arbitrario)', () => {
    const issues = validatePredicate({ op: 'eval', args: ['process.exit(1)'] });
    expect(issues.some((i) => i.code === 'unknown-operator')).toBe(true);
  });

  it('rejeita aridade incorreta', () => {
    expect(validatePredicate({ op: 'not', args: [] }).some((i) => i.code === 'arity')).toBe(true);
    expect(validatePredicate({ op: 'eq', args: [lit(1)] }).some((i) => i.code === 'arity')).toBe(
      true,
    );
    expect(validatePredicate({ op: 'true', args: [lit(1)] }).some((i) => i.code === 'arity')).toBe(
      true,
    );
  });

  it('rejeita predicado malformado (sem op, args nao array, nao objeto)', () => {
    expect(validatePredicate(null).some((i) => i.code === 'malformed')).toBe(true);
    expect(validatePredicate({ args: [] }).some((i) => i.code === 'malformed')).toBe(true);
    expect(validatePredicate({ op: 'and', args: 42 }).some((i) => i.code === 'malformed')).toBe(
      true,
    );
    expect(validatePredicate([1, 2, 3]).some((i) => i.code === 'malformed')).toBe(true);
  });

  it('exige predicado booleano onde um booleano e esperado (nao um termo)', () => {
    // `field` retorna um termo; nao pode estar na raiz (que espera booleano).
    expect(
      validatePredicate(field('service.weekday')).some((i) => i.code === 'expected-predicate'),
    ).toBe(true);
  });

  it('valida referencia a campo contra a allowlist (referencia ausente)', () => {
    const good = { op: 'eq', args: [field('service.weekday'), lit('wednesday')] };
    expect(validatePredicate(good, { knownFields: FIELDS })).toEqual([]);

    const bad = { op: 'eq', args: [field('service.desconhecido'), lit('x')] };
    const issues = validatePredicate(bad, { knownFields: FIELDS });
    expect(issues.some((i) => i.code === 'unknown-field')).toBe(true);
  });

  it('aceita qualquer caminho string quando nao ha allowlist', () => {
    const p = { op: 'has', args: ['qualquer.coisa'] };
    expect(validatePredicate(p)).toEqual([]);
  });

  it('rejeita literal-array nao escalar em `in`', () => {
    const p = { op: 'in', args: [field('service.weekday'), [{ nested: true }]] };
    expect(
      validatePredicate(p, { knownFields: FIELDS }).some(
        (i) => i.code === 'expected-literal-array',
      ),
    ).toBe(true);
  });

  it('rejeita `includes` cujo primeiro argumento nao e um caminho', () => {
    const p = { op: 'includes', args: [lit('x'), lit('y')] };
    expect(validatePredicate(p).some((i) => i.code === 'expected-path')).toBe(true);
  });
});

describe('DSL: avaliacao pura e deterministica', () => {
  const ctx = contextFromMap({
    'service.weekday': 'wednesday',
    'assignment.roleId': 'regente',
    'subject.capabilityIds': ['regente', 'louvor'],
    'team.size': 4,
  });

  it('avalia constantes e logica', () => {
    expect(evaluatePredicate({ op: 'true' }, ctx)).toBe(true);
    expect(evaluatePredicate({ op: 'false' }, ctx)).toBe(false);
    expect(evaluatePredicate({ op: 'and', args: [] }, ctx)).toBe(true); // conjuncao vazia
    expect(evaluatePredicate({ op: 'or', args: [] }, ctx)).toBe(false); // disjuncao vazia
    expect(evaluatePredicate({ op: 'not', args: [{ op: 'false' }] }, ctx)).toBe(true);
  });

  it('avalia comparacoes de igualdade e ordem', () => {
    expect(
      evaluatePredicate({ op: 'eq', args: [field('service.weekday'), lit('wednesday')] }, ctx),
    ).toBe(true);
    expect(
      evaluatePredicate({ op: 'ne', args: [field('service.weekday'), lit('sunday')] }, ctx),
    ).toBe(true);
    expect(evaluatePredicate({ op: 'gt', args: [field('team.size'), lit(3)] }, ctx)).toBe(true);
    expect(evaluatePredicate({ op: 'le', args: [field('team.size'), lit(4)] }, ctx)).toBe(true);
    // Tipos incompativeis => false, sem lancar.
    expect(evaluatePredicate({ op: 'lt', args: [field('service.weekday'), lit(1)] }, ctx)).toBe(
      false,
    );
  });

  it('avalia pertinencia `in` e `includes`', () => {
    expect(
      evaluatePredicate(
        { op: 'in', args: [field('service.weekday'), ['wednesday', 'saturday']] },
        ctx,
      ),
    ).toBe(true);
    expect(evaluatePredicate({ op: 'in', args: [field('service.weekday'), ['sunday']] }, ctx)).toBe(
      false,
    );
    expect(
      evaluatePredicate({ op: 'includes', args: ['subject.capabilityIds', lit('regente')] }, ctx),
    ).toBe(true);
    expect(
      evaluatePredicate(
        { op: 'includes', args: ['subject.capabilityIds', lit('sonoplastia')] },
        ctx,
      ),
    ).toBe(false);
  });

  it('avalia `has` de campo presente/ausente', () => {
    expect(evaluatePredicate({ op: 'has', args: ['team.size'] }, ctx)).toBe(true);
    expect(evaluatePredicate({ op: 'has', args: ['team.ausente'] }, ctx)).toBe(false);
  });

  it('campo ausente em comparacao resulta em false (nunca lanca)', () => {
    expect(evaluatePredicate({ op: 'eq', args: [field('x.ausente'), lit('y')] }, ctx)).toBe(false);
  });

  it('e deterministica: mesma entrada, mesmo resultado', () => {
    const p: RulePredicate = {
      op: 'and',
      args: [
        { op: 'eq', args: [field('service.weekday'), lit('wednesday')] },
        { op: 'includes', args: ['subject.capabilityIds', field('assignment.roleId')] },
      ],
    };
    const a = evaluatePredicate(p, ctx);
    const b = evaluatePredicate(p, ctx);
    expect(a).toBe(b);
    expect(a).toBe(true);
  });
});
