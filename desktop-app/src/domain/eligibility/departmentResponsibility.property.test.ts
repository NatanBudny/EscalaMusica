// Feature: gestao-leiga-de-escalas, Property 21: Responsabilidade departamental é aplicada integralmente
//
// Property 21 (design.md):
// "Para todo culto cujo pregador seja um Departamento reconhecido, as funções
//  definidas pela regra departamental são atribuídas ao mesmo Departamento e
//  qualquer campo obrigatório ausente ou valor não permitido produz Bloqueio."
//
// Validates: Requirements 5.12, 7.19
//
//   5.12  WHEN o pregador for um Departamento reconhecido, o sistema aplica às
//         atribuições do Culto as responsabilidades departamentais definidas
//         pelo Conjunto_de_Regras_Ativo e MOSTRA ao Operador quais funções
//         passaram a ser responsabilidade do Departamento.
//   7.19  IF um Departamento assumir a função e um campo exigido pela regra
//         departamental estiver ausente ou com valor não permitido, o sistema
//         não trata o Departamento como responsável selecionável (o Bloqueio
//         do Validador é testado em outra propriedade; aqui garantimos que a
//         elegibilidade NÃO surfaça/selecione um Departamento inválido —
//         inativo ou não reconhecido).
//
// O helper sob teste expõe `departmentResponsibilityFor` e `evaluateCell` em
// eligibility.ts. Verificamos, com um ORÁCULO INDEPENDENTE que NÃO chama a
// lógica sob teste, que a responsabilidade departamental é aplicada
// INTEGRALMENTE:
//
//   P21.a  SURFACE POR CÉLULA — `evaluateCell(...).departmentResponsibility`
//          é o Departamento ativo pregador se e somente se a função é
//          departamental e o pregador mais recente é um Departamento ativo
//          reconhecido; caso contrário é `undefined` (5.12 — "mostrar quais
//          funções passaram a ser responsabilidade do Departamento").
//
//   P21.b  SELEÇÃO INTEGRAL — Departamentos aparecem como candidatos
//          SELECIONÁVEIS exatamente quando a função é departamental e o
//          Departamento está ativo; funções não departamentais e pregadores
//          que são Pessoa (ou ausência de pregador) nunca geram candidato
//          Departamento selecionável nem responsabilidade (5.12 / 7.19).
//
//   P21.c  CONCORDÂNCIA DO HELPER PURO — `departmentResponsibilityFor` devolve
//          exatamente o Departamento esperado pelo oráculo para todo eixo
//          (função departamental ou não, pregador Pessoa/Departamento/ausente,
//          Departamento ativo/inativo/não reconhecido, pregador mais recente
//          entre várias entradas).
//
// Sem mocks: usa RegistryService e RuleSetService reais com fixtures
// determinísticas, como os demais testes do domínio.

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  departmentResponsibilityFor,
  evaluateCell,
  type DepartmentResponsibilityRule,
  type EligibilityContext,
} from './eligibility';
import { RegistryService } from '../registry/registry-service';
import { RuleSetService } from '../rules/rule-set-service';
import { SCHEMA_VERSION } from '../schemas/models';
import type {
  ApprovedRuleSet,
  ExternalInput,
  IsoDate,
  ScheduleDraft,
  Service,
  Weekday,
} from '../schemas/models';

// No mínimo 100 execuções (Notas do tasks.md); seed/replayPath aparecem em falha.
const RUNS = 300;

const NOW = '2026-02-01T12:00:00Z';
const RS_VERSION = 'rs-1';
const CYCLE_ID = 'cycle-1';
const SERVICE_ID = 'svc-1';
const SERVICE_DATE: IsoDate = '2026-02-04';
const SERVICE_WEEKDAY: Weekday = 'wednesday';

// A função departamental sob teste e uma função comum (não departamental) que
// NUNCA deve receber responsabilidade departamental.
const DEPT_ROLE = 'role-louvor'; // responsabilidade departamental quando permitida
const PLAIN_ROLE = 'role-comum'; // nunca departamental

// --------------------------------------------------------------------------
// Especificação gerada do universo.
// --------------------------------------------------------------------------

/** Quem é o pregador mais recente do culto. */
type PreacherKind =
  | { kind: 'none' } // sem insumo de pregador
  | { kind: 'person' } // pregador é Pessoa (nunca gera responsabilidade dept)
  | { kind: 'department'; deptIndex: number } // pregador é um Departamento conhecido
  | { kind: 'unknown-department' }; // pregador é um Departamento não cadastrado

interface DeptSpec {
  active: boolean;
}

interface Universe {
  /** Departamentos cadastrados (ativos/inativos). */
  departments: DeptSpec[];
  /** Pregador mais recente do culto. */
  preacher: PreacherKind;
  /** A função avaliada é a departamental (DEPT_ROLE) ou a comum (PLAIN_ROLE)? */
  evaluateDepartmentalRole: boolean;
  /** A versão de regras habilita responsabilidade departamental na DEPT_ROLE? */
  departmentRoleEnabled: boolean;
  /** Entradas de pregador "ruído" mais antigas (para exercer "mais recente"). */
  noiseOlderPreachers: number;
}

const preacherArb: fc.Arbitrary<PreacherKind> = fc.oneof(
  fc.constant<PreacherKind>({ kind: 'none' }),
  fc.constant<PreacherKind>({ kind: 'person' }),
  fc.constant<PreacherKind>({ kind: 'unknown-department' }),
  fc.nat({ max: 3 }).map<PreacherKind>((deptIndex) => ({ kind: 'department', deptIndex })),
);

const universeArb: fc.Arbitrary<Universe> = fc.record({
  departments: fc.array(fc.record({ active: fc.boolean() }), { minLength: 0, maxLength: 4 }),
  preacher: preacherArb,
  evaluateDepartmentalRole: fc.boolean(),
  departmentRoleEnabled: fc.boolean(),
  noiseOlderPreachers: fc.nat({ max: 2 }),
});

// --------------------------------------------------------------------------
// Ids determinísticos por índice.
// --------------------------------------------------------------------------

const deptId = (i: number): string => `d-${String(i).padStart(3, '0')}`;
const UNKNOWN_DEPT_ID = 'd-unknown';

/** Índice do departamento que de fato é o pregador (ou undefined). */
function preacherDeptIndex(u: Universe): number | undefined {
  if (u.preacher.kind !== 'department') return undefined;
  if (u.departments.length === 0) return undefined;
  return u.preacher.deptIndex % u.departments.length;
}

// --------------------------------------------------------------------------
// Construção dos serviços reais do domínio (sem mocks).
// --------------------------------------------------------------------------

function buildRegistry(u: Universe): RegistryService {
  const reg = new RegistryService();
  u.departments.forEach((_spec, i) => {
    const id = deptId(i);
    const res = reg.addDepartment({ id, canonicalName: id, now: NOW });
    if (!res.ok) throw new Error(`fixture inválida (dep ${id}): ${res.error.message}`);
  });
  if (u.departments.some((d) => !d.active)) {
    const snap = reg.snapshot();
    const departments = snap.departments.map((d, i) =>
      u.departments[i]?.active === false ? { ...d, status: 'inactive' as const } : d,
    );
    return new RegistryService({ ...snap, departments });
  }
  return reg;
}

function ruleSet(): ApprovedRuleSet {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: RS_VERSION,
    version: 'v1',
    status: 'approved',
    validFrom: '2026-01-01',
    rules: [],
    sourceDecisions: [],
    approvedBy: 'op-1',
    approvedAt: NOW,
    createdAt: NOW,
  };
}

function buildRules(): RuleSetService {
  return new RuleSetService([ruleSet()], []);
}

/** Insumo de pregador do tipo `preacher`, apontando a um sujeito. */
function preacherInput(
  id: string,
  updatedAt: string,
  subject: { type: 'person' | 'department'; id: string } | undefined,
): ExternalInput {
  return {
    schemaVersion: SCHEMA_VERSION,
    id,
    serviceId: SERVICE_ID,
    type: 'preacher',
    value: subject ? { subject } : {},
    visibility: 'private',
    source: 'teste',
    updatedAt,
    operatorId: 'op-1',
  };
}

/**
 * Constrói os insumos externos de pregador. Insere `noiseOlderPreachers`
 * entradas mais ANTIGAS (timestamps menores) que NÃO são o pregador efetivo,
 * seguidas da entrada mais RECENTE que define o pregador do culto. Isso exerce
 * a regra "insumo mais recente do tipo preacher".
 */
function buildExternalInputs(u: Universe): ExternalInput[] {
  const inputs: ExternalInput[] = [];

  // Ruído mais antigo: pregadores que NÃO valem (timestamps 2026-01-1X).
  for (let n = 0; n < u.noiseOlderPreachers; n += 1) {
    inputs.push(
      preacherInput(`pre-noise-${n}`, `2026-01-1${n}T00:00:00Z`, { type: 'person', id: `ruido-${n}` }),
    );
  }

  // Entrada mais recente: define o pregador efetivo (timestamp 2026-02-01).
  const latestAt = '2026-02-01T00:00:00Z';
  switch (u.preacher.kind) {
    case 'none':
      // Nenhuma entrada recente; se houver ruído, o "mais recente" ainda é
      // ruído (Pessoa), que também não gera responsabilidade departamental.
      break;
    case 'person':
      inputs.push(preacherInput('pre-latest', latestAt, { type: 'person', id: 'pessoa-pregadora' }));
      break;
    case 'unknown-department':
      inputs.push(preacherInput('pre-latest', latestAt, { type: 'department', id: UNKNOWN_DEPT_ID }));
      break;
    case 'department': {
      const idx = preacherDeptIndex(u);
      if (idx === undefined) {
        // Não há departamento cadastrado: cai em "departamento desconhecido".
        inputs.push(
          preacherInput('pre-latest', latestAt, { type: 'department', id: UNKNOWN_DEPT_ID }),
        );
      } else {
        inputs.push(
          preacherInput('pre-latest', latestAt, { type: 'department', id: deptId(idx) }),
        );
      }
      break;
    }
  }
  return inputs;
}

function service(): Service {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: SERVICE_ID,
    cycleId: CYCLE_ID,
    date: SERVICE_DATE,
    computedWeekday: SERVICE_WEEKDAY,
    kind: 'regular',
    externalInputIds: [],
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

function buildContext(u: Universe): EligibilityContext {
  return {
    registry: buildRegistry(u),
    rules: buildRules(),
    ruleSetVersionId: RS_VERSION,
    services: [service()],
    unavailabilities: [],
    propagation: { propagatingLinkTypeIds: new Set<string>() },
    externalInputs: buildExternalInputs(u),
    history: [],
    draft: emptyDraft(),
  };
}

/** Qual função é avaliada neste universo. */
function roleUnderTest(u: Universe): string {
  return u.evaluateDepartmentalRole ? DEPT_ROLE : PLAIN_ROLE;
}

/**
 * Regra departamental da versão do ciclo: habilita responsabilidade na
 * DEPT_ROLE quando `departmentRoleEnabled`. A PLAIN_ROLE nunca é departamental.
 */
function departmentRuleFor(u: Universe): DepartmentResponsibilityRule | undefined {
  return u.departmentRoleEnabled ? { roleIds: [DEPT_ROLE] } : undefined;
}

// --------------------------------------------------------------------------
// Oráculo independente (NÃO reusa a lógica sob teste).
// --------------------------------------------------------------------------

/**
 * O Departamento responsável esperado para a célula, derivado diretamente dos
 * eixos gerados:
 *  - a função avaliada precisa ser a departamental E habilitada pela regra;
 *  - o pregador mais recente precisa ser um Departamento cadastrado E ativo.
 * Qualquer outra combinação (função comum, regra desabilitada, pregador Pessoa,
 * ausência de pregador, departamento inativo ou não reconhecido) => undefined.
 */
function oracleResponsibleDeptId(u: Universe): string | undefined {
  if (!u.evaluateDepartmentalRole) return undefined; // função comum nunca é dept
  if (!u.departmentRoleEnabled) return undefined; // regra não habilita a função
  if (u.preacher.kind !== 'department') return undefined; // pregador não é Departamento
  const idx = preacherDeptIndex(u);
  if (idx === undefined) return undefined; // "department" mas sem cadastro => desconhecido
  const spec = u.departments[idx];
  if (!spec || !spec.active) return undefined; // inativo não é responsável
  return deptId(idx);
}

/** Departamentos ativos cadastrados (ids), ordenados por id. */
function oracleActiveDepartmentIds(u: Universe): string[] {
  return u.departments
    .map((spec, i) => ({ spec, id: deptId(i) }))
    .filter((x) => x.spec.active)
    .map((x) => x.id)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

// --------------------------------------------------------------------------
// Propriedade 21.
// --------------------------------------------------------------------------

describe('Property 21: responsabilidade departamental é aplicada integralmente (5.12, 7.19)', () => {
  it('a responsabilidade é surfaçada por célula exatamente quando esperado (P21.a)', () => {
    fc.assert(
      fc.property(universeArb, (u) => {
        const ctx = buildContext(u);
        const role = roleUnderTest(u);
        const cell = evaluateCell(ctx, SERVICE_ID, role, departmentRuleFor(u));

        const expectedDeptId = oracleResponsibleDeptId(u);
        if (expectedDeptId === undefined) {
          expect(cell.departmentResponsibility).toBeUndefined();
        } else {
          expect(cell.departmentResponsibility).toBeDefined();
          expect(cell.departmentResponsibility?.departmentId).toBe(expectedDeptId);
          // O nome surfaçado é o nome canônico do Departamento (fixture: id).
          expect(cell.departmentResponsibility?.name).toBe(expectedDeptId);
        }
      }),
      { numRuns: RUNS },
    );
  });

  it('Departamentos selecionáveis = ativos exatamente quando a função é departamental (P21.b)', () => {
    fc.assert(
      fc.property(universeArb, (u) => {
        const ctx = buildContext(u);
        const role = roleUnderTest(u);
        const cell = evaluateCell(ctx, SERVICE_ID, role, departmentRuleFor(u));

        const deptCandidates = cell.candidates.filter((c) => c.subject.type === 'department');
        const selectableDeptIds = deptCandidates
          .filter((c) => c.selectable)
          .map((c) => c.subject.id)
          .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

        const functionIsDepartmental = u.evaluateDepartmentalRole && u.departmentRoleEnabled;

        if (functionIsDepartmental) {
          // Integralmente: somente Departamentos ativos são selecionáveis.
          expect(selectableDeptIds).toEqual(oracleActiveDepartmentIds(u));
          // Nenhum Departamento inativo aparece como selecionável.
          for (const c of deptCandidates) {
            if (c.selectable) expect(c.active).toBe(true);
          }
        } else {
          // Função não departamental: nenhum Departamento é candidato,
          // portanto nenhum é selecionável e não há responsabilidade.
          expect(deptCandidates).toHaveLength(0);
          expect(cell.departmentResponsibility).toBeUndefined();
        }
      }),
      { numRuns: RUNS },
    );
  });

  it('departmentResponsibilityFor concorda com o oráculo em todos os eixos (P21.c)', () => {
    fc.assert(
      fc.property(universeArb, (u) => {
        const ctx = buildContext(u);
        const rule = departmentRuleFor(u);
        const role = roleUnderTest(u);
        const expectedDeptId = oracleResponsibleDeptId(u);

        // Sem regra departamental, o helper trata a célula como não-departamental.
        const result = rule
          ? departmentResponsibilityFor(SERVICE_ID, role, ctx.externalInputs, rule, ctx.registry)
          : undefined;

        if (expectedDeptId === undefined) {
          expect(result).toBeUndefined();
        } else {
          expect(result?.id).toBe(expectedDeptId);
          expect(result?.status).toBe('active');
        }

        // A função comum NUNCA é responsabilidade departamental, mesmo com a
        // regra habilitada e um Departamento ativo pregando.
        if (rule) {
          const plain = departmentResponsibilityFor(
            SERVICE_ID,
            PLAIN_ROLE,
            ctx.externalInputs,
            rule,
            ctx.registry,
          );
          expect(plain).toBeUndefined();
        }
      }),
      { numRuns: RUNS },
    );
  });
});
