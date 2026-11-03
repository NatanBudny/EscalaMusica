// CycleService: abertura e controle do Ciclo_Mensal e o assistente das sete
// etapas (design.md -> "Components and Interfaces" -> CycleService; "Fluxo
// mensal na interface").
//
// TypeScript puro, sem I/O, deterministico. Toda operacao:
//  - nunca muta a entrada (retorna um novo estado em caso de sucesso);
//  - retorna um resultado tipado; em falha, preserva o estado anterior
//    (ausencia de mutacao).
//
// Requisitos cobertos:
//  1.4  apresentar as sete etapas na ordem fixa.
//  1.5  identificar a etapa atual e, por pendencia bloqueante, a acao nao
//       concluida e o motivo que impede o avanco.
//  1.6  ao concluir uma etapa, registrar etapa, resultado, data/hora e operador.
//  2.1  abrir ano 1-9999 e mes 1-12 cria exatamente um ciclo unico por periodo.
//  2.2  periodo ja existente: abre o unico ciclo sem criar outro nem alterar
//       dados/rascunho/estado (idempotencia).
//  2.3  ao criar, gera exatamente uma ocorrencia de cada quarta/sabado/domingo
//       do mes, sem outros dias.
//  2.4  culto extraordinario com data valida do periodo inclui exatamente uma
//       ocorrencia sem alterar as datas existentes.
//  2.5  remocao de data com motivo 1-500 (apos trim) remove e registra o motivo.
//  2.6  associa a cada data o dia da semana gregoriano.
//  2.7  dia da semana informado divergente do calculado bloqueia a alteracao e
//       preserva o estado anterior.
//  2.8  estado exclusivo aberto|publicado|arquivado com a semantica definida.
//  2.9  ano/mes fora do intervalo rejeita e indica o valor invalido.
//  2.10 motivo ausente, so espacos ou > 500 (apos trim) impede a remocao.

import { SCHEMA_VERSION } from '../schemas/models';
import type {
  CycleStage,
  IsoDate,
  MonthlyCycle,
  Service,
  ServiceRemoval,
  StageCompletion,
  Uuid,
  Weekday,
} from '../schemas/models';
import {
  generateAutomaticDates,
  isValidMonth,
  isValidYear,
  parseIsoDate,
  toPeriod,
  weekdayOf,
} from './calendar';

// --------------------------------------------------------------------------
// Resultado tipado
// --------------------------------------------------------------------------

export type CycleErrorCode =
  | 'year-out-of-range'
  | 'month-out-of-range'
  | 'date-not-in-period'
  | 'date-invalid'
  | 'weekday-mismatch'
  | 'duplicate-date'
  | 'service-not-found'
  | 'service-already-removed'
  | 'removal-reason-length'
  | 'stage-precondition'
  | 'stage-not-current';

export interface CycleError {
  code: CycleErrorCode;
  /** Mensagem legivel em portugues. */
  message: string;
  /** Valor que causou a rejeicao, quando aplicavel (Requisito 2.9). */
  offendingValue?: string;
}

export type CycleResult<T> = { ok: true; value: T } | { ok: false; error: CycleError };

const ok = <T>(value: T): CycleResult<T> => ({ ok: true, value });
const fail = <T>(error: CycleError): CycleResult<T> => ({ ok: false, error });

// --------------------------------------------------------------------------
// Estado agregado do ciclo (ciclo + seus cultos materializados)
// --------------------------------------------------------------------------

/**
 * O `MonthlyCycle` persistido guarda `serviceIds`; os `Service` ficam em
 * arquivos proprios (design.md, estrutura de repositorio). Para operacoes puras
 * de dominio tratamos o conjunto como um agregado coeso.
 */
export interface CycleAggregate {
  cycle: MonthlyCycle;
  services: Service[];
}

export interface OpenCycleInput {
  /** Ano inteiro de 1 a 9999 (Requisito 2.1). */
  year: number;
  /** Mes inteiro de 1 a 12 (Requisito 2.1). */
  month: number;
  /** ID a atribuir quando o ciclo for criado (UUID). */
  cycleId: Uuid;
  /** Versao do conjunto de regras ativo associada ao ciclo (Requisito 6.2). */
  ruleSetVersionId: Uuid;
  /** Gera o ID de cada culto a partir do indice cronologico (0-based). */
  serviceId: (index: number) => Uuid;
  /** Revisao inicial do rascunho (hash do rascunho vazio). */
  initialDraftRevision: string;
  /** Instante UTC de criacao. */
  now: string;
}

// --------------------------------------------------------------------------
// Ordem fixa das sete etapas (Requisito 1.4)
// --------------------------------------------------------------------------

export const STAGE_ORDER: readonly CycleStage[] = [
  'opening',
  'collection',
  'assembly',
  'validation',
  'approval',
  'publication',
  'closing',
];

/** Indice da etapa na ordem fixa (−1 se desconhecida). */
export function stageIndex(stage: CycleStage): number {
  return STAGE_ORDER.indexOf(stage);
}

// --------------------------------------------------------------------------
// Abertura idempotente (Requisitos 2.1, 2.2, 2.3, 2.6, 2.9)
// --------------------------------------------------------------------------

/**
 * Abre um Ciclo_Mensal para (ano, mes).
 *
 * - Se `existing` for null, cria exatamente um ciclo novo com as datas
 *   geradas automaticamente (quartas/sabados/domingos).
 * - Se `existing` ja corresponder ao periodo, retorna o MESMO agregado sem
 *   nenhuma alteracao (idempotencia, Requisito 2.2).
 *
 * Rejeita ano/mes fora do intervalo e indica o valor invalido (Requisito 2.9).
 * Funcao pura: nunca muta `existing`.
 */
export function openCycle(
  input: OpenCycleInput,
  existing: CycleAggregate | null,
): CycleResult<CycleAggregate> {
  if (!isValidYear(input.year)) {
    return fail({
      code: 'year-out-of-range',
      message: `ano deve ser um inteiro de 1 a 9999; recebido: ${String(input.year)}`,
      offendingValue: String(input.year),
    });
  }
  if (!isValidMonth(input.month)) {
    return fail({
      code: 'month-out-of-range',
      message: `mes deve ser um inteiro de 1 a 12; recebido: ${String(input.month)}`,
      offendingValue: String(input.month),
    });
  }

  const period = toPeriod(input.year, input.month);

  // Idempotencia: periodo ja existente retorna o ciclo intacto (Requisito 2.2).
  if (existing !== null) {
    if (existing.cycle.period === period) {
      return ok(existing);
    }
    // Um agregado de outro periodo nao e o ciclo pedido; ainda assim nao
    // alteramos o existente. O chamador deve fornecer o agregado do periodo
    // correto ou null. Tratamos como criacao de um ciclo novo e distinto.
  }

  // Criacao: gera exatamente as datas automaticas (Requisitos 2.3, 2.6).
  const dates = generateAutomaticDates(input.year, input.month);
  const services: Service[] = dates.map((d, i) => ({
    schemaVersion: SCHEMA_VERSION,
    id: input.serviceId(i),
    cycleId: input.cycleId,
    date: d.date,
    computedWeekday: d.weekday,
    kind: 'regular',
    externalInputIds: [],
  }));

  const cycle: MonthlyCycle = {
    schemaVersion: SCHEMA_VERSION,
    id: input.cycleId,
    period,
    state: 'open',
    stage: 'opening',
    ruleSetVersionId: input.ruleSetVersionId,
    currentDraftRevision: input.initialDraftRevision,
    serviceIds: services.map((s) => s.id),
    stageCompletions: [],
    createdAt: input.now,
    updatedAt: input.now,
  };

  return ok({ cycle, services });
}

// --------------------------------------------------------------------------
// Culto extraordinario (Requisitos 2.4, 2.6, 2.7)
// --------------------------------------------------------------------------

export interface AddExtraordinaryInput {
  date: IsoDate;
  serviceId: Uuid;
  /**
   * Dia da semana informado pelo operador. Quando presente, deve coincidir com
   * o dia calculado pelo calendario (Requisito 2.7); divergencia bloqueia.
   */
  declaredWeekday?: Weekday;
  now: string;
}

/**
 * Inclui exatamente uma ocorrencia de um culto extraordinario com data valida
 * pertencente ao periodo do ciclo, sem alterar as datas existentes.
 *
 * Rejeita (preservando o estado):
 *  - data fora do periodo do ciclo (date-not-in-period);
 *  - data civil invalida (date-invalid);
 *  - data ja presente entre os cultos ativos (duplicate-date);
 *  - dia da semana informado divergente do calculado (weekday-mismatch, 2.7).
 */
export function addExtraordinaryService(
  aggregate: CycleAggregate,
  input: AddExtraordinaryInput,
): CycleResult<CycleAggregate> {
  const parsed = parseIsoDate(input.date);
  if (parsed === null) {
    return fail({
      code: 'date-invalid',
      message: `data invalida: ${input.date}`,
      offendingValue: input.date,
    });
  }

  const period = toPeriod(parsed.year, parsed.month);
  if (period !== aggregate.cycle.period) {
    return fail({
      code: 'date-not-in-period',
      message: `a data ${input.date} nao pertence ao periodo ${aggregate.cycle.period}`,
      offendingValue: input.date,
    });
  }

  const computedWeekday = weekdayOf(parsed.year, parsed.month, parsed.day);
  if (input.declaredWeekday !== undefined && input.declaredWeekday !== computedWeekday) {
    // Requisito 2.7: divergencia bloqueia a confirmacao e preserva o estado.
    return fail({
      code: 'weekday-mismatch',
      message:
        `dia da semana informado (${input.declaredWeekday}) difere do calculado ` +
        `(${computedWeekday}) para a data ${input.date}`,
      offendingValue: input.declaredWeekday,
    });
  }

  // Nao duplicar uma data ja presente entre os cultos ativos (nao removidos).
  const clashesActive = aggregate.services.some(
    (s) => s.removed === undefined && s.date === input.date,
  );
  if (clashesActive) {
    return fail({
      code: 'duplicate-date',
      message: `ja existe um culto ativo para a data ${input.date}`,
      offendingValue: input.date,
    });
  }

  const service: Service = {
    schemaVersion: SCHEMA_VERSION,
    id: input.serviceId,
    cycleId: aggregate.cycle.id,
    date: input.date,
    computedWeekday,
    kind: 'extraordinary',
    externalInputIds: [],
  };

  const services = [...aggregate.services, service];
  const cycle: MonthlyCycle = {
    ...aggregate.cycle,
    serviceIds: services.map((s) => s.id),
    updatedAt: input.now,
  };
  return ok({ cycle, services });
}

// --------------------------------------------------------------------------
// Remocao motivada de data (Requisitos 2.5, 2.10)
// --------------------------------------------------------------------------

export const REMOVAL_REASON_MIN = 1;
export const REMOVAL_REASON_MAX = 500;

export interface RemoveServiceInput {
  serviceId: Uuid;
  /** Motivo da remocao; validado apos trim para 1-500 caracteres. */
  reason: string;
  operatorId: Uuid;
  now: string;
}

/**
 * Remove (logicamente) uma data gerada, registrando o motivo no ciclo. O motivo
 * e validado APOS a desconsideracao dos espacos nas extremidades (Requisitos
 * 2.5, 2.10): ausente, so espacos ou > 500 caracteres impedem a remocao e
 * preservam a data e seus dados.
 *
 * A remocao preserva o `Service` com o campo `removed` preenchido (exclusao
 * logica); o culto nao integra a revisao ativa (design.md), mas motivo e
 * auditoria sao preservados.
 */
export function removeService(
  aggregate: CycleAggregate,
  input: RemoveServiceInput,
): CycleResult<CycleAggregate> {
  const trimmed = input.reason.trim();
  if (trimmed.length < REMOVAL_REASON_MIN || trimmed.length > REMOVAL_REASON_MAX) {
    return fail({
      code: 'removal-reason-length',
      message:
        `o motivo deve ter de ${REMOVAL_REASON_MIN} a ${REMOVAL_REASON_MAX} ` +
        'caracteres apos a remocao dos espacos nas extremidades',
    });
  }

  const target = aggregate.services.find((s) => s.id === input.serviceId);
  if (target === undefined) {
    return fail({
      code: 'service-not-found',
      message: `culto nao encontrado: ${input.serviceId}`,
    });
  }
  if (target.removed !== undefined) {
    return fail({
      code: 'service-already-removed',
      message: `culto ja removido: ${input.serviceId}`,
    });
  }

  const removal: ServiceRemoval = {
    reason: trimmed,
    removedAt: input.now,
    operatorId: input.operatorId,
  };

  const services = aggregate.services.map((s) =>
    s.id === input.serviceId ? { ...s, removed: removal } : s,
  );
  const cycle: MonthlyCycle = { ...aggregate.cycle, updatedAt: input.now };
  return ok({ cycle, services });
}

// --------------------------------------------------------------------------
// Estado exclusivo (Requisito 2.8)
// --------------------------------------------------------------------------

/** Descricao observavel do estado exclusivo de um ciclo (Requisito 2.8). */
export interface CycleStateFacts {
  state: MonthlyCycle['state'];
  /** Rascunho editavel somente no estado aberto. */
  draftEditable: boolean;
  /** Corresponde a Escala vigente somente no estado publicado. */
  isCurrentSchedule: boolean;
  /** Somente leitura: publicado (sem edicao direta) ou arquivado. */
  readOnly: boolean;
}

/**
 * Deriva os fatos observaveis do estado exclusivo. Cada ciclo possui
 * exatamente um estado; esta funcao traduz o estado na semantica definida
 * (editabilidade e relacao com a Escala vigente).
 */
export function cycleStateFacts(cycle: MonthlyCycle): CycleStateFacts {
  switch (cycle.state) {
    case 'open':
      return { state: 'open', draftEditable: true, isCurrentSchedule: false, readOnly: false };
    case 'published':
      return {
        state: 'published',
        draftEditable: false,
        isCurrentSchedule: true,
        readOnly: true,
      };
    case 'archived':
      return {
        state: 'archived',
        draftEditable: false,
        isCurrentSchedule: false,
        readOnly: true,
      };
    default: {
      // Exaustividade: qualquer outro valor e invalido.
      const never: never = cycle.state;
      throw new Error(`estado de ciclo invalido: ${String(never)}`);
    }
  }
}

/** `true` quando o estado do ciclo e exatamente um dos tres permitidos. */
export function hasExclusiveState(cycle: MonthlyCycle): boolean {
  return cycle.state === 'open' || cycle.state === 'published' || cycle.state === 'archived';
}

// --------------------------------------------------------------------------
// Etapa atual, pendencias e avanco (Requisitos 1.4, 1.5, 1.6)
// --------------------------------------------------------------------------

/** Uma pendencia bloqueante da etapa atual (Requisito 1.5). */
export interface StagePending {
  /** Identificador estavel da pre-condicao nao atendida. */
  id: string;
  /** Acao nao concluida, em portugues. */
  action: string;
  /** Motivo que impede o avanco para a etapa seguinte, em portugues. */
  reason: string;
}

/**
 * Pre-condicoes da etapa atual. O chamador fornece os fatos observaveis do
 * ciclo (ex.: ha ao menos um culto ativo, validacao sem bloqueios, aprovacao
 * vigente etc.). O servico nao recalcula validacao/aprovacao: ele apenas
 * materializa as pendencias a partir de fatos, mantendo-se puro.
 */
export interface StageFacts {
  /** Existe ao menos um culto ativo (nao removido) no ciclo. */
  hasActiveService: boolean;
  /** Insumos externos obrigatorios foram coletados. */
  collectionComplete: boolean;
  /** Todas as atribuicoes exigidas estao preenchidas no rascunho. */
  assemblyComplete: boolean;
  /** Validacao completa da revisao atual terminou sem bloqueios. */
  validationCleared: boolean;
  /** Existe aprovacao vigente vinculada a revisao atual. */
  approvalValid: boolean;
  /** Publicacao foi confirmada publicamente. */
  publicationConfirmed: boolean;
}

/**
 * Calcula as pendencias bloqueantes da etapa atual a partir dos fatos. Vazio
 * quando a etapa atual pode avancar. A etapa `closing` so pode concluir depois
 * da publicacao confirmada; nao ha etapa seguinte depois dela.
 */
export function pendingForStage(stage: CycleStage, facts: StageFacts): StagePending[] {
  const pend: StagePending[] = [];
  switch (stage) {
    case 'opening':
      if (!facts.hasActiveService) {
        pend.push({
          id: 'opening.no-active-service',
          action: 'Gerar ou manter ao menos um culto ativo no periodo',
          reason: 'Nao ha culto ativo; o ciclo nao pode avancar para a coleta.',
        });
      }
      break;
    case 'collection':
      if (!facts.collectionComplete) {
        pend.push({
          id: 'collection.incomplete',
          action: 'Concluir a coleta dos insumos externos obrigatorios',
          reason: 'Faltam insumos externos obrigatorios para avancar para a montagem.',
        });
      }
      break;
    case 'assembly':
      if (!facts.assemblyComplete) {
        pend.push({
          id: 'assembly.incomplete',
          action: 'Preencher todas as atribuicoes exigidas do rascunho',
          reason: 'Ha atribuicoes exigidas em aberto; o rascunho ainda nao pode ser validado.',
        });
      }
      break;
    case 'validation':
      if (!facts.validationCleared) {
        pend.push({
          id: 'validation.has-blocking',
          action: 'Executar a validacao completa e resolver todos os bloqueios',
          reason: 'A validacao da revisao atual ainda possui bloqueios ou nao foi concluida.',
        });
      }
      break;
    case 'approval':
      if (!facts.validationCleared) {
        pend.push({
          id: 'approval.needs-validation',
          action: 'Concluir a validacao completa sem bloqueios',
          reason: 'A aprovacao exige uma validacao da revisao atual sem bloqueios.',
        });
      }
      if (!facts.approvalValid) {
        pend.push({
          id: 'approval.missing',
          action: 'Registrar a aprovacao da previa publica vinculada a revisao atual',
          reason: 'Nao ha aprovacao vigente vinculada a revisao atual.',
        });
      }
      break;
    case 'publication':
      if (!facts.approvalValid) {
        pend.push({
          id: 'publication.needs-approval',
          action: 'Obter uma aprovacao vigente antes de publicar',
          reason: 'A publicacao exige aprovacao vigente da revisao atual.',
        });
      }
      if (!facts.publicationConfirmed) {
        pend.push({
          id: 'publication.unconfirmed',
          action: 'Concluir e confirmar a publicacao no Site_Publico',
          reason: 'A publicacao ainda nao foi confirmada publicamente.',
        });
      }
      break;
    case 'closing':
      if (!facts.publicationConfirmed) {
        pend.push({
          id: 'closing.needs-publication',
          action: 'Confirmar a publicacao antes de fechar o ciclo',
          reason: 'O fechamento so e possivel apos a publicacao confirmada.',
        });
      }
      break;
    default: {
      const never: never = stage;
      throw new Error(`etapa invalida: ${String(never)}`);
    }
  }
  return pend;
}

/** Resumo apresentavel da etapa atual (Requisitos 1.4, 1.5). */
export interface WizardView {
  /** As sete etapas, sempre na ordem fixa. */
  stages: readonly CycleStage[];
  /** Etapa atual do ciclo. */
  currentStage: CycleStage;
  /** Proxima etapa, ou null quando a atual e `closing`. */
  nextStage: CycleStage | null;
  /** Pendencias bloqueantes da etapa atual (vazio se pode avancar). */
  pending: StagePending[];
  /** `true` quando a etapa atual nao tem pendencias bloqueantes. */
  canAdvance: boolean;
}

/** Monta a visao do assistente para a etapa atual do ciclo. */
export function wizardView(cycle: MonthlyCycle, facts: StageFacts): WizardView {
  const idx = stageIndex(cycle.stage);
  const nextStage =
    idx >= 0 && idx < STAGE_ORDER.length - 1 ? (STAGE_ORDER[idx + 1] as CycleStage) : null;
  const pending = pendingForStage(cycle.stage, facts);
  return {
    stages: STAGE_ORDER,
    currentStage: cycle.stage,
    nextStage,
    pending,
    canAdvance: pending.length === 0,
  };
}

// --------------------------------------------------------------------------
// Conclusao auditada da etapa e avanco (Requisitos 1.5, 1.6)
// --------------------------------------------------------------------------

export interface CompleteStageInput {
  /** Etapa que esta sendo concluida; deve ser a etapa atual do ciclo. */
  stage: CycleStage;
  /** Resultado observavel registrado na conclusao (Requisito 1.6). */
  result: string;
  operatorId: Uuid;
  now: string;
}

/**
 * Conclui a etapa atual e avanca para a seguinte, registrando no ciclo a etapa
 * concluida, o resultado, a data/hora e o operador (Requisito 1.6).
 *
 * Bloqueia (preservando o estado) quando:
 *  - a etapa informada nao e a etapa atual (stage-not-current);
 *  - a etapa atual possui pendencias bloqueantes (stage-precondition, 1.5).
 *
 * Concluir `closing` registra a conclusao sem avancar (nao ha etapa seguinte).
 */
export function completeStage(
  cycle: MonthlyCycle,
  facts: StageFacts,
  input: CompleteStageInput,
): CycleResult<MonthlyCycle> {
  if (input.stage !== cycle.stage) {
    return fail({
      code: 'stage-not-current',
      message: `a etapa informada (${input.stage}) nao e a etapa atual (${cycle.stage})`,
    });
  }

  const pending = pendingForStage(cycle.stage, facts);
  if (pending.length > 0) {
    const first = pending[0] as StagePending;
    return fail({
      code: 'stage-precondition',
      message: `${first.action}: ${first.reason}`,
    });
  }

  const completion: StageCompletion = {
    stage: cycle.stage,
    result: input.result,
    completedAt: input.now,
    operatorId: input.operatorId,
  };

  const idx = stageIndex(cycle.stage);
  const nextStage =
    idx >= 0 && idx < STAGE_ORDER.length - 1 ? (STAGE_ORDER[idx + 1] as CycleStage) : cycle.stage;

  const next: MonthlyCycle = {
    ...cycle,
    stage: nextStage,
    stageCompletions: [...cycle.stageCompletions, completion],
    updatedAt: input.now,
  };
  return ok(next);
}

/** Lista de cultos ativos (nao removidos) do agregado. */
export function activeServices(aggregate: CycleAggregate): Service[] {
  return aggregate.services.filter((s) => s.removed === undefined);
}
