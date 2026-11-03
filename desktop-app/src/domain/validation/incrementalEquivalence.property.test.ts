// Teste baseado em propriedade (tarefa 8.3): equivalencia da validacao
// incremental com a validacao completa.
//
// Feature: gestao-leiga-de-escalas, Property 25: Validação incremental equivale à validação completa
//
// Property 25 (requirements.md, Requisitos 7.1 e 14.5):
// "Para todo rascunho, para toda alteracao de um campo e para o conjunto
//  correto de campos alterados, a validacao INCREMENTAL produz exatamente o
//  mesmo conjunto de achados (e os mesmos totais) que a validacao COMPLETA da
//  nova revisao."
// Valida: Requisitos 7.1, 14.5.
//
// Estrategia: geramos um cenario BASE arbitrario (cultos, pessoas, atribuicoes,
// indisponibilidades e configuracao estrutural), calculamos os resultados por
// verificacao da revisao base (`runAllChecks`) e, em seguida, aplicamos uma
// MUTACAO escopada a um eixo semantico conhecido. Cada eixo de mutacao declara
// exatamente quais `ValidatedField` mudaram. A propriedade afirma que
// `validateIncremental(mutado, baseChecks, camposAlterados)` coincide, achado a
// achado e nos totais, com `validateComplete(mutado)`.
//
// Determinismo das datas: NAO usamos `fc.date().toISOString()` (que pode lancar
// e e sensivel a fuso). As datas vem de um POOL FIXO e valido de fevereiro/2026
// (dentro da vigencia do RuleSet) gerado por offsets inteiros.

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  runAllChecks,
  validateComplete,
  validateIncremental,
  type RuleSetStructuralConfig,
  type ValidatedField,
  type ValidationInput,
} from './validationEngine';
import { SCHEMA_VERSION } from '../schemas/models';
import type {
  ApprovedRuleSet,
  Assignment,
  Person,
  ScheduleDraft,
  Service,
  Unavailability,
  ValidationReport,
  Weekday,
} from '../schemas/models';

// --------------------------------------------------------------------------
// Constantes deterministicas do cenario
// --------------------------------------------------------------------------

const NOW = '2026-02-01T12:00:00Z';

const ROLE_REGENTE = 'role-regente';
const ROLE_EQUIPE = 'role-equipe';
const ROLE_MENSAGEM = 'role-mensagem';
const ALL_ROLES = [ROLE_REGENTE, ROLE_EQUIPE, ROLE_MENSAGEM] as const;

// Pool FIXO e valido de datas civis de fevereiro/2026, com o dia da semana
// gregoriano correto pre-computado (sem `Date`, sem `fc.date()`): cada entrada
// e uma quarta (wednesday), sabado (saturday) ou domingo (sunday) reais de
// 2026-02. Isso mantem as datas dentro da vigencia do RuleSet e livres de
// qualquer excecao de fuso horario.
const DATE_POOL: readonly { date: string; weekday: Weekday }[] = [
  { date: '2026-02-04', weekday: 'wednesday' },
  { date: '2026-02-07', weekday: 'saturday' },
  { date: '2026-02-08', weekday: 'sunday' },
  { date: '2026-02-11', weekday: 'wednesday' },
  { date: '2026-02-14', weekday: 'saturday' },
  { date: '2026-02-15', weekday: 'sunday' },
  { date: '2026-02-18', weekday: 'wednesday' },
  { date: '2026-02-21', weekday: 'saturday' },
  { date: '2026-02-22', weekday: 'sunday' },
  { date: '2026-02-25', weekday: 'wednesday' },
  { date: '2026-02-28', weekday: 'saturday' },
];

const EMPTY_STRUCTURAL: RuleSetStructuralConfig = {
  worshipTeamRoleIds: [],
  wednesdayForbiddenWorshipRoleIds: [],
  wednesdayRequiredExternalTypes: [],
  musicalMessageRoleIds: [],
  incompatibleRolePairs: [],
  externalRoleIds: [],
  ownWorshipRoleIds: [],
  departmentWorshipRequiredRoleIds: [],
  communicationRoleIds: [],
  propagation: { propagatingLinkTypeIds: new Set<string>() },
};

// --------------------------------------------------------------------------
// Builders deterministicos
// --------------------------------------------------------------------------

function person(id: string, caps: string[], weekdays: Person['allowedWeekdays']): Person {
  return {
    schemaVersion: SCHEMA_VERSION,
    id,
    canonicalName: id,
    aliases: [],
    participation: 'active',
    publicContactAuthorizationIds: [],
    capabilityIds: caps,
    allowedWeekdays: weekdays,
    leaves: [],
    links: [],
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function service(id: string, date: string, weekday: Weekday): Service {
  return {
    schemaVersion: SCHEMA_VERSION,
    id,
    cycleId: 'cycle-1',
    date,
    computedWeekday: weekday,
    kind: 'regular',
    externalInputIds: [],
  };
}

function assignment(id: string, serviceId: string, roleId: string, subjectId: string): Assignment {
  return { id, serviceId, roleId, subject: { type: 'person', id: subjectId }, source: 'manual' };
}

function draft(assignments: Assignment[], revision: string): ScheduleDraft {
  return {
    schemaVersion: SCHEMA_VERSION,
    cycleId: 'cycle-1',
    revision,
    assignments,
    publicFields: [],
    privateNotes: [],
    createdAt: NOW,
  };
}

function ruleSet(): ApprovedRuleSet {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: 'rs-1',
    version: 'v1',
    status: 'approved',
    validFrom: '2026-02-01',
    validUntil: '2026-02-28',
    rules: [],
    sourceDecisions: [],
    approvedBy: 'op-1',
    approvedAt: NOW,
    createdAt: NOW,
  };
}

// --------------------------------------------------------------------------
// Modelo do cenario gerado (puramente de dados; convertido em ValidationInput)
// --------------------------------------------------------------------------

interface Scenario {
  services: Service[];
  people: Person[];
  assignments: Assignment[];
  unavailabilities: Unavailability[];
  structural: RuleSetStructuralConfig;
}

function toInput(scenario: Scenario, revision: string): ValidationInput {
  return {
    cycleId: 'cycle-1',
    draft: draft(scenario.assignments, revision),
    services: scenario.services,
    externalInputs: [],
    unavailabilities: scenario.unavailabilities,
    people: scenario.people,
    departments: [],
    ruleSet: ruleSet(),
    exceptions: [],
    structural: scenario.structural,
  };
}

// --------------------------------------------------------------------------
// Geradores inteligentes (constrangem ao espaco de entrada relevante)
// --------------------------------------------------------------------------

// Pessoas: cada pessoa tem um subconjunto de habilitacoes e de dias permitidos.
// Dias vazios = sem restricao de dia (o engine trata [] como "todos").
const personGen = (id: string): fc.Arbitrary<Person> =>
  fc.record({
    caps: fc.subarray([...ALL_ROLES], { minLength: 0 }),
    weekdays: fc.subarray<Weekday>(['wednesday', 'saturday', 'sunday'], { minLength: 0 }),
  }).map(({ caps, weekdays }) => person(id, [...caps], [...weekdays]));

// Um cenario BASE: 1..4 cultos (datas distintas do pool), 2..4 pessoas, 0..6
// atribuicoes referenciando cultos/pessoas/funcoes existentes, 0..3
// indisponibilidades e uma configuracao estrutural parcial.
const scenarioGen: fc.Arbitrary<Scenario> = fc
  .record({
    serviceCount: fc.integer({ min: 1, max: 4 }),
    dateIdxs: fc.uniqueArray(fc.integer({ min: 0, max: DATE_POOL.length - 1 }), {
      minLength: 4,
      maxLength: 4,
    }),
    personCount: fc.integer({ min: 2, max: 4 }),
  })
  .chain(({ serviceCount, dateIdxs, personCount }) => {
    const services = Array.from({ length: serviceCount }, (_, i) => {
      const slot = DATE_POOL[dateIdxs[i] as number] as { date: string; weekday: Weekday };
      return service(`svc-${i}`, slot.date, slot.weekday);
    });
    const serviceIds = services.map((s) => s.id);
    const personIds = Array.from({ length: personCount }, (_, i) => `p-${i}`);

    const assignmentGen = fc.record({
      serviceId: fc.constantFrom(...serviceIds),
      roleId: fc.constantFrom(...ALL_ROLES),
      subjectId: fc.constantFrom(...personIds),
    });

    // Indisponibilidades: escopo `dates` (datas do pool) ou `whole-cycle`.
    const unavGen = fc.record({
      personId: fc.constantFrom(...personIds),
      scope: fc.oneof(
        fc
          .uniqueArray(fc.constantFrom(...services.map((s) => s.date)), { minLength: 1 })
          .map((dates) => ({ type: 'dates' as const, dates })),
        fc.constant({ type: 'whole-cycle' as const }),
      ),
    });

    return fc.record({
      people: fc.tuple(...personIds.map((id) => personGen(id))),
      assignments: fc.array(assignmentGen, { minLength: 0, maxLength: 6 }),
      unavs: fc.array(unavGen, { minLength: 0, maxLength: 3 }),
      structural: structuralGen,
    }).map(({ people, assignments, unavs, structural }) => {
      const asgs = assignments.map((a, i) =>
        assignment(`a-${i}`, a.serviceId, a.roleId, a.subjectId),
      );
      const unavailabilities: Unavailability[] = unavs.map((u, i) => ({
        schemaVersion: SCHEMA_VERSION,
        id: `u-${i}`,
        cycleId: 'cycle-1',
        personId: u.personId,
        scope: u.scope,
        source: 'teste',
        createdAt: NOW,
      }));
      return {
        services,
        people: [...people],
        assignments: asgs,
        unavailabilities,
        structural,
      } satisfies Scenario;
    });
  });

// Configuracao estrutural parcial que exercita varias verificacoes ao mesmo
// tempo (tamanho/genero de equipe, quarta proibida, sabado/limite de mensagem,
// incompatibilidade, comunicacao). Mantemos valores pequenos e coerentes.
const structuralGen: fc.Arbitrary<RuleSetStructuralConfig> = fc
  .record({
    teamSize: fc.option(fc.integer({ min: 1, max: 3 }), { nil: undefined }),
    forbidWedEquipe: fc.boolean(),
    saturdayMsgs: fc.option(fc.integer({ min: 1, max: 2 }), { nil: undefined }),
    monthlyLimit: fc.option(fc.integer({ min: 1, max: 2 }), { nil: undefined }),
    incompat: fc.boolean(),
    communication: fc.boolean(),
  })
  .map((c) => {
    const cfg: RuleSetStructuralConfig = {
      ...EMPTY_STRUCTURAL,
      worshipTeamRoleIds: [ROLE_EQUIPE],
      musicalMessageRoleIds: [ROLE_MENSAGEM],
      ...(c.teamSize !== undefined ? { worshipTeamSize: c.teamSize } : {}),
      ...(c.saturdayMsgs !== undefined ? { saturdayRequiredMessageCount: c.saturdayMsgs } : {}),
      ...(c.monthlyLimit !== undefined ? { monthlyMessageLimit: c.monthlyLimit } : {}),
      wednesdayForbiddenWorshipRoleIds: c.forbidWedEquipe ? [ROLE_EQUIPE] : [],
      incompatibleRolePairs: c.incompat ? [[ROLE_REGENTE, ROLE_MENSAGEM]] : [],
      communicationRoleIds: c.communication ? [ROLE_REGENTE] : [],
    };
    return cfg;
  });

// --------------------------------------------------------------------------
// Mutacoes escopadas: cada uma declara EXATAMENTE os ValidatedField alterados.
// --------------------------------------------------------------------------

interface Mutation {
  apply: (s: Scenario) => Scenario;
  fields: ValidatedField[];
}

/**
 * Gera uma mutacao do cenario restrita a um eixo semantico, devolvendo tambem o
 * conjunto CORRETO de campos alterados (`ValidatedField[]`). Cada ramo so toca
 * os dados associados aos campos declarados.
 */
const mutationGen = (scenario: Scenario): fc.Arbitrary<Mutation> => {
  const branches: fc.Arbitrary<Mutation>[] = [];

  // (1) Alterar a habilitacao de uma pessoa => registry.capability.
  if (scenario.people.length > 0) {
    branches.push(
      fc
        .record({
          idx: fc.integer({ min: 0, max: scenario.people.length - 1 }),
          caps: fc.subarray([...ALL_ROLES], { minLength: 0 }),
        })
        .map(({ idx, caps }) => ({
          fields: ['registry.capability'] as ValidatedField[],
          apply: (s: Scenario): Scenario => {
            const people = s.people.map((p, i) =>
              i === idx ? { ...p, capabilityIds: [...caps] } : p,
            );
            return { ...s, people };
          },
        })),
    );

    // (2) Alterar os dias permitidos de uma pessoa => registry.capability
    //     (capability-weekday depende de registry.capability e service.weekday).
    branches.push(
      fc
        .record({
          idx: fc.integer({ min: 0, max: scenario.people.length - 1 }),
          weekdays: fc.subarray<Weekday>(['wednesday', 'saturday', 'sunday'], { minLength: 0 }),
        })
        .map(({ idx, weekdays }) => ({
          fields: ['registry.capability'] as ValidatedField[],
          apply: (s: Scenario): Scenario => {
            const people = s.people.map((p, i) =>
              i === idx ? { ...p, allowedWeekdays: [...weekdays] } : p,
            );
            return { ...s, people };
          },
        })),
    );
  }

  // (3) Adicionar uma atribuicao => assignment.subject + assignment.role.
  if (scenario.services.length > 0 && scenario.people.length > 0) {
    branches.push(
      fc
        .record({
          serviceIdx: fc.integer({ min: 0, max: scenario.services.length - 1 }),
          roleId: fc.constantFrom(...ALL_ROLES),
          personIdx: fc.integer({ min: 0, max: scenario.people.length - 1 }),
        })
        .map(({ serviceIdx, roleId, personIdx }) => ({
          fields: ['assignment.subject', 'assignment.role'] as ValidatedField[],
          apply: (s: Scenario): Scenario => {
            const svc = s.services[serviceIdx] as Service;
            const p = s.people[personIdx] as Person;
            const next = [
              ...s.assignments,
              assignment(`a-new-${s.assignments.length}`, svc.id, roleId, p.id),
            ];
            return { ...s, assignments: next };
          },
        })),
    );
  }

  // (4) Remover uma atribuicao existente => assignment.subject + assignment.role.
  if (scenario.assignments.length > 0) {
    branches.push(
      fc.integer({ min: 0, max: scenario.assignments.length - 1 }).map((idx) => ({
        fields: ['assignment.subject', 'assignment.role'] as ValidatedField[],
        apply: (s: Scenario): Scenario => ({
          ...s,
          assignments: s.assignments.filter((_, i) => i !== idx),
        }),
      })),
    );
  }

  // (5) Alterar o sujeito de uma atribuicao existente => assignment.subject.
  if (scenario.assignments.length > 0 && scenario.people.length > 0) {
    branches.push(
      fc
        .record({
          idx: fc.integer({ min: 0, max: scenario.assignments.length - 1 }),
          personIdx: fc.integer({ min: 0, max: scenario.people.length - 1 }),
        })
        .map(({ idx, personIdx }) => ({
          fields: ['assignment.subject'] as ValidatedField[],
          apply: (s: Scenario): Scenario => {
            const p = s.people[personIdx] as Person;
            const assignments = s.assignments.map((a, i) =>
              i === idx ? { ...a, subject: { type: 'person' as const, id: p.id } } : a,
            );
            return { ...s, assignments };
          },
        })),
    );
  }

  // (6) Adicionar/alterar uma indisponibilidade => unavailability.
  if (scenario.people.length > 0 && scenario.services.length > 0) {
    branches.push(
      fc
        .record({
          personIdx: fc.integer({ min: 0, max: scenario.people.length - 1 }),
          dateIdx: fc.integer({ min: 0, max: scenario.services.length - 1 }),
        })
        .map(({ personIdx, dateIdx }) => ({
          fields: ['unavailability'] as ValidatedField[],
          apply: (s: Scenario): Scenario => {
            const p = s.people[personIdx] as Person;
            const svc = s.services[dateIdx] as Service;
            const unav: Unavailability = {
              schemaVersion: SCHEMA_VERSION,
              id: `u-new-${s.unavailabilities.length}`,
              cycleId: 'cycle-1',
              personId: p.id,
              scope: { type: 'dates', dates: [svc.date] },
              source: 'teste',
              createdAt: NOW,
            };
            return { ...s, unavailabilities: [...s.unavailabilities, unav] };
          },
        })),
    );
  }

  // Sempre ha ao menos um ramo util (ha >= 2 pessoas e >= 1 culto por
  // construcao), mas garantimos um no-op defensivo para robustez.
  if (branches.length === 0) {
    branches.push(fc.constant({ apply: (s: Scenario) => s, fields: [] as ValidatedField[] }));
  }
  return fc.oneof(...branches);
};

// --------------------------------------------------------------------------
// Comparacao de relatorios (conjunto de achados + totais)
// --------------------------------------------------------------------------

function findingIds(report: ValidationReport): { blocking: string[]; warnings: string[] } {
  return {
    blocking: report.blocking.map((f) => f.findingId).sort(),
    warnings: report.warnings.map((f) => f.findingId).sort(),
  };
}

// Em caso de falha, o fast-check ja expoe seed e replayPath; tornamos isso
// explicito para facilitar a reproducao exata do contraexemplo. O reporter e
// generico no tipo do caso de teste (`Ts`) para casar com cada `fc.assert`.
function pbtOptions<Ts>(): fc.Parameters<Ts> {
  return {
    numRuns: 200,
    reporter: (log: fc.RunDetails<Ts>): void => {
      if (log.failed) {
        throw new Error(
          `Property 25 falhou. seed=${log.seed} path="${log.counterexamplePath ?? ''}" ` +
            `numRuns=${log.numRuns}\nContraexemplo: ${fc.stringify(log.counterexample)}`,
        );
      }
    },
  };
}

// --------------------------------------------------------------------------
// Propriedade
// --------------------------------------------------------------------------

describe('Property 25: validacao incremental equivale a validacao completa (7.1/14.5)', () => {
  it('incremental(mutado, baseChecks, camposAlterados) == completa(mutado)', () => {
    fc.assert(
      fc
        .property(
          scenarioGen.chain((base) =>
            mutationGen(base).map((mutation) => ({ base, mutation })),
          ),
          ({ base, mutation }) => {
            // Revisao base e seus resultados por verificacao.
            const baseInput = toInput(base, 'a'.repeat(64));
            const baseChecks = runAllChecks(baseInput);

            // Nova revisao: aplica a mutacao escopada.
            const mutated = mutation.apply(base);
            const mutatedInput = toInput(mutated, 'b'.repeat(64));

            const incremental = validateIncremental(mutatedInput, baseChecks, mutation.fields);
            const complete = validateComplete(mutatedInput);

            // Mesmo conjunto de achados (por findingId) e mesmos totais.
            expect(findingIds(incremental)).toEqual(findingIds(complete));
            expect(incremental.passedCount).toBe(complete.passedCount);
            expect(incremental.blocking.length).toBe(complete.blocking.length);
            expect(incremental.warnings.length).toBe(complete.warnings.length);
          },
        ),
      pbtOptions<[{ base: Scenario; mutation: Mutation }]>(),
    );
  });

  it('reavaliar com o conjunto COMPLETO de campos tambem equivale a completa', () => {
    // Caso de controle: passar todos os campos validados como alterados nunca
    // pode divergir da completa (reavalia tudo). Reforca a corretude do oraculo.
    const ALL_FIELDS: ValidatedField[] = [
      'service.date',
      'service.weekday',
      'assignment.subject',
      'assignment.role',
      'team',
      'external.elder',
      'external.preacher',
      'external.audio',
      'external.sabbath-school-song',
      'external.theme',
      'external.song-request',
      'external.observation',
      'unavailability',
      'registry.identity',
      'registry.capability',
      'registry.contact',
    ];
    fc.assert(
      fc.property(scenarioGen, (base) => {
        const baseInput = toInput(base, 'a'.repeat(64));
        const baseChecks = runAllChecks(baseInput);
        const incremental = validateIncremental(baseInput, baseChecks, ALL_FIELDS);
        const complete = validateComplete(baseInput);
        expect(findingIds(incremental)).toEqual(findingIds(complete));
        expect(incremental.passedCount).toBe(complete.passedCount);
      }),
      pbtOptions<[base: Scenario]>(),
    );
  });
});
