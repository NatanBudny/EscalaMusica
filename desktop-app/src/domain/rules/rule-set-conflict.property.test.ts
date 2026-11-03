// Feature: gestao-leiga-de-escalas, Property 24: Conjuntos de regras contraditórios não são ativados
//
// Tarefa 5.5. Property 24 (design.md): "Para toda versão proposta que contenha
// duas prescrições mutuamente incompatíveis para a mesma condição, função e
// culto, a ativação falha, a versão anterior permanece ativa e o resultado
// identifica ambas as regras e a condição conflitante."
//
// Valida: Requisito 6.6.
//
// Para catalogos de regras gerados aleatoriamente, esta propriedade exercita:
//
//  (A) Definicao/ativacao falham para conjuntos contraditorios:
//      duas regras com a MESMA applicability (mesma condicao/funcao/culto) cujas
//      assertions sao mutuamente negadas (X vs not(X), ou true vs false) sao
//      rejeitadas ja no defineVersion com codigo `rule-conflict`, e o resultado
//      identifica AMBAS as regras e a condicao conflitante. Como defineVersion
//      ja rejeita, a versao contraditoria nunca chega a ser aprovada/ativada.
//
//  (B) A versao ativa anterior e preservada (6.6):
//      partindo de um servico com UMA versao aprovada ("ativa"), a tentativa de
//      definir uma nova versao contraditoria falha e NAO altera o catalogo: a
//      versao ativa anterior permanece byte-a-byte identica, aprovada e
//      designavel. O mesmo vale para amendRule a partir da versao ativa.
//
//  (C) Conjuntos NAO contraditorios ativam normalmente:
//      um conjunto sem contradicao (applicabilidades distintas, ou assertions
//      compativeis) e definido e aprovado com sucesso (torna-se ativo).
//
//  (D) Simetria/robustez: a ordem das regras no conjunto nao muda o resultado;
//      duas regras iguais (nao contraditorias) nao disparam conflito.
//
// Geradores inteligentes constroem apenas predicados estruturalmente validos
// (operacoes conhecidas da DSL, campos da allowlist KNOWN_RULE_FIELDS, ids
// unicos), de modo que o shrinking preserve as pre-condicoes de cada afirmacao.

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { RuleSetService, detectRuleConflicts, type RuleSetResult } from './rule-set-service';
import { field, lit } from './predicate';
import type { ApprovedRuleSet, Rule, RulePredicate, Uuid } from '../schemas/models';

const RUNS = 200;

const NOW = '2026-01-15T12:00:00Z';
const APPROVED_AT = '2026-01-16T09:00:00Z';
const APPROVER: Uuid = '00000000-0000-4000-8000-0000000000aa';

/** UUID deterministico a partir de um inteiro (mesmo padrao dos demais testes). */
const toId = (n: number): Uuid =>
  `00000000-0000-4000-8000-${(n >>> 0).toString(16).padStart(12, '0')}`;

/** Condicoes (applicability): culto x funcao — a "mesma condicao, funcao e culto". */
const WEEKDAYS = ['wednesday', 'saturday', 'sunday'] as const;
const ROLES = ['regente', 'louvor', 'mensagem', 'suporte'] as const;

type Condition = { weekday: (typeof WEEKDAYS)[number]; role: (typeof ROLES)[number] };

const conditionArb: fc.Arbitrary<Condition> = fc.record({
  weekday: fc.constantFrom(...WEEKDAYS),
  role: fc.constantFrom(...ROLES),
});

function must<T>(r: RuleSetResult<T>, ctx: string): T {
  if (!r.ok) throw new Error(`${ctx} falhou: ${JSON.stringify(r.error)}`);
  return r.value;
}

/**
 * Applicability que fixa culto E funcao: `service.weekday == W AND
 * assignment.roleId == R`. Duas regras so colidem quando esta chave coincide.
 */
function applicabilityFor(cond: Condition): RulePredicate {
  return {
    op: 'and',
    args: [
      { op: 'eq', args: [field('service.weekday'), lit(cond.weekday)] },
      { op: 'eq', args: [field('assignment.roleId'), lit(cond.role)] },
    ],
  };
}

/** Uma assertion "base" P reutilizavel: a pessoa tem a habilitacao da funcao. */
function baseAssertion(role: string): RulePredicate {
  return { op: 'includes', args: ['subject.capabilityIds', lit(role)] };
}

function makeRule(id: Uuid, applicability: RulePredicate, assertion: RulePredicate): Rule {
  return {
    id,
    kind: 'fundamental',
    severity: 'blocking',
    applicability,
    assertion,
    messageTemplate: 'regra de teste',
    allowedExceptionTypeIds: [],
  };
}

/**
 * Par de regras CONTRADITORIAS sob a mesma condicao/funcao/culto. O tipo de
 * contradicao e escolhido pelo gerador:
 *  - 'assert-vs-not': uma afirma P, a outra afirma not(P);
 *  - 'true-vs-false': uma afirma `true`, a outra `false`.
 */
interface ContradictoryPair {
  ruleA: Rule;
  ruleB: Rule;
  condition: Condition;
}

const contradictoryPairArb: fc.Arbitrary<ContradictoryPair> = fc
  .record({
    condition: conditionArb,
    kind: fc.constantFrom('assert-vs-not' as const, 'true-vs-false' as const),
    idA: fc.integer({ min: 0x1000, max: 0x1fff }),
    idOffset: fc.integer({ min: 1, max: 0x100 }),
  })
  .map(({ condition, kind, idA, idOffset }): ContradictoryPair => {
    const app = applicabilityFor(condition);
    let assertA: RulePredicate;
    let assertB: RulePredicate;
    if (kind === 'assert-vs-not') {
      const p = baseAssertion(condition.role);
      assertA = p;
      assertB = { op: 'not', args: [p] };
    } else {
      assertA = { op: 'true' };
      assertB = { op: 'false' };
    }
    return {
      condition,
      ruleA: makeRule(toId(idA), app, assertA),
      ruleB: makeRule(toId(idA + idOffset), app, assertB),
    };
  });

/**
 * Par de regras NAO contraditorias. Ou possuem applicabilidades distintas
 * (condicao/funcao/culto diferentes) ou assertions compativeis sob a mesma
 * condicao (ambas P, que nao sao negacoes mutuas).
 */
interface CompatiblePair {
  ruleA: Rule;
  ruleB: Rule;
}

const compatiblePairArb: fc.Arbitrary<CompatiblePair> = fc
  .record({
    condA: conditionArb,
    condB: conditionArb,
    sameCondition: fc.boolean(),
    idA: fc.integer({ min: 0x4000, max: 0x4fff }),
    idOffset: fc.integer({ min: 1, max: 0x100 }),
  })
  .map(({ condA, condB, sameCondition, idA, idOffset }): CompatiblePair => {
    // Quando a condicao for a mesma, usamos assertions compativeis (ambas P).
    // Quando diferente, garantimos applicabilidades distintas usando condB.
    const differ =
      !sameCondition && (condA.weekday !== condB.weekday || condA.role !== condB.role);
    const appA = applicabilityFor(condA);
    const appB = differ ? applicabilityFor(condB) : appA;
    const ruleA = makeRule(toId(idA), appA, baseAssertion(condA.role));
    const ruleB = makeRule(
      toId(idA + idOffset),
      appB,
      // Assertion de B: mesma P (nao e negacao mutua de A) -> nunca contraditoria.
      baseAssertion(differ ? condB.role : condA.role),
    );
    return { ruleA, ruleB };
  });

/** Monta um servico ja com UMA versao aprovada ("ativa") sem contradicoes. */
function serviceWithActiveVersion(): { svc: RuleSetService; activeId: Uuid } {
  const svc = new RuleSetService();
  const activeId = toId(0xaaa0);
  const activeRule = makeRule(
    toId(0x9000),
    applicabilityFor({ weekday: 'saturday', role: 'regente' }),
    baseAssertion('regente'),
  );
  must(
    svc.defineVersion({
      id: activeId,
      version: 'ativa-v1',
      validFrom: '2026-01-01',
      validUntil: '2026-12-31',
      rules: [activeRule],
      now: NOW,
    }),
    'defineVersion(ativa)',
  );
  must(
    svc.approveVersion({ id: activeId, approvedBy: APPROVER, approvedAt: APPROVED_AT }),
    'approveVersion(ativa)',
  );
  return { svc, activeId };
}

describe('Property 24: Conjuntos de regras contraditórios não são ativados', () => {
  it('(A) conjuntos contraditorios sao rejeitados e identificam ambas as regras e a condicao', () => {
    fc.assert(
      fc.property(contradictoryPairArb, fc.boolean(), ({ ruleA, ruleB }, order) => {
        const rules = order ? [ruleA, ruleB] : [ruleB, ruleA];

        // detectRuleConflicts (nucleo de 6.6) identifica o par e a condicao.
        const conflict = detectRuleConflicts(rules);
        expect(conflict).not.toBeNull();
        expect(conflict?.code).toBe('rule-conflict');
        const ids = [conflict?.conflict?.ruleIdA, conflict?.conflict?.ruleIdB].sort();
        expect(ids).toEqual([ruleA.id, ruleB.id].sort());
        // A condicao conflitante corresponde a applicability compartilhada.
        expect(conflict?.conflict?.condition).toBeDefined();

        // Definir a versao contraditoria falha com o mesmo codigo; como
        // defineVersion ja rejeita, nunca ha ativacao de versao contraditoria.
        const svc = new RuleSetService();
        const res = svc.defineVersion({
          id: toId(0xdd00),
          version: 'contraditoria',
          validFrom: '2026-01-01',
          rules,
          now: NOW,
        });
        expect(res.ok).toBe(false);
        if (!res.ok) {
          expect(res.error.code).toBe('rule-conflict');
          const eids = [res.error.conflict?.ruleIdA, res.error.conflict?.ruleIdB].sort();
          expect(eids).toEqual([ruleA.id, ruleB.id].sort());
        }

        // Nenhuma versao foi registrada apos a rejeicao.
        expect(svc.listVersions()).toHaveLength(0);
      }),
      { numRuns: RUNS },
    );
  });

  it('(B) a versao ativa anterior e preservada ao rejeitar definicao/alteracao contraditoria (6.6)', () => {
    fc.assert(
      fc.property(contradictoryPairArb, ({ ruleA, ruleB }) => {
        const { svc, activeId } = serviceWithActiveVersion();
        const before = svc.getVersion(activeId);
        const versionsBefore = svc.listVersions();

        // 1) defineVersion de uma nova versao contraditoria falha.
        const defineRes = svc.defineVersion({
          id: toId(0xdd01),
          version: 'nova-contraditoria',
          validFrom: '2026-01-01',
          rules: [ruleA, ruleB],
          now: NOW,
        });
        expect(defineRes.ok).toBe(false);
        if (!defineRes.ok) expect(defineRes.error.code).toBe('rule-conflict');

        // 2) amendRule a partir da versao ativa, introduzindo a contradicao,
        //    tambem falha (a nova versao conteria ruleA + a regra conflitante).
        //    Primeiro definimos uma versao base que ja contem ruleA,
        //    para que adicionar ruleB crie a contradicao detectavel.
        const baseWithA = toId(0xbb00);
        must(
          svc.defineVersion({
            id: baseWithA,
            version: 'base-com-a',
            validFrom: '2026-01-01',
            rules: [ruleA],
            now: NOW,
          }),
          'defineVersion(base-com-a)',
        );
        must(
          svc.approveVersion({ id: baseWithA, approvedBy: APPROVER, approvedAt: APPROVED_AT }),
          'approveVersion(base-com-a)',
        );
        const amendRes = svc.amendRule({
          baseVersionId: baseWithA,
          newVersionId: toId(0xbb01),
          newVersion: 'amend-contraditoria',
          rule: ruleB, // adiciona a regra que contradiz ruleA sob a mesma condicao
          author: APPROVER,
          at: APPROVED_AT,
          reason: 'tentativa invalida',
          now: NOW,
        });
        expect(amendRes.ok).toBe(false);
        if (!amendRes.ok) expect(amendRes.error.code).toBe('rule-conflict');

        // A versao ativa anterior permanece intacta, aprovada e designavel.
        expect(svc.getVersion(activeId)).toEqual(before);
        expect(svc.assertDesignable(activeId).ok).toBe(true);

        // O amendRule rejeitado nao criou a nova versao nem registrou auditoria.
        expect(svc.getVersion(toId(0xbb01))).toBeUndefined();
        expect(svc.listAmendments()).toHaveLength(0);

        // O catalogo nao perdeu a versao ativa original (ela continua presente).
        const activeStill = svc.listVersions().filter((v) => v.id === activeId);
        expect(activeStill).toHaveLength(1);
        expect(activeStill[0]).toEqual(versionsBefore.find((v) => v.id === activeId));
      }),
      { numRuns: RUNS },
    );
  });

  it('(C) conjuntos NAO contraditorios sao definidos e aprovados (ativam) normalmente', () => {
    fc.assert(
      fc.property(compatiblePairArb, fc.boolean(), ({ ruleA, ruleB }, order) => {
        const rules = order ? [ruleA, ruleB] : [ruleB, ruleA];

        // Sem contradicao detectada.
        expect(detectRuleConflicts(rules)).toBeNull();

        const svc = new RuleSetService();
        const id = toId(0xee00);
        const defined = svc.defineVersion({
          id,
          version: 'compativel-v1',
          validFrom: '2026-01-01',
          rules,
          now: NOW,
        });
        expect(defined.ok).toBe(true);

        // A ativacao (aprovacao) tambem conclui sem conflito.
        const approved = svc.approveVersion({
          id,
          approvedBy: APPROVER,
          approvedAt: APPROVED_AT,
        });
        expect(approved.ok).toBe(true);
        if (approved.ok) {
          const v = approved.value as ApprovedRuleSet;
          expect(v.status).toBe('approved');
        }
        expect(svc.assertDesignable(id).ok).toBe(true);
      }),
      { numRuns: RUNS },
    );
  });

  it('(D) a ordem das regras nao muda o resultado e regras identicas nao conflitam', () => {
    fc.assert(
      fc.property(contradictoryPairArb, ({ ruleA, ruleB }) => {
        // Simetria: a deteccao independe da ordem.
        const forward = detectRuleConflicts([ruleA, ruleB]);
        const backward = detectRuleConflicts([ruleB, ruleA]);
        expect(forward?.code).toBe('rule-conflict');
        expect(backward?.code).toBe('rule-conflict');

        // Duas regras identicas (mesma applicability E mesma assertion) nao sao
        // contraditorias: afirmam a mesma coisa, nao prescrevem resultados
        // incompativeis.
        const twin: Rule = { ...ruleA, id: toId(0x7000) };
        expect(detectRuleConflicts([ruleA, twin])).toBeNull();
      }),
      { numRuns: RUNS },
    );
  });
});
