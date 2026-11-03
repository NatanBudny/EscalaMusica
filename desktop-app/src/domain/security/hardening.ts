// Endurecimento de seguranca e privacidade (tarefa 15).
//
// Objetivo (Requisitos 1.7, 7.20, 9.5-9.7, 10.4, 11.2, 11.3, 11.5, 11.7, 11.11,
// 12.11; design.md "Limites e seguranca de entrada"):
//
//   15.1 Restringir caminhos, URLs e conteudo nao confiavel: allowlists de
//        filesystem/rede, bloqueio de travessia e symlink, limites HTTP/ZIP,
//        bloqueio de redirect para host diferente, colagem sem formulas/HTML.
//   15.2 Scanner de segredos central: inspeciona pacote, logs, auditoria e
//        backups; falha diante de segredo ou campo privado proibido, sem ecoar
//        o valor (7.20, 11.2, 11.3, 11.5, 11.7, 11.11).
//
// Este modulo e TypeScript PURO: nao faz I/O. Fornece as VALIDACOES e o SCANNER
// que a camada de aplicacao/Rust aplica antes de qualquer efeito. Reusa
// `isSecretField` (commands/audit) e o redator de segredos (credential).

import { isSecretField } from '../commands/audit';
import { redactValue, type SecretSet } from '../credential/credentialService';

// --------------------------------------------------------------------------
// 15.1 — allowlists e validacao de entrada nao confiavel
// --------------------------------------------------------------------------

/** Verdadeiro quando o caminho e seguro (relativo, sem travessia nem symlink marker). */
export function isSafeRelativePath(path: string): boolean {
  if (path.length === 0) return false;
  if (path.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(path) || path.startsWith('\\\\')) return false;
  const normalized = path.replace(/\\/g, '/');
  return !normalized.split('/').some((seg) => seg === '..' || seg === '');
}

/**
 * Valida que uma URL remota pertence a um host aprovado e usa HTTPS. Redirects
 * para host diferente sao rejeitados por `isApprovedRedirect`.
 */
export function isApprovedUrl(url: string, approvedHosts: readonly string[]): boolean {
  const host = hostOf(url);
  if (host === undefined) return false;
  if (!url.startsWith('https://')) return false;
  return approvedHosts.includes(host);
}

/** Um redirect so e aceito se permanecer no mesmo host aprovado. */
export function isApprovedRedirect(from: string, to: string, approvedHosts: readonly string[]): boolean {
  return isApprovedUrl(from, approvedHosts) && isApprovedUrl(to, approvedHosts) && hostOf(from) === hostOf(to);
}

function hostOf(url: string): string | undefined {
  const m = /^https?:\/\/([^/]+)/.exec(url);
  return m ? m[1] : undefined;
}

/** Limites HTTP/ZIP defensivos (design.md "Limites e seguranca de entrada"). */
export const INPUT_LIMITS = {
  maxHttpResponseBytes: 8 * 1024 * 1024,
  maxZipTotalBytes: 256 * 1024 * 1024,
  maxZipEntries: 10_000,
} as const;

export interface ZipGuardIssue {
  readonly kind: 'too-many-entries' | 'total-too-large' | 'unsafe-path';
  readonly reference: string;
}

/** Valida um conjunto de entradas de ZIP contra bombas e travessia (9.5-9.7). */
export function guardZipEntries(
  entries: readonly { readonly path: string; readonly bytes: number }[],
): readonly ZipGuardIssue[] {
  const issues: ZipGuardIssue[] = [];
  if (entries.length > INPUT_LIMITS.maxZipEntries) {
    issues.push({ kind: 'too-many-entries', reference: `${entries.length} entradas` });
  }
  let total = 0;
  for (const e of entries) {
    total += e.bytes;
    if (!isSafeRelativePath(e.path)) issues.push({ kind: 'unsafe-path', reference: e.path });
  }
  if (total > INPUT_LIMITS.maxZipTotalBytes) {
    issues.push({ kind: 'total-too-large', reference: `${total} bytes` });
  }
  return issues;
}

/**
 * Sanitiza uma celula colada: remove conteudo que o visualizador/planilha
 * poderia interpretar como FORMULA (prefixos `= + - @`) ou HTML. Retorna o
 * texto seguro (nunca executa nada); a UI exibe o resultado antes de confirmar.
 */
export function sanitizePastedCell(raw: string): string {
  let value = raw;
  // Remove tags HTML.
  value = value.replace(/<[^>]*>/g, '');
  // Neutraliza prefixo de formula prefixando com apostrofo (padrao de planilha).
  if (/^[=+\-@]/.test(value)) {
    value = `'${value}`;
  }
  return value;
}

// --------------------------------------------------------------------------
// 15.2 — scanner de segredos e campos privados proibidos
// --------------------------------------------------------------------------

/** Padroes de valor que indicam segredo/credencial, mesmo sem nome de campo. */
const SECRET_VALUE_PATTERNS: readonly RegExp[] = [
  /\bghp_[A-Za-z0-9]{20,}\b/, // GitHub PAT
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
  /\bgho_[A-Za-z0-9]{20,}\b/,
  /x-access-token:[^@\s]+@/, // token embutido em URL Git
  /\b[A-Za-z0-9._-]*:[^@/\s]+@github\.com/, // credencial embutida
];

/** Resultado do scanner: achados (sem ecoar o valor) por categoria. */
export interface SecretScanFinding {
  readonly kind: 'secret-value' | 'secret-field' | 'private-field';
  /** Caminho JSON ate o achado (sem o valor). */
  readonly path: string;
  readonly reason: string;
}

export interface SecretScanResult {
  readonly clean: boolean;
  readonly findings: readonly SecretScanFinding[];
}

/**
 * Inspeciona recursivamente uma estrutura (pacote, log, auditoria, backup)
 * buscando: (a) valores que casam padroes de segredo; (b) nomes de campo que
 * indicam segredo; (c) campos classificados como privados que nao deveriam
 * estar numa saida publica. NUNCA inclui o valor detectado no achado (7.20).
 */
export function scanForSecrets(
  value: unknown,
  options: { readonly forbiddenPrivateFields?: readonly string[] } = {},
): SecretScanResult {
  const findings: SecretScanFinding[] = [];
  const forbidden = new Set(options.forbiddenPrivateFields ?? []);
  walk(value, '', findings, forbidden);
  return { clean: findings.length === 0, findings };
}

function walk(value: unknown, path: string, findings: SecretScanFinding[], forbidden: ReadonlySet<string>): void {
  if (typeof value === 'string') {
    if (SECRET_VALUE_PATTERNS.some((re) => re.test(value))) {
      findings.push({ kind: 'secret-value', path: path || '(raiz)', reason: 'valor casa um padrao de segredo' });
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => walk(v, `${path}[${i}]`, findings, forbidden));
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const childPath = path === '' ? k : `${path}.${k}`;
      if (isSecretField(k)) {
        findings.push({ kind: 'secret-field', path: childPath, reason: 'nome de campo indica segredo' });
      }
      if (forbidden.has(k)) {
        findings.push({ kind: 'private-field', path: childPath, reason: 'campo privado proibido em saida publica' });
      }
      walk(v, childPath, findings, forbidden);
    }
  }
}

/**
 * Garante que uma saida esta limpa de segredos conhecidos, redigindo-os antes
 * de emitir. Combina o scanner (deteccao estrutural) com o redator (mascara de
 * valores literais conhecidos). Retorna o valor seguro para emissao.
 */
export function sanitizeOutput(value: unknown, secrets: SecretSet): unknown {
  return redactValue(value, secrets);
}
