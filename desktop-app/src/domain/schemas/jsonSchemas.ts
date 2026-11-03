// JSON Schemas versionados (draft 2020-12) para os modelos canonicos.
//
// Cada schema:
//  - tem `$id` que embute a versao do schema (`SCHEMA_VERSION`);
//  - exige `schemaVersion` como `const` igual a `SCHEMA_VERSION`, de modo que
//    uma versao desconhecida falha objetivamente (Requisito 6.1, validacao de
//    "versao desconhecida" do criterio objetivo da tarefa);
//  - usa `additionalProperties: false` para rejeitar formatos invalidos;
//  - usa `format` (uuid, date, date-time) via ajv-formats;
//  - aplica cardinalidades (minItems/maxItems) e limites de texto do dominio.

import { SCHEMA_VERSION, type CanonicalEntityName } from './models';

export const SCHEMA_ID_BASE = 'https://escalamusica.local/schemas';

/** Tipos de formato reutilizaveis. */
const uuid = { type: 'string', format: 'uuid' } as const;
const isoDate = { type: 'string', format: 'date' } as const;
const utc = { type: 'string', format: 'date-time' } as const;
const sha256 = { type: 'string', pattern: '^[0-9a-f]{64}$' } as const;
const period = { type: 'string', pattern: '^[0-9]{4}-(0[1-9]|1[0-2])$' } as const;
const phoneE164 = { type: 'string', pattern: '^\\+[0-9]{8,15}$' } as const;
const weekday = {
  type: 'string',
  enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
} as const;

/** Campo `schemaVersion` fixado na versao atual. */
const schemaVersionField = { type: 'string', const: SCHEMA_VERSION } as const;

const name1to120 = { type: 'string', minLength: 1, maxLength: 120 } as const;

const alias = {
  type: 'object',
  additionalProperties: false,
  required: ['value'],
  properties: {
    value: name1to120,
    publicAuthorizationId: uuid,
  },
} as const;

const aliasArray = { type: 'array', maxItems: 20, items: alias } as const;

const rulePredicate = {
  type: 'object',
  additionalProperties: false,
  required: ['op'],
  properties: {
    op: { type: 'string', minLength: 1 },
    args: { type: 'array' },
  },
} as const;

// --------------------------------------------------------------------------
// Schemas por entidade
// --------------------------------------------------------------------------

const person = {
  $id: `${SCHEMA_ID_BASE}/person/${SCHEMA_VERSION}`,
  type: 'object',
  additionalProperties: false,
  required: [
    'schemaVersion',
    'id',
    'canonicalName',
    'aliases',
    'participation',
    'publicContactAuthorizationIds',
    'capabilityIds',
    'allowedWeekdays',
    'leaves',
    'links',
    'createdAt',
    'updatedAt',
  ],
  properties: {
    schemaVersion: schemaVersionField,
    id: uuid,
    legacyId: { type: 'integer', minimum: 0 },
    canonicalName: name1to120,
    aliases: aliasArray,
    phoneE164,
    participation: { type: 'string', enum: ['active', 'inactive'] },
    publicContactAuthorizationIds: { type: 'array', items: uuid },
    capabilityIds: { type: 'array', items: uuid },
    allowedWeekdays: {
      type: 'array',
      maxItems: 7,
      uniqueItems: true,
      items: weekday,
    },
    leaves: {
      type: 'array',
      maxItems: 1000,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'start'],
        properties: {
          id: uuid,
          start: isoDate,
          end: isoDate,
          reason: { type: 'string', maxLength: 500 },
        },
      },
    },
    links: {
      type: 'array',
      maxItems: 50,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'typeId', 'otherPersonId', 'validFrom'],
        properties: {
          id: uuid,
          typeId: uuid,
          otherPersonId: uuid,
          validFrom: isoDate,
          validUntil: isoDate,
        },
      },
    },
    administrativeNotes: { type: 'string', maxLength: 5000 },
    createdAt: utc,
    updatedAt: utc,
  },
} as const;

const department = {
  $id: `${SCHEMA_ID_BASE}/department/${SCHEMA_VERSION}`,
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'id', 'canonicalName', 'aliases', 'status', 'createdAt', 'updatedAt'],
  properties: {
    schemaVersion: schemaVersionField,
    id: uuid,
    legacyId: { type: 'integer', minimum: 0 },
    canonicalName: name1to120,
    aliases: aliasArray,
    status: { type: 'string', enum: ['active', 'inactive'] },
    createdAt: utc,
    updatedAt: utc,
  },
} as const;

const publicAuthorization = {
  $id: `${SCHEMA_ID_BASE}/publicAuthorization/${SCHEMA_VERSION}`,
  type: 'object',
  additionalProperties: false,
  required: [
    'schemaVersion',
    'id',
    'subjectId',
    'field',
    'valueHash',
    'purpose',
    'approvedBy',
    'validFrom',
    'status',
    'createdAt',
  ],
  properties: {
    schemaVersion: schemaVersionField,
    id: uuid,
    subjectId: uuid,
    field: { type: 'string', enum: ['canonicalName', 'alias', 'phone'] },
    valueHash: sha256,
    purpose: { type: 'string', minLength: 1, maxLength: 200 },
    approvedBy: uuid,
    validFrom: isoDate,
    validUntil: isoDate,
    status: { type: 'string', enum: ['active', 'revoked'] },
    createdAt: utc,
  },
} as const;

const service = {
  $id: `${SCHEMA_ID_BASE}/service/${SCHEMA_VERSION}`,
  type: 'object',
  additionalProperties: false,
  required: [
    'schemaVersion',
    'id',
    'cycleId',
    'date',
    'computedWeekday',
    'kind',
    'externalInputIds',
  ],
  properties: {
    schemaVersion: schemaVersionField,
    id: uuid,
    cycleId: uuid,
    date: isoDate,
    computedWeekday: weekday,
    kind: { type: 'string', enum: ['regular', 'extraordinary'] },
    removed: {
      type: 'object',
      additionalProperties: false,
      required: ['reason', 'removedAt', 'operatorId'],
      properties: {
        reason: { type: 'string', minLength: 1, maxLength: 500 },
        removedAt: utc,
        operatorId: uuid,
      },
    },
    externalInputIds: { type: 'array', items: uuid },
  },
} as const;

const monthlyCycle = {
  $id: `${SCHEMA_ID_BASE}/monthlyCycle/${SCHEMA_VERSION}`,
  type: 'object',
  additionalProperties: false,
  required: [
    'schemaVersion',
    'id',
    'period',
    'state',
    'stage',
    'ruleSetVersionId',
    'currentDraftRevision',
    'serviceIds',
    'stageCompletions',
    'createdAt',
    'updatedAt',
  ],
  properties: {
    schemaVersion: schemaVersionField,
    id: uuid,
    period,
    state: { type: 'string', enum: ['open', 'published', 'archived'] },
    stage: {
      type: 'string',
      enum: [
        'opening',
        'collection',
        'assembly',
        'validation',
        'approval',
        'publication',
        'closing',
      ],
    },
    ruleSetVersionId: uuid,
    currentDraftRevision: sha256,
    serviceIds: { type: 'array', items: uuid },
    stageCompletions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['stage', 'result', 'completedAt', 'operatorId'],
        properties: {
          stage: {
            type: 'string',
            enum: [
              'opening',
              'collection',
              'assembly',
              'validation',
              'approval',
              'publication',
              'closing',
            ],
          },
          result: { type: 'string', minLength: 1 },
          completedAt: utc,
          operatorId: uuid,
        },
      },
    },
    createdAt: utc,
    updatedAt: utc,
  },
} as const;

const externalInput = {
  $id: `${SCHEMA_ID_BASE}/externalInput/${SCHEMA_VERSION}`,
  type: 'object',
  additionalProperties: false,
  required: [
    'schemaVersion',
    'id',
    'serviceId',
    'type',
    'value',
    'visibility',
    'source',
    'updatedAt',
    'operatorId',
  ],
  properties: {
    schemaVersion: schemaVersionField,
    id: uuid,
    serviceId: uuid,
    type: {
      type: 'string',
      enum: [
        'elder',
        'preacher',
        'audio',
        'sabbath-school-song',
        'theme',
        'song-request',
        'observation',
      ],
    },
    // `value` e livre por tipo; a validacao fina por tipo e feita pelo
    // servico de coleta (tarefa 4.x). Aqui garantimos presenca e estrutura.
    value: {},
    visibility: { type: 'string', enum: ['public', 'private'] },
    source: { type: 'string', minLength: 1, maxLength: 200 },
    updatedAt: utc,
    operatorId: uuid,
  },
} as const;

const unavailability = {
  $id: `${SCHEMA_ID_BASE}/unavailability/${SCHEMA_VERSION}`,
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'id', 'cycleId', 'personId', 'scope', 'source', 'createdAt'],
  properties: {
    schemaVersion: schemaVersionField,
    id: uuid,
    cycleId: uuid,
    personId: uuid,
    source: { type: 'string', minLength: 1, maxLength: 200 },
    createdAt: utc,
    scope: {
      oneOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: ['type', 'dates'],
          properties: {
            type: { const: 'dates' },
            dates: { type: 'array', minItems: 1, items: isoDate },
          },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['type', 'start', 'end'],
          properties: {
            type: { const: 'interval' },
            start: isoDate,
            end: isoDate,
          },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['type'],
          properties: { type: { const: 'whole-cycle' } },
        },
      ],
    },
  },
} as const;

const rule = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'kind',
    'severity',
    'applicability',
    'assertion',
    'messageTemplate',
    'allowedExceptionTypeIds',
  ],
  properties: {
    id: uuid,
    kind: { type: 'string', enum: ['fundamental', 'preference'] },
    severity: { type: 'string', enum: ['blocking', 'warning'] },
    applicability: rulePredicate,
    assertion: rulePredicate,
    messageTemplate: { type: 'string', minLength: 1 },
    allowedExceptionTypeIds: { type: 'array', items: uuid },
  },
} as const;

const approvedRuleSet = {
  $id: `${SCHEMA_ID_BASE}/approvedRuleSet/${SCHEMA_VERSION}`,
  type: 'object',
  additionalProperties: false,
  required: [
    'schemaVersion',
    'id',
    'version',
    'status',
    'validFrom',
    'rules',
    'sourceDecisions',
    'createdAt',
  ],
  properties: {
    schemaVersion: schemaVersionField,
    id: uuid,
    version: { type: 'string', minLength: 1 },
    status: { type: 'string', enum: ['draft', 'approved', 'retired'] },
    validFrom: isoDate,
    validUntil: isoDate,
    rules: { type: 'array', items: rule },
    approvedBy: uuid,
    approvedAt: utc,
    sourceDecisions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['source', 'decision'],
        properties: {
          source: { type: 'string', minLength: 1 },
          decision: { type: 'string', minLength: 1 },
          ruleId: uuid,
        },
      },
    },
    createdAt: utc,
  },
} as const;

const approvedException = {
  $id: `${SCHEMA_ID_BASE}/approvedException/${SCHEMA_VERSION}`,
  type: 'object',
  additionalProperties: false,
  required: [
    'schemaVersion',
    'id',
    'fundamentalRuleId',
    'condition',
    'validFrom',
    'validUntil',
    'justification',
    'approvedBy',
    'approvedAt',
  ],
  properties: {
    schemaVersion: schemaVersionField,
    id: uuid,
    fundamentalRuleId: uuid,
    condition: rulePredicate,
    validFrom: isoDate,
    validUntil: isoDate,
    justification: { type: 'string', minLength: 1, maxLength: 1000 },
    approvedBy: uuid,
    approvedAt: utc,
  },
} as const;

const assignment = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'serviceId', 'roleId', 'subject', 'source'],
  properties: {
    id: uuid,
    serviceId: uuid,
    roleId: uuid,
    slot: { type: 'string', minLength: 1 },
    subject: {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'id'],
      properties: {
        type: { type: 'string', enum: ['person', 'department'] },
        id: uuid,
      },
    },
    source: { type: 'string', enum: ['manual', 'suggested', 'department-rule'] },
    preferenceOverrideReason: { type: 'string', minLength: 1 },
  },
} as const;

const scheduleDraft = {
  $id: `${SCHEMA_ID_BASE}/scheduleDraft/${SCHEMA_VERSION}`,
  type: 'object',
  additionalProperties: false,
  required: [
    'schemaVersion',
    'cycleId',
    'revision',
    'assignments',
    'publicFields',
    'privateNotes',
    'createdAt',
  ],
  properties: {
    schemaVersion: schemaVersionField,
    cycleId: uuid,
    revision: sha256,
    parentRevision: sha256,
    assignments: { type: 'array', items: assignment },
    publicFields: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['serviceId', 'fields'],
        properties: {
          serviceId: uuid,
          fields: { type: 'object' },
        },
      },
    },
    privateNotes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'serviceId', 'text'],
        properties: {
          id: uuid,
          serviceId: uuid,
          text: { type: 'string' },
        },
      },
    },
    createdAt: utc,
  },
} as const;

const validationFinding = {
  type: 'object',
  additionalProperties: false,
  required: ['findingId', 'ruleId', 'severity', 'reason', 'requiredAction'],
  properties: {
    findingId: uuid,
    ruleId: uuid,
    severity: { type: 'string', enum: ['blocking', 'warning'] },
    serviceId: uuid,
    date: isoDate,
    roleOrField: { type: 'string' },
    offendingReference: { type: 'string' },
    reason: { type: 'string', minLength: 1 },
    requiredAction: { type: 'string', minLength: 1 },
  },
} as const;

const validationReport = {
  $id: `${SCHEMA_ID_BASE}/validationReport/${SCHEMA_VERSION}`,
  type: 'object',
  additionalProperties: false,
  required: [
    'schemaVersion',
    'reportId',
    'cycleId',
    'draftRevision',
    'ruleSetVersion',
    'status',
    'blocking',
    'warnings',
    'passedCount',
    'createdAt',
  ],
  properties: {
    schemaVersion: schemaVersionField,
    reportId: uuid,
    cycleId: uuid,
    draftRevision: sha256,
    ruleSetVersion: { type: 'string', minLength: 1 },
    status: { type: 'string', enum: ['complete', 'failed'] },
    blocking: { type: 'array', items: validationFinding },
    warnings: { type: 'array', items: validationFinding },
    passedCount: { type: 'integer', minimum: 0 },
    createdAt: utc,
  },
} as const;

const previewDiffEntry = {
  type: 'object',
  additionalProperties: false,
  required: ['serviceId', 'field', 'change'],
  properties: {
    serviceId: uuid,
    field: { type: 'string', minLength: 1 },
    change: { type: 'string', enum: ['added', 'removed', 'changed'] },
    before: {},
    after: {},
  },
} as const;

const preview = {
  $id: `${SCHEMA_ID_BASE}/preview/${SCHEMA_VERSION}`,
  type: 'object',
  additionalProperties: false,
  required: [
    'schemaVersion',
    'previewId',
    'cycleId',
    'draftRevision',
    'ruleSetVersion',
    'period',
    'generatedAt',
    'operatorId',
    'publicServices',
    'diff',
  ],
  properties: {
    schemaVersion: schemaVersionField,
    previewId: uuid,
    cycleId: uuid,
    draftRevision: sha256,
    ruleSetVersion: { type: 'string', minLength: 1 },
    period,
    generatedAt: utc,
    operatorId: uuid,
    publicServices: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['serviceId', 'fields'],
        properties: { serviceId: uuid, fields: { type: 'object' } },
      },
    },
    diff: { type: 'array', items: previewDiffEntry },
  },
} as const;

const approval = {
  $id: `${SCHEMA_ID_BASE}/approval/${SCHEMA_VERSION}`,
  type: 'object',
  additionalProperties: false,
  required: [
    'schemaVersion',
    'id',
    'previewId',
    'cycleId',
    'draftRevision',
    'ruleSetVersion',
    'acknowledgedWarningIds',
    'approverId',
    'approvedAt',
    'status',
  ],
  properties: {
    schemaVersion: schemaVersionField,
    id: uuid,
    previewId: uuid,
    cycleId: uuid,
    draftRevision: sha256,
    ruleSetVersion: { type: 'string', minLength: 1 },
    acknowledgedWarningIds: { type: 'array', items: uuid },
    approverId: uuid,
    approvedAt: utc,
    status: { type: 'string', enum: ['valid', 'invalidated'] },
  },
} as const;

const publicationRecord = {
  $id: `${SCHEMA_ID_BASE}/publicationRecord/${SCHEMA_VERSION}`,
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'id', 'packageId', 'period', 'state', 'attempts'],
  properties: {
    schemaVersion: schemaVersionField,
    id: uuid,
    packageId: uuid,
    period,
    state: {
      type: 'string',
      enum: [
        'prepared',
        'private-synced',
        'backed-up',
        'pushed',
        'pages-processing',
        'incomplete',
        'confirmed',
        'failed',
      ],
    },
    privateCommit: { type: 'string', pattern: '^[0-9a-f]{7,40}$' },
    publicCommit: { type: 'string', pattern: '^[0-9a-f]{7,40}$' },
    publicBackupCommit: { type: 'string', pattern: '^[0-9a-f]{7,40}$' },
    confirmedAt: utc,
    attempts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['attemptId', 'at', 'state'],
        properties: {
          attemptId: uuid,
          at: utc,
          state: { type: 'string' },
          detail: { type: 'string' },
        },
      },
    },
  },
} as const;

const auditEvent = {
  $id: `${SCHEMA_ID_BASE}/auditEvent/${SCHEMA_VERSION}`,
  type: 'object',
  additionalProperties: false,
  required: [
    'schemaVersion',
    'id',
    'operationId',
    'timestamp',
    'operatorId',
    'entityType',
    'entityId',
    'action',
    'changes',
    'result',
  ],
  properties: {
    schemaVersion: schemaVersionField,
    id: uuid,
    operationId: uuid,
    timestamp: utc,
    operatorId: uuid,
    entityType: { type: 'string', minLength: 1 },
    entityId: uuid,
    action: { type: 'string', minLength: 1 },
    result: { type: 'string', enum: ['success', 'incomplete', 'failed'] },
    changes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['field'],
        // Credenciais sao proibidas pelo schema de auditoria: nenhum campo de
        // segredo e permitido e `additionalProperties` e falso.
        properties: {
          field: { type: 'string', minLength: 1 },
          beforeHash: sha256,
          afterHash: sha256,
          before: {},
          after: {},
        },
      },
    },
  },
} as const;

const backupManifest = {
  $id: `${SCHEMA_ID_BASE}/backupManifest/${SCHEMA_VERSION}`,
  type: 'object',
  additionalProperties: false,
  required: [
    'schemaVersion',
    'id',
    'formatVersion',
    'period',
    'sourceVersion',
    'createdAt',
    'operatorId',
    'categories',
    'officialPublication',
    'files',
    'manifestSha256',
  ],
  properties: {
    schemaVersion: schemaVersionField,
    id: uuid,
    formatVersion: { type: 'string', minLength: 1 },
    period,
    sourceVersion: { type: 'string', minLength: 1 },
    createdAt: utc,
    operatorId: uuid,
    categories: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } },
    officialPublication: { type: 'boolean' },
    manifestSha256: sha256,
    files: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['path', 'sha256', 'bytes'],
        properties: {
          path: { type: 'string', minLength: 1 },
          sha256,
          bytes: { type: 'integer', minimum: 0 },
        },
      },
    },
  },
} as const;

const migrationItem = {
  $id: `${SCHEMA_ID_BASE}/migrationItem/${SCHEMA_VERSION}`,
  type: 'object',
  additionalProperties: false,
  required: [
    'schemaVersion',
    'id',
    'sourceFile',
    'sourcePosition',
    'sourceIdentity',
    'classification',
    'affectedFields',
  ],
  properties: {
    schemaVersion: schemaVersionField,
    id: uuid,
    sourceFile: { type: 'string', minLength: 1 },
    sourcePosition: { type: 'string', minLength: 1 },
    sourceIdentity: { type: 'string' },
    classification: {
      type: 'string',
      enum: ['imported', 'transformed', 'rejected', 'pending'],
    },
    reason: { type: 'string' },
    affectedFields: { type: 'array', items: { type: 'string' } },
  },
} as const;

/**
 * Registro fechado: nome canonico -> JSON Schema. A ordem reflete models.ts.
 */
export const JSON_SCHEMAS: Record<CanonicalEntityName, Record<string, unknown>> = {
  person,
  department,
  publicAuthorization,
  monthlyCycle,
  service,
  externalInput,
  unavailability,
  approvedRuleSet,
  approvedException,
  scheduleDraft,
  validationReport,
  preview,
  approval,
  publicationRecord,
  auditEvent,
  backupManifest,
  migrationItem,
};
