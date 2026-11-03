// Validacao da configuracao operacional e feature gate de transicao.
//
// TypeScript puro, sem I/O. Avalia se a configuracao e valida e se o corte
// (publicacao real e escrita nos arquivos vigentes) pode ser habilitado.
//
// Regra central (requisitos 16.7, 16.8): o corte permanece DESABILITADO por
// padrao. Ele so e permitido quando existe uma configuracao valida E um
// registro de homologacao valido (zero rejeitados, zero pendentes, zero
// divergencias, restauracao verificada e confirmacao registrada). Caso
// contrario, o gate informa em portugues que o fluxo atual continua oficial.

import type { FieldClassification, HomologationRecord, OperationalConfig } from './model';
import { OPERATIONAL_CONFIG_SCHEMA_VERSION } from './model';

/** Mensagem padrao, em portugues, exibida quando o corte esta bloqueado. */
export const CURRENT_FLOW_OFFICIAL_MESSAGE =
  'O fluxo atual continua oficial. A publicacao real e a escrita nos arquivos ' +
  'vigentes permanecem desabilitadas ate o registro de homologacao valido.';

/** Resultado de uma avaliacao que pode acumular varios motivos de bloqueio. */
export interface GateEvaluation {
  /** `true` somente quando nenhuma condicao de bloqueio foi encontrada. */
  readonly allowed: boolean;
  /** Motivos de bloqueio, em portugues. Vazio quando `allowed` e `true`. */
  readonly reasons: readonly string[];
  /**
   * Mensagem em portugues informando que o fluxo atual continua oficial.
   * Presente sempre que `allowed` e `false`.
   */
  readonly currentFlowOfficialMessage?: string;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Valida a estrutura e os invariantes da configuracao operacional.
 *
 * Nao lanca excecoes: retorna a lista de problemas encontrados (em portugues).
 * Uma configuracao e considerada valida quando a lista retornada e vazia.
 */
export function validateOperationalConfig(
  config: OperationalConfig | null | undefined,
): readonly string[] {
  const problems: string[] = [];

  if (config === null || config === undefined) {
    problems.push('Configuracao operacional ausente.');
    return problems;
  }

  if (config.schemaVersion !== OPERATIONAL_CONFIG_SCHEMA_VERSION) {
    problems.push(
      `Versao de schema desconhecida: esperado "${OPERATIONAL_CONFIG_SCHEMA_VERSION}".`,
    );
  }

  // Minimos de SO.
  const os = config.osMinimums;
  if (!os || !isNonEmptyString(os.windowsMinimum)) {
    problems.push('Minimo de Windows nao informado.');
  }
  if (!os || !isNonEmptyString(os.macosMinimum)) {
    problems.push('Minimo de macOS nao informado.');
  }
  if (!os || !Array.isArray(os.windowsArchitectures) || os.windowsArchitectures.length === 0) {
    problems.push('Arquiteturas Windows nao informadas.');
  }
  if (!os || !Array.isArray(os.macosArchitectures) || os.macosArchitectures.length === 0) {
    problems.push('Arquiteturas macOS nao informadas.');
  }

  // Destinos Git/Pages e branches.
  const dest = config.destinations;
  if (!dest) {
    problems.push('Destinos de publicacao nao informados.');
  } else {
    if (!isNonEmptyString(dest.privateManagement?.remoteUrl)) {
      problems.push('URL do repositorio privado de gestao ausente.');
    }
    if (!isNonEmptyString(dest.privateManagement?.branch)) {
      problems.push('Branch do repositorio privado de gestao ausente.');
    }
    if (!isNonEmptyString(dest.publicSite?.remoteUrl)) {
      problems.push('URL do repositorio publico do site ausente.');
    }
    if (!isNonEmptyString(dest.publicSite?.branch)) {
      problems.push('Branch do repositorio publico do site ausente.');
    }
    if (!isNonEmptyString(dest.publicPagesUrl)) {
      problems.push('Endereco publico do GitHub Pages ausente.');
    }
    if (
      isNonEmptyString(dest.privateManagement?.remoteUrl) &&
      isNonEmptyString(dest.publicSite?.remoteUrl) &&
      dest.privateManagement.remoteUrl === dest.publicSite.remoteUrl
    ) {
      // Requisito 10.20: repositorios privado e publico devem ser separados.
      problems.push('Repositorio privado e publico devem ser separados.');
    }
  }

  // Classificacao de campos (requisito 11.1): cada campo em exatamente uma
  // categoria valida.
  const classifications = config.fieldClassifications;
  if (!classifications || typeof classifications !== 'object') {
    problems.push('Classificacao de campos nao informada.');
  } else {
    const entries = Object.entries(classifications);
    if (entries.length === 0) {
      problems.push('Classificacao de campos vazia.');
    }
    const valid: readonly FieldClassification[] = ['public', 'private'];
    for (const [field, cls] of entries) {
      if (!valid.includes(cls)) {
        problems.push(`Campo "${field}" com classificacao invalida: "${String(cls)}".`);
      }
    }
  }

  // Retencao (requisitos 13.9, 13.10).
  const ret = config.retention;
  if (!ret) {
    problems.push('Politica de retencao nao informada.');
  } else {
    if (
      !isFiniteNumber(ret.maxBackups) ||
      ret.maxBackups <= 0 ||
      !Number.isInteger(ret.maxBackups)
    ) {
      problems.push('Limite de quantidade de backups invalido.');
    }
    if (
      !isFiniteNumber(ret.maxAgeMonths) ||
      ret.maxAgeMonths <= 0 ||
      !Number.isInteger(ret.maxAgeMonths)
    ) {
      problems.push('Limite de tempo de retencao invalido.');
    }
    if (ret.preserveOfficialPublications !== true) {
      problems.push('A retencao deve preservar as publicacoes oficiais.');
    }
  }

  // Offline.
  const offline = config.offline;
  if (
    !offline ||
    !Array.isArray(offline.offlineStages) ||
    !Array.isArray(offline.onlineRequiredStages) ||
    offline.onlineRequiredStages.length === 0
  ) {
    problems.push('Capacidades offline nao informadas corretamente.');
  }

  // Formatos (requisito 16.4).
  const formats = config.formats;
  if (
    !formats ||
    !Array.isArray(formats.importFormats) ||
    !Array.isArray(formats.exportFormats) ||
    formats.exportFormats.length === 0
  ) {
    problems.push('Formatos suportados nao informados corretamente.');
  }

  // Perfis autorizados a publicar (requisito 11.12).
  if (
    !Array.isArray(config.authorizedPublishProfiles) ||
    config.authorizedPublishProfiles.length === 0
  ) {
    problems.push('Nenhum perfil autorizado a publicar foi informado.');
  }

  // Custos recorrentes (requisito 16.3): deve existir ao menos a opcao sem
  // custo recorrente obrigatorio (amount 0).
  if (!Array.isArray(config.recurringCosts)) {
    problems.push('Lista de custos recorrentes ausente.');
  } else {
    const hasZeroCostOption = config.recurringCosts.some(
      (cost) => isFiniteNumber(cost.amount) && cost.amount === 0,
    );
    if (!hasZeroCostOption) {
      problems.push(
        'Deve existir uma opcao operacional sem custo recorrente obrigatorio (R$ 0,00).',
      );
    }
    for (const cost of config.recurringCosts) {
      if (cost.amount > 0 && !isNonEmptyString(cost.service)) {
        problems.push('Custo recorrente com valor positivo sem servico identificado.');
      }
    }
  }

  return problems;
}

/** `true` quando a configuracao operacional nao possui problemas. */
export function isConfigValid(config: OperationalConfig | null | undefined): boolean {
  return validateOperationalConfig(config).length === 0;
}

/**
 * Valida um registro de homologacao (requisitos 16.11, 16.12).
 *
 * O registro e valido se e somente se: confirmado, zero rejeitados, zero
 * pendentes, zero divergencias, restauracao verificada e referencias de
 * confirmacao (backup de transicao, responsavel e instante) presentes.
 * Retorna a lista de condicoes nao atendidas (em portugues).
 */
export function validateHomologationRecord(
  record: HomologationRecord | null | undefined,
): readonly string[] {
  const problems: string[] = [];

  if (record === null || record === undefined) {
    problems.push('Registro de homologacao ausente.');
    return problems;
  }

  if (record.confirmed !== true) {
    problems.push('Homologacao nao confirmada pelo Aprovador.');
  }
  if (!isFiniteNumber(record.rejectedCount) || record.rejectedCount !== 0) {
    problems.push('Existem registros de migracao rejeitados.');
  }
  if (!isFiniteNumber(record.pendingCount) || record.pendingCount !== 0) {
    problems.push('Existem registros de migracao pendentes.');
  }
  if (!isFiniteNumber(record.divergenceCount) || record.divergenceCount !== 0) {
    problems.push('Existem divergencias na comparacao publica.');
  }
  if (record.restoreVerified !== true) {
    problems.push('A restauracao do backup de transicao nao foi verificada em teste.');
  }
  if (!isNonEmptyString(record.transitionBackupId)) {
    problems.push('Referencia ao backup de transicao ausente.');
  }
  if (!isNonEmptyString(record.approvedBy)) {
    problems.push('Responsavel pela homologacao ausente.');
  }
  if (!isNonEmptyString(record.approvedAt)) {
    problems.push('Data e hora da homologacao ausentes.');
  }

  return problems;
}

/** `true` quando o registro de homologacao atende a todas as condicoes. */
export function isHomologationValid(record: HomologationRecord | null | undefined): boolean {
  return validateHomologationRecord(record).length === 0;
}

/**
 * Avalia o feature gate de transicao (o "corte").
 *
 * Retorna `allowed: true` somente quando a configuracao operacional e valida E
 * ha um registro de homologacao valido. Em qualquer outro caso retorna
 * `allowed: false`, acumula os motivos em portugues e inclui a mensagem de que
 * o fluxo atual continua oficial (requisitos 16.7, 16.8).
 *
 * Esta funcao e a unica autoridade para decidir se a publicacao real e a
 * escrita nos arquivos vigentes podem ser habilitadas. Por padrao (configuracao
 * ausente ou nao homologada), elas permanecem desabilitadas.
 */
export function evaluateCutoverGate(config: OperationalConfig | null | undefined): GateEvaluation {
  const reasons: string[] = [];

  const configProblems = validateOperationalConfig(config);
  for (const problem of configProblems) {
    reasons.push(problem);
  }

  // So faz sentido avaliar a homologacao quando a configuracao existe.
  const homologation = config?.homologation;
  const homologationProblems = validateHomologationRecord(homologation);
  for (const problem of homologationProblems) {
    reasons.push(problem);
  }

  if (reasons.length === 0) {
    return { allowed: true, reasons: [] };
  }

  return {
    allowed: false,
    reasons,
    currentFlowOfficialMessage: CURRENT_FLOW_OFFICIAL_MESSAGE,
  };
}

/**
 * Conveniencia: `true` somente quando o corte esta autorizado. Use este helper
 * para decidir se a publicacao real e a escrita nos arquivos vigentes podem
 * ocorrer. Por padrao retorna `false`.
 */
export function isRealPublicationEnabled(config: OperationalConfig | null | undefined): boolean {
  return evaluateCutoverGate(config).allowed;
}

/** Alias semantico: escrita nos arquivos vigentes segue o mesmo gate. */
export function isLiveFileWriteEnabled(config: OperationalConfig | null | undefined): boolean {
  return evaluateCutoverGate(config).allowed;
}
