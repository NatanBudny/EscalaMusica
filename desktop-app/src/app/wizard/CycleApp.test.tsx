// Testes de integracao do shell CycleApp (tarefas 16.1, 16.3).
//
// Validacao objetiva: o ciclo e operavel SOMENTE pelos controles; o banner de
// conexao aparece em portugues; o avanco so ocorre sem pendencias; o painel da
// etapa atual e renderizado. Requisitos: 1.1-1.8, 1.11, 10.1, 10.23.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CycleApp } from './CycleApp';
import type { CycleProgress } from './cycleAppState';

const DONE: CycleProgress = {
  monthChosen: true,
  calendarGenerated: true,
  requiredInputsCount: 1,
  providedInputsCount: 1,
  unavailabilityReviewed: true,
  pendingImports: 0,
  unfilledRequiredCells: 0,
  validationComplete: true,
  validationStale: false,
  blockingFindings: 0,
  previewGenerated: true,
  unacknowledgedWarnings: 0,
  approvalRegistered: true,
  packagePublished: true,
  publicSiteVerified: true,
  closingConfirmed: true,
  unresolvedReconcileConflicts: 0,
};

const EMPTY: CycleProgress = { ...DONE, monthChosen: false, calendarGenerated: false };

describe('CycleApp (shell integrado)', () => {
  it('exibe o banner de conexao online', () => {
    render(<CycleApp progress={DONE} connectivity="online" />);
    const banner = screen.getByLabelText(/estado de conexao/i);
    expect(banner).toHaveAttribute('data-connectivity', 'online');
    expect(banner).toHaveTextContent(/sincronizado/i);
  });

  it('exibe o banner offline com a fila de alteracoes', () => {
    render(<CycleApp progress={DONE} connectivity="offline" queuedOperations={3} />);
    const banner = screen.getByLabelText(/estado de conexao/i);
    expect(banner).toHaveAttribute('data-connectivity', 'offline');
    expect(banner).toHaveTextContent(/3/);
  });

  it('renderiza o painel da etapa atual', () => {
    render(
      <CycleApp
        progress={DONE}
        initialStage="opening"
        renderStagePanel={(s) => <p>Painel de {s}</p>}
      />,
    );
    expect(screen.getByText(/painel de opening/i)).toBeInTheDocument();
  });

  it('avanca de etapa pelos controles quando nao ha pendencias e troca o painel', () => {
    const onStageChange = vi.fn();
    render(
      <CycleApp
        progress={DONE}
        initialStage="opening"
        onStageChange={onStageChange}
        renderStagePanel={(s) => <p>Painel de {s}</p>}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /avancar etapa/i }));
    expect(onStageChange).toHaveBeenCalledWith('collection');
    expect(screen.getByText(/painel de collection/i)).toBeInTheDocument();
  });

  it('bloqueia o avanco quando a etapa atual tem pendencias', () => {
    render(<CycleApp progress={EMPTY} initialStage="opening" />);
    expect(screen.getByRole('button', { name: /avancar etapa/i })).toBeDisabled();
    // As pendencias aparecem como alertas em portugues.
    expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
  });
});
