// ApprovalService: registra a aprovacao consciente de uma Previa_Publica e a
// ciencia individual de cada Aviso, produzindo um Approval valido OU uma
// rejeicao tipada que lista todas as condicoes que impedem a aprovacao.
//
// Objetivo (Requisitos 8.6-8.11; design.md componente `ApprovalService`:
// "Ciencia de avisos e aprovacao" / "Invalida quando hash da revisao muda"):
//
//   8.6  QUANDO a Previa_Publica contiver Avisos, o Aprovador DEVE registrar
//        ciencia de CADA Aviso antes de permitir a aprovacao.
//   8.7  QUANDO o Aprovador confirmar uma Previa_Publica vinculada a versao
//        atual do Rascunho e sem Bloqueios, o sistema registra a identificacao
//        da previa, o periodo, a versao do Rascunho, a versao do
//        Conjunto_de_Regras_Ativo, o Aprovador, a data/hora e os Avisos
//        reconhecidos -> isso e exatamente o conteudo do `Approval` produzido.
//   8.8  SE o Rascunho mudar depois da aprovacao, a aprovacao anterior e
//        invalidada (ver `invalidateApprovalIfStale` no PreviewService). Aqui a
//        aprovacao so e CRIADA quando a previa esta vinculada a revisao atual.
//   8.9  Divergencia de PERIODO entre a previa e o periodo de publicacao e um
//        bloqueio do Publicador; a aprovacao tambem exige periodo coincidente
//        quando um periodo de publicacao e informado.
//   8.10 SE o Aprovador tentar aprovar sem Previa_Publica da versao atual, com
//        Bloqueios, ou sem ciencia de CADA Aviso, a aprovacao e rejeitada e
//        cada condicao que impede a aprovacao e informada.
//   8.11 QUANDO o Operador aprovar, ele e registrado como Aprovador da MESMA
//        Previa_Publica (o `Approval.previewId` aponta para a previa aprovada e
//        `approverId` e o operador que aprovou).
//
// Esta funcao e PURA e deterministica: nao faz I/O, nao muta a entrada e nao
// altera a Escala vigente nem a previa. Reusa os modelos canonicos
// (`Preview`, `ValidationReport`, `Approval`) e o `PreviewService` para a
// invalidacao por mudanca de revisao; NENHUM modelo paralelo e criado.
//
// Casos com zero, um e varios Avisos passam SOMENTE quando todas as condicoes
// estao atendidas (validacao objetiva da tarefa 10.2).

import type {
  Approval,
  Preview,
  Uuid,
  ValidationReport,
} from '../schemas/models';
import { SCHEMA_VERSION } from '../schemas/models';

// --------------------------------------------------------------------------
// Entrada e saida
// --------------------------------------------------------------------------

/**
 * Pedido de aprovacao de uma Previa_Publica. Reune os artefatos reais do ciclo:
 * a previa a ser aprovada, o relatorio de validacao da revisao e a
 * identificacao da revisao/rule set/periodo ATUAIS a que a aprovacao precisa
 * corresponder.
 */
export interface ApprovalRequest {
  /** Previa_Publica que o Aprovador pretende confirmar (8.11). */
  readonly preview: Preview;
  /**
   * Relatorio da validacao completa sobre a revisao validada da previa. A
   * presenca de qualquer Bloqueio ou um relatorio nao concluido impede a
   * aprovacao (8.10).
   */
  readonly report: ValidationReport;
  /** Revisao ATUAL do rascunho vinculada ao ciclo (fonte da verdade). */
  readonly currentDraftRevision: string;
  /** Versao ATUAL do Conjunto_de_Regras_Ativo vinculada ao ciclo. */
  readonly currentRuleSetVersion: string;
  /**
   * Periodo selecionado para publicacao (`YYYY-MM`). Quando informado, deve
   * coincidir com o periodo da previa (8.9). Opcional: a aprovacao pode ocorrer
   * antes de o Publicador fixar o periodo, caso em que nao ha o que divergir.
   */
  readonly publicationPeriod?: string;
  /**
   * Avisos que o Aprovador declarou ter ciencia. A aprovacao so e permitida
   * quando este conjunto cobre CADA Aviso do relatorio (8.6).
   */
  readonly acknowledgedWarningIds: readonly Uuid[];
  /** Identificacao da nova aprovacao. */
  readonly approvalId: Uuid;
  /** Operador que aprova; sera registrado como Aprovador (8.11). */
  readonly approverId: Uuid;
  /** Instante civil (`YYYY-MM-DD`) da aprovacao (8.7). */
  readonly approvedAt: string;
}

/** Cada condicao objetiva que pode impedir a aprovacao (8.10). */
export type ApprovalRejectionReason =
  /** A previa nao esta vinculada a revisao ATUAL do rascunho (8.8, 8.10). */
  | { readonly kind: 'preview-stale-revision'; readonly previewRevision: string; readonly currentRevision: string }
  /** A previa referencia um rule set diferente do ATUAL (8.10). */
  | { readonly kind: 'preview-stale-ruleset'; readonly previewRuleSetVersion: string; readonly currentRuleSetVersion: string }
  /** O relatorio de validacao e de outra revisao que nao a da previa (8.10). */
  | { readonly kind: 'report-revision-mismatch'; readonly reportRevision: string; readonly previewRevision: string }
  /** O relatorio de validacao e de outro rule set que nao o da previa (8.10). */
  | { readonly kind: 'report-ruleset-mismatch'; readonly reportRuleSetVersion: string; readonly previewRuleSetVersion: string }
  /** A validacao completa nao terminou (status !== 'complete') (8.10). */
  | { readonly kind: 'validation-incomplete'; readonly status: ValidationReport['status'] }
  /** Existem Bloqueios na revisao validada (8.10). */
  | { readonly kind: 'has-blocking'; readonly blockingCount: number }
  /** Nem todos os Avisos foram reconhecidos; lista os pendentes (8.6, 8.10). */
  | { readonly kind: 'warnings-not-acknowledged'; readonly missingWarningIds: readonly Uuid[] }
  /** O periodo de publicacao diverge do periodo da previa (8.9). */
  | { readonly kind: 'period-mismatch'; readonly previewPeriod: string; readonly publicationPeriod: string };

/**
 * Resultado da aprovacao: ou um `Approval` valido e completo (8.7), ou a lista
 * COMPLETA de condicoes que impedem a aprovacao (8.10). A rejeicao e tipada e
 * acumula todas as falhas, para que o Aprovador veja cada condicao de uma vez.
 */
export type ApprovalResult =
  | { readonly ok: true; readonly approval: Approval }
  | { readonly ok: false; readonly reasons: readonly ApprovalRejectionReason[] };

// --------------------------------------------------------------------------
// Aprovacao consciente
// --------------------------------------------------------------------------

/**
 * Avalia TODAS as condicoes objetivas de 8.6-8.11 e, somente quando todas sao
 * atendidas, produz um `Approval` com `status: 'valid'` contendo o Aprovador,
 * as versoes (revisao do rascunho + rule set), a data/hora e os Avisos
 * reconhecidos (8.7). Caso contrario, retorna a lista completa de rejeicoes.
 *
 * Pureza: nao muta `request`, `preview` nem `report`. Determinismo: a mesma
 * entrada produz sempre o mesmo resultado (as listas de avisos faltantes e de
 * reconhecidos sao ordenadas de forma estavel).
 */
export function approvePreview(request: ApprovalRequest): ApprovalResult {
  const { preview, report } = request;
  const reasons: ApprovalRejectionReason[] = [];

  // (8.8/8.10) A previa precisa estar vinculada a revisao ATUAL do rascunho.
  if (preview.draftRevision !== request.currentDraftRevision) {
    reasons.push({
      kind: 'preview-stale-revision',
      previewRevision: preview.draftRevision,
      currentRevision: request.currentDraftRevision,
    });
  }

  // (8.10) A previa precisa referenciar o rule set ATUAL.
  if (preview.ruleSetVersion !== request.currentRuleSetVersion) {
    reasons.push({
      kind: 'preview-stale-ruleset',
      previewRuleSetVersion: preview.ruleSetVersion,
      currentRuleSetVersion: request.currentRuleSetVersion,
    });
  }

  // (8.10) O relatorio de validacao precisa ser da MESMA revisao da previa:
  // aprovar com base em uma validacao de outra revisao nao prova ausencia de
  // Bloqueios para a revisao que sera publicada.
  if (report.draftRevision !== preview.draftRevision) {
    reasons.push({
      kind: 'report-revision-mismatch',
      reportRevision: report.draftRevision,
      previewRevision: preview.draftRevision,
    });
  }

  // (8.10) O relatorio precisa ser do MESMO rule set da previa.
  if (report.ruleSetVersion !== preview.ruleSetVersion) {
    reasons.push({
      kind: 'report-ruleset-mismatch',
      reportRuleSetVersion: report.ruleSetVersion,
      previewRuleSetVersion: preview.ruleSetVersion,
    });
  }

  // (8.10) A validacao completa precisa ter terminado.
  if (report.status !== 'complete') {
    reasons.push({ kind: 'validation-incomplete', status: report.status });
  }

  // (8.10) Nenhum Bloqueio pode existir na revisao validada.
  if (report.blocking.length > 0) {
    reasons.push({ kind: 'has-blocking', blockingCount: report.blocking.length });
  }

  // (8.6/8.10) Cada Aviso do relatorio precisa ter ciencia registrada. O
  // conjunto reconhecido precisa COBRIR o conjunto de avisos; avisos extra
  // reconhecidos sao irrelevantes, mas nenhum aviso real pode faltar.
  const acknowledged = new Set(request.acknowledgedWarningIds);
  const missingWarningIds = report.warnings
    .map((w) => w.findingId)
    .filter((id) => !acknowledged.has(id))
    .sort(compareString);
  if (missingWarningIds.length > 0) {
    reasons.push({ kind: 'warnings-not-acknowledged', missingWarningIds });
  }

  // (8.9) Quando um periodo de publicacao e informado, ele deve coincidir com o
  // periodo da previa.
  if (
    request.publicationPeriod !== undefined &&
    request.publicationPeriod !== preview.period
  ) {
    reasons.push({
      kind: 'period-mismatch',
      previewPeriod: preview.period,
      publicationPeriod: request.publicationPeriod,
    });
  }

  if (reasons.length > 0) {
    return { ok: false, reasons };
  }

  // (8.7/8.11) Todas as condicoes atendidas: registra a aprovacao consciente.
  // Os Avisos reconhecidos gravados sao EXATAMENTE os avisos reais do relatorio
  // (sem avisos espurios que o chamador possa ter enviado a mais), em ordem
  // estavel e sem duplicidade, mantendo o registro fiel a ciencia exigida.
  const recordedWarningIds = dedupeSorted(report.warnings.map((w) => w.findingId));

  const approval: Approval = {
    schemaVersion: SCHEMA_VERSION,
    id: request.approvalId,
    previewId: preview.previewId, // (8.11) mesma Previa_Publica aprovada
    cycleId: preview.cycleId,
    draftRevision: preview.draftRevision,
    ruleSetVersion: preview.ruleSetVersion,
    acknowledgedWarningIds: recordedWarningIds,
    approverId: request.approverId, // (8.11) operador registrado como Aprovador
    approvedAt: request.approvedAt,
    status: 'valid',
  };

  return { ok: true, approval };
}

// --------------------------------------------------------------------------
// Auxiliares internos
// --------------------------------------------------------------------------

/** Ordenacao determinista e estavel de strings. */
function compareString(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** Remove duplicatas e ordena de forma estavel, para registro determinista. */
function dedupeSorted(ids: readonly Uuid[]): Uuid[] {
  return [...new Set(ids)].sort(compareString);
}
