// CredentialService: estado de credencial, redator central de segredos e gate
// de operacoes sensiveis (tarefa 11.3).
//
// Objetivo (Requisitos 10.18-10.20, 11.6-11.12; design.md "Autenticacao e
// credenciais GitHub"):
//
//   - O token NUNCA cruza a IPC para a UI, nem aparece em workspace, URL Git,
//     log, auditoria, backup ou pacote (11.7, 11.8, 11.11, Property 38). O
//     segredo so existe no cofre do SO (adaptador nativo, camada Rust).
//   - A UI ve apenas METADADOS nao secretos: estado, conta, repositorios
//     autorizados e expiracao (10.19).
//   - Remover acesso apaga o cofre e limpa memoria; credencial removida ou
//     expirada BLOQUEIA push e preserva o trabalho (10.20, 11.9, 11.10).
//
// Este modulo e TypeScript PURO: nao armazena segredos reais nem faz I/O. Ele
// fornece (a) o MODELO de estado publico da credencial, (b) o REDATOR central
// que garante que nenhuma substring de um segredo escape em qualquer saida, e
// (c) o GATE que decide se uma operacao sensivel pode prosseguir. A guarda
// efetiva do segredo (cofre, memoria) vive na camada Rust (tarefa 11.12).

// --------------------------------------------------------------------------
// Estado publico da credencial (unico que a UI recebe)
// --------------------------------------------------------------------------

export type CredentialStatus = 'absent' | 'active' | 'expired' | 'revoked';

/**
 * Visao PUBLICA da credencial — nunca contem o token. E o unico objeto que
 * cruza a IPC para a UI.
 */
export interface CredentialPublicState {
  readonly status: CredentialStatus;
  /** Login/conta GitHub (metadado nao secreto). */
  readonly account?: string;
  /** Repositorios autorizados (metadado nao secreto). */
  readonly authorizedRepositories: readonly string[];
  /** Instante de expiracao (ISO/UTC), quando aplicavel. */
  readonly expiresAt?: string;
  /**
   * Representacao OCULTADA para exibicao: somente caracteres de mascara e
   * metadados nao secretos (ex.: "ghp_****"). Nunca contem o valor real.
   */
  readonly maskedHint?: string;
}

/** Decide se a credencial esta utilizavel para operacoes sensiveis (10.20). */
export function isUsable(state: CredentialPublicState, now: string): boolean {
  if (state.status !== 'active') return false;
  if (state.expiresAt !== undefined) {
    const exp = Date.parse(state.expiresAt);
    const nowMs = Date.parse(now);
    if (!Number.isNaN(exp) && !Number.isNaN(nowMs) && exp <= nowMs) return false;
  }
  return true;
}

// --------------------------------------------------------------------------
// Gate de operacao sensivel (push, publicacao)
// --------------------------------------------------------------------------

export type SensitiveGateResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'no-credential' | 'expired' | 'revoked'; readonly message: string };

/**
 * Bloqueia operacoes sensiveis quando a credencial esta ausente, expirada ou
 * revogada, preservando o trabalho (11.9, 11.10). As mensagens sao em portugues
 * e NUNCA citam o token.
 */
export function gateSensitiveOperation(state: CredentialPublicState, now: string): SensitiveGateResult {
  if (state.status === 'absent') {
    return { ok: false, reason: 'no-credential', message: 'nao ha credencial; conecte-se ao GitHub para publicar. Seu trabalho foi preservado.' };
  }
  if (state.status === 'revoked') {
    return { ok: false, reason: 'revoked', message: 'o acesso foi removido; reconecte-se para publicar. Seu trabalho foi preservado.' };
  }
  if (!isUsable(state, now)) {
    return { ok: false, reason: 'expired', message: 'a credencial expirou; renove o acesso para publicar. Seu trabalho foi preservado.' };
  }
  return { ok: true };
}

// --------------------------------------------------------------------------
// Redator central de segredos (Property 38 / 11.7, 11.8, 11.11)
// --------------------------------------------------------------------------

/** Mascara usada para substituir qualquer segredo detectado. */
export const REDACTION_MASK = '[REDACTED]';

/**
 * Registro de segredos ATIVOS a redigir. Mantido pela camada que conhece os
 * valores (fora deste modulo); aqui so recebemos as strings a mascarar. Este
 * objeto nunca e serializado em saidas.
 */
export interface SecretSet {
  /** Valores literais de segredo (token, refresh token, client secret, etc.). */
  readonly values: readonly string[];
}

/**
 * Redige QUALQUER ocorrencia (substring) de um segredo conhecido em um texto,
 * substituindo-a pela mascara. Cobre tambem variantes comuns de codificacao em
 * URL (o token embutido em `https://x-access-token:<token>@host`) ao redigir o
 * valor cru. Garante que nenhuma substring do segredo sobreviva (Property 38).
 */
export function redactText(text: string, secrets: SecretSet): string {
  let out = text;
  // Redige do segredo mais longo para o mais curto, evitando mascarar um
  // prefixo e deixar o sufixo de um segredo maior.
  const ordered = [...secrets.values].filter((v) => v.length > 0).sort((a, b) => b.length - a.length);
  for (const secret of ordered) {
    out = splitReplaceAll(out, secret, REDACTION_MASK);
  }
  return out;
}

/**
 * Redige recursivamente qualquer segredo em uma estrutura JSON-like (objeto,
 * array, string), preservando a forma. Usado antes de gravar logs, auditoria,
 * backup ou pacote, e antes de qualquer envio pela IPC.
 */
export function redactValue(value: unknown, secrets: SecretSet): unknown {
  if (typeof value === 'string') return redactText(value, secrets);
  if (Array.isArray(value)) return value.map((v) => redactValue(v, secrets));
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      // Tambem redige o segredo se ele aparecer como NOME de chave.
      out[redactText(k, secrets)] = redactValue(v, secrets);
    }
    return out;
  }
  return value;
}

/**
 * Verifica que NENHUMA substring de qualquer segredo conhecido aparece no texto
 * dado. Util como assercao defensiva antes de emitir qualquer saida. Retorna a
 * lista de segredos vazados (vazia quando limpo).
 */
export function containsSecret(text: string, secrets: SecretSet): readonly string[] {
  return secrets.values.filter((s) => s.length > 0 && text.includes(s));
}

/**
 * Constroi a representacao OCULTADA de um token para exibicao: somente a classe
 * (prefixo nao secreto antes do primeiro `_`, se houver) seguida de mascara.
 * Nunca revela caracteres do segredo.
 */
export function maskedHintOf(tokenPrefixClass: string): string {
  const safeClass = tokenPrefixClass.replace(/[^a-zA-Z0-9-]/g, '');
  return safeClass.length > 0 ? `${safeClass}_****` : '****';
}

// --------------------------------------------------------------------------
// Auxiliares
// --------------------------------------------------------------------------

/**
 * Substitui TODAS as ocorrencias de `needle` por `replacement` sem usar regex
 * (evita problemas de escape com caracteres especiais de segredos).
 */
function splitReplaceAll(haystack: string, needle: string, replacement: string): string {
  if (needle === '') return haystack;
  return haystack.split(needle).join(replacement);
}
