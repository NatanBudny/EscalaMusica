// GitWorkspaceService — decisoes de politica sem shell (tarefa 11.4).
//
// Objetivo (Requisitos 1.2, 10.4, 10.18, 10.20, 13.13-13.16; design.md
// "Autenticacao e credenciais GitHub" e "Concorrencia e conciliacao"):
//
//   - So e permitido operar contra o repositorio e a branch APROVADOS; qualquer
//     outro destino e bloqueado ANTES de entregar credencial a biblioteca Git
//     (10.4, 10.20).
//   - O push so avanca em FAST-FORWARD; um head remoto divergente bloqueia o
//     push (nunca force-push) e exige conciliacao (13.15, Property 44).
//   - Cada alteracao persistente vira um commit identificado com `operationId`
//     e mensagem padrao; nenhum comando shell e emitido (13.14).
//
// Este modulo e TypeScript PURO: nao executa Git. Ele decide SE e COMO a camada
// Rust (libgit2, tarefa 11.12) pode agir. Reusa os tipos de config de destino.

import type { GitDestination } from '../config/model';

// --------------------------------------------------------------------------
// Autorizacao de destino (repositorio + branch aprovados)
// --------------------------------------------------------------------------

export type DestinationCheck =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: 'repository-not-approved' | 'branch-not-approved';
      readonly message: string;
    };

/**
 * Verifica que o destino solicitado coincide EXATAMENTE com um destino
 * aprovado. A comparacao e por valor; a UI nunca fornece destino livre.
 */
export function checkDestination(
  requested: GitDestination,
  approved: GitDestination,
): DestinationCheck {
  if (normalizeRemote(requested.remoteUrl) !== normalizeRemote(approved.remoteUrl)) {
    return {
      ok: false,
      reason: 'repository-not-approved',
      message: 'o repositorio solicitado nao e o aprovado; operacao bloqueada',
    };
  }
  if (requested.branch !== approved.branch) {
    return {
      ok: false,
      reason: 'branch-not-approved',
      message: 'a branch solicitada nao e a operacional aprovada; operacao bloqueada',
    };
  }
  return { ok: true };
}

/** Normaliza a URL remota para comparacao (remove `.git` final e barra final). */
function normalizeRemote(url: string): string {
  return url.trim().replace(/\/+$/, '').replace(/\.git$/, '');
}

// --------------------------------------------------------------------------
// Decisao de push (fast-forward obrigatorio; nunca force-push)
// --------------------------------------------------------------------------

export type PushDecision =
  | { readonly action: 'push'; readonly from: string; readonly to: string }
  | { readonly action: 'up-to-date' }
  | { readonly action: 'block-diverged'; readonly reason: 'non-fast-forward'; readonly message: string };

/**
 * Decide o push comparando o head remoto observado com o `baseCommit` de
 * origem do commit local:
 *
 *   - remoto == baseCommit  -> push fast-forward do commit local;
 *   - remoto == localCommit -> ja atualizado (nada a fazer);
 *   - caso contrario        -> divergencia: BLOQUEIA (sem force-push), exige
 *                              conciliacao guiada (13.15, Property 44).
 */
export function decidePush(params: {
  readonly baseCommit: string;
  readonly localCommit: string;
  readonly remoteHead: string;
}): PushDecision {
  if (params.remoteHead === params.localCommit) {
    return { action: 'up-to-date' };
  }
  if (params.remoteHead === params.baseCommit) {
    return { action: 'push', from: params.remoteHead, to: params.localCommit };
  }
  return {
    action: 'block-diverged',
    reason: 'non-fast-forward',
    message:
      'o head remoto divergiu do ponto de partida; o push foi bloqueado para evitar sobrescrita. ' +
      'Concilie as mudancas e tente novamente.',
  };
}

// --------------------------------------------------------------------------
// Mensagem de commit identificada
// --------------------------------------------------------------------------

/**
 * Monta a mensagem de commit padrao e identificada por `operationId`. Sem
 * conteudo secreto; apenas a acao e o identificador da operacao.
 */
export function commitMessage(params: {
  readonly summary: string;
  readonly operationId: string;
}): string {
  const summary = params.summary.trim().replace(/\s+/g, ' ');
  return `${summary}\n\noperationId: ${params.operationId}`;
}

/** Garante que nenhuma operacao de force ou shell seja construida. */
export const FORBIDDEN_GIT_FLAGS: readonly string[] = ['--force', '-f', '--force-with-lease'];

/** Valida que um conjunto de argumentos Git nao contem flags proibidas. */
export function assertNoForce(args: readonly string[]): boolean {
  return !args.some((a) => FORBIDDEN_GIT_FLAGS.includes(a));
}
