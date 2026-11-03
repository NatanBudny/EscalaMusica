// Comando guiado de corte, protegido pelo registro de homologacao (tarefa 19.1).
//
// Objetivo (Requisitos 10.2-10.4, 12.7-12.10, 16.7-16.12): o "corte" promove o
// novo fluxo a oficial. Ele SO pode executar quando o feature gate de
// homologacao esta aberto (`evaluateCutoverGate`). O comando:
//   1. cria um backup final;
//   2. confere os destinos (privado/publico) aprovados;
//   3. publica o pacote JA APROVADO;
//   4. registra o marco de transicao;
//   5. preserva o processo legado em branch/tag de transicao.
// Em caso de falha em qualquer etapa, um rollback compensatorio restaura e
// verifica a vigente anterior (nenhum estado parcial e dado como oficial).
//
// Este modulo e TypeScript PURO: os efeitos reais (backup, Git, publicacao) sao
// injetados como dependencias; aqui vive a DECISAO e a saga idempotente. Sem o
// gate aberto, o comando nao executa e informa que o fluxo atual continua
// oficial.

import type { OperationalConfig } from '../config/model';
import { evaluateCutoverGate } from '../config/gate';

/** Passos do corte, na ordem canonica. */
export type CutoverStep =
  | 'backup-final'
  | 'check-destinations'
  | 'publish-approved'
  | 'register-milestone'
  | 'preserve-legacy';

export const CUTOVER_SEQUENCE: readonly CutoverStep[] = [
  'backup-final',
  'check-destinations',
  'publish-approved',
  'register-milestone',
  'preserve-legacy',
];

/**
 * Efeitos externos do corte. Cada funcao devolve `true` em sucesso. Sao
 * injetados para manter a saga pura e testavel (sem I/O real aqui).
 */
export interface CutoverEffects {
  /** Cria o backup final antes de qualquer alteracao. Retorna o id do backup. */
  readonly createFinalBackup: () => string | null;
  /** Confere destinos aprovados (privado/publico). */
  readonly checkDestinations: () => boolean;
  /** Publica o pacote ja aprovado. Retorna o id de publicacao. */
  readonly publishApprovedPackage: () => string | null;
  /** Registra o marco de transicao (data, responsavel, pacote). */
  readonly registerTransitionMilestone: (publicationId: string) => boolean;
  /** Preserva o processo legado em branch/tag de transicao. */
  readonly preserveLegacy: () => boolean;
  /**
   * Rollback compensatorio: restaura e verifica a vigente anterior usando o
   * backup final. Retorna `true` quando a vigente anterior foi restaurada e
   * verificada. Nunca usa force-push.
   */
  readonly compensatingRollback: (backupId: string) => boolean;
}

export type CutoverOutcome =
  | {
      readonly status: 'blocked';
      readonly reasons: readonly string[];
      readonly currentFlowOfficialMessage: string;
    }
  | {
      readonly status: 'completed';
      readonly executed: readonly CutoverStep[];
      readonly backupId: string;
      readonly publicationId: string;
    }
  | {
      readonly status: 'failed';
      readonly failedStep: CutoverStep;
      readonly executed: readonly CutoverStep[];
      readonly rolledBack: boolean;
      readonly reason: string;
    };

/**
 * Executa o comando guiado de corte. Sem o gate de homologacao aberto, retorna
 * `blocked` sem efeito algum. Com o gate aberto, executa a saga; se qualquer
 * passo apos o backup falhar, dispara o rollback compensatorio e retorna
 * `failed` preservando a vigente anterior.
 */
export function runCutover(
  config: OperationalConfig | null | undefined,
  effects: CutoverEffects,
): CutoverOutcome {
  const gate = evaluateCutoverGate(config);
  if (!gate.allowed) {
    return {
      status: 'blocked',
      reasons: gate.reasons,
      currentFlowOfficialMessage:
        gate.currentFlowOfficialMessage ??
        'O fluxo atual continua oficial. O corte permanece desabilitado.',
    };
  }

  const executed: CutoverStep[] = [];

  // 1) Backup final — sem ele, nada prossegue (e nao ha o que reverter ainda).
  const backupId = effects.createFinalBackup();
  if (backupId === null) {
    return {
      status: 'failed',
      failedStep: 'backup-final',
      executed,
      rolledBack: false,
      reason: 'Nao foi possivel criar o backup final; o corte nao iniciou.',
    };
  }
  executed.push('backup-final');

  // A partir daqui, qualquer falha dispara rollback compensatorio.
  const fail = (step: CutoverStep, reason: string): CutoverOutcome => {
    const rolledBack = effects.compensatingRollback(backupId);
    return { status: 'failed', failedStep: step, executed, rolledBack, reason };
  };

  // 2) Conferir destinos.
  if (!effects.checkDestinations()) {
    return fail('check-destinations', 'Os destinos aprovados nao conferem.');
  }
  executed.push('check-destinations');

  // 3) Publicar o pacote aprovado.
  const publicationId = effects.publishApprovedPackage();
  if (publicationId === null) {
    return fail('publish-approved', 'Falha ao publicar o pacote aprovado.');
  }
  executed.push('publish-approved');

  // 4) Registrar o marco de transicao.
  if (!effects.registerTransitionMilestone(publicationId)) {
    return fail('register-milestone', 'Falha ao registrar o marco de transicao.');
  }
  executed.push('register-milestone');

  // 5) Preservar o processo legado em branch/tag de transicao.
  if (!effects.preserveLegacy()) {
    return fail('preserve-legacy', 'Falha ao preservar o processo legado.');
  }
  executed.push('preserve-legacy');

  return { status: 'completed', executed, backupId, publicationId };
}
