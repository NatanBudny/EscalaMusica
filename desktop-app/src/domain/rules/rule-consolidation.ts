// Consolidacao versionada das fontes legadas de regras (tarefa 5.2).
//
// Objetivo (design.md -> "Migracao e homologacao", passo 5):
//   "Conciliar cada RF/RP/PE entre todas as fontes em uma grade de decisao.
//    Produzir `RuleSet v1` somente apos zerar pendencias e registrar
//    origem/decisao."
//
// Requisitos cobertos:
//  6.13 o Conjunto_de_Regras_Ativo e a UNICA fonte versionada; a consolidacao
//       nao deixa nenhuma fonte legada "vencer silenciosamente".
//  6.14 ao migrar as regras atuais, consolidar as regras reconhecidas em uma
//       unica versao inicial e registrar a ORIGEM e a DECISAO aplicada a cada
//       divergencia encontrada.
//  6.15 a versao resultante e a fonte unica; regras ausentes dela sao
//       rejeitadas pelo RuleSetService (ja implementado).
//  16.5 relatorio que, para cada regra de origem, apresenta identificacao e
//       classificacao (sem divergencia / divergencia resolvida / pendente) e,
//       para divergencias, o motivo e os dados afetados.
//  16.7 gates de homologacao: a versao inicial so e emitida com ZERO pendencias
//       e aprovacao registrada.
//  16.11 qualquer pendencia impede a confirmacao (emissao da versao inicial).
//
// INVARIANTES CENTRAIS:
//  - NENHUMA precedencia silenciosa: toda regra consolidada carrega um registro
//    de origem/decisao (SourceDecision) ligando-a as fontes que a propuseram e
//    a decisao aplicada. Divergencias nao resolvidas NUNCA sao resolvidas
//    automaticamente escolhendo uma fonte.
//  - IMUTABILIDADE: a emissao produz `RuleSet v1` por meio do RuleSetService
//    (defineVersion + approveVersion). Versoes aprovadas sao congeladas pelo
//    servico; nenhum modelo paralelo e criado.
//  - PUREZA: TypeScript puro, sem I/O. As fontes inventariadas sao recebidas
//    como entrada somente-leitura (os arquivos legados nao sao lidos nem
//    alterados por este modulo; o utilitario `scripts/inventario-legado.js`
//    permanece a unica leitura do legado).
//
// Este modulo REUSA `ApprovedRuleSet`, `Rule`, `SourceDecision` de
// `schemas/models.ts` e o `RuleSetService` existente. Nao redefine regras.

import { canonicalStringify } from '../schemas/canonical';
import type {
  ApprovedRuleSet,
  IsoDate,
  Rule,
  SourceDecision,
  Uuid,
  Utc,
} from '../schemas/models';
import { RuleSetService, type RuleSetError } from './rule-set-service';

// --------------------------------------------------------------------------
// Entradas: regras propostas por cada fonte legada inventariada
// --------------------------------------------------------------------------

/**
 * Uma proposta de regra vinda de UMA fonte legada inventariada. `source` e o
 * caminho inventariado (ex.: `docs/regras/REGRAS.md`), usado apenas como rotulo
 * de origem; este modulo nunca le o arquivo. `rule` e a regra reconhecida e
 * normalizada a partir daquela fonte.
 */
export interface SourceRuleProposal {
  /** Caminho/identificador da fonte inventariada (origem). */
  source: string;
  /** Regra reconhecida nessa fonte, no modelo canonico. */
  rule: Rule;
}

/**
 * Decisao explicita do Operador/Aprovador para resolver uma divergencia entre
 * fontes para uma mesma regra (mesmo `ruleId`). A decisao indica QUAL variante
 * prevalece (pela fonte escolhida) e registra uma justificativa.
 */
export interface ConflictResolution {
  ruleId: Uuid;
  /** Fonte cuja variante foi escolhida como oficial para a regra. */
  chosenSource: string;
  /** Justificativa da escolha (registrada na origem/decisao). */
  justification: string;
}

// --------------------------------------------------------------------------
// Grade de decisao: um item por regra reconhecida
// --------------------------------------------------------------------------

export type DecisionStatus =
  /** A regra aparece em uma unica fonte ou em fontes identicas: sem conflito. */
  | 'agreed'
  /** Fontes divergem e uma decisao explicita foi aplicada. */
  | 'resolved'
  /** Fontes divergem e NAO ha decisao explicita: pendente (bloqueia emissao). */
  | 'pending';

/** Variante de uma regra tal como proposta por uma ou mais fontes. */
export interface RuleVariant {
  /** Chave canonica estavel do conteudo da regra (JSON canonico). */
  contentKey: string;
  /** Fontes que propuseram exatamente esta variante (ordem estavel). */
  sources: string[];
  /** A regra desta variante. */
  rule: Rule;
}

/**
 * Item da grade de decisao para UMA regra reconhecida (identificada por
 * `ruleId`). Liga a regra a todas as suas fontes e descreve o resultado da
 * conciliacao (16.5).
 */
export interface DecisionItem {
  ruleId: Uuid;
  /** Todas as fontes que mencionaram esta regra (ordem estavel). */
  sources: string[];
  /** Variantes distintas encontradas entre as fontes. */
  variants: RuleVariant[];
  status: DecisionStatus;
  /**
   * Fonte escolhida quando `status === 'resolved'`. Ausente em `agreed`
   * (nao ha escolha a fazer) e em `pending`.
   */
  chosenSource?: string;
  /** Justificativa da decisao, quando resolvida. */
  justification?: string;
  /** A regra que prevalece (quando `agreed` ou `resolved`). */
  effectiveRule?: Rule;
  /** Motivo legivel do item (sem divergencia / divergencia / pendencia). */
  reason: string;
}

/**
 * Relatorio de conciliacao (16.5): um item por regra reconhecida, ligando cada
 * regra a sua origem e a decisao, com totais por classificacao. Este relatorio
 * torna impossivel uma precedencia silenciosa: toda regra divergente aparece
 * explicitamente como `resolved` (com fonte/justificativa) ou `pending`.
 */
export interface ConsolidationReport {
  items: DecisionItem[];
  totals: {
    recognized: number;
    agreed: number;
    resolved: number;
    pending: number;
  };
  /** Ids das regras ainda pendentes (bloqueiam a emissao da versao inicial). */
  pendingRuleIds: Uuid[];
}

// --------------------------------------------------------------------------
// Resultado tipado
// --------------------------------------------------------------------------

export type ConsolidationErrorCode =
  /** Ha ao menos uma divergencia pendente (16.7, 16.11). */
  | 'pending-divergences'
  /** A resolucao referencia uma regra/fonte inexistente. */
  | 'invalid-resolution'
  /** Falha ao emitir a versao via RuleSetService (predicado/conflito/etc.). */
  | 'rule-set-error';

export interface ConsolidationError {
  code: ConsolidationErrorCode;
  message: string;
  /** Ids pendentes, quando `pending-divergences`. */
  pendingRuleIds?: Uuid[];
  /** Erro subjacente do RuleSetService, quando `rule-set-error`. */
  ruleSetError?: RuleSetError;
}

export type ConsolidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: ConsolidationError };

// --------------------------------------------------------------------------
// Conciliacao: construcao da grade de decisao
// --------------------------------------------------------------------------

/**
 * Compara cada regra reconhecida entre TODAS as fontes inventariadas e produz a
 * grade de decisao. Agrupa por `ruleId`; dentro de cada grupo, agrupa por
 * conteudo canonico (variantes). Uma unica variante => `agreed`; multiplas
 * variantes => `pending`, salvo quando uma `ConflictResolution` aplicavel a
 * tornar `resolved`.
 *
 * Funcao PURA e deterministica: a ordem de `proposals` nao altera o resultado
 * (regras e fontes sao ordenadas de forma estavel).
 */
export function reconcileSources(
  proposals: readonly SourceRuleProposal[],
  resolutions: readonly ConflictResolution[] = [],
): ConsolidationReport {
  const resolutionByRule = new Map<Uuid, ConflictResolution>();
  for (const r of resolutions) resolutionByRule.set(r.ruleId, r);

  // Agrupa propostas por ruleId.
  const byRule = new Map<Uuid, SourceRuleProposal[]>();
  for (const p of proposals) {
    const list = byRule.get(p.rule.id) ?? [];
    list.push(p);
    byRule.set(p.rule.id, list);
  }

  const items: DecisionItem[] = [];
  for (const ruleId of [...byRule.keys()].sort(compareStrings)) {
    const group = byRule.get(ruleId) as SourceRuleProposal[];
    const item = buildDecisionItem(ruleId, group, resolutionByRule.get(ruleId));
    items.push(item);
  }

  const totals = {
    recognized: items.length,
    agreed: items.filter((i) => i.status === 'agreed').length,
    resolved: items.filter((i) => i.status === 'resolved').length,
    pending: items.filter((i) => i.status === 'pending').length,
  };
  const pendingRuleIds = items.filter((i) => i.status === 'pending').map((i) => i.ruleId);

  return { items, totals, pendingRuleIds };
}

function buildDecisionItem(
  ruleId: Uuid,
  group: readonly SourceRuleProposal[],
  resolution: ConflictResolution | undefined,
): DecisionItem {
  // Agrupa por conteudo canonico (variantes distintas).
  const variantByKey = new Map<string, RuleVariant>();
  for (const p of group) {
    const key = canonicalStringify(p.rule);
    const existing = variantByKey.get(key);
    if (existing) {
      if (!existing.sources.includes(p.source)) existing.sources.push(p.source);
    } else {
      variantByKey.set(key, { contentKey: key, sources: [p.source], rule: clone(p.rule) });
    }
  }

  const variants = [...variantByKey.values()]
    .map((v) => ({ ...v, sources: [...v.sources].sort(compareStrings) }))
    .sort((a, b) => compareStrings(a.contentKey, b.contentKey));

  const sources = [...new Set(group.map((p) => p.source))].sort(compareStrings);

  // Caso 1: uma unica variante => acordo (sem conflito).
  if (variants.length === 1) {
    const only = variants[0] as RuleVariant;
    return {
      ruleId,
      sources,
      variants,
      status: 'agreed',
      effectiveRule: clone(only.rule),
      reason:
        sources.length === 1
          ? `regra reconhecida em uma unica fonte (${sources[0]}), sem divergencia`
          : `regra identica em ${sources.length} fontes, sem divergencia`,
    };
  }

  // Caso 2: multiplas variantes => conflito. Resolve so com decisao explicita.
  if (resolution) {
    const chosen = variants.find((v) => v.sources.includes(resolution.chosenSource));
    if (chosen) {
      return {
        ruleId,
        sources,
        variants,
        status: 'resolved',
        chosenSource: resolution.chosenSource,
        justification: resolution.justification,
        effectiveRule: clone(chosen.rule),
        reason:
          `divergencia entre ${variants.length} variantes (fontes: ${sources.join(', ')}) ` +
          `resolvida pela fonte ${resolution.chosenSource}`,
      };
    }
    // Resolucao aponta para fonte que nao propos esta regra: permanece pendente.
  }

  return {
    ruleId,
    sources,
    variants,
    status: 'pending',
    reason:
      `divergencia nao resolvida entre ${variants.length} variantes ` +
      `(fontes: ${sources.join(', ')}); exige decisao explicita`,
  };
}

// --------------------------------------------------------------------------
// Emissao da versao inicial (RuleSet v1)
// --------------------------------------------------------------------------

export interface EmitInitialRuleSetInput {
  /** Fontes inventariadas (propostas de regra), somente leitura. */
  proposals: readonly SourceRuleProposal[];
  /** Decisoes explicitas para divergencias. */
  resolutions?: readonly ConflictResolution[];
  /** Identificadores da nova versao (reuso de ApprovedRuleSet via servico). */
  versionId: Uuid;
  versionLabel: string;
  validFrom: IsoDate;
  validUntil?: IsoDate;
  /** Aprovacao obrigatoria da versao inicial (16.7). */
  approvedBy: Uuid;
  approvedAt: Utc;
  now: Utc;
}

export interface EmitInitialRuleSetOutput {
  ruleSet: ApprovedRuleSet;
  report: ConsolidationReport;
}

/**
 * Emite `RuleSet v1` a partir das fontes inventariadas e das decisoes. Emite a
 * versao SOMENTE quando:
 *   (a) a grade de decisao nao possui NENHUMA pendencia (16.7, 16.11); e
 *   (b) uma aprovacao e registrada (approvedBy + approvedAt) ao criar a versao.
 *
 * O resultado inclui `sourceDecisions`: um registro por regra ligando a regra a
 * suas fontes e a decisao aplicada (6.14) — tornando impossivel uma precedencia
 * silenciosa. A imutabilidade e garantida pelo RuleSetService (versoes
 * aprovadas sao congeladas).
 *
 * Em caso de pendencia, nada e emitido: retorna o relatorio para a grade de
 * decisao e preserva a ausencia de versao ativa.
 */
export function emitInitialRuleSet(
  service: RuleSetService,
  input: EmitInitialRuleSetInput,
): ConsolidationResult<EmitInitialRuleSetOutput> {
  const report = reconcileSources(input.proposals, input.resolutions ?? []);

  // Valida que toda resolucao referencia uma regra divergente real (nao cria
  // decisao sobre regra inexistente / sem conflito).
  const resolutionCheck = validateResolutions(report, input.resolutions ?? []);
  if (resolutionCheck) return { ok: false, error: resolutionCheck };

  // Gate 16.7/16.11: zero pendencias.
  if (report.totals.pending > 0) {
    return {
      ok: false,
      error: {
        code: 'pending-divergences',
        message:
          `a versao inicial nao pode ser emitida: ${report.totals.pending} divergencia(s) ` +
          'pendente(s) exigem decisao explicita',
        pendingRuleIds: report.pendingRuleIds,
      },
    };
  }

  // Regras efetivas (uma por item), em ordem estavel por id.
  const rules: Rule[] = report.items
    .map((i) => i.effectiveRule as Rule)
    .filter((r): r is Rule => r !== undefined)
    .sort((a, b) => compareStrings(a.id, b.id));

  // Origem/decisao por regra (6.14): nenhuma precedencia silenciosa.
  const sourceDecisions: SourceDecision[] = report.items.map((i) => ({
    ruleId: i.ruleId,
    source: i.sources.join(', '),
    decision: describeDecision(i),
  }));

  // Define a versao em rascunho (valida predicados e conflitos) e aprova.
  const defined = service.defineVersion({
    id: input.versionId,
    version: input.versionLabel,
    validFrom: input.validFrom,
    ...(input.validUntil !== undefined ? { validUntil: input.validUntil } : {}),
    rules,
    sourceDecisions,
    now: input.now,
  });
  if (!defined.ok) {
    return { ok: false, error: { code: 'rule-set-error', message: defined.error.message, ruleSetError: defined.error } };
  }

  const approved = service.approveVersion({
    id: input.versionId,
    approvedBy: input.approvedBy,
    approvedAt: input.approvedAt,
    validFrom: input.validFrom,
    ...(input.validUntil !== undefined ? { validUntil: input.validUntil } : {}),
  });
  if (!approved.ok) {
    return { ok: false, error: { code: 'rule-set-error', message: approved.error.message, ruleSetError: approved.error } };
  }

  return { ok: true, value: { ruleSet: approved.value, report } };
}

/** Descreve a decisao aplicada a uma regra para o registro de origem/decisao. */
function describeDecision(item: DecisionItem): string {
  if (item.status === 'agreed') {
    return item.sources.length === 1
      ? `fonte unica (${item.sources[0]}); sem divergencia`
      : `consenso entre ${item.sources.length} fontes; sem divergencia`;
  }
  // resolved (pending nunca chega aqui porque a emissao e bloqueada).
  return `divergencia resolvida pela fonte ${item.chosenSource}: ${item.justification ?? ''}`.trim();
}

/**
 * Rejeita resolucoes malformadas: ruleId inexistente, fonte que nao propos a
 * regra, ou resolucao de regra sem conflito. Isso evita "decidir" algo que nao
 * e uma divergencia real.
 */
function validateResolutions(
  report: ConsolidationReport,
  resolutions: readonly ConflictResolution[],
): ConsolidationError | null {
  const byRule = new Map<Uuid, DecisionItem>();
  for (const i of report.items) byRule.set(i.ruleId, i);

  for (const r of resolutions) {
    const item = byRule.get(r.ruleId);
    if (!item) {
      return {
        code: 'invalid-resolution',
        message: `decisao referencia regra inexistente nas fontes: ${r.ruleId}`,
      };
    }
    if (item.variants.length <= 1) {
      return {
        code: 'invalid-resolution',
        message: `decisao para regra sem divergencia: ${r.ruleId}`,
      };
    }
    if (!item.sources.includes(r.chosenSource)) {
      return {
        code: 'invalid-resolution',
        message:
          `decisao escolhe fonte ${r.chosenSource} que nao propos a regra ${r.ruleId} ` +
          `(fontes validas: ${item.sources.join(', ')})`,
      };
    }
  }
  return null;
}

// --------------------------------------------------------------------------
// Auxiliares
// --------------------------------------------------------------------------

function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
