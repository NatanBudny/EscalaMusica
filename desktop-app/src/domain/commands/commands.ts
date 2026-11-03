// Comandos puros do dominio: envelopes idempotentes, resultados tipados,
// revisoes por hash, eventos de dominio e invalidacao de derivados.
//
// Design.md, "Contratos da camada de aplicacao":
//   type Result<T> = { ok: true; value: T; revision? } | { ok: false; error: AppError }
//   interface CommandEnvelope<T> { operationId, operatorId, baseCommit,
//                                  expectedRevision, payload }
//
// Requisitos atendidos:
//   1.6-1.8  operacao guiada com resultado tipado e mensagem clara de erro;
//   3.10, 4.17, 6.4, 8.7, 11.11  toda alteracao aceita e auditada pelo diff
//            real, sem segredos;
//   12.12    mensagens `AppError` em portugues no modelo de cinco blocos.
//
// Invariantes centrais:
//   - IDEMPOTENCIA: repetir o mesmo `operationId` NAO duplica efeitos. A
//     segunda execucao retorna o mesmo resultado registrado e nao gera nova
//     revisao nem novo evento.
//   - REVISAO POR HASH: a revisao de um estado e o SHA-256 do seu JSON
//     canonico (reutiliza `canonical.ts`). Uma alteracao aceita produz uma
//     nova revisao; "sem alteracao" nao produz revisao nova.
//   - EVENTO POR ALTERACAO: cada alteracao aceita (diff nao vazio) gera
//     exatamente um `AuditEvent` sanitizado e validado por schema.
//   - INVALIDACAO DE DERIVADOS: quando a revisao muda, os invalidadores
//     registrados sao disparados com a revisao antiga e a nova.
//
// Este modulo e TypeScript puro: sem I/O. O armazenamento do historico de
// operacoes e dos derivados e injetado/mantido em memoria, de forma
// deterministica e testavel.

import { canonicalHash } from '../schemas/canonical';
import type { AuditEvent } from '../schemas/models';
import { diffStates, type Diff } from './diff';
import { buildValidatedAuditEvent } from './audit';
import { makeAppError, type AppError } from './errors';

// --------------------------------------------------------------------------
// Resultado tipado e envelope
// --------------------------------------------------------------------------

export type Result<T> =
  | { readonly ok: true; readonly value: T; readonly revision: string }
  | { readonly ok: false; readonly error: AppError };

/** Envelope idempotente de um comando (design.md). */
export interface CommandEnvelope<T> {
  readonly operationId: string;
  readonly operatorId: string;
  readonly baseCommit: string | null;
  readonly expectedRevision: string;
  readonly payload: T;
}

// --------------------------------------------------------------------------
// Evento de dominio
// --------------------------------------------------------------------------

/**
 * Evento de dominio emitido por uma alteracao aceita. Correlaciona a operacao
 * idempotente com a transicao de revisao e carrega o evento de auditoria
 * sanitizado.
 */
export interface DomainEvent {
  readonly operationId: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly action: string;
  readonly fromRevision: string | null;
  readonly toRevision: string;
  readonly audit: AuditEvent;
}

// --------------------------------------------------------------------------
// Invalidacao de derivados
// --------------------------------------------------------------------------

/**
 * Invalidador de dados derivados. E chamado quando a revisao muda, recebendo a
 * revisao anterior e a nova, para descartar qualquer cache/projecao derivada
 * (previa, relatorio de validacao, etc.).
 */
export type DerivedInvalidator = (change: {
  readonly entityType: string;
  readonly entityId: string;
  readonly fromRevision: string | null;
  readonly toRevision: string;
}) => void;

// --------------------------------------------------------------------------
// Registro do resultado de uma operacao (para idempotencia)
// --------------------------------------------------------------------------

interface OperationRecord<T> {
  readonly result: Result<T>;
  readonly event: DomainEvent | null;
}

/** Descreve como aplicar o comando e como audita-lo. */
export interface CommandSpec<S, T> {
  /** Tipo logico da entidade afetada (ex.: `person`). */
  readonly entityType: string;
  /** ID da entidade afetada. */
  readonly entityId: string;
  /** Nome da acao para o evento/auditoria (ex.: `atualizar-telefone`). */
  readonly action: string;
  /** Instante do evento (UTC RFC 3339). */
  readonly timestamp: string;
  /** Gera o ID do evento de auditoria (UUID). */
  readonly auditEventId: string;
  /**
   * Funcao de transicao PURA: a partir do estado anterior e do payload, produz
   * o proximo estado ou uma falha de dominio (mensagem em portugues).
   */
  readonly apply: (previous: S, payload: T) => { ok: true; next: S } | { ok: false; reason: string };
}

/**
 * Executor de comandos idempotente. Mantem o estado atual, o historico de
 * operacoes (por `operationId`) e a lista de invalidadores de derivados.
 *
 * Nao faz I/O; a persistencia real (staging/Git) e responsabilidade da camada
 * externa, que pode reconstruir este executor a partir do estado carregado.
 */
export class CommandExecutor<S> {
  private state: S;
  private currentRevision: string;
  private readonly history = new Map<string, OperationRecord<unknown>>();
  private readonly invalidators: DerivedInvalidator[] = [];
  private readonly emittedEvents: DomainEvent[] = [];

  constructor(initial: S) {
    this.state = initial;
    this.currentRevision = canonicalHash(initial);
  }

  /** Estado atual (somente leitura). */
  getState(): S {
    return this.state;
  }

  /** Revisao atual (SHA-256 hex do JSON canonico do estado). */
  getRevision(): string {
    return this.currentRevision;
  }

  /** Eventos de dominio emitidos, em ordem de aceitacao. */
  getEmittedEvents(): readonly DomainEvent[] {
    return this.emittedEvents;
  }

  /** Registra um invalidador de derivados disparado quando a revisao muda. */
  registerInvalidator(invalidator: DerivedInvalidator): void {
    this.invalidators.push(invalidator);
  }

  /**
   * Executa um comando de forma idempotente.
   *
   * Passos:
   *   1. Idempotencia: se o `operationId` ja foi processado, retorna o mesmo
   *      resultado registrado SEM gerar efeitos novos.
   *   2. Revisao esperada: se `expectedRevision` nao coincide com a revisao
   *      atual, recusa com `revisao-divergente` (nenhuma mutacao).
   *   3. Transicao de dominio: aplica `spec.apply`; falha vira
   *      `validacao-dominio` (nenhuma mutacao).
   *   4. Diff real: calcula o diff entre o estado anterior e o proximo. Se o
   *      diff for vazio, nao gera revisao nem evento (resultado "sem
   *      alteracao", mas idempotentemente bem-sucedido sobre a revisao atual).
   *   5. Auditoria: monta e valida o `AuditEvent`; falha de schema vira
   *      `auditoria-invalida` (nenhuma mutacao).
   *   6. Efetivacao: atualiza estado e revisao, emite o evento de dominio e
   *      dispara os invalidadores de derivados.
   */
  execute<T>(envelope: CommandEnvelope<T>, spec: CommandSpec<S, T>): Result<S> {
    // 1. Idempotencia por operationId.
    const prior = this.history.get(envelope.operationId);
    if (prior) {
      return prior.result as Result<S>;
    }

    const techRef = `op=${envelope.operationId} at=${spec.timestamp}`;

    // 2. Revisao esperada.
    if (envelope.expectedRevision !== this.currentRevision) {
      const error = makeAppError('revisao-divergente', { technicalReference: techRef });
      return this.recordFailure(envelope.operationId, error);
    }

    // 3. Transicao de dominio pura.
    const previous = this.state;
    const applied = spec.apply(previous, envelope.payload);
    if (!applied.ok) {
      const error = makeAppError('validacao-dominio', {
        explanationPtBr: applied.reason,
        technicalReference: techRef,
      });
      return this.recordFailure(envelope.operationId, error);
    }
    const next = applied.next;

    // 4. Diff real.
    const diff: Diff = diffStates(previous, next);
    if (diff.changes.length === 0) {
      // Sem alteracao: nao gera revisao/evento novos. Idempotente sobre a
      // revisao atual. Sucesso tipado com a revisao inalterada.
      const result: Result<S> = { ok: true, value: previous, revision: this.currentRevision };
      this.history.set(envelope.operationId, { result, event: null });
      return result;
    }

    // 5. Auditoria sanitizada e validada por schema.
    const audit = buildValidatedAuditEvent({
      id: spec.auditEventId,
      operationId: envelope.operationId,
      timestamp: spec.timestamp,
      operatorId: envelope.operatorId,
      entityType: spec.entityType,
      entityId: spec.entityId,
      action: spec.action,
      result: 'success',
      diff,
    });
    if (!audit.ok) {
      const detail = audit.outcome.issues.map((i) => `${i.path}: ${i.message}`).join('; ');
      const error = makeAppError('auditoria-invalida', {
        technicalReference: `${techRef} issues=[${detail}]`,
      });
      return this.recordFailure(envelope.operationId, error);
    }

    // 6. Efetivacao: nova revisao, evento e invalidacao de derivados.
    const fromRevision = this.currentRevision;
    const toRevision = canonicalHash(next);
    this.state = next;
    this.currentRevision = toRevision;

    const event: DomainEvent = {
      operationId: envelope.operationId,
      entityType: spec.entityType,
      entityId: spec.entityId,
      action: spec.action,
      fromRevision,
      toRevision,
      audit: audit.event,
    };
    this.emittedEvents.push(event);

    // Dispara invalidadores porque a revisao mudou.
    for (const invalidate of this.invalidators) {
      invalidate({
        entityType: spec.entityType,
        entityId: spec.entityId,
        fromRevision,
        toRevision,
      });
    }

    const result: Result<S> = { ok: true, value: next, revision: toRevision };
    this.history.set(envelope.operationId, { result, event });
    return result;
  }

  private recordFailure(operationId: string, error: AppError): Result<S> {
    const result: Result<S> = { ok: false, error };
    this.history.set(operationId, { result, event: null });
    return result;
  }
}
