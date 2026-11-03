// Formatos portaveis e importacao de round-trip (tarefa 9.3).
//
// Objetivo (Requisitos 9.9, 9.10, 16.4): exportar o estado da gestao
// (Cadastro_Central, conjuntos de regras, Ciclos_Mensais, Escalas/rascunhos,
// Insumos_Externos, indisponibilidades e Registro_de_Auditoria) em um formato
// DOCUMENTADO e VERSIONADO que possa ser reimportado por outra instalacao
// compativel, reconstruindo todas as entidades, valores e associacoes sem
// acrescimos, perdas ou alteracoes (9.9), e de modo que um ciclo
// exportar -> importar -> exportar sem edicao produza os MESMOS BYTES, salvo
// os metadados de geracao explicitamente declarados como variaveis (9.10).
//
// Este modulo e TypeScript PURO: nao usa `fs`, `crypto` nativo nem Web APIs.
// Nao cria um modelo paralelo. Ele reutiliza:
//   - os modelos canonicos (schemas/models.ts) como fonte unica da forma;
//   - a serializacao canonica e o hash (schemas/canonical.ts);
//   - o validador objetivo e a integridade referencial (schemas/validator.ts).
//
// NUNCA toca nos arquivos legados (`atual.json`, `contatos.json`, etc.). Opera
// apenas sobre valores em memoria, devolvendo o documento, seus bytes e hash.
//
// --------------------------------------------------------------------------
// Formato documentado
// --------------------------------------------------------------------------
//
// Um documento portavel e um objeto JSON com DUAS partes bem separadas:
//
//   {
//     "kind": "gle.portable-export",           // discriminante fixo do formato
//     "formatVersion": "1.0.0",                // versao do FORMATO portavel
//     "metadata": {                            // metadados VARIAVEIS de geracao
//       "generatedAt": "2026-01-15T12:00:00Z", //   (ver abaixo)
//       "exporterVersion": "1.0.0"
//     },
//     "payload": { ...entidades por categoria... }  // conteudo ESTAVEL
//   }
//
// Metadados de geracao declarados como VARIAVEIS (Requisitos 9.8, 9.9, 9.10):
//   - `metadata.generatedAt`  (instante da exportacao)
//   - `metadata.exporterVersion` (versao da ferramenta exportadora)
// Estes campos NAO participam da comparacao de round-trip. Todo o resto
// (`kind`, `formatVersion`, `payload`) e ESTAVEL e deve reproduzir os mesmos
// bytes em exportacoes repetidas sem edicao.
//
// O `payload` agrupa as entidades por categoria documentada. Cada categoria e
// um array de entidades canonicas conforme `schemas/models.ts`:
//
//   payload.registry.people[]                (Person)
//   payload.registry.departments[]           (Department)
//   payload.registry.publicAuthorizations[]  (PublicAuthorization)
//   payload.rules.ruleSets[]                 (ApprovedRuleSet)
//   payload.rules.exceptions[]               (ApprovedException)
//   payload.cycles.cycles[]                  (MonthlyCycle)
//   payload.cycles.services[]                (Service)
//   payload.schedules.drafts[]               (ScheduleDraft)
//   payload.inputs.externalInputs[]          (ExternalInput)
//   payload.inputs.unavailabilities[]        (Unavailability)
//   payload.audit.auditEvents[]              (AuditEvent)

import {
  canonicalBytes,
  canonicalStringify,
  sha256Hex,
  type CanonicalBytes,
} from '../schemas/canonical';
import { validateEntity, validateEntitySet, type ValidationIssue } from '../schemas/validator';

/** Discriminante fixo do formato portavel. */
export const PORTABLE_KIND = 'gle.portable-export' as const;

/** Versao suportada do FORMATO portavel (distinta da versao de schema). */
export const PORTABLE_FORMAT_VERSION = '1.0.0' as const;

/**
 * Chaves de `metadata` declaradas como metadados de geracao VARIAVEIS. Nao
 * participam da comparacao de round-trip (Requisitos 9.8-9.10).
 */
export const VARIABLE_METADATA_KEYS = ['generatedAt', 'exporterVersion'] as const;

// --------------------------------------------------------------------------
// Tipos do documento portavel
// --------------------------------------------------------------------------

/** Metadados de geracao variaveis (nao afetam o round-trip de bytes). */
export interface PortableMetadata {
  /** Instante da exportacao (RFC 3339 UTC). Variavel. */
  readonly generatedAt: string;
  /** Versao da ferramenta exportadora. Variavel. */
  readonly exporterVersion: string;
}

/** Conteudo estavel do documento, agrupado por categoria documentada. */
export interface PortablePayload {
  readonly registry: {
    readonly people: readonly unknown[];
    readonly departments: readonly unknown[];
    readonly publicAuthorizations: readonly unknown[];
  };
  readonly rules: {
    readonly ruleSets: readonly unknown[];
    readonly exceptions: readonly unknown[];
  };
  readonly cycles: {
    readonly cycles: readonly unknown[];
    readonly services: readonly unknown[];
  };
  readonly schedules: {
    readonly drafts: readonly unknown[];
  };
  readonly inputs: {
    readonly externalInputs: readonly unknown[];
    readonly unavailabilities: readonly unknown[];
  };
  readonly audit: {
    readonly auditEvents: readonly unknown[];
  };
}

/** Documento portavel completo. */
export interface PortableDocument {
  readonly kind: typeof PORTABLE_KIND;
  readonly formatVersion: string;
  readonly metadata: PortableMetadata;
  readonly payload: PortablePayload;
}

/**
 * Conjunto de entidades a exportar. Espelha e amplia a `EntitySet` do
 * validador, adicionando a categoria de auditoria. Todos os campos sao
 * opcionais; ausentes viram arrays vazios no documento.
 */
export interface PortableEntities {
  readonly people?: readonly unknown[];
  readonly departments?: readonly unknown[];
  readonly publicAuthorizations?: readonly unknown[];
  readonly ruleSets?: readonly unknown[];
  readonly exceptions?: readonly unknown[];
  readonly cycles?: readonly unknown[];
  readonly services?: readonly unknown[];
  readonly drafts?: readonly unknown[];
  readonly externalInputs?: readonly unknown[];
  readonly unavailabilities?: readonly unknown[];
  readonly auditEvents?: readonly unknown[];
}

/** Opcoes de exportacao. */
export interface PortableExportOptions {
  /** Instante de geracao (metadado variavel). Default: epoch estavel. */
  readonly generatedAt?: string;
  /** Versao da ferramenta exportadora (metadado variavel). */
  readonly exporterVersion?: string;
}

/** Artefato portavel emitido: documento + bytes + hash. */
export interface PortableArtifact {
  /** Documento portavel completo (inclui metadados variaveis). */
  readonly document: PortableDocument;
  /** Bytes canonicos do documento COMPLETO (inclui metadados variaveis). */
  readonly bytes: CanonicalBytes;
  /** SHA-256 hex dos bytes do documento completo. */
  readonly sha256: string;
  /**
   * Bytes canonicos SOMENTE do conteudo estavel (`kind`, `formatVersion`,
   * `payload`), EXCLUINDO os metadados variaveis. Esta e a projecao usada na
   * comparacao de round-trip (Requisito 9.10): e invariante a exportacoes
   * repetidas sem edicao, independentemente do instante de geracao.
   */
  readonly stableBytes: CanonicalBytes;
  /** SHA-256 hex dos bytes estaveis. */
  readonly stableSha256: string;
}

// --------------------------------------------------------------------------
// Exportacao
// --------------------------------------------------------------------------

const EPOCH = '1970-01-01T00:00:00Z';

/**
 * Exporta um conjunto de entidades para o formato portavel documentado.
 *
 * Puro e deterministico: para o mesmo conjunto de entidades e os mesmos
 * metadados, produz exatamente os mesmos bytes. A ORDEM dos arrays de cada
 * categoria e preservada (e semantica por padrao, conforme canonical.ts); o
 * chamador e responsavel por ordenar quando desejar.
 */
export function exportPortable(
  entities: PortableEntities,
  options: PortableExportOptions = {},
): PortableArtifact {
  const document: PortableDocument = {
    kind: PORTABLE_KIND,
    formatVersion: PORTABLE_FORMAT_VERSION,
    metadata: {
      generatedAt: options.generatedAt ?? EPOCH,
      exporterVersion: options.exporterVersion ?? PORTABLE_FORMAT_VERSION,
    },
    payload: buildPayload(entities),
  };

  const bytes = canonicalBytes(document);
  const stable = stableProjection(document);
  const stableBytes = canonicalBytes(stable);

  return {
    document,
    bytes,
    sha256: sha256Hex(bytes),
    stableBytes,
    stableSha256: sha256Hex(stableBytes),
  };
}

function buildPayload(e: PortableEntities): PortablePayload {
  return {
    registry: {
      people: [...(e.people ?? [])],
      departments: [...(e.departments ?? [])],
      publicAuthorizations: [...(e.publicAuthorizations ?? [])],
    },
    rules: {
      ruleSets: [...(e.ruleSets ?? [])],
      exceptions: [...(e.exceptions ?? [])],
    },
    cycles: {
      cycles: [...(e.cycles ?? [])],
      services: [...(e.services ?? [])],
    },
    schedules: {
      drafts: [...(e.drafts ?? [])],
    },
    inputs: {
      externalInputs: [...(e.externalInputs ?? [])],
      unavailabilities: [...(e.unavailabilities ?? [])],
    },
    audit: {
      auditEvents: [...(e.auditEvents ?? [])],
    },
  };
}

/**
 * Projecao estavel: o documento SEM os metadados variaveis. Usada na
 * comparacao de round-trip. Inclui `kind`, `formatVersion` e `payload`.
 */
function stableProjection(document: PortableDocument): Omit<PortableDocument, 'metadata'> {
  return {
    kind: document.kind,
    formatVersion: document.formatVersion,
    payload: document.payload,
  };
}

/**
 * Serializa um documento portavel em texto canonico (UTF-8, LF, chaves
 * ordenadas). NAO grava em disco; apenas devolve a string.
 */
export function portableStringify(document: PortableDocument): string {
  return canonicalStringify(document);
}

// --------------------------------------------------------------------------
// Importacao
// --------------------------------------------------------------------------

/** Resultado da importacao: entidades reconstruidas OU erros de validacao. */
export type PortableImportResult =
  | {
      readonly ok: true;
      /** Entidades reconstruidas, exatamente como no payload exportado. */
      readonly entities: Required<PortableEntities>;
      /** Metadados de geracao lidos (variaveis). */
      readonly metadata: PortableMetadata;
    }
  | {
      readonly ok: false;
      /** Erros estruturais/semanticos. A importacao e tudo-ou-nada. */
      readonly issues: readonly PortableImportIssue[];
    };

/** Erro de importacao, com caminho e motivo (Requisito 9.7). */
export interface PortableImportIssue {
  /** Caminho JSON ate o problema (ex.: `/payload/registry/people/0/id`). */
  readonly path: string;
  /** Motivo legivel em portugues. */
  readonly message: string;
  /** Classe do problema. */
  readonly kind: PortableImportIssueKind;
}

export type PortableImportIssueKind =
  | 'not-an-object'
  | 'unknown-kind'
  | 'unknown-format-version'
  | 'missing-metadata'
  | 'malformed-payload'
  | ValidationIssue['kind'];

/**
 * Importa um documento portavel. Valida o envelope (kind/formatVersion/
 * metadata/payload), cada entidade contra seu JSON Schema e a integridade
 * referencial do conjunto. A importacao e TUDO-OU-NADA (Requisitos 9.5, 9.6):
 * qualquer erro preserva o estado do chamador (este modulo e puro e nao muta
 * nada) e relata todos os erros encontrados sem reconstruir entidades.
 *
 * O parametro aceita `unknown` para cobrir entrada arbitraria (ex.: JSON
 * recem-parseado de um arquivo).
 */
export function importPortable(input: unknown): PortableImportResult {
  const envelope = validateEnvelope(input);
  if (!envelope.ok) {
    return { ok: false, issues: envelope.issues };
  }
  const { payload, metadata } = envelope;

  const entities: Required<PortableEntities> = {
    people: payload.registry.people,
    departments: payload.registry.departments,
    publicAuthorizations: payload.registry.publicAuthorizations,
    ruleSets: payload.rules.ruleSets,
    exceptions: payload.rules.exceptions,
    cycles: payload.cycles.cycles,
    services: payload.cycles.services,
    drafts: payload.schedules.drafts,
    externalInputs: payload.inputs.externalInputs,
    unavailabilities: payload.inputs.unavailabilities,
    auditEvents: payload.audit.auditEvents,
  };

  const issues: PortableImportIssue[] = [];

  // Validacao de schema + integridade referencial das categorias cobertas pela
  // EntitySet do validador (todas, exceto auditoria, que e validada a parte).
  const setOutcome = validateEntitySet({
    people: mutable(entities.people),
    departments: mutable(entities.departments),
    publicAuthorizations: mutable(entities.publicAuthorizations),
    cycles: mutable(entities.cycles),
    services: mutable(entities.services),
    externalInputs: mutable(entities.externalInputs),
    unavailabilities: mutable(entities.unavailabilities),
    ruleSets: mutable(entities.ruleSets),
    exceptions: mutable(entities.exceptions),
    drafts: mutable(entities.drafts),
  });
  for (const issue of setOutcome.issues) {
    issues.push({ path: `/payload${mapSetPath(issue.path)}`, message: issue.message, kind: issue.kind });
  }

  // Auditoria: validada entidade a entidade (nao faz parte da EntitySet).
  entities.auditEvents.forEach((event, i) => {
    const r = validateEntity('auditEvent', event);
    for (const issue of r.issues) {
      issues.push({
        path: `/payload/audit/auditEvents/${i}${issue.path === '/' ? '' : issue.path}`,
        message: issue.message,
        kind: issue.kind,
      });
    }
  });

  if (issues.length > 0) {
    issues.sort(compareIssue);
    return { ok: false, issues };
  }

  return { ok: true, entities, metadata };
}

// --------------------------------------------------------------------------
// Round-trip
// --------------------------------------------------------------------------

/** Resultado objetivo de uma verificacao de round-trip. */
export interface RoundTripOutcome {
  /** Verdadeiro quando entidades e bytes estaveis foram preservados. */
  readonly preserved: boolean;
  /**
   * Verdadeiro quando os bytes estaveis da segunda exportacao sao identicos
   * aos da primeira (Requisito 9.10). Metadados variaveis sao ignorados.
   */
  readonly stableBytesEqual: boolean;
  /** Verdadeiro quando a reimportacao foi bem-sucedida (Requisito 9.9). */
  readonly reimportOk: boolean;
  /** Erros, quando a reimportacao falhou. */
  readonly issues: readonly PortableImportIssue[];
}

/**
 * Executa o ciclo documentado exportar -> importar -> exportar SEM edicao e
 * verifica que:
 *   (a) a reimportacao reconstroi o documento (9.9);
 *   (b) a segunda exportacao reproduz os mesmos bytes ESTAVEIS da primeira,
 *       ignorando os metadados variaveis (9.10).
 *
 * Observe que `generatedAt`/`exporterVersion` podem diferir entre as duas
 * exportacoes (sao variaveis) e, ainda assim, `stableBytesEqual` deve ser
 * verdadeiro. E por isso que o round-trip compara `stableBytes`, nunca os bytes
 * do documento completo.
 */
export function roundTrip(
  entities: PortableEntities,
  options: PortableExportOptions = {},
): RoundTripOutcome {
  const first = exportPortable(entities, options);
  const imported = importPortable(first.document);

  if (!imported.ok) {
    return {
      preserved: false,
      stableBytesEqual: false,
      reimportOk: false,
      issues: imported.issues,
    };
  }

  // Segunda exportacao SEM edicao. Trocamos deliberadamente os metadados
  // variaveis para provar que eles nao afetam os bytes estaveis.
  const second = exportPortable(imported.entities, {
    generatedAt: '2099-12-31T23:59:59Z',
    exporterVersion: `${options.exporterVersion ?? PORTABLE_FORMAT_VERSION}-rt`,
  });

  const stableBytesEqual = bytesEqual(first.stableBytes, second.stableBytes);

  return {
    preserved: stableBytesEqual,
    stableBytesEqual,
    reimportOk: true,
    issues: [],
  };
}

// --------------------------------------------------------------------------
// Validacao de envelope
// --------------------------------------------------------------------------

type EnvelopeOutcome =
  | { ok: true; payload: PortablePayload; metadata: PortableMetadata }
  | { ok: false; issues: PortableImportIssue[] };

function validateEnvelope(input: unknown): EnvelopeOutcome {
  const issues: PortableImportIssue[] = [];

  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return {
      ok: false,
      issues: [{ path: '/', kind: 'not-an-object', message: 'o documento portavel deve ser um objeto JSON' }],
    };
  }
  const obj = input as Record<string, unknown>;

  if (obj.kind !== PORTABLE_KIND) {
    issues.push({
      path: '/kind',
      kind: 'unknown-kind',
      message: `kind desconhecido; esperado "${PORTABLE_KIND}"`,
    });
  }
  if (obj.formatVersion !== PORTABLE_FORMAT_VERSION) {
    issues.push({
      path: '/formatVersion',
      kind: 'unknown-format-version',
      message: `formatVersion desconhecida; esperado "${PORTABLE_FORMAT_VERSION}"`,
    });
  }

  const metadata = validateMetadata(obj.metadata, issues);
  const payload = validatePayloadShape(obj.payload, issues);

  if (issues.length > 0 || payload === null || metadata === null) {
    // Mesmo que payload/metadata tenham sido parcialmente lidos, qualquer
    // problema de envelope aborta (tudo-ou-nada).
    if (payload === null && !issues.some((i) => i.path.startsWith('/payload'))) {
      issues.push({ path: '/payload', kind: 'malformed-payload', message: 'payload ausente ou malformado' });
    }
    return { ok: false, issues };
  }

  return { ok: true, payload, metadata };
}

function validateMetadata(
  value: unknown,
  issues: PortableImportIssue[],
): PortableMetadata | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    issues.push({ path: '/metadata', kind: 'missing-metadata', message: 'metadata ausente ou malformado' });
    return null;
  }
  const m = value as Record<string, unknown>;
  const generatedAt = typeof m.generatedAt === 'string' ? m.generatedAt : '';
  const exporterVersion = typeof m.exporterVersion === 'string' ? m.exporterVersion : '';
  if (generatedAt === '') {
    issues.push({
      path: '/metadata/generatedAt',
      kind: 'missing-metadata',
      message: 'metadata.generatedAt ausente',
    });
  }
  if (exporterVersion === '') {
    issues.push({
      path: '/metadata/exporterVersion',
      kind: 'missing-metadata',
      message: 'metadata.exporterVersion ausente',
    });
  }
  if (generatedAt === '' || exporterVersion === '') return null;
  return { generatedAt, exporterVersion };
}

function validatePayloadShape(
  value: unknown,
  issues: PortableImportIssue[],
): PortablePayload | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    issues.push({ path: '/payload', kind: 'malformed-payload', message: 'payload ausente ou malformado' });
    return null;
  }
  const p = value as Record<string, unknown>;

  const arrAt = (groupKey: string, listKey: string): unknown[] | null => {
    const group = p[groupKey];
    if (typeof group !== 'object' || group === null || Array.isArray(group)) {
      issues.push({
        path: `/payload/${groupKey}`,
        kind: 'malformed-payload',
        message: `payload.${groupKey} ausente ou malformado`,
      });
      return null;
    }
    const list = (group as Record<string, unknown>)[listKey];
    if (!Array.isArray(list)) {
      issues.push({
        path: `/payload/${groupKey}/${listKey}`,
        kind: 'malformed-payload',
        message: `payload.${groupKey}.${listKey} deve ser um array`,
      });
      return null;
    }
    return list;
  };

  const people = arrAt('registry', 'people');
  const departments = arrAt('registry', 'departments');
  const publicAuthorizations = arrAt('registry', 'publicAuthorizations');
  const ruleSets = arrAt('rules', 'ruleSets');
  const exceptions = arrAt('rules', 'exceptions');
  const cycles = arrAt('cycles', 'cycles');
  const services = arrAt('cycles', 'services');
  const drafts = arrAt('schedules', 'drafts');
  const externalInputs = arrAt('inputs', 'externalInputs');
  const unavailabilities = arrAt('inputs', 'unavailabilities');
  const auditEvents = arrAt('audit', 'auditEvents');

  if (
    people === null ||
    departments === null ||
    publicAuthorizations === null ||
    ruleSets === null ||
    exceptions === null ||
    cycles === null ||
    services === null ||
    drafts === null ||
    externalInputs === null ||
    unavailabilities === null ||
    auditEvents === null
  ) {
    return null;
  }

  return {
    registry: { people, departments, publicAuthorizations },
    rules: { ruleSets, exceptions },
    cycles: { cycles, services },
    schedules: { drafts },
    inputs: { externalInputs, unavailabilities },
    audit: { auditEvents },
  };
}

// --------------------------------------------------------------------------
// Auxiliares
// --------------------------------------------------------------------------

function mutable(items: readonly unknown[]): unknown[] {
  return [...items];
}

/**
 * Mapeia o caminho relativo da EntitySet do validador (ex.: `/people/0/id`)
 * para o caminho dentro do payload portavel (ex.: `/registry/people/0/id`).
 */
function mapSetPath(path: string): string {
  const groupOf: Record<string, string> = {
    people: 'registry',
    departments: 'registry',
    publicAuthorizations: 'registry',
    ruleSets: 'rules',
    exceptions: 'rules',
    cycles: 'cycles',
    services: 'cycles',
    drafts: 'schedules',
    externalInputs: 'inputs',
    unavailabilities: 'inputs',
  };
  const m = /^\/([a-zA-Z]+)(\/.*|$)/.exec(path);
  if (!m) return path;
  const category = m[1] as string;
  const rest = m[2] ?? '';
  const group = groupOf[category];
  if (!group) return path;
  return `/${group}/${category}${rest}`;
}

function bytesEqual(a: CanonicalBytes, b: CanonicalBytes): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function compareIssue(a: PortableImportIssue, b: PortableImportIssue): number {
  if (a.path !== b.path) return a.path < b.path ? -1 : 1;
  if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
  return a.message < b.message ? -1 : a.message > b.message ? 1 : 0;
}
