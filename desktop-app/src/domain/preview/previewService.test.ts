// Testes unitarios do PreviewService (tarefa 10.1).
//
// Validacao objetiva (Requisitos 8.1-8.5, 8.8-8.10, 14.6):
//   - a previa e identificada e vinculada a revisao validada + rule set;
//   - dados privados nao aparecem na previa (reuso de projectPublic);
//   - o diff identifica inclusao, alteracao e remocao por culto/campo contra a
//     vigente SEM muta-la;
//   - aplicar o diff a vigente produz a candidata e aplicar o inverso produz a
//     vigente (reversibilidade);
//   - uma revisao alterada invalida a previa e a aprovacao vinculada.

import { describe, it, expect } from 'vitest';
import { SCHEMA_VERSION } from '../schemas/models';
import type { Approval, ExternalInput, ScheduleDraft, Service } from '../schemas/models';
import { RegistryService } from '../registry/registry-service';
import { canonicalBytes, canonicalStringify, sha256Hex } from '../schemas/canonical';
import { projectPublic, PRIVATE_SENTINEL_PREFIX } from '../projection/publicProjection';
import type { PublicProjectionInput } from '../projection/publicProjection';
import {
  applyDiff,
  computeDiff,
  generatePreview,
  invalidateApprovalIfStale,
  invertDiff,
  isPreviewValidForRevision,
  toFieldState,
  type PreviewInput,
} from './previewService';

// --------------------------------------------------------------------------
// Fixtures deterministicas
// --------------------------------------------------------------------------

const ID = {
  personA: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  personB: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  dept: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  cycle: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  svc1: 'f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1',
  svc2: 'f2f2f2f2-f2f2-4f2f-8f2f-f2f2f2f2f2f2',
  role: '10101010-1010-4010-8010-101010101010',
  op: '40404040-4040-4040-8040-404040404040',
  preview: '50505050-5050-4050-8050-505050505050',
} as const;

const NOW_UTC = '2026-02-01T12:00:00Z';
const AT = '2026-02-15';
const PURPOSE = 'Confirmacao de escala por WhatsApp';

function hashValue(value: string): string {
  return sha256Hex(canonicalBytes(value));
}

function buildRegistry(): RegistryService {
  const reg = new RegistryService();
  // Pessoa A com nota administrativa privada (sentinela) e sem telefone.
  reg.addPerson({
    id: ID.personA,
    canonicalName: 'Ana Maria',
    aliases: [{ value: `${PRIVATE_SENTINEL_PREFIX}_ALIAS` }],
    administrativeNotes: `${PRIVATE_SENTINEL_PREFIX}_NOTA_ADMIN`,
    now: NOW_UTC,
  });
  reg.addPerson({ id: ID.personB, canonicalName: 'Bruno Silva', now: NOW_UTC });
  reg.addDepartment({ id: ID.dept, canonicalName: 'Sonoplastia', now: NOW_UTC });
  return reg;
}

function service(id: string, date: string): Service {
  return {
    schemaVersion: SCHEMA_VERSION,
    id,
    cycleId: ID.cycle,
    date,
    computedWeekday: 'saturday',
    kind: 'regular',
    externalInputIds: [],
  };
}

function draftOf(
  revision: string,
  opts: {
    temaSvc1?: string;
    personForSvc1?: string;
    includeSvc2?: boolean;
    privateNote?: boolean;
  } = {},
): ScheduleDraft {
  const { temaSvc1 = 'A graca', personForSvc1 = ID.personA, includeSvc2 = false } = opts;
  const assignments: ScheduleDraft['assignments'] = [
    {
      id: 'assign-1',
      serviceId: ID.svc1,
      roleId: ID.role,
      subject: { type: 'person', id: personForSvc1 },
      source: 'manual',
      preferenceOverrideReason: `${PRIVATE_SENTINEL_PREFIX}_JUSTIFICATIVA`,
    },
  ];
  const publicFields: ScheduleDraft['publicFields'] = [
    { serviceId: ID.svc1, fields: { TEMA: temaSvc1 } },
  ];
  if (includeSvc2) {
    assignments.push({
      id: 'assign-2',
      serviceId: ID.svc2,
      roleId: ID.role,
      subject: { type: 'department', id: ID.dept },
      source: 'department-rule',
    });
    publicFields.push({ serviceId: ID.svc2, fields: { TEMA: 'Louvor' } });
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    cycleId: ID.cycle,
    revision,
    assignments,
    publicFields,
    privateNotes: opts.privateNote
      ? [{ id: 'note-1', serviceId: ID.svc1, text: `${PRIVATE_SENTINEL_PREFIX}_NOTA_CULTO` }]
      : [],
    createdAt: NOW_UTC,
  };
}

function externalInputs(): ExternalInput[] {
  return [
    {
      schemaVersion: SCHEMA_VERSION,
      id: 'input-priv',
      serviceId: ID.svc1,
      type: 'observation',
      value: `${PRIVATE_SENTINEL_PREFIX}_OBS_PRIVADA`,
      visibility: 'private',
      source: 'interno',
      updatedAt: NOW_UTC,
      operatorId: ID.op,
    },
  ];
}

function projectionInput(
  reg: RegistryService,
  services: Service[],
  draft: ScheduleDraft,
): PublicProjectionInput {
  return {
    registry: reg,
    services,
    draft,
    externalInputs: externalInputs(),
    period: '2026-02',
    at: AT,
    purpose: { phonePurpose: PURPOSE },
    valueHash: hashValue,
  };
}

function previewInput(overrides: Partial<PreviewInput> & Pick<PreviewInput, 'candidate'>): PreviewInput {
  return {
    previewId: ID.preview,
    cycleId: ID.cycle,
    draftRevision: 'a'.repeat(64),
    ruleSetVersion: 'v1',
    period: '2026-02',
    generatedAt: NOW_UTC,
    operatorId: ID.op,
    ...overrides,
  };
}

// --------------------------------------------------------------------------
// Geracao da previa (8.1-8.5)
// --------------------------------------------------------------------------

describe('generatePreview — identificacao e exclusao de privados', () => {
  it('gera previa identificada e vinculada a revisao validada e ao rule set', () => {
    const reg = buildRegistry();
    const draft = draftOf('a'.repeat(64), { privateNote: true });
    const result = generatePreview(
      previewInput({ candidate: projectionInput(reg, [service(ID.svc1, '2026-02-07')], draft) }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const p = result.preview;
    expect(p.previewId).toBe(ID.preview);
    expect(p.cycleId).toBe(ID.cycle);
    expect(p.draftRevision).toBe('a'.repeat(64));
    expect(p.ruleSetVersion).toBe('v1');
    expect(p.period).toBe('2026-02');
    expect(p.operatorId).toBe(ID.op);
    expect(p.schemaVersion).toBe(SCHEMA_VERSION);
    // Sem vigente: o diff e so inclusoes.
    expect(p.diff.every((e) => e.change === 'added')).toBe(true);
  });

  it('nenhuma sentinela privada aparece na previa serializada', () => {
    const reg = buildRegistry();
    const draft = draftOf('a'.repeat(64), { privateNote: true });
    const result = generatePreview(
      previewInput({ candidate: projectionInput(reg, [service(ID.svc1, '2026-02-07')], draft) }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const blob = JSON.stringify(result.preview);
    expect(blob).not.toContain(PRIVATE_SENTINEL_PREFIX);
    expect(blob).not.toContain('NOTA_ADMIN');
    expect(blob).not.toContain('JUSTIFICATIVA');
    expect(blob).not.toContain('OBS_PRIVADA');
    expect(blob).not.toContain('NOTA_CULTO');
    // Nome publico canonico aparece normalmente.
    expect(blob).toContain('Ana Maria');
  });

  it('propaga bloqueios quando a candidata nao pode ser projetada (sem emitir previa)', () => {
    const reg = buildRegistry();
    const draft = draftOf('a'.repeat(64));
    // Injeta nome de campo secreto nos campos publicos -> bloqueio.
    draft.publicFields = [{ serviceId: ID.svc1, fields: { TEMA: 'ok', token: 'xpto' } }];
    const result = generatePreview(
      previewInput({ candidate: projectionInput(reg, [service(ID.svc1, '2026-02-07')], draft) }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.blocks.some((b) => b.code === 'secret-field-name')).toBe(true);
  });
});

// --------------------------------------------------------------------------
// Diff: inclusao, alteracao e remocao (8.4, 14.6)
// --------------------------------------------------------------------------

describe('computeDiff — inclusao, alteracao e remocao por culto/campo', () => {
  it('identifica alteracao de campo publico contra a vigente', () => {
    const reg = buildRegistry();
    const currentProj = projectPublic(
      projectionInput(reg, [service(ID.svc1, '2026-02-07')], draftOf('c'.repeat(64), { temaSvc1: 'Tema antigo' })),
    );
    const candidateProj = projectPublic(
      projectionInput(reg, [service(ID.svc1, '2026-02-07')], draftOf('a'.repeat(64), { temaSvc1: 'Tema novo' })),
    );
    expect(currentProj.ok && candidateProj.ok).toBe(true);
    if (!currentProj.ok || !candidateProj.ok) return;

    const diff = computeDiff(currentProj.dto, candidateProj.dto);
    const changed = diff.find((e) => e.field === 'field.TEMA' && e.serviceId === ID.svc1);
    expect(changed).toBeDefined();
    expect(changed?.change).toBe('changed');
    expect(changed?.before).toBe('Tema antigo');
    expect(changed?.after).toBe('Tema novo');
  });

  it('identifica inclusao e remocao de cultos inteiros', () => {
    const reg = buildRegistry();
    // Vigente tem apenas svc1; candidata tem svc1 + svc2 (inclusao de svc2).
    const current = projectPublic(
      projectionInput(reg, [service(ID.svc1, '2026-02-07')], draftOf('c'.repeat(64))),
    );
    const candidate = projectPublic(
      projectionInput(
        reg,
        [service(ID.svc1, '2026-02-07'), service(ID.svc2, '2026-02-14')],
        draftOf('a'.repeat(64), { includeSvc2: true }),
      ),
    );
    expect(current.ok && candidate.ok).toBe(true);
    if (!current.ok || !candidate.ok) return;

    const diff = computeDiff(current.dto, candidate.dto);
    // Inclusoes: todas as entradas do svc2.
    const svc2Added = diff.filter((e) => e.serviceId === ID.svc2);
    expect(svc2Added.length).toBeGreaterThan(0);
    expect(svc2Added.every((e) => e.change === 'added')).toBe(true);
    // Nenhuma remocao do svc1 (identico nos dois).
    expect(diff.some((e) => e.serviceId === ID.svc1)).toBe(false);

    // Agora o inverso: candidata como "vigente" e vigente como "candidata" ->
    // svc2 deve aparecer como remocao.
    const reverseDiff = computeDiff(candidate.dto, current.dto);
    const svc2Removed = reverseDiff.filter((e) => e.serviceId === ID.svc2);
    expect(svc2Removed.length).toBeGreaterThan(0);
    expect(svc2Removed.every((e) => e.change === 'removed')).toBe(true);
  });

  it('nao produz entradas quando vigente e candidata sao semanticamente iguais', () => {
    const reg = buildRegistry();
    const a = projectPublic(projectionInput(reg, [service(ID.svc1, '2026-02-07')], draftOf('a'.repeat(64))));
    const b = projectPublic(projectionInput(reg, [service(ID.svc1, '2026-02-07')], draftOf('b'.repeat(64))));
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(computeDiff(a.dto, b.dto)).toEqual([]);
  });
});

// --------------------------------------------------------------------------
// Reversibilidade do diff (Property 32; 8.4, 14.6)
// --------------------------------------------------------------------------

describe('diff reversivel — aplicar diff e inverso reproduz candidata e vigente', () => {
  it('aplicar o diff a vigente produz a candidata; o inverso produz a vigente', () => {
    const reg = buildRegistry();
    const current = projectPublic(
      projectionInput(reg, [service(ID.svc1, '2026-02-07')], draftOf('c'.repeat(64), { temaSvc1: 'Antigo', personForSvc1: ID.personB })),
    );
    const candidate = projectPublic(
      projectionInput(
        reg,
        [service(ID.svc1, '2026-02-07'), service(ID.svc2, '2026-02-14')],
        draftOf('a'.repeat(64), { temaSvc1: 'Novo', personForSvc1: ID.personA, includeSvc2: true }),
      ),
    );
    expect(current.ok && candidate.ok).toBe(true);
    if (!current.ok || !candidate.ok) return;

    const currentState = toFieldState(current.dto);
    const candidateState = toFieldState(candidate.dto);
    const diff = computeDiff(current.dto, candidate.dto);

    // Aplicar o diff a vigente -> candidata.
    const applied = applyDiff(currentState, diff);
    expect(stableSerialize(applied)).toBe(stableSerialize(candidateState));

    // Aplicar o inverso a candidata -> vigente.
    const back = applyDiff(candidateState, invertDiff(diff));
    expect(stableSerialize(back)).toBe(stableSerialize(currentState));
  });

  it('nao muta a vigente (estado de entrada preservado)', () => {
    const reg = buildRegistry();
    const current = projectPublic(projectionInput(reg, [service(ID.svc1, '2026-02-07')], draftOf('c'.repeat(64), { temaSvc1: 'Antigo' })));
    const candidate = projectPublic(projectionInput(reg, [service(ID.svc1, '2026-02-07')], draftOf('a'.repeat(64), { temaSvc1: 'Novo' })));
    expect(current.ok && candidate.ok).toBe(true);
    if (!current.ok || !candidate.ok) return;

    const currentState = toFieldState(current.dto);
    const snapshot = stableSerialize(currentState);
    const diff = computeDiff(current.dto, candidate.dto);
    applyDiff(currentState, diff);
    // O estado original nao foi alterado por applyDiff.
    expect(stableSerialize(currentState)).toBe(snapshot);
  });

  it('diff contra vigente ausente (primeira publicacao) e composto so de inclusoes e reversivel', () => {
    const reg = buildRegistry();
    const candidate = projectPublic(projectionInput(reg, [service(ID.svc1, '2026-02-07')], draftOf('a'.repeat(64))));
    expect(candidate.ok).toBe(true);
    if (!candidate.ok) return;

    const diff = computeDiff(undefined, candidate.dto);
    expect(diff.length).toBeGreaterThan(0);
    expect(diff.every((e) => e.change === 'added')).toBe(true);

    const emptyState = toFieldState(undefined);
    const candidateState = toFieldState(candidate.dto);
    expect(stableSerialize(applyDiff(emptyState, diff))).toBe(stableSerialize(candidateState));
    expect(stableSerialize(applyDiff(candidateState, invertDiff(diff)))).toBe(stableSerialize(emptyState));
  });
});

// --------------------------------------------------------------------------
// Invalidacao por mudanca de revisao (8.8, 14.8)
// --------------------------------------------------------------------------

describe('invalidacao por mudanca de revisao', () => {
  it('a previa so e valida para a revisao a que foi vinculada', () => {
    const reg = buildRegistry();
    const result = generatePreview(
      previewInput({
        draftRevision: 'a'.repeat(64),
        candidate: projectionInput(reg, [service(ID.svc1, '2026-02-07')], draftOf('a'.repeat(64))),
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(isPreviewValidForRevision(result.preview, 'a'.repeat(64))).toBe(true);
    expect(isPreviewValidForRevision(result.preview, 'b'.repeat(64))).toBe(false);
  });

  it('uma revisao alterada invalida a aprovacao vinculada', () => {
    const approval: Approval = {
      schemaVersion: SCHEMA_VERSION,
      id: '60606060-6060-4060-8060-606060606060',
      previewId: ID.preview,
      cycleId: ID.cycle,
      draftRevision: 'a'.repeat(64),
      ruleSetVersion: 'v1',
      acknowledgedWarningIds: [],
      approverId: ID.op,
      approvedAt: NOW_UTC,
      status: 'valid',
    };

    // Revisao inalterada: aprovacao permanece valida (mesmo objeto).
    expect(invalidateApprovalIfStale(approval, 'a'.repeat(64))).toBe(approval);

    // Revisao alterada: aprovacao e invalidada (novo objeto, sem mutar a entrada).
    const invalidated = invalidateApprovalIfStale(approval, 'b'.repeat(64));
    expect(invalidated.status).toBe('invalidated');
    expect(approval.status).toBe('valid'); // entrada preservada
  });
});

// --------------------------------------------------------------------------
// Auxiliar de teste
// --------------------------------------------------------------------------

/** Serializa um Map de campos de forma estavel para comparacao semantica. */
function stableSerialize(state: Map<string, unknown>): string {
  const obj: Record<string, unknown> = {};
  for (const [k, v] of state) obj[k] = v;
  return canonicalStringify(obj);
}
