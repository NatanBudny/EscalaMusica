// PreviewService: gera a Previa_Publica identificada de uma revisao validada e
// um diff PUBLICO reversivel contra a Escala vigente, SEM tocar na vigente.
//
// Objetivo (Requisitos 8.1-8.5, 8.8-8.10, 14.6; design.md componente
// `PreviewService`: "Previa e diff sem tocar no site vigente" / "Derivada de
// revisao validada"):
//
//   - A previa NASCE de uma projecao publica por allowlist (reusa
//     `projectPublic`), portanto exclui todo campo privado (8.3). Nenhum modelo
//     paralelo e criado: a projecao e a unica fonte dos dados publicos.
//   - A previa e identificada e vinculada a revisao validada do rascunho e a
//     versao do Conjunto_de_Regras_Ativo (8.1, 8.5).
//   - O diff identifica exatamente cada inclusao, alteracao e remocao por
//     culto/campo em relacao a vigente (8.4, 14.6), e e REVERSIVEL: aplicar o
//     diff a vigente produz a candidata; aplicar o diff inverso produz a
//     vigente (Property 32).
//   - A geracao e PURA e deterministica: nao faz I/O, nao muta a entrada e nao
//     altera a Escala vigente (8.1, 8.8, 14.9). A vigente so e lida.
//   - Uma revisao alterada invalida a previa e qualquer aprovacao vinculada
//     (8.8, 14.8): `isPreviewValidForRevision` / `invalidateApprovalIfStale`.
//
// Este modulo e TypeScript puro; reusa `projectPublic` (projecao + scanner de
// segredos) e o hashing canonico de `schemas/canonical.ts`.

import type {
  Approval,
  Preview,
  PreviewDiffEntry,
  PublicServiceFields,
  Sha256,
  Utc,
  Uuid,
} from '../schemas/models';
import { SCHEMA_VERSION } from '../schemas/models';
import { canonicalStringify } from '../schemas/canonical';
import {
  projectPublic,
  type ProjectionBlock,
  type PublicProjectionDTO,
  type PublicProjectionInput,
  type PublicServiceDTO,
} from '../projection/publicProjection';

// --------------------------------------------------------------------------
// Entrada e saida
// --------------------------------------------------------------------------

/**
 * Entrada da geracao de previa. A `candidate` e a projecao da revisao validada;
 * a `current` e a projecao publica da Escala vigente (quando existir). Ambas
 * sao projecoes publicas por allowlist — nenhum dado privado chega aqui.
 */
export interface PreviewInput {
  /** Projecao da revisao validada (dados publicos da candidata). */
  readonly candidate: PublicProjectionInput;
  /**
   * Projecao da Escala vigente, apenas LIDA para computar o diff. Ausente
   * quando ainda nao ha Escala vigente (primeira publicacao) — nesse caso o
   * diff e composto apenas por inclusoes (8.4 condicionado a "quando existir").
   */
  readonly current?: PublicProjectionInput;
  /** Identificacao da previa e vinculos (8.1, 8.5). */
  readonly previewId: Uuid;
  readonly cycleId: Uuid;
  /** Revisao validada do rascunho a que a previa fica vinculada (8.1, 8.8). */
  readonly draftRevision: Sha256;
  /** Versao do Conjunto_de_Regras_Ativo validada (8.5). */
  readonly ruleSetVersion: string;
  /** Periodo `YYYY-MM` apresentado na previa (8.5). */
  readonly period: string;
  /** Instante civil (`YYYY-MM-DD`) de geracao. */
  readonly generatedAt: Utc;
  /** Operador responsavel pela geracao (8.5). */
  readonly operatorId: Uuid;
}

/** Resultado: a Previa_Publica identificada OU os bloqueios da projecao. */
export type PreviewResult =
  | { readonly ok: true; readonly preview: Preview }
  | { readonly ok: false; readonly blocks: readonly ProjectionBlock[] };

// --------------------------------------------------------------------------
// Geracao da previa
// --------------------------------------------------------------------------

/**
 * Gera a Previa_Publica identificada e o diff reversivel contra a vigente.
 *
 * Determinismo e pureza: a funcao nao faz I/O e nao muta nenhuma entrada. A
 * projecao publica (`projectPublic`) ja aplica a allowlist e o scanner de
 * segredos; se a candidata nao puder ser projetada (ex.: telefone sem
 * autorizacao, campo secreto), a previa NAO e gerada e os bloqueios sao
 * retornados — nunca se emite previa com vazamento (8.3).
 */
export function generatePreview(input: PreviewInput): PreviewResult {
  const candidateResult = projectPublic(input.candidate);
  if (!candidateResult.ok) {
    return { ok: false, blocks: candidateResult.blocks };
  }

  // A vigente e apenas LIDA. Se ela nao puder ser projetada, propagamos os
  // bloqueios (indica estado publico inconsistente da vigente).
  let currentDto: PublicProjectionDTO | undefined;
  if (input.current !== undefined) {
    const currentResult = projectPublic(input.current);
    if (!currentResult.ok) {
      return { ok: false, blocks: currentResult.blocks };
    }
    currentDto = currentResult.dto;
  }

  const diff = computeDiff(currentDto, candidateResult.dto);

  // `publicServices` da previa: apenas os campos publicos da candidata, no
  // formato `PublicServiceFields` (serviceId + mapa de campos publicos). Isso
  // mantem a previa alinhada ao modelo `Preview` sem criar um modelo paralelo.
  const publicServices: PublicServiceFields[] = candidateResult.dto.services.map((svc) => ({
    serviceId: svc.serviceId,
    fields: publicFieldMapOf(svc),
  }));

  const preview: Preview = {
    schemaVersion: SCHEMA_VERSION,
    previewId: input.previewId,
    cycleId: input.cycleId,
    draftRevision: input.draftRevision,
    ruleSetVersion: input.ruleSetVersion,
    period: input.period,
    generatedAt: input.generatedAt,
    operatorId: input.operatorId,
    publicServices,
    diff,
  };

  return { ok: true, preview };
}

// --------------------------------------------------------------------------
// Diff publico reversivel
// --------------------------------------------------------------------------

/**
 * Computa o diff publico entre a vigente (`current`, pode ser ausente) e a
 * candidata (`candidate`). O diff e por culto/campo e identifica exatamente:
 *
 *   - `added`:   campo presente apenas na candidata (inclusao);
 *   - `removed`: campo presente apenas na vigente (remocao);
 *   - `changed`: campo presente em ambas com valor publico diferente.
 *
 * Cada entrada carrega `before`/`after` suficientes para a reversibilidade
 * (Property 32): aplicar o diff a vigente produz a candidata e aplicar o
 * inverso produz a vigente. A ordem das entradas e estavel (por serviceId e,
 * dentro do culto, por campo) para determinismo (8.1, design "Validacao e
 * sugestao sao puras").
 */
export function computeDiff(
  current: PublicProjectionDTO | undefined,
  candidate: PublicProjectionDTO,
): PreviewDiffEntry[] {
  const currentView = toFieldView(current);
  const candidateView = toFieldView(candidate);

  // Conjunto ordenado e estavel de (serviceId, field).
  const keys = new Set<string>();
  for (const k of currentView.keys()) keys.add(k);
  for (const k of candidateView.keys()) keys.add(k);

  const sortedKeys = [...keys].sort(compareKeys);

  const entries: PreviewDiffEntry[] = [];
  for (const key of sortedKeys) {
    const [serviceId, field] = splitKey(key);
    const inCurrent = currentView.has(key);
    const inCandidate = candidateView.has(key);
    const beforeVal = currentView.get(key);
    const afterVal = candidateView.get(key);

    if (inCurrent && inCandidate) {
      // Comparacao semantica por serializacao canonica (independe de ordem de
      // chaves de objeto). Valores iguais nao produzem entrada.
      if (canonicalStringify(beforeVal) === canonicalStringify(afterVal)) continue;
      entries.push({ serviceId, field, change: 'changed', before: beforeVal, after: afterVal });
    } else if (inCandidate) {
      entries.push({ serviceId, field, change: 'added', after: afterVal });
    } else {
      entries.push({ serviceId, field, change: 'removed', before: beforeVal });
    }
  }
  return entries;
}

/**
 * Inverte um diff: inclusao vira remocao e vice-versa; alteracao troca
 * before/after. Aplicar o inverso a candidata reproduz a vigente (Property 32).
 */
export function invertDiff(diff: readonly PreviewDiffEntry[]): PreviewDiffEntry[] {
  return diff.map((e) => {
    if (e.change === 'added') {
      return { serviceId: e.serviceId, field: e.field, change: 'removed', before: e.after };
    }
    if (e.change === 'removed') {
      return { serviceId: e.serviceId, field: e.field, change: 'added', after: e.before };
    }
    // changed: troca before/after.
    return { serviceId: e.serviceId, field: e.field, change: 'changed', before: e.after, after: e.before };
  });
}

/**
 * Representacao do estado publico como mapa `serviceId:field -> valor`, usada
 * para aplicar e reaplicar o diff de forma verificavel. Equivale, a menos da
 * ordem, ao `toFieldView` de uma projecao publica.
 */
export type PublicFieldState = Map<string, unknown>;

/** Converte a projecao publica em estado de campos aplicavel. */
export function toFieldState(dto: PublicProjectionDTO | undefined): PublicFieldState {
  return toFieldView(dto);
}

/**
 * Aplica um diff a um estado de campos e retorna um NOVO estado (nao muta a
 * entrada). Lanca se o diff for incoerente com o estado (ex.: remover campo
 * ausente ou adicionar campo ja presente), o que denuncia um diff invalido.
 */
export function applyDiff(
  state: PublicFieldState,
  diff: readonly PreviewDiffEntry[],
): PublicFieldState {
  const out = new Map(state);
  for (const e of diff) {
    const key = makeKey(e.serviceId, e.field);
    if (e.change === 'added') {
      if (out.has(key)) {
        throw new Error(`Diff invalido: inclusao de campo ja presente (${key}).`);
      }
      out.set(key, e.after);
    } else if (e.change === 'removed') {
      if (!out.has(key)) {
        throw new Error(`Diff invalido: remocao de campo ausente (${key}).`);
      }
      out.delete(key);
    } else {
      if (!out.has(key)) {
        throw new Error(`Diff invalido: alteracao de campo ausente (${key}).`);
      }
      out.set(key, e.after);
    }
  }
  return out;
}

// --------------------------------------------------------------------------
// Invalidacao por mudanca de revisao (8.8, 14.8)
// --------------------------------------------------------------------------

/**
 * Uma previa so e valida para a revisao a que foi vinculada. Se a revisao
 * atual do rascunho difere da revisao da previa, a previa esta obsoleta (8.8).
 */
export function isPreviewValidForRevision(preview: Preview, currentDraftRevision: Sha256): boolean {
  return preview.draftRevision === currentDraftRevision;
}

/**
 * Invalida uma aprovacao vinculada a uma previa quando a revisao do rascunho
 * mudou depois da aprovacao (8.8, 14.8). Retorna um NOVO Approval com
 * `status: 'invalidated'` quando a revisao divergir; caso contrario retorna o
 * mesmo objeto. Pura: nunca muta a entrada.
 */
export function invalidateApprovalIfStale(
  approval: Approval,
  currentDraftRevision: Sha256,
): Approval {
  if (approval.draftRevision === currentDraftRevision) return approval;
  if (approval.status === 'invalidated') return approval;
  return { ...approval, status: 'invalidated' };
}

// --------------------------------------------------------------------------
// Auxiliares internos
// --------------------------------------------------------------------------

/**
 * Projeta um `PublicServiceDTO` num mapa de campos publicos achatado por culto.
 * Inclui os campos sempre publicos do culto (data/dia/tipo), os campos publicos
 * do rascunho (prefixados para evitar colisao), os insumos publicos e as
 * atribuicoes publicas (nome por funcao/slot). A chave e estavel e legivel.
 */
function publicFieldMapOf(svc: PublicServiceDTO): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  out['service.date'] = svc.date;
  out['service.weekday'] = svc.weekday;
  out['service.kind'] = svc.kind;

  // Campos publicos do rascunho.
  for (const [k, v] of Object.entries(svc.publicFields)) {
    out[`field.${k}`] = v;
  }

  // Insumos publicos: agrupados por tipo de forma determinista.
  // Como pode haver mais de um insumo do mesmo tipo, agregamos em lista estavel.
  const inputsByType = new Map<string, unknown[]>();
  for (const i of svc.publicInputs) {
    const list = inputsByType.get(i.type) ?? [];
    list.push(i.value);
    inputsByType.set(i.type, list);
  }
  for (const [type, values] of [...inputsByType.entries()].sort((a, b) => cmp(a[0], b[0]))) {
    out[`input.${type}`] = values;
  }

  // Atribuicoes publicas: chave por funcao+slot; valor = nome publico (ou null).
  // Varias atribuicoes para a mesma funcao/slot sao agregadas em lista estavel.
  const byRoleSlot = new Map<string, Array<string | null>>();
  const ordered = [...svc.assignments].sort((a, b) => {
    const r = cmp(a.roleId, b.roleId);
    if (r !== 0) return r;
    return cmp(a.slot ?? '', b.slot ?? '');
  });
  for (const a of ordered) {
    const k = `assignment.${a.roleId}${a.slot ? `.${a.slot}` : ''}`;
    const list = byRoleSlot.get(k) ?? [];
    list.push(a.name ?? null);
    byRoleSlot.set(k, list);
  }
  for (const [k, names] of [...byRoleSlot.entries()].sort((a, b) => cmp(a[0], b[0]))) {
    out[k] = names;
  }

  return out;
}

/**
 * Achata uma projecao publica inteira num mapa `serviceId:field -> valor`.
 * Base tanto do diff quanto da aplicacao/reversao verificavel.
 */
function toFieldView(dto: PublicProjectionDTO | undefined): Map<string, unknown> {
  const view = new Map<string, unknown>();
  if (dto === undefined) return view;
  for (const svc of dto.services) {
    const fields = publicFieldMapOf(svc);
    for (const [field, value] of Object.entries(fields)) {
      view.set(makeKey(svc.serviceId, field), value);
    }
  }
  return view;
}

/** Monta a chave composta estavel `serviceId\u0000field`. */
function makeKey(serviceId: Uuid, field: string): string {
  return `${serviceId}\u0000${field}`;
}

/** Separa a chave composta em `[serviceId, field]`. */
function splitKey(key: string): [Uuid, string] {
  const idx = key.indexOf('\u0000');
  return [key.slice(0, idx), key.slice(idx + 1)];
}

/** Ordenacao determinista das chaves compostas por (serviceId, field). */
function compareKeys(a: string, b: string): number {
  const [sa, fa] = splitKey(a);
  const [sb, fb] = splitKey(b);
  const s = cmp(sa, sb);
  if (s !== 0) return s;
  return cmp(fa, fb);
}

function cmp(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}
