// Classificacao obrigatoria de campos (Requisito 11.1).
//
// Cada campo persistido e classificado em exatamente uma categoria:
//  - 'public'  : pode integrar o Artefato_Estatico se aprovado por autorizacao.
//  - 'private' : dado administrativo/pessoal/operacional, nunca publicado.
//
// Esta tabela e a fonte unica da fronteira publico/privado estrutural. A
// classificacao fica aqui (nos metadados), nunca no valor do campo. Toda
// entidade canonica DEVE ter todos os seus campos classificados; a funcao
// `assertClassificationComplete` falha quando um campo nao esta classificado.

import type { CanonicalEntityName } from './models';

export type FieldClassification = 'public' | 'private';

/**
 * Mapa fechado: entidade -> (campo de topo -> classificacao).
 * Campos aninhados herdam a classificacao do campo de topo, salvo quando o
 * campo de topo e um objeto cuja projecao publica e tratada por allowlist
 * especifica no `PublicProjection` (fora do escopo deste modulo).
 */
export const FIELD_CLASSIFICATION: Record<
  CanonicalEntityName,
  Record<string, FieldClassification>
> = {
  person: {
    schemaVersion: 'private',
    id: 'private',
    legacyId: 'private',
    canonicalName: 'public',
    aliases: 'private', // alias so e publico via autorizacao explicita
    phoneE164: 'private', // telefone so e publico via autorizacao vigente
    participation: 'private',
    publicContactAuthorizationIds: 'private',
    capabilityIds: 'private',
    allowedWeekdays: 'private',
    leaves: 'private',
    links: 'private',
    administrativeNotes: 'private',
    createdAt: 'private',
    updatedAt: 'private',
  },
  department: {
    schemaVersion: 'private',
    id: 'private',
    legacyId: 'private',
    canonicalName: 'public',
    aliases: 'private',
    status: 'private',
    createdAt: 'private',
    updatedAt: 'private',
  },
  publicAuthorization: {
    schemaVersion: 'private',
    id: 'private',
    subjectId: 'private',
    field: 'private',
    valueHash: 'private',
    purpose: 'private',
    approvedBy: 'private',
    validFrom: 'private',
    validUntil: 'private',
    status: 'private',
    createdAt: 'private',
  },
  monthlyCycle: {
    schemaVersion: 'private',
    id: 'private',
    period: 'public',
    state: 'private',
    stage: 'private',
    ruleSetVersionId: 'private',
    currentDraftRevision: 'private',
    serviceIds: 'private',
    stageCompletions: 'private',
    createdAt: 'private',
    updatedAt: 'private',
  },
  service: {
    schemaVersion: 'private',
    id: 'private',
    cycleId: 'private',
    date: 'public',
    computedWeekday: 'public',
    kind: 'public',
    removed: 'private',
    externalInputIds: 'private',
  },
  externalInput: {
    schemaVersion: 'private',
    id: 'private',
    serviceId: 'private',
    type: 'private',
    value: 'private', // publicado somente quando visibility === 'public'
    visibility: 'private',
    source: 'private',
    updatedAt: 'private',
    operatorId: 'private',
  },
  unavailability: {
    schemaVersion: 'private',
    id: 'private',
    cycleId: 'private',
    personId: 'private',
    scope: 'private',
    source: 'private',
    createdAt: 'private',
  },
  approvedRuleSet: {
    schemaVersion: 'private',
    id: 'private',
    version: 'private',
    status: 'private',
    validFrom: 'private',
    validUntil: 'private',
    rules: 'private',
    approvedBy: 'private',
    approvedAt: 'private',
    sourceDecisions: 'private',
    createdAt: 'private',
  },
  approvedException: {
    schemaVersion: 'private',
    id: 'private',
    fundamentalRuleId: 'private',
    condition: 'private',
    validFrom: 'private',
    validUntil: 'private',
    justification: 'private',
    approvedBy: 'private',
    approvedAt: 'private',
  },
  scheduleDraft: {
    schemaVersion: 'private',
    cycleId: 'private',
    revision: 'private',
    parentRevision: 'private',
    assignments: 'private',
    publicFields: 'public',
    privateNotes: 'private',
    createdAt: 'private',
  },
  validationReport: {
    schemaVersion: 'private',
    reportId: 'private',
    cycleId: 'private',
    draftRevision: 'private',
    ruleSetVersion: 'private',
    status: 'private',
    blocking: 'private',
    warnings: 'private',
    passedCount: 'private',
    createdAt: 'private',
  },
  preview: {
    schemaVersion: 'private',
    previewId: 'private',
    cycleId: 'private',
    draftRevision: 'private',
    ruleSetVersion: 'private',
    period: 'public',
    generatedAt: 'private',
    operatorId: 'private',
    publicServices: 'public',
    diff: 'private',
  },
  approval: {
    schemaVersion: 'private',
    id: 'private',
    previewId: 'private',
    cycleId: 'private',
    draftRevision: 'private',
    ruleSetVersion: 'private',
    acknowledgedWarningIds: 'private',
    approverId: 'private',
    approvedAt: 'private',
    status: 'private',
  },
  publicationRecord: {
    schemaVersion: 'private',
    id: 'private',
    packageId: 'private',
    period: 'private',
    state: 'private',
    privateCommit: 'private',
    publicCommit: 'private',
    publicBackupCommit: 'private',
    attempts: 'private',
    confirmedAt: 'private',
  },
  auditEvent: {
    schemaVersion: 'private',
    id: 'private',
    operationId: 'private',
    timestamp: 'private',
    operatorId: 'private',
    entityType: 'private',
    entityId: 'private',
    action: 'private',
    changes: 'private',
    result: 'private',
  },
  backupManifest: {
    schemaVersion: 'private',
    id: 'private',
    formatVersion: 'private',
    period: 'private',
    sourceVersion: 'private',
    createdAt: 'private',
    operatorId: 'private',
    categories: 'private',
    officialPublication: 'private',
    files: 'private',
    manifestSha256: 'private',
  },
  migrationItem: {
    schemaVersion: 'private',
    id: 'private',
    sourceFile: 'private',
    sourcePosition: 'private',
    sourceIdentity: 'private',
    classification: 'private',
    reason: 'private',
    affectedFields: 'private',
  },
};

/** Retorna a classificacao de um campo, ou `undefined` se nao classificado. */
export function classificationOf(
  entity: CanonicalEntityName,
  field: string,
): FieldClassification | undefined {
  return FIELD_CLASSIFICATION[entity][field];
}

/**
 * Falha com erro descritivo se qualquer propriedade conhecida de um schema
 * nao estiver classificada. Usada em teste para garantir a classificacao
 * obrigatoria e total (Requisito 11.1).
 */
export function assertClassificationComplete(
  entity: CanonicalEntityName,
  knownFields: readonly string[],
): void {
  const table = FIELD_CLASSIFICATION[entity];
  const missing = knownFields.filter((f) => table[f] === undefined);
  if (missing.length > 0) {
    throw new Error(
      `Campos sem classificacao publico/privado em "${entity}": ${missing.join(', ')}`,
    );
  }
}
