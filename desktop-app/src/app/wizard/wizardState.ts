// Logica das sete etapas do assistente de ciclo (tarefa 16.1).
//
// Objetivo (Requisitos 1.1-1.8, 1.11, 10.1, 10.23; design.md "Fluxo mensal na
// interface"): o ciclo completo e operado pelo assistente horizontal fixo. Cada
// etapa tem status, pendencias e ajuda contextual ("O que fazer agora?"). O
// avanco depende do estado derivado (nunca de JSON, Markdown, IA ou terminal).
//
// Este modulo e TypeScript PURO: a maquina de estados das etapas, as pendencias
// derivadas e a ajuda contextual. O componente React (CycleWizard.tsx) apenas
// renderiza este estado. Espelha os sete estagios do modelo de dominio
// (`CycleStage`).

import type { CycleStage } from '../../domain/schemas/models';

/** As sete etapas, na ordem fixa do assistente. */
export const WIZARD_STAGES: readonly CycleStage[] = [
  'opening',
  'collection',
  'assembly',
  'validation',
  'approval',
  'publication',
  'closing',
];

/** Rotulo em portugues de cada etapa (para a UI). */
export const STAGE_LABELS: Readonly<Record<CycleStage, string>> = {
  opening: 'Abertura',
  collection: 'Coleta',
  assembly: 'Montagem',
  validation: 'Validacao',
  approval: 'Aprovacao',
  publication: 'Publicacao',
  closing: 'Fechamento',
};

/** Ajuda contextual "O que fazer agora?" por etapa (requisito 1.8). */
export const STAGE_HELP: Readonly<Record<CycleStage, string>> = {
  opening: 'Escolha o mes e confira as quartas, sabados e domingos gerados; inclua cultos extraordinarios se necessario.',
  collection: 'Lance ancião, pregador, sonoplastia, musicas, tema e indisponibilidades recebidas.',
  assembly: 'Monte a escala por culto; use a sugestao como apoio e ajuste manualmente quando precisar.',
  validation: 'Rode a validacao completa e resolva cada bloqueio antes de avancar.',
  approval: 'Revise a previa e as diferencas; registre ciencia de cada aviso e aprove.',
  publication: 'Publique o pacote aprovado e aguarde a verificacao do site publico.',
  closing: 'Confirme o fechamento: links de confirmacao e rotacao sao atualizados a partir da escala publicada.',
};

/** Indice ordinal de uma etapa. */
export function stageIndex(stage: CycleStage): number {
  return WIZARD_STAGES.indexOf(stage);
}

/** Status de uma etapa no assistente. */
export type StageStatus = 'done' | 'current' | 'blocked' | 'upcoming';

/**
 * Entrada para derivar o estado do assistente: a etapa atual e, por etapa, se
 * suas pre-condicoes de conclusao estao satisfeitas (fornecidas pelos servicos
 * de dominio ja implementados).
 */
export interface WizardInput {
  readonly currentStage: CycleStage;
  /**
   * Pendencias por etapa: lista de pendencias bloqueantes. Uma etapa so pode
   * ser concluida quando sua lista esta vazia.
   */
  readonly pendingByStage: Readonly<Partial<Record<CycleStage, readonly string[]>>>;
}

export interface StageView {
  readonly stage: CycleStage;
  readonly label: string;
  readonly status: StageStatus;
  readonly help: string;
  readonly pending: readonly string[];
}

export interface WizardView {
  readonly stages: readonly StageView[];
  readonly currentStage: CycleStage;
  /** `true` quando a etapa atual nao tem pendencias (pode avancar). */
  readonly canAdvance: boolean;
  /** Proxima etapa, ou `undefined` quando ja esta no fechamento. */
  readonly nextStage?: CycleStage;
}

/**
 * Deriva a visao do assistente a partir do estado. Etapas anteriores a atual
 * sao `done`; a atual e `current` (ou `blocked` se tiver pendencias); as demais
 * sao `upcoming`. O avanco so e permitido quando a etapa atual nao tem
 * pendencias (1.4, 1.5). Puro e deterministico.
 */
export function deriveWizard(input: WizardInput): WizardView {
  const curIdx = stageIndex(input.currentStage);
  const currentPending = input.pendingByStage[input.currentStage] ?? [];

  const stages: StageView[] = WIZARD_STAGES.map((stage, idx) => {
    const pending = input.pendingByStage[stage] ?? [];
    let status: StageStatus;
    if (idx < curIdx) status = 'done';
    else if (idx > curIdx) status = 'upcoming';
    else status = pending.length > 0 ? 'blocked' : 'current';
    return { stage, label: STAGE_LABELS[stage], status, help: STAGE_HELP[stage], pending: [...pending] };
  });

  const canAdvance = currentPending.length === 0 && curIdx < WIZARD_STAGES.length - 1;
  const next = WIZARD_STAGES[curIdx + 1];

  return {
    stages,
    currentStage: input.currentStage,
    canAdvance,
    ...(canAdvance && next !== undefined ? { nextStage: next } : {}),
  };
}

/**
 * Avanca para a proxima etapa SE e somente se a atual nao tem pendencias. Puro:
 * devolve a nova etapa ou a mesma quando bloqueado.
 */
export function advanceStage(input: WizardInput): CycleStage {
  const view = deriveWizard(input);
  return view.nextStage ?? input.currentStage;
}
