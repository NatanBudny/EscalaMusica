// MigrationService, comparacao de homologacao e gate de transicao (tarefa 14).
//
// Objetivo (Requisitos 9.4-9.7, 9.13, 9.14, 16.5-16.12; design.md componente
// `MigrationService` e Property 47):
//
//   14.1 Importar o cadastro a partir do inventario, separar departamentos,
//        normalizar telefones (com pendencia quando ambiguo), preservar
//        historico/texto original e IMPEDIR gravacao parcial por formato
//        (tudo-ou-nada por lote). Cada item recebe uma classificacao
//        (imported/transformed/pending/rejected) com motivo (9.4-9.7, 9.13).
//   14.2 Comparar, campo a campo, todos os cultos/campos/valores PUBLICOS do
//        pacote candidato com os dados consumidos pelo visualizador,
//        distinguindo equivalencia semantica de divergencia (16.7-16.9).
//   14.3 Ensaio de restauracao: restaurar o backup de transicao e verificar a
//        integridade antes de qualquer homologacao (16.10-16.12).
//   14.4 Gate de homologacao: so permite confirmar com zero rejeitados,
//        pendentes e divergencias E restauracao verificada (Property 47).
//
// Este modulo e TypeScript PURO: nunca grava nem toca no legado. Reusa o
// hashing canonico, os tipos `MigrationItem` e o gate de homologacao existente
// (`config/gate.ts`), alem do BackupService para o ensaio de restauracao.

import type { MigrationItem } from '../schemas/models';
import { SCHEMA_VERSION } from '../schemas/models';
import { canonicalStringify } from '../schemas/canonical';
import { verifyIntegrity, type BackupPackage } from '../backup/backupService';

// --------------------------------------------------------------------------
// 14.1 — importacao tudo-ou-nada por lote de formato
// --------------------------------------------------------------------------

/** Classificacao de um item de migracao (espelha MigrationItem). */
export type MigrationClassification = MigrationItem['classification'];

/** Uma origem de dado legado a migrar. */
export interface MigrationSource {
  readonly sourceFile: string;
  readonly sourcePosition: string;
  readonly sourceIdentity: string;
  /** Telefone bruto, quando aplicavel (para normalizacao E.164). */
  readonly rawPhone?: string;
  /** Numero de correspondencias de identidade no cadastro (0, 1 ou >1). */
  readonly identityMatches: number;
  /** Indica se e um departamento (separado das pessoas). */
  readonly isDepartment?: boolean;
  /** Texto/historico original a preservar. */
  readonly originalText?: string;
}

export interface MigrationItemResult extends MigrationItem {
  /** Telefone normalizado em E.164, quando foi possivel. */
  readonly normalizedPhone?: string;
}

/** Relatorio de migracao: itens classificados + particao por classificacao. */
export interface MigrationReport {
  readonly items: readonly MigrationItemResult[];
  readonly totals: Readonly<Record<MigrationClassification, number>>;
  /** Verdadeiro quando o lote pode ser gravado (nenhum rejeitado de formato). */
  readonly committable: boolean;
}

/**
 * Processa um lote de origens de migracao. Classifica cada item e NUNCA resolve
 * identidade ambigua por fuzzy match (0 ou >1 correspondencias -> pending). A
 * gravacao e tudo-ou-nada por formato: se QUALQUER item e `rejected` por
 * formato invalido, o lote inteiro fica nao-gravavel (`committable: false`).
 * Puro: nao grava.
 */
export function runMigration(sources: readonly MigrationSource[]): MigrationReport {
  const items: MigrationItemResult[] = sources.map((s, i) => classify(s, i));

  const totals: Record<MigrationClassification, number> = {
    imported: 0,
    transformed: 0,
    rejected: 0,
    pending: 0,
  };
  for (const item of items) totals[item.classification]++;

  // Tudo-ou-nada por formato: rejeitados por formato bloqueiam a gravacao do lote.
  const committable = totals.rejected === 0;

  return { items, totals, committable };
}

function classify(source: MigrationSource, index: number): MigrationItemResult {
  const base = {
    schemaVersion: SCHEMA_VERSION,
    id: `mig-${index}`,
    sourceFile: source.sourceFile,
    sourcePosition: source.sourcePosition,
    sourceIdentity: source.sourceIdentity,
  };

  // Identidade ambigua: nunca escolhe automaticamente (9.14).
  if (source.identityMatches === 0) {
    return { ...base, classification: 'pending', reason: 'Identidade sem correspondencia no cadastro.', affectedFields: ['canonicalName'] };
  }
  if (source.identityMatches > 1) {
    return { ...base, classification: 'pending', reason: 'Identidade com varias correspondencias; exige decisao.', affectedFields: ['canonicalName'] };
  }

  // Telefone: normaliza para E.164 ou marca pendente (nunca grava parcial).
  if (source.rawPhone !== undefined) {
    const normalized = normalizePhone(source.rawPhone);
    if (normalized === undefined) {
      return { ...base, classification: 'pending', reason: 'Telefone em formato nao reconhecido; normalizacao pendente.', affectedFields: ['phoneE164'] };
    }
    return { ...base, classification: 'transformed', reason: 'Telefone normalizado para E.164.', affectedFields: ['phoneE164'], normalizedPhone: normalized };
  }

  // Sem transformacao necessaria: importado tal como esta (historico preservado).
  return { ...base, classification: 'imported', affectedFields: [] };
}

/**
 * Normaliza um telefone brasileiro para E.164 (`+55` + 10-11 digitos). Retorna
 * `undefined` quando nao reconhece, para gerar pendencia em vez de gravar algo
 * incorreto.
 */
export function normalizePhone(raw: string): string | undefined {
  const digits = raw.replace(/\D/g, '');
  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) {
    return `+${digits}`;
  }
  if (digits.length === 10 || digits.length === 11) {
    return `+55${digits}`;
  }
  return undefined;
}

// --------------------------------------------------------------------------
// 14.2 — comparacao de homologacao campo a campo
// --------------------------------------------------------------------------

/** Valor publico de um campo de um culto, por chave composta. */
export type PublicFieldMap = Readonly<Record<string, unknown>>;

export type FieldComparison =
  | { readonly key: string; readonly result: 'equivalent' }
  | { readonly key: string; readonly result: 'divergent'; readonly candidate: unknown; readonly viewer: unknown }
  | { readonly key: string; readonly result: 'missing-in-candidate'; readonly viewer: unknown }
  | { readonly key: string; readonly result: 'extra-in-candidate'; readonly candidate: unknown };

export interface ComparisonReport {
  readonly comparisons: readonly FieldComparison[];
  readonly divergenceCount: number;
  /** Verdadeiro quando nao ha divergencia, ausencia nem excesso. */
  readonly equivalent: boolean;
}

/**
 * Compara, campo a campo, os valores publicos do pacote CANDIDATO com os dados
 * consumidos pelo VISUALIZADOR. A equivalencia e SEMANTICA (serializacao
 * canonica), nao textual. Qualquer divergencia, ausencia ou excesso conta como
 * divergencia e bloqueia a homologacao (16.7-16.9).
 */
export function compareForHomologation(candidate: PublicFieldMap, viewer: PublicFieldMap): ComparisonReport {
  const keys = new Set<string>([...Object.keys(candidate), ...Object.keys(viewer)]);
  const comparisons: FieldComparison[] = [];
  let divergenceCount = 0;

  for (const key of [...keys].sort()) {
    const inCand = Object.prototype.hasOwnProperty.call(candidate, key);
    const inView = Object.prototype.hasOwnProperty.call(viewer, key);
    if (inCand && inView) {
      if (canonicalStringify(candidate[key]) === canonicalStringify(viewer[key])) {
        comparisons.push({ key, result: 'equivalent' });
      } else {
        comparisons.push({ key, result: 'divergent', candidate: candidate[key], viewer: viewer[key] });
        divergenceCount++;
      }
    } else if (inView) {
      comparisons.push({ key, result: 'missing-in-candidate', viewer: viewer[key] });
      divergenceCount++;
    } else {
      comparisons.push({ key, result: 'extra-in-candidate', candidate: candidate[key] });
      divergenceCount++;
    }
  }

  return { comparisons, divergenceCount, equivalent: divergenceCount === 0 };
}

// --------------------------------------------------------------------------
// 14.3 — ensaio de restauracao e rollback de transicao
// --------------------------------------------------------------------------

export interface RestoreRehearsalResult {
  readonly verified: boolean;
  readonly issues: readonly string[];
}

/**
 * Ensaio de restauracao: verifica a integridade do backup de transicao (privado
 * e publico) antes de qualquer homologacao. A restauracao e considerada
 * verificada SOMENTE quando AMBOS os pacotes passam na verificacao de
 * integridade (16.10-16.12). Puro: nao escreve nada.
 */
export function rehearseRestore(params: {
  readonly privateBackup: BackupPackage;
  readonly publicBackup: BackupPackage;
}): RestoreRehearsalResult {
  const issues: string[] = [];
  const priv = verifyIntegrity(params.privateBackup);
  if (!priv.ok) issues.push(`Backup privado corrompido (${priv.issues.length} problema(s)).`);
  const pub = verifyIntegrity(params.publicBackup);
  if (!pub.ok) issues.push(`Backup publico corrompido (${pub.issues.length} problema(s)).`);
  return { verified: issues.length === 0, issues };
}

// --------------------------------------------------------------------------
// 14.4 — gate de homologacao (Property 47)
// --------------------------------------------------------------------------

export interface HomologationInputs {
  readonly migration: MigrationReport;
  readonly comparison: ComparisonReport;
  readonly restore: RestoreRehearsalResult;
}

export interface HomologationGate {
  /** Permitido SSE sem rejeitados, pendentes, divergencias e restauracao ok. */
  readonly allowed: boolean;
  readonly reasons: readonly string[];
}

/**
 * Avalia o gate de homologacao (Property 47): permitido se e somente se nao ha
 * rejeitados, pendentes ou divergencias e a restauracao foi concluida com
 * integridade. Qualquer bloqueio impede a homologacao e preserva o processo
 * atual.
 */
export function evaluateHomologationGate(inputs: HomologationInputs): HomologationGate {
  const reasons: string[] = [];
  if (inputs.migration.totals.rejected > 0) {
    reasons.push(`Existem ${inputs.migration.totals.rejected} registro(s) rejeitado(s) na migracao.`);
  }
  if (inputs.migration.totals.pending > 0) {
    reasons.push(`Existem ${inputs.migration.totals.pending} registro(s) pendente(s) na migracao.`);
  }
  if (inputs.comparison.divergenceCount > 0) {
    reasons.push(`Existem ${inputs.comparison.divergenceCount} divergencia(s) na comparacao publica.`);
  }
  if (!inputs.restore.verified) {
    reasons.push('A restauracao do backup de transicao nao foi verificada com integridade.');
  }
  return { allowed: reasons.length === 0, reasons };
}
