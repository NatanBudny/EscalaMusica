// Journal local, recuperacao de crash e desfazer (tarefa 11.1).
//
// Objetivo (Requisitos 12.1-12.3, 12.11, 13.16; design.md "Estado local e
// persistencia" / "Modelo de falhas e recuperacao"):
//
//   - Cada conjunto de arquivos e escrito em STAGING, sincronizado, validado e
//     movido ATOMICAMENTE. Um journal registra os marcos `prepared`,
//     `files-written`, `committed`, `pushed` (12.1).
//   - Na abertura, o RecoveryService recupera o ULTIMO estado confirmado e
//     descarta staging parcial: uma falha injetada em qualquer marco NUNCA
//     promove um estado parcial (12.3, 12.11).
//   - Desfazer restaura EXATAMENTE a revisao anterior elegivel (12.2): cada
//     snapshot confirmado guarda o hash do conteudo e o hash do pai, formando
//     uma cadeia linear restauravel.
//
// Este modulo e TypeScript PURO: nao faz I/O. Ele modela a MAQUINA DE ESTADOS
// do journal e as decisoes de recuperacao/undo de forma deterministica e
// testavel. A camada Rust (tarefa 11.12) aplica os efeitos reais de filesystem
// (escrita atomica, fsync, troca) guiada por estas decisoes.
//
// Reusa o hashing canonico (`canonicalHash`) e os tipos de instante/hash.

import type { Sha256, Utc } from '../schemas/models';
import { canonicalHash } from '../schemas/canonical';

// --------------------------------------------------------------------------
// Marcos do journal
// --------------------------------------------------------------------------

/**
 * Marcos de uma operacao, na ordem de avanco. Cada marco so pode ser alcancado
 * a partir do anterior (maquina de estados linear).
 *
 *   prepared     -> operacao registrada, staging reservado
 *   files-written-> arquivos escritos no staging e sincronizados em disco
 *   committed    -> troca atomica concluida e commit local criado
 *   pushed       -> push remoto fast-forward confirmado (estado CONFIRMADO)
 */
export type JournalMilestone = 'prepared' | 'files-written' | 'committed' | 'pushed';

const MILESTONE_ORDER: readonly JournalMilestone[] = [
  'prepared',
  'files-written',
  'committed',
  'pushed',
];

/** Indice ordinal de um marco (para comparacao de avanco). */
export function milestoneRank(m: JournalMilestone): number {
  return MILESTONE_ORDER.indexOf(m);
}

/**
 * Um marco e CONFIRMADO somente quando a operacao chega a `committed` (troca
 * atomica concluida localmente) — o conteudo ja esta integro em disco. `pushed`
 * confirma adicionalmente a sincronizacao remota. Marcos `prepared` e
 * `files-written` sao estados de STAGING parcial e NUNCA sao promovidos.
 */
export function isCommitted(m: JournalMilestone): boolean {
  return milestoneRank(m) >= milestoneRank('committed');
}

// --------------------------------------------------------------------------
// Entradas do journal
// --------------------------------------------------------------------------

/** Uma entrada do journal: uma operacao e o marco ate onde ela avancou. */
export interface JournalEntry {
  readonly operationId: string;
  /** Marco atingido por esta operacao. */
  readonly milestone: JournalMilestone;
  /** Hash canonico do conteudo resultante da operacao. */
  readonly resultHash: Sha256;
  /** Hash do conteudo IMEDIATAMENTE anterior (cadeia de undo). */
  readonly parentHash: Sha256;
  /** Instante do registro. */
  readonly at: Utc;
  /** SHA remoto de origem (baseCommit) observado ao iniciar a operacao. */
  readonly baseCommit?: string;
}

/**
 * Um snapshot confirmado: estado integro ao qual a recuperacao pode voltar.
 * Guarda o conteudo (opaco para este modulo) e seu hash canonico.
 */
export interface Snapshot<T = unknown> {
  readonly hash: Sha256;
  readonly parentHash?: Sha256;
  readonly content: T;
  readonly operationId: string;
  readonly at: Utc;
}

// --------------------------------------------------------------------------
// Avanco do journal (maquina de estados)
// --------------------------------------------------------------------------

export type JournalAdvanceResult =
  | { readonly ok: true; readonly entry: JournalEntry }
  | { readonly ok: false; readonly reason: 'non-sequential' | 'operation-mismatch' };

/**
 * Avanca uma operacao de um marco para o SEGUINTE. Recusa pulos de marco
 * (ex.: prepared -> committed) e troca de operationId, garantindo que o journal
 * so avance de forma sequencial e auditavel.
 */
export function advance(
  previous: JournalEntry | undefined,
  next: JournalEntry,
): JournalAdvanceResult {
  if (previous === undefined) {
    if (next.milestone !== 'prepared') {
      return { ok: false, reason: 'non-sequential' };
    }
    return { ok: true, entry: next };
  }
  if (previous.operationId !== next.operationId) {
    return { ok: false, reason: 'operation-mismatch' };
  }
  if (milestoneRank(next.milestone) !== milestoneRank(previous.milestone) + 1) {
    return { ok: false, reason: 'non-sequential' };
  }
  return { ok: true, entry: next };
}

// --------------------------------------------------------------------------
// Recuperacao de crash (RecoveryService)
// --------------------------------------------------------------------------

/** Decisao de recuperacao na abertura do aplicativo. */
export interface RecoveryDecision<T> {
  /** Snapshot confirmado ao qual recuperar (ultimo integro). */
  readonly recoverTo: Snapshot<T> | undefined;
  /**
   * operationIds cujo staging parcial deve ser DESCARTADO (marcos `prepared`
   * ou `files-written` que nunca foram confirmados).
   */
  readonly discardOperationIds: readonly string[];
}

/**
 * Decide, a partir do journal e dos snapshots confirmados, o estado de
 * recuperacao na abertura (12.3, 12.11):
 *
 *   - recupera para o ULTIMO snapshot confirmado (o de maior posicao na cadeia);
 *   - descarta QUALQUER operacao cujo ultimo marco seja parcial (nao chegou a
 *     `committed`), pois representa staging interrompido.
 *
 * Puro e deterministico: nao faz I/O e nao muta as entradas.
 */
export function recover<T>(
  journal: readonly JournalEntry[],
  confirmedSnapshots: readonly Snapshot<T>[],
): RecoveryDecision<T> {
  // Ultimo marco por operacao (o journal pode conter varios marcos da mesma op).
  const lastByOp = new Map<string, JournalEntry>();
  for (const e of journal) {
    const cur = lastByOp.get(e.operationId);
    if (cur === undefined || milestoneRank(e.milestone) >= milestoneRank(cur.milestone)) {
      lastByOp.set(e.operationId, e);
    }
  }

  const discardOperationIds: string[] = [];
  for (const [operationId, entry] of lastByOp) {
    if (!isCommitted(entry.milestone)) discardOperationIds.push(operationId);
  }
  discardOperationIds.sort(compareString);

  // O ultimo snapshot confirmado e o ultimo da cadeia (maior profundidade).
  const recoverTo = latestSnapshot(confirmedSnapshots);

  return { recoverTo, discardOperationIds };
}

/**
 * Encontra o snapshot "mais recente" da cadeia linear: aquele que nao e pai de
 * nenhum outro. Se a cadeia estiver ambigua/vazia, retorna o de maior
 * profundidade calculada a partir das relacoes parentHash; em empate, o maior
 * hash (determinismo).
 */
export function latestSnapshot<T>(
  snapshots: readonly Snapshot<T>[],
): Snapshot<T> | undefined {
  if (snapshots.length === 0) return undefined;
  const byHash = new Map<Sha256, Snapshot<T>>();
  for (const s of snapshots) byHash.set(s.hash, s);

  const isParentOfSomeone = new Set<Sha256>();
  for (const s of snapshots) {
    if (s.parentHash !== undefined && byHash.has(s.parentHash)) {
      isParentOfSomeone.add(s.parentHash);
    }
  }
  // Heads = snapshots que nao sao pai de ninguem.
  const heads = snapshots.filter((s) => !isParentOfSomeone.has(s.hash));
  const candidates = heads.length > 0 ? heads : [...snapshots];

  // Entre candidatos, escolhe o de maior profundidade; empate pelo maior hash.
  let best = candidates[0] as Snapshot<T>;
  let bestDepth = depthOf(best, byHash);
  for (const c of candidates.slice(1)) {
    const d = depthOf(c, byHash);
    if (d > bestDepth || (d === bestDepth && c.hash > best.hash)) {
      best = c;
      bestDepth = d;
    }
  }
  return best;
}

function depthOf<T>(s: Snapshot<T>, byHash: Map<Sha256, Snapshot<T>>): number {
  let depth = 0;
  let cur: Snapshot<T> | undefined = s;
  const seen = new Set<Sha256>();
  while (cur && cur.parentHash !== undefined && byHash.has(cur.parentHash)) {
    if (seen.has(cur.hash)) break; // protecao contra ciclo
    seen.add(cur.hash);
    cur = byHash.get(cur.parentHash);
    depth++;
  }
  return depth;
}

// --------------------------------------------------------------------------
// Desfazer (undo)
// --------------------------------------------------------------------------

export type UndoResult<T> =
  | { readonly ok: true; readonly restored: Snapshot<T> }
  | { readonly ok: false; readonly reason: 'no-parent' | 'parent-not-found' | 'not-eligible' };

/**
 * Desfaz o snapshot atual restaurando EXATAMENTE a revisao anterior (12.2). O
 * undo so e elegivel quando ha um pai confirmado na cadeia; retorna o snapshot
 * do pai, cujo hash deve ser identico ao `parentHash` do atual. Puro: nao muta.
 *
 * "Somente alteracoes elegiveis" (12.2): uma operacao ja publicada/confirmada
 * publicamente pode ser marcada como nao-elegivel pelo chamador via
 * `isEligible`; nesse caso o undo e recusado.
 */
export function undo<T>(
  current: Snapshot<T>,
  confirmedSnapshots: readonly Snapshot<T>[],
  isEligible: (snapshot: Snapshot<T>) => boolean = () => true,
): UndoResult<T> {
  if (!isEligible(current)) {
    return { ok: false, reason: 'not-eligible' };
  }
  if (current.parentHash === undefined) {
    return { ok: false, reason: 'no-parent' };
  }
  const parent = confirmedSnapshots.find((s) => s.hash === current.parentHash);
  if (parent === undefined) {
    return { ok: false, reason: 'parent-not-found' };
  }
  return { ok: true, restored: parent };
}

// --------------------------------------------------------------------------
// Construcao de snapshot a partir de conteudo
// --------------------------------------------------------------------------

/**
 * Cria um snapshot confirmado a partir de um conteudo, calculando seu hash
 * canonico. Garante a invariante "a revisao e o hash SHA-256 do JSON canonico".
 */
export function makeSnapshot<T>(params: {
  readonly content: T;
  readonly parent?: Snapshot<T>;
  readonly operationId: string;
  readonly at: Utc;
}): Snapshot<T> {
  const hash = canonicalHash(params.content);
  return params.parent === undefined
    ? { hash, content: params.content, operationId: params.operationId, at: params.at }
    : {
        hash,
        parentHash: params.parent.hash,
        content: params.content,
        operationId: params.operationId,
        at: params.at,
      };
}

// --------------------------------------------------------------------------
// Auxiliares
// --------------------------------------------------------------------------

function compareString(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}
