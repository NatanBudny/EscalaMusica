// BackupService: criacao, verificacao de integridade, round-trip e retencao de
// backups (tarefa 11.2).
//
// Objetivo (Requisitos 13.1-13.12, 16.6, 16.10; design.md componente
// `BackupService`):
//
//   - Criar um Backup com MANIFESTO + CHECKSUMS por arquivo e um checksum do
//     proprio manifesto, cobrindo as categorias do estado (13.1, 13.2, 13.3).
//   - VERIFICAR integridade: qualquer byte removido, acrescentado ou alterado
//     em um arquivo coberto, ou um arquivo ausente/extra, classifica o backup
//     como corrompido e IDENTIFICA o item afetado, sem modificar dados (13.3,
//     13.4, 13.7, Property 41).
//   - ROUND-TRIP: criar -> exportar -> importar -> restaurar reconstroi
//     exatamente as categorias/valores cobertos e preserva identidade, periodo
//     e versao de origem (13.1, 13.2, 13.5, 13.6, 13.11, Property 42).
//   - RETENCAO: a selecao respeita quantidade e tempo e NUNCA elimina um backup
//     marcado como publicacao oficial (13.9, 13.10, Property 43).
//   - SEGURANCA de pacote (13.8/16.6): nomes de arquivo sao validados contra
//     travessia de caminho e o tamanho total e limitado (defesa contra zip
//     bomb) antes de qualquer restauracao.
//
// Este modulo e TypeScript PURO: nao faz I/O e nao toca no legado. A camada
// Rust (tarefa 11.12) materializa o ZIP e a escrita atomica guiada por estas
// decisoes. Reusa o hashing canonico e os tipos `BackupManifest`/`RetentionPolicy`.

import type { BackupFileRef, BackupManifest } from '../schemas/models';
import { SCHEMA_VERSION } from '../schemas/models';
import type { RetentionPolicy as ConfigRetentionPolicy } from '../config/model';
import { canonicalBytes, canonicalStringify, sha256Hex, utf8Encode } from '../schemas/canonical';

// A politica de retencao vem da configuracao operacional (config/model.ts).
export type { ConfigRetentionPolicy as RetentionPolicyConfig };

/** Versao do formato de backup. */
export const BACKUP_FORMAT_VERSION = '1' as const;

/** Limite defensivo de bytes totais de um pacote de backup (anti zip bomb). */
export const MAX_BACKUP_TOTAL_BYTES = 256 * 1024 * 1024; // 256 MiB

// --------------------------------------------------------------------------
// Conteudo de backup
// --------------------------------------------------------------------------

/**
 * Um arquivo de backup: caminho logico (relativo, sem travessia) e conteudo em
 * texto canonico. O servico deriva o checksum e os bytes.
 */
export interface BackupFile {
  readonly path: string;
  /** Conteudo textual ja canonico (UTF-8). */
  readonly content: string;
}

/** Pacote de backup emitivel: manifesto + arquivos. */
export interface BackupPackage {
  readonly manifest: BackupManifest;
  readonly files: readonly BackupFile[];
}

/** Parametros para criar um backup. */
export interface CreateBackupParams {
  readonly id: string;
  readonly period: string;
  readonly sourceVersion: string;
  readonly createdAt: string;
  readonly operatorId: string;
  readonly categories: readonly string[];
  readonly officialPublication: boolean;
  readonly files: readonly BackupFile[];
}

// --------------------------------------------------------------------------
// Criacao
// --------------------------------------------------------------------------

/**
 * Cria um `BackupPackage` com manifesto e checksums. O `manifestSha256` cobre a
 * lista de arquivos (path+sha256+bytes) de forma canonica, para que alterar
 * qualquer referencia tambem seja detectavel.
 */
export function createBackup(params: CreateBackupParams): BackupPackage {
  const fileRefs: BackupFileRef[] = params.files.map((f) => {
    const bytes = utf8Encode(f.content);
    return { path: f.path, sha256: sha256Hex(bytes), bytes: bytes.length };
  });

  const manifestWithoutHash = {
    schemaVersion: SCHEMA_VERSION,
    id: params.id,
    formatVersion: BACKUP_FORMAT_VERSION,
    period: params.period,
    sourceVersion: params.sourceVersion,
    createdAt: params.createdAt,
    operatorId: params.operatorId,
    categories: [...params.categories],
    officialPublication: params.officialPublication,
    files: fileRefs,
  };

  const manifestSha256 = sha256Hex(canonicalBytes(manifestWithoutHash));
  const manifest: BackupManifest = { ...manifestWithoutHash, manifestSha256 };

  return { manifest, files: params.files.map((f) => ({ path: f.path, content: f.content })) };
}

// --------------------------------------------------------------------------
// Verificacao de integridade (Property 41 / 13.3, 13.4, 13.7)
// --------------------------------------------------------------------------

export interface IntegrityIssue {
  readonly kind: 'missing-file' | 'extra-file' | 'content-mismatch' | 'size-mismatch' | 'manifest-mismatch';
  readonly path: string;
  readonly message: string;
}

export type IntegrityResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly issues: readonly IntegrityIssue[] };

/**
 * Verifica que os arquivos correspondem EXATAMENTE ao manifesto. Classifica o
 * backup corrompido se qualquer byte coberto mudou, se um arquivo do manifesto
 * esta ausente ou se ha arquivo extra fora do manifesto. NAO modifica dados.
 */
export function verifyIntegrity(pkg: BackupPackage): IntegrityResult {
  const issues: IntegrityIssue[] = [];

  // Recalcula o checksum do proprio manifesto.
  const { manifestSha256, ...rest } = pkg.manifest;
  const recomputedManifestHash = sha256Hex(canonicalBytes(rest));
  if (recomputedManifestHash !== manifestSha256) {
    issues.push({
      kind: 'manifest-mismatch',
      path: '(manifest)',
      message: 'o checksum do manifesto nao corresponde ao seu conteudo',
    });
  }

  const byPath = new Map<string, BackupFile>();
  for (const f of pkg.files) byPath.set(f.path, f);

  const manifestPaths = new Set<string>();
  for (const ref of pkg.manifest.files) {
    manifestPaths.add(ref.path);
    const file = byPath.get(ref.path);
    if (file === undefined) {
      issues.push({ kind: 'missing-file', path: ref.path, message: 'arquivo coberto pelo manifesto esta ausente' });
      continue;
    }
    const bytes = utf8Encode(file.content);
    if (bytes.length !== ref.bytes) {
      issues.push({ kind: 'size-mismatch', path: ref.path, message: 'o tamanho do arquivo diverge do manifesto' });
    }
    if (sha256Hex(bytes) !== ref.sha256) {
      issues.push({ kind: 'content-mismatch', path: ref.path, message: 'o checksum do arquivo diverge do manifesto' });
    }
  }

  // Arquivo extra fora do manifesto.
  for (const f of pkg.files) {
    if (!manifestPaths.has(f.path)) {
      issues.push({ kind: 'extra-file', path: f.path, message: 'arquivo presente no pacote nao consta no manifesto' });
    }
  }

  if (issues.length > 0) {
    issues.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : a.kind < b.kind ? -1 : 1));
    return { ok: false, issues };
  }
  return { ok: true };
}

// --------------------------------------------------------------------------
// Seguranca do pacote antes de restaurar (13.8/16.6)
// --------------------------------------------------------------------------

export interface SafetyIssue {
  readonly kind: 'path-traversal' | 'absolute-path' | 'size-limit' | 'unknown-format-version';
  readonly path: string;
  readonly message: string;
}

export type SafetyResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly issues: readonly SafetyIssue[] };

/**
 * Inspeciona o pacote ANTES de restaurar: rejeita caminhos com travessia
 * (`..`), caminhos absolutos, formato desconhecido e total de bytes acima do
 * limite (defesa contra zip bomb). Puro: nunca escreve.
 */
export function inspectBeforeRestore(
  pkg: BackupPackage,
  maxTotalBytes: number = MAX_BACKUP_TOTAL_BYTES,
): SafetyResult {
  const issues: SafetyIssue[] = [];

  if (pkg.manifest.formatVersion !== BACKUP_FORMAT_VERSION) {
    issues.push({
      kind: 'unknown-format-version',
      path: '(manifest)',
      message: `versao de formato desconhecida: ${pkg.manifest.formatVersion}`,
    });
  }

  let total = 0;
  for (const f of pkg.files) {
    total += utf8Encode(f.content).length;
    if (isAbsolutePath(f.path)) {
      issues.push({ kind: 'absolute-path', path: f.path, message: 'caminho absoluto nao e permitido' });
    } else if (hasTraversal(f.path)) {
      issues.push({ kind: 'path-traversal', path: f.path, message: 'caminho contem travessia de diretorio (..)' });
    }
  }
  if (total > maxTotalBytes) {
    issues.push({
      kind: 'size-limit',
      path: '(package)',
      message: `o pacote excede o limite de ${maxTotalBytes} bytes`,
    });
  }

  if (issues.length > 0) {
    issues.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : a.kind < b.kind ? -1 : 1));
    return { ok: false, issues };
  }
  return { ok: true };
}

function isAbsolutePath(p: string): boolean {
  return p.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith('\\\\');
}

function hasTraversal(p: string): boolean {
  const normalized = p.replace(/\\/g, '/');
  return normalized.split('/').some((seg) => seg === '..');
}

// --------------------------------------------------------------------------
// Round-trip (Property 42 / restauracao)
// --------------------------------------------------------------------------

export type RestoreResult =
  | { readonly ok: true; readonly files: readonly BackupFile[]; readonly manifest: BackupManifest }
  | { readonly ok: false; readonly issues: readonly (IntegrityIssue | SafetyIssue)[] };

/**
 * Restaura o conteudo coberto pelo manifesto, apos inspecao de seguranca e
 * verificacao de integridade. Retorna os arquivos reconstruidos e o manifesto
 * (preservando identidade/periodo/versao de origem). Puro: nao escreve nada.
 */
export function restoreBackup(pkg: BackupPackage, maxTotalBytes: number = MAX_BACKUP_TOTAL_BYTES): RestoreResult {
  const safety = inspectBeforeRestore(pkg, maxTotalBytes);
  if (!safety.ok) return { ok: false, issues: safety.issues };
  const integrity = verifyIntegrity(pkg);
  if (!integrity.ok) return { ok: false, issues: integrity.issues };

  // Reconstroi na ordem canonica (por path) para determinismo.
  const ordered = [...pkg.files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { ok: true, files: ordered, manifest: pkg.manifest };
}

/** Serializa um pacote de backup em texto canonico (exportacao). */
export function exportBackup(pkg: BackupPackage): string {
  return canonicalStringify({ manifest: pkg.manifest, files: [...pkg.files] });
}

/** Reconstroi um pacote a partir do texto exportado (importacao). */
export function importBackup(text: string): BackupPackage {
  const parsed = JSON.parse(text) as BackupPackage;
  return { manifest: parsed.manifest, files: parsed.files };
}

// --------------------------------------------------------------------------
// Retencao (Property 43 / 13.9, 13.10)
// --------------------------------------------------------------------------

/** Metadados minimos de um backup para a decisao de retencao. */
export interface RetainableBackup {
  readonly id: string;
  /** Instante de criacao (ISO/UTC) comparavel lexicograficamente. */
  readonly createdAt: string;
  readonly officialPublication: boolean;
}

export interface RetentionDecision {
  readonly keep: readonly string[];
  readonly remove: readonly string[];
}

/**
 * Seleciona quais backups manter respeitando quantidade e idade, e PRESERVANDO
 * sempre os marcados como publicacao oficial (13.10). A idade e avaliada em
 * relacao a `now` (ISO/UTC); backups mais recentes que `maxAgeMonths` e dentro
 * do limite `maxBackups` sao mantidos. Puro e deterministico.
 */
export function applyRetention(
  backups: readonly RetainableBackup[],
  policy: ConfigRetentionPolicy,
  now: string,
): RetentionDecision {
  const keep = new Set<string>();
  const remove = new Set<string>();

  // Publicacoes oficiais sao sempre mantidas quando a politica assim exige.
  const official = backups.filter((b) => b.officialPublication && policy.preserveOfficialPublications);
  for (const b of official) keep.add(b.id);

  // Candidatos nao oficiais, do mais recente para o mais antigo.
  const nonOfficial = backups
    .filter((b) => !(b.officialPublication && policy.preserveOfficialPublications))
    .sort((a, b) => (a.createdAt > b.createdAt ? -1 : a.createdAt < b.createdAt ? 1 : a.id < b.id ? -1 : 1));

  const nowMs = Date.parse(now);
  let kept = 0;
  for (const b of nonOfficial) {
    const withinCount = kept < policy.maxBackups;
    const withinAge = !exceedsAge(b.createdAt, nowMs, policy.maxAgeMonths);
    if (withinCount && withinAge) {
      keep.add(b.id);
      kept++;
    } else {
      remove.add(b.id);
    }
  }

  return {
    keep: [...keep].sort(compareString),
    remove: [...remove].sort(compareString),
  };
}

/** Verdadeiro quando o backup e mais velho que `maxAgeMonths` em relacao a now. */
function exceedsAge(createdAt: string, nowMs: number, maxAgeMonths: number): boolean {
  const createdMs = Date.parse(createdAt);
  if (Number.isNaN(createdMs) || Number.isNaN(nowMs)) return false;
  // Aproximacao de mes por 30 dias; determinista e suficiente para retencao.
  const maxAgeMs = maxAgeMonths * 30 * 24 * 60 * 60 * 1000;
  return nowMs - createdMs > maxAgeMs;
}

function compareString(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}
