// Testes unitarios do ApprovalService (tarefa 10.2).
//
// Validacao objetiva (Requisitos 8.6-8.11):
//   - a aprovacao registra Aprovador, versao do rascunho + rule set, data/hora
//     e os Avisos reconhecidos (8.7/8.11);
//   - a aprovacao e permitida SOMENTE quando a previa esta vinculada a revisao
//     atual, sem Bloqueios, com validacao concluida e com ciencia de CADA
//     Aviso, e (quando informado) com periodo coincidente (8.6/8.8/8.9/8.10);
//   - casos com ZERO, UM e VARIOS avisos passam somente quando todas as
//     condicoes estao atendidas.
//
// Datas sao literais civis `YYYY-MM-DD`/`YYYY-MM`; nao se usa fc.date() nem
// toISOString() (evita flutuacao de fuso/horario).

import { describe, it, expect } from 'vitest';
import { SCHEMA_VERSION } from '../schemas/models';
import type {
  Preview,
  ValidationFinding,
  ValidationReport,
} from '../schemas/models';
import {
  approvePreview,
  type ApprovalRejectionReason,
  type ApprovalRequest,
} from './approvalService';

// --------------------------------------------------------------------------
// Fixtures deterministicas
// --------------------------------------------------------------------------

const ID = {
  cycle: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  preview: '50505050-5050-4050-8050-505050505050',
  approval: '60606060-6060-4060-8060-606060606060',
  approver: '40404040-4040-4040-8040-404040404040',
  rule: '10101010-1010-4010-8010-101010101010',
  svc: 'f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1',
} as const;

// Revisao SHA-256-like (64 hex) e versao de rule set.
const REVISION = 'a'.repeat(64);
const OTHER_REVISION = 'b'.repeat(64);
const RULESET = 'v2026-02';
const OTHER_RULESET = 'v2026-03';
const PERIOD = '2026-02';
const OTHER_PERIOD = '2026-03';
const APPROVED_AT = '2026-02-15';

function warning(findingId: string): ValidationFinding {
  return {
    findingId,
    ruleId: ID.rule,
    severity: 'warning',
    serviceId: ID.svc,
    reason: 'preferencia nao atendida',
    requiredAction: 'reconheca o aviso',
  };
}

function blocking(findingId: string): ValidationFinding {
  return {
    findingId,
    ruleId: ID.rule,
    severity: 'blocking',
    serviceId: ID.svc,
    reason: 'regra fundamental violada',
    requiredAction: 'corrija a atribuicao',
  };
}

function buildReport(overrides: Partial<ValidationReport> = {}): ValidationReport {
  return {
    schemaVersion: SCHEMA_VERSION,
    reportId: '70707070-7070-4070-8070-707070707070',
    cycleId: ID.cycle,
    draftRevision: REVISION,
    ruleSetVersion: RULESET,
    status: 'complete',
    blocking: [],
    warnings: [],
    passedCount: 10,
    createdAt: '2026-02-15T00:00:00Z',
    ...overrides,
  };
}

function buildPreview(overrides: Partial<Preview> = {}): Preview {
  return {
    schemaVersion: SCHEMA_VERSION,
    previewId: ID.preview,
    cycleId: ID.cycle,
    draftRevision: REVISION,
    ruleSetVersion: RULESET,
    period: PERIOD,
    generatedAt: '2026-02-14',
    operatorId: ID.approver,
    publicServices: [],
    diff: [],
    ...overrides,
  };
}

function buildRequest(overrides: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return {
    preview: buildPreview(),
    report: buildReport(),
    currentDraftRevision: REVISION,
    currentRuleSetVersion: RULESET,
    publicationPeriod: PERIOD,
    acknowledgedWarningIds: [],
    approvalId: ID.approval,
    approverId: ID.approver,
    approvedAt: APPROVED_AT,
    ...overrides,
  };
}

/** Coleta os `kind` de rejeicao para asserts legiveis. */
function reasonKinds(result: ReturnType<typeof approvePreview>): ApprovalRejectionReason['kind'][] {
  return result.ok ? [] : result.reasons.map((r) => r.kind);
}

// --------------------------------------------------------------------------
// Caminho feliz: zero, um e varios avisos (8.6/8.7/8.11)
// --------------------------------------------------------------------------

describe('ApprovalService.approvePreview — caminho feliz (8.6/8.7/8.11)', () => {
  it('ZERO avisos: aprova sem exigir ciencia e registra os vinculos (8.7)', () => {
    const result = approvePreview(buildRequest());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const a = result.approval;
    expect(a.status).toBe('valid');
    expect(a.id).toBe(ID.approval);
    expect(a.previewId).toBe(ID.preview); // mesma previa aprovada (8.11)
    expect(a.cycleId).toBe(ID.cycle);
    expect(a.draftRevision).toBe(REVISION);
    expect(a.ruleSetVersion).toBe(RULESET);
    expect(a.approverId).toBe(ID.approver); // operador = Aprovador (8.11)
    expect(a.approvedAt).toBe(APPROVED_AT);
    expect(a.acknowledgedWarningIds).toEqual([]);
    expect(a.schemaVersion).toBe(SCHEMA_VERSION);
  });

  it('UM aviso: aprova quando o unico aviso e reconhecido e registra sua ciencia (8.6/8.7)', () => {
    const w = 'w-1';
    const result = approvePreview(
      buildRequest({
        report: buildReport({ warnings: [warning(w)] }),
        acknowledgedWarningIds: [w],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.approval.acknowledgedWarningIds).toEqual([w]);
  });

  it('VARIOS avisos: aprova quando TODOS sao reconhecidos; registra ciencia ordenada e sem duplicatas', () => {
    const ws = ['w-3', 'w-1', 'w-2'];
    const result = approvePreview(
      buildRequest({
        report: buildReport({ warnings: ws.map(warning) }),
        // ordem embaralhada + duplicata reconhecida: deve ser tolerado.
        acknowledgedWarningIds: ['w-2', 'w-1', 'w-3', 'w-1'],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.approval.acknowledgedWarningIds).toEqual(['w-1', 'w-2', 'w-3']);
  });

  it('periodo de publicacao ausente: aprova sem exigir coincidencia de periodo', () => {
    // Monta a requisicao SEM a chave publicationPeriod (opcional de fato).
    const base = buildRequest();
    const { publicationPeriod: _omit, ...withoutPeriod } = base;
    void _omit;
    const result = approvePreview(withoutPeriod);
    expect(result.ok).toBe(true);
  });

  it('e puro: nao muta a requisicao nem seus artefatos', () => {
    const report = buildReport({ warnings: [warning('w-1')] });
    const preview = buildPreview();
    const req = buildRequest({ report, preview, acknowledgedWarningIds: ['w-1'] });
    const snapshot = JSON.stringify(req);
    approvePreview(req);
    expect(JSON.stringify(req)).toBe(snapshot);
  });
});

// --------------------------------------------------------------------------
// Rejeicoes: cada condicao de 8.6/8.8/8.9/8.10 fecha a aprovacao
// --------------------------------------------------------------------------

describe('ApprovalService.approvePreview — rejeicoes (8.6/8.8/8.9/8.10)', () => {
  it('rejeita quando a previa nao esta vinculada a revisao atual (8.8/8.10)', () => {
    const result = approvePreview(buildRequest({ currentDraftRevision: OTHER_REVISION }));
    expect(result.ok).toBe(false);
    expect(reasonKinds(result)).toContain('preview-stale-revision');
  });

  it('rejeita quando a previa referencia um rule set diferente do atual (8.10)', () => {
    const result = approvePreview(buildRequest({ currentRuleSetVersion: OTHER_RULESET }));
    expect(result.ok).toBe(false);
    expect(reasonKinds(result)).toContain('preview-stale-ruleset');
  });

  it('rejeita quando o relatorio e de outra revisao que nao a da previa (8.10)', () => {
    const result = approvePreview(
      buildRequest({ report: buildReport({ draftRevision: OTHER_REVISION }) }),
    );
    expect(result.ok).toBe(false);
    // Tambem dispara report-ruleset? nao; so mismatch de revisao do relatorio.
    expect(reasonKinds(result)).toContain('report-revision-mismatch');
  });

  it('rejeita quando o relatorio e de outro rule set que nao o da previa (8.10)', () => {
    const result = approvePreview(
      buildRequest({ report: buildReport({ ruleSetVersion: OTHER_RULESET }) }),
    );
    expect(result.ok).toBe(false);
    expect(reasonKinds(result)).toContain('report-ruleset-mismatch');
  });

  it('rejeita quando a validacao nao foi concluida (8.10)', () => {
    const result = approvePreview(buildRequest({ report: buildReport({ status: 'failed' }) }));
    expect(result.ok).toBe(false);
    expect(reasonKinds(result)).toContain('validation-incomplete');
  });

  it('rejeita quando ha Bloqueios na revisao validada (8.10)', () => {
    const result = approvePreview(
      buildRequest({ report: buildReport({ blocking: [blocking('b-1')] }) }),
    );
    expect(result.ok).toBe(false);
    const has = result.ok ? undefined : result.reasons.find((r) => r.kind === 'has-blocking');
    expect(has).toBeDefined();
    if (has && has.kind === 'has-blocking') expect(has.blockingCount).toBe(1);
  });

  it('rejeita quando NEM todos os avisos foram reconhecidos e lista os pendentes (8.6/8.10)', () => {
    const result = approvePreview(
      buildRequest({
        report: buildReport({ warnings: [warning('w-1'), warning('w-2'), warning('w-3')] }),
        acknowledgedWarningIds: ['w-2'],
      }),
    );
    expect(result.ok).toBe(false);
    const r = result.ok ? undefined : result.reasons.find((x) => x.kind === 'warnings-not-acknowledged');
    expect(r).toBeDefined();
    if (r && r.kind === 'warnings-not-acknowledged') {
      expect(r.missingWarningIds).toEqual(['w-1', 'w-3']);
    }
  });

  it('rejeita quando o periodo de publicacao diverge do periodo da previa (8.9)', () => {
    const result = approvePreview(buildRequest({ publicationPeriod: OTHER_PERIOD }));
    expect(result.ok).toBe(false);
    const r = result.ok ? undefined : result.reasons.find((x) => x.kind === 'period-mismatch');
    expect(r).toBeDefined();
    if (r && r.kind === 'period-mismatch') {
      expect(r.previewPeriod).toBe(PERIOD);
      expect(r.publicationPeriod).toBe(OTHER_PERIOD);
    }
  });

  it('acumula TODAS as condicoes que impedem a aprovacao de uma vez (8.10)', () => {
    const result = approvePreview(
      buildRequest({
        preview: buildPreview({ draftRevision: OTHER_REVISION, ruleSetVersion: OTHER_RULESET }),
        report: buildReport({
          draftRevision: OTHER_REVISION,
          ruleSetVersion: OTHER_RULESET,
          blocking: [blocking('b-1')],
          warnings: [warning('w-1')],
        }),
        currentDraftRevision: REVISION,
        currentRuleSetVersion: RULESET,
        publicationPeriod: OTHER_PERIOD,
        acknowledgedWarningIds: [],
      }),
    );
    expect(result.ok).toBe(false);
    const kinds = reasonKinds(result);
    // previa desatualizada em revisao e rule set, bloqueio, aviso pendente e periodo divergente.
    expect(kinds).toContain('preview-stale-revision');
    expect(kinds).toContain('preview-stale-ruleset');
    expect(kinds).toContain('has-blocking');
    expect(kinds).toContain('warnings-not-acknowledged');
    expect(kinds).toContain('period-mismatch');
  });

  it('um unico aviso pendente mantem a aprovacao fechada mesmo sem Bloqueios', () => {
    const result = approvePreview(
      buildRequest({ report: buildReport({ warnings: [warning('w-1')] }), acknowledgedWarningIds: [] }),
    );
    expect(result.ok).toBe(false);
    expect(reasonKinds(result)).toEqual(['warnings-not-acknowledged']);
  });
});
