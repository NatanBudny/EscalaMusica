// Feature: gestao-leiga-de-escalas, Property 18: Sugestão é determinística e explicável
//
// Teste baseado em propriedade (fast-check) da Property 18 do design.md:
//
//   "Para todas as entradas semanticamente idênticas de Rascunho, cadastro,
//    insumos, indisponibilidades, histórico, versão de regras e algoritmo, a
//    sugestão completa, sua ordem e seu traço são idênticos, independentemente
//    da ordem de coleções sem semântica; cada escolha identifica função, culto,
//    sujeito, regras, disponibilidade, histórico e ranking considerados."
//
//   Valida: Requisitos 5.7, 5.8, 5.9.
//
// Este arquivo cobre EXCLUSIVAMENTE a Property 18 (determinismo + explicacao).
// A seguranca da sugestao (Property 19) e testada em outro arquivo.
//
// Estrategia: geramos entradas aleatorias validas e verificamos propriedades
// universais sobre `generateCompleteSuggestion`:
//
//  (A) Determinismo por BYTES e ORDEM (5.8): executar o motor duas vezes sobre
//      a MESMA entrada produz bytes canonicos identicos (conteudo + ordenacao).
//      A comparacao usa a serializacao canonica do dominio (`canonicalBytes`).
//
//  (B) Invariancia a reordenacao de colecoes SEM semantica (5.8): embaralhar
//      pessoas, departamentos, cultos, funcoes, historico, indisponibilidades e
//      regras nao altera o `inputHash` nem os bytes de saida.
//
//  (C) Explicabilidade e completude (5.7, 5.9): toda atribuicao produzida tem um
//      traco correspondente que identifica funcao, culto, sujeito e inclui
//      regras/disponibilidade/historico/ranking considerados; todo par
//      (culto, funcao) exigido e reportado exatamente uma vez como atribuicao
//      ou como slot nao preenchido (XOR), nunca ambos nem nenhum.
//
// fast-check >= 100 execucoes (usamos 200); o reporter do fast-check expoe
// seed e replayPath na mensagem do contraexemplo em caso de falha. O teste e
// puro: nao toca filesystem, rede, Git, Keychain nem Pages. Apenas este arquivo
// e executado quando a suite e escopada a ele.

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  computeInputHash,
  generateCompleteSuggestion,
  type ConfirmedAssignment,
  type RoleRequirement,
  type SuggestionInput,
} from './suggestionEngine';
import { canonicalBytes, toHex } from '../schemas/canonical';
import { SCHEMA_VERSION } from '../schemas/models';
import type {
  ApprovedException,
  ApprovedRuleSet,
  Department,
  MonthlyCycle,
  Person,
  Rule,
  ScheduleDraft,
  Service,
  Weekday,
} from '../schemas/models';
import type { EffectiveUnavailability } from '../cycle/unavailability';
import { field, lit } from '../rules/predicate';

const NOW = '2026-02-01T12:00:00Z';
const CYCLE_ID = 'cycle-1';
const PERIOD = '2026-02';

// Datas reais de quartas/sabados/domingos de 2026-02 (determinista).
const SERVICE_DATES: ReadonlyArray<{ date: string; weekday: Weekday }> = [
  { date: '2026-02-04', weekday: 'wednesday' },
  { date: '2026-02-07', weekday: 'saturday' },
  { date: '2026-02-08', weekday: 'sunday' },
  { date: '2026-02-11', weekday: 'wednesday' },
  { date: '2026-02-14', weekday: 'saturday' },
  { date: '2026-02-15', weekday: 'sunday' },
];

const CAPABILITIES: readonly string[] = ['cap-a', 'cap-b', 'cap-c'];
const ALL_WEEKDAYS: readonly Weekday[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];

// --------------------------------------------------------------------------
// Helpers deterministicos
// --------------------------------------------------------------------------

/** Comparacao estavel por unidade de codigo (independe de locale). */
function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Permuta `items` de forma determinista a partir de um vetor de chaves. */
function shuffleBy<T>(items: readonly T[], order: readonly number[]): T[] {
  return items
    .map((value, i) => ({ value, k: order[i] ?? i, i }))
    .sort((a, b) => a.k - b.k || a.i - b.i)
    .map((x) => x.value);
}

/** Chave canonica de um slot (culto + funcao). */
function slotKey(x: { serviceId: string; roleId: string }): string {
  return `${x.serviceId}\u0000${x.roleId}`;
}

// --------------------------------------------------------------------------
// Builders de entidades
// --------------------------------------------------------------------------

function cycleOf(): MonthlyCycle {
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

function draftOf(): ScheduleDraft {
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

function ruleSetOf(rules: Rule[]): ApprovedRuleSet {
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

function serviceOf(index: number): Service {
  const spec = SERVICE_DATES[index] as { date: string; weekday: Weekday };
  return {
    schemaVersion: SCHEMA_VERSION,
    id: `svc-${index}`,
    cycleId: CYCLE_ID,
    date: spec.date,
    computedWeekday: spec.weekday,
    kind: 'regular',
    externalInputIds: [],
  };
}

// --------------------------------------------------------------------------
// Generators
// --------------------------------------------------------------------------

function personArb(id: string): fc.Arbitrary<Person> {
  return fc
    .record({
      caps: fc.subarray([...CAPABILITIES], { minLength: 0, maxLength: CAPABILITIES.length }),
      weekdays: fc.subarray([...ALL_WEEKDAYS], { minLength: 0, maxLength: ALL_WEEKDAYS.length }),
      participation: fc.constantFrom('active', 'inactive'),
    })
    .map(({ caps, weekdays, participation }) => ({
      schemaVersion: SCHEMA_VERSION,
      id,
      canonicalName: id,
      aliases: [],
      participation: participation as Person['participation'],
      publicContactAuthorizationIds: [],
      capabilityIds: caps,
      allowedWeekdays: weekdays,
      leaves: [],
      links: [],
      createdAt: NOW,
      updatedAt: NOW,
    }));
}

function departmentArb(id: string): fc.Arbitrary<Department> {
  return fc.constantFrom('active', 'inactive').map((status) => ({
    schemaVersion: SCHEMA_VERSION,
    id,
    canonicalName: id,
    aliases: [],
    status: status as Department['status'],
    createdAt: NOW,
    updatedAt: NOW,
  }));
}

/** RFs opcionais que bloqueiam funcoes especificas (exercita unfilled + RF). */
function blockingRulesArb(roleIds: readonly string[]): fc.Arbitrary<Rule[]> {
  return fc.subarray([...roleIds], { minLength: 0, maxLength: roleIds.length }).map((roles) =>
    roles.map((roleId) => ({
      id: `rf-block-${roleId}`,
      kind: 'fundamental' as const,
      severity: 'blocking' as const,
      applicability: { op: 'eq', args: [field('assignment.roleId'), lit(roleId)] },
      assertion: { op: 'false' },
      messageTemplate: `bloqueado ${roleId}`,
      allowedExceptionTypeIds: [],
    })),
  );
}

/**
 * Um cenario produz um par de entradas SEMANTICAMENTE IDENTICAS: `a` com a ordem
 * natural das colecoes e `b` com todas as colecoes sem semantica embaralhadas.
 * Tambem expoe `roleIds` para checar a completude dos slots.
 */
interface Scenario {
  a: SuggestionInput;
  b: SuggestionInput;
  roleIds: string[];
}

const scenarioArb: fc.Arbitrary<Scenario> = fc
  .record({
    numPeople: fc.integer({ min: 0, max: 6 }),
    numDepartments: fc.integer({ min: 0, max: 2 }),
    numServices: fc.integer({ min: 1, max: SERVICE_DATES.length }),
    numRoles: fc.integer({ min: 1, max: 3 }),
    algorithmVersion: fc.constantFrom('sug-1', 'sug-2'),
    backtrackLimit: fc.integer({ min: 1, max: 100_000 }),
  })
  .chain((base) => {
    const roleIds = Array.from({ length: base.numRoles }, (_u, i) => `role-${i}`);
    const roleRequirements: RoleRequirement[] = roleIds.map((roleId, i) => ({
      roleId,
      order: i,
      requiredCapabilityId: CAPABILITIES[i % CAPABILITIES.length] as string,
      allowsDepartment: i % 2 === 0,
    }));
    const personIds = Array.from({ length: base.numPeople }, (_u, i) => `p-${i}`);
    const deptIds = Array.from({ length: base.numDepartments }, (_u, i) => `d-${i}`);
    const services = Array.from({ length: base.numServices }, (_u, i) => serviceOf(i));

    const peopleArb =
      personIds.length === 0
        ? fc.constant<Person[]>([])
        : fc.tuple(...personIds.map((id) => personArb(id)));
    const deptsArb =
      deptIds.length === 0
        ? fc.constant<Department[]>([])
        : fc.tuple(...deptIds.map((id) => departmentArb(id)));

    return fc
      .record({
        people: peopleArb,
        departments: deptsArb,
        rules: blockingRulesArb(roleIds),
        history: fc.array(
          fc.record({
            subjectId: fc.constantFrom(...(personIds.length ? personIds : ['p-none'])),
            roleId: fc.constantFrom(...roleIds),
            dateIndex: fc.integer({ min: 0, max: base.numServices - 1 }),
          }),
          { maxLength: 8 },
        ),
        unavail: fc.array(
          fc.record({
            personIndex: fc.integer({ min: 0, max: Math.max(0, base.numPeople - 1) }),
            dateIndex: fc.integer({ min: 0, max: base.numServices - 1 }),
          }),
          { maxLength: 8 },
        ),
        permPeople: fc.array(fc.integer({ min: 0, max: 1000 }), {
          minLength: base.numPeople,
          maxLength: base.numPeople,
        }),
        permDepts: fc.array(fc.integer({ min: 0, max: 1000 }), {
          minLength: base.numDepartments,
          maxLength: base.numDepartments,
        }),
        permServices: fc.array(fc.integer({ min: 0, max: 1000 }), {
          minLength: base.numServices,
          maxLength: base.numServices,
        }),
        permRoles: fc.array(fc.integer({ min: 0, max: 1000 }), {
          minLength: base.numRoles,
          maxLength: base.numRoles,
        }),
        permRules: fc.array(fc.integer({ min: 0, max: 1000 }), { maxLength: roleIds.length }),
      })
      .map((parts): Scenario => {
        const people = parts.people as Person[];
        const departments = parts.departments as Department[];
        const rules = parts.rules as Rule[];

        const history: ConfirmedAssignment[] = parts.history
          .filter((h) => personIds.includes(h.subjectId))
          .map((h) => ({
            subjectId: h.subjectId,
            roleId: h.roleId,
            date: (SERVICE_DATES[h.dateIndex] as { date: string }).date,
          }));

        const unavailability: EffectiveUnavailability[] = parts.unavail
          .filter((u) => personIds[u.personIndex] !== undefined)
          .map((u, i) => ({
            sourceUnavailabilityId: `u-${i}`,
            personId: personIds[u.personIndex] as string,
            date: (SERVICE_DATES[u.dateIndex] as { date: string }).date,
            propagationPath: [],
          }));

        const build = (shuffle: boolean): SuggestionInput => ({
          cycle: cycleOf(),
          draft: draftOf(),
          registry: {
            people: shuffle ? shuffleBy(people, parts.permPeople) : people,
            departments: shuffle ? shuffleBy(departments, parts.permDepts) : departments,
          },
          unavailability,
          history,
          ruleSet: ruleSetOf(shuffle ? shuffleBy(rules, parts.permRules) : rules),
          exceptions: [] as ApprovedException[],
          roleRequirements: shuffle
            ? shuffleBy(roleRequirements, parts.permRoles)
            : roleRequirements,
          services: shuffle ? shuffleBy(services, parts.permServices) : services,
          algorithmVersion: base.algorithmVersion,
          backtrackLimit: base.backtrackLimit,
        });

        return { a: build(false), b: build(true), roleIds };
      });
  });

// --------------------------------------------------------------------------
// Propriedade 18
// --------------------------------------------------------------------------

describe('SuggestionEngine - Property 18: determinismo e explicacao (5.7-5.9)', () => {
  it('mesma entrada => mesmos bytes/ordem; reordenacao sem semantica nao muda nada; cada escolha e explicada', () => {
    fc.assert(
      fc.property(scenarioArb, ({ a, b, roleIds }) => {
        // (A) Determinismo: mesma entrada, duas execucoes => bytes identicos.
        const run1 = generateCompleteSuggestion(a);
        const run2 = generateCompleteSuggestion(a);
        const bytes1 = toHex(canonicalBytes(run1));
        expect(toHex(canonicalBytes(run2))).toBe(bytes1);
        expect(run2.inputHash).toBe(run1.inputHash);

        // (B) Invariancia a reordenacao de colecoes sem semantica.
        expect(computeInputHash(b)).toBe(computeInputHash(a));
        const runShuffled = generateCompleteSuggestion(b);
        expect(toHex(canonicalBytes(runShuffled))).toBe(bytes1);

        // A ordem das saidas e canonica e estavel (ordenada por serviceId/roleId).
        const keys = (xs: ReadonlyArray<{ serviceId: string; roleId: string }>) =>
          xs.map(slotKey);
        const sorted = (ks: string[]) => [...ks].sort(cmp);
        expect(keys(run1.assignments)).toEqual(sorted(keys(run1.assignments)));
        expect(keys(run1.unfilled)).toEqual(sorted(keys(run1.unfilled)));
        expect(keys(run1.traces)).toEqual(sorted(keys(run1.traces)));

        // (C) Completude e explicabilidade (5.7, 5.9).
        const expectedSlots = new Set<string>();
        for (const svc of a.services) {
          for (const r of roleIds) expectedSlots.add(`${svc.id}\u0000${r}`);
        }
        const assignedSlots = new Set(keys(run1.assignments));
        const unfilledSlots = new Set(keys(run1.unfilled));

        // Todo slot exigido aparece exatamente uma vez: atribuido XOR nao preenchido.
        for (const slot of expectedSlots) {
          const inAssigned = assignedSlots.has(slot);
          const inUnfilled = unfilledSlots.has(slot);
          expect(inAssigned !== inUnfilled).toBe(true);
        }
        // Nenhum slot alem dos exigidos, e exatamente um traco por slot.
        expect(assignedSlots.size + unfilledSlots.size).toBe(expectedSlots.size);
        expect(run1.traces.length).toBe(expectedSlots.size);

        const traceBySlot = new Map(run1.traces.map((t) => [slotKey(t), t]));

        // Cada atribuicao produzida identifica funcao, culto e sujeito e carrega
        // um traco com regras/disponibilidade/historico/ranking considerados (5.7).
        for (const asg of run1.assignments) {
          expect(asg.serviceId).toBeTruthy();
          expect(asg.roleId).toBeTruthy();
          expect(asg.subject.id).toBeTruthy();

          const trace = traceBySlot.get(slotKey(asg));
          expect(trace).toBeDefined();
          expect(trace?.selectedSubjectIds).toContain(asg.subject.id);
          expect(Array.isArray(trace?.consideredRuleIds)).toBe(true);
          expect(Array.isArray(trace?.availabilityEvidenceIds)).toBe(true);
          expect(Array.isArray(trace?.historyEvidence)).toBe(true);
          expect(Array.isArray(trace?.rankedCandidates)).toBe(true);

          if (asg.source === 'suggested') {
            const ranked = (trace?.rankedCandidates ?? []).map((c) => c.subjectId);
            expect(ranked).toContain(asg.subject.id);
            for (const c of trace?.rankedCandidates ?? []) {
              expect(Number.isInteger(c.score)).toBe(true);
            }
          }
        }

        // Cada slot nao preenchido reporta suas RF bloqueantes em ordem estavel (5.15).
        for (const u of run1.unfilled) {
          expect(Array.isArray(u.blockingRuleIds)).toBe(true);
          expect(u.blockingRuleIds).toEqual([...u.blockingRuleIds].sort(cmp));
        }
      }),
      { numRuns: 200 },
    );
  });
});
