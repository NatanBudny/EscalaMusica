// Testes de componente do painel de sincronizacao/conciliacao (tarefa 16.3).
//
// Validacao objetiva: estado de autenticacao exibido (sem token); retomada
// offline com fila; conflito exige escolha explicita (sem sobrescrita
// automatica); envio bloqueado sem autenticacao. Requisitos: 1.10, 11.6-11.12,
// 12.3, 13.13-13.16.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SyncConflictPanel } from './SyncConflictPanel';
import type { QueuedOperation, ReconcileResult } from '../../domain/git/reconcile';

const OP: QueuedOperation = {
  operationId: 'op-1',
  baseCommit: 'abcdef1234567890',
  command: 'incluir-atribuicao',
  resultHash: 'h1',
  at: '2026-02-10T00:00:00Z',
};

describe('SyncConflictPanel (16.3)', () => {
  it('exibe o estado de autenticacao sem jamais mostrar um token', () => {
    const { container } = render(
      <SyncConflictPanel authState="authenticated" queue={[]} remoteHead="abcdef1234567890" />,
    );
    expect(screen.getByLabelText(/autenticacao/i)).toHaveAttribute('data-auth', 'authenticated');
    // Nenhum valor de token aparece no DOM.
    expect(container.textContent).not.toMatch(/ghp_|token-[a-z0-9]{8}/i);
  });

  it('com HEAD igual, permite enviar a fila quando autenticado', () => {
    const onPush = vi.fn();
    render(
      <SyncConflictPanel
        authState="authenticated"
        queue={[OP]}
        remoteHead={OP.baseCommit}
        onPush={onPush}
      />,
    );
    const sendBtn = screen.getByRole('button', { name: /enviar alteracoes/i });
    expect(sendBtn).toBeEnabled();
    fireEvent.click(sendBtn);
    expect(onPush).toHaveBeenCalledWith([OP]);
  });

  it('bloqueia o envio quando a credencial expirou', () => {
    render(<SyncConflictPanel authState="expired" queue={[OP]} remoteHead={OP.baseCommit} />);
    expect(screen.getByRole('button', { name: /enviar alteracoes/i })).toBeDisabled();
    expect(screen.getByLabelText(/autenticacao/i)).toHaveTextContent(/expirou/i);
  });

  it('com HEAD divergente, exige conciliacao antes de enviar', () => {
    render(<SyncConflictPanel authState="authenticated" queue={[OP]} remoteHead="outro-head-9999" />);
    expect(screen.getByRole('alert')).toHaveTextContent(/servidor mudou/i);
    expect(screen.queryByRole('button', { name: /enviar alteracoes/i })).toBeNull();
  });

  it('conflito exige escolha explicita e so resolve apos escolher (sem sobrescrita automatica)', () => {
    const onResolved = vi.fn();
    const reconcile: ReconcileResult = {
      autoMerged: [],
      conflicts: [
        {
          type: 'same-field',
          entityId: 'pessoa-1',
          field: 'telefone',
          local: { entityId: 'pessoa-1', field: 'telefone', change: 'set', value: 'A' },
          remote: { entityId: 'pessoa-1', field: 'telefone', change: 'set', value: 'B' },
        },
      ],
      requiresOperatorChoice: true,
    };
    render(
      <SyncConflictPanel
        authState="authenticated"
        queue={[OP]}
        remoteHead="outro-head-9999"
        reconcile={reconcile}
        onResolved={onResolved}
      />,
    );

    const applyBtn = screen.getByRole('button', { name: /aplicar escolhas/i });
    expect(applyBtn).toBeDisabled();
    // Nada e resolvido automaticamente.
    expect(onResolved).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText(/do servidor/i));
    expect(applyBtn).toBeEnabled();
    fireEvent.click(applyBtn);
    expect(onResolved).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('reconcile-resolved')).toHaveTextContent(/1 alteracao/i);
  });
});
