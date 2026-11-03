// Roteiro de treinamento versionado e checklist de homologacao humana
// (tarefa 17.4).
//
// Objetivo (Requisitos 13.12, 15.11-15.16): o conteudo do treinamento e um
// roteiro tipado e versionado, com dados ficticios, o "o que voce deve ver" em
// cada passo e a vinculacao de cada passo a um CONTROLE/TELA concreto da
// interface. Inclui tambem o checklist de homologacao humana (backup em outra
// instalacao, restauracao e criterios de execucao sem ajuda tecnica).
//
// TypeScript puro, sem I/O. A ajuda/README e GERADA deste mesmo roteiro, de modo
// que passo e controle permanecam sincronizados (lint vincula cada passo a um
// controle/tela).

import type { CycleStage } from '../../domain/schemas/models';
import { WIZARD_STAGES, STAGE_LABELS } from '../wizard/wizardState';

/** Versao do roteiro de treinamento. */
export const TRAINING_SCRIPT_VERSION = '1.0.0';

/** Um passo do roteiro, vinculado a um controle/tela observavel. */
export interface TrainingStep {
  /** Etapa do ciclo a que o passo pertence (ou 'restore'/'complete'). */
  readonly stage: CycleStage | 'restore' | 'complete';
  /** Rotulo do passo em portugues. */
  readonly title: string;
  /** Acao que o operador executa. */
  readonly action: string;
  /** Controle/tela concreto acionado (vinculacao exigida pelo lint). */
  readonly control: string;
  /** "O que voce deve ver" apos a acao. */
  readonly expectation: string;
}

/** Roteiro completo da "Escala Simulada", em ordem. */
export const TRAINING_SCRIPT: readonly TrainingStep[] = [
  {
    stage: 'opening',
    title: 'Abrir o mes ficticio',
    action: 'Escolha o mes ficticio e confira o calendario gerado.',
    control: 'Assistente do ciclo mensal > Etapa Abertura',
    expectation: 'As quartas, sabados e domingos do mes aparecem na lista.',
  },
  {
    stage: 'collection',
    title: 'Lancar insumos ficticios',
    action: 'Lance anciao, pregador e uma indisponibilidade de teste.',
    control: 'Coleta de insumos externos > grades + conferencia',
    expectation: 'O resumo de conferencia aparece antes de salvar.',
  },
  {
    stage: 'assembly',
    title: 'Montar com apoio da sugestao',
    action: 'Monte a escala usando a sugestao e ajuste uma celula manualmente.',
    control: 'Montagem da escala > grade de montagem',
    expectation: 'Cada celula mostra os candidatos e o status de atribuicao.',
  },
  {
    stage: 'validation',
    title: 'Validar a escala',
    action: 'Rode a validacao completa e resolva um bloqueio de teste.',
    control: 'Validacao > botao "Validar escala completa"',
    expectation: 'Os totais de bloqueios/avisos/aprovadas aparecem.',
  },
  {
    stage: 'approval',
    title: 'Revisar a previa e aprovar',
    action: 'Revise as diferencas e registre ciencia de cada aviso.',
    control: 'Previa e aprovacao > lista de diferencas + caixas de aviso',
    expectation: 'O botao Aprovar so habilita apos reconhecer os avisos.',
  },
  {
    stage: 'publication',
    title: 'Publicar de forma simulada',
    action: 'Publique o pacote aprovado no destino simulado.',
    control: 'Modo de treinamento > botao "Publicar (simulado)"',
    expectation: 'A publicacao simulada e registrada; nada vai a rede real.',
  },
  {
    stage: 'closing',
    title: 'Fechar o mes',
    action: 'Confirme o fechamento do mes ficticio.',
    control: 'Assistente do ciclo mensal > Etapa Fechamento',
    expectation: 'Links e rotacao ficticios aparecem como atualizados.',
  },
  {
    stage: 'restore',
    title: 'Ensaiar a restauracao',
    action: 'Restaure o backup de treino em outra instalacao de teste.',
    control: 'Modo de treinamento > botao "Restaurar (ensaio)"',
    expectation: 'A restauracao de treino e registrada no percurso.',
  },
  {
    stage: 'complete',
    title: 'Concluir o treinamento',
    action: 'Conclua o treinamento e verifique o isolamento.',
    control: 'Modo de treinamento > botao "Concluir treinamento"',
    expectation: 'A mensagem confirma que os dados reais ficaram inalterados.',
  },
];

/** Um item do checklist de homologacao humana. */
export interface HomologationChecklistItem {
  readonly id: string;
  readonly criterion: string;
  /** Controle/tela ou evidencia que comprova o item. */
  readonly evidence: string;
}

/** Checklist de homologacao humana (13.12, 15.15, 15.16). */
export const HOMOLOGATION_CHECKLIST: readonly HomologationChecklistItem[] = [
  {
    id: 'percurso-sem-ajuda',
    criterion: 'O novo operador concluiu a Escala Simulada sozinho, sem ajuda tecnica.',
    evidence: 'Registro do modo de treinamento com todas as etapas cobertas.',
  },
  {
    id: 'backup-outra-instalacao',
    criterion: 'Foi feito um backup e restaurado em outra instalacao limpa.',
    evidence: 'Modo de treinamento > ensaio de restauracao + verificacao de integridade.',
  },
  {
    id: 'isolamento',
    criterion: 'Os dados reais permaneceram inalterados durante todo o exercicio.',
    evidence: 'Verificacao de isolamento (hashes iguais no inicio e no fim).',
  },
  {
    id: 'sem-terminal',
    criterion: 'Nenhum passo exigiu terminal, edicao de JSON/Markdown ou IA.',
    evidence: 'Roteiro de treinamento (cada passo vinculado a um controle/tela).',
  },
];

/** Passos cujo controle/tela nao esta preenchido (deve ser sempre vazio). */
export function stepsWithoutControl(): readonly TrainingStep[] {
  return TRAINING_SCRIPT.filter((s) => s.control.trim().length === 0);
}

/** Etapas do roteiro que faltam cobrir (sete etapas + restore + complete). */
export function missingScriptStages(): readonly string[] {
  const seen = new Set(TRAINING_SCRIPT.map((s) => String(s.stage)));
  const required: string[] = [...WIZARD_STAGES.map(String), 'restore', 'complete'];
  return required.filter((s) => !seen.has(s));
}

/** Gera o markdown do roteiro + checklist (material em portugues). */
export function renderTrainingScriptMarkdown(): string {
  const lines: string[] = [];
  lines.push(`# Roteiro de treinamento — Escala Simulada (versao ${TRAINING_SCRIPT_VERSION})`);
  lines.push('');
  lines.push(
    'Percorra os passos abaixo no modo de treinamento, usando dados ficticios. ' +
      'Em cada passo, confira "o que voce deve ver".',
  );
  lines.push('');
  for (const step of TRAINING_SCRIPT) {
    const stageLabel =
      step.stage === 'restore'
        ? 'Restauracao'
        : step.stage === 'complete'
          ? 'Conclusao'
          : STAGE_LABELS[step.stage];
    lines.push(`## ${stageLabel}: ${step.title}`);
    lines.push('');
    lines.push(`- O que fazer: ${step.action}`);
    lines.push(`- Onde: ${step.control}`);
    lines.push(`- O que voce deve ver: ${step.expectation}`);
    lines.push('');
  }
  lines.push('# Checklist de homologacao humana');
  lines.push('');
  for (const item of HOMOLOGATION_CHECKLIST) {
    lines.push(`- [ ] ${item.criterion}`);
    lines.push(`  - Evidencia: ${item.evidence}`);
  }
  return lines.join('\n');
}
