// Painel React do modo de treinamento isolado (tarefa 16.2).
//
// Objetivo (Requisitos 15.11-15.14): oferecer, pela interface, um exercicio
// completo sobre FIXTURES FICTICIAS, com workspace/credenciais/publicacao
// SIMULADOS, separados da operacao real. O painel:
//   - inicia o treino com fixtures ficticias e um snapshot do mundo real;
//   - conduz o operador pelas sete etapas + restauracao + conclusao;
//   - publica de forma SIMULADA (nunca toca a rede ou os arquivos reais);
//   - comprova o ISOLAMENTO ao fim (hashes do mundo real inalterados) e mostra
//     o resultado em portugues.
//
// Toda a DECISAO vive na logica pura (`trainingMode.ts`); aqui so montamos a UI
// acessivel. O mundo real e representado por hashes imutaveis passados via
// props — este painel nunca escreve neles.

import { useCallback, useMemo, useState } from 'react';
import type { CycleStage } from '../../domain/schemas/models';
import { WIZARD_STAGES, STAGE_LABELS } from '../wizard/wizardState';
import {
  completeTraining,
  logTrainingRestore,
  logTrainingStage,
  missingTrainingSteps,
  simulatePublish,
  snapshotRealWorld,
  startTraining,
  verifyIsolation,
  type RealWorldSnapshot,
  type TrainingSession,
} from './trainingMode';
import {
  DEFAULT_TRAINING_FIXTURES,
  createSimulatedTarget,
  simulatedPublishTo,
  type SimulatedPublishTarget,
  type TrainingFixtures,
} from './trainingFixtures';

export interface TrainingPanelProps {
  /** Fixtures ficticias (default: conjunto irreal embutido). */
  readonly fixtures?: TrainingFixtures;
  /**
   * Estado REAL (operacional e publico) a preservar. O painel so LE para tirar
   * o snapshot inicial e reconferir ao fim; nunca escreve. Em testes e em uso
   * real, estes valores vem dos servicos (imutaveis durante o treino).
   */
  readonly realOperational: unknown;
  readonly realPublic: unknown;
  /** Relogio injetavel para instantes deterministicos nos testes. */
  readonly now?: () => string;
}

const SIMULATED_PACKAGE_ID = 'pkg-treino-SIMULADO';

export function TrainingPanel(props: TrainingPanelProps): JSX.Element {
  const fixtures = props.fixtures ?? DEFAULT_TRAINING_FIXTURES;
  const propsNow = props.now;
  const now = useMemo(() => propsNow ?? (() => new Date().toISOString()), [propsNow]);

  const realSnapshotAtStart: RealWorldSnapshot = useMemo(
    () => snapshotRealWorld(props.realOperational, props.realPublic),
    [props.realOperational, props.realPublic],
  );

  const [session, setSession] = useState<TrainingSession | null>(null);
  const [target, setTarget] = useState<SimulatedPublishTarget>(() => createSimulatedTarget());
  const [status, setStatus] = useState<string>('');

  const begin = useCallback(() => {
    const s = startTraining({
      fixtures: { ...fixtures },
      realWorldAtStart: realSnapshotAtStart,
      at: now(),
    });
    setSession(s);
    setTarget(createSimulatedTarget());
    setStatus('Treinamento iniciado com dados ficticios.');
  }, [fixtures, realSnapshotAtStart, now]);

  const advance = useCallback(
    (stage: CycleStage) => {
      setSession((s) => (s ? logTrainingStage(s, stage, now(), `treino: ${stage}`) : s));
      setStatus(`Etapa de treino registrada: ${STAGE_LABELS[stage]}.`);
    },
    [now],
  );

  const publishSimulated = useCallback(() => {
    setSession((s) => (s ? simulatePublish(s, SIMULATED_PACKAGE_ID, now()) : s));
    setTarget((t) => simulatedPublishTo(t, SIMULATED_PACKAGE_ID));
    setStatus('Publicacao SIMULADA registrada (nada foi enviado a rede real).');
  }, [now]);

  const restore = useCallback(() => {
    setSession((s) => (s ? logTrainingRestore(s, now()) : s));
    setStatus('Restauracao de treino registrada.');
  }, [now]);

  const finish = useCallback(() => {
    setSession((s) => (s ? completeTraining(s, now()) : s));
    setStatus('Treinamento concluido.');
  }, [now]);

  // Verificacao de isolamento: recalcula o snapshot do mundo real ATUAL (que,
  // por construcao, nao foi tocado) e compara com o do inicio.
  const currentRealSnapshot: RealWorldSnapshot = useMemo(
    () => snapshotRealWorld(props.realOperational, props.realPublic),
    [props.realOperational, props.realPublic],
  );

  const isolationOk = session ? verifyIsolation(session, currentRealSnapshot) : null;
  const missing = session ? missingTrainingSteps(session) : null;

  return (
    <section aria-label="Modo de treinamento">
      <h1>Modo de treinamento (Escala Simulada)</h1>
      <p>
        Este exercicio usa dados ficticios e uma publicacao simulada. Os dados
        reais da operacao e do site publico NAO sao alterados em momento algum.
      </p>

      <div role="status" aria-live="polite">
        {status}
      </div>

      {session === null ? (
        <button type="button" onClick={begin}>
          Iniciar treinamento
        </button>
      ) : (
        <>
          <section aria-label="Fixtures ficticias">
            <h2>Dados ficticios do treino</h2>
            <ul>
              <li>Mes: {fixtures.mes}</li>
              <li>Pessoas: {fixtures.pessoas.join(', ')}</li>
              <li>Cultos: {fixtures.cultos.join(', ')}</li>
              <li>Repositorio simulado: {target.repositorioSimulado}</li>
            </ul>
          </section>

          <section aria-label="Percurso das etapas de treino">
            <h2>Percurso</h2>
            <ol>
              {WIZARD_STAGES.map((stage) => (
                <li key={stage}>
                  <button type="button" onClick={() => advance(stage)}>
                    Registrar etapa: {STAGE_LABELS[stage]}
                  </button>
                </li>
              ))}
            </ol>
            <button type="button" onClick={publishSimulated}>
              Publicar (simulado)
            </button>
            <button type="button" onClick={restore}>
              Restaurar (ensaio)
            </button>
            <button type="button" onClick={finish}>
              Concluir treinamento
            </button>
          </section>

          <section aria-label="Verificacao de isolamento">
            <h2>Isolamento e cobertura</h2>
            <p role="status" data-testid="isolation">
              {isolationOk
                ? 'Isolamento verificado: os dados reais permaneceram inalterados.'
                : 'Atencao: os dados reais parecem ter mudado durante o treino.'}
            </p>
            {missing && missing.length > 0 ? (
              <p role="note">
                Faltam registrar: {missing.map((m) => STAGE_LABELS[m as CycleStage] ?? m).join(', ')}.
              </p>
            ) : (
              <p role="note" data-testid="coverage-complete">
                Percurso completo: todas as etapas, a restauracao e a conclusao foram registradas.
              </p>
            )}
            <p>Publicacoes simuladas: {session.simulatedPublications.length}</p>
          </section>
        </>
      )}
    </section>
  );
}
