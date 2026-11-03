// Modelos canonicos versionados do dominio da gestao leiga de escalas.
//
// Convencoes (conforme design.md, secao "Data Models"):
//  - Todo identificador e UUID, exceto `legacyId` opcional (numero inteiro).
//  - Datas civis sao ISO `YYYY-MM-DD` (format "date").
//  - Instantes sao UTC RFC 3339 (format "date-time").
//  - Toda entidade persistida inclui `schemaVersion`, `createdAt` e
//    `updatedAt` quando aplicavel.
//  - Revisoes usam hash SHA-256 (64 hex) do JSON canonico.
//  - Cada campo tem classificacao obrigatoria (publico/privado) declarada no
//    registro de classificacao (ver `classification.ts`), nao no valor.
//
// Estes tipos sao a fonte unica de verdade para a forma dos dados. Os JSON
// Schemas (ver `jsonSchemas.ts`) espelham estes tipos e sao usados para a
// validacao objetiva em tempo de execucao.

/** Versao do esquema suportada por esta build do dominio. */
export const SCHEMA_VERSION = '1.0.0' as const;

/** Identificador universal (UUID v4, minusculo). */
export type Uuid = string;

/** Data civil ISO `YYYY-MM-DD`. */
export type IsoDate = string;

/** Instante UTC RFC 3339 (`YYYY-MM-DDTHH:MM:SSZ`). */
export type Utc = string;

/** Hash SHA-256 em hexadecimal minusculo (64 caracteres). */
export type Sha256 = string;

/** Dias da semana canonicos. */
export type Weekday =
  'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';

/**
 * Nomes de entidades/documentos canonicos suportados pelo registro de schemas.
 * Cada chave corresponde a exatamente um JSON Schema versionado.
 */
export type CanonicalEntityName =
  | 'person'
  | 'department'
  | 'publicAuthorization'
  | 'monthlyCycle'
  | 'service'
  | 'externalInput'
  | 'unavailability'
  | 'approvedRuleSet'
  | 'approvedException'
  | 'scheduleDraft'
  | 'validationReport'
  | 'preview'
  | 'approval'
  | 'publicationRecord'
  | 'auditEvent'
  | 'backupManifest'
  | 'migrationItem';

// --------------------------------------------------------------------------
// Cadastro central
// --------------------------------------------------------------------------

export interface PersonAlias {
  value: string;
  /** Presente apenas quando o alias foi autorizado como publico. */
  publicAuthorizationId?: Uuid;
}

export interface LeavePeriod {
  id: Uuid;
  start: IsoDate;
  /** Opcional; quando presente, deve ser >= `start`. */
  end?: IsoDate;
  reason?: string;
}

export interface PersonLink {
  id: Uuid;
  typeId: Uuid;
  otherPersonId: Uuid;
  validFrom: IsoDate;
  validUntil?: IsoDate;
}

export interface Person {
  schemaVersion: string;
  id: Uuid;
  legacyId?: number;
  canonicalName: string;
  aliases: PersonAlias[];
  phoneE164?: string;
  participation: 'active' | 'inactive';
  publicContactAuthorizationIds: Uuid[];
  capabilityIds: Uuid[];
  allowedWeekdays: Weekday[];
  leaves: LeavePeriod[];
  links: PersonLink[];
  administrativeNotes?: string;
  createdAt: Utc;
  updatedAt: Utc;
}

export interface Department {
  schemaVersion: string;
  id: Uuid;
  legacyId?: number;
  canonicalName: string;
  aliases: PersonAlias[];
  status: 'active' | 'inactive';
  createdAt: Utc;
  updatedAt: Utc;
}

export interface PublicAuthorization {
  schemaVersion: string;
  id: Uuid;
  subjectId: Uuid;
  field: 'canonicalName' | 'alias' | 'phone';
  valueHash: Sha256;
  purpose: string;
  approvedBy: Uuid;
  validFrom: IsoDate;
  validUntil?: IsoDate;
  status: 'active' | 'revoked';
  createdAt: Utc;
}

// --------------------------------------------------------------------------
// Ciclo mensal, cultos e rascunho
// --------------------------------------------------------------------------

export interface ServiceRemoval {
  reason: string;
  removedAt: Utc;
  operatorId: Uuid;
}

export interface Service {
  schemaVersion: string;
  id: Uuid;
  cycleId: Uuid;
  date: IsoDate;
  computedWeekday: Weekday;
  kind: 'regular' | 'extraordinary';
  removed?: ServiceRemoval;
  externalInputIds: Uuid[];
}

export interface StageCompletion {
  stage: CycleStage;
  result: string;
  completedAt: Utc;
  operatorId: Uuid;
}

export type CycleStage =
  'opening' | 'collection' | 'assembly' | 'validation' | 'approval' | 'publication' | 'closing';

export interface MonthlyCycle {
  schemaVersion: string;
  id: Uuid;
  /** `YYYY-MM`, unico por ciclo. */
  period: string;
  state: 'open' | 'published' | 'archived';
  stage: CycleStage;
  ruleSetVersionId: Uuid;
  currentDraftRevision: Sha256;
  serviceIds: Uuid[];
  stageCompletions: StageCompletion[];
  createdAt: Utc;
  updatedAt: Utc;
}

export interface Assignment {
  id: Uuid;
  serviceId: Uuid;
  roleId: Uuid;
  slot?: string;
  subject: { type: 'person' | 'department'; id: Uuid };
  source: 'manual' | 'suggested' | 'department-rule';
  preferenceOverrideReason?: string;
}

export interface PublicServiceFields {
  serviceId: Uuid;
  fields: Record<string, unknown>;
}

export interface PrivateNote {
  id: Uuid;
  serviceId: Uuid;
  text: string;
}

export interface ScheduleDraft {
  schemaVersion: string;
  cycleId: Uuid;
  revision: Sha256;
  parentRevision?: Sha256;
  assignments: Assignment[];
  publicFields: PublicServiceFields[];
  privateNotes: PrivateNote[];
  createdAt: Utc;
}

// --------------------------------------------------------------------------
// Insumos externos e indisponibilidades
// --------------------------------------------------------------------------

export type ExternalInputType =
  'elder' | 'preacher' | 'audio' | 'sabbath-school-song' | 'theme' | 'song-request' | 'observation';

export interface ExternalInput {
  schemaVersion: string;
  id: Uuid;
  serviceId: Uuid;
  type: ExternalInputType;
  value: unknown;
  visibility: 'public' | 'private';
  source: string;
  updatedAt: Utc;
  operatorId: Uuid;
}

export type UnavailabilityScope =
  | { type: 'dates'; dates: IsoDate[] }
  | { type: 'interval'; start: IsoDate; end: IsoDate }
  | { type: 'whole-cycle' };

export interface Unavailability {
  schemaVersion: string;
  id: Uuid;
  cycleId: Uuid;
  personId: Uuid;
  scope: UnavailabilityScope;
  source: string;
  createdAt: Utc;
}

// --------------------------------------------------------------------------
// Regras
// --------------------------------------------------------------------------

/**
 * Predicado declarativo limitado. A linguagem nao executa codigo arbitrario;
 * apenas um conjunto fechado de operacoes conhecidas (ver design.md). Para o
 * proposito dos schemas, representamos a forma estrutural minima.
 */
export interface RulePredicate {
  op: string;
  args?: unknown[];
}

export interface Rule {
  id: Uuid;
  kind: 'fundamental' | 'preference';
  severity: 'blocking' | 'warning';
  applicability: RulePredicate;
  assertion: RulePredicate;
  messageTemplate: string;
  allowedExceptionTypeIds: Uuid[];
}

export interface SourceDecision {
  source: string;
  decision: string;
  ruleId?: Uuid;
}

export interface ApprovedRuleSet {
  schemaVersion: string;
  id: Uuid;
  version: string;
  status: 'draft' | 'approved' | 'retired';
  validFrom: IsoDate;
  validUntil?: IsoDate;
  rules: Rule[];
  approvedBy?: Uuid;
  approvedAt?: Utc;
  sourceDecisions: SourceDecision[];
  createdAt: Utc;
}

export interface ApprovedException {
  schemaVersion: string;
  id: Uuid;
  fundamentalRuleId: Uuid;
  condition: RulePredicate;
  validFrom: IsoDate;
  validUntil: IsoDate;
  justification: string;
  approvedBy: Uuid;
  approvedAt: Utc;
}

// --------------------------------------------------------------------------
// Validacao, previa e aprovacao
// --------------------------------------------------------------------------

export interface ValidationFinding {
  findingId: Uuid;
  ruleId: Uuid;
  severity: 'blocking' | 'warning';
  serviceId?: Uuid;
  date?: IsoDate;
  roleOrField?: string;
  offendingReference?: string;
  reason: string;
  requiredAction: string;
}

export interface ValidationReport {
  schemaVersion: string;
  reportId: Uuid;
  cycleId: Uuid;
  draftRevision: Sha256;
  ruleSetVersion: string;
  status: 'complete' | 'failed';
  blocking: ValidationFinding[];
  warnings: ValidationFinding[];
  passedCount: number;
  createdAt: Utc;
}

export interface Preview {
  schemaVersion: string;
  previewId: Uuid;
  cycleId: Uuid;
  draftRevision: Sha256;
  ruleSetVersion: string;
  period: string;
  generatedAt: Utc;
  operatorId: Uuid;
  /** Projecao publica (apenas dados publicos). */
  publicServices: PublicServiceFields[];
  diff: PreviewDiffEntry[];
}

export interface PreviewDiffEntry {
  serviceId: Uuid;
  field: string;
  change: 'added' | 'removed' | 'changed';
  before?: unknown;
  after?: unknown;
}

export interface Approval {
  schemaVersion: string;
  id: Uuid;
  previewId: Uuid;
  cycleId: Uuid;
  draftRevision: Sha256;
  ruleSetVersion: string;
  acknowledgedWarningIds: Uuid[];
  approverId: Uuid;
  approvedAt: Utc;
  status: 'valid' | 'invalidated';
}

// --------------------------------------------------------------------------
// Publicacao e auditoria
// --------------------------------------------------------------------------

export interface PublicationAttempt {
  attemptId: Uuid;
  at: Utc;
  state: PublicationRecord['state'];
  detail?: string;
}

export interface PublicationRecord {
  schemaVersion: string;
  id: Uuid;
  packageId: Uuid;
  period: string;
  state:
    | 'prepared'
    | 'private-synced'
    | 'backed-up'
    | 'pushed'
    | 'pages-processing'
    | 'incomplete'
    | 'confirmed'
    | 'failed';
  privateCommit?: string;
  publicCommit?: string;
  publicBackupCommit?: string;
  attempts: PublicationAttempt[];
  confirmedAt?: Utc;
}

export interface AuditChange {
  field: string;
  beforeHash?: Sha256;
  afterHash?: Sha256;
  before?: unknown;
  after?: unknown;
}

export interface AuditEvent {
  schemaVersion: string;
  id: Uuid;
  operationId: Uuid;
  timestamp: Utc;
  operatorId: Uuid;
  entityType: string;
  entityId: Uuid;
  action: string;
  changes: AuditChange[];
  result: 'success' | 'incomplete' | 'failed';
}

// --------------------------------------------------------------------------
// Backup e migracao
// --------------------------------------------------------------------------

export interface BackupFileRef {
  path: string;
  sha256: Sha256;
  bytes: number;
}

export interface BackupManifest {
  schemaVersion: string;
  id: Uuid;
  formatVersion: string;
  period: string;
  sourceVersion: string;
  createdAt: Utc;
  operatorId: Uuid;
  categories: string[];
  officialPublication: boolean;
  files: BackupFileRef[];
  manifestSha256: Sha256;
}

export interface MigrationItem {
  schemaVersion: string;
  id: Uuid;
  sourceFile: string;
  sourcePosition: string;
  sourceIdentity: string;
  classification: 'imported' | 'transformed' | 'rejected' | 'pending';
  reason?: string;
  affectedFields: string[];
}
