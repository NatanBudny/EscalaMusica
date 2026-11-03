// Testes do modo de treinamento isolado (tarefa 16.2).
//
// Validacao objetiva: os hashes dos dados operacionais e publicos reais
// permanecem inalterados durante todo o exercicio; o registro cobre todas as
// etapas exigidas (sete etapas + restauracao + conclusao).
//
// Requisitos: 15.11-15.14.

import { describe, it, expect } from 'vitest';
import { WIZARD_STAGES } from '../wizard/wizardState';
import {
  completeTraining,
  logTrainingRestore,
  logTrainingStage,
  missingTrainingSteps,
  simulatePublish,
  snapshotRealWorld,
  startTraining,
  verifyIsolation,
} from './trainingMode';

const AT = '2026-02-20T10:00:00Z';

/** Simula um percurso completo de treino sobre fixtures ficticias. */
function fullSession() {
  const realOperational = { pessoas: ['REAL-1'], ciclos: ['2026-02'] };
  const realPublic = { atual: [{ DATA: '01/02/2026' }] };
  const start = snapshotRealWorld(realOperational, realPublic);

  let session = startTraining({
    fixtures: { pessoas: ['FICTICIO-A', 'FICTICIO-B'] },
    realWorldAtStart: start,
    at: AT,
  });
  // Percorre as sete etapas (opening ja registrada no start).
  for (const stage of WIZARD_STAGES) {
    session = logTrainingStage(session, stage, AT, `treino: ${stage}`);
  }
  session = simulatePublish(session, 'pkg-treino', AT);
  session = logTrainingRestore(session, AT);
  session = completeTraining(session, AT);

  return { session, realOperational, realPublic, start };
}

describe('TrainingMode (15.11-15.14)', () => {
  it('opera sobre fixtures ficticias, nao sobre dados reais', () => {
    const { session } = fullSession();
    expect(session.fixtures['pessoas']).toEqual(['FICTICIO-A', 'FICTICIO-B']);
    expect(session.simulatedPublications).toEqual(['pkg-treino']);
  });

  it('preserva os hashes do mundo real durante todo o exercicio (isolamento)', () => {
    const { session, realOperational, realPublic } = fullSession();
    // O estado real nao foi tocado; recalcular seus hashes da o mesmo snapshot.
    const now = snapshotRealWorld(realOperational, realPublic);
    expect(verifyIsolation(session, now)).toBe(true);
  });

  it('detecta violacao de isolamento se o mundo real mudar', () => {
    const { session } = fullSession();
    const tampered = snapshotRealWorld({ pessoas: ['ALTERADO'] }, { atual: [] });
    expect(verifyIsolation(session, tampered)).toBe(false);
  });

  it('o registro cobre todas as etapas exigidas (sete + restauracao + conclusao)', () => {
    const { session } = fullSession();
    expect(missingTrainingSteps(session)).toEqual([]);
  });

  it('aponta etapas faltantes quando o percurso e incompleto', () => {
    const start = snapshotRealWorld({}, {});
    const session = startTraining({ fixtures: {}, realWorldAtStart: start, at: AT });
    const missing = missingTrainingSteps(session);
    // So 'opening' foi registrada no start; faltam as demais + restore + complete.
    expect(missing).toContain('closing');
    expect(missing).toContain('restore');
    expect(missing).toContain('complete');
  });
});
