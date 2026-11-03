// Pipeline de importacao de Insumos_Externos: validacao de lote atomica e
// resolucao de identidade sem fuzzy match (design.md -> "Components and
// Interfaces" -> MigrationService: "Tudo-ou-nada por lote de formato"; e
// "Migracao e homologacao" -> passo 4: "Qualquer nome ambiguo ou ausente fica
// pendente"; "Analise do repositorio atual" -> `vincular-indisponibilidade.js`:
// "No novo desenho, correspondencia aproximada nunca grava vinculo: apenas cria
// candidatos pendentes para escolha explicita").
//
// TypeScript PURO, deterministico, sem I/O. Toda operacao:
//  - nunca muta a entrada (retorna um novo estado quando aplica);
//  - em falha de lote, preserva integralmente o estado anterior (atomico).
//
// Requisitos cobertos:
//  4.12 nome que corresponde a MAIS DE UMA Pessoa_Canonica/Departamento: item
//       permanece PENDENTE; exige escolha explicita de exatamente uma.
//  4.13 nome que NAO corresponde a EXATAMENTE UMA: item permanece PENDENTE, a
//       associacao nao e aplicada e os dados existentes sao preservados.
//  4.14 ao terminar a importacao, cada item de origem recebe EXATAMENTE UMA
//       classificacao (aceito/corrigido/pendente/rejeitado), com motivo, e sao
//       apresentados os totais por classificacao.
//  9.5  validar TODOS os registros do arquivo contra a especificacao
//       documentada ANTES de alterar dados existentes.
//  9.6  se o arquivo ou QUALQUER registro nao atender a especificacao, rejeitar
//       a importacao COMPLETA, preservar todos os dados existentes e indicar
//       que nenhuma alteracao foi aplicada.
//  9.7  para cada valor invalido: informar arquivo, posicao, campo e motivo.
//  9.13 a soma de importado + transformado + rejeitado + pendente e igual ao
//       total lido (particao completa).
//  9.14 referencia a pessoa/departamento que nao corresponda de forma UNICA ao
//       Cadastro_Central: item pendente, sem criar nem escolher associacao,
//       informando a referencia que exige decisao.
//
// Reuso: o modelo de saida por item e o `MigrationItem` canonico (schemas/
// models.ts); a resolucao de identidade usa `identityKey` do namespace de
// identidade do cadastro (registry/identity.ts). Nao ha modelo paralelo.

import { SCHEMA_VERSION } from '../schemas/models';
import type { MigrationItem, Uuid } from '../schemas/models';
import { identityKey } from '../registry/identity';
import type { IdentitySubject } from '../registry/identity';

// --------------------------------------------------------------------------
// Entrada do lote
// --------------------------------------------------------------------------

/**
 * Um registro bruto de origem a importar. O `name` e o texto de origem que
 * precisa ser associado a uma Pessoa_Canonica ou Departamento do cadastro. Os
 * demais campos sao os dados que acompanham o registro (opacos ao pipeline).
 */
export interface ImportRecord {
  /** Posicao identificavel na origem (ex.: "linha 12", "item[3]"). */
  readonly position: string;
  /** Nome/identidade de origem a resolver contra o cadastro. */
  readonly name: string;
  /** Dados do registro, preservados sem interpretacao pelo pipeline. */
  readonly payload?: Readonly<Record<string, unknown>>;
}

/** Lote de importacao de um unico arquivo/formato. */
export interface ImportBatch {
  /** Nome do arquivo de origem (ex.: "indisponibilidade-2026-02.json"). */
  readonly sourceFile: string;
  /** Registros lidos, na ordem de origem. */
  readonly records: readonly ImportRecord[];
}

// --------------------------------------------------------------------------
// Validacao objetiva por registro (9.5-9.7)
// --------------------------------------------------------------------------

/** Erro de validacao de um unico valor/registro (9.7). */
export interface RecordValidationError {
  /** Campo afetado dentro do registro (ex.: "name"). */
  readonly field: string;
  /** Motivo legivel em portugues. */
  readonly reason: string;
}

/**
 * Valida um registro contra a especificacao documentada do formato. Retorna a
 * lista de erros (vazia quando o registro e valido). Um validador padrao
 * (`defaultRecordValidator`) aplica as invariantes minimas; formatos
 * especificos podem fornecer um validador proprio.
 */
export type RecordValidator = (record: ImportRecord) => RecordValidationError[];

/**
 * Validador minimo padrao: exige um `name` nao vazio apos normalizacao de
 * espacos e uma `position` nao vazia. Formatos com schema proprio devem passar
 * um validador que cubra todos os campos documentados.
 */
export const defaultRecordValidator: RecordValidator = (record) => {
  const errors: RecordValidationError[] = [];
  if (typeof record.position !== 'string' || record.position.trim().length === 0) {
    errors.push({ field: 'position', reason: 'posicao de origem ausente ou vazia' });
  }
  if (typeof record.name !== 'string' || record.name.trim().length === 0) {
    errors.push({ field: 'name', reason: 'nome de origem ausente ou vazio' });
  }
  return errors;
};

// --------------------------------------------------------------------------
// Resolucao de identidade SEM fuzzy match (4.12, 4.13, 9.14)
// --------------------------------------------------------------------------

/**
 * Resolve um nome de origem contra o namespace de identidade do cadastro,
 * retornando TODOS os sujeitos cujo nome canonico ou alias tenha a MESMA chave
 * de identidade (`trim + colapso de espacos + casefold Unicode`).
 *
 * A comparacao e EXATA por chave de identidade. Nunca ha correspondencia
 * aproximada (fuzzy). A cardinalidade do resultado decide a classificacao:
 *  - 1 sujeito  -> correspondencia unica (pode associar);
 *  - 0 sujeitos -> sem correspondencia  -> pendente (4.13/9.14);
 *  - >1 sujeito -> ambiguo              -> pendente (4.12/9.14).
 *
 * Retorna os ids distintos dos sujeitos correspondentes, em ordem estavel.
 */
export function resolveIdentityMatches(
  name: string,
  subjects: readonly IdentitySubject[],
): Uuid[] {
  const key = identityKey(name);
  const matched = new Set<Uuid>();
  for (const subject of subjects) {
    if (identityKey(subject.canonicalName) === key) {
      matched.add(subject.id);
      continue;
    }
    for (const alias of subject.aliases) {
      if (identityKey(alias) === key) {
        matched.add(subject.id);
        break;
      }
    }
  }
  return [...matched].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

// --------------------------------------------------------------------------
// Resultado da importacao
// --------------------------------------------------------------------------

/** Classificacao de um item de origem (particao de 4.14/9.13). */
export type ImportClassification = MigrationItem['classification'];

/**
 * Resultado por item resolvido. Estende o `MigrationItem` canonico com o(s)
 * id(s) de sujeito correspondente(s) (vazio quando pendente por ausencia).
 */
export interface ImportItemResult {
  readonly item: MigrationItem;
  /**
   * Ids de sujeitos candidatos encontrados por identidade exata. Para itens
   * `imported`/`transformed` contem exatamente um id (a associacao aplicada).
   * Para itens `pending` ambiguos contem dois ou mais ids (as opcoes que o
   * Operador deve desambiguar). Vazio quando nao ha correspondencia.
   */
  readonly candidateSubjectIds: Uuid[];
}

/** Totais por classificacao (particao completa, 9.13). */
export interface ImportTotals {
  readonly read: number;
  readonly imported: number;
  readonly transformed: number;
  readonly rejected: number;
  readonly pending: number;
}

/**
 * Relatorio de uma importacao APLICADA com sucesso (lote valido). Contem a
 * classificacao por item e os totais. `applied` indica se o lote inteiro
 * passou na validacao objetiva e, portanto, pode alterar dados.
 */
export interface ImportReport {
  readonly sourceFile: string;
  readonly applied: true;
  readonly items: readonly ImportItemResult[];
  readonly totals: ImportTotals;
}

/**
 * Relatorio de um lote REJEITADO por validacao objetiva (9.5-9.7). Nenhuma
 * alteracao foi aplicada; o estado anterior e preservado. Os erros identificam
 * arquivo, posicao, campo e motivo para cada valor invalido.
 */
export interface BatchRejection {
  readonly sourceFile: string;
  readonly applied: false;
  /** Erros por registro invalido, com arquivo/posicao/campo/motivo (9.7). */
  readonly errors: ReadonlyArray<{
    readonly sourceFile: string;
    readonly position: string;
    readonly field: string;
    readonly reason: string;
  }>;
  /** Totais (tudo lido, nada aplicado). */
  readonly totals: ImportTotals;
}

export type ImportResult = ImportReport | BatchRejection;

// --------------------------------------------------------------------------
// Pipeline
// --------------------------------------------------------------------------

/** Opcoes do pipeline. */
export interface ImportPipelineOptions {
  /** Validador por registro; por padrao, `defaultRecordValidator`. */
  readonly validateRecord?: RecordValidator;
  /**
   * Conjunto de ids de origem (`sourceIdentity`) que, quando resolvidos de
   * forma unica, exigem transformacao (ex.: normalizacao de telefone) e devem
   * ser classificados como `transformed` em vez de `imported`. O pipeline em
   * si nao transforma payload; a marcacao e informada por este predicado.
   */
  readonly needsTransform?: (record: ImportRecord, subjectId: Uuid) => boolean;
  /**
   * Gerador de id para o `MigrationItem`. Por padrao, deriva um id
   * deterministico de `sourceFile` + `position` para manter a pureza.
   */
  readonly makeItemId?: (sourceFile: string, position: string) => Uuid;
}

function defaultItemId(sourceFile: string, position: string): Uuid {
  // Id deterministico (nao-UUID, mas estavel e puro) para o item de migracao.
  // Mantem o pipeline deterministico sem depender de geracao aleatoria.
  return `import:${sourceFile}#${position}`;
}

function emptyTotals(read: number): ImportTotals {
  return { read, imported: 0, transformed: 0, rejected: 0, pending: 0 };
}

/**
 * Executa a importacao de um lote.
 *
 * Fase 1 — Validacao objetiva do lote inteiro (9.5-9.7):
 *   valida CADA registro contra a especificacao. Se QUALQUER registro for
 *   invalido, o lote e REJEITADO por completo, nenhuma alteracao e aplicada e
 *   os erros identificam arquivo/posicao/campo/motivo. (Atomicidade.)
 *
 * Fase 2 — Resolucao de identidade SEM fuzzy (4.12, 4.13, 9.14):
 *   para cada registro valido, resolve o nome por identidade exata.
 *     - exatamente 1 correspondencia -> `imported` (ou `transformed` quando o
 *       predicado `needsTransform` indicar);
 *     - 0 ou >1 correspondencias     -> `pending`, sem aplicar associacao.
 *
 * Fase 3 — Particao e totais (4.14, 9.13):
 *   cada item recebe exatamente uma classificacao; os totais somam o total
 *   lido. Como a validacao ja garantiu lote valido, nao ha `rejected` nesta
 *   fase (rejeicao e sempre de lote inteiro).
 *
 * A funcao e PURA: nao altera `batch`, `subjects` nem nenhum estado externo.
 */
export function runImportPipeline(
  batch: ImportBatch,
  subjects: readonly IdentitySubject[],
  options: ImportPipelineOptions = {},
): ImportResult {
  const validate = options.validateRecord ?? defaultRecordValidator;
  const makeItemId = options.makeItemId ?? defaultItemId;
  const read = batch.records.length;

  // --- Fase 1: validacao objetiva do lote inteiro (9.5-9.7) ---
  const errors: BatchRejection['errors'] = batch.records.flatMap((record) =>
    validate(record).map((e) => ({
      sourceFile: batch.sourceFile,
      position: record.position,
      field: e.field,
      reason: e.reason,
    })),
  );

  if (errors.length > 0) {
    // 9.6: rejeita a importacao COMPLETA; nenhuma alteracao aplicada.
    return {
      sourceFile: batch.sourceFile,
      applied: false,
      errors,
      totals: emptyTotals(read),
    };
  }

  // --- Fase 2/3: resolucao de identidade e classificacao por item ---
  const items: ImportItemResult[] = [];
  let imported = 0;
  let transformed = 0;
  const pendingClass: ImportClassification = 'pending';

  for (const record of batch.records) {
    const candidateSubjectIds = resolveIdentityMatches(record.name, subjects);
    const id = makeItemId(batch.sourceFile, record.position);

    const base = {
      schemaVersion: SCHEMA_VERSION,
      id,
      sourceFile: batch.sourceFile,
      sourcePosition: record.position,
      sourceIdentity: record.name,
    } as const;

    if (candidateSubjectIds.length === 1) {
      const subjectId = candidateSubjectIds[0]!;
      const needsTransform = options.needsTransform?.(record, subjectId) === true;
      const classification: ImportClassification = needsTransform ? 'transformed' : 'imported';
      if (needsTransform) transformed += 1;
      else imported += 1;
      items.push({
        item: {
          ...base,
          classification,
          affectedFields: [],
        },
        candidateSubjectIds,
      });
      continue;
    }

    // 0 ou >1: pendente. Nenhuma associacao criada/escolhida (4.12, 4.13, 9.14).
    const reason =
      candidateSubjectIds.length === 0
        ? 'nenhuma correspondencia unica no Cadastro_Central: exige decisao explicita'
        : 'multiplas correspondencias no Cadastro_Central: exige selecao de exatamente uma';
    items.push({
      item: {
        ...base,
        classification: pendingClass,
        reason,
        affectedFields: ['name'],
      },
      candidateSubjectIds,
    });
  }

  const pending = items.filter((i) => i.item.classification === 'pending').length;

  return {
    sourceFile: batch.sourceFile,
    applied: true,
    items,
    totals: {
      read,
      imported,
      transformed,
      rejected: 0,
      pending,
    },
  };
}

// --------------------------------------------------------------------------
// Helpers de verificacao (reutilizados por testes de propriedade 4.6/4.7/4.8)
// --------------------------------------------------------------------------

/**
 * Verifica a particao completa do relatorio (4.14, 9.13): a soma de
 * importado + transformado + rejeitado + pendente e igual ao total lido e cada
 * item possui exatamente uma classificacao permitida.
 */
export function isCompletePartition(result: ImportResult): boolean {
  const t = result.totals;
  const sum = t.imported + t.transformed + t.rejected + t.pending;
  if (sum !== t.read) return false;

  if (result.applied) {
    if (result.items.length !== t.read) return false;
    let imported = 0;
    let transformed = 0;
    let pending = 0;
    let rejected = 0;
    for (const { item } of result.items) {
      switch (item.classification) {
        case 'imported':
          imported += 1;
          break;
        case 'transformed':
          transformed += 1;
          break;
        case 'pending':
          pending += 1;
          break;
        case 'rejected':
          rejected += 1;
          break;
        default:
          return false;
      }
    }
    return (
      imported === t.imported &&
      transformed === t.transformed &&
      pending === t.pending &&
      rejected === t.rejected
    );
  }

  // Lote rejeitado: nada aplicado, tudo contabilizado como lido.
  return t.imported === 0 && t.transformed === 0 && t.pending === 0 && t.rejected === 0;
}

/**
 * `true` quando NENHUM item ambiguo ou sem correspondencia recebeu associacao
 * (4.12, 4.13, 9.14): todo item cujo numero de candidatos seja diferente de 1
 * esta pendente e nao gerou associacao.
 */
export function neverResolvesAmbiguous(result: ImportResult): boolean {
  if (!result.applied) return true;
  return result.items.every(({ item, candidateSubjectIds }) => {
    if (candidateSubjectIds.length === 1) {
      return item.classification === 'imported' || item.classification === 'transformed';
    }
    return item.classification === 'pending';
  });
}
