// Painel de sincronizacao, conciliacao e autenticacao (cobertura de interface
// da tarefa 16.3; Requisitos 1.10, 11.6-11.12, 12.3, 13.13-13.16).
//
// Objetivo: tornar operaveis pela interface o estado de autenticacao (sem jamais
// exibir o token), a retomada offline (fila de operacoes) e a conciliacao
// guiada (conflitos exigem ESCOLHA EXPLICITA; nunca ha sobrescrita automatica).
//
// A DECISAO vive no dominio puro (`reconcile.ts`): aqui so coletamos as escolhas
// do operador e exibimos o plano. O token NUNCA chega a este componente.

import { useMemo, useState } from 'react';
import {
  applyChoices,
  conflictId,
  planSync,
  type ConflictChoice,
  type FieldChange,
  type QueuedOperation,
  type ReconcileConflict,
  type ReconcileResult,
} from '../../domain/git/reconcile';

export type AuthState = 'authenticated' | 'unauthenticated' | 'expired';

export interface SyncConflictPanelProps {
  readonly authState: AuthState;
  /** Fila de operacoes offline aguardando envio. */
  readonly queue: readonly QueuedOperation[];
  /** HEAD remoto observado na reconexao. */
  readonly remoteHead: string;
  /** Resultado de conciliacao ja calculado (quando o HEAD remoto mudou). */
  readonly reconcile?: ReconcileResult;
  /** Notifica o conjunto final de mudancas apos as escolhas (sem conflito pendente). */
  readonly onResolved?: (changes: readonly FieldChange[]) => void;
  /** Dispara o envio quando o plano e `replay-and-push` e ha autenticacao. */
  readonly onPush?: (operations: readonly QueuedOperation[]) => void;
}

function authLabel(state: AuthState): string {
  switch (state) {
    case 'authenticated':
      return 'Conectado ao GitHub (sua credencial fica guardada no cofre do sistema).';
    case 'expired':
      return 'Sua credencial expirou. Entre novamente para poder publicar.';
    case 'unauthenticated':
    default:
      return 'Voce ainda nao entrou no GitHub. Entre para habilitar o envio.';
  }
}

function conflictLabel(c: ReconcileConflict): string {
  switch (c.type) {
    case 'same-field':
      return `Mesmo campo alterado nas duas maquinas: ${c.entityId} / ${c.field}.`;
    case 'delete-vs-modify':
      return `Exclusao em uma maquina e alteracao na outra: ${c.entityId} / ${c.field}.`;
    case 'special':
      return `Divergencia em "${c.kind}": local (${c.localRef}) vs remoto (${c.remoteRef}).`;
    default:
      return 'Conflito.';
  }
}

export function SyncConflictPanel(props: SyncConflictPanelProps): JSX.Element {
  const canPush = props.authState === 'authenticated';

  const plan = useMemo(() => planSync(props.queue, props.remoteHead), [props.queue, props.remoteHead]);

  const [choices, setChoices] = useState<ReadonlyMap<string, ConflictChoice>>(new Map());
  const [resolved, setResolved] = useState<readonly FieldChange[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Conflitos que exigem escolha (ignoramos 'special', resolvido fora).
  const choosable = useMemo<ReconcileConflict[]>(
    () => (props.reconcile ? props.reconcile.conflicts.filter((c) => c.type !== 'special') : []),
    [props.reconcile],
  );

  const allChosen = choosable.every((c) => choices.has(conflictId(c)));

  const setChoice = (id: string, choice: ConflictChoice): void => {
    setChoices((prev) => {
      const next = new Map(prev);
      next.set(id, choice);
      return next;
    });
  };

  const handleResolve = (): void => {
    if (!props.reconcile) return;
    try {
      const out = applyChoices(props.reconcile, choices);
      setResolved(out);
      setError(null);
      props.onResolved?.(out);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <section aria-label="Sincronizacao e conciliacao">
      <h1>Sincronizacao</h1>

      <div role="status" aria-label="Autenticacao" data-auth={props.authState}>
        {authLabel(props.authState)}
      </div>

      <section aria-label="Fila offline">
        <h2>Alteracoes na fila</h2>
        {props.queue.length === 0 ? (
          <p role="note">Nenhuma alteracao pendente.</p>
        ) : (
          <>
            <ul aria-label="Operacoes enfileiradas">
              {props.queue.map((op) => (
                <li key={op.operationId}>
                  {op.command} (base {op.baseCommit.slice(0, 7)})
                </li>
              ))}
            </ul>
            {plan.action === 'replay-and-push' ? (
              <>
                <p role="note">O servidor nao mudou: suas alteracoes podem ser enviadas.</p>
                <button
                  type="button"
                  disabled={!canPush}
                  onClick={() => props.onPush?.(plan.operations)}
                >
                  Enviar alteracoes
                </button>
                {!canPush ? <p role="note">Entre no GitHub para enviar.</p> : null}
              </>
            ) : plan.action === 'reconcile' ? (
              <p role="alert">
                O servidor mudou desde a sua ultima conexao. Resolva a conciliacao antes de enviar.
              </p>
            ) : null}
          </>
        )}
      </section>

      {props.reconcile ? (
        <section aria-label="Conciliacao entre maquinas">
          <h2>Conciliacao</h2>
          {props.reconcile.autoMerged.length > 0 ? (
            <p role="note">
              {props.reconcile.autoMerged.length} alteracao(oes) em campos distintos foram
              combinadas automaticamente (confira abaixo).
            </p>
          ) : null}

          {choosable.length === 0 ? (
            <p role="note">Nao ha conflitos que exijam a sua escolha.</p>
          ) : (
            <ul aria-label="Conflitos">
              {choosable.map((c) => {
                const id = conflictId(c);
                return (
                  <li key={id}>
                    <span>{conflictLabel(c)}</span>
                    <fieldset>
                      <legend>Escolha qual versao manter</legend>
                      <label>
                        <input
                          type="radio"
                          name={id}
                          checked={choices.get(id) === 'local'}
                          onChange={() => setChoice(id, 'local')}
                        />
                        Desta maquina
                      </label>
                      <label>
                        <input
                          type="radio"
                          name={id}
                          checked={choices.get(id) === 'remote'}
                          onChange={() => setChoice(id, 'remote')}
                        />
                        Do servidor
                      </label>
                    </fieldset>
                  </li>
                );
              })}
            </ul>
          )}

          <button
            type="button"
            aria-label="Aplicar escolhas da conciliacao"
            disabled={!allChosen}
            onClick={handleResolve}
          >
            Aplicar escolhas
          </button>
          {!allChosen ? (
            <p role="note">Escolha uma versao para cada conflito antes de continuar.</p>
          ) : null}

          {error ? <p role="alert">{error}</p> : null}
          {resolved ? (
            <p role="status" data-testid="reconcile-resolved">
              Conciliacao resolvida: {resolved.length} alteracao(oes) finais.
            </p>
          ) : null}
        </section>
      ) : null}
    </section>
  );
}
