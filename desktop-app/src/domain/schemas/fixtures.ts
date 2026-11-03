// Fixtures canonicas para validacao objetiva.
//
//  - `validFixtures`   : uma entidade valida por tipo canonico; todas DEVEM
//                        passar na validacao de schema + semantica.
//  - `invalidFixtures` : casos que DEVEM falhar, cobrindo pelo menos:
//      * referencia quebrada (broken-reference)
//      * versao desconhecida (unknown-version)
//      * cardinalidade invalida (cardinality)
//      * formato invalido (format)
//  - `validEntitySet`  : conjunto coerente de entidades que passa na
//                        integridade referencial.
//  - `brokenReferenceSet` : conjunto com referencia quebrada que falha sem
//                        mutacao.

import { SCHEMA_VERSION, type CanonicalEntityName } from './models';
import type { EntitySet } from './validator';

// IDs fixos e deterministicos (UUID v4 validos).
const U = {
  person1: '11111111-1111-4111-8111-111111111111',
  person2: '22222222-2222-4222-8222-222222222222',
  dept1: '33333333-3333-4333-8333-333333333333',
  cycle1: '44444444-4444-4444-8444-444444444444',
  service1: '55555555-5555-4555-8555-555555555555',
  input1: '66666666-6666-4666-8666-666666666666',
  unav1: '77777777-7777-4777-8777-777777777777',
  ruleSet1: '88888888-8888-4888-8888-888888888888',
  rule1: '99999999-9999-4999-8999-999999999999',
  rule2: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  exception1: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  auth1: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  op1: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  leave1: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  link1: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
  assign1: '10101010-1010-4010-8010-101010101010',
  report1: '12121212-1212-4212-8212-121212121212',
  finding1: '13131313-1313-4313-8313-131313131313',
  preview1: '14141414-1414-4414-8414-141414141414',
  approval1: '15151515-1515-4515-8515-151515151515',
  pub1: '16161616-1616-4616-8616-161616161616',
  pkg1: '17171717-1717-4717-8717-171717171717',
  audit1: '18181818-1818-4818-8818-181818181818',
  backup1: '19191919-1919-4919-8919-191919191919',
  mig1: '20202020-2020-4020-8020-202020202020',
  typeId1: '21212121-2121-4121-8121-212121212121',
} as const;

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const NOW = '2026-01-15T12:00:00Z';

export const validFixtures: Record<CanonicalEntityName, unknown> = {
  person: {
    schemaVersion: SCHEMA_VERSION,
    id: U.person1,
    legacyId: 42,
    canonicalName: 'Ana Maria',
    aliases: [{ value: 'Aninha' }, { value: 'Ana M.', publicAuthorizationId: U.auth1 }],
    phoneE164: '+5511999998888',
    participation: 'active',
    publicContactAuthorizationIds: [U.auth1],
    capabilityIds: [U.typeId1],
    allowedWeekdays: ['wednesday', 'saturday', 'sunday'],
    leaves: [{ id: U.leave1, start: '2026-02-01', end: '2026-02-10', reason: 'Viagem' }],
    links: [
      {
        id: U.link1,
        typeId: U.typeId1,
        otherPersonId: U.person2,
        validFrom: '2026-01-01',
      },
    ],
    administrativeNotes: 'Observacao interna.',
    createdAt: NOW,
    updatedAt: NOW,
  },
  department: {
    schemaVersion: SCHEMA_VERSION,
    id: U.dept1,
    canonicalName: 'Sonoplastia',
    aliases: [{ value: 'Som' }],
    status: 'active',
    createdAt: NOW,
    updatedAt: NOW,
  },
  publicAuthorization: {
    schemaVersion: SCHEMA_VERSION,
    id: U.auth1,
    subjectId: U.person1,
    field: 'phone',
    valueHash: HASH_A,
    purpose: 'Confirmacao de escala por WhatsApp',
    approvedBy: U.op1,
    validFrom: '2026-01-01',
    validUntil: '2026-12-31',
    status: 'active',
    createdAt: NOW,
  },
  monthlyCycle: {
    schemaVersion: SCHEMA_VERSION,
    id: U.cycle1,
    period: '2026-02',
    state: 'open',
    stage: 'opening',
    ruleSetVersionId: U.ruleSet1,
    currentDraftRevision: HASH_A,
    serviceIds: [U.service1],
    stageCompletions: [{ stage: 'opening', result: 'ok', completedAt: NOW, operatorId: U.op1 }],
    createdAt: NOW,
    updatedAt: NOW,
  },
  service: {
    schemaVersion: SCHEMA_VERSION,
    id: U.service1,
    cycleId: U.cycle1,
    date: '2026-02-07',
    computedWeekday: 'saturday',
    kind: 'regular',
    externalInputIds: [U.input1],
  },
  externalInput: {
    schemaVersion: SCHEMA_VERSION,
    id: U.input1,
    serviceId: U.service1,
    type: 'theme',
    value: 'A graca que transforma',
    visibility: 'public',
    source: 'PDF do pregador',
    updatedAt: NOW,
    operatorId: U.op1,
  },
  unavailability: {
    schemaVersion: SCHEMA_VERSION,
    id: U.unav1,
    cycleId: U.cycle1,
    personId: U.person1,
    scope: { type: 'interval', start: '2026-02-01', end: '2026-02-10' },
    source: 'WhatsApp',
    createdAt: NOW,
  },
  approvedRuleSet: {
    schemaVersion: SCHEMA_VERSION,
    id: U.ruleSet1,
    version: 'v1',
    status: 'approved',
    validFrom: '2026-01-01',
    validUntil: '2026-12-31',
    rules: [
      {
        id: U.rule1,
        kind: 'fundamental',
        severity: 'blocking',
        applicability: { op: 'always' },
        assertion: { op: 'availableOnDate' },
        messageTemplate: 'Pessoa indisponivel na data.',
        allowedExceptionTypeIds: [],
      },
      {
        id: U.rule2,
        kind: 'preference',
        severity: 'warning',
        applicability: { op: 'serviceKind', args: ['regular'] },
        assertion: { op: 'rotationBalanced' },
        messageTemplate: 'Rotacao desequilibrada.',
        allowedExceptionTypeIds: [],
      },
    ],
    approvedBy: U.op1,
    approvedAt: NOW,
    sourceDecisions: [{ source: 'docs/regras/REGRAS.md', decision: 'adotada' }],
    createdAt: NOW,
  },
  approvedException: {
    schemaVersion: SCHEMA_VERSION,
    id: U.exception1,
    fundamentalRuleId: U.rule1,
    condition: { op: 'serviceId', args: [U.service1] },
    validFrom: '2026-02-01',
    validUntil: '2026-02-28',
    justification: 'Falta emergencial de regente habilitado.',
    approvedBy: U.op1,
    approvedAt: NOW,
  },
  scheduleDraft: {
    schemaVersion: SCHEMA_VERSION,
    cycleId: U.cycle1,
    revision: HASH_A,
    parentRevision: HASH_B,
    assignments: [
      {
        id: U.assign1,
        serviceId: U.service1,
        roleId: U.typeId1,
        subject: { type: 'person', id: U.person1 },
        source: 'manual',
      },
    ],
    publicFields: [{ serviceId: U.service1, fields: { TEMA: 'A graca' } }],
    privateNotes: [{ id: U.leave1, serviceId: U.service1, text: 'Nota privada' }],
    createdAt: NOW,
  },
  validationReport: {
    schemaVersion: SCHEMA_VERSION,
    reportId: U.report1,
    cycleId: U.cycle1,
    draftRevision: HASH_A,
    ruleSetVersion: 'v1',
    status: 'complete',
    blocking: [],
    warnings: [
      {
        findingId: U.finding1,
        ruleId: U.rule2,
        severity: 'warning',
        serviceId: U.service1,
        date: '2026-02-07',
        roleOrField: 'equipe',
        reason: 'Rotacao desequilibrada.',
        requiredAction: 'Revisar equipe.',
      },
    ],
    passedCount: 10,
    createdAt: NOW,
  },
  preview: {
    schemaVersion: SCHEMA_VERSION,
    previewId: U.preview1,
    cycleId: U.cycle1,
    draftRevision: HASH_A,
    ruleSetVersion: 'v1',
    period: '2026-02',
    generatedAt: NOW,
    operatorId: U.op1,
    publicServices: [{ serviceId: U.service1, fields: { TEMA: 'A graca' } }],
    diff: [{ serviceId: U.service1, field: 'TEMA', change: 'added', after: 'A graca' }],
  },
  approval: {
    schemaVersion: SCHEMA_VERSION,
    id: U.approval1,
    previewId: U.preview1,
    cycleId: U.cycle1,
    draftRevision: HASH_A,
    ruleSetVersion: 'v1',
    acknowledgedWarningIds: [U.finding1],
    approverId: U.op1,
    approvedAt: NOW,
    status: 'valid',
  },
  publicationRecord: {
    schemaVersion: SCHEMA_VERSION,
    id: U.pub1,
    packageId: U.pkg1,
    period: '2026-02',
    state: 'confirmed',
    privateCommit: 'abc1234',
    publicCommit: 'def5678',
    publicBackupCommit: '0123abc',
    confirmedAt: NOW,
    attempts: [{ attemptId: U.audit1, at: NOW, state: 'confirmed' }],
  },
  auditEvent: {
    schemaVersion: SCHEMA_VERSION,
    id: U.audit1,
    operationId: U.op1,
    timestamp: NOW,
    operatorId: U.op1,
    entityType: 'person',
    entityId: U.person1,
    action: 'update',
    changes: [{ field: 'canonicalName', before: 'Ana', after: 'Ana Maria' }],
    result: 'success',
  },
  backupManifest: {
    schemaVersion: SCHEMA_VERSION,
    id: U.backup1,
    formatVersion: '1',
    period: '2026-02',
    sourceVersion: 'v1',
    createdAt: NOW,
    operatorId: U.op1,
    categories: ['registry', 'rules', 'cycle'],
    officialPublication: true,
    files: [{ path: 'payload/person.json', sha256: HASH_A, bytes: 128 }],
    manifestSha256: HASH_B,
  },
  migrationItem: {
    schemaVersion: SCHEMA_VERSION,
    id: U.mig1,
    sourceFile: 'pessoas.json',
    sourcePosition: '[12]',
    sourceIdentity: 'Andre',
    classification: 'pending',
    reason: 'Nome ambiguo (duas correspondencias).',
    affectedFields: ['canonicalName'],
  },
};

/** Cada caso invalido descreve a classe de problema esperada. */
export interface InvalidCase {
  name: CanonicalEntityName;
  description: string;
  expectKind:
    'unknown-version' | 'cardinality' | 'format' | 'broken-reference' | 'date-range' | 'schema';
  value: unknown;
}

export const invalidFixtures: InvalidCase[] = [
  {
    name: 'person',
    description: 'versao de schema desconhecida',
    expectKind: 'unknown-version',
    value: { ...(validFixtures.person as object), schemaVersion: '9.9.9' },
  },
  {
    name: 'person',
    description: 'telefone em formato invalido (sem +)',
    expectKind: 'format',
    value: { ...(validFixtures.person as object), phoneE164: '5511999998888' },
  },
  {
    name: 'person',
    description: 'id nao e UUID',
    expectKind: 'format',
    value: { ...(validFixtures.person as object), id: 'nao-e-uuid' },
  },
  {
    name: 'person',
    description: 'excede 20 aliases (cardinalidade)',
    expectKind: 'cardinality',
    value: {
      ...(validFixtures.person as object),
      aliases: Array.from({ length: 21 }, (_, i) => ({ value: `alias-${i}` })),
    },
  },
  {
    name: 'person',
    description: 'afastamento com data final anterior a inicial',
    expectKind: 'date-range',
    value: {
      ...(validFixtures.person as object),
      leaves: [{ id: U.leave1, start: '2026-02-10', end: '2026-02-01' }],
    },
  },
  {
    name: 'person',
    description: 'self-link (vinculo com a propria pessoa)',
    expectKind: 'broken-reference',
    value: {
      ...(validFixtures.person as object),
      links: [
        { id: U.link1, typeId: U.typeId1, otherPersonId: U.person1, validFrom: '2026-01-01' },
      ],
    },
  },
  {
    name: 'monthlyCycle',
    description: 'period em formato invalido',
    expectKind: 'format',
    value: { ...(validFixtures.monthlyCycle as object), period: '2026/02' },
  },
  {
    name: 'service',
    description: 'dia da semana fora do enum',
    expectKind: 'schema',
    value: { ...(validFixtures.service as object), computedWeekday: 'funday' },
  },
  {
    name: 'unavailability',
    description: 'intervalo invertido',
    expectKind: 'date-range',
    value: {
      ...(validFixtures.unavailability as object),
      scope: { type: 'interval', start: '2026-02-10', end: '2026-02-01' },
    },
  },
  {
    name: 'unavailability',
    description: 'escopo de datas vazio (cardinalidade)',
    expectKind: 'cardinality',
    value: {
      ...(validFixtures.unavailability as object),
      scope: { type: 'dates', dates: [] },
    },
  },
  {
    name: 'approvedException',
    description: 'vigencia invertida',
    expectKind: 'date-range',
    value: {
      ...(validFixtures.approvedException as object),
      validFrom: '2026-02-28',
      validUntil: '2026-02-01',
    },
  },
  {
    name: 'auditEvent',
    description: 'campo extra proibido (ex.: token)',
    expectKind: 'schema',
    value: { ...(validFixtures.auditEvent as object), token: 'segredo' },
  },
];

/** Conjunto coerente que passa na integridade referencial. */
export const validEntitySet: EntitySet = {
  people: [
    validFixtures.person,
    {
      // Segunda pessoa referenciada pelo vinculo da primeira. Sem self-link:
      // seus proprios vinculos apontam de volta para person1.
      ...(validFixtures.person as object),
      id: U.person2,
      legacyId: 43,
      canonicalName: 'Bruno',
      links: [
        {
          id: U.link1,
          typeId: U.typeId1,
          otherPersonId: U.person1,
          validFrom: '2026-01-01',
        },
      ],
    },
  ],
  departments: [validFixtures.department],
  publicAuthorizations: [validFixtures.publicAuthorization],
  cycles: [validFixtures.monthlyCycle],
  services: [validFixtures.service],
  externalInputs: [validFixtures.externalInput],
  unavailabilities: [validFixtures.unavailability],
  ruleSets: [validFixtures.approvedRuleSet],
  exceptions: [validFixtures.approvedException],
  drafts: [validFixtures.scheduleDraft],
};

/** Conjunto com referencia quebrada (culto aponta para ciclo inexistente). */
export const brokenReferenceSet: EntitySet = {
  ...validEntitySet,
  services: [
    {
      ...(validFixtures.service as object),
      cycleId: '00000000-0000-4000-8000-000000000000', // ciclo inexistente
    },
  ],
};
