// Orquestracao pura do fluxo completo das sete etapas (tarefa 16.1).
//
// Objetivo (Requisitos 1.1-1.8, 1.11, 10.1, 10.23; design.md "Fluxo mensal na
// interface"): o ciclo completo e operado pelo assistente. Cada etapa tem
// pendencias DERIVADAS do estado real dos servicos de dominio (ciclo, coleta,
// montagem, validacao, aprovacao, publicacao, fechamento) e do estado de
// conectividade (online/offline) e de sincronizacao.
//
// Este modulo e TypeScript PURO: dado um retrato do progresso de cada etapa,
// ele deriva, de forma deterministica, as pendencias bloqueantes por etapa que
// o `CycleWizard` consome (`WizardInput.pendingByStage`). A UI (CycleApp.tsx)
// apenas rende este estado e dispara as acoes dos servicos ja implementados.
//
// A derivacao NUNCA habilita o avanco quando falta uma pre-condicao, e a
// publicacao real permanece sob o feature gate (gate.ts) — aqui so modelamos a
// navegacao entre etapas do assistente, nunca o corte.

import type { CycleStage } from '../../domain/schemas/models';
import { WIZARD_STAGES } from './wizardState';

/** Conectividade atual. Etapas que exigem rede ficam bloqueadas offline. */
export type Connectivity = 'online' | 'offline';

/**
 * Retrato do progresso de cada etapa, alimentado pelos servicos de dominio.
 * Cada campo e um booleano/contador SIMPLES para manter a derivacao pura e
 * testavel; a UI preenche a partir dos snapshots dos servicos.
 */
export interface CycleProgress {
  /** Abertura: mes escolhido e calendario (quartas/sabados/domingos) gerado. */
  readonly monthChosen: boolean;
  readonly calendarGenerated: boolean;

  /** Coleta: insumos externos minimos lancados e indisponibilidades conferidas. */
  readonly requiredInputsCount: number;
  readonly providedInputsCount: number;
  readonly unavailabilityReviewed: boolean;
  /** Importacoes pendentes (nomes ambiguos) que impedem avanco (4.12-4.14). */
  readonly pendingImports: number;

  /** Montagem: numero de celulas obrigatorias ainda nao preenchidas. */
  readonly unfilledRequiredCells: number;

  /** Validacao: a revisao atual foi validada por completo e sem bloqueios. */
  readonly validationComplete: boolean;
  readonly validationStale: boolean;
  readonly blockingFindings: number;

  /** Aprovacao: previa gerada, todos os avisos reconhecidos e aprovacao registrada. */
  readonly previewGenerated: boolean;
  readonly unacknowledgedWarnings: number;
  readonly approvalRegistered: boolean;

  /** Publicacao: pacote publicado e verificado no site publico (igualdade integral). */
  readonly packagePublished: boolean;
  readonly publicSiteVerified: boolean;

  /** Fechamento: confirmacao do fechamento (links/rotacao atualizados). */
  readonly closingConfirmed: boolean;

  /** Conciliacao pendente (conflitos sem escolha) bloqueia qualquer avanco. */
  readonly unresolvedReconcileConflicts: number;
}

/** Etapas que exigem conectividade online para serem concluidas (16.1). */
export const ONLINE_REQUIRED_STAGES: readonly CycleStage[] = ['publication'];

/**
 * Deriva as pendencias bloqueantes por etapa a partir do progresso e da
 * conectividade. Retorna um mapa pronto para `WizardInput.pendingByStage`.
 *
 * Regras (todas em portugues, voltadas ao operador leigo):
 *  - uma pendencia de conciliacao nao resolvida bloqueia TODAS as etapas;
 *  - etapas que exigem rede ficam bloqueadas quando offline;
 *  - cada etapa so fica sem pendencias quando suas pre-condicoes estao
 *    satisfeitas.
 */
export function derivePendingByStage(
  progress: CycleProgress,
  connectivity: Connectivity,
): Record<CycleStage, string[]> {
  const pending: Record<CycleStage, string[]> = {
    opening: [],
    collection: [],
    assembly: [],
    validation: [],
    approval: [],
    publication: [],
    closing: [],
  };

  // Abertura.
  if (!progress.monthChosen) pending.opening.push('Escolha o mes do ciclo.');
  if (!progress.calendarGenerated) {
    pending.opening.push('Gere o calendario de quartas, sabados e domingos.');
  }

  // Coleta.
  if (progress.providedInputsCount < progress.requiredInputsCount) {
    const faltam = progress.requiredInputsCount - progress.providedInputsCount;
    pending.collection.push(`Lance os insumos obrigatorios restantes (${faltam}).`);
  }
  if (progress.pendingImports > 0) {
    pending.collection.push(
      `Resolva as importacoes pendentes de identidade (${progress.pendingImports}).`,
    );
  }
  if (!progress.unavailabilityReviewed) {
    pending.collection.push('Confira as indisponibilidades recebidas.');
  }

  // Montagem.
  if (progress.unfilledRequiredCells > 0) {
    pending.assembly.push(
      `Preencha as atribuicoes obrigatorias restantes (${progress.unfilledRequiredCells}).`,
    );
  }

  // Validacao.
  if (!progress.validationComplete || progress.validationStale) {
    pending.validation.push('Execute a validacao completa da revisao atual.');
  }
  if (progress.blockingFindings > 0) {
    pending.validation.push(`Resolva os bloqueios da validacao (${progress.blockingFindings}).`);
  }

  // Aprovacao.
  if (!progress.previewGenerated) pending.approval.push('Gere a previa da escala validada.');
  if (progress.unacknowledgedWarnings > 0) {
    pending.approval.push(
      `Registre ciencia de cada aviso pendente (${progress.unacknowledgedWarnings}).`,
    );
  }
  if (!progress.approvalRegistered) pending.approval.push('Registre a aprovacao.');

  // Publicacao.
  if (connectivity === 'offline') {
    pending.publication.push('Conecte-se a internet para publicar.');
  }
  if (!progress.packagePublished) pending.publication.push('Publique o pacote aprovado.');
  if (!progress.publicSiteVerified) {
    pending.publication.push('Aguarde a verificacao de igualdade no site publico.');
  }

  // Fechamento.
  if (!progress.closingConfirmed) {
    pending.closing.push('Confirme o fechamento (links e rotacao).');
  }

  // Conciliacao pendente bloqueia tudo (13.15): nenhum avanco automatico.
  if (progress.unresolvedReconcileConflicts > 0) {
    const msg = `Resolva a conciliacao entre maquinas (${progress.unresolvedReconcileConflicts} conflito(s)).`;
    for (const stage of WIZARD_STAGES) pending[stage].unshift(msg);
  }

  return pending;
}

/** `true` quando a etapa informada exige conectividade online. */
export function stageRequiresOnline(stage: CycleStage): boolean {
  return ONLINE_REQUIRED_STAGES.includes(stage);
}

/**
 * Resumo legivel do estado de sincronizacao para a barra do assistente. Puro.
 */
export interface SyncStatusView {
  readonly connectivity: Connectivity;
  readonly label: string;
  /** Operacoes offline enfileiradas aguardando envio. */
  readonly queuedOperations: number;
  /** Conflitos de conciliacao aguardando escolha explicita. */
  readonly pendingConflicts: number;
}

export function deriveSyncStatus(params: {
  readonly connectivity: Connectivity;
  readonly queuedOperations: number;
  readonly pendingConflicts: number;
}): SyncStatusView {
  const { connectivity, queuedOperations, pendingConflicts } = params;
  let label: string;
  if (connectivity === 'offline') {
    label =
      queuedOperations > 0
        ? `Offline — ${queuedOperations} alteracao(oes) na fila para enviar.`
        : 'Offline — as alteracoes serao enviadas ao reconectar.';
  } else if (pendingConflicts > 0) {
    label = `Online — ${pendingConflicts} conflito(s) de conciliacao aguardando sua escolha.`;
  } else if (queuedOperations > 0) {
    label = `Online — enviando ${queuedOperations} alteracao(oes) da fila.`;
  } else {
    label = 'Online — sincronizado.';
  }
  return { connectivity, label, queuedOperations, pendingConflicts };
}
