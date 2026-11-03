// Testes unitarios da consolidacao versionada das fontes legadas (tarefa 5.2).
//
// Validacao objetiva da tarefa:
//  - o relatorio liga CADA regra a sua origem (fontes) e a decisao aplicada;
//  - NENHUMA precedencia silenciosa: divergencia sem decisao fica pendente e
//    bloqueia a emissao; divergencia resolvida registra fonte + justificativa;
//  - `RuleSet v1` so e emitido com ZERO pendencias e aprovacao registrada
//    (16.7, 16.11);
//  - o ciclo fixa uma versao IMUTAVEL (via RuleSetService; versao aprovada
//    nao pode ser redefinida/alterada).
//
// As fontes legadas sao tratadas como entrada somente-leitura (fixtures); o
// modulo nao le nem altera arquivos do legado.

import { describe, expect, it } from 'vitest';

import { RuleSetService } from './rule-set-service';
import { field, lit } from './predicate';
import {
  emitInitialRuleSet,
  reconcileSources,
  type SourceRuleProposal,
} from './rule-consolidation';
import { validateEntity } from '../schemas/validator';
import type { Rule, RulePredicate, Uuid } from '../schemas/models';

const id = (n: number): Uuid =>
  `00000000-0000-4000-8000-${(n >>> 0).toString(16).padStart(12, '0')}`;

const NOW = '2026-01-15T12:00:00Z';
const APPROVED_AT = '2026-01-16T09:00:00Z';
const APPROVER = id(0xaa);

/** Regra fundamental bem formada (quarta exige regente habilitado). */
function fundamentalRule(ruleId: Uuid, assertion?: RulePredicate): Rule {
  return {
    id: ruleId,
    kind: 'fundamental',
    severity: 'blocking',
    applicability: { op: 'eq', args: [field('service.weekday'), lit('wednesday')] },
    assertion: assertion ?? {
      op: 'includes',
      args: ['subject.capabilityIds', field('assignment.roleId')],
    },
    messageTemplate: 'regente nao habilitado na quarta',
    allowedExceptionTypeIds: [],
  };
}

function preferenceRule(ruleId: Uuid, assertion: RulePredicate): Rule {
  return {
    id: ruleId,
    kind: 'preference',
    severity: 'warning',
    applicability: { op: 'eq', args: [field('service.weekday'), lit('saturday')] },
    assertion,
    messageTemplate: 'preferencia de sabado',
    allowedExceptionTypeIds: [],
  };
}

function emitInput(
  proposals: SourceRuleProposal[],
  resolutions?: Parameters<typeof emitInitialRuleSet>[1]['resolutions'],
) {
  return {
    proposals,
    ...(resolutions ? { resolutions } : {}),
    versionId: id(1),
    versionLabel: 'v1',
    validFrom: '2026-01-01',
    validUntil: '2026-12-31',
    approvedBy: APPROVER,
    approvedAt: APPROVED_AT,
    now: NOW,
  };
}

// --------------------------------------------------------------------------
// reconcileSources: a grade de decisao
// --------------------------------------------------------------------------

describe('reconcileSources: liga cada regra a origem e decisao (16.5)', () => {
  it('classifica como "agreed" uma regra de fonte unica', () => {
    const proposals: SourceRuleProposal[] = [
      { source: 'docs/regras/REGRAS.md', rule: fundamentalRule(id(10)) },
    ];
    const report = reconcileSources(proposals);
    expect(report.totals).toEqual({ recognized: 1, agreed: 1, resolved: 0, pending: 0 });
    const item = report.items[0]!;
    expect(item.status).toBe('agreed');
    expect(item.sources).toEqual(['docs/regras/REGRAS.md']);
    expect(item.effectiveRule).toBeDefined();
    expect(item.reason).toContain('uma unica fonte');
  });

  it('classifica como "agreed" quando fontes concordam no mesmo conteudo', () => {
    const proposals: SourceRuleProposal[] = [
      { source: 'docs/regras/REGRAS.md', rule: fundamentalRule(id(10)) },
      { source: 'docs/regras/regras.json', rule: fundamentalRule(id(10)) },
    ];
    const report = reconcileSources(proposals);
    expect(report.totals.agreed).toBe(1);
    const item = report.items[0]!;
    expect(item.sources).toEqual(['docs/regras/REGRAS.md', 'docs/regras/regras.json']);
    expect(item.variants).toHaveLength(1);
  });

  it('classifica como "pending" quando fontes divergem e nao ha decisao', () => {
    const proposals: SourceRuleProposal[] = [
      { source: 'docs/regras/REGRAS.md', rule: fundamentalRule(id(10), { op: 'true' }) },
      { source: 'docs/resumo.md', rule: fundamentalRule(id(10), { op: 'false' }) },
    ];
    const report = reconcileSources(proposals);
    expect(report.totals.pending).toBe(1);
    expect(report.pendingRuleIds).toEqual([id(10)]);
    const item = report.items[0]!;
    expect(item.status).toBe('pending');
    expect(item.variants).toHaveLength(2);
    expect(item.effectiveRule).toBeUndefined(); // nenhuma vence silenciosamente
  });

  it('classifica como "resolved" quando ha decisao explicita para a divergencia', () => {
    const proposals: SourceRuleProposal[] = [
      { source: 'docs/regras/REGRAS.md', rule: fundamentalRule(id(10), { op: 'true' }) },
      { source: 'docs/resumo.md', rule: fundamentalRule(id(10), { op: 'false' }) },
    ];
    const report = reconcileSources(proposals, [
      { ruleId: id(10), chosenSource: 'docs/regras/REGRAS.md', justification: 'fonte oficial revisada' },
    ]);
    expect(report.totals.resolved).toBe(1);
    const item = report.items[0]!;
    expect(item.status).toBe('resolved');
    expect(item.chosenSource).toBe('docs/regras/REGRAS.md');
    expect(item.justification).toBe('fonte oficial revisada');
    expect(item.effectiveRule!.assertion).toEqual({ op: 'true' });
  });

  it('e deterministico: a ordem das propostas nao altera o resultado', () => {
    const a: SourceRuleProposal = { source: 'b.md', rule: fundamentalRule(id(10), { op: 'true' }) };
    const b: SourceRuleProposal = { source: 'a.md', rule: preferenceRule(id(20), { op: 'true' }) };
    expect(reconcileSources([a, b])).toEqual(reconcileSources([b, a]));
  });
});

// --------------------------------------------------------------------------
// emitInitialRuleSet: gates de emissao (16.7, 16.11) e origem/decisao (6.14)
// --------------------------------------------------------------------------

describe('emitInitialRuleSet: emite RuleSet v1 com zero pendencias e aprovacao', () => {
  it('emite a versao inicial quando nao ha divergencia e registra origem/decisao', () => {
    const svc = new RuleSetService();
    const proposals: SourceRuleProposal[] = [
      { source: 'docs/regras/REGRAS.md', rule: fundamentalRule(id(10)) },
      { source: 'docs/regras/regras.json', rule: preferenceRule(id(20), { op: 'true' }) },
    ];
    const r = emitInitialRuleSet(svc, emitInput(proposals));
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const rs = r.value.ruleSet;
    expect(rs.status).toBe('approved');
    expect(rs.approvedBy).toBe(APPROVER);
    expect(rs.approvedAt).toBe(APPROVED_AT);
    expect(rs.rules.map((x) => x.id).sort()).toEqual([id(10), id(20)].sort());

    // Origem/decisao: UMA entrada por regra, ligando regra -> fonte -> decisao.
    expect(rs.sourceDecisions).toHaveLength(2);
    const byRule = new Map(rs.sourceDecisions.map((d) => [d.ruleId, d]));
    expect(byRule.get(id(10))!.source).toBe('docs/regras/REGRAS.md');
    expect(byRule.get(id(10))!.decision).toContain('sem divergencia');

    // A versao emitida valida contra o schema canonico (sem modelo paralelo).
    expect(validateEntity('approvedRuleSet', rs).valid).toBe(true);
  });

  it('registra a decisao (fonte + justificativa) para divergencia resolvida (6.14)', () => {
    const svc = new RuleSetService();
    const proposals: SourceRuleProposal[] = [
      { source: 'docs/regras/REGRAS.md', rule: fundamentalRule(id(10), { op: 'true' }) },
      { source: 'docs/resumo.md', rule: fundamentalRule(id(10), { op: 'false' }) },
    ];
    const r = emitInitialRuleSet(
      svc,
      emitInput(proposals, [
        { ruleId: id(10), chosenSource: 'docs/resumo.md', justification: 'alinhado com a pratica atual' },
      ]),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const decision = r.value.ruleSet.sourceDecisions.find((d) => d.ruleId === id(10))!;
    expect(decision.source).toContain('docs/regras/REGRAS.md');
    expect(decision.source).toContain('docs/resumo.md');
    expect(decision.decision).toContain('docs/resumo.md');
    expect(decision.decision).toContain('alinhado com a pratica atual');
    // A regra efetiva e a da fonte escolhida.
    const rule = r.value.ruleSet.rules.find((x) => x.id === id(10))!;
    expect(rule.assertion).toEqual({ op: 'false' });
  });
});

describe('emitInitialRuleSet: pendencia impede a emissao (16.7, 16.11); sem precedencia silenciosa', () => {
  it('NAO emite a versao quando existe divergencia pendente e preserva ausencia de versao', () => {
    const svc = new RuleSetService();
    const proposals: SourceRuleProposal[] = [
      { source: 'docs/regras/REGRAS.md', rule: fundamentalRule(id(10), { op: 'true' }) },
      { source: 'docs/resumo.md', rule: fundamentalRule(id(10), { op: 'false' }) },
    ];
    const r = emitInitialRuleSet(svc, emitInput(proposals));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('pending-divergences');
    expect(r.error.pendingRuleIds).toEqual([id(10)]);
    // Nenhuma versao foi criada no catalogo (sem precedencia silenciosa).
    expect(svc.listVersions()).toHaveLength(0);
  });

  it('nao emite quando apenas parte das divergencias foi resolvida', () => {
    const svc = new RuleSetService();
    const proposals: SourceRuleProposal[] = [
      { source: 'a.md', rule: fundamentalRule(id(10), { op: 'true' }) },
      { source: 'b.md', rule: fundamentalRule(id(10), { op: 'false' }) },
      { source: 'a.md', rule: preferenceRule(id(20), { op: 'true' }) },
      { source: 'b.md', rule: preferenceRule(id(20), { op: 'false' }) },
    ];
    const r = emitInitialRuleSet(
      svc,
      emitInput(proposals, [{ ruleId: id(10), chosenSource: 'a.md', justification: 'x' }]),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('pending-divergences');
    expect(r.error.pendingRuleIds).toEqual([id(20)]);
    expect(svc.listVersions()).toHaveLength(0);
  });
});

describe('emitInitialRuleSet: resolucoes malformadas sao rejeitadas', () => {
  const svc = () => new RuleSetService();
  const divergent: SourceRuleProposal[] = [
    { source: 'a.md', rule: fundamentalRule(id(10), { op: 'true' }) },
    { source: 'b.md', rule: fundamentalRule(id(10), { op: 'false' }) },
  ];

  it('rejeita decisao para regra inexistente', () => {
    const r = emitInitialRuleSet(
      svc(),
      emitInput(divergent, [{ ruleId: id(999), chosenSource: 'a.md', justification: 'x' }]),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('invalid-resolution');
  });

  it('rejeita decisao para regra sem divergencia', () => {
    const agreed: SourceRuleProposal[] = [{ source: 'a.md', rule: fundamentalRule(id(10)) }];
    const r = emitInitialRuleSet(
      svc(),
      emitInput(agreed, [{ ruleId: id(10), chosenSource: 'a.md', justification: 'x' }]),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('invalid-resolution');
  });

  it('rejeita decisao que escolhe fonte que nao propos a regra', () => {
    const r = emitInitialRuleSet(
      svc(),
      emitInput(divergent, [{ ruleId: id(10), chosenSource: 'c.md', justification: 'x' }]),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('invalid-resolution');
  });
});

describe('emitInitialRuleSet: propaga erros do RuleSetService (predicado/conflito)', () => {
  it('nao emite quando duas regras sao contraditorias (6.6)', () => {
    const svc = new RuleSetService();
    const app: RulePredicate = { op: 'eq', args: [field('service.weekday'), lit('wednesday')] };
    const assertion: RulePredicate = { op: 'eq', args: [field('assignment.roleId'), lit('regente')] };
    const proposals: SourceRuleProposal[] = [
      { source: 'a.md', rule: { ...fundamentalRule(id(10)), applicability: app, assertion } },
      {
        source: 'b.md',
        rule: { ...fundamentalRule(id(11)), applicability: app, assertion: { op: 'not', args: [assertion] } },
      },
    ];
    const r = emitInitialRuleSet(svc, emitInput(proposals));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('rule-set-error');
      expect(r.error.ruleSetError?.code).toBe('rule-conflict');
    }
  });

  it('nao emite quando um predicado e invalido (fora da DSL)', () => {
    const svc = new RuleSetService();
    const bad: Rule = { ...fundamentalRule(id(10)), assertion: { op: 'eval', args: ['x'] } };
    const r = emitInitialRuleSet(svc, emitInput([{ source: 'a.md', rule: bad }]));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('rule-set-error');
      expect(r.error.ruleSetError?.code).toBe('invalid-predicate');
    }
  });
});

describe('emitInitialRuleSet: o ciclo fixa uma versao imutavel', () => {
  it('a versao emitida nao pode ser redefinida nem alterada (congelada)', () => {
    const svc = new RuleSetService();
    const proposals: SourceRuleProposal[] = [
      { source: 'a.md', rule: fundamentalRule(id(10)) },
    ];
    const r = emitInitialRuleSet(svc, emitInput(proposals));
    expect(r.ok).toBe(true);

    // Redefinir mesmo id/label e rejeitado.
    const redefine = svc.defineVersion({
      id: id(1),
      version: 'v1',
      validFrom: '2026-01-01',
      rules: [],
      now: NOW,
    });
    expect(redefine.ok).toBe(false);

    // Reaprovar versao ja aprovada e rejeitado (imutavel).
    const reapprove = svc.approveVersion({ id: id(1), approvedBy: APPROVER, approvedAt: APPROVED_AT });
    expect(reapprove.ok).toBe(false);
    if (!reapprove.ok) expect(reapprove.error.code).toBe('immutable-version');

    // Snapshot permanece aprovado e inalterado.
    const frozen = svc.getVersion(id(1))!;
    expect(frozen.status).toBe('approved');
    expect(frozen.rules).toHaveLength(1);
  });
});
