// Feature: gestao-leiga-de-escalas, Property 26: Validação é completa, pura e corretamente classificada
//
// Property 26 (design.md): Para todo ciclo, a validação completa avalia cada
// regra aplicável sobre todos os cultos e atribuições sem modificar entradas;
// toda RF violada é Bloqueio, toda preferência violada é Aviso, e toda
// verificação inconclusiva é Bloqueio com dados e ação necessária.
//
// Validates: Requirements 7.2, 7.3, 7.4, 7.5, 7.25, 12.13
//
// Semântica verificada por esta propriedade, para TODO ciclo gerado (cultos,
// atribuições, cadastro, versão de regras e configuração estrutural):
//
//   (P) PUREZA (12.13 / 7.25): `validateComplete` é uma função PURA. Nenhuma
//       coleção de entrada (rascunho, cultos, insumos, indisponibilidades,
//       pessoas, departamentos, histórico, versão de regras, exceções, config
//       estrutural) é modificada. Verificado por igualdade estrutural de um
//       deep-clone tirado ANTES da chamada contra a entrada DEPOIS da chamada.
//
//   (C) COMPLETUDE (7.2 / 7.3): a validação completa avalia TODAS as
//       verificações do catálogo sobre todos os cultos e atribuições do ciclo.
//       Toda verificação ou foi aprovada (contribui para `passedCount`) ou
//       produziu ao menos um achado; `passedCount` + (verificações com achado)
//       == total do catálogo. Todo achado carrega os dados exigidos por 7.3
//       (motivo e ação necessária não vazios; referência de culto/função quando
//       aplicável), sem jamais vazar conteúdo privado.
//
//   (K) CLASSIFICAÇÃO (7.4 / 7.5): toda Regra_Fundamental (DSL) violada sem
//       exceção vigente é classificada como Bloqueio; toda Preferencia_de_Escala
//       não atendida é classificada como Aviso. A severidade declarada de cada
//       achado coincide com a sua partição (blocking ⊂ blocking, warning ⊂
//       warnings), e os dois conjuntos são disjuntos.
//
//   (I) INCONCLUSIVO VIRA BLOQUEIO (7.25): toda verificação que não pôde ser
//       concluída por dados ausentes/inválidos (`ruleId` com prefixo
//       `inconclusivo:`) é um Bloqueio com motivo e ação necessária informados.
//
// Estratégia dos geradores: um gerador inteligente constrói um ciclo VÁLIDO por
// construção — datas de culto ÚNICAS e determinísticas (geradas a partir de um
// offset inteiro sobre uma data civil base, nunca via `fc.date().toISOString()`
// para evitar flakiness), pessoas habilitadas, e uma versão de regras com um
// número controlado de Regras_Fundamentais e Preferências cujas asserções podem
// ser deliberadamente violadas (`op: 'false'`), de modo a exercitar as duas
// classificações. Opcionalmente injeta uma condição inconclusiva (gênero
// ausente numa equipe de louvor com regra de gênero ativa) para exercitar 7.25.
// Testes de propriedade não fazem I/O (função pura do domínio).

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  STRUCTURAL_CHECK_IDS,
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
  Weekday,
} from '../schemas/models';

// No mínimo 100 execuções (Notas do tasks.md). Em falha, o fast-check imprime o
// seed e o replayPath para reprodução determinística do contraexemplo.
const RUNS = 300;

// Instante canônico estável para todos os registros (determinismo, sem Date.now).
const NOW = '2026-02-01T12:00:00Z';

const ROLE_EQUIPE = 'role-equipe';
const WORSHIP_GENDER_ROLE = ROLE_EQUIPE;

// --------------------------------------------------------------------------
// Geração determinística de datas civis ISO (YYYY-MM-DD) por offset de dias.
// NÃO usa fc.date()/toISOString() (evita flakiness de fuso/limite de mês).
// --------------------------------------------------------------------------

const DAY_MS = 86_400_000;
const BASE_UTC = Date.UTC(2026, 1, 1); // 2026-02-01 (civil, UTC)

/** Data civil ISO a partir de um offset inteiro de dias sobre a base. */
function isoDateFromOffset(offsetDays: number): string {
  const d = new Date(BASE_UTC + offsetDays * DAY_MS);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Dia da semana civil (determinístico) para a data ISO. */
function weekdayOf(isoDate: string): Weekday {
  const y = Number(isoDate.slice(0, 4));
  const mo = Number(isoDate.slice(5, 7)) - 1;
  const da = Number(isoDate.slice(8, 10));
  const idx = new Date(Date.UTC(y, mo, da)).getUTCDay(); // 0=domingo
  const names: Weekday[] = [
    'sunday',
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
  ];
  return names[idx] as Weekday;
}

// --------------------------------------------------------------------------
// Builders deterministicos (espelham os do teste unitário, sem compartilhar
// estado mutável entre execuções da propriedade).
// --------------------------------------------------------------------------

function person(id: string, caps: readonly string[]): Person {
  return {
    schemaVersion: SCHEMA_VERSION,
    id,
    canonicalName: id,
    aliases: [],
    participation: 'active',
    publicContactAuthorizationIds: [],
    capabilityIds: [...caps],
    // Todos os dias permitidos: evita bloqueios espúrios de 7.16 por dia.
    allowedWeekdays: ['wednesday', 'saturday', 'sunday'],
    leaves: [],
    links: [],
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function service(id: string, date: string): Service {
  return {
    schemaVersion: SCHEMA_VERSION,
    id,
    cycleId: 'cycle-1',
    date,
    computedWeekday: weekdayOf(date),
    kind: 'regular',
    externalInputIds: [],
  };
}

function assignment(id: string, serviceId: string, roleId: string, subjectId: string): Assignment {
  return { id, serviceId, roleId, subject: { type: 'person', id: subjectId }, source: 'manual' };
}

function draft(assignments: Assignment[]): ScheduleDraft {
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

function ruleSet(rules: Rule[]): ApprovedRuleSet {
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

/**
 * Regra DSL cujo `assertion` é SEMPRE falso quando aplicável à `roleId`: isto
 * garante um resultado determinístico (violação) para exercitar a
 * classificação RF=>Bloqueio / Preferência=>Aviso (7.4/7.5).
 */
function violableRule(id: string, kind: Rule['kind'], roleId: string): Rule {
  return {
    id,
    kind,
    severity: kind === 'fundamental' ? 'blocking' : 'warning',
    applicability: { op: 'eq', args: [field('assignment.roleId'), lit(roleId)] },
    assertion: { op: 'false' },
    messageTemplate: 'ajuste a atribuicao',
    allowedExceptionTypeIds: [],
  };
}

// --------------------------------------------------------------------------
// Gerador inteligente de um ciclo válido por construção.
// --------------------------------------------------------------------------

interface GeneratedCycle {
  input: ValidationInput;
  /** Funções com uma RF violável aplicável (esperado Bloqueio). */
  fundamentalRoleIds: Set<string>;
  /** Funções com uma Preferência violável aplicável (esperado Aviso). */
  preferenceRoleIds: Set<string>;
  /** Verdadeiro quando foi injetada uma verificação inconclusiva (7.25). */
  expectInconclusive: boolean;
}

const cycleArb: fc.Arbitrary<GeneratedCycle> = fc
  .record({
    // Offsets de dias ÚNICOS => datas de culto únicas (evita 7.6 por acaso,
    // salvo quando quisermos; aqui mantemos únicas para isolar a propriedade).
    dayOffsets: fc.uniqueArray(fc.integer({ min: 0, max: 27 }), {
      minLength: 1,
      maxLength: 6,
    }),
    // Quantidade de funções distintas usadas nas atribuições.
    roleCount: fc.integer({ min: 1, max: 4 }),
    // Para cada função, classifica se recebe RF violável, Preferência ou nada.
    roleKinds: fc.array(fc.constantFrom('fundamental', 'preference', 'none'), {
      minLength: 4,
      maxLength: 4,
    }),
    // Injeta (ou não) uma verificação inconclusiva (gênero ausente, 7.25).
    injectInconclusive: fc.boolean(),
  })
  .map(({ dayOffsets, roleCount, roleKinds, injectInconclusive }) => {
    const roleIds = Array.from({ length: roleCount }, (_v, i) => `role-${i}`);

    // Classificação por função (a partir de roleKinds, truncado a roleCount).
    const fundamentalRoleIds = new Set<string>();
    const preferenceRoleIds = new Set<string>();
    const rules: Rule[] = [];
    roleIds.forEach((roleId, i) => {
      const kind = roleKinds[i] ?? 'none';
      if (kind === 'fundamental') {
        fundamentalRoleIds.add(roleId);
        rules.push(violableRule(`rf-${i}`, 'fundamental', roleId));
      } else if (kind === 'preference') {
        preferenceRoleIds.add(roleId);
        rules.push(violableRule(`pref-${i}`, 'preference', roleId));
      }
    });

    // Cultos com datas únicas e determinísticas.
    const services: Service[] = dayOffsets
      .slice()
      .sort((a, b) => a - b)
      .map((off, i) => service(`svc-${i}`, isoDateFromOffset(off)));

    // Pessoas habilitadas para TODAS as funções usadas (evita 7.16/7.7).
    // Quando injetamos inconclusivo, deixamos as pessoas SEM gênero declarado e
    // ativamos a regra de gênero na equipe.
    const capsBase = [...roleIds];
    const people: Person[] = [
      person('p-a', capsBase),
      person('p-b', capsBase),
    ];

    // Atribuições: uma pessoa habilitada por (culto, função). Determinístico.
    const assignments: Assignment[] = [];
    services.forEach((svc, si) => {
      roleIds.forEach((roleId, ri) => {
        const subjectId = (si + ri) % 2 === 0 ? 'p-a' : 'p-b';
        assignments.push(assignment(`a-${si}-${ri}`, svc.id, roleId, subjectId));
      });
    });

    // Config estrutural: por padrão desliga verificações estruturais; quando
    // pedimos inconclusivo, ativa gênero numa função de equipe presente.
    let structural: RuleSetStructuralConfig = EMPTY_STRUCTURAL;
    let expectInconclusive = false;
    if (injectInconclusive && roleIds.includes(WORSHIP_GENDER_ROLE)) {
      structural = {
        ...EMPTY_STRUCTURAL,
        worshipTeamRoleIds: [WORSHIP_GENDER_ROLE],
        worshipTeamGender: { minMale: 1, minFemale: 1 },
      };
      // As pessoas não têm `gender:*` => verificação de gênero fica inconclusiva.
      expectInconclusive = true;
    }

    const input: ValidationInput = {
      cycleId: 'cycle-1',
      draft: draft(assignments),
      services,
      externalInputs: [],
      unavailabilities: [],
      people,
      departments: [],
      ruleSet: ruleSet(rules),
      exceptions: [],
      structural,
    };

    return { input, fundamentalRoleIds, preferenceRoleIds, expectInconclusive };
  });

// --------------------------------------------------------------------------
// Serialização estrutural estável (para comparar entrada antes/depois: pureza).
// Trata Set como coleção ordenada, pois a config estrutural usa Set.
// --------------------------------------------------------------------------

function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, v) => {
    if (v instanceof Set) {
      return { __set__: [...v].map(String).sort() };
    }
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(v as Record<string, unknown>).sort()) {
        sorted[k] = (v as Record<string, unknown>)[k];
      }
      return sorted;
    }
    return v;
  });
}

// --------------------------------------------------------------------------
// Propriedade
// --------------------------------------------------------------------------

describe('Property 26: Validação é completa, pura e corretamente classificada (7.2-7.5, 7.25, 12.13)', () => {
  it('completa avalia tudo sem mutar entradas; classifica RF/Preferência e inconclusivo corretamente', () => {
    fc.assert(
      fc.property(cycleArb, (gen) => {
        const { input } = gen;

        // Snapshot profundo de TODA a entrada antes da chamada (pureza).
        const before = stableStringify(input);

        const report = validateComplete(input);

        // (P) PUREZA (12.13): nenhuma entrada foi modificada.
        expect(stableStringify(input)).toBe(before);

        // Relatório coerente com a revisão/versão avaliadas (contexto de 7.2).
        expect(report.status).toBe('complete');
        expect(report.draftRevision).toBe(input.draft.revision);
        expect(report.ruleSetVersion).toBe(input.ruleSet.version);
        expect(report.cycleId).toBe(input.cycleId);

        // (C) COMPLETUDE (7.2/7.3): toda verificação do catálogo foi aplicada —
        // ou aprovada (passedCount) ou produziu ao menos um achado. O número de
        // verificações que produziram achado é derivável dos ruleIds dos
        // achados? Não diretamente, mas vale a invariante de contagem:
        //   passedCount <= total, e passedCount == total  sse  não há achados.
        const total = STRUCTURAL_CHECK_IDS.length;
        expect(report.passedCount).toBeGreaterThanOrEqual(0);
        expect(report.passedCount).toBeLessThanOrEqual(total);
        const hasFindings = report.blocking.length + report.warnings.length > 0;
        expect(report.passedCount === total).toBe(!hasFindings);

        // Conjuntos disjuntos e severidade coerente com a partição (7.24 base).
        const blockingIds = new Set(report.blocking.map((f) => f.findingId));
        const warningIds = new Set(report.warnings.map((f) => f.findingId));
        for (const id of blockingIds) expect(warningIds.has(id)).toBe(false);
        expect(report.blocking.every((f) => f.severity === 'blocking')).toBe(true);
        expect(report.warnings.every((f) => f.severity === 'warning')).toBe(true);

        // (C) 7.3: cada achado informa motivo e ação necessária não vazios.
        for (const f of [...report.blocking, ...report.warnings]) {
          expect(typeof f.reason).toBe('string');
          expect(f.reason.trim().length).toBeGreaterThan(0);
          expect(typeof f.requiredAction).toBe('string');
          expect(f.requiredAction.trim().length).toBeGreaterThan(0);
          expect(typeof f.ruleId).toBe('string');
          expect(f.ruleId.length).toBeGreaterThan(0);
        }

        // (K) CLASSIFICAÇÃO (7.4): toda RF violável aplicável aparece como
        // Bloqueio (sem exceções no ciclo gerado).
        for (const roleId of gen.fundamentalRoleIds) {
          const ruleId = ruleIdForRole(input.ruleSet.rules, roleId, 'fundamental');
          expect(ruleId).toBeDefined();
          const inBlocking = report.blocking.some((f) => f.ruleId === ruleId);
          const inWarnings = report.warnings.some((f) => f.ruleId === ruleId);
          expect(inBlocking).toBe(true);
          expect(inWarnings).toBe(false);
        }

        // (K) CLASSIFICAÇÃO (7.5): toda Preferência violável aplicável aparece
        // como Aviso, nunca como Bloqueio.
        for (const roleId of gen.preferenceRoleIds) {
          const ruleId = ruleIdForRole(input.ruleSet.rules, roleId, 'preference');
          expect(ruleId).toBeDefined();
          const inWarnings = report.warnings.some((f) => f.ruleId === ruleId);
          const inBlocking = report.blocking.some((f) => f.ruleId === ruleId);
          expect(inWarnings).toBe(true);
          expect(inBlocking).toBe(false);
        }

        // (I) INCONCLUSIVO VIRA BLOQUEIO (7.25): todo achado inconclusivo é
        // Bloqueio com motivo e ação necessária; quando injetado, existe ao
        // menos um.
        const inconclusive = report.blocking.filter((f) => f.ruleId.startsWith('inconclusivo:'));
        for (const f of inconclusive) {
          expect(f.severity).toBe('blocking');
          expect(f.reason.trim().length).toBeGreaterThan(0);
          expect(f.requiredAction.trim().length).toBeGreaterThan(0);
        }
        // Nenhum achado inconclusivo pode estar entre os avisos.
        expect(report.warnings.some((f) => f.ruleId.startsWith('inconclusivo:'))).toBe(false);
        if (gen.expectInconclusive) {
          expect(inconclusive.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: RUNS },
    );
  });

  it('é determinística: a mesma entrada produz o mesmo relatório (corolário de pureza)', () => {
    fc.assert(
      fc.property(cycleArb, (gen) => {
        const r1 = validateComplete(gen.input);
        const r2 = validateComplete(gen.input);
        expect(r1.reportId).toBe(r2.reportId);
        expect(r1.passedCount).toBe(r2.passedCount);
        expect(r1.blocking.map((f) => f.findingId)).toEqual(r2.blocking.map((f) => f.findingId));
        expect(r1.warnings.map((f) => f.findingId)).toEqual(r2.warnings.map((f) => f.findingId));
      }),
      { numRuns: RUNS },
    );
  });
});

/** Resolve o id da regra DSL aplicável à função e ao tipo (helper determinístico). */
function ruleIdForRole(
  rules: readonly Rule[],
  roleId: string,
  kind: Rule['kind'],
): string | undefined {
  const rule = rules.find(
    (r) =>
      r.kind === kind &&
      r.applicability.op === 'eq' &&
      Array.isArray(r.applicability.args) &&
      JSON.stringify(r.applicability.args).includes(`"${roleId}"`),
  );
  return rule?.id;
}
