// Hook React que integra o ValidationEngine puro ao estado da etapa de
// validacao da grade de montagem (tarefa 8.2).
//
// Este hook NAO cria um modelo paralelo de validacao: ele delega TODA a
// avaliacao ao `domain/validation` real (validateComplete / runAllChecks /
// validateIncremental) e apenas guarda, como estado React:
//   - o ultimo `ValidationReport` da revisao avaliada;
//   - os resultados por verificacao (`CheckResults`) usados para a reavaliacao
//     incremental (7.1);
//   - a revisao do rascunho que foi validada (para detectar quando o relatorio
//     fica DESATUALIZADO em relacao a revisao corrente).
//
// Requisitos cobertos (requirements.md):
//  1.5  etapa atual e, para cada pendencia bloqueante, a acao nao concluida e o
//       motivo que impede o avanco para a etapa seguinte (ver `blockingReasons`).
//  7.1  alterar um campo reavalia SOMENTE as regras que dependem desse campo e
//       substitui seus resultados (validacao incremental) — e, ate a nova
//       validacao terminar, o relatorio anterior fica marcado como desatualizado
//       (derivado invalido).
//  7.3  cada achado ja traz culto/data, funcao/campo, referencia, regra,
//       severidade, motivo e acao (produzido pelo engine; exibido pela UI).
//  7.23 enquanto houver Bloqueio ou a validacao completa da revisao atual nao
//       tiver terminado, a publicacao fica desabilitada (ver `canPublish` do
//       engine + `isStale`).
//  7.24 totais separados (bloqueios/avisos/aprovadas) e relacao individual (o
//       relatorio do engine ja os fornece).
//  8.1  zero bloqueios na validacao COMPLETA da revisao atual habilita apenas o
//       AVANCO para a proxima etapa — nunca a publicacao direta (ver
//       `canAdvanceStage` vs `canPublishNow`).

import { useCallback, useMemo, useState } from 'react';
import {
  canPublish as enginePermitsPublish,
  runAllChecks,
  validateComplete,
  validateIncremental,
  type CheckResults,
  type ValidatedField,
  type ValidationInput,
} from '../../domain/validation';
import type { Sha256, ValidationReport } from '../../domain/schemas/models';

/** Estado interno da ultima validacao concluida. */
interface ValidationState {
  report: ValidationReport;
  checks: CheckResults;
  /** Revisao do rascunho que foi efetivamente validada. */
  validatedRevision: Sha256;
}

export interface UseValidation {
  /** Ultimo relatorio concluido, ou `null` se ainda nao validou (7.24). */
  report: ValidationReport | null;
  /**
   * `true` quando o relatorio atual NAO corresponde a revisao corrente do
   * rascunho (um campo mudou e a revalidacao ainda nao rodou). Enquanto estiver
   * desatualizado, a publicacao e o avanco de etapa ficam desabilitados (7.1 /
   * 7.23): os resultados derivados sao considerados invalidos.
   */
  isStale: boolean;
  /**
   * Executa a validacao COMPLETA da revisao corrente (7.2). Use na primeira
   * validacao e sempre que quiser reavaliar tudo. Guarda os resultados por
   * verificacao para suportar a reavaliacao incremental seguinte.
   */
  validateAll: () => ValidationReport;
  /**
   * Reavalia SOMENTE as verificacoes dependentes dos `changedFields` (7.1) e
   * substitui seus resultados, preservando os demais. Quando ainda nao houve
   * validacao completa anterior, cai para a validacao completa. O relatorio
   * resultante e identico ao de uma validacao completa da nova revisao
   * (Property 25).
   */
  revalidate: (changedFields: readonly ValidatedField[]) => ValidationReport;
  /**
   * Marca o relatorio atual como DESATUALIZADO sem reavaliar. Chame quando um
   * campo do rascunho mudar mas a revalidacao for adiada: isso INVALIDA os
   * resultados derivados ate a proxima validacao (7.1), mantendo o gate fechado.
   */
  markStale: () => void;
  /**
   * 8.1: `true` somente quando a validacao COMPLETA da revisao ATUAL terminou
   * sem Bloqueios. Habilita apenas o AVANCO para a proxima etapa.
   */
  canAdvanceStage: boolean;
  /**
   * 7.23 + 8.1: a publicacao DIRETA a partir desta etapa e SEMPRE falsa. Zero
   * bloqueios habilita o avanco de etapa, nunca a publicacao — que e controlada
   * pela saga de publicacao e pelo feature gate em etapas posteriores.
   */
  canPublishNow: false;
  /**
   * Pendencias bloqueantes da revisao atual, com a acao nao concluida e o motivo
   * (1.5). Vazio quando a validacao completa terminou sem bloqueios e esta
   * atualizada. Quando o relatorio esta desatualizado, inclui uma pendencia de
   * "revalidar".
   */
  blockingReasons: BlockingReason[];
}

/** Pendencia bloqueante apresentada ao operador (1.5). */
export interface BlockingReason {
  /** Identificador do achado ou pseudo-id de pendencia operacional. */
  id: string;
  /** Regra/verificacao de origem (ou 'validacao' para pendencias do fluxo). */
  ruleId: string;
  /** Acao nao concluida necessaria para avancar. */
  requiredAction: string;
  /** Motivo que impede o avanco. */
  reason: string;
  /** Culto afetado, quando aplicavel (para navegar ate a celula). */
  serviceId?: string;
  /** Funcao/campo afetado, quando aplicavel. */
  roleOrField?: string;
}

/**
 * `inputFactory` recebe a revisao atual do rascunho e devolve o
 * `ValidationInput` completo (cultos, cadastro, regras, insumos,
 * indisponibilidade, estrutura). Mantem o hook agnostico das fontes e
 * deterministico nos testes. O `revision` e repassado para que o chamador possa
 * montar a entrada exatamente para a revisao corrente.
 */
export function useValidation(
  currentRevision: Sha256,
  inputFactory: (revision: Sha256) => ValidationInput,
): UseValidation {
  const [state, setState] = useState<ValidationState | null>(null);
  // Quando `true`, um campo mudou apos a ultima validacao e a revalidacao ainda
  // nao rodou: os resultados derivados estao invalidos (7.1).
  const [forcedStale, setForcedStale] = useState(false);

  const validateAll = useCallback((): ValidationReport => {
    const input = inputFactory(currentRevision);
    const checks = runAllChecks(input);
    const report = validateComplete(input);
    setState({ report, checks, validatedRevision: currentRevision });
    setForcedStale(false);
    return report;
  }, [currentRevision, inputFactory]);

  const revalidate = useCallback(
    (changedFields: readonly ValidatedField[]): ValidationReport => {
      const input = inputFactory(currentRevision);
      // Sem validacao completa anterior => completa (nao ha o que reusar).
      if (!state) {
        const checks = runAllChecks(input);
        const report = validateComplete(input);
        setState({ report, checks, validatedRevision: currentRevision });
        setForcedStale(false);
        return report;
      }
      const report = validateIncremental(input, state.checks, changedFields);
      // Reconstroi o mapa de verificacoes para a nova revisao (base do proximo
      // incremento), garantindo equivalencia com a completa (Property 25).
      const checks = runAllChecks(input);
      setState({ report, checks, validatedRevision: currentRevision });
      setForcedStale(false);
      return report;
    },
    [currentRevision, inputFactory, state],
  );

  const markStale = useCallback(() => {
    setForcedStale(true);
  }, []);

  const report = state?.report ?? null;

  // Desatualizado quando: foi marcado explicitamente, OU a revisao validada nao
  // e a revisao corrente, OU nunca validou.
  const isStale = useMemo(
    () => forcedStale || state === null || state.validatedRevision !== currentRevision,
    [forcedStale, state, currentRevision],
  );

  // 8.1: avanco de etapa somente com validacao COMPLETA da revisao ATUAL sem
  // bloqueios (e atualizada).
  const canAdvanceStage = useMemo(
    () => report !== null && !isStale && enginePermitsPublish(report),
    [report, isStale],
  );

  const blockingReasons = useMemo<BlockingReason[]>(() => {
    const reasons: BlockingReason[] = [];
    if (isStale) {
      // 7.1/7.23: enquanto a revisao atual nao for validada por completo, ha uma
      // pendencia bloqueante: revalidar.
      reasons.push({
        id: 'pendencia:revalidar',
        ruleId: 'validacao',
        requiredAction: 'execute a validacao completa da revisao atual',
        reason:
          report === null
            ? 'a revisao atual ainda nao foi validada por completo'
            : 'um campo mudou e os resultados anteriores nao valem para a revisao atual',
      });
    }
    if (report) {
      for (const f of report.blocking) {
        const r: BlockingReason = {
          id: f.findingId,
          ruleId: f.ruleId,
          requiredAction: f.requiredAction,
          reason: f.reason,
        };
        if (f.serviceId !== undefined) r.serviceId = f.serviceId;
        if (f.roleOrField !== undefined) r.roleOrField = f.roleOrField;
        reasons.push(r);
      }
    }
    return reasons;
  }, [isStale, report]);

  return useMemo(
    () => ({
      report,
      isStale,
      validateAll,
      revalidate,
      markStale,
      canAdvanceStage,
      canPublishNow: false as const,
      blockingReasons,
    }),
    [report, isStale, validateAll, revalidate, markStale, canAdvanceStage, blockingReasons],
  );
}
