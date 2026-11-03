// Testes de componente do painel de previa/diff/aprovacao (tarefa 16.3).
//
// Validacao objetiva: o diff publico e exibido por culto/campo; a aprovacao so
// e liberada apos a ciencia individual de CADA aviso; o resultado/rejeicao
// aparece em portugues. Requisitos: 8.2, 8.4, 8.6-8.11, 14.6.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PreviewDiffPanel, type WarningItem } from './PreviewDiffPanel';
import { SCHEMA_VERSION } from '../../domain/schemas/models';
import type { Preview, ValidationReport } from '../../domain/schemas/models';

const ID = {
  cycle: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  preview: '50505050-5050-4050-8050-505050505050',
  approval: '60606060-6060-4060-8060-606060606060',
  approver: '40404040-4040-4040-8040-404040404040',
  rule: '10101010-1010-4010-8010-101010101010',
  svc: 'f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1',
  w1: '11111111-1111-4111-8111-111111111111',
  w2: '22222222-2222-4222-8222-222222222222',
} as const;
const REVISION = 'a'.repeat(64);
const RULESET = 'v2026-02';

function buildReport(warnings: ValidationReport['warnings'] = []): ValidationReport {
  return {
    schemaVersion: SCHEMA_VERSION,
    reportId: '70707070-7070-4070-8070-707070707070',
    cycleId: ID.cycle,
    draftRevision: REVISION,
    ruleSetVersion: RULESET,
    status: 'complete',
    blocking: [],
    warnings,
    passedCount: 10,
    createdAt: '2026-02-15T00:00:00Z',
  };
}

function buildPreview(): Preview {
  return {
    schemaVersion: SCHEMA_VERSION,
    previewId: ID.preview,
    cycleId: ID.cycle,
    draftRevision: REVISION,
    ruleSetVersion: RULESET,
    period: '2026-02',
    generatedAt: '2026-02-14',
    operatorId: ID.approver,
    publicServices: [],
    diff: [
      { serviceId: ID.svc, field: 'regente', change: 'added', after: 'FULANO' },
      { serviceId: ID.svc, field: 'tema', change: 'changed', before: 'A', after: 'B' },
    ],
  };
}

function warningFinding(id: string) {
  return {
    findingId: id,
    ruleId: ID.rule,
    severity: 'warning' as const,
    serviceId: ID.svc,
    reason: 'preferencia nao atendida',
    requiredAction: 'reconheca o aviso',
  };
}

describe('PreviewDiffPanel (16.3)', () => {
  it('exibe o diff por culto/campo com o tipo de mudanca', () => {
    render(
      <PreviewDiffPanel
        preview={buildPreview()}
        report={buildReport()}
        currentDraftRevision={REVISION}
        currentRuleSetVersion={RULESET}
        warnings={[]}
        approvalId={ID.approval}
        approverId={ID.approver}
        approvedAt="2026-02-15"
      />,
    );
    const diffs = screen.getByLabelText(/lista de diferencas/i);
    expect(diffs).toHaveTextContent(/inclusao/i);
    expect(diffs).toHaveTextContent(/alteracao/i);
  });

  it('bloqueia a aprovacao ate reconhecer cada aviso e entao aprova', () => {
    const onApproved = vi.fn();
    const warnings: WarningItem[] = [
      { id: ID.w1, label: 'Aviso 1' },
      { id: ID.w2, label: 'Aviso 2' },
    ];
    render(
      <PreviewDiffPanel
        preview={buildPreview()}
        report={buildReport([warningFinding(ID.w1), warningFinding(ID.w2)])}
        currentDraftRevision={REVISION}
        currentRuleSetVersion={RULESET}
        warnings={warnings}
        approvalId={ID.approval}
        approverId={ID.approver}
        approvedAt="2026-02-15"
        onApproved={onApproved}
      />,
    );

    const approveBtn = screen.getByRole('button', { name: /aprovar escala/i });
    expect(approveBtn).toBeDisabled();

    fireEvent.click(screen.getByLabelText(/aviso 1/i));
    expect(approveBtn).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/aviso 2/i));
    expect(approveBtn).toBeEnabled();

    fireEvent.click(approveBtn);
    expect(onApproved).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('approval-ok')).toBeInTheDocument();
  });

  it('mostra motivos de rejeicao em portugues quando a previa esta desatualizada', () => {
    render(
      <PreviewDiffPanel
        preview={buildPreview()}
        report={buildReport()}
        currentDraftRevision={'c'.repeat(64)} // revisao diferente => rejeita
        currentRuleSetVersion={RULESET}
        warnings={[]}
        approvalId={ID.approval}
        approverId={ID.approver}
        approvedAt="2026-02-15"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /aprovar escala/i }));
    expect(screen.getByRole('alert')).toHaveTextContent(/previa nao corresponde a revisao atual/i);
  });
});
