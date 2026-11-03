// Modo de treinamento isolado (tarefa 16.2).
//
// Objetivo (Requisitos 15.11-15.14; design.md linha TrainingMode: "Fixtures e
// publicacao simulada; workspace e credenciais separados da operacao"):
//
//   - Fornece fixtures ficticias, workspace, credenciais e publicacao SIMULADOS,
//     separados dos dados reais de operacao.
//   - Registra o percurso do operador da abertura ate a restauracao/conclusao.
//   - GARANTE que os hashes dos dados operacionais e publicos reais permanecem
//     INALTERADOS durante todo o exercicio (nenhuma operacao do treino toca o
//     estado real).
//
// Este modulo e TypeScript PURO: o "mundo simulado" e apenas memoria. Reusa o
// hashing canonico para comprovar o isolamento (hash antes == hash depois).

import type { CycleStage } from '../../domain/schemas/models';
import { canonicalHash } from '../../domain/schemas/canonical';
import { WIZARD_STAGES } from '../wizard/wizardState';

/** Um snapshot do estado REAL (operacional + publico) a ser preservado. */
export interface RealWorldSnapshot {
  readonly operationalHash: string;
  readonly publicHash: string;
}

/** Calcula o snapshot de hashes do estado real (para comparacao antes/depois). */
export function snapshotRealWorld(operational: unknown, publicState: unknown): RealWorldSnapshot {
  return {
    operationalHash: canonicalHash(operational),
    publicHash: canonicalHash(publicState),
  };
}

/** Evento registrado no percurso de treinamento. */
export interface TrainingLogEntry {
  readonly stage: CycleStage | 'restore' | 'complete';
  readonly at: string;
  readonly note: string;
}

/** Estado do mundo de treinamento (tudo ficticio e em memoria). */
export interface TrainingSession {
  readonly active: boolean;
  /** Dados ficticios do treino (separados dos reais). */
  readonly fixtures: Readonly<Record<string, unknown>>;
  /** Publicacao simulada (nunca sai para rede real). */
  readonly simulatedPublications: readonly string[];
  readonly log: readonly TrainingLogEntry[];
  /** Snapshot do estado real no inicio, para provar isolamento ao fim. */
  readonly realWorldAtStart: RealWorldSnapshot;
}

/** Inicia uma sessao de treinamento com fixtures ficticias. */
export function startTraining(params: {
  readonly fixtures: Readonly<Record<string, unknown>>;
  readonly realWorldAtStart: RealWorldSnapshot;
  readonly at: string;
}): TrainingSession {
  return {
    active: true,
    fixtures: { ...params.fixtures },
    simulatedPublications: [],
    log: [{ stage: 'opening', at: params.at, note: 'Treinamento iniciado.' }],
    realWorldAtStart: params.realWorldAtStart,
  };
}

/** Registra o avanco por uma etapa do treino (nao toca dados reais). */
export function logTrainingStage(
  session: TrainingSession,
  stage: CycleStage,
  at: string,
  note: string,
): TrainingSession {
  return { ...session, log: [...session.log, { stage, at, note }] };
}

/** Publica de forma SIMULADA (apenas registra; nunca envia a rede real). */
export function simulatePublish(session: TrainingSession, packageId: string, at: string): TrainingSession {
  return {
    ...session,
    simulatedPublications: [...session.simulatedPublications, packageId],
    log: [...session.log, { stage: 'publication', at, note: `Publicacao simulada do pacote ${packageId}.` }],
  };
}

/** Registra a restauracao de treino (ensaio). */
export function logTrainingRestore(session: TrainingSession, at: string): TrainingSession {
  return { ...session, log: [...session.log, { stage: 'restore', at, note: 'Restauracao de treino realizada.' }] };
}

/** Encerra a sessao de treinamento. */
export function completeTraining(session: TrainingSession, at: string): TrainingSession {
  return {
    ...session,
    active: false,
    log: [...session.log, { stage: 'complete', at, note: 'Treinamento concluido.' }],
  };
}

/**
 * Verifica o ISOLAMENTO ao fim do treino (15.12): os hashes atuais do estado
 * real devem ser IDENTICOS aos do inicio. Retorna `true` quando nada real foi
 * tocado durante todo o exercicio.
 */
export function verifyIsolation(session: TrainingSession, currentRealWorld: RealWorldSnapshot): boolean {
  return (
    session.realWorldAtStart.operationalHash === currentRealWorld.operationalHash &&
    session.realWorldAtStart.publicHash === currentRealWorld.publicHash
  );
}

/**
 * Verifica que o percurso registrado cobre TODAS as etapas exigidas: as sete
 * etapas do ciclo, a restauracao e a conclusao (15.13, 15.14). Retorna as
 * etapas faltantes (vazio quando completo).
 */
export function missingTrainingSteps(session: TrainingSession): readonly string[] {
  const seen = new Set(session.log.map((e) => e.stage));
  const required: (CycleStage | 'restore' | 'complete')[] = [...WIZARD_STAGES, 'restore', 'complete'];
  return required.filter((step) => !seen.has(step)).map(String);
}
