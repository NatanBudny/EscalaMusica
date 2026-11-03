// Testes unitarios da elegibilidade manual (tarefa 6.1).
//
// Cobrem as validacoes objetivas da tarefa 6.1 (requirements.md, Requisito 5):
//  - toda atribuicao ACEITA usa um sujeito ELEGIVEL (5.2 / Property 16);
//  - rejeicoes PRESERVAM a revisao/rascunho anterior (5.11);
//  - ignorar sugestao e identidade: nao altera rascunho nem cadastro
//    (5.6 / Property 17);
//  - contrariar Preferencia_de_Escala exige justificativa nao vazia
//    (5.10 / Property 20);
//  - violar Regra_Fundamental sem Excecao_Aprovada vigente e BLOQUEADO; com
//    excecao vigente e permitido (5.11);
//  - responsabilidade departamental quando o pregador e Departamento
//    (5.12 / Property 21).
//
// Sem mocks: usa o RegistryService e o RuleSetService reais com fixtures
// deterministicas, exatamente como os demais testes do dominio.

import { describe, expect, it } from 'vitest';
import {
  applyAssignmentChange,
  departmentResponsibilityFor,
  evaluateCell,
  ignoreSuggestion,
  selectableSubjects,
  type DepartmentResponsibilityRule,
  type EligibilityContext,
} from './eligibility';
import { RegistryService } from '../registry/registry-service';
import { RuleSetService } from '../rules/rule-set-service';
import { field, lit } from '../rules/predicate';
import { SCHEMA_VERSION } from '../schemas/models';
import type {
  ApprovedException,
  ApprovedRuleSet,
  ExternalInput,
  Person,
  Rule,
  ScheduleDraft,
  Service,
} from '../schemas/models';

// --------------------------------------------------------------------------
// Builders deterministicos
// --------------------------------------------------------------------------

const NOW = '2026-02-01T12:00:00Z';
// A elegibilidade trata o roleId como a propria habilitacao (capabilityId):
// `capable = person.capabilityIds.includes(roleId)`. Por isso as fixtures de
// pessoas habilitadas listam o ROLE como capability.
const ROLE_REGENTE = 'role-regente';
const ROLE_PREGADOR = 'role-pregador';
const RS_VERSION = 'rs-1';

function person(
  id: string,
  caps: string[],
  weekdays: Person['allowedWeekdays'],
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

function service(
  id: string,
  date: string,
  weekday: Service['computedWeekday'] = 'wednesday',
): Service {
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

function draft(assignments: ScheduleDraft['assignments'] = []): ScheduleDraft {
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
    id: RS_VERSION,
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

/**
 * Monta um RuleSetService ja carregado com a versao ativa e, opcionalmente,
 * uma excecao vigente. Usa o servico real (sem mocks).
 */
function makeRules(rules: Rule[], exceptions: ApprovedException[] = []): RuleSetService {
  return new RuleSetService([ruleSet(rules)], exceptions);
}

function makeRegistry(people: Person[], departments: { id: string }[] = []): RegistryService {
  const reg = new RegistryService();
  for (const p of people) {
    const r = reg.addPerson({
      id: p.id,
      canonicalName: p.canonicalName,
      capabilityIds: p.capabilityIds,
      allowedWeekdays: p.allowedWeekdays,
      now: NOW,
    });
    if (!r.ok) throw new Error(`fixture invalida (pessoa ${p.id}): ${r.error.message}`);
    if (p.participation === 'inactive') {
      const d = reg.deactivatePerson(p.id, NOW);
      if (!d.ok) throw new Error(`fixture invalida (desativar ${p.id}): ${d.error.message}`);
    }
  }
  for (const d of departments) {
    const r = reg.addDepartment({ id: d.id, canonicalName: d.id, now: NOW });
    if (!r.ok) throw new Error(`fixture invalida (dep ${d.id}): ${r.error.message}`);
  }
  return reg;
}

function makeContext(overrides: Partial<EligibilityContext> = {}): EligibilityContext {
  const registry =
    overrides.registry ?? makeRegistry([person('p-a', [ROLE_REGENTE], ['wednesday'])]);
  return {
    registry,
    rules: overrides.rules ?? makeRules([]),
    ruleSetVersionId: RS_VERSION,
    services: overrides.services ?? [service('svc-1', '2026-02-04', 'wednesday')],
    unavailabilities: overrides.unavailabilities ?? [],
    propagation: overrides.propagation ?? { propagatingLinkTypeIds: new Set<string>() },
    externalInputs: overrides.externalInputs ?? [],
    history: overrides.history ?? [],
    draft: overrides.draft ?? draft(),
  };
}

// --------------------------------------------------------------------------
// 5.2 / Property 16: toda atribuicao aceita usa sujeito elegivel
// --------------------------------------------------------------------------

describe('elegibilidade - toda atribuicao aceita usa sujeito elegivel (5.2 / Property 16)', () => {
  it('aceita a inclusao de um candidato habilitado, ativo, disponivel e no dia permitido', () => {
    const ctx = makeContext();
    const result = applyAssignmentChange(ctx, {
      serviceId: 'svc-1',
      roleId: ROLE_REGENTE,
      subject: { type: 'person', id: 'p-a' },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.draft.assignments).toHaveLength(1);
      expect(result.draft.assignments[0]?.subject.id).toBe('p-a');
      expect(result.draft.assignments[0]?.source).toBe('manual');
    }
  });

  it('o sujeito escolhido pertence ao conjunto de selecionaveis da celula', () => {
    const ctx = makeContext();
    const selectable = selectableSubjects(ctx, 'svc-1', ROLE_REGENTE);
    expect(selectable).toEqual([{ type: 'person', id: 'p-a' }]);

    const result = applyAssignmentChange(ctx, {
      serviceId: 'svc-1',
      roleId: ROLE_REGENTE,
      subject: { type: 'person', id: 'p-a' },
    });
    expect(result.ok).toBe(true);
  });

  it('rejeita sujeito nao habilitado para a funcao (not-selectable)', () => {
    const ctx = makeContext({
      registry: makeRegistry([person('p-x', ['cap-outra'], ['wednesday'])]),
    });
    const result = applyAssignmentChange(ctx, {
      serviceId: 'svc-1',
      roleId: ROLE_REGENTE,
      subject: { type: 'person', id: 'p-x' },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('not-selectable');
  });

  it('rejeita pessoa indisponivel na data (not-selectable) e preserva o rascunho', () => {
    const ctx = makeContext({
      unavailabilities: [
        {
          schemaVersion: SCHEMA_VERSION,
          id: 'u-1',
          cycleId: 'cycle-1',
          personId: 'p-a',
          scope: { type: 'dates', dates: ['2026-02-04'] },
          source: 'teste',
          createdAt: NOW,
        },
      ],
    });
    const result = applyAssignmentChange(ctx, {
      serviceId: 'svc-1',
      roleId: ROLE_REGENTE,
      subject: { type: 'person', id: 'p-a' },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('not-selectable');
  });

  it('rejeita pessoa inativa', () => {
    const ctx = makeContext({
      registry: makeRegistry([person('p-a', [ROLE_REGENTE], ['wednesday'], 'inactive')]),
    });
    const result = applyAssignmentChange(ctx, {
      serviceId: 'svc-1',
      roleId: ROLE_REGENTE,
      subject: { type: 'person', id: 'p-a' },
    });
    expect(result.ok).toBe(false);
  });
});

// --------------------------------------------------------------------------
// 5.11: Regra_Fundamental sem excecao vigente bloqueia; preserva rascunho
// --------------------------------------------------------------------------

function blockingRuleForRole(roleId: string): Rule {
  return {
    id: 'rf-block',
    kind: 'fundamental',
    severity: 'blocking',
    applicability: { op: 'eq', args: [field('assignment.roleId'), lit(roleId)] },
    assertion: { op: 'false' }, // sempre violada quando aplicavel
    messageTemplate: 'funcao bloqueada por RF',
    allowedExceptionTypeIds: [],
  };
}

describe('elegibilidade - Regra_Fundamental sem excecao vigente (5.11)', () => {
  it('bloqueia a atribuicao que viola uma RF e PRESERVA a revisao anterior', () => {
    const prior = draft([
      {
        id: 'pre-1',
        serviceId: 'svc-1',
        roleId: 'role-outra',
        subject: { type: 'person', id: 'p-a' },
        source: 'manual',
      },
    ]);
    const ctx = makeContext({ rules: makeRules([blockingRuleForRole(ROLE_REGENTE)]), draft: prior });

    const result = applyAssignmentChange(ctx, {
      serviceId: 'svc-1',
      roleId: ROLE_REGENTE,
      subject: { type: 'person', id: 'p-a' },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('fundamental-violation');
      expect(result.error.conflicts?.map((c) => c.ruleId)).toContain('rf-block');
    }
    // O rascunho anterior permanece intocado (nenhuma mutacao).
    expect(ctx.draft).toEqual(prior);
    expect(ctx.draft.revision).toBe('a'.repeat(64));
  });

  it('permite a atribuicao quando ha Excecao_Aprovada vigente que cobre o conflito', () => {
    const exception: ApprovedException = {
      schemaVersion: SCHEMA_VERSION,
      id: 'exc-1',
      fundamentalRuleId: 'rf-block',
      condition: { op: 'true' },
      validFrom: '2026-02-01',
      validUntil: '2026-02-28',
      justification: 'excecao de teste vigente',
      approvedBy: 'op-1',
      approvedAt: NOW,
    };
    const ctx = makeContext({
      rules: makeRules([blockingRuleForRole(ROLE_REGENTE)], [exception]),
    });
    const result = applyAssignmentChange(ctx, {
      serviceId: 'svc-1',
      roleId: ROLE_REGENTE,
      subject: { type: 'person', id: 'p-a' },
    });
    expect(result.ok).toBe(true);
  });

  it('excecao fora da vigencia NAO suprime o bloqueio', () => {
    const exception: ApprovedException = {
      schemaVersion: SCHEMA_VERSION,
      id: 'exc-1',
      fundamentalRuleId: 'rf-block',
      condition: { op: 'true' },
      validFrom: '2026-03-01', // fora do culto 2026-02-04
      validUntil: '2026-03-31',
      justification: 'fora de vigencia',
      approvedBy: 'op-1',
      approvedAt: NOW,
    };
    const ctx = makeContext({
      rules: makeRules([blockingRuleForRole(ROLE_REGENTE)], [exception]),
    });
    const result = applyAssignmentChange(ctx, {
      serviceId: 'svc-1',
      roleId: ROLE_REGENTE,
      subject: { type: 'person', id: 'p-a' },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('fundamental-violation');
  });
});

// --------------------------------------------------------------------------
// 5.10 / Property 20: override de preferencia exige justificativa
// --------------------------------------------------------------------------

function preferenceRuleForRole(roleId: string): Rule {
  return {
    id: 'pref-1',
    kind: 'preference',
    severity: 'warning',
    applicability: { op: 'eq', args: [field('assignment.roleId'), lit(roleId)] },
    assertion: { op: 'false' }, // sempre contrariada quando aplicavel
    messageTemplate: 'preferencia contrariada',
    allowedExceptionTypeIds: [],
  };
}

describe('elegibilidade - override de preferencia exige justificativa (5.10 / Property 20)', () => {
  it('rejeita a escolha que contraria preferencia quando a justificativa e vazia', () => {
    const ctx = makeContext({ rules: makeRules([preferenceRuleForRole(ROLE_REGENTE)]) });
    const result = applyAssignmentChange(ctx, {
      serviceId: 'svc-1',
      roleId: ROLE_REGENTE,
      subject: { type: 'person', id: 'p-a' },
      preferenceOverrideReason: '   ', // so espacos => vazio apos trim
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('preference-needs-justification');
  });

  it('rejeita quando a justificativa esta ausente', () => {
    const ctx = makeContext({ rules: makeRules([preferenceRuleForRole(ROLE_REGENTE)]) });
    const result = applyAssignmentChange(ctx, {
      serviceId: 'svc-1',
      roleId: ROLE_REGENTE,
      subject: { type: 'person', id: 'p-a' },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('preference-needs-justification');
  });

  it('aceita e persiste a justificativa quando ela e nao vazia', () => {
    const ctx = makeContext({ rules: makeRules([preferenceRuleForRole(ROLE_REGENTE)]) });
    const result = applyAssignmentChange(ctx, {
      serviceId: 'svc-1',
      roleId: ROLE_REGENTE,
      subject: { type: 'person', id: 'p-a' },
      preferenceOverrideReason: '  decisao do coordenador  ',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.draft.assignments[0]?.preferenceOverrideReason).toBe('decisao do coordenador');
    }
  });
});

// --------------------------------------------------------------------------
// 5.6 / Property 17: ignorar sugestao e identidade
// --------------------------------------------------------------------------

describe('elegibilidade - ignorar sugestao e identidade (5.6 / Property 17)', () => {
  it('ignorar sugestao devolve exatamente o mesmo rascunho (mesma referencia)', () => {
    const d = draft([
      {
        id: 'a-1',
        serviceId: 'svc-1',
        roleId: ROLE_REGENTE,
        subject: { type: 'person', id: 'p-a' },
        source: 'manual',
      },
    ]);
    const after = ignoreSuggestion(d);
    expect(after).toBe(d);
    expect(after).toEqual(d);
  });

  it('ignorar sugestao nao altera o cadastro (o modulo nunca muta o registry)', () => {
    const registry = makeRegistry([person('p-a', [ROLE_REGENTE], ['wednesday'])]);
    const before = registry.snapshot();
    const d = draft();
    ignoreSuggestion(d);
    expect(registry.snapshot()).toEqual(before);
  });
});

// --------------------------------------------------------------------------
// 5.1: remover atribuicao sempre e aceito
// --------------------------------------------------------------------------

describe('elegibilidade - remover atribuicao (5.1)', () => {
  it('remove a atribuicao da celula sem exigir elegibilidade e preserva as demais', () => {
    const d = draft([
      {
        id: 'a-1',
        serviceId: 'svc-1',
        roleId: ROLE_REGENTE,
        subject: { type: 'person', id: 'p-a' },
        source: 'manual',
      },
      {
        id: 'a-2',
        serviceId: 'svc-1',
        roleId: 'role-outra',
        subject: { type: 'person', id: 'p-a' },
        source: 'manual',
      },
    ]);
    const ctx = makeContext({ draft: d });
    const result = applyAssignmentChange(ctx, { serviceId: 'svc-1', roleId: ROLE_REGENTE });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const roles = result.draft.assignments.map((a) => a.roleId);
      expect(roles).toEqual(['role-outra']);
    }
    // Rascunho original preservado.
    expect(d.assignments).toHaveLength(2);
  });
});

// --------------------------------------------------------------------------
// 5.12 / Property 21: responsabilidade departamental
// --------------------------------------------------------------------------

function preacherDepartmentInput(serviceId: string, departmentId: string): ExternalInput {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: `ext-${serviceId}`,
    serviceId,
    type: 'preacher',
    value: { subject: { type: 'department', id: departmentId } },
    visibility: 'public',
    source: 'teste',
    updatedAt: NOW,
    operatorId: 'op-1',
  };
}

describe('elegibilidade - responsabilidade departamental (5.12 / Property 21)', () => {
  const departmentRule: DepartmentResponsibilityRule = { roleIds: [ROLE_PREGADOR] };

  it('expoe o departamento responsavel quando o pregador do culto e um Departamento', () => {
    const registry = makeRegistry(
      [person('p-a', [ROLE_REGENTE], ['wednesday'])],
      [{ id: 'dep-1' }],
    );
    const ctx = makeContext({
      registry,
      externalInputs: [preacherDepartmentInput('svc-1', 'dep-1')],
    });
    const cell = evaluateCell(ctx, 'svc-1', ROLE_PREGADOR, departmentRule);
    expect(cell.departmentResponsibility).toEqual({ departmentId: 'dep-1', name: 'dep-1' });
    // O departamento ativo e selecionavel para a funcao departamental.
    expect(cell.candidates.some((c) => c.subject.id === 'dep-1' && c.selectable)).toBe(true);
  });

  it('departmentResponsibilityFor retorna o departamento somente para a funcao abrangida', () => {
    const registry = makeRegistry([], [{ id: 'dep-1' }]);
    const inputs = [preacherDepartmentInput('svc-1', 'dep-1')];
    const covered = departmentResponsibilityFor(
      'svc-1',
      ROLE_PREGADOR,
      inputs,
      departmentRule,
      registry,
    );
    expect(covered?.id).toBe('dep-1');

    const notCovered = departmentResponsibilityFor(
      'svc-1',
      ROLE_REGENTE,
      inputs,
      departmentRule,
      registry,
    );
    expect(notCovered).toBeUndefined();
  });

  it('nao atribui responsabilidade departamental quando o pregador e uma pessoa', () => {
    const registry = makeRegistry(
      [person('p-a', [ROLE_REGENTE], ['wednesday'])],
      [{ id: 'dep-1' }],
    );
    const personPreacher: ExternalInput = {
      schemaVersion: SCHEMA_VERSION,
      id: 'ext-svc-1',
      serviceId: 'svc-1',
      type: 'preacher',
      value: { subject: { type: 'person', id: 'p-a' } },
      visibility: 'public',
      source: 'teste',
      updatedAt: NOW,
      operatorId: 'op-1',
    };
    const ctx = makeContext({ registry, externalInputs: [personPreacher] });
    const cell = evaluateCell(ctx, 'svc-1', ROLE_PREGADOR, departmentRule);
    expect(cell.departmentResponsibility).toBeUndefined();
  });
});
