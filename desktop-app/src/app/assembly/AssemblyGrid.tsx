// Grade de montagem manual e elegibilidade por celula (tarefa 6.1).
//
// Requisitos cobertos (requirements.md, Requisito 5):
//  5.1  incluir, substituir e remover atribuicoes no Rascunho;
//  5.2  funcao individual: pessoa habilitada ou Departamento quando permitido;
//  5.4  por celula/candidato: habilitacao, disponibilidade e cada conflito com
//       Regra_Fundamental ou Preferencia_de_Escala;
//  5.9  historico de rotacao (quantidade e datas) por candidato;
//  5.10 contrariar Preferencia exige justificativa nao vazia;
//  5.11 violar Regra_Fundamental sem Excecao_Aprovada e bloqueado e preserva o
//       Rascunho anterior;
//  5.12 responsabilidade departamental exibida na celula.
//
// Sem JSON livre: toda escolha e por selecao; erros aparecem inline; o estado
// vem do `useAssembly` (que detem o rascunho canonico e delega ao dominio).

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAssembly } from './useAssembly';
import { cellKey } from './cellKey';
import type {
  ApplyError,
  CandidateEvaluation,
  DepartmentResponsibilityRule,
  EligibilityContext,
} from '../../domain/eligibility';
import type { ScheduleDraft } from '../../domain/schemas/models';

/** Culto exibido como linha da grade. */
export interface ServiceRow {
  id: string;
  label: string;
}

/** Funcao exibida como coluna da grade. */
export interface RoleColumn {
  id: string;
  label: string;
}

export interface AssemblyGridProps {
  services: ServiceRow[];
  roles: RoleColumn[];
  initialDraft: ScheduleDraft;
  /** Monta o contexto de elegibilidade a partir do rascunho corrente. */
  contextFactory: (draft: ScheduleDraft) => EligibilityContext;
  /** Regra de responsabilidade departamental (opcional). */
  departmentRule?: DepartmentResponsibilityRule;
  /**
   * Celulas com achado de validacao a destacar (tarefa 8.2). Chave estavel
   * `serviceId\u0000roleId` (ver `cellKey`). Cada celula destacada recebe o
   * atributo `data-validation="blocking"` para a UI/estilo e a leitura por
   * testes.
   */
  highlightedCells?: ReadonlySet<string>;
  /**
   * Celula a focar/selecionar de forma CONTROLADA (navegacao a partir do painel
   * de validacao, 1.5/7.3). Quando muda, a grade seleciona a celula e abre o
   * painel de candidatos dela.
   */
  focusedCell?: { serviceId: string; roleId: string } | null;
  /**
   * Notifica o rascunho corrente apos cada mudanca de atribuicao aceita, para
   * que o container possa reavaliar a validacao (7.1).
   */
  onDraftChange?: (draft: ScheduleDraft) => void;
}

export function AssemblyGrid(props: AssemblyGridProps): JSX.Element {
  const {
    services,
    roles,
    initialDraft,
    contextFactory,
    departmentRule,
    highlightedCells,
    focusedCell,
    onDraftChange,
  } = props;
  const assembly = useAssembly(initialDraft, contextFactory, departmentRule);

  // Celula selecionada (abre o painel de candidatos).
  const [selected, setSelected] = useState<{ serviceId: string; roleId: string } | null>(null);
  const [error, setError] = useState<ApplyError | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [overrideReason, setOverrideReason] = useState('');

  // Navegacao controlada: selecionar a celula focada pelo painel de validacao.
  useEffect(() => {
    if (focusedCell) {
      setSelected({ serviceId: focusedCell.serviceId, roleId: focusedCell.roleId });
      setError(null);
      setStatus(null);
      setOverrideReason('');
    }
  }, [focusedCell]);

  const assignmentFor = useCallback(
    (serviceId: string, roleId: string) =>
      assembly.draft.assignments.find((a) => a.serviceId === serviceId && a.roleId === roleId),
    [assembly.draft],
  );

  const cell = useMemo(
    () => (selected ? assembly.evaluate(selected.serviceId, selected.roleId) : null),
    [selected, assembly],
  );

  const selectCell = useCallback((serviceId: string, roleId: string) => {
    setSelected({ serviceId, roleId });
    setError(null);
    setStatus(null);
    setOverrideReason('');
  }, []);

  const subjectName = useCallback(
    (serviceId: string, roleId: string): string => {
      const a = assignmentFor(serviceId, roleId);
      if (!a) return '';
      const ev = assembly.evaluate(serviceId, roleId);
      return ev.candidates.find((c) => c.subject.id === a.subject.id)?.name ?? a.subject.id;
    },
    [assignmentFor, assembly],
  );

  const handleInclude = useCallback(
    (candidate: CandidateEvaluation) => {
      if (!selected) return;
      const result = assembly.apply({
        serviceId: selected.serviceId,
        roleId: selected.roleId,
        subject: candidate.subject,
        ...(overrideReason ? { preferenceOverrideReason: overrideReason } : {}),
      });
      if (!result.ok) {
        setError(result.error);
        setStatus(null);
        return;
      }
      setError(null);
      setOverrideReason('');
      setStatus(`Atribuicao salva: ${candidate.name}.`);
      onDraftChange?.(result.draft);
    },
    [assembly, selected, overrideReason, onDraftChange],
  );

  const handleRemove = useCallback(() => {
    if (!selected) return;
    const result = assembly.apply({ serviceId: selected.serviceId, roleId: selected.roleId });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    setStatus('Atribuicao removida.');
    onDraftChange?.(result.draft);
  }, [assembly, selected, onDraftChange]);

  return (
    <section aria-label="Montagem da escala">
      <h1>Montagem da escala</h1>

      <div role="status" aria-live="polite">
        {status ?? ''}
      </div>

      <table>
        <caption>Grade de montagem (clique em uma celula para montar)</caption>
        <thead>
          <tr>
            <th scope="col">Culto</th>
            {roles.map((r) => (
              <th scope="col" key={r.id}>
                {r.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {services.map((s) => (
            <tr key={s.id}>
              <th scope="row">{s.label}</th>
              {roles.map((r) => {
                const isSelected =
                  selected?.serviceId === s.id && selected?.roleId === r.id;
                const name = subjectName(s.id, r.id);
                const highlighted = highlightedCells?.has(cellKey(s.id, r.id)) ?? false;
                return (
                  <td
                    key={r.id}
                    {...(highlighted ? { 'data-validation': 'blocking' } : {})}
                  >
                    <button
                      type="button"
                      aria-label={`Montar ${r.label} de ${s.label}`}
                      aria-pressed={isSelected}
                      aria-invalid={highlighted || undefined}
                      onClick={() => selectCell(s.id, r.id)}
                    >
                      {name === '' ? '(vazio)' : name}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      {selected && cell ? (
        <div role="region" aria-label="Candidatos da celula">
          <h2>
            Candidatos: {roleLabel(roles, cell.roleId)} em {serviceLabel(services, cell.serviceId)}
          </h2>

          {cell.departmentResponsibility ? (
            <p role="note">
              Responsabilidade departamental: esta funcao e do departamento{' '}
              {cell.departmentResponsibility.name}.
            </p>
          ) : null}

          {assignmentFor(selected.serviceId, selected.roleId) ? (
            <button type="button" onClick={handleRemove}>
              Remover atribuicao
            </button>
          ) : null}

          <label htmlFor="override-reason">
            Justificativa (obrigatoria ao contrariar uma preferencia)
          </label>
          <input
            id="override-reason"
            type="text"
            value={overrideReason}
            onChange={(e) => setOverrideReason(e.target.value)}
          />

          {error ? (
            <p role="alert">
              {error.message}
              {error.conflicts && error.conflicts.length > 0 ? (
                <span>
                  {' '}
                  Regras: {error.conflicts.map((c) => c.message).join('; ')}.
                </span>
              ) : null}
            </p>
          ) : null}

          <ul aria-label="Lista de candidatos">
            {cell.candidates.map((c) => (
              <li key={`${c.subject.type}:${c.subject.id}`}>
                <span>{c.name}</span>{' '}
                <span>{c.subject.type === 'department' ? '(departamento)' : '(pessoa)'}</span>
                <ul>
                  <li>Habilitado: {c.capable ? 'sim' : 'nao'}</li>
                  <li>Ativo: {c.active ? 'sim' : 'nao'}</li>
                  <li>Disponivel: {c.available ? 'sim' : 'nao'}</li>
                  <li>Dia permitido: {c.weekdayAllowed ? 'sim' : 'nao'}</li>
                  <li>
                    Historico: {c.history.count}
                    {c.history.count > 0 ? ` (${c.history.dates.join(', ')})` : ''}
                  </li>
                  {c.fundamentalConflicts.length > 0 ? (
                    <li>
                      Conflitos fundamentais:{' '}
                      {c.fundamentalConflicts
                        .map(
                          (f) =>
                            `${f.message}${f.coveredByException ? ' (excecao vigente)' : ''}`,
                        )
                        .join('; ')}
                    </li>
                  ) : null}
                  {c.preferenceConflicts.length > 0 ? (
                    <li>
                      Conflitos de preferencia:{' '}
                      {c.preferenceConflicts.map((f) => f.message).join('; ')}
                    </li>
                  ) : null}
                </ul>
                <button
                  type="button"
                  aria-label={`Escolher ${c.name}`}
                  disabled={!c.selectable}
                  onClick={() => handleInclude(c)}
                >
                  {assignmentFor(selected.serviceId, selected.roleId)
                    ? 'Substituir por este'
                    : 'Incluir'}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function roleLabel(roles: RoleColumn[], id: string): string {
  return roles.find((r) => r.id === id)?.label ?? id;
}

function serviceLabel(services: ServiceRow[], id: string): string {
  return services.find((s) => s.id === id)?.label ?? id;
}
