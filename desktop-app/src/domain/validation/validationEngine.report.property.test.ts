// Feature: gestao-leiga-de-escalas, Property 29: Relatório de validação é consistente
//
// Teste baseado em propriedade (tarefa 8.7) que prova a Property 29 do design
// (design.md -> "Property 29: Relatório de validação é consistente"):
//
//   "Para todo ValidationReport completo, Bloqueios, Avisos e aprovações formam
//    conjuntos disjuntos, suas contagens correspondem às relações apresentadas e
//    revisão e versão de regras correspondem às entradas avaliadas."
//
// Valida: Requisito 7.24 (requirements.md): "WHEN a validação completa terminar,
// THE Validador SHALL apresentar a revisão do Rascunho e a versão do
// Conjunto_de_Regras_Ativo validadas, os totais separados de Bloqueios, Avisos e
// verificações aprovadas e a relação individual de cada resultado."
//
// Estrategia: um gerador INTELIGENTE constroi `ValidationInput` variados e
// VALIDOS estruturalmente (cultos, atribuicoes, pessoas, regras e config
// estrutural) que exercitam simultaneamente Bloqueios (ex.: identidade ausente,
// RF violada, tamanho de equipe) e Avisos (ex.: contato publico ausente,
// preferencia nao atendida). O gerador usa datas ISO civis DETERMINISTICAS
// construidas a partir de inteiros (ano/mes/dia), evitando `fc.date()` /
// `toISOString()` que introduzem flutuacao de fuso/horario.
//
// Sem mocks: usa os modelos canonicos reais e o engine puro.

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  validateComplete,
  type RuleSetStructuralConfig,
  type ValidationInput,
} from './validationEngine';
import { field, lit } from '../rules/predicate';
import { SCHEMA_VERSION } from '../schemas/models';
import type {
  ApprovedRuleSet,
  Assignment,
  Person,
  Rule,
  ScheduleDraft,
  Service,
  ValidationReport,
} from '../schemas/models';

// --------------------------------------------------------------------------
// Constantes deterministicas
// --------------------------------------------------------------------------

const NOW = '2026-02-01T12:00:00Z';
const CYCLE_ID = 'cycle-1';

const ROLE_REGENTE = 'role-regente';
const ROLE_EQUIPE = 'role-equipe';
const ROLE_MENSAGEM = 'role-mensagem';

// Fevereiro de 2026 (28 dias). Cada "dia" do gerador vira uma data civil
// ISO `YYYY-MM-DD` construida por aritmetica de inteiros, sem Date/locale.
const YEAR = 2026;
const MONTH = 2;

/** Constroi uma data ISO civil deterministica para fevereiro/2026. */
function isoDate(day: number): string {
  const dd = String(day).padStart(2, '0');
  const mm = String(MONTH).padStart(2, '0');
  return `${YEAR}-${mm}-${dd}`;
}

/** Dia da semana civil deterministico (independe de fuso). */
function weekdayOf(day: number): Service['computedWeekday'] {
  // 2026-02-01 e um domingo. Indexacao 0=sunday..6=saturday.
  const names: Service['computedWeekday'][] = [
    'sunday',
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
  ];
  const idx = ((day - 1) % 7 + 7) % 7;
  return names[idx] as Service['computedWeekday'];
}

// --------------------------------------------------------------------------
// Builders canonicos deterministicos
// --------------------------------------------------------------------------

function person(id: string, caps: string[]): Person {
  return {
    schemaVersion: SCHEMA_VERSION,
    id,
    canonicalName: id,
    aliases: [],
    participation: 'active',
    publicContactAuthorizationIds: [],
    capabilityIds: caps,
    allowedWeekdays: ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'],
    leaves: [],
    links: [],
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function service(id: string, day: number): Service {
  return {
    schemaVersion: SCHEMA_VERSION,
    id,
    cycleId: CYCLE_ID,
    date: isoDate(day),
    computedWeekday: weekdayOf(day),
    kind: 'regular',
    externalInputIds: [],
  };
}

function assignment(id: string, serviceId: string, roleId: string, subjectId: string): Assignment {
  return { id, serviceId, roleId, subject: { type: 'person', id: subjectId }, source: 'manual' };
}

function draft(revision: string, assignments: Assignment[]): ScheduleDraft {
  return {
    schemaVersion: SCHEMA_VERSION,
    cycleId: CYCLE_ID,
    revision,
    assignments,
    publicFields: [],
    privateNotes: [],
    createdAt: NOW,
  };
}

function ruleSet(version: string, rules: Rule[]): ApprovedRuleSet {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: 'rs-1',
    version,
    status: 'approved',
    validFrom: isoDate(1),
    validUntil: isoDate(28),
    rules,
    sourceDecisions: [],
    approvedBy: 'op-1',
    approvedAt: NOW,
    createdAt: NOW,
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

/** Preferencia (Aviso) ou Regra_Fundamental (Bloqueio) sempre violada. */
function alwaysViolatedRule(kind: 'fundamental' | 'preference', roleId: string): Rule {
  return {
    id: kind === 'fundamental' ? 'rf-gen' : 'pref-gen',
    kind,
    severity: kind === 'fundamental' ? 'blocking' : 'warning',
    applicability: { op: 'eq', args: [field('assignment.roleId'), lit(roleId)] },
    assertion: { op: 'false' },
    messageTemplate: 'ajuste a atribuicao',
    allowedExceptionTypeIds: [],
  };
}

// --------------------------------------------------------------------------
// Gerador inteligente de ValidationInput
// --------------------------------------------------------------------------

/**
 * Gera um `ValidationInput` valido e variado. Controla explicitamente as
 * dimensoes que afetam os resultados do relatorio:
 *  - revisao (sha256-like) e versao de regras (identificacao, 7.24);
 *  - quantidade e datas dos cultos (datas deterministicas, possivelmente
 *    duplicadas para exercitar Bloqueio de duplicidade);
 *  - atribuicoes a pessoas existentes/inexistentes (Bloqueio de identidade);
 *  - presenca de regra RF violada (Bloqueio) e/ou preferencia (Aviso);
 *  - exigencia de contato publico (Aviso) sem contato cadastrado.
 */
const inputArb: fc.Arbitrary<ValidationInput> = fc
  .record({
    // Revisao estilo sha256: 64 digitos hexadecimais deterministicos.
    revision: fc
      .array(fc.constantFrom(...'0123456789abcdef'.split('')), { minLength: 64, maxLength: 64 })
      .map((chars) => chars.join('')),
    ruleSetVersion: fc.constantFrom('v1', 'v2', 'v3', 'v2026-02'),
    // Dias civis distintos ou nao (permite duplicidade => Bloqueio 7.6).
    days: fc.array(fc.integer({ min: 1, max: 28 }), { minLength: 1, maxLength: 6 }),
    // Numero de pessoas cadastradas.
    peopleCount: fc.integer({ min: 0, max: 4 }),
    // Para cada culto, a funcao e se o sujeito existe no cadastro.
    useFundamental: fc.boolean(),
    usePreference: fc.boolean(),
    requireContact: fc.boolean(),
    // Semente para escolher sujeitos existentes vs fantasmas por atribuicao.
    subjectChoices: fc.array(fc.integer({ min: 0, max: 5 }), { minLength: 1, maxLength: 6 }),
    roleChoice: fc.constantFrom(ROLE_REGENTE, ROLE_EQUIPE, ROLE_MENSAGEM),
  })
  .map((g) => {
    const services: Service[] = g.days.map((day, i) => service(`svc-${i}`, day));

    // Pessoas habilitadas para TODAS as funcoes usadas (evita ruido de 7.16).
    const allRoles = [ROLE_REGENTE, ROLE_EQUIPE, ROLE_MENSAGEM];
    const people: Person[] = Array.from({ length: g.peopleCount }, (_, i) =>
      person(`p-${i}`, allRoles),
    );

    // Uma atribuicao por culto; o sujeito pode ser existente ou "fantasma".
    const assignments: Assignment[] = services.map((svc, i) => {
      const choice = g.subjectChoices[i % g.subjectChoices.length] ?? 0;
      const subjectId =
        g.peopleCount > 0 && choice < g.peopleCount ? `p-${choice}` : `fantasma-${i}`;
      return assignment(`a-${i}`, svc.id, g.roleChoice, subjectId);
    });

    const rules: Rule[] = [];
    if (g.useFundamental) rules.push(alwaysViolatedRule('fundamental', g.roleChoice));
    if (g.usePreference) rules.push(alwaysViolatedRule('preference', g.roleChoice));

    const structural: RuleSetStructuralConfig = g.requireContact
      ? { ...EMPTY_STRUCTURAL, communicationRoleIds: [g.roleChoice] }
      : EMPTY_STRUCTURAL;

    const input: ValidationInput = {
      cycleId: CYCLE_ID,
      draft: draft(g.revision, assignments),
      services,
      externalInputs: [],
      unavailabilities: [],
      people,
      departments: [],
      ruleSet: ruleSet(g.ruleSetVersion, rules),
      exceptions: [],
      structural,
      peopleWithPublicContact: new Set<string>(),
    };
    return input;
  });

// Numero total de verificacoes do catalogo (STRUCTURAL_CHECK_IDS). Qualquer
// verificacao aplicada sem achado conta para passedCount; as demais produziram
// achados. Logo: passedCount <= TOTAL_CHECKS e passedCount >= 0.
const TOTAL_CHECKS = 18;

// --------------------------------------------------------------------------
// Property 29
// --------------------------------------------------------------------------

describe('ValidationEngine - Property 29: relatorio de validacao consistente (7.24)', () => {
  it('bloqueios/avisos/aprovacoes disjuntos, contagens coerentes e identificacao fiel', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const report: ValidationReport = validateComplete(input);

        // (a) Identificacao: revisao, versao e ciclo validados == entradas.
        expect(report.status).toBe('complete');
        expect(report.draftRevision).toBe(input.draft.revision);
        expect(report.ruleSetVersion).toBe(input.ruleSet.version);
        expect(report.cycleId).toBe(input.cycleId);

        // (b) Disjuncao por severidade: cada relacao so contem a sua severidade.
        expect(report.blocking.every((f) => f.severity === 'blocking')).toBe(true);
        expect(report.warnings.every((f) => f.severity === 'warning')).toBe(true);

        // (c) Disjuncao por identidade: nenhum findingId aparece em ambas as
        //     relacoes (Bloqueios e Avisos sao conjuntos disjuntos).
        const blockingIds = report.blocking.map((f) => f.findingId);
        const warningIds = report.warnings.map((f) => f.findingId);
        const blockingSet = new Set(blockingIds);
        const warningSet = new Set(warningIds);
        for (const id of warningIds) expect(blockingSet.has(id)).toBe(false);

        // (d) Ids unicos dentro de cada relacao (sem duplicatas).
        expect(blockingSet.size).toBe(blockingIds.length);
        expect(warningSet.size).toBe(warningIds.length);

        // (e) Contagens coerentes com as relacoes apresentadas: o total de
        //     achados distintos mais as verificacoes aprovadas corresponde ao
        //     catalogo de verificacoes aplicadas. Como uma mesma verificacao
        //     pode gerar multiplos achados, usamos limites:
        //       - toda verificacao aprovada nao gera achado;
        //       - passedCount esta em [0, TOTAL_CHECKS];
        //       - se ha qualquer achado, nem todas as verificacoes passaram.
        expect(report.passedCount).toBeGreaterThanOrEqual(0);
        expect(report.passedCount).toBeLessThanOrEqual(TOTAL_CHECKS);
        const totalFindings = report.blocking.length + report.warnings.length;
        if (totalFindings > 0) {
          expect(report.passedCount).toBeLessThan(TOTAL_CHECKS);
        }
        // O numero de verificacoes que produziram pelo menos um achado nao pode
        // exceder (TOTAL_CHECKS - passedCount) nem o total de achados.
        const checksWithFindings = TOTAL_CHECKS - report.passedCount;
        expect(checksWithFindings).toBeLessThanOrEqual(totalFindings);

        // (f) Cada achado tem os campos minimos exigidos pela relacao individual
        //     (7.24: regra, severidade, motivo e acao necessaria).
        for (const f of [...report.blocking, ...report.warnings]) {
          expect(typeof f.findingId).toBe('string');
          expect(f.findingId.length).toBeGreaterThan(0);
          expect(typeof f.ruleId).toBe('string');
          expect(f.ruleId.length).toBeGreaterThan(0);
          expect(f.reason.length).toBeGreaterThan(0);
          expect(f.requiredAction.length).toBeGreaterThan(0);
          expect(f.severity === 'blocking' || f.severity === 'warning').toBe(true);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('determinismo: a mesma entrada sempre produz exatamente o mesmo relatorio', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const r1 = validateComplete(input);
        const r2 = validateComplete(input);
        // reportId e createdAt deterministicos (funcao da entrada versionada).
        expect(r1.reportId).toBe(r2.reportId);
        expect(r1.createdAt).toBe(r2.createdAt);
        expect(r1.passedCount).toBe(r2.passedCount);
        // Mesma relacao de achados, na mesma ordem e com os mesmos ids.
        expect(r1.blocking.map((f) => f.findingId)).toEqual(r2.blocking.map((f) => f.findingId));
        expect(r1.warnings.map((f) => f.findingId)).toEqual(r2.warnings.map((f) => f.findingId));
        // Igualdade estrutural completa do relatorio.
        expect(r1).toEqual(r2);
      }),
      { numRuns: 200 },
    );
  });
});
