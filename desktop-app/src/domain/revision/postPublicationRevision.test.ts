// Testes unitarios das revisoes pos-publicacao (tarefa 10.3).
//
// Validacao objetiva: todas as acoes anteriores a confirmacao preservam o hash
// da vigente; confirmar cria o backup da vigente ANTES de substitui-la; a
// alteracao posterior a aprovacao invalida a aprovacao; a regeneracao de links
// atinge apenas os sujeitos afetados; a rotacao conta cada atribuicao vigente
// exatamente uma vez.
//
// Requisitos: 14.1-14.13.

import { describe, it, expect } from 'vitest';
import type { Assignment, PublicServiceFields } from '../schemas/models';
import {
  applyCancellation,
  applyPublicCorrection,
  applySubstitution,
  confirmRevisionPublication,
  isApprovalValid,
  markApproved,
  recomputeRotation,
  regenerateAffectedLinks,
  revisionContentHash,
  scheduleContentHash,
  startRevision,
  type PublishedSchedule,
} from './postPublicationRevision';

// --------------------------------------------------------------------------
// Fixtures
// --------------------------------------------------------------------------

const SVC1 = '11111111-1111-4111-8111-111111111111';
const SVC2 = '22222222-2222-4222-8222-222222222222';
const ROLE_REGENTE = 'aaaa1111-1111-4111-8111-111111111111';
const ROLE_EQUIPE = 'bbbb2222-2222-4222-8222-222222222222';
const P_ANA = 'p-ana-0000-4000-8000-000000000001';
const P_BRUNO = 'p-bruno-000-4000-8000-000000000002';
const P_CARLA = 'p-carla-000-4000-8000-000000000003';

function assignment(partial: Partial<Assignment> & { id: string; serviceId: string; roleId: string; subjectId: string }): Assignment {
  return {
    id: partial.id,
    serviceId: partial.serviceId,
    roleId: partial.roleId,
    ...(partial.slot !== undefined ? { slot: partial.slot } : {}),
    subject: { type: 'person', id: partial.subjectId },
    source: partial.source ?? 'manual',
  };
}

function currentSchedule(): PublishedSchedule {
  const assignments: Assignment[] = [
    assignment({ id: 'a1', serviceId: SVC1, roleId: ROLE_REGENTE, subjectId: P_ANA }),
    assignment({ id: 'a2', serviceId: SVC1, roleId: ROLE_EQUIPE, subjectId: P_BRUNO }),
    assignment({ id: 'a3', serviceId: SVC2, roleId: ROLE_REGENTE, subjectId: P_ANA }),
  ];
  const publicFields: PublicServiceFields[] = [
    { serviceId: SVC1, fields: { TEMA: 'Gratidao' } },
    { serviceId: SVC2, fields: { TEMA: 'Esperanca' } },
  ];
  return {
    cycleId: 'c-0000-0000-4000-8000-000000000000',
    period: '2026-02',
    revision: scheduleContentHash({ assignments, publicFields }),
    assignments,
    publicFields,
  };
}

const NOW = '2026-02-20T10:00:00Z';

// --------------------------------------------------------------------------
// 14.1 — criar revisao como copia da vigente, sem alterar a vigente
// --------------------------------------------------------------------------

describe('startRevision (14.1)', () => {
  it('cria uma copia editavel da vigente guardando o hash base', () => {
    const current = currentSchedule();
    const rev = startRevision({ id: 'rev-1', current, createdAt: NOW });

    expect(rev.baseRevision).toBe(current.revision);
    expect(rev.assignments).toEqual(current.assignments);
    expect(rev.publicFields).toEqual(current.publicFields);
    expect(rev.changes).toEqual([]);
    expect(rev.approval).toEqual({ kind: 'none' });
    // O conteudo clonado nao e a MESMA referencia (copia profunda suficiente).
    expect(rev.assignments).not.toBe(current.assignments);
    expect(rev.assignments[0]).not.toBe(current.assignments[0]);
  });

  it('o hash do conteudo da revisao recem-criada e igual ao da vigente', () => {
    const current = currentSchedule();
    const rev = startRevision({ id: 'rev-1', current, createdAt: NOW });
    expect(revisionContentHash(rev)).toBe(current.revision);
  });
});

// --------------------------------------------------------------------------
// 14.2 — troca
// --------------------------------------------------------------------------

describe('applySubstitution (14.2)', () => {
  it('substitui o sujeito, exige motivo e registra auditoria com data/hora/operador', () => {
    const rev = startRevision({ id: 'rev-1', current: currentSchedule(), createdAt: NOW });
    const res = applySubstitution(rev, {
      kind: 'substitution',
      serviceId: SVC1,
      roleId: ROLE_REGENTE,
      replacedSubjectId: P_ANA,
      substituteSubjectId: P_CARLA,
      reason: 'Ana ficou doente',
      at: NOW,
      operatorId: 'op-1',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const updated = res.value.assignments.find((a) => a.serviceId === SVC1 && a.roleId === ROLE_REGENTE)!;
    expect(updated.subject.id).toBe(P_CARLA);
    expect(res.value.changes).toHaveLength(1);
    expect(res.value.audit).toHaveLength(1);
    const ev = res.value.audit[0]!;
    expect(ev.action).toBe('substitution');
    expect(ev.operatorId).toBe('op-1');
    expect(ev.timestamp).toBe(NOW);
    expect(ev.changes.some((c) => c.field === 'reason' && c.after === 'Ana ficou doente')).toBe(true);
  });

  it('rejeita troca sem motivo e preserva o estado', () => {
    const rev = startRevision({ id: 'rev-1', current: currentSchedule(), createdAt: NOW });
    const res = applySubstitution(rev, {
      kind: 'substitution',
      serviceId: SVC1,
      roleId: ROLE_REGENTE,
      replacedSubjectId: P_ANA,
      substituteSubjectId: P_CARLA,
      reason: '   ',
      at: NOW,
      operatorId: 'op-1',
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.errors.some((e) => e.code === 'missing-reason')).toBe(true);
  });

  it('rejeita troca quando a pessoa substituida nao esta na funcao', () => {
    const rev = startRevision({ id: 'rev-1', current: currentSchedule(), createdAt: NOW });
    const res = applySubstitution(rev, {
      kind: 'substitution',
      serviceId: SVC1,
      roleId: ROLE_REGENTE,
      replacedSubjectId: P_BRUNO, // Bruno nao e regente no SVC1
      substituteSubjectId: P_CARLA,
      reason: 'x',
      at: NOW,
      operatorId: 'op-1',
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.errors.some((e) => e.code === 'assignment-not-found')).toBe(true);
  });
});

// --------------------------------------------------------------------------
// 14.3 — cancelamento
// --------------------------------------------------------------------------

describe('applyCancellation (14.3)', () => {
  it('remove o item e registra auditoria; exige motivo', () => {
    const rev = startRevision({ id: 'rev-1', current: currentSchedule(), createdAt: NOW });
    const res = applyCancellation(rev, {
      kind: 'cancellation',
      serviceId: SVC1,
      assignmentId: 'a2',
      reason: 'Bruno viajou',
      at: NOW,
      operatorId: 'op-1',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.assignments.find((a) => a.id === 'a2')).toBeUndefined();
    expect(res.value.assignments).toHaveLength(2);
    expect(res.value.audit[0]!.action).toBe('cancellation');
  });

  it('rejeita cancelamento de item inexistente', () => {
    const rev = startRevision({ id: 'rev-1', current: currentSchedule(), createdAt: NOW });
    const res = applyCancellation(rev, {
      kind: 'cancellation',
      serviceId: SVC1,
      assignmentId: 'inexistente',
      reason: 'x',
      at: NOW,
      operatorId: 'op-1',
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.errors.some((e) => e.code === 'assignment-not-found')).toBe(true);
  });
});

// --------------------------------------------------------------------------
// 14.4 — correcao de dado publico
// --------------------------------------------------------------------------

describe('applyPublicCorrection (14.4)', () => {
  it('registra campo, valores anterior e novo (lido do estado), motivo e auditoria', () => {
    const rev = startRevision({ id: 'rev-1', current: currentSchedule(), createdAt: NOW });
    const res = applyPublicCorrection(rev, {
      kind: 'public-correction',
      serviceId: SVC1,
      field: 'TEMA',
      reason: 'Tema trocado pelo pastor',
      at: NOW,
      operatorId: 'op-1',
      after: 'Fe',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const svc = res.value.publicFields.find((p) => p.serviceId === SVC1)!;
    expect(svc.fields['TEMA']).toBe('Fe');
    const change = res.value.changes[0] as Extract<typeof res.value.changes[number], { kind: 'public-correction' }>;
    expect(change.before).toBe('Gratidao'); // valor real do estado, nao o informado
    expect(change.after).toBe('Fe');
    expect(res.value.audit[0]!.changes.some((c) => c.field === 'TEMA' && c.before === 'Gratidao' && c.after === 'Fe')).toBe(true);
  });

  it('rejeita correcao de culto sem campos publicos na revisao', () => {
    const rev = startRevision({ id: 'rev-1', current: currentSchedule(), createdAt: NOW });
    const res = applyPublicCorrection(rev, {
      kind: 'public-correction',
      serviceId: 'culto-inexistente',
      field: 'TEMA',
      reason: 'x',
      at: NOW,
      operatorId: 'op-1',
      after: 'Fe',
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.errors.some((e) => e.code === 'public-field-not-found')).toBe(true);
  });
});

// --------------------------------------------------------------------------
// 14.1/Property 45 — a vigente nunca muda antes da confirmacao
// --------------------------------------------------------------------------

describe('isolamento da vigente antes da confirmacao (14.1, Property 45)', () => {
  it('editar a revisao (troca/cancelamento/correcao) nao altera o hash da vigente', () => {
    const current = currentSchedule();
    const hashBefore = current.revision;

    let rev = startRevision({ id: 'rev-1', current, createdAt: NOW });
    const r1 = applySubstitution(rev, {
      kind: 'substitution', serviceId: SVC1, roleId: ROLE_REGENTE,
      replacedSubjectId: P_ANA, substituteSubjectId: P_CARLA,
      reason: 'motivo', at: NOW, operatorId: 'op-1',
    });
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    rev = r1.value;

    const r2 = applyCancellation(rev, {
      kind: 'cancellation', serviceId: SVC1, assignmentId: 'a2',
      reason: 'motivo', at: NOW, operatorId: 'op-1',
    });
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    rev = r2.value;

    // A vigente permanece com o MESMO hash e o MESMO conteudo.
    expect(current.revision).toBe(hashBefore);
    expect(scheduleContentHash(current)).toBe(hashBefore);
    // A revisao divergiu da vigente.
    expect(revisionContentHash(rev)).not.toBe(hashBefore);
  });
});

// --------------------------------------------------------------------------
// 14.8 — alterar depois de aprovar invalida a aprovacao
// --------------------------------------------------------------------------

describe('invalidacao de aprovacao por alteracao posterior (14.8)', () => {
  it('a aprovacao e valida imediatamente apos marcar aprovado', () => {
    const rev = startRevision({ id: 'rev-1', current: currentSchedule(), createdAt: NOW });
    const approved = markApproved(rev, 'ap-1');
    expect(approved.approval.kind).toBe('approved');
    expect(isApprovalValid(approved)).toBe(true);
  });

  it('qualquer alteracao posterior invalida a aprovacao', () => {
    const rev = startRevision({ id: 'rev-1', current: currentSchedule(), createdAt: NOW });
    const approved = markApproved(rev, 'ap-1');
    const res = applyCancellation(approved, {
      kind: 'cancellation', serviceId: SVC1, assignmentId: 'a1',
      reason: 'motivo', at: NOW, operatorId: 'op-1',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.approval.kind).toBe('invalidated');
    expect(isApprovalValid(res.value)).toBe(false);
  });
});

// --------------------------------------------------------------------------
// 14.9/14.11 — confirmacao cria backup antes de substituir
// --------------------------------------------------------------------------

describe('confirmRevisionPublication (14.9, 14.11)', () => {
  it('bloqueia confirmacao de revisao nao aprovada', () => {
    const current = currentSchedule();
    const rev = startRevision({ id: 'rev-1', current, createdAt: NOW });
    const res = confirmRevisionPublication({ revision: rev, current, at: NOW, operatorId: 'op-1', operationId: 'pub-1' });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.errors.some((e) => e.code === 'not-approved')).toBe(true);
  });

  it('bloqueia confirmacao quando a revisao foi alterada apos aprovar (aprovacao invalidada)', () => {
    const current = currentSchedule();
    let rev = startRevision({ id: 'rev-1', current, createdAt: NOW });
    rev = markApproved(rev, 'ap-1');
    const changed = applyPublicCorrection(rev, {
      kind: 'public-correction', serviceId: SVC1, field: 'TEMA',
      reason: 'motivo', at: NOW, operatorId: 'op-1', after: 'Novo',
    });
    expect(changed.ok).toBe(true);
    if (!changed.ok) return;
    // Alterar apos aprovar invalida a aprovacao (14.8): a confirmacao e
    // bloqueada por 'not-approved' (a aprovacao deixou de existir).
    expect(changed.value.approval.kind).toBe('invalidated');
    const res = confirmRevisionPublication({ revision: changed.value, current, at: NOW, operatorId: 'op-1', operationId: 'pub-1' });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.errors.some((e) => e.code === 'not-approved')).toBe(true);
  });

  it('cria backup da vigente anterior e produz a nova vigente com novo hash', () => {
    const current = currentSchedule();
    let rev = startRevision({ id: 'rev-1', current, createdAt: NOW });
    const sub = applySubstitution(rev, {
      kind: 'substitution', serviceId: SVC1, roleId: ROLE_REGENTE,
      replacedSubjectId: P_ANA, substituteSubjectId: P_CARLA,
      reason: 'motivo', at: NOW, operatorId: 'op-1',
    });
    expect(sub.ok).toBe(true);
    if (!sub.ok) return;
    rev = markApproved(sub.value, 'ap-1');

    const res = confirmRevisionPublication({ revision: rev, current, at: NOW, operatorId: 'op-1', operationId: 'pub-1' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    // Backup preserva EXATAMENTE a vigente anterior (14.9).
    expect(res.value.backupOfPrevious.revision).toBe(current.revision);
    expect(res.value.backupOfPrevious.assignments).toEqual(current.assignments);

    // Nova vigente reflete a revisao e tem hash diferente.
    expect(res.value.newCurrent.revision).not.toBe(current.revision);
    expect(res.value.newCurrent.assignments.find((a) => a.roleId === ROLE_REGENTE && a.serviceId === SVC1)!.subject.id).toBe(P_CARLA);

    // Auditoria da confirmacao (14.11).
    expect(res.value.audit.action).toBe('post-publication-confirm');
    expect(res.value.audit.changes[0]!.before).toBe(current.revision);
    expect(res.value.audit.changes[0]!.after).toBe(res.value.newCurrent.revision);

    // A vigente original (entrada) nao foi mutada.
    expect(current.assignments.find((a) => a.roleId === ROLE_REGENTE && a.serviceId === SVC1)!.subject.id).toBe(P_ANA);
  });
});

// --------------------------------------------------------------------------
// 14.12 — regenerar somente os links afetados
// --------------------------------------------------------------------------

describe('regenerateAffectedLinks (14.12)', () => {
  it('regenera apenas os links dos sujeitos afetados pela troca', () => {
    const previous = currentSchedule();
    // Nova vigente: Ana trocada por Carla no SVC1 (Ana ainda regente no SVC2).
    const next: PublishedSchedule = {
      ...previous,
      assignments: previous.assignments.map((a) =>
        a.id === 'a1' ? { ...a, subject: { type: 'person', id: P_CARLA } } : a,
      ),
    };
    const phoneBySubject = {
      [P_ANA]: '+5543990000001',
      [P_BRUNO]: '+5543990000002',
      [P_CARLA]: '+5543990000003',
    };
    const previousLinks = {
      [P_ANA]: { subjectId: P_ANA, url: 'https://wa.me/5543990000001' },
      [P_BRUNO]: { subjectId: P_BRUNO, url: 'https://wa.me/5543990000002' },
    };

    const out = regenerateAffectedLinks({ previous, next, previousLinks, phoneBySubject });

    // Ana mudou (perdeu o SVC1) e Carla entrou -> ambos afetados. Bruno inalterado.
    expect([...out.affectedSubjectIds].sort()).toEqual([P_ANA, P_CARLA].sort());
    expect(out.links[P_CARLA]!.url).toBe('https://wa.me/5543990000003');
    // O link de Bruno (nao afetado) e preservado byte a byte.
    expect(out.links[P_BRUNO]).toBe(previousLinks[P_BRUNO]);
    expect(out.blocks).toEqual([]);
  });

  it('remove o link de quem deixou de participar', () => {
    const previous = currentSchedule();
    // Cancela todas as atribuicoes de Bruno.
    const next: PublishedSchedule = {
      ...previous,
      assignments: previous.assignments.filter((a) => a.subject.id !== P_BRUNO),
    };
    const phoneBySubject = { [P_BRUNO]: '+5543990000002' };
    const previousLinks = { [P_BRUNO]: { subjectId: P_BRUNO, url: 'https://wa.me/5543990000002' } };

    const out = regenerateAffectedLinks({ previous, next, previousLinks, phoneBySubject });
    expect(out.affectedSubjectIds).toEqual([P_BRUNO]);
    expect(out.links[P_BRUNO]).toBeUndefined();
  });

  it('nao regenera nada quando a participacao nao muda', () => {
    const previous = currentSchedule();
    const next = currentSchedule();
    const previousLinks = {
      [P_ANA]: { subjectId: P_ANA, url: 'https://wa.me/5543990000001' },
    };
    const out = regenerateAffectedLinks({ previous, next, previousLinks, phoneBySubject: {} });
    expect(out.affectedSubjectIds).toEqual([]);
    expect(out.links).toEqual(previousLinks);
  });
});

// --------------------------------------------------------------------------
// 14.13 — recalcular rotacao contando cada atribuicao exatamente uma vez
// --------------------------------------------------------------------------

describe('recomputeRotation (14.13)', () => {
  it('conta cada atribuicao vigente exatamente uma vez por sujeito', () => {
    const schedule = currentSchedule(); // Ana: 2 (SVC1 regente, SVC2 regente), Bruno: 1
    const { countBySubject, totalAssignments } = recomputeRotation(schedule);
    expect(countBySubject[P_ANA]).toBe(2);
    expect(countBySubject[P_BRUNO]).toBe(1);
    expect(totalAssignments).toBe(3);
    // Soma das contagens == total (prova "exatamente uma vez").
    const soma = Object.values(countBySubject).reduce((s, n) => s + n, 0);
    expect(soma).toBe(totalAssignments);
  });

  it('reflete a Escala resultante apos cancelamento', () => {
    const schedule = currentSchedule();
    const next: PublishedSchedule = {
      ...schedule,
      assignments: schedule.assignments.filter((a) => a.id !== 'a3'), // remove 1 de Ana
    };
    const { countBySubject, totalAssignments } = recomputeRotation(next);
    expect(countBySubject[P_ANA]).toBe(1);
    expect(totalAssignments).toBe(2);
  });
});
