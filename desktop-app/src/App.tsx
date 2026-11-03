import { useCallback, useState } from 'react';
import { invokeCommand } from './ipc/client';
import type { PingResponse } from './ipc/contracts';
import { RegistryGrid } from './app/registry';
import { CycleApp, type CycleProgress } from './app/wizard';
import { TrainingPanel } from './app/training';
import type { CycleStage } from './domain/schemas/models';

/**
 * Shell do aplicativo. A navegacao principal tem tres areas:
 *  - Cadastro: pessoas e departamentos (ponto de partida real).
 *  - Ciclo mensal: o assistente das sete etapas.
 *  - Treinamento: a "Escala Simulada" com dados ficticios, operavel de ponta a
 *    ponta sem afetar nenhum dado real.
 *
 * Nenhum dado do legado (atual.json, contatos.json) e lido aqui. A verificacao
 * do nucleo (ping) permanece como diagnostico opcional.
 */

type Area = 'cadastro' | 'ciclo' | 'treinamento';

// Progresso inicial de um ciclo recem-aberto: nada preenchido ainda. Em uso
// real, cada campo e derivado dos snapshots dos servicos.
const INITIAL_PROGRESS: CycleProgress = {
  monthChosen: false,
  calendarGenerated: false,
  requiredInputsCount: 0,
  providedInputsCount: 0,
  unavailabilityReviewed: false,
  pendingImports: 0,
  unfilledRequiredCells: 0,
  validationComplete: false,
  validationStale: false,
  blockingFindings: 0,
  previewGenerated: false,
  unacknowledgedWarnings: 0,
  approvalRegistered: false,
  packagePublished: false,
  publicSiteVerified: false,
  closingConfirmed: false,
  unresolvedReconcileConflicts: 0,
};

function CoreCheck(): JSX.Element {
  const [result, setResult] = useState<PingResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handlePing = useCallback(async () => {
    setError(null);
    try {
      const response = await invokeCommand('ping', { message: 'ola-nucleo' });
      setResult(response);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  return (
    <details>
      <summary>Diagnostico do nucleo (somente no app desktop)</summary>
      <button type="button" onClick={handlePing}>
        Verificar nucleo
      </button>
      {result ? (
        <section aria-label="resultado">
          <p>Eco: {result.echo}</p>
          <p>Versao do nucleo: {result.coreVersion}</p>
          <p>Legado intocado: {result.legacyUntouched ? 'sim' : 'nao'}</p>
        </section>
      ) : null}
      {error ? <p role="alert">Erro: {error}</p> : null}
    </details>
  );
}

/** Painel da etapa atual do ciclo. */
function stagePanel(stage: CycleStage): JSX.Element | null {
  switch (stage) {
    case 'opening':
      return (
        <p>
          Escolha o mes e confira o calendario gerado (quartas, sabados e
          domingos). Inclua cultos extraordinarios se necessario.
        </p>
      );
    case 'collection':
      return (
        <p>
          Lance anciao, pregador, sonoplastia, musicas, tema e as
          indisponibilidades recebidas. Cada entrada e conferida antes de salvar.
        </p>
      );
    case 'assembly':
      return (
        <p>
          Monte a escala por culto a partir do cadastro e dos insumos. Use a aba
          Cadastro para preparar pessoas e departamentos.
        </p>
      );
    case 'validation':
      return <p>Rode a validacao completa e resolva cada bloqueio antes de avancar.</p>;
    case 'approval':
      return (
        <p>
          Revise a previa e as diferencas; registre ciencia de cada aviso e
          aprove.
        </p>
      );
    case 'publication':
      return (
        <p>Publique o pacote aprovado e aguarde a verificacao do site publico.</p>
      );
    case 'closing':
      return (
        <p>
          Confirme o fechamento: os links de confirmacao e a rotacao sao
          atualizados a partir da escala publicada.
        </p>
      );
    default:
      return null;
  }
}

export function App(): JSX.Element {
  const [area, setArea] = useState<Area>('cadastro');

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', padding: '1rem', maxWidth: 1100, margin: '0 auto' }}>
      <header>
        <h1>Gestao Leiga de Escalas</h1>
        <nav aria-label="Areas do aplicativo" style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
          <button type="button" aria-pressed={area === 'cadastro'} onClick={() => setArea('cadastro')}>
            Cadastro
          </button>
          <button type="button" aria-pressed={area === 'ciclo'} onClick={() => setArea('ciclo')}>
            Ciclo mensal
          </button>
          <button type="button" aria-pressed={area === 'treinamento'} onClick={() => setArea('treinamento')}>
            Treinamento (Escala Simulada)
          </button>
        </nav>
      </header>

      <main>
        {area === 'cadastro' ? <RegistryGrid /> : null}

        {area === 'ciclo' ? (
          <CycleApp progress={INITIAL_PROGRESS} connectivity="online" renderStagePanel={stagePanel} />
        ) : null}

        {area === 'treinamento' ? (
          <TrainingPanel
            realOperational={{ aviso: 'dados reais nao sao tocados no treino' }}
            realPublic={{ aviso: 'site publico nao e tocado no treino' }}
          />
        ) : null}
      </main>

      <footer style={{ marginTop: '2rem' }}>
        <CoreCheck />
      </footer>
    </div>
  );
}
