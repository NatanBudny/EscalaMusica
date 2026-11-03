// Painel de previa, diff publico e aprovacao consciente (tarefas 10.1-10.2 na
// UI; cobertura de interface da tarefa 16.3).
//
// Objetivo (Requisitos 8.1-8.11, 14.6): apresentar, em portugues e de forma
// acessivel, o diff PUBLICO reversivel da revisao validada contra a vigente
// (inclusoes, alteracoes e remocoes por culto/campo) e exigir ciencia
// INDIVIDUAL de cada aviso antes de registrar a aprovacao. A DECISAO de aprovar
// vive no dominio puro (`approvePreview`); este painel so coleta a ciencia dos
// avisos e exibe o resultado/rejeicoes.

import { useMemo, useState } from 'react';
import { approvePreview, type ApprovalRejectionReason } from '../../domain/approval/approvalService';
import type { Approval, Preview, PreviewDiffEntry, ValidationReport } from '../../domain/schemas/models';

export interface WarningItem {
  readonly id: string;
  readonly label: string;
}

export interface PreviewDiffPanelProps {
  readonly preview: Preview;
  readonly report: ValidationReport;
  readonly currentDraftRevision: string;
  readonly currentRuleSetVersion: string;
  readonly publicationPeriod?: string;
  /** Avisos a reconhecer (derivados do relatorio). */
  readonly warnings: readonly WarningItem[];
  readonly approvalId: string;
  readonly approverId: string;
  readonly approvedAt: string;
  readonly serviceLabel?: (serviceId: string) => string;
  /** Notifica a aprovacao registrada (para avancar o ciclo). */
  readonly onApproved?: (approval: Approval) => void;
}

function changeLabel(change: PreviewDiffEntry['change']): string {
  switch (change) {
    case 'added':
      return 'Inclusao';
    case 'removed':
      return 'Remocao';
    case 'changed':
      return 'Alteracao';
    default:
      return change;
  }
}

function rejectionMessage(reason: ApprovalRejectionReason): string {
  switch (reason.kind) {
    case 'preview-stale-revision':
      return 'A previa nao corresponde a revisao atual da escala. Gere a previa novamente.';
    case 'preview-stale-ruleset':
      return 'A previa usa uma versao de regras diferente da atual. Gere a previa novamente.';
    case 'report-revision-mismatch':
      return 'O relatorio de validacao e de outra revisao. Valide a revisao atual.';
    case 'report-ruleset-mismatch':
      return 'O relatorio de validacao e de outra versao de regras.';
    case 'validation-incomplete':
      return 'A validacao completa da revisao atual ainda nao terminou.';
    case 'has-blocking':
      return `Existem ${reason.blockingCount} bloqueio(s) a resolver antes de aprovar.`;
    case 'warnings-not-acknowledged':
      return `Reconheca cada aviso pendente (${reason.missingWarningIds.length}).`;
    case 'period-mismatch':
      return 'O periodo de publicacao diverge do periodo da previa.';
    default:
      return 'Nao foi possivel aprovar.';
  }
}

export function PreviewDiffPanel(props: PreviewDiffPanelProps): JSX.Element {
  const serviceLabel = props.serviceLabel ?? ((id) => id);
  const [acknowledged, setAcknowledged] = useState<ReadonlySet<string>>(new Set());
  const [result, setResult] = useState<
    | { ok: true; approval: Approval }
    | { ok: false; reasons: readonly ApprovalRejectionReason[] }
    | null
  >(null);

  const allAcknowledged = useMemo(
    () => props.warnings.every((w) => acknowledged.has(w.id)),
    [props.warnings, acknowledged],
  );

  const toggle = (id: string): void => {
    setAcknowledged((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleApprove = (): void => {
    const res = approvePreview({
      preview: props.preview,
      report: props.report,
      currentDraftRevision: props.currentDraftRevision,
      currentRuleSetVersion: props.currentRuleSetVersion,
      ...(props.publicationPeriod !== undefined ? { publicationPeriod: props.publicationPeriod } : {}),
      acknowledgedWarningIds: [...acknowledged],
      approvalId: props.approvalId,
      approverId: props.approverId,
      approvedAt: props.approvedAt,
    });
    setResult(res);
    if (res.ok) props.onApproved?.(res.approval);
  };

  return (
    <section aria-label="Previa e aprovacao">
      <h1>Previa da escala e diferencas</h1>

      <section aria-label="Diferencas em relacao a escala vigente">
        <h2>Diferencas</h2>
        {props.preview.diff.length === 0 ? (
          <p role="note">Nenhuma diferenca em relacao a escala vigente.</p>
        ) : (
          <ul aria-label="Lista de diferencas">
            {props.preview.diff.map((d, i) => (
              <li key={`${d.serviceId}:${d.field}:${i}`} data-change={d.change}>
                <strong>{changeLabel(d.change)}</strong> — {serviceLabel(d.serviceId)} / {d.field}
                {d.change === 'changed' ? (
                  <span>
                    {' '}
                    (de <code>{String(d.before)}</code> para <code>{String(d.after)}</code>)
                  </span>
                ) : d.change === 'added' ? (
                  <span> (novo: <code>{String(d.after)}</code>)</span>
                ) : (
                  <span> (removido: <code>{String(d.before)}</code>)</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Avisos a reconhecer">
        <h2>Avisos</h2>
        {props.warnings.length === 0 ? (
          <p role="note">Nenhum aviso a reconhecer.</p>
        ) : (
          <ul aria-label="Lista de avisos">
            {props.warnings.map((w) => (
              <li key={w.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={acknowledged.has(w.id)}
                    onChange={() => toggle(w.id)}
                  />
                  {w.label}
                </label>
              </li>
            ))}
          </ul>
        )}
      </section>

      <button
        type="button"
        aria-label="Aprovar escala"
        disabled={!allAcknowledged}
        onClick={handleApprove}
      >
        Aprovar
      </button>
      {!allAcknowledged ? (
        <p role="note">Reconheca cada aviso para liberar a aprovacao.</p>
      ) : null}

      {result && result.ok ? (
        <p role="status" data-testid="approval-ok">
          Aprovacao registrada por {result.approval.approverId} em {result.approval.approvedAt}.
        </p>
      ) : null}
      {result && !result.ok ? (
        <ul role="alert" aria-label="Motivos que impedem a aprovacao">
          {result.reasons.map((r, i) => (
            <li key={i}>{rejectionMessage(r)}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
