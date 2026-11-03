// Shell da aplicacao que integra o assistente das sete etapas aos servicos
// concluidos (tarefa 16.1).
//
// Objetivo (Requisitos 1.1-1.8, 1.11, 10.1, 10.23): o ciclo completo e operado
// SOMENTE pelos controles da aplicacao — sem JSON, Markdown, IA, terminal ou
// conhecimento do repositorio. Este componente:
//   - exibe o `CycleWizard` com as pendencias DERIVADAS do progresso real
//     (`derivePendingByStage`);
//   - mostra o estado online/offline e de sincronizacao (`deriveSyncStatus`);
//   - renderiza o painel da ETAPA ATUAL com a area correspondente
//     (cadastro/coleta/montagem/validacao/aprovacao/publicacao/fechamento);
//   - mantem o avanco bloqueado enquanto houver pendencias.
//
// A DECISAO de quais pendencias existem vive no modulo puro `cycleAppState.ts`;
// aqui so montamos a UI em portugues e acessivel (roles/aria).

import { useMemo, useState } from 'react';
import type { CycleStage } from '../../domain/schemas/models';
import { CycleWizard } from './CycleWizard';
import { STAGE_LABELS } from './wizardState';
import {
  type Connectivity,
  type CycleProgress,
  derivePendingByStage,
  deriveSyncStatus,
} from './cycleAppState';

export interface CycleAppProps {
  /** Etapa inicial do assistente (default: abertura). */
  readonly initialStage?: CycleStage;
  /** Progresso corrente de cada etapa (derivado dos snapshots dos servicos). */
  readonly progress: CycleProgress;
  /** Conectividade atual (online/offline). */
  readonly connectivity?: Connectivity;
  /** Operacoes offline enfileiradas aguardando envio. */
  readonly queuedOperations?: number;
  /** Conflitos de conciliacao aguardando escolha explicita. */
  readonly pendingConflicts?: number;
  /**
   * Renderiza o painel de uma etapa (cadastro, coleta, etc.). Mantem o shell
   * agnostico das areas e permite testar a navegacao isoladamente.
   */
  readonly renderStagePanel?: (stage: CycleStage) => JSX.Element | null;
  /** Observa mudancas de etapa (ex.: para persistir o estado do ciclo). */
  readonly onStageChange?: (stage: CycleStage) => void;
}

/**
 * Banner que resume a conectividade e a sincronizacao (sempre visivel no topo
 * do assistente), em portugues.
 */
function SyncBanner(props: {
  connectivity: Connectivity;
  queuedOperations: number;
  pendingConflicts: number;
}): JSX.Element {
  const status = useMemo(
    () =>
      deriveSyncStatus({
        connectivity: props.connectivity,
        queuedOperations: props.queuedOperations,
        pendingConflicts: props.pendingConflicts,
      }),
    [props.connectivity, props.queuedOperations, props.pendingConflicts],
  );
  return (
    <div role="status" aria-label="Estado de conexao e sincronizacao" data-connectivity={status.connectivity}>
      <span>{status.label}</span>
    </div>
  );
}

export function CycleApp(props: CycleAppProps): JSX.Element {
  const connectivity = props.connectivity ?? 'online';
  const queuedOperations = props.queuedOperations ?? 0;
  const pendingConflicts = props.pendingConflicts ?? 0;

  const [stage, setStage] = useState<CycleStage>(props.initialStage ?? 'opening');

  const pendingByStage = useMemo(
    () => derivePendingByStage(props.progress, connectivity),
    [props.progress, connectivity],
  );

  const handleAdvance = (next: CycleStage): void => {
    setStage(next);
    props.onStageChange?.(next);
  };

  const panel = props.renderStagePanel?.(stage) ?? null;

  return (
    <main aria-label="Gestao Leiga de Escalas">
      <h1>Gestao Leiga de Escalas</h1>

      <SyncBanner
        connectivity={connectivity}
        queuedOperations={queuedOperations}
        pendingConflicts={pendingConflicts}
      />

      <CycleWizard input={{ currentStage: stage, pendingByStage }} onAdvance={handleAdvance} />

      <section aria-label={`Painel da etapa: ${STAGE_LABELS[stage]}`}>{panel}</section>
    </main>
  );
}
