// Painel de validacao integrado a grade de montagem (tarefa 8.2).
//
// Apresenta, em portugues, o resultado da validacao da revisao atual e integra
// os achados a grade e ao gate de publicacao:
//
//  7.24 totais SEPARADOS de Bloqueios, Avisos e verificacoes aprovadas, alem da
//       revisao e da versao de regras validadas e da relacao individual de cada
//       resultado;
//  7.3  cada achado exibe culto/data, funcao/campo, referencia, regra,
//       severidade, motivo e acao necessaria;
//  1.5  cada pendencia bloqueante mostra a acao nao concluida e o motivo que
//       impede o avanco; clicar navega ate a celula afetada (destaque);
//  7.23 enquanto houver Bloqueio ou a validacao da revisao atual nao tiver
//       terminado, a PUBLICACAO fica desabilitada;
//  8.1  zero Bloqueios na validacao COMPLETA da revisao atual habilita apenas o
//       botao de AVANCAR para a proxima etapa — NUNCA a publicacao direta.
//
// O painel nao valida nada por conta propria: recebe o estado de `useValidation`
// (que delega ao ValidationEngine real).

import type { UseValidation } from './useValidation';
import type { ValidationFinding } from '../../domain/schemas/models';

export interface ValidationPanelProps {
  validation: UseValidation;
  /** Rotulo legivel de um culto (para exibir a data/nome). */
  serviceLabel?: (serviceId: string) => string;
  /** Rotulo legivel de uma funcao/campo. */
  roleLabel?: (roleOrField: string) => string;
  /**
   * Navega ate a celula afetada por um achado (destaca na grade). Chamado ao
   * clicar em um achado que tenha culto e funcao/campo (1.5 / 7.3).
   */
  onNavigate?: (target: { serviceId: string; roleOrField?: string }) => void;
  /**
   * Avanca para a proxima etapa do ciclo. So e chamado quando o avanco esta
   * habilitado (8.1). A publicacao NAO e exposta aqui (gate da saga posterior).
   */
  onAdvanceStage?: () => void;
}

export function ValidationPanel(props: ValidationPanelProps): JSX.Element {
  const { validation, onNavigate, onAdvanceStage } = props;
  const serviceLabel = props.serviceLabel ?? ((id) => id);
  const roleLabel = props.roleLabel ?? ((id) => id);
  const { report } = validation;

  return (
    <section aria-label="Validacao da escala">
      <h2>Validacao</h2>

      <div>
        <button type="button" onClick={() => validation.validateAll()}>
          Validar escala completa
        </button>
      </div>

      {report === null ? (
        <p role="note">A revisao atual ainda nao foi validada.</p>
      ) : (
        <>
          {/* 7.24: revisao e versao de regras validadas. */}
          <dl aria-label="Identificacao da validacao">
            <dt>Revisao validada</dt>
            <dd>{report.draftRevision}</dd>
            <dt>Versao de regras</dt>
            <dd>{report.ruleSetVersion}</dd>
            <dt>Situacao</dt>
            <dd>{validation.isStale ? 'desatualizada' : 'atual'}</dd>
          </dl>

          {/* 7.24: totais separados de bloqueios, avisos e aprovadas. */}
          <ul aria-label="Totais da validacao">
            <li>
              Bloqueios: <span data-testid="total-blocking">{report.blocking.length}</span>
            </li>
            <li>
              Avisos: <span data-testid="total-warnings">{report.warnings.length}</span>
            </li>
            <li>
              Aprovadas: <span data-testid="total-passed">{report.passedCount}</span>
            </li>
          </ul>

          {validation.isStale ? (
            <p role="alert">
              Os resultados nao valem para a revisao atual. Valide a escala completa novamente.
            </p>
          ) : null}

          {/* 1.5: pendencias bloqueantes com acao e motivo; clique navega. */}
          {validation.blockingReasons.length > 0 ? (
            <div role="region" aria-label="Pendencias bloqueantes">
              <h3>Pendencias que impedem o avanco</h3>
              <ul aria-label="Lista de pendencias">
                {validation.blockingReasons.map((b) => (
                  <li key={b.id}>
                    <span>{b.reason}</span>
                    {' — '}
                    <span>{b.requiredAction}</span>
                    {b.serviceId ? (
                      <>
                        {' '}
                        <button
                          type="button"
                          aria-label={`Ir para ${b.roleOrField ? roleLabel(b.roleOrField) + ' de ' : ''}${serviceLabel(b.serviceId)}`}
                          onClick={() =>
                            onNavigate?.({
                              serviceId: b.serviceId as string,
                              ...(b.roleOrField !== undefined ? { roleOrField: b.roleOrField } : {}),
                            })
                          }
                        >
                          Ir ao campo
                        </button>
                      </>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* 7.3: relacao individual de cada resultado. */}
          <FindingList
            title="Bloqueios"
            findings={report.blocking}
            serviceLabel={serviceLabel}
            roleLabel={roleLabel}
            {...(onNavigate ? { onNavigate } : {})}
          />
          <FindingList
            title="Avisos"
            findings={report.warnings}
            serviceLabel={serviceLabel}
            roleLabel={roleLabel}
            {...(onNavigate ? { onNavigate } : {})}
          />
        </>
      )}

      {/* 7.23 + 8.1: gate. Publicacao SEMPRE desabilitada nesta etapa. */}
      <div role="group" aria-label="Avanco do ciclo">
        <button
          type="button"
          aria-label="Avancar para a proxima etapa"
          disabled={!validation.canAdvanceStage}
          onClick={() => onAdvanceStage?.()}
        >
          Avancar para a proxima etapa
        </button>
        {/* A publicacao direta nunca e habilitada aqui (gate da saga). */}
        <button
          type="button"
          aria-label="Publicar"
          disabled={!validation.canPublishNow}
          title="A publicacao e feita na etapa de publicacao, apos aprovacao"
        >
          Publicar
        </button>
        {!validation.canAdvanceStage ? (
          <p role="note">
            O avanco so e habilitado apos uma validacao completa da revisao atual sem bloqueios.
          </p>
        ) : null}
      </div>
    </section>
  );
}

interface FindingListProps {
  title: string;
  findings: readonly ValidationFinding[];
  serviceLabel: (serviceId: string) => string;
  roleLabel: (roleOrField: string) => string;
  onNavigate?: (target: { serviceId: string; roleOrField?: string }) => void;
}

function FindingList(props: FindingListProps): JSX.Element | null {
  const { title, findings, serviceLabel, roleLabel, onNavigate } = props;
  if (findings.length === 0) return null;
  return (
    <div role="region" aria-label={title}>
      <h3>{title}</h3>
      <ul aria-label={`Lista de ${title.toLowerCase()}`}>
        {findings.map((f) => (
          <li key={f.findingId} data-severity={f.severity}>
            <span>Regra: {f.ruleId}</span>
            {f.serviceId ? <span> | Culto: {serviceLabel(f.serviceId)}</span> : null}
            {f.date ? <span> | Data: {f.date}</span> : null}
            {f.roleOrField ? <span> | Campo: {roleLabel(f.roleOrField)}</span> : null}
            {f.offendingReference ? <span> | Ref.: {f.offendingReference}</span> : null}
            <span> | Motivo: {f.reason}</span>
            <span> | Acao: {f.requiredAction}</span>
            {f.serviceId && onNavigate ? (
              <button
                type="button"
                aria-label={`Destacar ${f.roleOrField ? roleLabel(f.roleOrField) + ' de ' : ''}${serviceLabel(f.serviceId)}`}
                onClick={() =>
                  onNavigate({
                    serviceId: f.serviceId as string,
                    ...(f.roleOrField !== undefined ? { roleOrField: f.roleOrField } : {}),
                  })
                }
              >
                Destacar celula
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
