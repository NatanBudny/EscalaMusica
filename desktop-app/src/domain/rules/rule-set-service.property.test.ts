// Feature: gestao-leiga-de-escalas, Property 22: Versões de regras são imutáveis e vinculadas
//
// Tarefa 5.3. Property 22 (design.md): "Para todo Ciclo_Mensal, existe exatamente
// uma versão aprovada de regras associada; qualquer edição cria nova versão sem
// alterar versões ou ciclos anteriores, e toda validação/sugestão do ciclo usa
// exclusivamente a versão registrada."
//
// Valida: Requisitos 6.1, 6.2, 6.3, 6.10, 6.11, 6.12, 6.15.
//
// Esta propriedade exercita, para catalogos de regras gerados aleatoriamente:
//
//  (A) Imutabilidade + vinculo unico e aprovado (6.1, 6.2, 6.12):
//      uma versao aprovada e congelada; releitura via getVersion e sempre igual
//      ao snapshot pos-aprovacao; a associacao do ciclo (o id da versao
//      registrada) aponta para EXATAMENTE uma versao aprovada e identificada,
//      com aprovador e data/hora de aprovacao presentes.
//
//  (B) Alteracao cria NOVA versao sem modificar a base nem associacoes (6.3):
//      amendRule produz uma nova versao (novo id/label) em rascunho; a versao
//      base permanece byte-a-byte identica; o id associado ao ciclo continua
//      sendo a versao base (associacao preservada).
//
//  (C) Versao nao aprovada nao pode ser designada (6.10):
//      assertDesignable rejeita qualquer versao em rascunho (inclusive a nova
//      versao criada por amendRule) com o codigo `not-approved`, e aceita
//      somente versoes aprovadas.
//
//  (D) Regra ausente da versao do ciclo nao pode ser usada (6.11, 6.15):
//      getRuleInVersion usa exclusivamente a versao informada; uma regra
//      presente em OUTRA versao, porem ausente na versao do ciclo, e rejeitada
//      com `rule-not-in-version`; regras presentes sao obtidas.
//
// Geradores inteligentes constroem apenas regras e predicados estruturalmente
// validos (operacoes conhecidas, campos da allowlist, ids unicos), de modo que
// o shrinking preserve as pre-condicoes de cada afirmacao.

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { RuleSetService, type RuleSetResult } from './rule-set-service';
import { field, lit } from './predicate';
import type { ApprovedRuleSet, Rule, RulePredicate, Uuid } from '../schemas/models';

const RUNS = 200;

const NOW = '2026-01-15T12:00:00Z';
const APPROVED_AT = '2026-01-16T09:00:00Z';
const APPROVER: Uuid = '00000000-0000-4000-8000-0000000000aa';

/** UUID deterministico a partir de um inteiro (mesmo padrao dos testes unitarios). */
const toId = (n: number): Uuid =>
  `00000000-0000-4000-8000-${(n >>> 0).toString(16).padStart(12, '0')}`;

/** Dias usados pela applicability (apenas campos da allowlist KNOWN_RULE_FIELDS). */
const WEEKDAYS = ['wednesday', 'saturday', 'sunday'] as const;
const ROLES = ['regente', 'louvor', 'mensagem', 'suporte'] as const;

function must<T>(r: RuleSetResult<T>, ctx: string): T {
  if (!r.ok) throw new Error(`${ctx} falhou: ${JSON.stringify(r.error)}`);
  return r.value;
}

/**
 * Gera uma regra fundamental bem formada e NAO contraditoria: a applicability
 * fixa o culto (service.weekday) e a assertion exige a presenca da habilitacao
 * para a funcao. Ids distintos por construcao (controlados pelo chamador).
 */
function ruleArb(ruleId: Uuid): fc.Arbitrary<Rule> {
  return fc
    .record({
      weekday: fc.constantFrom(...WEEKDAYS),
      role: fc.constantFrom(...ROLES),
    })
    .map(({ weekday, role }): Rule => {
      const applicability: RulePredicate = { op: 'eq', args: [field('service.weekday'), lit(weekday)] };
      const assertion: RulePredicate = {
        op: 'includes',
        args: ['subject.capabilityIds', lit(role)],
      };
      return {
        id: ruleId,
        kind: 'fundamental',
        severity: 'blocking',
        applicability,
        assertion,
        messageTemplate: `exige habilitacao ${role} na ${weekday}`,
        allowedExceptionTypeIds: [],
      };
    });
}

/** Lista de regras com ids unicos e tamanho 1..5 (ids em um espaco dado). */
function rulesArb(idBase: number): fc.Arbitrary<Rule[]> {
  return fc
    .integer({ min: 1, max: 5 })
    .chain((count) =>
      fc.tuple(...Array.from({ length: count }, (_, i) => ruleArb(toId(idBase + i)))),
    )
    .map((rs) => [...rs]);
}

interface Scenario {
  baseRules: Rule[];
  amendedRule: Rule;
  reason: string;
}

/**
 * Cenario: um conjunto de regras base (versao do ciclo) e UMA regra para
 * alterar/adicionar na nova versao. A regra alterada pode reaproveitar o id da
 * primeira regra base (alteracao) ou um id novo (adicao).
 */
const scenarioArb: fc.Arbitrary<Scenario> = rulesArb(0x1000)
  .chain((baseRules) =>
    fc.record({
      baseRules: fc.constant(baseRules),
      // Alterar a 1a regra (reusa id) OU adicionar uma regra nova (id fora da base).
      amendedRule: fc.oneof(
        ruleArb(baseRules[0]!.id),
        ruleArb(toId(0x2000)),
      ),
      reason: fc.string({ minLength: 1, maxLength: 40 }).map((s) => s.trim() || 'ajuste'),
    }),
  );

/** Monta um servico com uma unica versao aprovada (a "versao do ciclo"). */
function serviceWithApprovedCycleVersion(
  baseRules: Rule[],
): { svc: RuleSetService; cycleVersionId: Uuid } {
  const svc = new RuleSetService();
  const cycleVersionId = toId(0xaaa0);
  must(
    svc.defineVersion({
      id: cycleVersionId,
      version: 'ciclo-v1',
      validFrom: '2026-01-01',
      validUntil: '2026-12-31',
      rules: baseRules,
      now: NOW,
    }),
    'defineVersion',
  );
  must(
    svc.approveVersion({ id: cycleVersionId, approvedBy: APPROVER, approvedAt: APPROVED_AT }),
    'approveVersion',
  );
  return { svc, cycleVersionId };
}

describe('Property 22: Versões de regras são imutáveis e vinculadas', () => {
  it('(A) vinculo unico/aprovado e versao aprovada imutavel (6.1, 6.2, 6.12)', () => {
    fc.assert(
      fc.property(scenarioArb, ({ baseRules }) => {
        const { svc, cycleVersionId } = serviceWithApprovedCycleVersion(baseRules);

        // A versao do ciclo existe, esta aprovada e identificada, com aprovador
        // e data/hora de aprovacao (6.1, 6.2, 6.12).
        const linked = svc.getVersion(cycleVersionId);
        expect(linked).toBeDefined();
        const v = linked as ApprovedRuleSet;
        expect(v.status).toBe('approved');
        expect(v.id).toBe(cycleVersionId);
        expect(typeof v.version).toBe('string');
        expect(v.version.length).toBeGreaterThan(0);
        expect(v.approvedBy).toBe(APPROVER);
        expect(v.approvedAt).toBe(APPROVED_AT);

        // Exatamente UMA versao no catalogo corresponde ao id associado ao ciclo.
        const matches = svc.listVersions().filter((x) => x.id === cycleVersionId);
        expect(matches).toHaveLength(1);

        // Imutabilidade: releituras sucessivas sao sempre identicas (congelada)
        // e desacopladas (mutar a copia nao afeta o catalogo).
        const snap = svc.getVersion(cycleVersionId) as ApprovedRuleSet;
        snap.rules.push({ ...baseRules[0]! });
        (snap as { version: string }).version = 'MUTADO';
        expect(svc.getVersion(cycleVersionId)).toEqual(linked);
      }),
      { numRuns: RUNS },
    );
  });

  it('(B) alterar uma regra cria NOVA versao sem modificar a base nem a associacao (6.3)', () => {
    fc.assert(
      fc.property(scenarioArb, ({ baseRules, amendedRule, reason }) => {
        const { svc, cycleVersionId } = serviceWithApprovedCycleVersion(baseRules);

        const baseBefore = svc.getVersion(cycleVersionId);
        const newVersionId = toId(0xbbb0);

        const amended = must(
          svc.amendRule({
            baseVersionId: cycleVersionId,
            newVersionId,
            newVersion: 'nova-v2',
            rule: amendedRule,
            author: APPROVER,
            at: APPROVED_AT,
            reason,
            now: NOW,
          }),
          'amendRule',
        );

        // Nova versao identificada, distinta da base, e nasce em rascunho.
        expect(amended.id).toBe(newVersionId);
        expect(amended.id).not.toBe(cycleVersionId);
        expect(amended.status).toBe('draft');

        // A versao base (associada ao ciclo) permanece byte-a-byte intacta (6.3).
        expect(svc.getVersion(cycleVersionId)).toEqual(baseBefore);

        // A associacao do ciclo nao mudou: continua sendo a versao base aprovada,
        // e ainda ha exatamente uma versao aprovada com esse id.
        const approved = svc.listVersions().filter((x) => x.status === 'approved');
        expect(approved).toHaveLength(1);
        expect(approved[0]!.id).toBe(cycleVersionId);

        // A auditoria registrou a alteracao com o conteudo posterior (6.4 — apoio).
        const log = svc.listAmendments();
        expect(log).toHaveLength(1);
        expect(log[0]!.after.id).toBe(amendedRule.id);
      }),
      { numRuns: RUNS },
    );
  });

  it('(C) versao nao aprovada nao pode ser designada; aprovada pode (6.10)', () => {
    fc.assert(
      fc.property(scenarioArb, ({ baseRules, amendedRule, reason }) => {
        const { svc, cycleVersionId } = serviceWithApprovedCycleVersion(baseRules);
        const newVersionId = toId(0xbbb0);

        must(
          svc.amendRule({
            baseVersionId: cycleVersionId,
            newVersionId,
            newVersion: 'nova-v2',
            rule: amendedRule,
            author: APPROVER,
            at: APPROVED_AT,
            reason,
            now: NOW,
          }),
          'amendRule',
        );

        // A nova versao (rascunho) NAO pode ser designada a um ciclo (6.10).
        const draftDesignable = svc.assertDesignable(newVersionId);
        expect(draftDesignable.ok).toBe(false);
        if (!draftDesignable.ok) expect(draftDesignable.error.code).toBe('not-approved');

        // A versao aprovada (do ciclo) pode ser designada.
        expect(svc.assertDesignable(cycleVersionId).ok).toBe(true);

        // Apos aprovar a nova versao, ela tambem se torna designavel — ambas
        // aprovadas permanecem identificadas e imutaveis.
        must(
          svc.approveVersion({ id: newVersionId, approvedBy: APPROVER, approvedAt: APPROVED_AT }),
          'approveVersion(nova)',
        );
        expect(svc.assertDesignable(newVersionId).ok).toBe(true);
      }),
      { numRuns: RUNS },
    );
  });

  it('(D) uso restrito a versao do ciclo: regra ausente e rejeitada (6.11, 6.15)', () => {
    fc.assert(
      fc.property(scenarioArb, ({ baseRules }) => {
        const { svc, cycleVersionId } = serviceWithApprovedCycleVersion(baseRules);

        // Toda regra presente na versao do ciclo pode ser obtida dessa versao.
        for (const r of baseRules) {
          expect(svc.getRuleInVersion(cycleVersionId, r.id).ok).toBe(true);
        }

        // Cria uma OUTRA versao aprovada contendo uma regra extra, ausente da
        // versao do ciclo. Essa regra NAO pode ser usada atraves da versao do
        // ciclo (6.15), e a consulta usa exclusivamente a versao informada (6.11).
        const otherId = toId(0xccc0);
        const extraRuleId = toId(0x3000);
        const extraRule: Rule = {
          id: extraRuleId,
          kind: 'fundamental',
          severity: 'blocking',
          applicability: { op: 'eq', args: [field('service.weekday'), lit('sunday')] },
          assertion: { op: 'true' },
          messageTemplate: 'regra exclusiva da outra versao',
          allowedExceptionTypeIds: [],
        };
        must(
          svc.defineVersion({
            id: otherId,
            version: 'outra-v1',
            validFrom: '2026-01-01',
            rules: [extraRule],
            now: NOW,
          }),
          'defineVersion(outra)',
        );
        must(
          svc.approveVersion({ id: otherId, approvedBy: APPROVER, approvedAt: APPROVED_AT }),
          'approveVersion(outra)',
        );

        // A regra extra existe na outra versao...
        expect(svc.getRuleInVersion(otherId, extraRuleId).ok).toBe(true);
        // ...mas e rejeitada quando buscada na versao do ciclo (6.15).
        const absent = svc.getRuleInVersion(cycleVersionId, extraRuleId);
        expect(absent.ok).toBe(false);
        if (!absent.ok) expect(absent.error.code).toBe('rule-not-in-version');
      }),
      { numRuns: RUNS },
    );
  });
});
