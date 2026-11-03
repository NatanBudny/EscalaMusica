// PostPublicationRevision: manutencao segura DEPOIS da publicacao (tarefa 10.3).
//
// Objetivo (Requisito 14, criterios 14.1-14.13; design.md: "Um ciclo publicado
// e imutavel; manutencao cria `PostPublicationRevision` a partir da publicacao
// confirmada"):
//
//   14.1 Iniciar uma alteracao pos-publicacao CRIA uma nova revisao editavel
//        como COPIA da Escala vigente, SEM alterar a vigente.
//   14.2 Troca: exige Culto, funcao, pessoa substituida, pessoa substituta e
//        motivo; registra data/hora e Operador.
//   14.3 Cancelamento: exige Culto e item cancelado e motivo; registra
//        data/hora e Operador.
//   14.4 Correcao de dado publico: registra Culto, campo, valor anterior e
//        novo, motivo, data/hora e Operador.
//   14.5 (validacao) e 14.6 (previa) sao executadas pelos modulos ValidationEngine
//        e PreviewService sobre a revisao; aqui expomos a projecao publica da
//        revisao para alimenta-los sem tocar a vigente.
//   14.7 Aprovacao registrada em auditoria (ApprovalService; aqui garantimos o
//        vinculo pela revisao).
//   14.8 Alterar a revisao DEPOIS da aprovacao INVALIDA a aprovacao e impede a
//        publicacao ate nova validacao sem Bloqueios e nova aprovacao.
//   14.9 Confirmar a publicacao CRIA um Backup da vigente ANTES de substitui-la.
//   14.10 (orquestrador) falha antes da confirmacao preserva vigente/backup/revisao.
//   14.11 Confirmacao publica registra identificacao, diffs, data/hora,
//         responsavel e resultado (auditoria).
//   14.12 Alterar as pessoas que recebem comunicacao REGENERA somente os links
//         personalizados AFETADOS pela alteracao.
//   14.13 Alterar participacoes RECALCULA a rotacao a partir da Escala
//         resultante, contando cada atribuicao vigente EXATAMENTE uma vez.
//
// Property 45 (design.md): "Para toda Escala vigente, criar e editar revisao
// pos-publicacao, valida-la, pre-visualiza-la ou aprova-la preserva o hash da
// vigente; somente uma publicacao confirmada pode criar a nova vigente."
//
// Este modulo e TypeScript PURO: nao faz I/O, nao muta a entrada e NUNCA altera
// a Escala vigente. Toda operacao devolve um NOVO estado de revisao (e, quando
// aplicavel, a nova vigente apenas no passo de confirmacao). Reusa os modelos
// canonicos (`Assignment`, `PublicServiceFields`, `AuditEvent`, ...), o hashing
// canonico (`canonicalHash`) e a derivacao de link `waMeFromE164`.
//
// Requisitos cobertos: 14.1-14.13.

import type {
  Assignment,
  AuditChange,
  AuditEvent,
  PublicServiceFields,
  Sha256,
  Utc,
  Uuid,
} from '../schemas/models';
import { SCHEMA_VERSION } from '../schemas/models';
import { canonicalHash } from '../schemas/canonical';
import { waMeFromE164, type LegacyExportBlock } from '../export/legacyExporter';

// --------------------------------------------------------------------------
// Escala publicada (vigente) e revisao
// --------------------------------------------------------------------------

/**
 * Estado publicado (Escala vigente) sobre o qual a manutencao opera. E o
 * conteudo que o Publicador transformou nos artefatos legados: atribuicoes por
 * culto/funcao e campos publicos por culto. A `revision` e o hash canonico do
 * CONTEUDO (assignments + publicFields), usado para provar imutabilidade.
 */
export interface PublishedSchedule {
  readonly cycleId: Uuid;
  readonly period: string;
  /** Hash canonico do conteudo publicado; identidade imutavel da vigente. */
  readonly revision: Sha256;
  readonly assignments: readonly Assignment[];
  readonly publicFields: readonly PublicServiceFields[];
}

/** Uma operacao de manutencao aplicada a revisao, com motivo e auditoria. */
export type RevisionChange =
  | {
      readonly kind: 'substitution'; // 14.2
      readonly serviceId: Uuid;
      readonly roleId: Uuid;
      readonly slot?: string;
      /** Pessoa substituida (sujeito anterior na funcao). */
      readonly replacedSubjectId: Uuid;
      /** Pessoa substituta (novo sujeito na funcao). */
      readonly substituteSubjectId: Uuid;
      readonly reason: string;
      readonly at: Utc;
      readonly operatorId: Uuid;
    }
  | {
      readonly kind: 'cancellation'; // 14.3
      readonly serviceId: Uuid;
      /** Atribuicao cancelada (item removido do culto). */
      readonly assignmentId: Uuid;
      readonly reason: string;
      readonly at: Utc;
      readonly operatorId: Uuid;
    }
  | {
      readonly kind: 'public-correction'; // 14.4
      readonly serviceId: Uuid;
      readonly field: string;
      readonly reason: string;
      readonly at: Utc;
      readonly operatorId: Uuid;
      /** Valor anterior (preenchido pelo servico a partir do estado atual). */
      readonly before?: unknown;
      /** Valor novo. */
      readonly after: unknown;
    };

/** Estado de aprovacao da revisao (espelha o ciclo normal). */
export type RevisionApprovalState =
  | { readonly kind: 'none' }
  | { readonly kind: 'approved'; readonly approvalId: Uuid; readonly approvedAtRevision: Sha256 }
  | { readonly kind: 'invalidated'; readonly previousApprovalId: Uuid };

/**
 * Revisao pos-publicacao: COPIA editavel da vigente (14.1). Mantem o hash da
 * vigente de origem (`baseRevision`) para provar que ela nunca foi tocada, o
 * conteudo editavel (assignments/publicFields), o historico de alteracoes com
 * auditoria e o estado de aprovacao.
 */
export interface PostPublicationRevision {
  readonly schemaVersion: string;
  readonly id: Uuid;
  readonly cycleId: Uuid;
  readonly period: string;
  /** Hash da vigente a partir da qual a revisao foi criada (imutavel). */
  readonly baseRevision: Sha256;
  /** Conteudo editavel da revisao. */
  readonly assignments: readonly Assignment[];
  readonly publicFields: readonly PublicServiceFields[];
  /** Historico de operacoes aplicadas, na ordem em que ocorreram. */
  readonly changes: readonly RevisionChange[];
  /** Eventos de auditoria correspondentes a cada operacao. */
  readonly audit: readonly AuditEvent[];
  /** Estado de aprovacao (14.8). */
  readonly approval: RevisionApprovalState;
  readonly createdAt: Utc;
}

// --------------------------------------------------------------------------
// Resultado tipado
// --------------------------------------------------------------------------

export type RevisionErrorCode =
  | 'service-not-found'
  | 'assignment-not-found'
  | 'subject-mismatch'
  | 'missing-reason'
  | 'public-field-not-found'
  | 'revision-already-approved-without-change'
  | 'not-approved'
  | 'stale-approval';

export interface RevisionError {
  readonly code: RevisionErrorCode;
  readonly reference: string;
  readonly message: string;
}

export type RevisionResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly RevisionError[] };

// --------------------------------------------------------------------------
// 14.1 — criar a revisao como copia da vigente (sem tocar na vigente)
// --------------------------------------------------------------------------

/**
 * Cria uma `PostPublicationRevision` como COPIA da Escala vigente. NAO altera a
 * vigente: `baseRevision` guarda o hash da vigente e o conteudo e clonado em
 * estruturas novas. A revisao nasce sem alteracoes e sem aprovacao.
 */
export function startRevision(params: {
  readonly id: Uuid;
  readonly current: PublishedSchedule;
  readonly createdAt: Utc;
}): PostPublicationRevision {
  const { current } = params;
  return {
    schemaVersion: SCHEMA_VERSION,
    id: params.id,
    cycleId: current.cycleId,
    period: current.period,
    baseRevision: current.revision,
    assignments: current.assignments.map(cloneAssignment),
    publicFields: current.publicFields.map(clonePublicFields),
    changes: [],
    audit: [],
    approval: { kind: 'none' },
    createdAt: params.createdAt,
  };
}

// --------------------------------------------------------------------------
// 14.2 — troca
// --------------------------------------------------------------------------

/**
 * Registra uma troca: substitui o sujeito de uma atribuicao (culto+funcao+slot)
 * pela pessoa substituta, exigindo motivo e registrando auditoria. A operacao
 * invalida a aprovacao vigente (14.8) e devolve uma NOVA revisao.
 */
export function applySubstitution(
  revision: PostPublicationRevision,
  op: Extract<RevisionChange, { kind: 'substitution' }>,
): RevisionResult<PostPublicationRevision> {
  const errors: RevisionError[] = [];
  requireReason(op.reason, 'troca', errors);

  const idx = revision.assignments.findIndex(
    (a) =>
      a.serviceId === op.serviceId &&
      a.roleId === op.roleId &&
      sameSlot(a.slot, op.slot) &&
      a.subject.id === op.replacedSubjectId,
  );
  if (idx < 0) {
    errors.push({
      code: 'assignment-not-found',
      reference: `culto:${op.serviceId} funcao:${op.roleId}`,
      message:
        'nao ha atribuicao da pessoa substituida nessa funcao/slot do culto; nada foi alterado',
    });
  }

  if (errors.length > 0) return { ok: false, errors };

  const target = revision.assignments[idx] as Assignment;
  const updated: Assignment = {
    ...target,
    subject: { type: target.subject.type, id: op.substituteSubjectId },
    source: 'manual',
  };
  const assignments = replaceAt(revision.assignments, idx, updated);

  const event = auditEvent({
    operationId: op.at + ':' + op.serviceId + ':sub',
    at: op.at,
    operatorId: op.operatorId,
    entityType: 'assignment',
    entityId: target.id,
    action: 'substitution',
    reason: op.reason,
    changes: [{ field: 'subject.id', before: op.replacedSubjectId, after: op.substituteSubjectId }],
  });

  return {
    ok: true,
    value: withChange(revision, { ...revision, assignments }, op, event),
  };
}

// --------------------------------------------------------------------------
// 14.3 — cancelamento
// --------------------------------------------------------------------------

/**
 * Registra o cancelamento de um item (atribuicao) de um culto, exigindo motivo
 * e auditoria. Remove a atribuicao do conteudo da revisao e invalida a
 * aprovacao (14.8).
 */
export function applyCancellation(
  revision: PostPublicationRevision,
  op: Extract<RevisionChange, { kind: 'cancellation' }>,
): RevisionResult<PostPublicationRevision> {
  const errors: RevisionError[] = [];
  requireReason(op.reason, 'cancelamento', errors);

  const idx = revision.assignments.findIndex(
    (a) => a.serviceId === op.serviceId && a.id === op.assignmentId,
  );
  if (idx < 0) {
    errors.push({
      code: 'assignment-not-found',
      reference: `culto:${op.serviceId} item:${op.assignmentId}`,
      message: 'o item a cancelar nao existe nesse culto; nada foi alterado',
    });
  }

  if (errors.length > 0) return { ok: false, errors };

  const removed = revision.assignments[idx] as Assignment;
  const assignments = removeAt(revision.assignments, idx);

  const event = auditEvent({
    operationId: op.at + ':' + op.serviceId + ':cancel',
    at: op.at,
    operatorId: op.operatorId,
    entityType: 'assignment',
    entityId: removed.id,
    action: 'cancellation',
    reason: op.reason,
    changes: [{ field: 'assignment', before: removed.subject.id, after: null }],
  });

  return {
    ok: true,
    value: withChange(revision, { ...revision, assignments }, op, event),
  };
}

// --------------------------------------------------------------------------
// 14.4 — correcao de dado publico
// --------------------------------------------------------------------------

/**
 * Corrige um dado publico (campo de um culto), registrando valores anterior e
 * novo, motivo e auditoria. O valor anterior e lido do estado ATUAL da revisao
 * (nao confiamos no `before` informado pelo chamador). Invalida a aprovacao.
 */
export function applyPublicCorrection(
  revision: PostPublicationRevision,
  op: Extract<RevisionChange, { kind: 'public-correction' }>,
): RevisionResult<PostPublicationRevision> {
  const errors: RevisionError[] = [];
  requireReason(op.reason, 'correcao', errors);

  const svcIdx = revision.publicFields.findIndex((p) => p.serviceId === op.serviceId);
  if (svcIdx < 0) {
    errors.push({
      code: 'public-field-not-found',
      reference: `culto:${op.serviceId}`,
      message: 'o culto nao possui campos publicos nessa revisao; nada foi alterado',
    });
  }

  if (errors.length > 0) return { ok: false, errors };

  const svc = revision.publicFields[svcIdx] as PublicServiceFields;
  const before = Object.prototype.hasOwnProperty.call(svc.fields, op.field)
    ? svc.fields[op.field]
    : undefined;
  const updatedFields: PublicServiceFields = {
    serviceId: svc.serviceId,
    fields: { ...svc.fields, [op.field]: op.after },
  };
  const publicFields = replaceAt(revision.publicFields, svcIdx, updatedFields);

  // Registra o `before` REAL lido do estado, nao o informado pelo chamador.
  const normalizedOp: Extract<RevisionChange, { kind: 'public-correction' }> = {
    ...op,
    before,
  };

  const event = auditEvent({
    operationId: op.at + ':' + op.serviceId + ':' + op.field + ':fix',
    at: op.at,
    operatorId: op.operatorId,
    entityType: 'publicField',
    entityId: svc.serviceId,
    action: 'public-correction',
    reason: op.reason,
    changes: [{ field: op.field, before, after: op.after }],
  });

  return {
    ok: true,
    value: withChange(revision, { ...revision, publicFields }, normalizedOp, event),
  };
}

// --------------------------------------------------------------------------
// 14.7/14.8 — aprovacao e invalidacao por nova alteracao
// --------------------------------------------------------------------------

/**
 * Marca a revisao como aprovada, vinculando a aprovacao ao hash do conteudo
 * ATUAL (`approvedAtRevision`). Qualquer alteracao posterior mudara o hash e
 * invalidara a aprovacao (14.8), detectado por `isApprovalValid`.
 */
export function markApproved(
  revision: PostPublicationRevision,
  approvalId: Uuid,
): PostPublicationRevision {
  return {
    ...revision,
    approval: { kind: 'approved', approvalId, approvedAtRevision: revisionContentHash(revision) },
  };
}

/**
 * A aprovacao so e valida se o conteudo atual da revisao for identico ao
 * conteudo no momento da aprovacao (14.8). Alterar a revisao depois de aprovada
 * muda o hash e torna a aprovacao invalida.
 */
export function isApprovalValid(revision: PostPublicationRevision): boolean {
  return (
    revision.approval.kind === 'approved' &&
    revision.approval.approvedAtRevision === revisionContentHash(revision)
  );
}

// --------------------------------------------------------------------------
// 14.9/14.11 — confirmar publicacao: backup antes de substituir a vigente
// --------------------------------------------------------------------------

/** Resultado da confirmacao: nova vigente + backup da anterior + auditoria. */
export interface RevisionPublicationOutcome {
  /** Nova Escala vigente (conteudo da revisao, novo hash). */
  readonly newCurrent: PublishedSchedule;
  /** Backup da vigente anterior (feito ANTES de substituir — 14.9). */
  readonly backupOfPrevious: PublishedSchedule;
  /** Evento de auditoria da confirmacao publica (14.11). */
  readonly audit: AuditEvent;
}

/**
 * Confirma a publicacao de uma revisao APROVADA e sem alteracoes posteriores a
 * aprovacao (14.8). Cria o Backup da vigente ANTES de produzir a nova vigente
 * (14.9) e registra a confirmacao em auditoria com as diferencas (14.11).
 *
 * Esta funcao e pura: nao grava nada e nao muta a vigente nem a revisao. Ela
 * apenas PRODUZ a nova vigente — a promocao efetiva (persistencia/push) e
 * responsabilidade do orquestrador de publicacao (tarefa 12), que so ocorre
 * depois da confirmacao publica (Property 45).
 */
export function confirmRevisionPublication(params: {
  readonly revision: PostPublicationRevision;
  readonly current: PublishedSchedule;
  readonly at: Utc;
  readonly operatorId: Uuid;
  readonly operationId: Uuid;
}): RevisionResult<RevisionPublicationOutcome> {
  const { revision, current } = params;
  const errors: RevisionError[] = [];

  if (revision.approval.kind !== 'approved') {
    errors.push({
      code: 'not-approved',
      reference: `revisao:${revision.id}`,
      message: 'a revisao precisa estar aprovada antes de publicar',
    });
  } else if (!isApprovalValid(revision)) {
    errors.push({
      code: 'stale-approval',
      reference: `revisao:${revision.id}`,
      message: 'a revisao foi alterada depois da aprovacao; valide e aprove novamente antes de publicar',
    });
  }

  if (errors.length > 0) return { ok: false, errors };

  // 14.9: BACKUP da vigente anterior ANTES de substituir. Como somos puros, o
  // "backup" e uma copia imutavel do estado anterior que o orquestrador persiste.
  const backupOfPrevious: PublishedSchedule = {
    cycleId: current.cycleId,
    period: current.period,
    revision: current.revision,
    assignments: current.assignments.map(cloneAssignment),
    publicFields: current.publicFields.map(clonePublicFields),
  };

  const newContent = {
    assignments: revision.assignments.map(cloneAssignment),
    publicFields: revision.publicFields.map(clonePublicFields),
  };
  const newRevision = canonicalHash(newContent);

  const newCurrent: PublishedSchedule = {
    cycleId: current.cycleId,
    period: current.period,
    revision: newRevision,
    assignments: newContent.assignments,
    publicFields: newContent.publicFields,
  };

  const audit = auditEvent({
    operationId: params.operationId,
    at: params.at,
    operatorId: params.operatorId,
    entityType: 'publication',
    entityId: revision.id,
    action: 'post-publication-confirm',
    changes: [{ field: 'revision', before: current.revision, after: newRevision }],
    result: 'success',
  });

  return { ok: true, value: { newCurrent, backupOfPrevious, audit } };
}

// --------------------------------------------------------------------------
// 14.12 — regenerar somente os links afetados
// --------------------------------------------------------------------------

/** Link personalizado de confirmacao de um sujeito. */
export interface ConfirmationLink {
  readonly subjectId: Uuid;
  readonly url: string;
}

/**
 * Regenera SOMENTE os links personalizados dos sujeitos AFETADOS entre a
 * vigente anterior e a nova vigente (14.12). "Afetado" = sujeito cujo conjunto
 * de atribuicoes mudou (incluido, removido ou com participacao alterada). Para
 * os demais, o link anterior e preservado inalterado.
 *
 * @param previousLinks  links ja gerados para a vigente anterior (por subjectId)
 * @param phoneBySubject telefone E.164 por subjectId (fonte autorizada)
 * @returns links atualizados por subjectId e a lista exata de subjectIds afetados
 */
export function regenerateAffectedLinks(params: {
  readonly previous: PublishedSchedule;
  readonly next: PublishedSchedule;
  readonly previousLinks: Readonly<Record<Uuid, ConfirmationLink>>;
  readonly phoneBySubject: Readonly<Record<Uuid, string>>;
}): {
  readonly links: Record<Uuid, ConfirmationLink>;
  readonly affectedSubjectIds: readonly Uuid[];
  readonly blocks: readonly LegacyExportBlock[];
} {
  const prevParticipation = participationBySubject(params.previous.assignments);
  const nextParticipation = participationBySubject(params.next.assignments);

  const allSubjects = new Set<Uuid>([
    ...prevParticipation.keys(),
    ...nextParticipation.keys(),
  ]);

  const affected: Uuid[] = [];
  for (const subjectId of allSubjects) {
    const before = prevParticipation.get(subjectId) ?? '';
    const after = nextParticipation.get(subjectId) ?? '';
    if (before !== after) affected.push(subjectId);
  }
  affected.sort(compareString);

  // Parte dos links anteriores; regenera apenas os afetados.
  const links: Record<Uuid, ConfirmationLink> = { ...params.previousLinks };
  const blocks: LegacyExportBlock[] = [];

  for (const subjectId of affected) {
    // Sujeito que deixou de participar (sem atribuicoes na nova vigente): o link
    // afetado e removido (nao ha mais a quem enviar confirmacao).
    if (!nextParticipation.has(subjectId)) {
      delete links[subjectId];
      continue;
    }
    const phone = params.phoneBySubject[subjectId];
    if (phone === undefined) {
      // Sem telefone autorizado nao ha link; remove um eventual link antigo.
      delete links[subjectId];
      continue;
    }
    const url = waMeFromE164(phone, subjectId, blocks);
    if (url === undefined) continue; // telefone invalido -> bloqueio registrado
    links[subjectId] = { subjectId, url };
  }

  return { links, affectedSubjectIds: affected, blocks };
}

// --------------------------------------------------------------------------
// 14.13 — recalcular rotacao contando cada atribuicao exatamente uma vez
// --------------------------------------------------------------------------

/**
 * Recalcula os controles de rotacao a partir da Escala resultante (14.13),
 * contando cada atribuicao VIGENTE exatamente uma vez por sujeito. Retorna a
 * contagem por sujeito e o total de atribuicoes vigentes (que deve ser igual a
 * soma das contagens — garante "exatamente uma vez").
 */
export function recomputeRotation(schedule: PublishedSchedule): {
  readonly countBySubject: Record<Uuid, number>;
  readonly totalAssignments: number;
} {
  const count = new Map<Uuid, number>();
  for (const a of schedule.assignments) {
    count.set(a.subject.id, (count.get(a.subject.id) ?? 0) + 1);
  }
  const countBySubject: Record<Uuid, number> = {};
  for (const subjectId of [...count.keys()].sort(compareString)) {
    countBySubject[subjectId] = count.get(subjectId) as number;
  }
  return { countBySubject, totalAssignments: schedule.assignments.length };
}

// --------------------------------------------------------------------------
// Projecao e hash do conteudo (para validacao/previa e Property 45)
// --------------------------------------------------------------------------

/**
 * Hash canonico do CONTEUDO editavel da revisao (assignments + publicFields).
 * Usado para detectar alteracoes pos-aprovacao (14.8) e nunca inclui metadados
 * de historico/auditoria.
 */
export function revisionContentHash(revision: PostPublicationRevision): Sha256 {
  return canonicalHash({
    assignments: revision.assignments,
    publicFields: revision.publicFields,
  });
}

/** Hash canonico do conteudo de uma Escala publicada (identidade da vigente). */
export function scheduleContentHash(schedule: {
  readonly assignments: readonly Assignment[];
  readonly publicFields: readonly PublicServiceFields[];
}): Sha256 {
  return canonicalHash({
    assignments: schedule.assignments,
    publicFields: schedule.publicFields,
  });
}

// --------------------------------------------------------------------------
// Auxiliares internos
// --------------------------------------------------------------------------

/** Aplica uma mudanca ao estado base, acrescentando historico/auditoria e invalidando a aprovacao. */
function withChange(
  previous: PostPublicationRevision,
  nextContent: PostPublicationRevision,
  op: RevisionChange,
  event: AuditEvent,
): PostPublicationRevision {
  const approval: RevisionApprovalState =
    previous.approval.kind === 'approved'
      ? { kind: 'invalidated', previousApprovalId: previous.approval.approvalId }
      : previous.approval;

  return {
    ...nextContent,
    changes: [...previous.changes, op],
    audit: [...previous.audit, event],
    approval,
  };
}

function requireReason(reason: string, action: string, errors: RevisionError[]): void {
  if (reason.trim() === '') {
    errors.push({
      code: 'missing-reason',
      reference: action,
      message: `a ${action} exige um motivo; informe a justificativa antes de registrar`,
    });
  }
}

interface AuditEventParams {
  readonly operationId: string;
  readonly at: Utc;
  readonly operatorId: Uuid;
  readonly entityType: string;
  readonly entityId: Uuid;
  readonly action: string;
  readonly changes: readonly AuditChange[];
  readonly reason?: string;
  readonly result?: AuditEvent['result'];
}

function auditEvent(p: AuditEventParams): AuditEvent {
  const changes: AuditChange[] =
    p.reason === undefined
      ? [...p.changes]
      : [...p.changes, { field: 'reason', after: p.reason }];
  return {
    schemaVersion: SCHEMA_VERSION,
    id: p.operationId,
    operationId: p.operationId,
    timestamp: p.at,
    operatorId: p.operatorId,
    entityType: p.entityType,
    entityId: p.entityId,
    action: p.action,
    changes,
    result: p.result ?? 'success',
  };
}

/** Chave canonica de participacao de um sujeito (ordenada, determinista). */
function participationBySubject(assignments: readonly Assignment[]): Map<Uuid, string> {
  const bySubject = new Map<Uuid, string[]>();
  for (const a of assignments) {
    const token = `${a.serviceId}:${a.roleId}:${a.slot ?? ''}`;
    const list = bySubject.get(a.subject.id) ?? [];
    list.push(token);
    bySubject.set(a.subject.id, list);
  }
  const out = new Map<Uuid, string>();
  for (const [subjectId, tokens] of bySubject) {
    out.set(subjectId, [...tokens].sort(compareString).join('|'));
  }
  return out;
}

function cloneAssignment(a: Assignment): Assignment {
  return {
    ...a,
    subject: { type: a.subject.type, id: a.subject.id },
  };
}

function clonePublicFields(p: PublicServiceFields): PublicServiceFields {
  return { serviceId: p.serviceId, fields: { ...p.fields } };
}

function replaceAt<T>(items: readonly T[], index: number, value: T): T[] {
  const out = [...items];
  out[index] = value;
  return out;
}

function removeAt<T>(items: readonly T[], index: number): T[] {
  const out = [...items];
  out.splice(index, 1);
  return out;
}

function sameSlot(a: string | undefined, b: string | undefined): boolean {
  return (a ?? '') === (b ?? '');
}

function compareString(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}
