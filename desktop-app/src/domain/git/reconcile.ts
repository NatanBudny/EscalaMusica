// Modo offline e conciliacao guiada entre maquinas (tarefa 11.5).
//
// Objetivo (Requisitos 1.10, 12.3, 13.13-13.16; design.md "Concorrencia e
// conciliacao entre maquinas"):
//
//   - Uma alteracao offline entra numa FILA com `operationId`, `baseCommit`,
//     comando e hash do resultado; na reconexao, se o HEAD remoto nao mudou,
//     reaplica e envia; se mudou, inicia conciliacao guiada (1.10, 12.3).
//   - A conciliacao calcula base/local/remoto por ENTIDADE e CAMPO. Mudancas em
//     entidades/campos DISTINTOS sao combinadas automaticamente (mas exibidas
//     para conferencia). Mudancas no MESMO campo, exclusao vs. alteracao,
//     mudanca de versao de regras e duas aprovacoes/publicacoes exigem ESCOLHA
//     EXPLICITA (13.15).
//   - O sistema NUNCA usa force-push e NUNCA substitui automaticamente uma
//     versao divergente (13.15, Property 44).
//
// Este modulo e TypeScript PURO: nao faz I/O nem Git. Ele modela a fila offline
// e o algoritmo de conciliacao de tres vias (base/local/remoto) de forma
// deterministica e testavel.

// --------------------------------------------------------------------------
// Fila offline
// --------------------------------------------------------------------------

/** Uma operacao enfileirada offline. */
export interface QueuedOperation {
  readonly operationId: string;
  /** SHA remoto de origem observado quando a operacao foi criada. */
  readonly baseCommit: string;
  /** Nome do comando (para auditoria/exibicao). */
  readonly command: string;
  /** Hash canonico do resultado produzido localmente. */
  readonly resultHash: string;
  /** Instante de enfileiramento. */
  readonly at: string;
}

export type SyncPlan =
  | { readonly action: 'replay-and-push'; readonly operations: readonly QueuedOperation[] }
  | { readonly action: 'reconcile'; readonly reason: 'remote-head-changed'; readonly operations: readonly QueuedOperation[] }
  | { readonly action: 'nothing-to-sync' };

/**
 * Decide o plano de sincronizacao na reconexao. Se a fila esta vazia, nada a
 * fazer. Se o HEAD remoto e igual ao `baseCommit` de TODAS as operacoes
 * pendentes, reaplica e envia. Caso o HEAD tenha mudado, exige conciliacao
 * guiada (nunca reaplica cegamente).
 */
export function planSync(queue: readonly QueuedOperation[], remoteHead: string): SyncPlan {
  if (queue.length === 0) return { action: 'nothing-to-sync' };
  const allOnBase = queue.every((op) => op.baseCommit === remoteHead);
  if (allOnBase) {
    return { action: 'replay-and-push', operations: [...queue] };
  }
  return { action: 'reconcile', reason: 'remote-head-changed', operations: [...queue] };
}

// --------------------------------------------------------------------------
// Conciliacao de tres vias por entidade/campo
// --------------------------------------------------------------------------

/** Mudanca de um campo de uma entidade em uma das pontas (local ou remoto). */
export interface FieldChange {
  readonly entityId: string;
  readonly field: string;
  readonly change: 'set' | 'delete';
  readonly value?: unknown;
}

/** Categorias especiais que nunca sao mescladas campo a campo (13.15). */
export type SpecialKind = 'ruleset-version' | 'approval' | 'publication';

/** Marca de uma mudanca especial em uma ponta. */
export interface SpecialChange {
  readonly kind: SpecialKind;
  readonly ref: string;
}

/** Resultado de conciliacao: parte combinavel + conflitos que exigem escolha. */
export interface ReconcileResult {
  /** Mudancas combinadas automaticamente (entidades/campos disjuntos). */
  readonly autoMerged: readonly FieldChange[];
  /** Conflitos que exigem escolha explicita do operador. */
  readonly conflicts: readonly ReconcileConflict[];
  /**
   * Verdadeiro quando ha ao menos um conflito: nesse caso NENHUMA sobrescrita
   * automatica ocorre e o resultado final depende das escolhas do operador.
   */
  readonly requiresOperatorChoice: boolean;
}

export type ReconcileConflict =
  | {
      readonly type: 'same-field';
      readonly entityId: string;
      readonly field: string;
      readonly local: FieldChange;
      readonly remote: FieldChange;
    }
  | {
      readonly type: 'delete-vs-modify';
      readonly entityId: string;
      readonly field: string;
      readonly local: FieldChange;
      readonly remote: FieldChange;
    }
  | {
      readonly type: 'special';
      readonly kind: SpecialKind;
      readonly localRef: string;
      readonly remoteRef: string;
    };

/**
 * Concilia mudancas locais e remotas sobre uma base comum. Mudancas em
 * entidades/campos DISTINTOS sao auto-combinadas. Colisao no mesmo campo,
 * exclusao vs. alteracao e categorias especiais divergentes viram CONFLITOS.
 * Puro e deterministico (saidas ordenadas).
 */
export function reconcile(params: {
  readonly local: readonly FieldChange[];
  readonly remote: readonly FieldChange[];
  readonly localSpecial?: readonly SpecialChange[];
  readonly remoteSpecial?: readonly SpecialChange[];
}): ReconcileResult {
  const autoMerged: FieldChange[] = [];
  const conflicts: ReconcileConflict[] = [];

  const key = (c: FieldChange): string => `${c.entityId}\u0000${c.field}`;
  const remoteByKey = new Map<string, FieldChange>();
  for (const r of params.remote) remoteByKey.set(key(r), r);
  const localByKey = new Map<string, FieldChange>();
  for (const l of params.local) localByKey.set(key(l), l);

  // Local vs remoto no mesmo campo.
  for (const l of params.local) {
    const r = remoteByKey.get(key(l));
    if (r === undefined) {
      autoMerged.push(l); // campo so mudou localmente
      continue;
    }
    // Ambos mudaram o mesmo campo.
    if (l.change === 'delete' && r.change === 'set') {
      conflicts.push({ type: 'delete-vs-modify', entityId: l.entityId, field: l.field, local: l, remote: r });
    } else if (l.change === 'set' && r.change === 'delete') {
      conflicts.push({ type: 'delete-vs-modify', entityId: l.entityId, field: l.field, local: l, remote: r });
    } else if (sameValue(l, r)) {
      // Mudanca identica dos dois lados: converge sem conflito.
      autoMerged.push(l);
    } else {
      conflicts.push({ type: 'same-field', entityId: l.entityId, field: l.field, local: l, remote: r });
    }
  }

  // Campos que so mudaram no remoto.
  for (const r of params.remote) {
    if (!localByKey.has(key(r))) autoMerged.push(r);
  }

  // Categorias especiais: qualquer divergencia exige escolha.
  const localSpecial = params.localSpecial ?? [];
  const remoteSpecial = params.remoteSpecial ?? [];
  const specialKinds = new Set<SpecialKind>([
    ...localSpecial.map((s) => s.kind),
    ...remoteSpecial.map((s) => s.kind),
  ]);
  for (const kind of specialKinds) {
    const l = localSpecial.find((s) => s.kind === kind);
    const r = remoteSpecial.find((s) => s.kind === kind);
    if (l !== undefined && r !== undefined && l.ref !== r.ref) {
      conflicts.push({ type: 'special', kind, localRef: l.ref, remoteRef: r.ref });
    }
  }

  autoMerged.sort(compareChange);
  conflicts.sort(compareConflict);

  return {
    autoMerged,
    conflicts,
    requiresOperatorChoice: conflicts.length > 0,
  };
}

// --------------------------------------------------------------------------
// Aplicacao de escolhas explicitas
// --------------------------------------------------------------------------

export type ConflictChoice = 'local' | 'remote';

/**
 * Aplica as escolhas explicitas do operador aos conflitos, produzindo o
 * conjunto final de mudancas. Lanca se faltar escolha para algum conflito — o
 * sistema nunca resolve conflito automaticamente (13.15).
 */
export function applyChoices(
  result: ReconcileResult,
  choices: ReadonlyMap<string, ConflictChoice>,
): readonly FieldChange[] {
  const out: FieldChange[] = [...result.autoMerged];
  for (const c of result.conflicts) {
    if (c.type === 'special') continue; // resolvido fora (refazer sobre a escolha)
    const id = conflictId(c);
    const choice = choices.get(id);
    if (choice === undefined) {
      throw new Error(`Conflito sem escolha explicita: ${id}`);
    }
    out.push(choice === 'local' ? c.local : c.remote);
  }
  out.sort(compareChange);
  return out;
}

export function conflictId(c: ReconcileConflict): string {
  if (c.type === 'special') return `special:${c.kind}`;
  return `${c.type}:${c.entityId}:${c.field}`;
}

// --------------------------------------------------------------------------
// Auxiliares
// --------------------------------------------------------------------------

function sameValue(a: FieldChange, b: FieldChange): boolean {
  if (a.change !== b.change) return false;
  return JSON.stringify(a.value) === JSON.stringify(b.value);
}

function compareChange(a: FieldChange, b: FieldChange): number {
  if (a.entityId !== b.entityId) return a.entityId < b.entityId ? -1 : 1;
  if (a.field !== b.field) return a.field < b.field ? -1 : 1;
  return a.change < b.change ? -1 : a.change > b.change ? 1 : 0;
}

function compareConflict(a: ReconcileConflict, b: ReconcileConflict): number {
  return conflictId(a) < conflictId(b) ? -1 : conflictId(a) > conflictId(b) ? 1 : 0;
}
