// Feature: gestao-leiga-de-escalas, Property 27: Regras estruturais produzem exatamente seus achados
//
// Property 27 (design.md): "Para toda escala e rule set, duplicidade de data,
// identidade não única, tamanho/composição de equipe, função própria na quarta,
// dado externo obrigatório, mensagens de sábado, incompatibilidade, sequência e
// limite mensal produzem achados exatamente quando seus predicados configurados
// são falsos, com severidade e referências corretas."
//
// Valida: Requisitos 7.6, 7.7, 7.8, 7.9, 7.10, 7.11, 7.12, 7.14, 7.17, 7.18.
// (Requisitos 7.13 indisponibilidade, 7.15 externo-vs-louvor e 7.16
// habilitacao/dia tambem sao verificados aqui, ampliando a cobertura estrutural
// solicitada pela tarefa 8.5.)
//
// Estrategia: para CADA verificacao estrutural nomeada, um gerador inteligente
// constroi um cenario valido e, de forma controlada, LIGA ou DESLIGA a condicao
// violadora. Um ORACULO INDEPENDENTE (recomputado a partir dos mesmos
// parametros, sem reusar a logica do engine) decide se o achado DEVE existir.
// A propriedade afirma:
//   (presenca)  o achado com o ruleId esperado existe  <=>  o oraculo diz que a
//               condicao violadora esta ativa;
//   (severidade) quando presente, a severidade e exatamente a esperada
//               (Bloqueio para 7.6-7.16/7.18; a definida pela regra em 7.17);
//   (referencia) quando presente, a referencia segura identifica os elementos
//               envolvidos (cultos, atribuicao ou sujeito), nunca conteudo livre.
//
// Datas: geracao DETERMINISTICA a partir de um calendario fixo de fevereiro/2026
// com o dia da semana ja conhecido (evita fc.date().toISOString(), que e flaky).
// Testes de propriedade sao puros (sem I/O), como os demais do dominio.

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  validateComplete,
  type RuleSetStructuralConfig,
  type ValidationInput,
} from './validationEngine';
import { SCHEMA_VERSION } from '../schemas/models';
import type {
  ApprovedRuleSet,
  Assignment,
  ExternalInput,
  Person,
  ScheduleDraft,
  Service,
  Unavailability,
  Weekday,
} from '../schemas/models';

// No minimo 100 execucoes (Notas do tasks.md). fast-check ja imprime seed e
// caminho de replay (replayPath) ao falhar, permitindo reproducao deterministica.
const RUNS = 200;

const NOW = '2026-02-01T12:00:00Z';

// --------------------------------------------------------------------------
// Calendario deterministico: fevereiro/2026 (datas civis reais e seus dias).
// Evita fc.date().toISOString(). Cada entrada e uma data valida do mes com o
// weekday gregoriano correto, pre-computado.
// --------------------------------------------------------------------------

interface CalDay {
  date: string;
  weekday: Weekday;
}

// Fevereiro de 2026: 01 = domingo.
const FEB_2026: readonly CalDay[] = [
  { date: '2026-02-01', weekday: 'sunday' },
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

const wednesdays = FEB_2026.filter((d) => d.weekday === 'wednesday');
const saturdays = FEB_2026.filter((d) => d.weekday === 'saturday');

// --------------------------------------------------------------------------
// Builders deterministicos (espelham os do teste unitario do engine).
// --------------------------------------------------------------------------

const ROLE_REGENTE = 'role-regente';
const ROLE_EQUIPE = 'role-equipe';
const ROLE_MENSAGEM = 'role-mensagem';
const ROLE_PREGADOR = 'role-pregador';
const ROLE_ANCIAO = 'role-anciao';

function person(
  id: string,
  caps: string[],
  weekdays: Person['allowedWeekdays'] = ['wednesday', 'saturday', 'sunday'],
): Person {
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

function service(
  id: string,
  date: string,
  weekday: Weekday,
  kind: Service['kind'] = 'regular',
): Service {
  return {
    schemaVersion: SCHEMA_VERSION,
    id,
    cycleId: 'cycle-1',
    date,
    computedWeekday: weekday,
    kind,
    externalInputIds: [],
  };
}

function assignment(
  id: string,
  serviceId: string,
  roleId: string,
  subjectId: string,
  type: 'person' | 'department' = 'person',
): Assignment {
  return { id, serviceId, roleId, subject: { type, id: subjectId }, source: 'manual' };
}

function draft(assignments: Assignment[] = []): ScheduleDraft {
  return {
    schemaVersion: SCHEMA_VERSION,
    cycleId: 'cycle-1',
    revision: 'a'.repeat(64),
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

function externalInput(
  id: string,
  serviceId: string,
  type: ExternalInput['type'],
  value: unknown,
): ExternalInput {
  return {
    schemaVersion: SCHEMA_VERSION,
    id,
    serviceId,
    type,
    value,
    visibility: 'public',
    source: 'teste',
    updatedAt: NOW,
    operatorId: 'op-1',
  };
}

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

function makeInput(overrides: Partial<ValidationInput>): ValidationInput {
  return {
    cycleId: 'cycle-1',
    draft: overrides.draft ?? draft(),
    services: overrides.services ?? [service('svc-1', '2026-02-04', 'wednesday')],
    externalInputs: overrides.externalInputs ?? [],
    unavailabilities: overrides.unavailabilities ?? [],
    people: overrides.people ?? [person('p-a', [ROLE_REGENTE])],
    departments: overrides.departments ?? [],
    ...(overrides.history !== undefined ? { history: overrides.history } : {}),
    ruleSet: overrides.ruleSet ?? ruleSet(),
    exceptions: overrides.exceptions ?? [],
    structural: overrides.structural ?? EMPTY_STRUCTURAL,
    ...(overrides.peopleWithPublicContact !== undefined
      ? { peopleWithPublicContact: overrides.peopleWithPublicContact }
      : {}),
    ...(overrides.privateObservationInputIds !== undefined
      ? { privateObservationInputIds: overrides.privateObservationInputIds }
      : {}),
  };
}

type Report = ReturnType<typeof validateComplete>;

/** Todos os achados (bloqueios + avisos) de um dado ruleId. */
function findingsOf(report: Report, ruleId: string): Report['blocking'] {
  return [...report.blocking, ...report.warnings].filter((f) => f.ruleId === ruleId);
}

function dayDiff(a: string, b: string): number {
  const da = Date.UTC(Number(a.slice(0, 4)), Number(a.slice(5, 7)) - 1, Number(a.slice(8, 10)));
  const db = Date.UTC(Number(b.slice(0, 4)), Number(b.slice(5, 7)) - 1, Number(b.slice(8, 10)));
  return Math.round((da - db) / 86_400_000);
}

// --------------------------------------------------------------------------
// 7.6 Duplicidade de data: N cultos distribuidos sobre K datas distintas.
// Oraculo: ocorrencias duplicadas = sum(max(0, count(date) - 1)).
// --------------------------------------------------------------------------

describe('Property 27 - 7.6 duplicidade de data', () => {
  it('produz exatamente um bloqueio por ocorrencia duplicada e identifica os cultos', () => {
    fc.assert(
      fc.property(
        // Para cada culto, o indice da data no calendario fixo.
        fc.array(fc.nat({ max: FEB_2026.length - 1 }), { minLength: 1, maxLength: 6 }),
        (dateIdx) => {
          const services = dateIdx.map((idx, i) => {
            const day = FEB_2026[idx] as CalDay;
            return service(`svc-${i}`, day.date, day.weekday);
          });

          const report = validateComplete(makeInput({ services, people: [], draft: draft() }));
          const found = findingsOf(report, 'estrutural:duplicidade-de-data');

          // Oraculo independente: contagem de duplicatas por data.
          const counts = new Map<string, number>();
          for (const s of services) counts.set(s.date, (counts.get(s.date) ?? 0) + 1);
          let expectedDuplicates = 0;
          for (const [, c] of counts) expectedDuplicates += Math.max(0, c - 1);

          expect(found.length).toBe(expectedDuplicates);
          // Severidade correta e referencia identifica os cultos envolvidos.
          for (const f of found) {
            expect(f.severity).toBe('blocking');
            expect(f.offendingReference).toContain('cultos:');
          }
        },
      ),
      { numRuns: RUNS },
    );
  });
});

// --------------------------------------------------------------------------
// 7.7 Identidade nao unica: atribuicao a pessoa (in)existente no cadastro.
// Oraculo: achado <=> o subject da atribuicao NAO consta no cadastro.
// --------------------------------------------------------------------------

describe('Property 27 - 7.7 identidade nao unica', () => {
  it('bloqueia exatamente quando o sujeito individual nao corresponde ao cadastro', () => {
    fc.assert(
      fc.property(fc.boolean(), (registered) => {
        const subjectId = registered ? 'p-a' : 'fantasma';
        const report = validateComplete(
          makeInput({
            services: [service('svc-1', '2026-02-04', 'wednesday')],
            people: [person('p-a', [ROLE_REGENTE])],
            draft: draft([assignment('a-1', 'svc-1', ROLE_REGENTE, subjectId)]),
          }),
        );
        const found = findingsOf(report, 'estrutural:identidade-nao-unica');
        expect(found.length).toBe(registered ? 0 : 1);
        for (const f of found) {
          expect(f.severity).toBe('blocking');
          expect(f.offendingReference).toContain('atribuicao: a-1');
        }
      }),
      { numRuns: RUNS },
    );
  });
});

// --------------------------------------------------------------------------
// 7.8 Tamanho da equipe de louvor (culto regular).
// Oraculo: achado <=> tamanho != exigido.
// --------------------------------------------------------------------------

describe('Property 27 - 7.8 tamanho da equipe de louvor', () => {
  it('bloqueia exatamente quando o tamanho difere do exigido', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 5 }), // tamanho real da equipe
        fc.integer({ min: 1, max: 5 }), // tamanho exigido
        (actual, required) => {
          const people = Array.from({ length: actual }, (_, i) => person(`p-${i}`, [ROLE_EQUIPE]));
          const assignments = Array.from({ length: actual }, (_, i) =>
            assignment(`a-${i}`, 'svc-1', ROLE_EQUIPE, `p-${i}`),
          );
          const report = validateComplete(
            makeInput({
              services: [service('svc-1', '2026-02-07', 'saturday')],
              people,
              draft: draft(assignments),
              structural: {
                ...EMPTY_STRUCTURAL,
                worshipTeamRoleIds: [ROLE_EQUIPE],
                worshipTeamSize: required,
              },
            }),
          );
          const found = findingsOf(report, 'estrutural:tamanho-de-equipe');
          expect(found.length).toBe(actual === required ? 0 : 1);
          for (const f of found) {
            expect(f.severity).toBe('blocking');
            expect(f.offendingReference).toBe(`tamanho: ${actual}`);
          }
        },
      ),
      { numRuns: RUNS },
    );
  });
});

// --------------------------------------------------------------------------
// 7.9 Composicao de genero da equipe de louvor (todos com genero declarado).
// Oraculo: achado <=> masc < minMale OU fem < minFemale.
// --------------------------------------------------------------------------

describe('Property 27 - 7.9 composicao de genero', () => {
  it('bloqueia exatamente quando a composicao fica abaixo do minimo', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 3 }), // homens
        fc.integer({ min: 0, max: 3 }), // mulheres
        fc.integer({ min: 0, max: 2 }), // minMale
        fc.integer({ min: 0, max: 2 }), // minFemale
        (males, females, minMale, minFemale) => {
          fc.pre(males + females >= 1); // equipe nao vazia (senao a verificacao se omite)
          const size = males + females;
          const people: Person[] = [];
          const assignments: Assignment[] = [];
          let idx = 0;
          for (let i = 0; i < males; i++, idx++) {
            people.push(person(`p-${idx}`, [ROLE_EQUIPE, 'gender:male']));
            assignments.push(assignment(`a-${idx}`, 'svc-1', ROLE_EQUIPE, `p-${idx}`));
          }
          for (let i = 0; i < females; i++, idx++) {
            people.push(person(`p-${idx}`, [ROLE_EQUIPE, 'gender:female']));
            assignments.push(assignment(`a-${idx}`, 'svc-1', ROLE_EQUIPE, `p-${idx}`));
          }
          const report = validateComplete(
            makeInput({
              services: [service('svc-1', '2026-02-07', 'saturday')],
              people,
              draft: draft(assignments),
              structural: {
                ...EMPTY_STRUCTURAL,
                worshipTeamRoleIds: [ROLE_EQUIPE],
                // Tamanho igual ao real para nao disparar 7.8 e isolar o genero.
                worshipTeamSize: size,
                worshipTeamGender: { minMale, minFemale },
              },
            }),
          );
          const found = findingsOf(report, 'estrutural:composicao-de-genero');
          const expected = males < minMale || females < minFemale;
          expect(found.length).toBe(expected ? 1 : 0);
          for (const f of found) {
            expect(f.severity).toBe('blocking');
            expect(f.offendingReference).toBe(`masc=${males}, fem=${females}`);
          }
          // Nao deve haver inconclusivo: todos tem genero declarado.
          expect(findingsOf(report, 'inconclusivo:team-gender')).toHaveLength(0);
        },
      ),
      { numRuns: RUNS },
    );
  });
});

// --------------------------------------------------------------------------
// 7.10 Funcao propria de louvor na quarta-feira.
// Oraculo: achado por atribuicao com funcao proibida num culto de quarta.
// --------------------------------------------------------------------------

describe('Property 27 - 7.10 funcao propria de louvor na quarta', () => {
  it('bloqueia exatamente as atribuicoes proibidas em cultos de quarta', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<Weekday>('wednesday', 'saturday', 'sunday'),
        fc.boolean(), // usa funcao proibida?
        (weekday, forbiddenRole) => {
          const day =
            weekday === 'wednesday'
              ? (wednesdays[0] as CalDay)
              : weekday === 'saturday'
                ? (saturdays[0] as CalDay)
                : (FEB_2026[0] as CalDay);
          const roleUsed = forbiddenRole ? ROLE_EQUIPE : ROLE_REGENTE;
          const report = validateComplete(
            makeInput({
              services: [service('svc-1', day.date, weekday)],
              people: [person('p-a', [roleUsed])],
              draft: draft([assignment('a-1', 'svc-1', roleUsed, 'p-a')]),
              structural: {
                ...EMPTY_STRUCTURAL,
                wednesdayForbiddenWorshipRoleIds: [ROLE_EQUIPE],
              },
            }),
          );
          const found = findingsOf(report, 'estrutural:quarta-funcao-propria');
          const expected = weekday === 'wednesday' && forbiddenRole;
          expect(found.length).toBe(expected ? 1 : 0);
          for (const f of found) {
            expect(f.severity).toBe('blocking');
            expect(f.offendingReference).toContain('atribuicao: a-1');
          }
        },
      ),
      { numRuns: RUNS },
    );
  });
});

// --------------------------------------------------------------------------
// 7.11 Dado externo obrigatorio ausente na quarta.
// Oraculo: um achado por tipo exigido ausente (somente em quarta).
// --------------------------------------------------------------------------

const EXTERNAL_TYPES: readonly ExternalInput['type'][] = [
  'elder',
  'preacher',
  'audio',
  'sabbath-school-song',
  'theme',
  'song-request',
];

describe('Property 27 - 7.11 dado externo obrigatorio na quarta', () => {
  it('bloqueia exatamente os tipos obrigatorios ausentes, identificando cada um', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.constantFrom(...EXTERNAL_TYPES), { minLength: 1, maxLength: 4 }),
        fc.uniqueArray(fc.constantFrom(...EXTERNAL_TYPES), { maxLength: 4 }),
        fc.boolean(), // quarta?
        (required, present, isWednesday) => {
          const day = isWednesday ? (wednesdays[0] as CalDay) : (saturdays[0] as CalDay);
          const weekday: Weekday = isWednesday ? 'wednesday' : 'saturday';
          const inputs = present.map((t, i) =>
            externalInput(`ext-${i}`, 'svc-1', t, { text: 'x' }),
          );
          const report = validateComplete(
            makeInput({
              services: [service('svc-1', day.date, weekday)],
              externalInputs: inputs,
              people: [],
              draft: draft(),
              structural: { ...EMPTY_STRUCTURAL, wednesdayRequiredExternalTypes: required },
            }),
          );
          const found = findingsOf(report, 'estrutural:quarta-insumo-obrigatorio');

          const presentSet = new Set(present);
          const expectedMissing = isWednesday
            ? required.filter((t) => !presentSet.has(t))
            : [];
          expect(found.length).toBe(expectedMissing.length);
          const foundFields = found.map((f) => f.roleOrField).sort();
          expect(foundFields).toEqual(expectedMissing.map((t) => `external.${t}`).sort());
          for (const f of found) expect(f.severity).toBe('blocking');
        },
      ),
      { numRuns: RUNS },
    );
  });
});

// --------------------------------------------------------------------------
// 7.12 Mensagens musicais no sabado.
// Oraculo: achado <=> count < exigido (somente em sabado).
// --------------------------------------------------------------------------

describe('Property 27 - 7.12 mensagens de sabado', () => {
  it('bloqueia exatamente quando faltam mensagens no sabado', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 4 }), // mensagens presentes
        fc.integer({ min: 1, max: 3 }), // exigidas
        fc.boolean(), // sabado?
        (count, required, isSaturday) => {
          const day = isSaturday ? (saturdays[0] as CalDay) : (wednesdays[0] as CalDay);
          const weekday: Weekday = isSaturday ? 'saturday' : 'wednesday';
          const people = Array.from({ length: count }, (_, i) =>
            person(`p-${i}`, [ROLE_MENSAGEM]),
          );
          const assignments = Array.from({ length: count }, (_, i) =>
            assignment(`a-${i}`, 'svc-1', ROLE_MENSAGEM, `p-${i}`),
          );
          const report = validateComplete(
            makeInput({
              services: [service('svc-1', day.date, weekday)],
              people,
              draft: draft(assignments),
              structural: {
                ...EMPTY_STRUCTURAL,
                musicalMessageRoleIds: [ROLE_MENSAGEM],
                saturdayRequiredMessageCount: required,
              },
            }),
          );
          const found = findingsOf(report, 'estrutural:sabado-mensagens');
          const expected = isSaturday && count < required;
          expect(found.length).toBe(expected ? 1 : 0);
          for (const f of found) {
            expect(f.severity).toBe('blocking');
            expect(f.offendingReference).toBe(`mensagens presentes: ${count}`);
          }
        },
      ),
      { numRuns: RUNS },
    );
  });
});

// --------------------------------------------------------------------------
// 7.13 Indisponibilidade na data da atribuicao.
// Oraculo: achado <=> a pessoa esta indisponivel na data do culto atribuido.
// --------------------------------------------------------------------------

describe('Property 27 - 7.13 indisponibilidade', () => {
  it('bloqueia exatamente quando a pessoa esta indisponivel na data', () => {
    fc.assert(
      fc.property(
        fc.nat({ max: wednesdays.length - 1 }), // data do culto
        fc.nat({ max: wednesdays.length - 1 }), // data indisponivel
        (svcIdx, unavIdx) => {
          const svcDay = wednesdays[svcIdx] as CalDay;
          const unavDay = wednesdays[unavIdx] as CalDay;
          const unav: Unavailability = {
            schemaVersion: SCHEMA_VERSION,
            id: 'u-1',
            cycleId: 'cycle-1',
            personId: 'p-a',
            scope: { type: 'dates', dates: [unavDay.date] },
            source: 'teste',
            createdAt: NOW,
          };
          const report = validateComplete(
            makeInput({
              services: [service('svc-1', svcDay.date, 'wednesday')],
              people: [person('p-a', [ROLE_REGENTE])],
              draft: draft([assignment('a-1', 'svc-1', ROLE_REGENTE, 'p-a')]),
              unavailabilities: [unav],
            }),
          );
          const found = findingsOf(report, 'estrutural:indisponibilidade');
          expect(found.length).toBe(svcDay.date === unavDay.date ? 1 : 0);
          for (const f of found) {
            expect(f.severity).toBe('blocking');
            expect(f.offendingReference).toContain('atribuicao: a-1');
          }
        },
      ),
      { numRuns: RUNS },
    );
  });
});

// --------------------------------------------------------------------------
// 7.14 Funcoes incompativeis no mesmo culto (mesmo sujeito).
// Oraculo: achado <=> o mesmo sujeito ocupa AMBAS as funcoes do par.
// --------------------------------------------------------------------------

describe('Property 27 - 7.14 funcoes incompativeis', () => {
  it('bloqueia exatamente quando o mesmo sujeito ocupa o par incompativel', () => {
    fc.assert(
      fc.property(
        fc.boolean(), // mesma pessoa nas duas funcoes?
        (samePerson) => {
          const people = [person('p-a', [ROLE_REGENTE, ROLE_PREGADOR]), person('p-b', [ROLE_PREGADOR])];
          const assignments = [
            assignment('a-1', 'svc-1', ROLE_REGENTE, 'p-a'),
            assignment('a-2', 'svc-1', ROLE_PREGADOR, samePerson ? 'p-a' : 'p-b'),
          ];
          const report = validateComplete(
            makeInput({
              services: [service('svc-1', '2026-02-04', 'wednesday')],
              people,
              draft: draft(assignments),
              structural: {
                ...EMPTY_STRUCTURAL,
                incompatibleRolePairs: [[ROLE_REGENTE, ROLE_PREGADOR]],
              },
            }),
          );
          const found = findingsOf(report, 'estrutural:incompatibilidade');
          expect(found.length).toBe(samePerson ? 1 : 0);
          for (const f of found) {
            expect(f.severity).toBe('blocking');
            expect(f.offendingReference).toContain('sujeito: p-a');
          }
        },
      ),
      { numRuns: RUNS },
    );
  });
});

// --------------------------------------------------------------------------
// 7.15 Funcao externa conflita com funcao propria do louvor (sem excecao).
// Oraculo: achado <=> o mesmo sujeito ocupa funcao externa E propria do louvor.
// (Sem excecoes geradas: o conflito nunca e suprimido.)
// --------------------------------------------------------------------------

describe('Property 27 - 7.15 externo vs funcao propria do louvor', () => {
  it('bloqueia exatamente quando ha funcao externa e propria no mesmo sujeito', () => {
    fc.assert(
      fc.property(
        fc.boolean(), // adiciona a funcao propria do louvor ao mesmo sujeito?
        (conflict) => {
          const assignments = [assignment('a-1', 'svc-1', ROLE_ANCIAO, 'p-a')];
          if (conflict) assignments.push(assignment('a-2', 'svc-1', ROLE_REGENTE, 'p-a'));
          const report = validateComplete(
            makeInput({
              services: [service('svc-1', '2026-02-04', 'wednesday')],
              people: [person('p-a', [ROLE_ANCIAO, ROLE_REGENTE])],
              draft: draft(assignments),
              structural: {
                ...EMPTY_STRUCTURAL,
                externalRoleIds: [ROLE_ANCIAO],
                ownWorshipRoleIds: [ROLE_REGENTE],
              },
            }),
          );
          const found = findingsOf(report, 'estrutural:externo-vs-louvor');
          expect(found.length).toBe(conflict ? 1 : 0);
          for (const f of found) {
            expect(f.severity).toBe('blocking');
            expect(f.offendingReference).toContain('sujeito: p-a');
          }
        },
      ),
      { numRuns: RUNS },
    );
  });
});

// --------------------------------------------------------------------------
// 7.16 Habilitacao ausente ou dia nao permitido.
// Oraculo: achado <=> (NAO habilitado) OU (dia da semana nao permitido).
// --------------------------------------------------------------------------

describe('Property 27 - 7.16 habilitacao ou dia nao permitido', () => {
  it('bloqueia exatamente quando falta habilitacao ou o dia nao e permitido', () => {
    fc.assert(
      fc.property(
        fc.boolean(), // habilitado para a funcao?
        fc.constantFrom<Weekday>('wednesday', 'saturday', 'sunday'), // dia do culto
        fc.uniqueArray(fc.constantFrom<Weekday>('wednesday', 'saturday', 'sunday'), {
          minLength: 1,
          maxLength: 3,
        }), // dias permitidos pelo cadastro
        (capable, weekday, allowed) => {
          const day =
            weekday === 'wednesday'
              ? (wednesdays[0] as CalDay)
              : weekday === 'saturday'
                ? (saturdays[0] as CalDay)
                : (FEB_2026[0] as CalDay);
          const caps = capable ? [ROLE_REGENTE] : ['cap-outra'];
          const report = validateComplete(
            makeInput({
              services: [service('svc-1', day.date, weekday)],
              people: [person('p-a', caps, allowed)],
              draft: draft([assignment('a-1', 'svc-1', ROLE_REGENTE, 'p-a')]),
            }),
          );
          const found = findingsOf(report, 'estrutural:habilitacao-ou-dia');
          const weekdayAllowed = allowed.includes(weekday);
          const expected = !capable || !weekdayAllowed;
          expect(found.length).toBe(expected ? 1 : 0);
          for (const f of found) {
            expect(f.severity).toBe('blocking');
            expect(f.offendingReference).toContain('atribuicao: a-1');
          }
        },
      ),
      { numRuns: RUNS },
    );
  });
});

// --------------------------------------------------------------------------
// 7.17 Regra de sequencia entre cultos (severidade definida pela versao).
// Oraculo: achado por atribuicao cuja funcao casa com a regra e que tenha outra
// data (da mesma funcao/sujeito) a menos de minGapDays.
// --------------------------------------------------------------------------

describe('Property 27 - 7.17 sequencia entre cultos', () => {
  it('produz achados com a severidade da regra exatamente para datas proximas', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.nat({ max: FEB_2026.length - 1 }), { minLength: 1, maxLength: 4 }),
        fc.integer({ min: 2, max: 30 }), // minGapDays
        fc.constantFrom<'blocking' | 'warning'>('blocking', 'warning'),
        (dateIdx, minGapDays, severity) => {
          const days = dateIdx.map((i) => FEB_2026[i] as CalDay);
          const services = days.map((d, i) => service(`svc-${i}`, d.date, d.weekday));
          const assignments = days.map((_, i) =>
            assignment(`a-${i}`, `svc-${i}`, ROLE_REGENTE, 'p-a'),
          );
          const report = validateComplete(
            makeInput({
              services,
              people: [person('p-a', [ROLE_REGENTE])],
              draft: draft(assignments),
              structural: {
                ...EMPTY_STRUCTURAL,
                sequenceRules: [{ ruleId: 'seq-1', roleId: ROLE_REGENTE, minGapDays, severity }],
              },
            }),
          );
          const found = findingsOf(report, 'seq-1');

          // Oraculo: por culto, existe outra data (da mesma funcao) proxima?
          const allDates = days.map((d) => d.date);
          let expectedCount = 0;
          for (const d of allDates) {
            const tooClose = allDates.some(
              (o) => o !== d && Math.abs(dayDiff(o, d)) < minGapDays,
            );
            if (tooClose) expectedCount += 1;
          }
          expect(found.length).toBe(expectedCount);
          for (const f of found) {
            expect(f.severity).toBe(severity);
            expect(f.roleOrField).toBe(ROLE_REGENTE);
          }
        },
      ),
      { numRuns: RUNS },
    );
  });
});

// --------------------------------------------------------------------------
// 7.18 Limite mensal de mensagem musical por pessoa.
// Oraculo: um achado por sujeito cujo total de mensagens > limite.
// --------------------------------------------------------------------------

describe('Property 27 - 7.18 limite mensal de mensagem', () => {
  it('bloqueia exatamente os sujeitos que ultrapassam o limite mensal', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 5 }), // mensagens de p-a
        fc.integer({ min: 0, max: 5 }), // mensagens de p-b
        fc.integer({ min: 1, max: 4 }), // limite
        (countA, countB, limit) => {
          // Usa sabados distintos, um culto por mensagem, respeitando datas unicas.
          const saturdayDates = saturdays.map((d) => d.date);
          const services: Service[] = [];
          const assignments: Assignment[] = [];
          let svcCounter = 0;
          const addMessages = (personId: string, n: number): void => {
            for (let i = 0; i < n; i++) {
              const date = saturdayDates[svcCounter % saturdayDates.length] as string;
              // Garante datas unicas combinando o contador no id do culto e usando
              // datas distintas enquanto possivel; duplicidade de data nao afeta 7.18.
              const sid = `svc-${svcCounter}`;
              services.push(service(sid, date, 'saturday'));
              assignments.push(assignment(`a-${svcCounter}`, sid, ROLE_MENSAGEM, personId));
              svcCounter += 1;
            }
          };
          addMessages('p-a', countA);
          addMessages('p-b', countB);

          const report = validateComplete(
            makeInput({
              services:
                services.length > 0 ? services : [service('svc-x', '2026-02-07', 'saturday')],
              people: [person('p-a', [ROLE_MENSAGEM]), person('p-b', [ROLE_MENSAGEM])],
              draft: draft(assignments),
              structural: {
                ...EMPTY_STRUCTURAL,
                musicalMessageRoleIds: [ROLE_MENSAGEM],
                monthlyMessageLimit: limit,
              },
            }),
          );
          const found = findingsOf(report, 'estrutural:limite-mensal-mensagem');

          let expected = 0;
          if (countA > limit) expected += 1;
          if (countB > limit) expected += 1;
          expect(found.length).toBe(expected);
          for (const f of found) {
            expect(f.severity).toBe('blocking');
            expect(f.offendingReference).toMatch(/^sujeito: p-[ab]$/);
          }
        },
      ),
      { numRuns: RUNS },
    );
  });
});
