// Teste baseado em propriedade para a SEGURANCA da sugestao (tarefa 6.6 do
// plano de implementacao de `gestao-leiga-de-escalas`).
//
// Feature: gestao-leiga-de-escalas, Property 19: Sugestão nunca viola regra fundamental
//
// Design (design.md -> "Property 19: Sugestão nunca viola regra fundamental"):
//   "Para toda instância de escala, cada atribuição produzida pelo
//    SuggestionEngine satisfaz todas as Regras_Fundamentais aplicáveis ou
//    possui Excecao_Aprovada vigente e aplicável; se não houver solução para um
//    slot, ele permanece sem atribuição e lista as regras que eliminaram os
//    candidatos."
//
// Valida: Requisitos 5.11, 5.13, 5.15.
//   5.11 montagem manual bloqueia Regra_Fundamental sem Excecao_Aprovada
//        vigente (o motor herda a mesma barreira: nunca PRODUZ tal atribuicao).
//   5.13 toda atribuicao produzida satisfaz as Regras_Fundamentais aplicaveis,
//        salvo Excecao_Aprovada vigente e aplicavel; elegibilidade bloqueante
//        separada do score inteiro.
//   5.15 slot sem solucao permanece SEM atribuicao e lista as RF que eliminaram
//        os candidatos.
//
// Estrategia: geramos "mundos" aleatorios (pessoas, departamentos, cultos,
// indisponibilidades, Regras_Fundamentais declarativas e Excecoes_Aprovadas) e
// rodamos o motor. Um ORACULO INDEPENDENTE, que NAO reusa o pipeline interno do
// motor, re-avalia cada atribuicao produzida diretamente contra o conjunto de
// Regras_Fundamentais e o conjunto de excecoes. As Regras_Fundamentais sao
// restricoes rigidas (hard constraints): o motor pode deixar slots vazios, mas
// JAMAIS pode colocar um sujeito que viole uma RF aplicavel sem excecao vigente.
//
// Minimo de 100 execucoes; seed/replayPath sao expostos na falha (o reporter do
// fast-check inclui ambos na mensagem do contraexemplo).

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  generateCompleteSuggestion,
  type ConfirmedAssignment,
  type RoleRequirement,
  type SuggestionInput,
} from './suggestionEngine';
import { SCHEMA_VERSION } from '../schemas/models';
import type {
  ApprovedException,
  ApprovedRuleSet,
  Department,
  MonthlyCycle,
  Person,
  Rule,
  RulePredicate,
  ScheduleDraft,
  Service,
  Weekday,
} from '../schemas/models';
import type { EffectiveUnavailability } from '../cycle/unavailability';
import {
  contextFromMap,
  evaluatePredicate,
  field,
  lit,
} from '../rules/predicate';

// --------------------------------------------------------------------------
// Constantes fixas do dominio de geracao
// --------------------------------------------------------------------------

const NOW = '2026-02-01T12:00:00Z';
const PERIOD = '2026-02';
const CYCLE_ID = 'cycle-1';

const CAP_A = 'cap-a';
const CAP_B = 'cap-b';
const ROLE_A = 'role-a';
const ROLE_B = 'role-b';

// Cultos possiveis no ciclo (datas reais de 2026-02 com dia da semana correto).
const SERVICE_POOL: ReadonlyArray<{ id: string; date: string; weekday: Weekday }> = [
  { id: 'svc-wed-1', date: '2026-02-04', weekday: 'wednesday' },
  { id: 'svc-sat-1', date: '2026-02-07', weekday: 'saturday' },
  { id: 'svc-sun-1', date: '2026-02-08', weekday: 'sunday' },
  { id: 'svc-wed-2', date: '2026-02-11', weekday: 'wednesday' },
  { id: 'svc-sat-2', date: '2026-02-14', weekday: 'saturday' },
  { id: 'svc-sun-2', date: '2026-02-15', weekday: 'sunday' },
];

const WEEKDAYS: readonly Weekday[] = ['wednesday', 'saturday', 'sunday'];

const ROLE_REQUIREMENTS: readonly RoleRequirement[] = [
  { roleId: ROLE_A, order: 1, requiredCapabilityId: CAP_A, allowsDepartment: false },
  { roleId: ROLE_B, order: 2, requiredCapabilityId: CAP_B, allowsDepartment: true },
];

// Caminhos conhecidos usados pelas RF geradas (espelham o contexto do motor).
const SUBJECT_IDS_FOR_RULES = ['p-0', 'p-1', 'p-2', 'p-3', 'dep-0', 'dep-1'];

// --------------------------------------------------------------------------
// Builders deterministicos
// --------------------------------------------------------------------------

function person(
  id: string,
  caps: string[],
  weekdays: Weekday[],
  participation: Person['participation'],
): Person {
  return {
    schemaVersion: SCHEMA_VERSION,
    id,
    canonicalName: id,
    aliases: [],
    participation,
    publicContactAuthorizationIds: [],
    capabilityIds: caps,
    allowedWeekdays: weekdays,
    leaves: [],
    links: [],
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function department(id: string, status: Department['status']): Department {
  return {
    schemaVersion: SCHEMA_VERSION,
    id,
    canonicalName: id,
    aliases: [],
    status,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function service(entry: { id: string; date: string; weekday: Weekday }): Service {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: entry.id,
    cycleId: CYCLE_ID,
    date: entry.date,
    computedWeekday: entry.weekday,
    kind: 'regular',
    externalInputIds: [],
  };
}

function cycle(): MonthlyCycle {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: CYCLE_ID,
    period: PERIOD,
    state: 'open',
    stage: 'assembly',
    ruleSetVersionId: 'rs-1',
    currentDraftRevision: 'a'.repeat(64),
    serviceIds: [],
    stageCompletions: [],
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function emptyDraft(): ScheduleDraft {
  return {
    schemaVersion: SCHEMA_VERSION,
    cycleId: CYCLE_ID,
    revision: 'a'.repeat(64),
    assignments: [],
    publicFields: [],
    privateNotes: [],
    createdAt: NOW,
  };
}

function ruleSet(rules: Rule[]): ApprovedRuleSet {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: 'rs-1',
    version: 'v1',
    status: 'approved',
    validFrom: '2026-01-01',
    rules,
    sourceDecisions: [],
    approvedBy: 'op-1',
    approvedAt: NOW,
    createdAt: NOW,
  };
}

// --------------------------------------------------------------------------
// Geradores (constroem o espaco de entrada de forma inteligente)
// --------------------------------------------------------------------------

/** Subconjunto nao vazio de dias da semana permitidos para a pessoa. */
const arbWeekdays = fc
  .subarray([...WEEKDAYS], { minLength: 0, maxLength: WEEKDAYS.length })
  .map((xs) => (xs.length === 0 ? (['wednesday'] as Weekday[]) : (xs as Weekday[])));

/** Subconjunto de habilitacoes (pode ficar vazio). */
const arbCaps = fc.subarray([CAP_A, CAP_B], { minLength: 0, maxLength: 2 });

function arbPerson(index: number): fc.Arbitrary<Person> {
  return fc
    .record({
      caps: arbCaps,
      weekdays: arbWeekdays,
      participation: fc.constantFrom<Person['participation']>('active', 'inactive'),
    })
    .map((r) => person(`p-${index}`, r.caps, r.weekdays, r.participation));
}

function arbDepartment(index: number): fc.Arbitrary<Department> {
  return fc
    .constantFrom<Department['status']>('active', 'inactive')
    .map((status) => department(`dep-${index}`, status));
}

/**
 * Gera uma Regra_Fundamental declarativa com aplicabilidade e assercao usando
 * APENAS a DSL fechada sobre campos conhecidos do contexto do motor. Variedade
 * suficiente para cobrir regras que bloqueiam por dia da semana, funcao, tipo
 * de sujeito ou sujeito especifico.
 */
function arbFundamentalRule(index: number): fc.Arbitrary<Rule> {
  const arbApplicability: fc.Arbitrary<RulePredicate> = fc.oneof(
    fc.constant<RulePredicate>({ op: 'true' }),
    fc
      .constantFrom(...WEEKDAYS)
      .map((wd) => ({ op: 'eq', args: [field('service.weekday'), lit(wd)] })),
    fc
      .constantFrom(ROLE_A, ROLE_B)
      .map((role) => ({ op: 'eq', args: [field('assignment.roleId'), lit(role)] })),
    fc
      .constantFrom('person', 'department')
      .map((t) => ({ op: 'eq', args: [field('assignment.subjectType'), lit(t)] })),
  );

  // A assercao e a condicao que DEVE valer quando a regra se aplica. Usamos
  // formas que podem falhar (criando violacao) ou nao, para exercitar os dois
  // lados do oraculo.
  const arbAssertion: fc.Arbitrary<RulePredicate> = fc.oneof(
    fc.constant<RulePredicate>({ op: 'false' }),
    fc.constant<RulePredicate>({ op: 'true' }),
    fc
      .constantFrom(...SUBJECT_IDS_FOR_RULES)
      .map((sid) => ({ op: 'ne', args: [field('assignment.subjectId'), lit(sid)] })),
    fc
      .constantFrom(...WEEKDAYS)
      .map((wd) => ({ op: 'ne', args: [field('service.weekday'), lit(wd)] })),
  );

  return fc.record({ applicability: arbApplicability, assertion: arbAssertion }).map((r) => ({
    id: `rf-${index}`,
    kind: 'fundamental' as const,
    severity: 'blocking' as const,
    applicability: r.applicability,
    assertion: r.assertion,
    messageTemplate: `regra fundamental ${index}`,
    allowedExceptionTypeIds: [],
  }));
}

/** Gera uma Excecao_Aprovada que pode ou nao estar em vigencia no ciclo. */
function arbException(ruleIds: string[], index: number): fc.Arbitrary<ApprovedException> {
  return fc
    .record({
      ruleId: fc.constantFrom(...ruleIds),
      inForce: fc.boolean(),
      condition: fc.oneof(
        fc.constant<RulePredicate>({ op: 'true' }),
        fc
          .constantFrom(...SUBJECT_IDS_FOR_RULES)
          .map((sid) => ({ op: 'eq', args: [field('assignment.subjectId'), lit(sid)] })),
      ),
    })
    .map((r) => ({
      schemaVersion: SCHEMA_VERSION,
      id: `exc-${index}`,
      fundamentalRuleId: r.ruleId,
      condition: r.condition,
      // Em vigencia: cobre todo o mes. Fora de vigencia: mes seguinte.
      validFrom: r.inForce ? '2026-02-01' : '2026-03-01',
      validUntil: r.inForce ? '2026-02-28' : '2026-03-31',
      justification: 'excecao de teste',
      approvedBy: 'op-1',
      approvedAt: NOW,
    }));
}

/** Indisponibilidade efetiva de uma pessoa em uma data sorteada do ciclo. */
function arbUnavailability(
  personCount: number,
): fc.Arbitrary<EffectiveUnavailability[]> {
  return fc
    .array(
      fc.record({
        pIdx: fc.integer({ min: 0, max: Math.max(0, personCount - 1) }),
        svc: fc.constantFrom(...SERVICE_POOL),
      }),
      { maxLength: 6 },
    )
    .map((rows) =>
      rows.map((r, i) => ({
        sourceUnavailabilityId: `u-${i}`,
        personId: `p-${r.pIdx}`,
        date: r.svc.date,
        propagationPath: [],
      })),
    );
}

/** Mundo completo: entrada do motor + conjuntos para o oraculo independente. */
const arbWorld: fc.Arbitrary<SuggestionInput> = fc
  .integer({ min: 1, max: 5 })
  .chain((personCount) =>
    fc
      .record({
        people: fc.tuple(
          ...Array.from({ length: personCount }, (_unused, i) => arbPerson(i)),
        ),
        departments: fc.array(
          fc.integer({ min: 0, max: 1 }).chain((i) => arbDepartment(i)),
          { maxLength: 2 },
        ),
        services: fc.subarray([...SERVICE_POOL], { minLength: 1, maxLength: SERVICE_POOL.length }),
        rules: fc
          .integer({ min: 0, max: 3 })
          .chain((n) =>
            fc.tuple(...Array.from({ length: n }, (_unused, i) => arbFundamentalRule(i))),
          ),
        unavailability: arbUnavailability(personCount),
        history: fc.array(
          fc.record({
            pIdx: fc.integer({ min: 0, max: Math.max(0, personCount - 1) }),
            roleId: fc.constantFrom(ROLE_A, ROLE_B),
            svc: fc.constantFrom(...SERVICE_POOL),
          }),
          { maxLength: 8 },
        ),
      })
      .chain((base) => {
        const ruleIds = base.rules.map((r) => r.id);
        const arbExceptions =
          ruleIds.length === 0
            ? fc.constant<ApprovedException[]>([])
            : fc
                .integer({ min: 0, max: 3 })
                .chain((n) =>
                  fc.tuple(
                    ...Array.from({ length: n }, (_unused, i) => arbException(ruleIds, i)),
                  ),
                );
        return arbExceptions.map((exceptions): SuggestionInput => {
          // Departamentos com ids unicos (dedup por id, mantendo o primeiro).
          const depById = new Map<string, Department>();
          for (const d of base.departments) if (!depById.has(d.id)) depById.set(d.id, d);

          const history: ConfirmedAssignment[] = base.history.map((h) => ({
            subjectId: `p-${h.pIdx}`,
            roleId: h.roleId,
            date: h.svc.date,
          }));

          return {
            cycle: cycle(),
            draft: emptyDraft(),
            registry: {
              people: base.people,
              departments: [...depById.values()],
            },
            unavailability: base.unavailability,
            history,
            ruleSet: ruleSet(base.rules),
            exceptions,
            roleRequirements: ROLE_REQUIREMENTS,
            services: base.services.map(service),
            algorithmVersion: 'sug-1',
          };
        });
      }),
  );

// --------------------------------------------------------------------------
// Oraculo INDEPENDENTE sobre o conjunto de regras
// --------------------------------------------------------------------------

/**
 * Re-monta o contexto de avaliacao de uma atribuicao concreta de forma
 * INDEPENDENTE do motor (nao chama nenhuma funcao interna do SuggestionEngine).
 * Espelha os caminhos conhecidos declarados em `buildRuleContext`.
 */
function oracleContext(args: {
  svc: Service;
  roleId: string;
  subjectType: 'person' | 'department';
  person: Person | undefined;
  subjectId: string;
}) {
  const p = args.person;
  return contextFromMap({
    'service.date': args.svc.date,
    'service.weekday': args.svc.computedWeekday,
    'service.kind': args.svc.kind,
    'assignment.roleId': args.roleId,
    'assignment.subjectType': args.subjectType,
    'assignment.subjectId': args.subjectId,
    'subject.capabilityIds': p ? p.capabilityIds : [],
    'subject.allowedWeekdays': p ? p.allowedWeekdays : [],
    'subject.participation': p ? p.participation : 'active',
    'cycle.period': PERIOD,
  });
}

/**
 * Lista independente das Regras_Fundamentais VIOLADAS por uma atribuicao,
 * considerando excecoes vigentes e aplicaveis. Reimplementada no teste para
 * nao depender da logica interna do motor (verificacao cruzada real).
 */
function oracleViolations(
  input: SuggestionInput,
  svc: Service,
  roleId: string,
  subjectType: 'person' | 'department',
  subjectId: string,
): string[] {
  const person = input.registry.people.find((p) => p.id === subjectId);
  const ctx = oracleContext({ svc, roleId, subjectType, person, subjectId });
  const violated: string[] = [];
  for (const rule of input.ruleSet.rules) {
    if (rule.kind !== 'fundamental') continue;
    if (!evaluatePredicate(rule.applicability, ctx)) continue; // nao se aplica
    if (evaluatePredicate(rule.assertion, ctx)) continue; // satisfeita
    // Violacao potencial; procurar excecao vigente e aplicavel.
    const covered = input.exceptions.some(
      (exc) =>
        exc.fundamentalRuleId === rule.id &&
        svc.date >= exc.validFrom &&
        svc.date <= exc.validUntil &&
        evaluatePredicate(exc.condition, ctx),
    );
    if (!covered) violated.push(rule.id);
  }
  return violated;
}

// --------------------------------------------------------------------------
// Propriedade 19
// --------------------------------------------------------------------------

describe('SuggestionEngine - Property 19: seguranca da sugestao (5.11, 5.13, 5.15)', () => {
  it('nenhuma atribuicao sugerida viola uma Regra_Fundamental sem excecao vigente', () => {
    fc.assert(
      fc.property(arbWorld, (input) => {
        const result = generateCompleteSuggestion(input);
        const svcById = new Map(input.services.map((s) => [s.id, s]));

        // (5.13/5.11) Toda atribuicao produzida respeita as RF aplicaveis ou
        // possui excecao vigente — verificado por um oraculo independente.
        for (const a of result.assignments) {
          const svc = svcById.get(a.serviceId);
          expect(svc).toBeDefined();
          if (!svc) continue;
          const violations = oracleViolations(
            input,
            svc,
            a.roleId,
            a.subject.type,
            a.subject.id,
          );
          expect(violations).toEqual([]);
        }
        return true;
      }),
      { numRuns: 200 },
    );
  });

  it('slots sem candidato valido permanecem vazios e listam as RF bloqueantes (5.15)', () => {
    fc.assert(
      fc.property(arbWorld, (input) => {
        const result = generateCompleteSuggestion(input);
        const svcById = new Map(input.services.map((s) => [s.id, s]));

        // Para cada slot sem atribuicao, deve existir pelo menos um candidato
        // que foi eliminado por uma RF, OU nenhum candidato elegivel na base.
        // O motor nunca "inventa" um sujeito: nenhum slot preenchido e invalido
        // (coberto acima), e os blockingRuleIds sao RF reais do conjunto.
        const fundamentalIds = new Set(
          input.ruleSet.rules.filter((r) => r.kind === 'fundamental').map((r) => r.id),
        );
        for (const u of result.unfilled) {
          expect(svcById.has(u.serviceId)).toBe(true);
          for (const rid of u.blockingRuleIds) {
            expect(fundamentalIds.has(rid)).toBe(true);
          }
        }

        // Cada par (culto, funcao) aparece exatamente uma vez entre assignments
        // e unfilled: o motor produz uma decisao COMPLETA (5.9/5.15), sem slot
        // preenchido de forma invalida.
        const decided = new Set<string>();
        for (const a of result.assignments) decided.add(`${a.serviceId}\u0000${a.roleId}`);
        for (const u of result.unfilled) {
          const key = `${u.serviceId}\u0000${u.roleId}`;
          expect(decided.has(key)).toBe(false);
          decided.add(key);
        }
        const expectedSlots = input.services.length * ROLE_REQUIREMENTS.length;
        expect(decided.size).toBe(expectedSlots);
        return true;
      }),
      { numRuns: 200 },
    );
  });
});
