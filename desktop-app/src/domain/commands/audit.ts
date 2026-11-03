// Construcao de eventos de auditoria sanitizados a partir do diff real.
//
// Design.md: "Campos sensiveis de auditoria usam referencia/hash ou valor
// redigido conforme classificacao. Credenciais sao proibidas pelo schema."
// (requisitos 3.10, 4.17, 6.4, 8.7, 11.11).
//
// Este modulo converte um `Diff` (ver `diff.ts`) em um `AuditEvent` canonico,
// aplicando duas defesas:
//   1. Sanitizacao: campos cujo nome indica segredo (token, senha, etc.) nunca
//      tem o valor registrado; apenas o hash e mantido (referencia opaca).
//   2. Validacao por schema: o evento resultante e validado pelo schema
//      `auditEvent`, que usa `additionalProperties: false` e NAO permite campos
//      de segredo. Um evento com propriedade proibida e rejeitado.
//
// TypeScript puro: sem I/O, sem mutacao das entradas.

import { SCHEMA_VERSION, type AuditChange, type AuditEvent } from '../schemas/models';
import { validateEntity, type ValidationOutcome } from '../schemas/validator';
import type { Diff, FieldChange } from './diff';

/**
 * Nomes de campo que indicam segredo. O valor NUNCA e registrado para esses
 * campos; apenas o hash e preservado como referencia opaca. A comparacao e
 * sobre o ultimo segmento do caminho (`a.b.token` -> `token`), sem distincao
 * de maiusculas/minusculas.
 */
const SECRET_FIELD_NAMES: ReadonlySet<string> = new Set([
  'token',
  'accesstoken',
  'refreshtoken',
  'secret',
  'senha',
  'password',
  'credential',
  'credentials',
  'apikey',
  'authorization',
  'privatekey',
]);

/** `true` quando o nome do campo (ultimo segmento) indica segredo. */
export function isSecretField(field: string): boolean {
  const last = field.includes('.') ? field.slice(field.lastIndexOf('.') + 1) : field;
  return SECRET_FIELD_NAMES.has(last.toLowerCase());
}

/**
 * Converte uma mudanca de campo em uma `AuditChange` sanitizada.
 *
 * Para campos de segredo, os valores `before`/`after` sao omitidos e apenas os
 * hashes permanecem (referencia opaca que nunca revela o valor). Para os
 * demais, os valores sao mantidos ao lado dos hashes.
 */
export function sanitizeChange(change: FieldChange): AuditChange {
  const secret = isSecretField(change.field);
  const out: AuditChange = { field: change.field };
  if (change.beforeHash !== undefined) (out as AuditChange).beforeHash = change.beforeHash;
  if (change.afterHash !== undefined) (out as AuditChange).afterHash = change.afterHash;
  if (!secret) {
    if (change.before !== undefined) (out as AuditChange).before = change.before;
    if (change.after !== undefined) (out as AuditChange).after = change.after;
  }
  return out;
}

/** Parametros necessarios para montar o evento de auditoria. */
export interface BuildAuditInput {
  readonly id: string;
  readonly operationId: string;
  readonly timestamp: string;
  readonly operatorId: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly action: string;
  readonly result: AuditEvent['result'];
  readonly diff: Diff;
}

/**
 * Monta um `AuditEvent` canonico e sanitizado a partir do diff. As mudancas
 * seguem exatamente os campos que mudaram (nenhum campo inalterado aparece,
 * por construcao do diff) e os campos de segredo tem o valor redigido.
 *
 * NAO valida; use `buildValidatedAuditEvent` para obter a garantia de schema.
 */
export function buildAuditEvent(input: BuildAuditInput): AuditEvent {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: input.id,
    operationId: input.operationId,
    timestamp: input.timestamp,
    operatorId: input.operatorId,
    entityType: input.entityType,
    entityId: input.entityId,
    action: input.action,
    changes: input.diff.changes.map(sanitizeChange),
    result: input.result,
  };
}

export type BuildValidatedAuditResult =
  | { readonly ok: true; readonly event: AuditEvent }
  | { readonly ok: false; readonly outcome: ValidationOutcome };

/**
 * Monta e valida o evento de auditoria contra o schema `auditEvent`. Como o
 * schema usa `additionalProperties: false`, qualquer propriedade proibida
 * (inclusive campos de segredo que escapassem a sanitizacao) resulta em
 * `{ ok: false }` com o relatorio de validacao.
 */
export function buildValidatedAuditEvent(input: BuildAuditInput): BuildValidatedAuditResult {
  const event = buildAuditEvent(input);
  const outcome = validateEntity('auditEvent', event);
  if (!outcome.valid) return { ok: false, outcome };
  return { ok: true, event };
}
