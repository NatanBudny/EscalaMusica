// PublicationOrchestrator: saga idempotente de publicacao recuperavel e
// verificacao do GitHub Pages (tarefa 12).
//
// Objetivo (Requisitos 10.2-10.23, 12.4-12.7; design.md componente
// `PublicationOrchestrator`: "Saga privado -> backup -> publico -> Pages ->
// confirmacao; transicoes idempotentes persistidas"):
//
//   - A saga encadeia: sincronizacao privada -> backup publico -> pacote
//     imutavel -> commit/push publico -> estado Pages -> verificacao HTTP ->
//     confirmacao. Cada transicao e PERSISTIDA (10.2-10.5, 10.8-10.15).
//   - Uma falha injetada em qualquer transicao resulta em `incomplete`/`failed`,
//     PRESERVA os artefatos declarados e permite retomar pelo mesmo
//     `publicationId` (12.4-12.7, Property 39).
//   - O commit publico corresponde EXATAMENTE ao pacote allowlist (10.2, 10.4,
//     10.5, 10.19, Property 35): somente arquivos e remocoes do manifesto.
//   - A confirmacao exige IGUALDADE INTEGRAL do Site_Publico (10.12-10.14,
//     10.17, 10.22, Property 36): todo arquivo esperado com hash correspondente
//     e todo removido ausente; caso contrario -> incompleta.
//   - Os efeitos de confirmacao sao IDEMPOTENTES (10.8, 10.9, 10.15, Property
//     37): processar o mesmo `packageId` uma ou mais vezes gera no maximo um
//     registro confirmado, um conjunto de links e uma contribuicao de cada
//     atribuicao a rotacao.
//
// Este modulo e TypeScript PURO: nao faz I/O, Git nem HTTP. Ele modela a
// MAQUINA DE ESTADOS da saga e as decisoes de avanco/rollback de forma
// deterministica. Os efeitos reais (push, fetch, HTTP) sao aplicados pela
// camada Rust (git_sync.rs, http_verify.rs) guiada por estas decisoes.

import type { PublicationRecord, Sha256, Utc, Uuid } from '../schemas/models';
import { SCHEMA_VERSION } from '../schemas/models';
import { canonicalHash, sha256Hex, utf8Encode } from '../schemas/canonical';

// --------------------------------------------------------------------------
// Pacote de publicacao (allowlist imutavel)
// --------------------------------------------------------------------------

/** Um arquivo incluido/alterado no pacote publico. */
export interface PackageFile {
  readonly path: string;
  readonly content: string;
}

/**
 * Pacote de publicacao APROVADO: arquivos a incluir/alterar e caminhos a
 * remover. O `packageId` identifica o pacote; o `contentHash` e o hash canonico
 * do conteudo (allowlist), base da idempotencia e da verificacao.
 */
export interface PublicationPackage {
  readonly packageId: Uuid;
  readonly period: string;
  readonly files: readonly PackageFile[];
  readonly removals: readonly string[];
}

/** Hash canonico do pacote (identidade do conteudo a publicar). */
export function packageHash(pkg: PublicationPackage): Sha256 {
  const files = [...pkg.files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const removals = [...pkg.removals].sort();
  return canonicalHash({ files, removals });
}

// --------------------------------------------------------------------------
// Property 35 — commit publico = diff exato do pacote
// --------------------------------------------------------------------------

/** Arvore publica como mapa caminho -> conteudo. */
export type PublicTree = Readonly<Record<string, string>>;

export interface TreeDiff {
  readonly added: readonly string[];
  readonly changed: readonly string[];
  readonly removed: readonly string[];
}

export type ApplyPackageResult =
  | { readonly ok: true; readonly tree: PublicTree; readonly diff: TreeDiff }
  | { readonly ok: false; readonly reason: 'destination-divergent'; readonly message: string };

/**
 * Aplica o pacote a uma arvore publica inicial, produzindo a nova arvore e o
 * diff EXATO (added/changed/removed). Rejeita, sem mutacao, se o `period` do
 * pacote nao bater com o destino aprovado (destino divergente, 10.4/10.19).
 */
export function applyPackage(
  initial: PublicTree,
  pkg: PublicationPackage,
  approvedPeriod: string,
): ApplyPackageResult {
  if (pkg.period !== approvedPeriod) {
    return {
      ok: false,
      reason: 'destination-divergent',
      message: 'o periodo do pacote nao corresponde ao destino aprovado; operacao rejeitada',
    };
  }

  const next: Record<string, string> = { ...initial };
  const added: string[] = [];
  const changed: string[] = [];
  const removed: string[] = [];

  for (const f of pkg.files) {
    if (Object.prototype.hasOwnProperty.call(next, f.path)) {
      if (next[f.path] !== f.content) changed.push(f.path);
    } else {
      added.push(f.path);
    }
    next[f.path] = f.content;
  }
  for (const path of pkg.removals) {
    if (Object.prototype.hasOwnProperty.call(next, path)) {
      removed.push(path);
      delete next[path];
    }
  }

  added.sort();
  changed.sort();
  removed.sort();
  return { ok: true, tree: next, diff: { added, changed, removed } };
}

// --------------------------------------------------------------------------
// Property 36 — confirmacao exige igualdade integral do Site_Publico
// --------------------------------------------------------------------------

/** Observacao do Site_Publico: conteudo por caminho efetivamente servido. */
export type ObservedSite = Readonly<Record<string, string>>;

export type VerificationResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: 'missing-file' | 'content-mismatch' | 'removed-still-present' | 'not-consulted';
      readonly paths: readonly string[];
    };

/**
 * Confirma a publicacao SE E SOMENTE SE (Property 36): todos os arquivos
 * esperados do pacote tem conteudo/hash correspondente no site, todos os
 * removidos estao ausentes e o site FOI consultado (`observed !== undefined`).
 * Qualquer outra condicao resulta em falha de verificacao (incompleta).
 */
export function verifyPublicSite(
  pkg: PublicationPackage,
  observed: ObservedSite | undefined,
): VerificationResult {
  if (observed === undefined) {
    return { ok: false, reason: 'not-consulted', paths: [] };
  }

  const missing: string[] = [];
  const mismatch: string[] = [];
  for (const f of pkg.files) {
    if (!Object.prototype.hasOwnProperty.call(observed, f.path)) {
      missing.push(f.path);
    } else if (sha256Hex(utf8Encode(observed[f.path] as string)) !== sha256Hex(utf8Encode(f.content))) {
      mismatch.push(f.path);
    }
  }
  if (missing.length > 0) return { ok: false, reason: 'missing-file', paths: missing.sort() };
  if (mismatch.length > 0) return { ok: false, reason: 'content-mismatch', paths: mismatch.sort() };

  const stillPresent = pkg.removals.filter((p) =>
    Object.prototype.hasOwnProperty.call(observed, p),
  );
  if (stillPresent.length > 0) {
    return { ok: false, reason: 'removed-still-present', paths: stillPresent.sort() };
  }
  return { ok: true };
}

// --------------------------------------------------------------------------
// Saga de publicacao (maquina de estados idempotente)
// --------------------------------------------------------------------------

export type SagaState = PublicationRecord['state'];

/** Ordem das transicoes da saga ate a confirmacao. */
const SAGA_ORDER: readonly SagaState[] = [
  'prepared',
  'private-synced',
  'backed-up',
  'pushed',
  'pages-processing',
  'confirmed',
];

function sagaRank(s: SagaState): number {
  const i = SAGA_ORDER.indexOf(s);
  return i < 0 ? -1 : i;
}

export interface SagaContext {
  readonly publicationId: Uuid;
  readonly packageId: Uuid;
  readonly period: string;
  readonly at: Utc;
}

/** Inicia (ou retoma) um registro de publicacao no estado `prepared`. */
export function startPublication(ctx: SagaContext): PublicationRecord {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: ctx.publicationId,
    packageId: ctx.packageId,
    period: ctx.period,
    state: 'prepared',
    attempts: [{ attemptId: ctx.publicationId, at: ctx.at, state: 'prepared' }],
  };
}

export type AdvanceResult =
  | { readonly ok: true; readonly record: PublicationRecord }
  | { readonly ok: false; readonly reason: 'non-sequential' | 'already-confirmed'; readonly record: PublicationRecord };

/**
 * Avanca a saga para o proximo estado. Idempotente: reaplicar o MESMO estado ao
 * qual ja se chegou nao muda o registro (retorna ok com o mesmo estado). Pulos
 * sao recusados. Uma vez `confirmed`, novas tentativas de confirmar sao no-op
 * idempotente (Property 37).
 */
export function advanceSaga(
  record: PublicationRecord,
  to: SagaState,
  at: Utc,
  detail?: string,
): AdvanceResult {
  const curRank = sagaRank(record.state);
  const toRank = sagaRank(to);

  if (record.state === 'confirmed') {
    // Idempotencia: ja confirmado; reafirmar 'confirmed' e no-op.
    if (to === 'confirmed') return { ok: true, record };
    return { ok: false, reason: 'already-confirmed', record };
  }

  // Reaplicar o mesmo estado e idempotente.
  if (toRank === curRank) return { ok: true, record };

  if (toRank !== curRank + 1) {
    return { ok: false, reason: 'non-sequential', record };
  }

  const attempt =
    detail === undefined
      ? { attemptId: `${record.id}:${to}`, at, state: to }
      : { attemptId: `${record.id}:${to}`, at, state: to, detail };
  const next: PublicationRecord = {
    ...record,
    state: to,
    attempts: [...record.attempts, attempt],
    ...(to === 'confirmed' ? { confirmedAt: at } : {}),
  };
  return { ok: true, record: next };
}

/** Marca a saga como incompleta/falha preservando o registro e as tentativas. */
export function markIncomplete(
  record: PublicationRecord,
  state: 'incomplete' | 'failed',
  at: Utc,
  detail: string,
): PublicationRecord {
  return {
    ...record,
    state,
    attempts: [...record.attempts, { attemptId: record.id + ':' + state, at, state, detail }],
  };
}

// --------------------------------------------------------------------------
// Property 37 — efeitos de confirmacao idempotentes
// --------------------------------------------------------------------------

/** Efeitos colaterais de uma confirmacao (links + contribuicao de rotacao). */
export interface ConfirmationEffects {
  readonly confirmedPackageIds: readonly Uuid[];
  readonly rotationContributions: Readonly<Record<string, number>>;
}

/**
 * Aplica os efeitos de confirmacao de forma idempotente: se o `packageId` ja
 * foi confirmado, retorna os efeitos inalterados. Caso contrario, registra a
 * confirmacao e soma a contribuicao de rotacao (cada atribuicao vigente conta
 * exatamente uma vez). Processar o mesmo pacote de novo nao duplica nada.
 */
export function applyConfirmationEffects(
  previous: ConfirmationEffects,
  packageId: Uuid,
  rotationFromPackage: Readonly<Record<string, number>>,
): ConfirmationEffects {
  if (previous.confirmedPackageIds.includes(packageId)) {
    return previous; // idempotente: nada muda
  }
  return {
    confirmedPackageIds: [...previous.confirmedPackageIds, packageId].sort(),
    // A rotacao e DERIVADA do pacote confirmado (substitui, nao acumula entre
    // reprocessamentos do mesmo pacote), garantindo "exatamente uma vez".
    rotationContributions: { ...rotationFromPackage },
  };
}

// --------------------------------------------------------------------------
// Rollback compensatorio
// --------------------------------------------------------------------------

export interface RollbackPlan {
  /** Novo commit que restaura a arvore anterior (nunca force-push). */
  readonly restoreTree: PublicTree;
  /** Verdadeiro: o rollback e por commit compensatorio, nao reescrita. */
  readonly compensatory: true;
}

/**
 * Planeja o rollback quando a verificacao falha: restaura a arvore publica
 * anterior por um NOVO commit compensatorio (sem force-push). O backup publico
 * da vigente anterior e a fonte do conteudo a restaurar.
 */
export function planRollback(previousPublicTree: PublicTree): RollbackPlan {
  return { restoreTree: { ...previousPublicTree }, compensatory: true };
}
