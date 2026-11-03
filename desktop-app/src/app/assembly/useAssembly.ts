// Hook React que adapta o helper puro de elegibilidade (dominio) ao estado da
// grade de montagem (tarefa 6.1).
//
// O hook NAO cria um modelo paralelo nem aceita JSON livre: ele detem o
// `ScheduleDraft` canonico como estado e delega todo calculo de elegibilidade e
// toda mudanca de atribuicao ao modulo `domain/eligibility`. Quando o dominio
// rejeita (RF sem excecao, preferencia sem justificativa, nao elegivel), o
// rascunho anterior e preservado (o helper e puro e so devolve novo rascunho em
// sucesso) e o erro e repassado para a UI exibir inline.

import { useCallback, useMemo, useRef, useState } from 'react';
import {
  applyAssignmentChange,
  evaluateCell,
  type ApplyResult,
  type AssignmentChange,
  type CellEvaluation,
  type DepartmentResponsibilityRule,
  type EligibilityContext,
} from '../../domain/eligibility';
import type { ScheduleDraft } from '../../domain/schemas/models';
import { newUuid } from '../registry/ids';

export interface UseAssembly {
  draft: ScheduleDraft;
  /** Avalia uma celula (culto x funcao) contra o rascunho corrente. */
  evaluate: (serviceId: string, roleId: string) => CellEvaluation;
  /** Aplica incluir/substituir/remover; publica novo rascunho em sucesso. */
  apply: (change: Omit<AssignmentChange, 'newId'>) => ApplyResult;
}

/**
 * `contextFactory` recebe o rascunho corrente e devolve o `EligibilityContext`
 * completo (cadastro, regras, insumos, indisponibilidade, historico). Isso
 * mantem o hook agnostico das fontes e deterministico nos testes.
 */
export function useAssembly(
  initialDraft: ScheduleDraft,
  contextFactory: (draft: ScheduleDraft) => EligibilityContext,
  departmentRule?: DepartmentResponsibilityRule,
): UseAssembly {
  const factoryRef = useRef(contextFactory);
  factoryRef.current = contextFactory;

  const [draft, setDraft] = useState<ScheduleDraft>(initialDraft);

  const evaluate = useCallback(
    (serviceId: string, roleId: string): CellEvaluation => {
      const ctx = factoryRef.current(draft);
      return evaluateCell(ctx, serviceId, roleId, departmentRule);
    },
    [draft, departmentRule],
  );

  const apply = useCallback(
    (change: Omit<AssignmentChange, 'newId'>): ApplyResult => {
      const ctx = factoryRef.current(draft);
      const result = applyAssignmentChange(ctx, { ...change, newId: newUuid }, departmentRule);
      if (result.ok) setDraft(result.draft);
      return result;
    },
    [draft, departmentRule],
  );

  return useMemo(() => ({ draft, evaluate, apply }), [draft, evaluate, apply]);
}
