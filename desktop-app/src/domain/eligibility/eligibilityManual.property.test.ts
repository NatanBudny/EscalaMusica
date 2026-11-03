// Feature: gestao-leiga-de-escalas, Property 16: Elegibilidade manual corresponde às regras
//
// Property 16 (design.md):
// "Para todo culto, função e cadastro, o conjunto de sujeitos selecionáveis é
//  exatamente o conjunto de Pessoas_Canonicas ativas e habilitadas, disponíveis
//  no dia e sem conflito fundamental, acrescido somente dos Departamentos
//  permitidos pela versão de regras do ciclo."
//
// Validates: Requirements 5.2, 5.3, 5.4, 7.13, 7.15, 7.16
//
// Estratégia: geradores inteligentes constroem, para UM culto e UMA função,
// um universo variando exatamente os eixos de elegibilidade de uma pessoa:
//   - estado de participação (ativa/inativa)                         -> 5.2 / 7.16
//   - habilitação para a função (capabilityIds inclui o roleId)      -> 5.2 / 7.16
//   - dia da semana permitido (allowedWeekdays)                      -> 7.16
//   - disponibilidade na data (indisponibilidade efetiva)           -> 5.4 / 7.13
//   - conflito com Regra_Fundamental (RF sempre violada quando       -> 7.15
//     aplicável à função), coberto ou não por Excecao_Aprovada vigente
// e, separadamente, Departamentos (ativos/inativos) quando a função admite
// responsabilidade departamental (5.2: Departamento quando o conjunto de regras
// permite).
//
// Verificamos três obrigações da propriedade com um ORÁCULO INDEPENDENTE que
// NÃO chama `selectableSubjects`/`evaluateCell`/`applyAssignmentChange`:
//
//   P16.a  CONJUNTO EXATO — `selectableSubjects(cell)` é EXATAMENTE o conjunto
//          calculado pelo oráculo: pessoas ativas ∧ habilitadas ∧ disponíveis
//          no dia ∧ dia permitido ∧ sem RF violada em aberto, acrescido somente
//          dos Departamentos ativos quando a função é departamental. Sem sobra
//          nem falta (5.2, 5.3, 5.4, 7.13, 7.15, 7.16).
//
//   P16.b  ACEITAÇÃO ⇒ SELECIONÁVEL — para TODO sujeito, `applyAssignmentChange`
//          aceita a atribuição se e somente se o sujeito é selecionável pelo
//          oráculo; toda atribuição aceita usa um sujeito selecionável (5.2).
//
//   P16.c  REJEIÇÃO PRESERVA O RASCUNHO — quando o sujeito é inelegível, a
//          operação é rejeitada e o rascunho recebido permanece intacto
//          (nenhuma mutação); o erro aponta a restrição (habilitação/
//          disponibilidade/dia/estado) ou a violação de RF.
//
// Sem mocks: usa o RegistryService e o RuleSetService reais com fixtures
// determinísticas, exatamente como os demais testes do domínio.

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  applyAssignmentChange,
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
  IsoDate,
  Rule,
  ScheduleDraft,
  Service,
  Unavailability,
  Weekday,
} from '../schemas/models';

// No mínimo 100 execuções (Notas do tasks.md); seed/replayPath aparecem em falha.
const RUNS = 300;

const NOW = '2026-02-01T12:00:00Z';
const RS_VERSION = 'rs-1';
// A elegibilidade trata o roleId como a própria habilitação (capabilityId):
// `capable = person.capabilityIds.includes(roleId)`.
const ROLE = 'role-sob-teste';
const SERVICE_ID = 'svc-1';
const CYCLE_ID = 'cycle-1';
// Culto fixo: quarta-feira 2026-02-04 (data real do calendário gregoriano).
const SERVICE_DATE: IsoDate = '2026-02-04';
const SERVICE_WEEKDAY: Weekday = 'wednesday';

// --------------------------------------------------------------------------
// Especificação gerada de UMA pessoa (os cinco eixos de elegibilidade).
// --------------------------------------------------------------------------

interface PersonSpec {
  active: boolean;
  capable: boolean;
  /** Dia da semana permitido inclui a quarta do culto? (vazio = todos). */
  weekdayAllowed: boolean;
  /** Indisponível na data do culto? */
  unavailable: boolean;
}

interface DeptSpec {
  active: boolean;
}

interface Universe {
  people: PersonSpec[];
  departments: DeptSpec[];
  /** Existe uma RF que sempre viola quem for atribuído a esta função? */
  hasFundamentalRule: boolean;
  /** A RF está coberta por uma Excecao_Aprovada vigente para a data? */
  exceptionInForce: boolean;
  /** A função admite responsabilidade departamental nesta versão de regras? */
  departmentRoleAllowed: boolean;
}

const personSpecArb: fc.Arbitrary<PersonSpec> = fc.record({
  active: fc.boolean(),
  capable: fc.boolean(),
  weekdayAllowed: fc.boolean(),
  unavailable: fc.boolean(),
});

const universeArb: fc.Arbitrary<Universe> = fc.record({
  people: fc.array(personSpecArb, { minLength: 0, maxLength: 6 }),
  departments: fc.array(fc.record({ active: fc.boolean() }), { minLength: 0, maxLength: 3 }),
  hasFundamentalRule: fc.boolean(),
  exceptionInForce: fc.boolean(),
  departmentRoleAllowed: fc.boolean(),
});

// --------------------------------------------------------------------------
// Ids determinísticos por índice.
// --------------------------------------------------------------------------

const personId = (i: number): string => `p-${String(i).padStart(3, '0')}`;
const deptId = (i: number): string => `d-${String(i).padStart(3, '0')}`;

const OTHER_WEEKDAY: Weekday = 'saturday'; // ≠ quarta: torna o dia não permitido.

// --------------------------------------------------------------------------
// Construção dos serviços reais do domínio (sem mocks).
// --------------------------------------------------------------------------

function buildRegistry(u: Universe): RegistryService {
  const reg = new RegistryService();
  u.people.forEach((spec, i) => {
    const id = personId(i);
    const res = reg.addPerson({
      id,
      canonicalName: id,
      // Habilitação: inclui o ROLE quando `capable`; caso contrário, outra cap.
      capabilityIds: spec.capable ? [ROLE] : ['cap-outra'],
      // Dia permitido: quarta quando `weekdayAllowed`; caso contrário, sábado.
      // (lista vazia significaria "todos os dias" — evitamos para controlar o eixo.)
      allowedWeekdays: spec.weekdayAllowed ? [SERVICE_WEEKDAY] : [OTHER_WEEKDAY],
      now: NOW,
    });
    if (!res.ok) throw new Error(`fixture inválida (pessoa ${id}): ${res.error.message}`);
    if (!spec.active) {
      const d = reg.deactivatePerson(id, NOW);
      if (!d.ok) throw new Error(`fixture inválida (desativar ${id}): ${d.error.message}`);
    }
  });
  u.departments.forEach((_spec, i) => {
    const id = deptId(i);
    const res = reg.addDepartment({ id, canonicalName: id, now: NOW });
    if (!res.ok) throw new Error(`fixture inválida (dep ${id}): ${res.error.message}`);
    // Não há comando de desativar departamento no serviço; departamentos
    // inativos são construídos a partir de um snapshot.
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

/** RF que é sempre violada quando aplicável à função sob teste. */
function blockingRule(): Rule {
  return {
    id: 'rf-block',
    kind: 'fundamental',
    severity: 'blocking',
    applicability: { op: 'eq', args: [field('assignment.roleId'), lit(ROLE)] },
    assertion: { op: 'false' }, // sempre violada quando aplicável
    messageTemplate: 'RF sempre violada para a função sob teste',
    allowedExceptionTypeIds: [],
  };
}

function ruleSet(rules: Rule[]): ApprovedRuleSet {
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

function buildRules(u: Universe): RuleSetService {
  const rules: Rule[] = u.hasFundamentalRule ? [blockingRule()] : [];
  const exceptions: ApprovedException[] = [];
  if (u.hasFundamentalRule && u.exceptionInForce) {
    exceptions.push({
      schemaVersion: SCHEMA_VERSION,
      id: 'exc-1',
      fundamentalRuleId: 'rf-block',
      condition: { op: 'true' }, // cobre qualquer candidato
      validFrom: '2026-02-01',
      validUntil: '2026-02-28', // vigente para a data do culto (2026-02-04)
      justification: 'excecao vigente de teste',
      approvedBy: 'op-1',
      approvedAt: NOW,
    });
  }
  return new RuleSetService([ruleSet(rules)], exceptions);
}

function buildUnavailabilities(u: Universe): Unavailability[] {
  const unavs: Unavailability[] = [];
  u.people.forEach((spec, i) => {
    if (!spec.unavailable) return;
    unavs.push({
      schemaVersion: SCHEMA_VERSION,
      id: `u-${i}`,
      cycleId: CYCLE_ID,
      personId: personId(i),
      scope: { type: 'dates', dates: [SERVICE_DATE] },
      source: 'teste',
      createdAt: NOW,
    });
  });
  return unavs;
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
    rules: buildRules(u),
    ruleSetVersionId: RS_VERSION,
    services: [service()],
    unavailabilities: buildUnavailabilities(u),
    propagation: { propagatingLinkTypeIds: new Set<string>() },
    externalInputs: [],
    history: [],
    draft: emptyDraft(),
  };
}

function departmentRuleFor(u: Universe): DepartmentResponsibilityRule | undefined {
  return u.departmentRoleAllowed ? { roleIds: [ROLE] } : undefined;
}

// --------------------------------------------------------------------------
// Oráculo independente (NÃO reusa a lógica sob teste).
// --------------------------------------------------------------------------

type Subject = { type: 'person' | 'department'; id: string };

/**
 * Conjunto esperado de sujeitos selecionáveis, calculado diretamente dos
 * eixos gerados, sem passar pelo módulo de elegibilidade:
 *  - pessoa selecionável ⇔ ativa ∧ habilitada ∧ disponível ∧ dia permitido ∧
 *    (sem RF aplicável OU RF coberta por exceção vigente);
 *  - departamento selecionável ⇔ ativo, SOMENTE quando a função é departamental.
 */
function oracleSelectable(u: Universe): Subject[] {
  const subjects: Subject[] = [];

  // Uma RF aplicável à função fica "em aberto" (viola) a menos que uma exceção
  // vigente a cubra. Como a RF sempre viola quando aplicável e a exceção (quando
  // existe) cobre qualquer candidato na data do culto, o eixo é uniforme.
  const fundamentalOpen = u.hasFundamentalRule && !u.exceptionInForce;

  u.people.forEach((spec, i) => {
    const selectable =
      spec.active && spec.capable && !spec.unavailable && spec.weekdayAllowed && !fundamentalOpen;
    if (selectable) subjects.push({ type: 'person', id: personId(i) });
  });

  if (u.departmentRoleAllowed) {
    u.departments.forEach((spec, i) => {
      if (spec.active) subjects.push({ type: 'department', id: deptId(i) });
    });
  }

  return subjects;
}

const subjectKey = (s: Subject): string => `${s.type}\u0000${s.id}`;

function keySet(subjects: readonly Subject[]): Set<string> {
  return new Set(subjects.map(subjectKey));
}

/** Todos os sujeitos candidatos do universo (pessoas + departamentos). */
function allSubjects(u: Universe): Subject[] {
  const subjects: Subject[] = [];
  u.people.forEach((_, i) => subjects.push({ type: 'person', id: personId(i) }));
  u.departments.forEach((_, i) => subjects.push({ type: 'department', id: deptId(i) }));
  return subjects;
}

// --------------------------------------------------------------------------
// Propriedade 16.
// --------------------------------------------------------------------------

describe('Property 16: elegibilidade manual corresponde às regras (5.2, 5.3, 5.4, 7.13, 7.15, 7.16)', () => {
  it('o conjunto de selecionáveis é exatamente o esperado pelo oráculo independente (P16.a)', () => {
    fc.assert(
      fc.property(universeArb, (u) => {
        const ctx = buildContext(u);
        const actual = selectableSubjects(ctx, SERVICE_ID, ROLE, departmentRuleFor(u));
        const expected = oracleSelectable(u);

        expect(keySet(actual)).toEqual(keySet(expected));
        // Sem duplicatas na saída.
        expect(actual.length).toBe(keySet(actual).size);
        // A ordem é estável por (tipo, id): pessoas antes de departamentos.
        const sorted = [...actual].sort((a, b) =>
          a.type !== b.type
            ? a.type === 'person'
              ? -1
              : 1
            : a.id < b.id
              ? -1
              : a.id > b.id
                ? 1
                : 0,
        );
        expect(actual).toEqual(sorted);
      }),
      { numRuns: RUNS },
    );
  });

  it('uma atribuição é aceita se e somente se o sujeito é selecionável, e aceita usa sujeito selecionável (P16.b)', () => {
    fc.assert(
      fc.property(universeArb, (u) => {
        const ctx = buildContext(u);
        const expected = keySet(oracleSelectable(u));
        const deptRule = departmentRuleFor(u);

        for (const subject of allSubjects(u)) {
          const result = applyAssignmentChange(
            ctx,
            { serviceId: SERVICE_ID, roleId: ROLE, subject },
            deptRule,
          );
          const isSelectable = expected.has(subjectKey(subject));
          expect(result.ok).toBe(isSelectable);
          if (result.ok) {
            // Toda atribuição aceita usa EXATAMENTE o sujeito escolhido, que é
            // selecionável (5.2).
            expect(result.draft.assignments).toHaveLength(1);
            const assigned = result.draft.assignments[0];
            expect(assigned?.subject).toEqual(subject);
            expect(expected.has(subjectKey(subject))).toBe(true);
          }
        }
      }),
      { numRuns: RUNS },
    );
  });

  it('sujeito inelegível é rejeitado preservando o rascunho e apontando a restrição (P16.c)', () => {
    fc.assert(
      fc.property(universeArb, (u) => {
        const ctx = buildContext(u);
        const expected = keySet(oracleSelectable(u));
        const deptRule = departmentRuleFor(u);
        const before = structuredClone(ctx.draft);

        for (const subject of allSubjects(u)) {
          if (expected.has(subjectKey(subject))) continue; // só inelegíveis
          const result = applyAssignmentChange(
            ctx,
            { serviceId: SERVICE_ID, roleId: ROLE, subject },
            deptRule,
          );
          expect(result.ok).toBe(false);
          if (!result.ok) {
            // A causa é ou a restrição (habilitação/disponibilidade/dia/estado)
            // ou a violação de RF sem exceção vigente.
            expect(['not-selectable', 'fundamental-violation']).toContain(result.error.code);
          }
          // O rascunho recebido permanece intacto (nenhuma mutação).
          expect(ctx.draft).toEqual(before);
        }
      }),
      { numRuns: RUNS },
    );
  });
});
