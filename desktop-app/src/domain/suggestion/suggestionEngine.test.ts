import { describe, expect, it } from 'vitest';
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
} from '../schemas/models';
import type { EffectiveUnavailability } from '../cycle/unavailability';
import { field, lit } from '../rules/predicate';

// --------------------------------------------------------------------------
// Builders deterministicos de fixtures (sem I/O, ids estaveis)
// --------------------------------------------------------------------------

const NOW = '2026-02-01T12:00:00Z';
const CAP_REGENTE = 'cap-regente';
const CAP_SUPORTE = 'cap-suporte';
const ROLE_REGENTE = 'role-regente';
const ROLE_SUPORTE = 'role-suporte';

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

function service(id: string, date: string, weekday: Service['computedWeekday']): Service {
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

function cycle(): MonthlyCycle {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: 'cycle-1',
    period: '2026-02',
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

/** Rule set com uma RF que exige a habilitacao da funcao (bloqueante). */
function ruleSet(rules: Rule[] = []): ApprovedRuleSet {
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

const ROLES: RoleRequirement[] = [
  { roleId: ROLE_REGENTE, order: 1, requiredCapabilityId: CAP_REGENTE, allowsDepartment: false },
  { roleId: ROLE_SUPORTE, order: 2, requiredCapabilityId: CAP_SUPORTE, allowsDepartment: true },
];

function baseInput(overrides: Partial<SuggestionInput> = {}): SuggestionInput {
  return {
    cycle: cycle(),
    draft: draft(),
    registry: { people: [], departments: [] },
    unavailability: [],
    history: [],
    ruleSet: ruleSet(),
    exceptions: [],
    roleRequirements: ROLES,
    services: [service('svc-1', '2026-02-04', 'wednesday')],
    algorithmVersion: 'sug-1',
    ...overrides,
  };
}

// --------------------------------------------------------------------------
// Determinismo (Requisito 5.8)
// --------------------------------------------------------------------------

describe('SuggestionEngine - determinismo (Requisito 5.8)', () => {
  it('hashes de entrada iguais geram bytes e ordem identicos em execucoes repetidas', () => {
    const input = baseInput({
      registry: {
        people: [
          person('p-a', [CAP_REGENTE], ['wednesday']),
          person('p-b', [CAP_SUPORTE], ['wednesday']),
        ],
        departments: [],
      },
    });

    const r1 = generateCompleteSuggestion(input);
    const r2 = generateCompleteSuggestion(input);

    // Mesma saida byte a byte (ordem e conteudo).
    const bytes1 = toHex(canonicalBytes(r1));
    const bytes2 = toHex(canonicalBytes(r2));
    expect(bytes2).toBe(bytes1);
    expect(r2.inputHash).toBe(r1.inputHash);
  });

  it('entradas semanticamente identicas com colecoes reordenadas produzem o mesmo inputHash', () => {
    const pa = person('p-a', [CAP_REGENTE], ['wednesday']);
    const pb = person('p-b', [CAP_SUPORTE], ['wednesday']);

    const input1 = baseInput({ registry: { people: [pa, pb], departments: [] } });
    const input2 = baseInput({ registry: { people: [pb, pa], departments: [] } });

    expect(computeInputHash(input2)).toBe(computeInputHash(input1));
    // E a saida tambem e identica (ordem canonica estavel).
    const h1 = toHex(canonicalBytes(generateCompleteSuggestion(input1)));
    const h2 = toHex(canonicalBytes(generateCompleteSuggestion(input2)));
    expect(h2).toBe(h1);
  });

  it('o inputHash muda quando a versao do algoritmo muda', () => {
    const input = baseInput();
    const other = baseInput({ algorithmVersion: 'sug-2' });
    expect(computeInputHash(other)).not.toBe(computeInputHash(input));
  });

  it('os ids das atribuicoes sugeridas sao deterministicos (sem aleatoriedade)', () => {
    const input = baseInput({
      registry: { people: [person('p-a', [CAP_REGENTE], ['wednesday'])], departments: [] },
    });
    const r1 = generateCompleteSuggestion(input);
    const r2 = generateCompleteSuggestion(input);
    expect(r1.assignments.map((a) => a.id)).toEqual(r2.assignments.map((a) => a.id));
    expect(r1.assignments[0]?.id).toMatch(/^sug-[0-9a-f]{32}$/);
  });
});

// --------------------------------------------------------------------------
// Elegibilidade bloqueante e seguranca (Requisitos 5.13, 5.15)
// --------------------------------------------------------------------------

describe('SuggestionEngine - nenhuma atribuicao fundamentalmente invalida (Requisito 5.13)', () => {
  it('nunca sugere pessoa nao habilitada para a funcao', () => {
    const input = baseInput({
      registry: {
        // p-x nao tem CAP_REGENTE nem CAP_SUPORTE: nao deve ser sugerida.
        people: [person('p-x', ['cap-outra'], ['wednesday'])],
        departments: [],
      },
    });
    const r = generateCompleteSuggestion(input);
    expect(r.assignments).toHaveLength(0);
    // Ambos os slots ficam sem atribuicao (5.15).
    expect(r.unfilled.map((u) => u.roleId).sort()).toEqual([ROLE_REGENTE, ROLE_SUPORTE]);
  });

  it('nunca sugere pessoa indisponivel na data', () => {
    const unavailable: EffectiveUnavailability[] = [
      { sourceUnavailabilityId: 'u-1', personId: 'p-a', date: '2026-02-04', propagationPath: [] },
    ];
    const input = baseInput({
      registry: { people: [person('p-a', [CAP_REGENTE], ['wednesday'])], departments: [] },
      unavailability: unavailable,
    });
    const r = generateCompleteSuggestion(input);
    expect(r.assignments.find((a) => a.roleId === ROLE_REGENTE)).toBeUndefined();
    expect(r.unfilled.some((u) => u.roleId === ROLE_REGENTE)).toBe(true);
  });

  it('nunca sugere pessoa cujo dia da semana nao e permitido', () => {
    const input = baseInput({
      registry: {
        people: [person('p-a', [CAP_REGENTE], ['saturday'])], // so sabado
        departments: [],
      },
    });
    const r = generateCompleteSuggestion(input);
    expect(r.assignments.find((a) => a.roleId === ROLE_REGENTE)).toBeUndefined();
  });

  it('nunca sugere pessoa inativa', () => {
    const input = baseInput({
      registry: {
        people: [person('p-a', [CAP_REGENTE], ['wednesday'], 'inactive')],
        departments: [],
      },
    });
    const r = generateCompleteSuggestion(input);
    expect(r.assignments.find((a) => a.roleId === ROLE_REGENTE)).toBeUndefined();
  });

  it('respeita uma Regra_Fundamental declarativa (bloqueia a funcao para o culto)', () => {
    // RF: nenhuma atribuicao na quarta-feira para a funcao regente.
    const rf: Rule = {
      id: 'rf-no-wed',
      kind: 'fundamental',
      severity: 'blocking',
      // aplicabilidade: cultos de quarta na funcao regente
      applicability: {
        op: 'and',
        args: [
          { op: 'eq', args: [field('service.weekday'), lit('wednesday')] },
          { op: 'eq', args: [field('assignment.roleId'), lit(ROLE_REGENTE)] },
        ],
      },
      // assercao sempre falsa => RF sempre violada quando aplicavel
      assertion: { op: 'false' },
      messageTemplate: 'sem regente na quarta',
      allowedExceptionTypeIds: [],
    };
    const input = baseInput({
      ruleSet: ruleSet([rf]),
      registry: { people: [person('p-a', [CAP_REGENTE], ['wednesday'])], departments: [] },
    });
    const r = generateCompleteSuggestion(input);
    const unfilled = r.unfilled.find((u) => u.roleId === ROLE_REGENTE);
    expect(unfilled).toBeDefined();
    expect(unfilled?.blockingRuleIds).toContain('rf-no-wed');
  });

  it('uma Excecao_Aprovada vigente e aplicavel permite preencher o slot', () => {
    const rf: Rule = {
      id: 'rf-no-wed',
      kind: 'fundamental',
      severity: 'blocking',
      applicability: { op: 'eq', args: [field('assignment.roleId'), lit(ROLE_REGENTE)] },
      assertion: { op: 'false' },
      messageTemplate: 'bloqueado',
      allowedExceptionTypeIds: [],
    };
    const exception: ApprovedException = {
      schemaVersion: SCHEMA_VERSION,
      id: 'exc-1',
      fundamentalRuleId: 'rf-no-wed',
      condition: { op: 'eq', args: [field('assignment.subjectId'), lit('p-a')] },
      validFrom: '2026-02-01',
      validUntil: '2026-02-28',
      justification: 'excecao de teste',
      approvedBy: 'op-1',
      approvedAt: NOW,
    };
    const input = baseInput({
      ruleSet: ruleSet([rf]),
      exceptions: [exception],
      registry: { people: [person('p-a', [CAP_REGENTE], ['wednesday'])], departments: [] },
    });
    const r = generateCompleteSuggestion(input);
    const chosen = r.assignments.find((a) => a.roleId === ROLE_REGENTE);
    expect(chosen?.subject.id).toBe('p-a');
  });

  it('excecao fora da vigencia NAO suprime o bloqueio', () => {
    const rf: Rule = {
      id: 'rf-block',
      kind: 'fundamental',
      severity: 'blocking',
      applicability: { op: 'eq', args: [field('assignment.roleId'), lit(ROLE_REGENTE)] },
      assertion: { op: 'false' },
      messageTemplate: 'bloqueado',
      allowedExceptionTypeIds: [],
    };
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
    const input = baseInput({
      ruleSet: ruleSet([rf]),
      exceptions: [exception],
      registry: { people: [person('p-a', [CAP_REGENTE], ['wednesday'])], departments: [] },
    });
    const r = generateCompleteSuggestion(input);
    expect(r.assignments.find((a) => a.roleId === ROLE_REGENTE)).toBeUndefined();
    expect(r.unfilled.some((u) => u.roleId === ROLE_REGENTE)).toBe(true);
  });
});

// --------------------------------------------------------------------------
// Completude, traco e preservacao do manual (Requisitos 5.7, 5.9, 5.14, 5.15)
// --------------------------------------------------------------------------

describe('SuggestionEngine - completude, traco e edicao (Requisitos 5.7, 5.9, 5.14)', () => {
  it('gera sugestao completa para todos os slots quando ha candidatos elegiveis', () => {
    const input = baseInput({
      registry: {
        people: [
          person('p-a', [CAP_REGENTE], ['wednesday']),
          person('p-b', [CAP_SUPORTE], ['wednesday']),
        ],
        departments: [],
      },
    });
    const r = generateCompleteSuggestion(input);
    expect(r.assignments).toHaveLength(2);
    expect(r.unfilled).toHaveLength(0);
    // Toda sugestao e marcada como 'suggested' (editavel, 5.14).
    expect(r.assignments.every((a) => a.source === 'suggested')).toBe(true);
  });

  it('o traco identifica funcao, culto, sujeito, regras consideradas e historico (5.7)', () => {
    const history: ConfirmedAssignment[] = [
      { subjectId: 'p-a', roleId: ROLE_REGENTE, date: '2026-01-07' },
    ];
    const input = baseInput({
      ruleSet: ruleSet([
        {
          id: 'rf-ok',
          kind: 'fundamental',
          severity: 'blocking',
          applicability: { op: 'true' },
          assertion: { op: 'true' },
          messageTemplate: 'ok',
          allowedExceptionTypeIds: [],
        },
      ]),
      history,
      registry: { people: [person('p-a', [CAP_REGENTE], ['wednesday'])], departments: [] },
    });
    const r = generateCompleteSuggestion(input);
    const trace = r.traces.find((t) => t.roleId === ROLE_REGENTE);
    expect(trace).toBeDefined();
    expect(trace?.serviceId).toBe('svc-1');
    expect(trace?.selectedSubjectIds).toEqual(['p-a']);
    expect(trace?.consideredRuleIds).toContain('rf-ok');
    const evidence = trace?.historyEvidence.find((e) => e.subjectId === 'p-a');
    expect(evidence?.count).toBe(1);
    expect(evidence?.dates).toEqual(['2026-01-07']);
  });

  it('preserva atribuicoes manuais existentes e nao as substitui (5.14)', () => {
    const manual = {
      id: 'manual-1',
      serviceId: 'svc-1',
      roleId: ROLE_REGENTE,
      subject: { type: 'person' as const, id: 'p-manual' },
      source: 'manual' as const,
    };
    const input = baseInput({
      draft: draft([manual]),
      registry: {
        people: [
          person('p-a', [CAP_REGENTE], ['wednesday']),
          person('p-b', [CAP_SUPORTE], ['wednesday']),
        ],
        departments: [],
      },
    });
    const r = generateCompleteSuggestion(input);
    const regente = r.assignments.find((a) => a.roleId === ROLE_REGENTE);
    expect(regente?.id).toBe('manual-1');
    expect(regente?.source).toBe('manual');
    expect(regente?.subject.id).toBe('p-manual');
  });

  it('lista os slots sem solucao com as RF bloqueantes (5.15) e mantem o rascunho editavel', () => {
    const input = baseInput({
      registry: { people: [], departments: [] },
    });
    const r = generateCompleteSuggestion(input);
    expect(r.assignments).toHaveLength(0);
    expect(r.unfilled).toHaveLength(2);
    // Sem RF declarativa, os bloqueios por elegibilidade base nao sao RF ids.
    expect(r.unfilled.every((u) => Array.isArray(u.blockingRuleIds))).toBe(true);
  });
});

// --------------------------------------------------------------------------
// Ordenacao por score inteiro e departamentos (Requisitos 5.2, 5.7)
// --------------------------------------------------------------------------

describe('SuggestionEngine - score inteiro, rotacao e departamentos', () => {
  it('prefere o candidato com menor uso historico na funcao (rotacao)', () => {
    const history: ConfirmedAssignment[] = [
      { subjectId: 'p-a', roleId: ROLE_REGENTE, date: '2026-01-07' },
      { subjectId: 'p-a', roleId: ROLE_REGENTE, date: '2026-01-14' },
    ];
    const input = baseInput({
      history,
      registry: {
        people: [
          person('p-a', [CAP_REGENTE], ['wednesday']),
          person('p-b', [CAP_REGENTE], ['wednesday']),
        ],
        departments: [],
      },
    });
    const r = generateCompleteSuggestion(input);
    const chosen = r.assignments.find((a) => a.roleId === ROLE_REGENTE);
    // p-b tem zero historico; deve ser preferido.
    expect(chosen?.subject.id).toBe('p-b');
    // scores sao inteiros
    const trace = r.traces.find((t) => t.roleId === ROLE_REGENTE);
    expect(trace?.rankedCandidates.every((c) => Number.isInteger(c.score))).toBe(true);
  });

  it('empata por subjectId de forma deterministica', () => {
    const input = baseInput({
      registry: {
        people: [
          person('p-b', [CAP_REGENTE], ['wednesday']),
          person('p-a', [CAP_REGENTE], ['wednesday']),
        ],
        departments: [],
      },
    });
    const r = generateCompleteSuggestion(input);
    const chosen = r.assignments.find((a) => a.roleId === ROLE_REGENTE);
    // Mesmo score (zero historico) => menor subjectId vence (p-a).
    expect(chosen?.subject.id).toBe('p-a');
  });

  it('permite Departamento somente nas funcoes que o autorizam (5.2)', () => {
    const input = baseInput({
      registry: {
        people: [person('p-a', [CAP_REGENTE], ['wednesday'])],
        departments: [department('dep-1')],
      },
    });
    const r = generateCompleteSuggestion(input);
    // ROLE_SUPORTE permite departamento; sem pessoa habilitada, o dep preenche.
    const suporte = r.assignments.find((a) => a.roleId === ROLE_SUPORTE);
    expect(suporte?.subject.type).toBe('department');
    expect(suporte?.subject.id).toBe('dep-1');
    // ROLE_REGENTE nao permite departamento; so a pessoa habilitada.
    const regente = r.assignments.find((a) => a.roleId === ROLE_REGENTE);
    expect(regente?.subject.id).toBe('p-a');
  });

  it('nao reutiliza o mesmo sujeito em duas funcoes do mesmo culto', () => {
    // Uma unica pessoa habilitada para as duas funcoes.
    const input = baseInput({
      registry: {
        people: [person('p-a', [CAP_REGENTE, CAP_SUPORTE], ['wednesday'])],
        departments: [],
      },
    });
    const r = generateCompleteSuggestion(input);
    const regente = r.assignments.find((a) => a.roleId === ROLE_REGENTE);
    const suporte = r.assignments.find((a) => a.roleId === ROLE_SUPORTE);
    expect(regente?.subject.id).toBe('p-a');
    // p-a ja usada no culto => suporte fica sem pessoa (sem outro candidato).
    expect(suporte).toBeUndefined();
    expect(r.unfilled.some((u) => u.roleId === ROLE_SUPORTE)).toBe(true);
  });
});

// --------------------------------------------------------------------------
// Backtracking limitado (design.md)
// --------------------------------------------------------------------------

describe('SuggestionEngine - backtracking limitado', () => {
  it('nao inventa atribuicao quando o limite de passos e atingido', () => {
    const input = baseInput({
      backtrackLimit: 0,
      registry: { people: [person('p-a', [CAP_REGENTE], ['wednesday'])], departments: [] },
    });
    const r = generateCompleteSuggestion(input);
    // Com limite zero, nenhum slot e preenchido.
    expect(r.assignments).toHaveLength(0);
    expect(r.unfilled.length).toBeGreaterThan(0);
  });
});
