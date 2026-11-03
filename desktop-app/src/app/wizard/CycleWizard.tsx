// Componente do assistente de ciclo das sete etapas (tarefa 16.1).
//
// Renderiza o estado derivado por `deriveWizard` (logica pura). Exibe, para
// cada etapa: rotulo, status, pendencias e a ajuda contextual "O que fazer
// agora?". O botao de avanco so fica habilitado quando a etapa atual nao tem
// pendencias. Tudo em portugues e acessivel (roles/aria), sem exigir JSON,
// Markdown, IA ou terminal (requisitos 1.1-1.8, 1.11, 10.1, 10.23).

import { useMemo, useState } from 'react';
import type { CycleStage } from '../../domain/schemas/models';
import {
  advanceStage,
  deriveWizard,
  STAGE_HELP,
  type WizardInput,
} from './wizardState';

export interface CycleWizardProps {
  readonly input: WizardInput;
  /** Chamado quando o operador avanca para a proxima etapa. */
  readonly onAdvance?: (next: CycleStage) => void;
}

export function CycleWizard(props: CycleWizardProps): JSX.Element {
  const view = useMemo(() => deriveWizard(props.input), [props.input]);
  const [helpFor, setHelpFor] = useState<CycleStage | null>(null);

  return (
    <section aria-label="Assistente do ciclo mensal">
      <ol aria-label="Etapas do ciclo" style={{ display: 'flex', gap: '0.5rem', listStyle: 'none', padding: 0 }}>
        {view.stages.map((s) => (
          <li
            key={s.stage}
            aria-current={s.status === 'current' || s.status === 'blocked' ? 'step' : undefined}
            data-status={s.status}
          >
            <span>{s.label}</span>
            {s.status === 'blocked' ? <span role="status"> (pendencias)</span> : null}
          </li>
        ))}
      </ol>

      {view.stages
        .filter((s) => s.stage === view.currentStage)
        .map((s) => (
          <div key={s.stage} aria-label={`Etapa atual: ${s.label}`}>
            <h2>{s.label}</h2>
            <button type="button" onClick={() => setHelpFor(helpFor === s.stage ? null : s.stage)}>
              O que fazer agora?
            </button>
            {helpFor === s.stage ? <p role="note">{STAGE_HELP[s.stage]}</p> : null}

            {s.pending.length > 0 ? (
              <ul aria-label="Pendencias da etapa">
                {s.pending.map((p, i) => (
                  <li key={i} role="alert">
                    {p}
                  </li>
                ))}
              </ul>
            ) : (
              <p role="status">Etapa sem pendencias.</p>
            )}
          </div>
        ))}

      <button
        type="button"
        disabled={!view.canAdvance}
        onClick={() => {
          const next = advanceStage(props.input);
          if (next !== props.input.currentStage) props.onAdvance?.(next);
        }}
      >
        Avancar etapa
      </button>
    </section>
  );
}
