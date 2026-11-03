// Testes unitarios do ValidationEngine puro (tarefa 8.1).
//
// Cobrem a validacao objetiva da tarefa 8.1 (requirements.md, Requisito 7 e
// 4.15, 12.4, 12.13, 14.5):
//  - catalogo completo de achados (7.6-7.22): duplicidade, identidade, equipes,
//    quartas, sabados, externos, indisponibilidade, incompatibilidade,
//    sequencia, limites, departamento, privacidade e contato;
//  - RF violada => Bloqueio; Preferencia nao atendida => Aviso (7.4/7.5);
//  - validacao INCREMENTAL e COMPLETA produzem o MESMO conjunto (7.1/14.5);
//  - verificacao inconclusiva vira BLOQUEIO (7.25) e nenhuma entrada e
//    modificada (12.13/12.4 - pureza);
//  - referencia segura: o conteudo privado NUNCA aparece no achado (7.20);
//  - relatorio consistente: bloqueios/avisos disjuntos, revisao/versao e totais
//    (7.24); gate de publicacao depende da revisao atual (7.23).
//
// Sem mocks: usa os modelos canonicos reais e fixtures deterministicas, como os
// demais testes do dominio.

import { describe, expect, it } from 'vitest';
import {
  canPublish,
  runAllChecks,
  validateComplete,
  validateIncremental,
  type RuleSetStructuralConfig,
  type ValidationInput,
  type ValidatedField,
} from './validationEngine';
import { field, lit } from '../rules/predicate';
import { SCHEMA_VERSION } from '../schemas/models';
import type {
  ApprovedException,
  ApprovedRuleSet,
  Assignment,
  Department,
  ExternalInput,
  Person,
  Rule,
  ScheduleDraft,
  Service,
  Unavailability,
} from '../schemas/models';

// --------------------------------------------------------------------------
// Builders deterministicos
// --------------------------------------------------------------------------

const NOW = '2026-02-01T12:00:00Z';

const ROLE_REGENTE = 'role-regente';
const ROLE_EQUIPE = 'role-equipe';
const ROLE_MENSAGEM = 'role-mensagem';
const ROLE_PREGADOR = 'role-pregador';
const ROLE_ANCIAO = 'role-anciao';

function person(
  id: string,
  caps: string[],
  weekdays: Person['allowedWeekdays'] = ['wednesday', 'saturday', 'sunday'],
  participation: Person['participation'] = 'active',
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

function department(id: string, status: Department['status'] = 'active'): Department {
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

function service(
  id: string,
  date: string,
  weekday: Service['computedWeekday'],
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

function ruleSet(rules: Rule[] = []): ApprovedRuleSet {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: 'rs-1',
    version: 'v1',
    status: 'approved',
    validFrom: '2026-02-01',
    validUntil: '2026-02-28',
    rules,
    sourceDecisions: [],
    approvedBy: 'op-1',
    approvedAt: NOW,
    createdAt: NOW,
  };
}

function observationInput(
  id: string,
  serviceId: string,
  visibility: ExternalInput['visibility'],
  value: unknown,
): ExternalInput {
  return {
    schemaVersion: SCHEMA_VERSION,
    id,
    serviceId,
    type: 'observation',
    value,
    visibility,
    source: 'teste',
    updatedAt: NOW,
    operatorId: 'op-1',
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

function makeInput(overrides: Partial<ValidationInput> = {}): ValidationInput {
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

function reasons(report: ReturnType<typeof validateComplete>): string[] {
  return [...report.blocking, ...report.warnings].map((f) => f.ruleId);
}

// --------------------------------------------------------------------------
// 7.24 / Property 29: relatorio consistente
// --------------------------------------------------------------------------

describe('ValidationEngine - relatorio consistente (7.24)', () => {
  it('identifica revisao e versao de regras e separa bloqueios de avisos', () => {
    const report = validateComplete(makeInput());
    expect(report.status).toBe('complete');
    expect(report.draftRevision).toBe('a'.repeat(64));
    expect(report.ruleSetVersion).toBe('v1');
    expect(report.cycleId).toBe('cycle-1');
    // Conjuntos disjuntos por severidade.
    expect(report.blocking.every((f) => f.severity === 'blocking')).toBe(true);
    expect(report.warnings.every((f) => f.severity === 'warning')).toBe(true);
  });

  it('passedCount conta as verificacoes aplicadas sem achado', () => {
    const report = validateComplete(makeInput());
    expect(report.blocking).toHaveLength(0);
    expect(report.warnings).toHaveLength(0);
    // Sem achados => todas as 18 verificacoes do catalogo foram aprovadas.
    expect(report.passedCount).toBe(18);
  });

  it('o relatorio e deterministico: mesma entrada => mesmo reportId e findingIds', () => {
    const input = makeInput({
      services: [service('svc-1', '2026-02-04', 'wednesday'), service('svc-2', '2026-02-04', 'wednesday')],
    });
    const r1 = validateComplete(input);
    const r2 = validateComplete(input);
    expect(r1.reportId).toBe(r2.reportId);
    expect(r1.blocking.map((f) => f.findingId)).toEqual(r2.blocking.map((f) => f.findingId));
  });
});

// --------------------------------------------------------------------------
// 12.13 / 12.4: pureza - nenhuma entrada e modificada
// --------------------------------------------------------------------------

describe('ValidationEngine - pureza (12.13/12.4)', () => {
  it('nao modifica nenhuma colecao de entrada', () => {
    const input = makeInput({
      draft: draft([assignment('a-1', 'svc-1', ROLE_REGENTE, 'p-a')]),
      services: [service('svc-1', '2026-02-04', 'wednesday')],
      people: [person('p-a', [ROLE_REGENTE])],
    });
    const snapshotDraft = structuredClone(input.draft);
    const snapshotServices = structuredClone(input.services);
    const snapshotPeople = structuredClone(input.people);
    validateComplete(input);
    expect(input.draft).toEqual(snapshotDraft);
    expect(input.services).toEqual(snapshotServices);
    expect(input.people).toEqual(snapshotPeople);
  });
});

// --------------------------------------------------------------------------
// 7.6 Data duplicada
// --------------------------------------------------------------------------

describe('ValidationEngine - 7.6 duplicidade de data', () => {
  it('bloqueia cada ocorrencia duplicada e identifica os cultos envolvidos', () => {
    const report = validateComplete(
      makeInput({
        services: [
          service('svc-1', '2026-02-04', 'wednesday'),
          service('svc-2', '2026-02-04', 'wednesday'),
          service('svc-3', '2026-02-04', 'wednesday'),
        ],
      }),
    );
    const dup = report.blocking.filter((f) => f.ruleId === 'estrutural:duplicidade-de-data');
    // 3 cultos na mesma data => 2 ocorrencias duplicadas.
    expect(dup).toHaveLength(2);
    expect(dup[0]?.offendingReference).toContain('svc-1');
  });

  it('nao bloqueia quando cada data e unica', () => {
    const report = validateComplete(
      makeInput({
        services: [
          service('svc-1', '2026-02-04', 'wednesday'),
          service('svc-2', '2026-02-07', 'saturday'),
        ],
      }),
    );
    expect(report.blocking.filter((f) => f.ruleId === 'estrutural:duplicidade-de-data')).toHaveLength(0);
  });
});

// --------------------------------------------------------------------------
// 7.7 Identidade nao unica
// --------------------------------------------------------------------------

describe('ValidationEngine - 7.7 identidade nao unica', () => {
  it('bloqueia atribuicao a pessoa inexistente no cadastro', () => {
    const report = validateComplete(
      makeInput({
        draft: draft([assignment('a-1', 'svc-1', ROLE_REGENTE, 'fantasma')]),
        people: [],
      }),
    );
    expect(reasons(report)).toContain('estrutural:identidade-nao-unica');
  });
});

// --------------------------------------------------------------------------
// 7.8 / 7.9 equipes
// --------------------------------------------------------------------------

describe('ValidationEngine - 7.8/7.9 equipes de louvor', () => {
  const structural: RuleSetStructuralConfig = {
    ...EMPTY_STRUCTURAL,
    worshipTeamRoleIds: [ROLE_EQUIPE],
    worshipTeamSize: 2,
    worshipTeamGender: { minMale: 1, minFemale: 1 },
  };

  it('7.8 bloqueia quando a equipe tem tamanho diferente do exigido', () => {
    const report = validateComplete(
      makeInput({
        services: [service('svc-1', '2026-02-07', 'saturday')],
        people: [person('p-a', [ROLE_EQUIPE])],
        draft: draft([assignment('a-1', 'svc-1', ROLE_EQUIPE, 'p-a')]),
        structural,
      }),
    );
    expect(reasons(report)).toContain('estrutural:tamanho-de-equipe');
  });

  it('7.9 bloqueia quando a composicao de genero nao atende ao minimo', () => {
    const report = validateComplete(
      makeInput({
        services: [service('svc-1', '2026-02-07', 'saturday')],
        people: [
          person('p-a', [ROLE_EQUIPE, 'gender:male']),
          person('p-b', [ROLE_EQUIPE, 'gender:male']),
        ],
        draft: draft([
          assignment('a-1', 'svc-1', ROLE_EQUIPE, 'p-a'),
          assignment('a-2', 'svc-1', ROLE_EQUIPE, 'p-b'),
        ]),
        structural,
      }),
    );
    // Tamanho ok (2), mas sem nenhuma mulher.
    expect(reasons(report)).toContain('estrutural:composicao-de-genero');
    expect(reasons(report)).not.toContain('estrutural:tamanho-de-equipe');
  });

  it('7.25 genero ausente torna a verificacao de genero inconclusiva (Bloqueio)', () => {
    const report = validateComplete(
      makeInput({
        services: [service('svc-1', '2026-02-07', 'saturday')],
        people: [person('p-a', [ROLE_EQUIPE]), person('p-b', [ROLE_EQUIPE])],
        draft: draft([
          assignment('a-1', 'svc-1', ROLE_EQUIPE, 'p-a'),
          assignment('a-2', 'svc-1', ROLE_EQUIPE, 'p-b'),
        ]),
        structural,
      }),
    );
    expect(report.blocking.some((f) => f.ruleId === 'inconclusivo:team-gender')).toBe(true);
  });
});

// --------------------------------------------------------------------------
// 7.10 / 7.11 quarta-feira
// --------------------------------------------------------------------------

describe('ValidationEngine - 7.10/7.11 quarta-feira', () => {
  it('7.10 bloqueia funcao propria de louvor na quarta', () => {
    const report = validateComplete(
      makeInput({
        services: [service('svc-1', '2026-02-04', 'wednesday')],
        people: [person('p-a', [ROLE_EQUIPE])],
        draft: draft([assignment('a-1', 'svc-1', ROLE_EQUIPE, 'p-a')]),
        structural: { ...EMPTY_STRUCTURAL, wednesdayForbiddenWorshipRoleIds: [ROLE_EQUIPE] },
      }),
    );
    expect(reasons(report)).toContain('estrutural:quarta-funcao-propria');
  });

  it('7.11 bloqueia e identifica cada insumo externo obrigatorio ausente', () => {
    const report = validateComplete(
      makeInput({
        services: [service('svc-1', '2026-02-04', 'wednesday')],
        structural: {
          ...EMPTY_STRUCTURAL,
          wednesdayRequiredExternalTypes: ['preacher', 'theme'],
        },
      }),
    );
    const missing = report.blocking.filter(
      (f) => f.ruleId === 'estrutural:quarta-insumo-obrigatorio',
    );
    expect(missing).toHaveLength(2);
    expect(missing.map((f) => f.roleOrField).sort()).toEqual([
      'external.preacher',
      'external.theme',
    ]);
  });
});

// --------------------------------------------------------------------------
// 7.12 sabado mensagens
// --------------------------------------------------------------------------

describe('ValidationEngine - 7.12 mensagens de sabado', () => {
  it('bloqueia quando faltam mensagens musicais no sabado', () => {
    const report = validateComplete(
      makeInput({
        services: [service('svc-1', '2026-02-07', 'saturday')],
        people: [person('p-a', [ROLE_MENSAGEM])],
        draft: draft([assignment('a-1', 'svc-1', ROLE_MENSAGEM, 'p-a')]),
        structural: {
          ...EMPTY_STRUCTURAL,
          musicalMessageRoleIds: [ROLE_MENSAGEM],
          saturdayRequiredMessageCount: 2,
        },
      }),
    );
    expect(reasons(report)).toContain('estrutural:sabado-mensagens');
  });
});

// --------------------------------------------------------------------------
// 7.13 indisponibilidade
// --------------------------------------------------------------------------

describe('ValidationEngine - 7.13 indisponibilidade', () => {
  it('bloqueia a atribuicao de pessoa indisponivel na data', () => {
    const unav: Unavailability = {
      schemaVersion: SCHEMA_VERSION,
      id: 'u-1',
      cycleId: 'cycle-1',
      personId: 'p-a',
      scope: { type: 'dates', dates: ['2026-02-04'] },
      source: 'teste',
      createdAt: NOW,
    };
    const report = validateComplete(
      makeInput({
        services: [service('svc-1', '2026-02-04', 'wednesday')],
        draft: draft([assignment('a-1', 'svc-1', ROLE_REGENTE, 'p-a')]),
        unavailabilities: [unav],
      }),
    );
    expect(reasons(report)).toContain('estrutural:indisponibilidade');
  });
});

// --------------------------------------------------------------------------
// 7.14 incompatibilidade
// --------------------------------------------------------------------------

describe('ValidationEngine - 7.14 funcoes incompativeis', () => {
  it('bloqueia a mesma pessoa em funcoes incompativeis no mesmo culto', () => {
    const report = validateComplete(
      makeInput({
        services: [service('svc-1', '2026-02-04', 'wednesday')],
        people: [person('p-a', [ROLE_REGENTE, ROLE_PREGADOR])],
        draft: draft([
          assignment('a-1', 'svc-1', ROLE_REGENTE, 'p-a'),
          assignment('a-2', 'svc-1', ROLE_PREGADOR, 'p-a'),
        ]),
        structural: { ...EMPTY_STRUCTURAL, incompatibleRolePairs: [[ROLE_REGENTE, ROLE_PREGADOR]] },
      }),
    );
    expect(reasons(report)).toContain('estrutural:incompatibilidade');
  });
});

// --------------------------------------------------------------------------
// 7.15 externo vs louvor + excecao
// --------------------------------------------------------------------------

describe('ValidationEngine - 7.15 externo vs funcao propria do louvor', () => {
  const structural: RuleSetStructuralConfig = {
    ...EMPTY_STRUCTURAL,
    externalRoleIds: [ROLE_ANCIAO],
    ownWorshipRoleIds: [ROLE_REGENTE],
  };

  function conflictInput(exceptions: ApprovedException[] = []): ValidationInput {
    return makeInput({
      services: [service('svc-1', '2026-02-04', 'wednesday')],
      people: [person('p-a', [ROLE_ANCIAO, ROLE_REGENTE])],
      draft: draft([
        assignment('a-1', 'svc-1', ROLE_ANCIAO, 'p-a'),
        assignment('a-2', 'svc-1', ROLE_REGENTE, 'p-a'),
      ]),
      structural,
      exceptions,
    });
  }

  it('bloqueia quando nao ha excecao vigente', () => {
    const report = validateComplete(conflictInput());
    expect(reasons(report)).toContain('estrutural:externo-vs-louvor');
  });

  it('nao bloqueia quando ha Excecao_Aprovada vigente e aplicavel', () => {
    const exc: ApprovedException = {
      schemaVersion: SCHEMA_VERSION,
      id: 'exc-1',
      fundamentalRuleId: 'estrutural:externo-vs-louvor',
      condition: { op: 'true' },
      validFrom: '2026-02-01',
      validUntil: '2026-02-28',
      justification: 'excecao vigente',
      approvedBy: 'op-1',
      approvedAt: NOW,
    };
    const report = validateComplete(conflictInput([exc]));
    expect(reasons(report)).not.toContain('estrutural:externo-vs-louvor');
  });
});

// --------------------------------------------------------------------------
// 7.16 habilitacao / dia
// --------------------------------------------------------------------------

describe('ValidationEngine - 7.16 habilitacao ou dia nao permitido', () => {
  it('bloqueia habilitacao ausente', () => {
    const report = validateComplete(
      makeInput({
        people: [person('p-a', ['cap-outra'])],
        draft: draft([assignment('a-1', 'svc-1', ROLE_REGENTE, 'p-a')]),
      }),
    );
    expect(reasons(report)).toContain('estrutural:habilitacao-ou-dia');
  });

  it('bloqueia dia da semana nao permitido', () => {
    const report = validateComplete(
      makeInput({
        services: [service('svc-1', '2026-02-04', 'wednesday')],
        people: [person('p-a', [ROLE_REGENTE], ['saturday'])],
        draft: draft([assignment('a-1', 'svc-1', ROLE_REGENTE, 'p-a')]),
      }),
    );
    expect(reasons(report)).toContain('estrutural:habilitacao-ou-dia');
  });
});

// --------------------------------------------------------------------------
// 7.17 sequencia (severidade definida pela regra)
// --------------------------------------------------------------------------

describe('ValidationEngine - 7.17 sequencia entre cultos', () => {
  it('registra a severidade definida pela regra (aviso) para datas proximas', () => {
    const report = validateComplete(
      makeInput({
        services: [
          service('svc-1', '2026-02-04', 'wednesday'),
          service('svc-2', '2026-02-07', 'saturday'),
        ],
        people: [person('p-a', [ROLE_REGENTE])],
        draft: draft([
          assignment('a-1', 'svc-1', ROLE_REGENTE, 'p-a'),
          assignment('a-2', 'svc-2', ROLE_REGENTE, 'p-a'),
        ]),
        structural: {
          ...EMPTY_STRUCTURAL,
          sequenceRules: [{ ruleId: 'seq-1', roleId: ROLE_REGENTE, minGapDays: 7, severity: 'warning' }],
        },
      }),
    );
    expect(report.warnings.some((f) => f.ruleId === 'seq-1')).toBe(true);
  });
});

// --------------------------------------------------------------------------
// 7.18 limite mensal de mensagem musical
// --------------------------------------------------------------------------

describe('ValidationEngine - 7.18 limite mensal de mensagem', () => {
  it('bloqueia quando o sujeito ultrapassa o limite e informa o limite', () => {
    const report = validateComplete(
      makeInput({
        services: [
          service('svc-1', '2026-02-07', 'saturday'),
          service('svc-2', '2026-02-14', 'saturday'),
        ],
        people: [person('p-a', [ROLE_MENSAGEM])],
        draft: draft([
          assignment('a-1', 'svc-1', ROLE_MENSAGEM, 'p-a'),
          assignment('a-2', 'svc-2', ROLE_MENSAGEM, 'p-a'),
        ]),
        structural: {
          ...EMPTY_STRUCTURAL,
          musicalMessageRoleIds: [ROLE_MENSAGEM],
          monthlyMessageLimit: 1,
        },
      }),
    );
    const f = report.blocking.find((x) => x.ruleId === 'estrutural:limite-mensal-mensagem');
    expect(f).toBeDefined();
    expect(f?.reason).toContain('2 de 1');
  });
});

// --------------------------------------------------------------------------
// 7.19 departamento no louvor
// --------------------------------------------------------------------------

describe('ValidationEngine - 7.19 responsabilidade departamental no louvor', () => {
  const structural: RuleSetStructuralConfig = {
    ...EMPTY_STRUCTURAL,
    departmentWorshipRequiredRoleIds: [ROLE_REGENTE],
    preacherRoleId: ROLE_PREGADOR,
  };

  it('bloqueia quando o campo obrigatorio da regra departamental esta ausente', () => {
    const report = validateComplete(
      makeInput({
        services: [service('svc-1', '2026-02-07', 'saturday')],
        departments: [department('dep-1')],
        externalInputs: [
          externalInput('ext-1', 'svc-1', 'preacher', { subject: { type: 'department', id: 'dep-1' } }),
        ],
        draft: draft([]),
        structural,
      }),
    );
    expect(reasons(report)).toContain('estrutural:departamento-louvor');
  });

  it('nao bloqueia quando a funcao obrigatoria e atribuida ao mesmo Departamento', () => {
    const report = validateComplete(
      makeInput({
        services: [service('svc-1', '2026-02-07', 'saturday')],
        departments: [department('dep-1')],
        externalInputs: [
          externalInput('ext-1', 'svc-1', 'preacher', { subject: { type: 'department', id: 'dep-1' } }),
        ],
        draft: draft([assignment('a-1', 'svc-1', ROLE_REGENTE, 'dep-1', 'department')]),
        structural,
      }),
    );
    expect(reasons(report)).not.toContain('estrutural:departamento-louvor');
  });
});

// --------------------------------------------------------------------------
// 7.20 privacidade: observacao publica com conteudo privado (referencia segura)
// --------------------------------------------------------------------------

describe('ValidationEngine - 7.20 privacidade em observacao publica', () => {
  it('bloqueia e NUNCA expoe o conteudo privado no achado', () => {
    const secret = 'telefone secreto 5511999999999';
    const report = validateComplete(
      makeInput({
        externalInputs: [observationInput('obs-1', 'svc-1', 'public', secret)],
        privateObservationInputIds: new Set(['obs-1']),
      }),
    );
    const f = report.blocking.find((x) => x.ruleId === 'estrutural:privado-em-observacao-publica');
    expect(f).toBeDefined();
    // Referencia SEGURA: apenas o id, nunca o conteudo privado.
    expect(f?.offendingReference).toBe('observacao: obs-1');
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain('5511999999999');
  });
});

// --------------------------------------------------------------------------
// 7.21 convencao publica
// --------------------------------------------------------------------------

describe('ValidationEngine - 7.21 convencao de observacao publica', () => {
  it('bloqueia observacao publica sem o prefixo exigido', () => {
    const report = validateComplete(
      makeInput({
        externalInputs: [observationInput('obs-1', 'svc-1', 'public', 'faltou o prefixo')],
        structural: { ...EMPTY_STRUCTURAL, publicObservationPrefix: 'Aviso:' },
      }),
    );
    expect(reasons(report)).toContain('estrutural:convencao-observacao-publica');
  });

  it('7.25 valor ausente torna a convencao inconclusiva (Bloqueio)', () => {
    const report = validateComplete(
      makeInput({
        externalInputs: [observationInput('obs-1', 'svc-1', 'public', 123)],
        structural: { ...EMPTY_STRUCTURAL, publicObservationPrefix: 'Aviso:' },
      }),
    );
    expect(report.blocking.some((f) => f.ruleId === 'inconclusivo:public-observation-convention')).toBe(
      true,
    );
  });
});

// --------------------------------------------------------------------------
// 7.22 contato (Aviso)
// --------------------------------------------------------------------------

describe('ValidationEngine - 7.22 contato publico ausente (Aviso)', () => {
  it('registra Aviso para pessoa sem contato publico que recebera comunicacao', () => {
    const report = validateComplete(
      makeInput({
        people: [person('p-a', [ROLE_REGENTE])],
        draft: draft([assignment('a-1', 'svc-1', ROLE_REGENTE, 'p-a')]),
        structural: { ...EMPTY_STRUCTURAL, communicationRoleIds: [ROLE_REGENTE] },
        peopleWithPublicContact: new Set<string>(),
      }),
    );
    const f = report.warnings.find((x) => x.ruleId === 'estrutural:contato-publico-ausente');
    expect(f).toBeDefined();
    expect(f?.severity).toBe('warning');
    expect(f?.offendingReference).toContain('pessoa: p-a');
  });

  it('nao avisa quando a pessoa possui contato publico vigente', () => {
    const report = validateComplete(
      makeInput({
        people: [person('p-a', [ROLE_REGENTE])],
        draft: draft([assignment('a-1', 'svc-1', ROLE_REGENTE, 'p-a')]),
        structural: { ...EMPTY_STRUCTURAL, communicationRoleIds: [ROLE_REGENTE] },
        peopleWithPublicContact: new Set(['p-a']),
      }),
    );
    expect(reasons(report)).not.toContain('estrutural:contato-publico-ausente');
  });
});

// --------------------------------------------------------------------------
// 7.4 / 7.5 Regras declarativas (DSL)
// --------------------------------------------------------------------------

describe('ValidationEngine - 7.4/7.5 regras declarativas', () => {
  function ruleFor(kind: 'fundamental' | 'preference', roleId: string): Rule {
    return {
      id: kind === 'fundamental' ? 'rf-1' : 'pref-1',
      kind,
      severity: kind === 'fundamental' ? 'blocking' : 'warning',
      applicability: { op: 'eq', args: [field('assignment.roleId'), lit(roleId)] },
      assertion: { op: 'false' },
      messageTemplate: 'ajuste a atribuicao',
      allowedExceptionTypeIds: [],
    };
  }

  it('7.4 RF violada => Bloqueio', () => {
    const report = validateComplete(
      makeInput({
        people: [person('p-a', [ROLE_REGENTE])],
        draft: draft([assignment('a-1', 'svc-1', ROLE_REGENTE, 'p-a')]),
        ruleSet: ruleSet([ruleFor('fundamental', ROLE_REGENTE)]),
      }),
    );
    expect(report.blocking.some((f) => f.ruleId === 'rf-1')).toBe(true);
  });

  it('7.5 Preferencia nao atendida => Aviso', () => {
    const report = validateComplete(
      makeInput({
        people: [person('p-a', [ROLE_REGENTE])],
        draft: draft([assignment('a-1', 'svc-1', ROLE_REGENTE, 'p-a')]),
        ruleSet: ruleSet([ruleFor('preference', ROLE_REGENTE)]),
      }),
    );
    expect(report.warnings.some((f) => f.ruleId === 'pref-1')).toBe(true);
  });

  it('RF com Excecao_Aprovada vigente nao bloqueia', () => {
    const exc: ApprovedException = {
      schemaVersion: SCHEMA_VERSION,
      id: 'exc-1',
      fundamentalRuleId: 'rf-1',
      condition: { op: 'true' },
      validFrom: '2026-02-01',
      validUntil: '2026-02-28',
      justification: 'excecao vigente',
      approvedBy: 'op-1',
      approvedAt: NOW,
    };
    const report = validateComplete(
      makeInput({
        people: [person('p-a', [ROLE_REGENTE])],
        draft: draft([assignment('a-1', 'svc-1', ROLE_REGENTE, 'p-a')]),
        ruleSet: ruleSet([ruleFor('fundamental', ROLE_REGENTE)]),
        exceptions: [exc],
      }),
    );
    expect(report.blocking.some((f) => f.ruleId === 'rf-1')).toBe(false);
  });
});

// --------------------------------------------------------------------------
// 7.23 gate de publicacao
// --------------------------------------------------------------------------

describe('ValidationEngine - 7.23 gate de publicacao', () => {
  it('canPublish e falso com qualquer bloqueio', () => {
    const report = validateComplete(
      makeInput({
        draft: draft([assignment('a-1', 'svc-1', ROLE_REGENTE, 'fantasma')]),
        people: [],
      }),
    );
    expect(report.blocking.length).toBeGreaterThan(0);
    expect(canPublish(report)).toBe(false);
  });

  it('canPublish e verdadeiro quando completa e sem bloqueios (avisos nao impedem)', () => {
    const report = validateComplete(
      makeInput({
        people: [person('p-a', [ROLE_REGENTE])],
        draft: draft([assignment('a-1', 'svc-1', ROLE_REGENTE, 'p-a')]),
        structural: { ...EMPTY_STRUCTURAL, communicationRoleIds: [ROLE_REGENTE] },
        peopleWithPublicContact: new Set<string>(),
      }),
    );
    expect(report.warnings.length).toBeGreaterThan(0);
    expect(report.blocking).toHaveLength(0);
    expect(canPublish(report)).toBe(true);
  });
});

// --------------------------------------------------------------------------
// 7.1 / 14.5 / Property 25: incremental == completa
// --------------------------------------------------------------------------

describe('ValidationEngine - 7.1/14.5 validacao incremental equivale a completa', () => {
  it('reavaliar apenas as verificacoes dependentes do campo produz o mesmo relatorio', () => {
    // Estado inicial valido.
    const base = makeInput({
      services: [service('svc-1', '2026-02-04', 'wednesday')],
      people: [person('p-a', [ROLE_REGENTE]), person('p-b', [ROLE_REGENTE])],
      draft: draft([assignment('a-1', 'svc-1', ROLE_REGENTE, 'p-a')]),
    });
    const previous = runAllChecks(base);

    // Alteracao: troca o sujeito por um nao habilitado (muda assignment.subject).
    const changed = makeInput({
      services: base.services,
      people: [person('p-a', [ROLE_REGENTE]), person('p-b', ['cap-outra'])],
      draft: draft([assignment('a-1', 'svc-1', ROLE_REGENTE, 'p-b')]),
    });

    const changedFields: ValidatedField[] = ['assignment.subject'];
    const incremental = validateIncremental(changed, previous, changedFields);
    const complete = validateComplete(changed);

    // Mesmo conjunto de achados (por findingId) e mesmos totais.
    expect(incremental.blocking.map((f) => f.findingId).sort()).toEqual(
      complete.blocking.map((f) => f.findingId).sort(),
    );
    expect(incremental.warnings.map((f) => f.findingId).sort()).toEqual(
      complete.warnings.map((f) => f.findingId).sort(),
    );
    expect(incremental.passedCount).toBe(complete.passedCount);
  });

  it('quando nenhuma verificacao dependente muda, o resultado permanece identico', () => {
    const input = makeInput({
      services: [service('svc-1', '2026-02-04', 'wednesday')],
      people: [person('p-a', [ROLE_REGENTE])],
      draft: draft([assignment('a-1', 'svc-1', ROLE_REGENTE, 'p-a')]),
    });
    const previous = runAllChecks(input);
    // Nenhum campo alterado => reuso total; deve igualar a completa.
    const incremental = validateIncremental(input, previous, []);
    const complete = validateComplete(input);
    expect(incremental.blocking).toEqual(complete.blocking);
    expect(incremental.warnings).toEqual(complete.warnings);
  });
});
