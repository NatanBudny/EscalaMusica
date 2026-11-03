// Feature: gestao-leiga-de-escalas, Property 20: Override de preferência exige justificativa
//
// Property 20 (design.md):
// "Para toda atribuição manual que viole uma Preferencia_de_Escala, o comando é
//  aceito se e somente se a justificativa normalizada for não vazia, e uma
//  aceitação preserva a justificativa junto à atribuição."
//
// Validates: Requisito 5.10
//
// 5.10 (requirements.md):
// "WHEN o Operador escolher uma atribuição que contrarie uma Preferencia_de_Escala,
//  THE Sistema_de_Gestao_Leiga SHALL exigir uma justificativa não vazia e
//  registrar a justificativa com a atribuição antes de salvar a escolha."
//
// Estratégia dos geradores:
//   - Um candidato (Pessoa_Canonica) sempre ELEGÍVEL para a célula: ativo,
//     habilitado para a função, disponível na data e no dia permitido, e SEM
//     nenhuma Regra_Fundamental em conflito. Assim o único obstáculo possível ao
//     aceite é a Preferencia_de_Escala contrariada — isolando exatamente a
//     condição de override da Property 20.
//   - Uma Preferencia_de_Escala aplicável à função e sempre contrariada
//     (`assertion: false`), garantindo que TODA tentativa de atribuir o
//     candidato constitui um override de preferência.
//   - Uma justificativa gerada de forma inteligente para cobrir o espaço de
//     entrada relevante à normalização (trim): strings vazias, só-espaços
//     (espaços, tabs, quebras de linha), e textos não vazios possivelmente
//     cercados por espaços, incluindo Unicode.
//
// Verificações por execução:
//   P20.a  IFF — `applyAssignmentChange` é aceito ⇔ a justificativa tem
//           conteúdo não vazio após `trim()`.
//   P20.b  REJEIÇÃO PRESERVA — quando rejeitado, o código é
//           'preference-needs-justification', a preferência conflitante é
//           reportada e o rascunho recebido NÃO é mutado.
//   P20.c  ACEITE REGISTRA — quando aceito, a atribuição gravada traz a
//           justificativa já com `trim()` aplicado, associada à própria célula.

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { applyAssignmentChange, type EligibilityContext } from './eligibility';
import { RegistryService } from '../registry/registry-service';
import { RuleSetService } from '../rules/rule-set-service';
import { field, lit } from '../rules/predicate';
import { SCHEMA_VERSION } from '../schemas/models';
import type { ApprovedRuleSet, Rule, ScheduleDraft, Service } from '../schemas/models';

// --------------------------------------------------------------------------
// Constantes e builders determinísticos (sem I/O, sem mocks)
// --------------------------------------------------------------------------

const NOW = '2026-02-01T12:00:00Z';
const RS_VERSION = 'rs-1';
const ROLE = 'role-regente';
const SERVICE_ID = 'svc-1';
const SERVICE_DATE = '2026-02-04'; // quarta-feira (gregoriano)
const PERSON_ID = 'p-a';

/** Preferência aplicável à função e sempre contrariada (override garantido). */
const PREFERENCE_RULE: Rule = {
  id: 'pref-1',
  kind: 'preference',
  severity: 'warning',
  applicability: { op: 'eq', args: [field('assignment.roleId'), lit(ROLE)] },
  assertion: { op: 'false' },
  messageTemplate: 'preferencia contrariada',
  allowedExceptionTypeIds: [],
};

function approvedRuleSet(rules: Rule[]): ApprovedRuleSet {
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

function service(): Service {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: SERVICE_ID,
    cycleId: 'cycle-1',
    date: SERVICE_DATE,
    computedWeekday: 'wednesday',
    kind: 'regular',
    externalInputIds: [],
  };
}

function draft(): ScheduleDraft {
  return {
    schemaVersion: SCHEMA_VERSION,
    cycleId: 'cycle-1',
    revision: 'a'.repeat(64),
    assignments: [],
    publicFields: [],
    privateNotes: [],
    createdAt: NOW,
  };
}

/** Cadastro com uma pessoa ELEGÍVEL para a célula (habilitada e no dia). */
function makeRegistry(): RegistryService {
  const reg = new RegistryService();
  const r = reg.addPerson({
    id: PERSON_ID,
    canonicalName: PERSON_ID,
    capabilityIds: [ROLE],
    allowedWeekdays: ['wednesday'],
    now: NOW,
  });
  if (!r.ok) throw new Error(`fixture inválida: ${r.error.message}`);
  return reg;
}

function makeContext(): EligibilityContext {
  return {
    registry: makeRegistry(),
    rules: new RuleSetService([approvedRuleSet([PREFERENCE_RULE])], []),
    ruleSetVersionId: RS_VERSION,
    services: [service()],
    unavailabilities: [],
    propagation: { propagatingLinkTypeIds: new Set<string>() },
    externalInputs: [],
    history: [],
    draft: draft(),
  };
}

// --------------------------------------------------------------------------
// Gerador inteligente de justificativas
// --------------------------------------------------------------------------

/** Caracteres de espaço em branco que `String.prototype.trim()` remove. */
const WHITESPACE = [' ', '\t', '\n', '\r', '\f', '\v', '\u00a0', '\u2028'];

const whitespaceRun = fc
  .array(fc.constantFrom(...WHITESPACE), { minLength: 0, maxLength: 6 })
  .map((xs) => xs.join(''));

// Texto não vazio que, após trim, continua não vazio (contém ao menos um
// caractere que não é whitespace). Inclui Unicode.
const nonBlankCore = fc
  .string({ minLength: 1, maxLength: 20, unit: 'grapheme' })
  .filter((s) => s.trim().length > 0);

// Justificativas que resultam EM vazio após trim: '' ou só whitespace.
const blankJustification = fc.oneof(fc.constant(''), whitespaceRun.filter((s) => s.length > 0));

// Justificativas que resultam EM conteúdo após trim, com espaços nas bordas.
const contentJustification = fc
  .tuple(whitespaceRun, nonBlankCore, whitespaceRun)
  .map(([a, core, b]) => `${a}${core}${b}`);

// Mistura: às vezes undefined (ausente), às vezes em branco, às vezes com texto.
const anyJustification = fc.oneof(
  fc.constant(undefined),
  blankJustification,
  contentJustification,
);

// --------------------------------------------------------------------------
// Property 20
// --------------------------------------------------------------------------

describe('Property 20 - override de preferência exige justificativa (5.10)', () => {
  it('aceita sse a justificativa normalizada é não vazia; preserva rascunho na rejeição; registra justificativa aparada no aceite', () => {
    fc.assert(
      fc.property(anyJustification, (justification) => {
        const ctx = makeContext();
        const snapshotBefore = structuredClone(ctx.draft);

        const change: Parameters<typeof applyAssignmentChange>[1] = {
          serviceId: SERVICE_ID,
          roleId: ROLE,
          subject: { type: 'person', id: PERSON_ID },
        };
        if (justification !== undefined) change.preferenceOverrideReason = justification;

        const result = applyAssignmentChange(ctx, change);

        const expectedAccepted =
          justification !== undefined && justification.trim().length > 0;

        // P20.a — IFF entre aceite e justificativa não vazia após trim.
        expect(result.ok).toBe(expectedAccepted);

        if (!result.ok) {
          // P20.b — rejeição por falta de justificativa, com conflito reportado
          // e rascunho de entrada preservado (nenhuma mutação).
          expect(result.error.code).toBe('preference-needs-justification');
          expect(result.error.conflicts?.map((c) => c.ruleId)).toContain('pref-1');
          expect(ctx.draft).toEqual(snapshotBefore);
          return;
        }

        // P20.c — aceite registra a justificativa já aparada na própria célula.
        const stored = result.draft.assignments.find(
          (a) => a.serviceId === SERVICE_ID && a.roleId === ROLE,
        );
        expect(stored).toBeDefined();
        expect(stored?.subject).toEqual({ type: 'person', id: PERSON_ID });
        expect(stored?.preferenceOverrideReason).toBe(justification!.trim());
        // O rascunho de entrada permanece imutável também no caminho de aceite.
        expect(ctx.draft).toEqual(snapshotBefore);
      }),
      { numRuns: 300 },
    );
  });
});
