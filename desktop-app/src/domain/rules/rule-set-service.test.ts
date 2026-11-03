// Testes unitarios do RuleSetService (requisitos 6.1-6.13, 6.15, 6.16).
//
// Cobrem a validacao objetiva exigida pela tarefa 5.1:
//  - referencia ausente (excecao -> RF inexistente) e rejeitada;
//  - predicado invalido (fora da DSL / campo desconhecido) e rejeitado;
//  - versao sem aprovacao nao pode ser designada a um ciclo (6.10);
//  - excecao fora da vigencia e rejeitada (6.8);
//  - nenhuma dessas rejeicoes altera a versao ativa / o catalogo.
// Alem disso: imutabilidade de versoes (6.3), auditoria de alteracao (6.4),
// vigencia inclusiva/desconsideracao (6.5), conflito (6.6), justificativa 1-1000
// (6.16) e uso restrito a versao do ciclo (6.11, 6.15).

import { describe, expect, it } from 'vitest';

import { JUSTIFICATION_MAX, RuleSetService, detectRuleConflicts } from './rule-set-service';
import { field, lit } from './predicate';
import { validateEntity } from '../schemas/validator';
import type { Rule, RulePredicate, Uuid } from '../schemas/models';

const id = (n: number): Uuid =>
  `00000000-0000-4000-8000-${(n >>> 0).toString(16).padStart(12, '0')}`;

const NOW = '2026-01-15T12:00:00Z';
const APPROVED_AT = '2026-01-16T09:00:00Z';

/** Regra fundamental bem formada: para quartas, exige regente habilitado. */
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

function defineAndApprove(
  svc: RuleSetService,
  versionId: Uuid,
  label: string,
  rules: Rule[],
  validFrom = '2026-01-01',
  validUntil: string | undefined = '2026-12-31',
): void {
  const def = svc.defineVersion({
    id: versionId,
    version: label,
    validFrom,
    validUntil,
    rules,
    now: NOW,
  });
  if (!def.ok) throw new Error(`setup defineVersion falhou: ${JSON.stringify(def.error)}`);
  const app = svc.approveVersion({ id: versionId, approvedBy: id(0xaa), approvedAt: APPROVED_AT });
  if (!app.ok) throw new Error(`setup approveVersion falhou: ${JSON.stringify(app.error)}`);
}

describe('RuleSetService: definicao e aprovacao de versoes', () => {
  it('define um rascunho valido e aprova (6.12); o schema valida', () => {
    const svc = new RuleSetService();
    const def = svc.defineVersion({
      id: id(1),
      version: 'v1',
      validFrom: '2026-01-01',
      validUntil: '2026-12-31',
      rules: [fundamentalRule(id(10))],
      now: NOW,
    });
    expect(def.ok).toBe(true);
    if (def.ok) expect(def.value.status).toBe('draft');

    const app = svc.approveVersion({ id: id(1), approvedBy: id(0xaa), approvedAt: APPROVED_AT });
    expect(app.ok).toBe(true);
    if (app.ok) {
      expect(app.value.status).toBe('approved');
      expect(app.value.approvedBy).toBe(id(0xaa));
      expect(app.value.approvedAt).toBe(APPROVED_AT);
      expect(validateEntity('approvedRuleSet', app.value).valid).toBe(true);
    }
  });

  it('rejeita versao com id/label duplicado sem alterar o catalogo', () => {
    const svc = new RuleSetService();
    defineAndApprove(svc, id(1), 'v1', [fundamentalRule(id(10))]);
    const dupId = svc.defineVersion({
      id: id(1),
      version: 'v2',
      validFrom: '2026-01-01',
      rules: [],
      now: NOW,
    });
    expect(dupId.ok).toBe(false);
    if (!dupId.ok) expect(dupId.error.code).toBe('version-exists');
    const dupLabel = svc.defineVersion({
      id: id(2),
      version: 'v1',
      validFrom: '2026-01-01',
      rules: [],
      now: NOW,
    });
    expect(dupLabel.ok).toBe(false);
    expect(svc.listVersions()).toHaveLength(1);
  });
});

describe('RuleSetService: predicado invalido e referencia ausente (validacao objetiva)', () => {
  it('rejeita regra cujo predicado usa operacao desconhecida (sem codigo arbitrario)', () => {
    const svc = new RuleSetService();
    const bad: Rule = {
      ...fundamentalRule(id(10)),
      assertion: { op: 'eval', args: ['rm -rf /'] }, // fora da DSL
    };
    const def = svc.defineVersion({
      id: id(1),
      version: 'v1',
      validFrom: '2026-01-01',
      rules: [bad],
      now: NOW,
    });
    expect(def.ok).toBe(false);
    if (!def.ok) {
      expect(def.error.code).toBe('invalid-predicate');
      expect(def.error.predicateIssues && def.error.predicateIssues.length).toBeGreaterThan(0);
    }
    expect(svc.listVersions()).toHaveLength(0); // nada criado
  });

  it('rejeita regra que referencia campo desconhecido (referencia ausente)', () => {
    const svc = new RuleSetService();
    const bad: Rule = {
      ...fundamentalRule(id(10)),
      applicability: { op: 'eq', args: [field('service.inexistente'), lit('x')] },
    };
    const def = svc.defineVersion({
      id: id(1),
      version: 'v1',
      validFrom: '2026-01-01',
      rules: [bad],
      now: NOW,
    });
    expect(def.ok).toBe(false);
    if (!def.ok) expect(def.error.code).toBe('invalid-predicate');
  });
});

describe('RuleSetService: designacao a ciclo exige aprovacao (6.10)', () => {
  it('rejeita designar versao em rascunho (sem aprovacao registrada)', () => {
    const svc = new RuleSetService();
    const def = svc.defineVersion({
      id: id(1),
      version: 'v1',
      validFrom: '2026-01-01',
      rules: [fundamentalRule(id(10))],
      now: NOW,
    });
    expect(def.ok).toBe(true);
    const r = svc.assertDesignable(id(1));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('not-approved');
  });

  it('aceita designar versao aprovada', () => {
    const svc = new RuleSetService();
    defineAndApprove(svc, id(1), 'v1', [fundamentalRule(id(10))]);
    const r = svc.assertDesignable(id(1));
    expect(r.ok).toBe(true);
  });

  it('rejeita designar versao inexistente preservando a associacao vigente', () => {
    const svc = new RuleSetService();
    const r = svc.assertDesignable(id(0xdead));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('unknown-version');
  });
});

describe('RuleSetService: imutabilidade e alteracao versionada (6.3, 6.4)', () => {
  it('alterar uma regra cria NOVA versao sem modificar a base', () => {
    const svc = new RuleSetService();
    defineAndApprove(svc, id(1), 'v1', [fundamentalRule(id(10))]);
    const baseBefore = svc.getVersion(id(1));

    const amended = svc.amendRule({
      baseVersionId: id(1),
      newVersionId: id(2),
      newVersion: 'v2',
      rule: fundamentalRule(id(10), { op: 'true' }),
      author: id(0xaa),
      at: APPROVED_AT,
      reason: 'ajuste de habilitacao',
      now: NOW,
    });
    expect(amended.ok).toBe(true);
    if (amended.ok) {
      expect(amended.value.id).toBe(id(2));
      expect(amended.value.status).toBe('draft'); // precisa de nova aprovacao (6.10)
    }
    // Base inalterada (imutabilidade / 6.3).
    expect(svc.getVersion(id(1))).toEqual(baseBefore);
  });

  it('registra a auditoria da alteracao com conteudo anterior e posterior (6.4)', () => {
    const svc = new RuleSetService();
    defineAndApprove(svc, id(1), 'v1', [fundamentalRule(id(10))]);
    svc.amendRule({
      baseVersionId: id(1),
      newVersionId: id(2),
      newVersion: 'v2',
      rule: fundamentalRule(id(10), { op: 'true' }),
      author: id(0xaa),
      at: APPROVED_AT,
      reason: 'ajuste',
      now: NOW,
    });
    const log = svc.listAmendments();
    expect(log).toHaveLength(1);
    expect(log[0]!.author).toBe(id(0xaa));
    expect(log[0]!.reason).toBe('ajuste');
    expect(log[0]!.before).toBeDefined();
    expect(log[0]!.after.assertion).toEqual({ op: 'true' });
  });

  it('nao aprova versao em estado nao-rascunho', () => {
    const svc = new RuleSetService();
    defineAndApprove(svc, id(1), 'v1', [fundamentalRule(id(10))]);
    const again = svc.approveVersion({ id: id(1), approvedBy: id(0xaa), approvedAt: APPROVED_AT });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.code).toBe('immutable-version');
  });
});

describe('RuleSetService: conflito de regras nao e ativado (6.6)', () => {
  it('rejeita duas regras com mesma aplicabilidade e assercoes contraditorias', () => {
    const svc = new RuleSetService();
    const app: RulePredicate = { op: 'eq', args: [field('service.weekday'), lit('wednesday')] };
    const assertion: RulePredicate = {
      op: 'eq',
      args: [field('assignment.roleId'), lit('regente')],
    };
    const a: Rule = { ...fundamentalRule(id(10)), applicability: app, assertion };
    const b: Rule = {
      ...fundamentalRule(id(11)),
      applicability: app,
      assertion: { op: 'not', args: [assertion] },
    };

    const def = svc.defineVersion({
      id: id(1),
      version: 'v1',
      validFrom: '2026-01-01',
      rules: [a, b],
      now: NOW,
    });
    expect(def.ok).toBe(false);
    if (!def.ok) {
      expect(def.error.code).toBe('rule-conflict');
      expect(def.error.conflict?.ruleIdA).toBe(id(10));
      expect(def.error.conflict?.ruleIdB).toBe(id(11));
    }
    expect(svc.listVersions()).toHaveLength(0);
  });

  it('detectRuleConflicts: true/false sob a mesma aplicabilidade conflita', () => {
    const app: RulePredicate = { op: 'eq', args: [field('service.weekday'), lit('saturday')] };
    const a: Rule = { ...fundamentalRule(id(10)), applicability: app, assertion: { op: 'true' } };
    const b: Rule = { ...fundamentalRule(id(11)), applicability: app, assertion: { op: 'false' } };
    expect(detectRuleConflicts([a, b])).not.toBeNull();
  });

  it('nao reporta conflito quando as aplicabilidades diferem', () => {
    const a: Rule = {
      ...fundamentalRule(id(10)),
      applicability: { op: 'eq', args: [field('service.weekday'), lit('wednesday')] },
      assertion: { op: 'true' },
    };
    const b: Rule = {
      ...fundamentalRule(id(11)),
      applicability: { op: 'eq', args: [field('service.weekday'), lit('saturday')] },
      assertion: { op: 'false' },
    };
    expect(detectRuleConflicts([a, b])).toBeNull();
  });
});

describe('RuleSetService: aplicabilidade temporal (6.5) e uso restrito a versao (6.11, 6.15)', () => {
  it('desconsidera a versao quando a vigencia nao intersecta nenhuma data do ciclo (6.5)', () => {
    const svc = new RuleSetService();
    defineAndApprove(svc, id(1), 'v1', [fundamentalRule(id(10))], '2026-06-01', '2026-06-30');

    const emptyMonth = svc.applicableRules(id(1), ['2026-01-07', '2026-01-10']);
    expect(emptyMonth.ok).toBe(true);
    if (emptyMonth.ok) expect(emptyMonth.value).toHaveLength(0);

    const inRange = svc.applicableRules(id(1), ['2026-06-10']);
    expect(inRange.ok).toBe(true);
    if (inRange.ok) expect(inRange.value).toHaveLength(1);
  });

  it('obtem regra da versao do ciclo e rejeita regra ausente (6.15)', () => {
    const svc = new RuleSetService();
    defineAndApprove(svc, id(1), 'v1', [fundamentalRule(id(10))]);
    expect(svc.getRuleInVersion(id(1), id(10)).ok).toBe(true);
    const missing = svc.getRuleInVersion(id(1), id(0xdead));
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error.code).toBe('rule-not-in-version');
  });
});

describe('RuleSetService: excecoes aprovadas (6.7, 6.8, 6.16)', () => {
  function serviceSvc(): RuleSetService {
    const svc = new RuleSetService();
    defineAndApprove(svc, id(1), 'v1', [fundamentalRule(id(10))]);
    return svc;
  }

  const condition: RulePredicate = { op: 'eq', args: [field('assignment.roleId'), lit('regente')] };

  it('registra excecao valida e o schema valida (6.7)', () => {
    const svc = serviceSvc();
    const r = svc.registerException({
      id: id(100),
      fundamentalRuleId: id(10),
      condition,
      validFrom: '2026-03-01',
      validUntil: '2026-03-31',
      justification: 'emergencia pontual aprovada',
      approvedBy: id(0xaa),
      approvedAt: APPROVED_AT,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(validateEntity('approvedException', r.value).valid).toBe(true);
  });

  it('rejeita excecao que referencia RF inexistente (referencia ausente)', () => {
    const svc = serviceSvc();
    const r = svc.registerException({
      id: id(100),
      fundamentalRuleId: id(0xdead),
      condition,
      validFrom: '2026-03-01',
      validUntil: '2026-03-31',
      justification: 'tentativa invalida',
      approvedBy: id(0xaa),
      approvedAt: APPROVED_AT,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('missing-reference');
    expect(svc.listExceptions()).toHaveLength(0);
  });

  it('rejeita justificativa vazia e justificativa com 1001 caracteres (6.16)', () => {
    const svc = serviceSvc();
    const base = {
      id: id(100),
      fundamentalRuleId: id(10),
      condition,
      validFrom: '2026-03-01',
      validUntil: '2026-03-31',
      approvedBy: id(0xaa),
      approvedAt: APPROVED_AT,
    };
    const empty = svc.registerException({ ...base, justification: '   ' });
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.error.code).toBe('justification-length');

    const tooLong = svc.registerException({
      ...base,
      justification: 'x'.repeat(JUSTIFICATION_MAX + 1),
    });
    expect(tooLong.ok).toBe(false);

    const okLen = svc.registerException({ ...base, justification: 'x'.repeat(JUSTIFICATION_MAX) });
    expect(okLen.ok).toBe(true);
  });

  it('rejeita vigencia invertida (validUntil < validFrom)', () => {
    const svc = serviceSvc();
    const r = svc.registerException({
      id: id(100),
      fundamentalRuleId: id(10),
      condition,
      validFrom: '2026-03-31',
      validUntil: '2026-03-01',
      justification: 'vigencia invertida',
      approvedBy: id(0xaa),
      approvedAt: APPROVED_AT,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('exception-range');
  });

  it('assertExceptionApplicable: vigencia inclusiva nas bordas e rejeita fora (6.8)', () => {
    const svc = serviceSvc();
    svc.registerException({
      id: id(100),
      fundamentalRuleId: id(10),
      condition,
      validFrom: '2026-03-01',
      validUntil: '2026-03-31',
      justification: 'janela de marco',
      approvedBy: id(0xaa),
      approvedAt: APPROVED_AT,
    });

    expect(svc.assertExceptionApplicable(id(100), '2026-03-01').ok).toBe(true); // borda inicial
    expect(svc.assertExceptionApplicable(id(100), '2026-03-15').ok).toBe(true); // dentro
    expect(svc.assertExceptionApplicable(id(100), '2026-03-31').ok).toBe(true); // borda final

    const before = svc.assertExceptionApplicable(id(100), '2026-02-28');
    expect(before.ok).toBe(false);
    if (!before.ok) expect(before.error.code).toBe('exception-out-of-validity');

    const after = svc.assertExceptionApplicable(id(100), '2026-04-01');
    expect(after.ok).toBe(false);
    if (!after.ok) expect(after.error.code).toBe('exception-out-of-validity');
  });

  it('rejeita condicao de excecao com predicado invalido', () => {
    const svc = serviceSvc();
    const r = svc.registerException({
      id: id(100),
      fundamentalRuleId: id(10),
      condition: { op: 'exec', args: ['codigo'] },
      validFrom: '2026-03-01',
      validUntil: '2026-03-31',
      justification: 'predicado invalido',
      approvedBy: id(0xaa),
      approvedAt: APPROVED_AT,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('invalid-predicate');
  });
});
