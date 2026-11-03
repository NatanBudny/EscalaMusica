// Container que integra a grade de montagem, a validacao e o gate de avanco
// (tarefa 8.2).
//
// Responsabilidades (sem criar modelo paralelo — tudo delega ao dominio real):
//  - manter o rascunho corrente (sincronizado da grade por `onDraftChange`);
//  - montar o `ValidationInput` a partir do rascunho e das fontes fornecidas;
//  - destacar na grade as celulas com achado de validacao (7.3 / 1.5);
//  - navegar ate a celula afetada ao clicar em um achado (1.5);
//  - INVALIDAR os resultados derivados a cada alteracao de campo, mantendo o
//    gate fechado ate uma nova validacao completa (7.1 / 7.23);
//  - habilitar APENAS o avanco de etapa quando a validacao completa da revisao
//    atual terminar sem bloqueios — nunca a publicacao direta (8.1).

import { useCallback, useMemo, useState } from 'react';
import { AssemblyGrid, type RoleColumn, type ServiceRow } from '../assembly/AssemblyGrid';
import { cellKey } from '../assembly/cellKey';
import { ValidationPanel } from './ValidationPanel';
import { useValidation } from './useValidation';
import type { EligibilityContext } from '../../domain/eligibility';
import type { DepartmentResponsibilityRule } from '../../domain/eligibility';
import type { ValidationInput } from '../../domain/validation';
import type { ScheduleDraft } from '../../domain/schemas/models';

export interface AssemblyValidationViewProps {
  services: ServiceRow[];
  roles: RoleColumn[];
  initialDraft: ScheduleDraft;
  /** Contexto de elegibilidade da grade (reuso do modulo de montagem). */
  contextFactory: (draft: ScheduleDraft) => EligibilityContext;
  /** Regra de responsabilidade departamental (opcional). */
  departmentRule?: DepartmentResponsibilityRule;
  /**
   * Monta o `ValidationInput` para o rascunho corrente. O container injeta o
   * rascunho atualizado; o restante (cadastro, regras, insumos, estrutura) vem
   * do chamador, garantindo que a validacao use a MESMA versao de regras do
   * ciclo (nenhum valor livre de UI).
   */
  validationInputFactory: (draft: ScheduleDraft) => ValidationInput;
  /** Avanca o ciclo para a proxima etapa (habilitado por 8.1). */
  onAdvanceStage?: () => void;
  serviceLabel?: (serviceId: string) => string;
  roleLabel?: (roleOrField: string) => string;
}

export function AssemblyValidationView(props: AssemblyValidationViewProps): JSX.Element {
  const {
    services,
    roles,
    initialDraft,
    contextFactory,
    departmentRule,
    validationInputFactory,
    onAdvanceStage,
  } = props;

  // Rascunho corrente (sincronizado da grade). A revisao e usada como chave da
  // validacao; alem dela, invalidamos explicitamente ao mudar um campo.
  const [draft, setDraft] = useState<ScheduleDraft>(initialDraft);

  const inputFactory = useCallback(
    (): ValidationInput => validationInputFactory(draft),
    [draft, validationInputFactory],
  );

  const validation = useValidation(draft.revision, inputFactory);

  // Celula focada de forma controlada (navegacao a partir dos achados).
  const [focusedCell, setFocusedCell] = useState<{ serviceId: string; roleId: string } | null>(
    null,
  );

  // 7.1 / 7.23: ao mudar um campo, INVALIDA os resultados derivados (o gate
  // fecha) ate uma nova validacao completa da revisao atual.
  const handleDraftChange = useCallback(
    (next: ScheduleDraft) => {
      setDraft(next);
      validation.markStale();
    },
    [validation],
  );

  // Celulas a destacar: toda celula (culto x funcao) com achado bloqueante ou
  // de aviso que tenha culto e funcao/campo navegavel.
  const highlightedCells = useMemo<ReadonlySet<string>>(() => {
    const keys = new Set<string>();
    const report = validation.report;
    if (!report || validation.isStale) return keys;
    for (const f of [...report.blocking, ...report.warnings]) {
      if (f.serviceId && f.roleOrField && isRoleColumn(roles, f.roleOrField)) {
        keys.add(cellKey(f.serviceId, f.roleOrField));
      }
    }
    return keys;
  }, [validation.report, validation.isStale, roles]);

  const handleNavigate = useCallback(
    (target: { serviceId: string; roleOrField?: string }) => {
      if (target.roleOrField && isRoleColumn(roles, target.roleOrField)) {
        setFocusedCell({ serviceId: target.serviceId, roleId: target.roleOrField });
      } else {
        // Sem funcao navegavel: foca a primeira funcao do culto para destacar.
        const first = roles[0];
        if (first) setFocusedCell({ serviceId: target.serviceId, roleId: first.id });
      }
    },
    [roles],
  );

  return (
    <div>
      <AssemblyGrid
        services={services}
        roles={roles}
        initialDraft={initialDraft}
        contextFactory={contextFactory}
        {...(departmentRule ? { departmentRule } : {})}
        highlightedCells={highlightedCells}
        focusedCell={focusedCell}
        onDraftChange={handleDraftChange}
      />
      <ValidationPanel
        validation={validation}
        {...(props.serviceLabel ? { serviceLabel: props.serviceLabel } : {})}
        {...(props.roleLabel ? { roleLabel: props.roleLabel } : {})}
        onNavigate={handleNavigate}
        {...(onAdvanceStage ? { onAdvanceStage } : {})}
      />
    </div>
  );
}

function isRoleColumn(roles: readonly RoleColumn[], id: string): boolean {
  return roles.some((r) => r.id === id);
}
