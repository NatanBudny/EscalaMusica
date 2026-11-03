// Escrita por staging com troca atomica apos validacao.
//
// Modela o fluxo descrito no design.md ("Estado local e persistencia"):
//
//   aplicar comando -> escrever em area temporaria (staging) -> validar
//   esquema e invariantes -> TROCA ATOMICA -> (commit)
//
// Invariantes objetivas (Requisitos 12.1, 12.3, 12.11; "Validacao objetiva" da
// tarefa 2.2):
//
//   1. A troca so ocorre APOS a validacao ter sido concluida com sucesso.
//   2. Qualquer falha ANTES da troca (validacao reprovada, erro ao escrever o
//      staging, erro injetado antes do commit) preserva integralmente o
//      snapshot anterior: o estado persistido permanece exatamente igual ao de
//      antes da operacao (Requisitos 12.3, 12.11).
//   3. A operacao so indica conclusao depois que o novo snapshot foi efetivado
//      (Requisito 12.1).
//
// Este modulo e TypeScript puro. O I/O real (sistema de arquivos, Git) e
// injetado via `SnapshotStore`, o que mantem o dominio deterministico e
// testavel sem tocar em disco. O "Rust core"/camada IPC fornecera uma
// implementacao concreta da interface.

import { canonicalBytes, canonicalHash, type CanonicalBytes } from './canonical';

/** Snapshot persistido: bytes canonicos e sua revisao (hash SHA-256 hex). */
export interface Snapshot {
  readonly bytes: CanonicalBytes;
  readonly revision: string;
}

/**
 * Armazenamento de snapshot com semantica de troca atomica. O contrato e
 * minimo e deliberadamente sincrono para manter o dominio deterministico.
 *
 * Contrato de atomicidade:
 *   - `commit` DEVE substituir o snapshot atual apenas se concluir sem erro;
 *   - se `commit` lancar, o snapshot anterior DEVE permanecer inalterado.
 *
 * A implementacao de referencia `InMemorySnapshotStore` respeita este contrato.
 */
export interface SnapshotStore {
  /** Retorna o snapshot atual, ou `null` quando ainda nao ha nenhum. */
  readStage(): Snapshot | null;
  /** Efetiva o novo snapshot de forma atomica (troca). */
  commit(next: Snapshot): void;
}

/** Resultado tipado de uma tentativa de escrita por staging. */
export type StagedWriteResult =
  | {
      readonly ok: true;
      /** Revisao (SHA-256 hex) do snapshot efetivado. */
      readonly revision: string;
    }
  | {
      readonly ok: false;
      /** Classe objetiva da falha. */
      readonly kind: 'validation' | 'staging' | 'commit';
      /** Mensagem legivel em portugues. */
      readonly message: string;
      /**
       * Revisao do snapshot preservado (o anterior). `null` quando nao havia
       * snapshot previo. Nunca reflete os dados candidatos quando `ok` e false.
       */
      readonly preservedRevision: string | null;
    };

/** Relatorio de validacao minimo compativel com o validador do dominio. */
export interface Validatable {
  readonly valid: boolean;
  readonly issues: ReadonlyArray<{ readonly message: string }>;
}

/** Opcoes da escrita por staging. */
export interface StagedWriteOptions {
  /**
   * Validacao do valor candidato. A troca so ocorre quando retorna
   * `{ valid: true }`. Se ausente, considera-se o candidato valido.
   */
  readonly validate?: (value: unknown) => Validatable;
  /**
   * Gancho opcional executado DEPOIS de escrever o staging e ANTES da troca.
   * Permite injetar uma falha de teste (Requisito 12.11 / "falha injetada
   * antes da troca"). Lancar aqui preserva o snapshot anterior.
   */
  readonly beforeCommit?: (staged: Snapshot) => void;
  /** Caminhos de arrays sem ordem semantica (ver `canonical.ts`). */
  readonly sortArraysAtPaths?: readonly string[];
}

/**
 * Escreve um valor por staging e so troca o snapshot apos validacao.
 *
 * Fluxo:
 *   1. Serializa o candidato em bytes canonicos (area de staging logica).
 *   2. Valida; se reprovar, NAO troca e preserva o snapshot anterior.
 *   3. Executa `beforeCommit` (ponto de falha injetavel); se lancar, preserva.
 *   4. Troca atomica via `store.commit`; se lancar, preserva.
 *   5. Em sucesso, retorna a revisao do novo snapshot.
 *
 * Nunca lanca: todas as falhas viram um resultado tipado com o snapshot
 * preservado identificado.
 */
export function stagedWrite(
  store: SnapshotStore,
  value: unknown,
  options: StagedWriteOptions = {},
): StagedWriteResult {
  const previous = store.readStage();
  const preservedRevision = previous ? previous.revision : null;

  const sortOpt =
    options.sortArraysAtPaths !== undefined
      ? { sortArraysAtPaths: options.sortArraysAtPaths }
      : {};

  // 1. Staging: serializa de forma canonica. Falha aqui nao altera nada.
  let staged: Snapshot;
  try {
    const bytes = canonicalBytes(value, sortOpt);
    const revision = canonicalHash(value, sortOpt);
    staged = { bytes, revision };
  } catch (err) {
    return {
      ok: false,
      kind: 'staging',
      message: `Falha ao preparar o staging canonico: ${errorMessage(err)}`,
      preservedRevision,
    };
  }

  // 2. Validacao antes da troca (Requisito 12.4/12.11): reprovar preserva.
  if (options.validate) {
    const report = options.validate(value);
    if (!report.valid) {
      const detail = report.issues.map((i) => i.message).join('; ');
      return {
        ok: false,
        kind: 'validation',
        message:
          detail.length > 0
            ? `Validacao reprovou o candidato; nenhuma alteracao aplicada: ${detail}`
            : 'Validacao reprovou o candidato; nenhuma alteracao aplicada.',
        preservedRevision,
      };
    }
  }

  // 3. Ponto de falha injetavel ANTES da troca (Requisito 12.11).
  if (options.beforeCommit) {
    try {
      options.beforeCommit(staged);
    } catch (err) {
      return {
        ok: false,
        kind: 'commit',
        message: `Falha antes da troca; snapshot anterior preservado: ${errorMessage(err)}`,
        preservedRevision,
      };
    }
  }

  // 4. Troca atomica. Se o store falhar, o contrato garante preservacao.
  try {
    store.commit(staged);
  } catch (err) {
    return {
      ok: false,
      kind: 'commit',
      message: `Falha na troca atomica; snapshot anterior preservado: ${errorMessage(err)}`,
      preservedRevision,
    };
  }

  // 5. Conclusao: novo snapshot efetivado (Requisito 12.1).
  return { ok: true, revision: staged.revision };
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/**
 * Implementacao de referencia, em memoria, de `SnapshotStore` com troca
 * atomica. Respeita o contrato: uma falha durante `commit` (via
 * `failNextCommit`) NAO altera o snapshot anterior.
 *
 * Usada em testes e como base para raciocinar sobre a semantica. Nao faz I/O.
 */
export class InMemorySnapshotStore implements SnapshotStore {
  private current: Snapshot | null;
  private pendingFailure: Error | null = null;

  constructor(initial: Snapshot | null = null) {
    this.current = initial;
  }

  readStage(): Snapshot | null {
    return this.current;
  }

  commit(next: Snapshot): void {
    // Simula uma falha de escrita durante a troca: lanca ANTES de substituir,
    // deixando o snapshot anterior intacto.
    if (this.pendingFailure) {
      const err = this.pendingFailure;
      this.pendingFailure = null;
      throw err;
    }
    // Troca atomica: atribuicao de referencia unica.
    this.current = next;
  }

  /** Agenda uma falha para a proxima chamada de `commit` (injecao de erro). */
  failNextCommit(message = 'falha de escrita simulada'): void {
    this.pendingFailure = new Error(message);
  }

  /** Revisao atual, ou `null` quando vazio. Conveniencia para testes. */
  get revision(): string | null {
    return this.current ? this.current.revision : null;
  }
}
