// Feature: gestao-leiga-de-escalas, Property 28: Gate de publicação depende da revisão atual
//
// Teste baseado em propriedade (tarefa 8.6) que prova a Property 28 do design
// (design.md -> "Property 28: Gate de publicação depende da revisão atual"):
//
//   "Para todo estado de validação, prévia e aprovação, publicar está habilitado
//    se e somente se a validação completa da revisão atual terminou sem
//    Bloqueios, a prévia e aprovação referenciam essa mesma revisão e rule set,
//    todos os Avisos foram reconhecidos e o período coincide."
//
// Valida: Requisitos 7.23, 8.1, 8.6, 8.8, 8.9, 8.10, 14.8 (requirements.md):
//  7.23 ENQUANTO existir Bloqueio para a revisão atual OU a validação completa
//       dessa revisão não tiver terminado, o Publicador mantém a publicação
//       desabilitada (gate FECHADO).
//  8.1  QUANDO a validação completa do Rascunho terminar SEM Bloqueios, o sistema
//       gera uma Previa_Publica vinculada à versão validada do Rascunho — o zero
//       de bloqueios habilita apenas o avanço, nunca a publicação direta.
//  8.6  QUANDO a Previa_Publica contiver Avisos, o Aprovador deve registrar
//       ciência de cada Aviso ANTES de permitir a aprovação (avisos sozinhos
//       nunca fecham o gate, mas precisam ser reconhecidos para aprovar).
//  8.8  SE o Rascunho mudar depois da aprovação, a aprovação anterior é
//       invalidada (prévia/aprovação de revisão ANTIGA não abre o gate).
//  8.9  SE o período da Previa_Publica divergir do período de publicação, o
//       Publicador bloqueia a publicação (gate FECHADO).
//  8.10 SE o Aprovador tentar aprovar sem Previa_Publica da versão atual, com
//       Bloqueios, ou sem ciência de cada Aviso, a aprovação é rejeitada.
//  14.8 SE uma revisão pós-publicação for alterada depois da aprovação, a
//       aprovação é invalidada e a publicação impedida até nova validação sem
//       Bloqueios e nova aprovação (mesma dependência de "revisão atual").
//
// A parte de VALIDAÇÃO do gate é exercitada pelo engine REAL (validateComplete /
// canPublish): nenhum modelo paralelo de validação é construído. A ligação com
// prévia e aprovação (revisão/rule set/período/avisos reconhecidos) ainda não
// possui serviço dedicado (ApprovalService é tarefa 10.2); aqui ela é modelada
// como um predicado PURO de gate sobre o relatório real, representando a
// "revisão atual" versus a revisão à qual prévia e aprovação estão vinculadas.
//
// Datas ISO civis são construídas por aritmética de inteiros (ano/mês/dia), sem
// `fc.date()` nem `toISOString()`, evitando flutuação de fuso/horário.

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  canPublish,
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

const YEAR = 2026;
const MONTH = 2; // fevereiro/2026 (28 dias)
const PERIOD: string = '2026-02';

/** Data ISO civil deterministica para fevereiro/2026 (sem Date/locale). */
function isoDate(day: number): string {
  const dd = String(day).padStart(2, '0');
  const mm = String(MONTH).padStart(2, '0');
  return `${YEAR}-${mm}-${dd}`;
}

/** Dia da semana civil deterministico (2026-02-01 e um domingo). */
function weekdayOf(day: number): Service['computedWeekday'] {
  const names: Service['computedWeekday'][] = [
    'sunday',
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
  ];
  const idx = (((day - 1) % 7) + 7) % 7;
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
// Modelo PURO do gate de publicacao (Property 28)
// --------------------------------------------------------------------------

/**
 * Estado observavel de prevendo/aprovacao em relacao a revisao ATUAL. A validacao
 * em si vem do engine real (ver `buildInput`); este estado representa apenas o
 * que a UI/saga precisaria conferir para liberar a publicacao.
 */
interface GateState {
  /** Relatorio da validacao completa da revisao que foi efetivamente validada. */
  report: ValidationReport;
  /** Revisao ATUAL do rascunho (fonte da verdade do gate). */
  currentRevision: string;
  /** Versao do rule set ATUAL vinculada ao ciclo. */
  currentRuleSetVersion: string;
  /** Revisao a qual a prevendo/aprovacao esta vinculada. */
  approvedRevision: string;
  /** Versao do rule set referenciada pela prevendo/aprovacao. */
  approvedRuleSetVersion: string;
  /** Periodo da Previa_Publica. */
  previewPeriod: string;
  /** Periodo selecionado para publicacao. */
  publicationPeriod: string;
  /** Se cada Aviso do relatorio foi reconhecido pelo Aprovador. */
  allWarningsAcknowledged: boolean;
}

/**
 * Gate de publicacao da Property 28. Publicar e habilitado SE E SOMENTE SE:
 *  (1) a validacao COMPLETA sem Bloqueios (engine real -> `canPublish`), 7.23/8.1;
 *  (2) a validacao foi feita sobre a revisao ATUAL (nao desatualizada), 7.23/8.8/14.8;
 *  (3) prevendo/aprovacao referenciam a MESMA revisao atual, 8.8/8.10/14.8;
 *  (4) prevendo/aprovacao referenciam o MESMO rule set validado, 8.10;
 *  (5) o periodo da prevendo coincide com o periodo de publicacao, 8.9;
 *  (6) todos os Avisos foram reconhecidos, 8.6/8.10.
 */
function publicationGateOpen(g: GateState): boolean {
  const validationOk = canPublish(g.report) && g.report.draftRevision === g.currentRevision;
  const revisionBound = g.approvedRevision === g.currentRevision;
  const ruleSetBound =
    g.approvedRuleSetVersion === g.currentRuleSetVersion &&
    g.report.ruleSetVersion === g.currentRuleSetVersion;
  const periodMatches = g.previewPeriod === g.publicationPeriod;
  const warningsOk = g.allWarningsAcknowledged;
  return validationOk && revisionBound && ruleSetBound && periodMatches && warningsOk;
}

// --------------------------------------------------------------------------
// Gerador inteligente de entradas de validacao
// --------------------------------------------------------------------------

interface Generated {
  revision: string;
  ruleSetVersion: string;
  input: ValidationInput;
}

/** Sha256-like deterministico: 64 hex a partir de um seed. */
const hex64Arb: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(...'0123456789abcdef'.split('')), { minLength: 64, maxLength: 64 })
  .map((chars) => chars.join(''));

/**
 * Gera um `ValidationInput` valido e variado, controlando se ha Bloqueio (RF
 * violada / identidade ausente) e/ou Aviso (preferencia violada). Assim o engine
 * real produz relatorios com e sem bloqueios, exercitando os dois lados do gate.
 */
const generatedArb: fc.Arbitrary<Generated> = fc
  .record({
    revision: hex64Arb,
    ruleSetVersion: fc.constantFrom('v1', 'v2', 'v3', 'v2026-02'),
    days: fc.array(fc.integer({ min: 1, max: 28 }), { minLength: 1, maxLength: 5 }),
    peopleCount: fc.integer({ min: 0, max: 3 }),
    useFundamental: fc.boolean(),
    usePreference: fc.boolean(),
    subjectChoices: fc.array(fc.integer({ min: 0, max: 4 }), { minLength: 1, maxLength: 5 }),
    roleChoice: fc.constantFrom(ROLE_REGENTE, ROLE_EQUIPE, ROLE_MENSAGEM),
  })
  .map((g) => {
    const services: Service[] = g.days.map((day, i) => service(`svc-${i}`, day));
    const allRoles = [ROLE_REGENTE, ROLE_EQUIPE, ROLE_MENSAGEM];
    const people: Person[] = Array.from({ length: g.peopleCount }, (_, i) =>
      person(`p-${i}`, allRoles),
    );
    const assignments: Assignment[] = services.map((svc, i) => {
      const choice = g.subjectChoices[i % g.subjectChoices.length] ?? 0;
      const subjectId =
        g.peopleCount > 0 && choice < g.peopleCount ? `p-${choice}` : `fantasma-${i}`;
      return assignment(`a-${i}`, svc.id, g.roleChoice, subjectId);
    });

    const rules: Rule[] = [];
    if (g.useFundamental) rules.push(alwaysViolatedRule('fundamental', g.roleChoice));
    if (g.usePreference) rules.push(alwaysViolatedRule('preference', g.roleChoice));

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
      structural: EMPTY_STRUCTURAL,
      peopleWithPublicContact: new Set<string>(),
    };
    return { revision: g.revision, ruleSetVersion: g.ruleSetVersion, input };
  });

/** Revisao diferente, garantidamente distinta da atual (para simular "stale"). */
const otherRevisionArb: fc.Arbitrary<string> = hex64Arb;

// --------------------------------------------------------------------------
// Reporter que expoe seed/replayPath em falhas
// --------------------------------------------------------------------------

function pbtOptions<Ts>(): fc.Parameters<Ts> {
  return {
    numRuns: 200,
    reporter: (log: fc.RunDetails<Ts>): void => {
      if (log.failed) {
        throw new Error(
          `Property 28 falhou. seed=${log.seed} path="${log.counterexamplePath ?? ''}" ` +
            `numRuns=${log.numRuns}\nContraexemplo: ${fc.stringify(log.counterexample)}`,
        );
      }
    },
  };
}

// --------------------------------------------------------------------------
// Property 28
// --------------------------------------------------------------------------

describe('Property 28: gate de publicacao depende da revisao atual (7.23/8.1/8.6/8.8-8.10/14.8)', () => {
  // --- Condicao suficiente: TODOS os pre-requisitos atendidos abre o gate. ---
  it('gate ABRE quando a validacao da revisao atual nao tem bloqueios e prevendo/aprovacao coincidem', () => {
    const openCaseArb = generatedArb.map((gen) => {
      const report = validateComplete(gen.input);
      const state: GateState = {
        report,
        currentRevision: gen.revision,
        currentRuleSetVersion: gen.ruleSetVersion,
        approvedRevision: gen.revision,
        approvedRuleSetVersion: gen.ruleSetVersion,
        previewPeriod: PERIOD,
        publicationPeriod: PERIOD,
        allWarningsAcknowledged: true,
      };
      return state;
    });

    fc.assert(
      fc.property(openCaseArb, (state) => {
        const open = publicationGateOpen(state);
        // O gate abre EXATAMENTE quando nao ha bloqueios no relatorio da revisao
        // atual (os demais pre-requisitos ja estao satisfeitos neste caso).
        expect(open).toBe(state.report.blocking.length === 0);
      }),
      pbtOptions<[GateState]>(),
    );
  });

  // --- Necessidade (7.23/8.1): qualquer Bloqueio mantem o gate FECHADO. ---
  it('gate FECHA sempre que a validacao da revisao atual tem pelo menos um Bloqueio', () => {
    fc.assert(
      fc.property(generatedArb, (gen) => {
        const report = validateComplete(gen.input);
        fc.pre(report.blocking.length > 0);
        const state: GateState = {
          report,
          currentRevision: gen.revision,
          currentRuleSetVersion: gen.ruleSetVersion,
          approvedRevision: gen.revision,
          approvedRuleSetVersion: gen.ruleSetVersion,
          previewPeriod: PERIOD,
          publicationPeriod: PERIOD,
          allWarningsAcknowledged: true,
        };
        expect(publicationGateOpen(state)).toBe(false);
      }),
      pbtOptions<[Generated]>(),
    );
  });

  // --- Necessidade (7.23/8.8/14.8): relatorio de revisao ANTIGA fecha o gate.
  // Um campo mudou (nova revisao) e a validacao nao foi refeita: stale => fechado.
  it('gate FECHA quando o relatorio e de uma revisao diferente da atual (desatualizado)', () => {
    const arb = fc.record({ gen: generatedArb, newRevision: otherRevisionArb });
    fc.assert(
      fc.property(arb, ({ gen, newRevision }) => {
        fc.pre(newRevision !== gen.revision);
        const staleReport = validateComplete(gen.input); // validado na revisao antiga
        // A revisao ATUAL mudou, mas a prevendo/aprovacao e o relatorio seguem na
        // antiga: todos os demais parametros "coincidem" entre si, exceto que nao
        // correspondem a revisao atual.
        const state: GateState = {
          report: staleReport,
          currentRevision: newRevision,
          currentRuleSetVersion: gen.ruleSetVersion,
          approvedRevision: gen.revision,
          approvedRuleSetVersion: gen.ruleSetVersion,
          previewPeriod: PERIOD,
          publicationPeriod: PERIOD,
          allWarningsAcknowledged: true,
        };
        expect(publicationGateOpen(state)).toBe(false);
      }),
      pbtOptions<[{ gen: Generated; newRevision: string }]>(),
    );
  });

  // --- Necessidade (8.8/8.10/14.8): aprovacao de revisao antiga nao abre o gate.
  it('gate FECHA quando a prevendo/aprovacao referencia uma revisao diferente da atual', () => {
    const arb = fc.record({ gen: generatedArb, approvedRevision: otherRevisionArb });
    fc.assert(
      fc.property(arb, ({ gen, approvedRevision }) => {
        fc.pre(approvedRevision !== gen.revision);
        const report = validateComplete(gen.input); // validado na revisao atual
        fc.pre(report.blocking.length === 0); // isola o efeito do descasamento de revisao
        const state: GateState = {
          report,
          currentRevision: gen.revision,
          currentRuleSetVersion: gen.ruleSetVersion,
          approvedRevision, // <- aprovacao presa a revisao antiga (8.8/14.8)
          approvedRuleSetVersion: gen.ruleSetVersion,
          previewPeriod: PERIOD,
          publicationPeriod: PERIOD,
          allWarningsAcknowledged: true,
        };
        expect(publicationGateOpen(state)).toBe(false);
      }),
      pbtOptions<[{ gen: Generated; approvedRevision: string }]>(),
    );
  });

  // --- Necessidade (8.9): periodo divergente fecha o gate. ---
  it('gate FECHA quando o periodo da prevendo diverge do periodo de publicacao', () => {
    const arb = fc.record({
      gen: generatedArb,
      otherPeriod: fc.constantFrom<string>('2026-01', '2026-03', '2025-12'),
    });
    fc.assert(
      fc.property(arb, ({ gen, otherPeriod }) => {
        fc.pre(otherPeriod !== PERIOD);
        const report = validateComplete(gen.input);
        fc.pre(report.blocking.length === 0);
        const state: GateState = {
          report,
          currentRevision: gen.revision,
          currentRuleSetVersion: gen.ruleSetVersion,
          approvedRevision: gen.revision,
          approvedRuleSetVersion: gen.ruleSetVersion,
          previewPeriod: PERIOD,
          publicationPeriod: otherPeriod, // <- periodos divergentes (8.9)
          allWarningsAcknowledged: true,
        };
        expect(publicationGateOpen(state)).toBe(false);
      }),
      pbtOptions<[{ gen: Generated; otherPeriod: string }]>(),
    );
  });

  // --- Necessidade (8.6/8.10): avisos nao reconhecidos impedem a publicacao. ---
  it('gate FECHA quando ha Avisos nao reconhecidos, mesmo sem Bloqueios', () => {
    fc.assert(
      fc.property(generatedArb, (gen) => {
        const report = validateComplete(gen.input);
        fc.pre(report.blocking.length === 0);
        const state: GateState = {
          report,
          currentRevision: gen.revision,
          currentRuleSetVersion: gen.ruleSetVersion,
          approvedRevision: gen.revision,
          approvedRuleSetVersion: gen.ruleSetVersion,
          previewPeriod: PERIOD,
          publicationPeriod: PERIOD,
          allWarningsAcknowledged: false, // <- avisos pendentes (8.6)
        };
        // Avisos sozinhos nunca bloqueiam a validacao (canPublish continua true),
        // mas o gate permanece fechado ate o reconhecimento.
        expect(canPublish(report)).toBe(true);
        expect(publicationGateOpen(state)).toBe(false);
      }),
      pbtOptions<[Generated]>(),
    );
  });

  // --- Necessidade (8.10): rule set referenciado divergente fecha o gate. ---
  it('gate FECHA quando a aprovacao referencia um rule set diferente do atual', () => {
    const arb = fc.record({
      gen: generatedArb,
      approvedRuleSetVersion: fc.constantFrom<string>('v1', 'v2', 'v3', 'v2026-02'),
    });
    fc.assert(
      fc.property(arb, ({ gen, approvedRuleSetVersion }) => {
        fc.pre(approvedRuleSetVersion !== gen.ruleSetVersion);
        const report = validateComplete(gen.input);
        fc.pre(report.blocking.length === 0);
        const state: GateState = {
          report,
          currentRevision: gen.revision,
          currentRuleSetVersion: gen.ruleSetVersion,
          approvedRevision: gen.revision,
          approvedRuleSetVersion, // <- rule set divergente (8.10)
          previewPeriod: PERIOD,
          publicationPeriod: PERIOD,
          allWarningsAcknowledged: true,
        };
        expect(publicationGateOpen(state)).toBe(false);
      }),
      pbtOptions<[{ gen: Generated; approvedRuleSetVersion: string }]>(),
    );
  });

  // --- "Se e somente se" completo: o gate coincide EXATAMENTE com a conjuncao
  //     de todos os predicados, sobre um espaco de estados totalmente variado. ---
  it('gate ABRE se e somente se TODOS os pre-requisitos da revisao atual sao satisfeitos', () => {
    const fullStateArb = fc
      .record({
        gen: generatedArb,
        revisionMatches: fc.boolean(),
        ruleSetMatches: fc.boolean(),
        reportRuleSetMatches: fc.boolean(),
        periodMatches: fc.boolean(),
        warningsAck: fc.boolean(),
        altRevision: otherRevisionArb,
        altRuleSet: fc.constantFrom('vx', 'vy', 'vz'),
      })
      .map((c) => {
        const report = validateComplete(c.gen.input);
        const currentRevision = c.gen.revision;
        const currentRuleSetVersion = c.gen.ruleSetVersion;
        // Opcionalmente "corrompe" a versao de rule set do proprio relatorio para
        // simular um relatorio de outra versao (nunca a atual).
        const effectiveReport: ValidationReport = c.reportRuleSetMatches
          ? report
          : { ...report, ruleSetVersion: 'vreport-divergente' };
        const state: GateState = {
          report: effectiveReport,
          currentRevision,
          currentRuleSetVersion,
          approvedRevision: c.revisionMatches
            ? currentRevision
            : `${c.altRevision}` === currentRevision
              ? `${c.altRevision}0`
              : c.altRevision,
          approvedRuleSetVersion: c.ruleSetMatches
            ? currentRuleSetVersion
            : c.altRuleSet === currentRuleSetVersion
              ? `${c.altRuleSet}-x`
              : c.altRuleSet,
          previewPeriod: PERIOD,
          publicationPeriod: c.periodMatches ? PERIOD : '2099-12',
          allWarningsAcknowledged: c.warningsAck,
        };
        return state;
      });

    fc.assert(
      fc.property(fullStateArb, (state) => {
        const expected =
          canPublish(state.report) &&
          state.report.draftRevision === state.currentRevision &&
          state.approvedRevision === state.currentRevision &&
          state.approvedRuleSetVersion === state.currentRuleSetVersion &&
          state.report.ruleSetVersion === state.currentRuleSetVersion &&
          state.previewPeriod === state.publicationPeriod &&
          state.allWarningsAcknowledged;
        expect(publicationGateOpen(state)).toBe(expected);
      }),
      pbtOptions<[GateState]>(),
    );
  });
});
