// LegacyExporter: converte a projecao publica (PublicProjectionDTO) nos
// artefatos legados EXATOS consumidos pelo Visualizador_Atual: `atual.json` e
// `contatos.json` (tarefa 9.2).
//
// Esta e uma funcao PURA e deterministica, sem I/O e sem estado global. Ela NAO
// cria um modelo paralelo: parte do DTO produzido pela PublicProjection
// (projection/publicProjection.ts) e reusa a serializacao canonica
// (schemas/canonical.ts) para produzir bytes estaveis. O exportador NUNCA
// escreve nos arquivos reais do repositorio — ele apenas devolve os valores em
// memoria (objeto + bytes canonicos + hash).
//
// Contrato legado (design.md, "Contratos legados publicos"; requisitos 9.1-9.3,
// 9.8-9.10, 10.7, 10.16, 16.1, 16.2):
//
//   atual.json
//     - Array ordenado cronologicamente (por DATA).
//     - Todo registro tem EXATAMENTE as 14 chaves conhecidas pelo visualizador,
//       mesmo quando o valor e vazio (string vazia).
//     - `DATA` em `DD/MM/YYYY`.
//     - `DIA SEMANA` usa a forma legada configurada (ex.: "quarta-feira").
//     - Listas de pessoas sao unidas por `, ` e musicas por ` | `.
//     - Nomes com delimitador ambiguo (contendo `, ` ou ` | `) sao REJEITADOS
//       ate o operador corrigir — nunca produzem ambiguidade silenciosa.
//
//   contatos.json
//     - Objeto indexado pelo nome canonico publico.
//     - Cada entrada: `{ telefone: "https://wa.me/<digitos>", apelidos: [] }`.
//     - `telefone` deriva do E.164 removendo o `+` (8-15 digitos).
//     - So entra pessoa ATIVA com telefone autorizado vigente (ja garantido
//       pela PublicProjection, que bloqueia telefone nao autorizado). Pessoa
//       sem telefone nao entra em `contatos.json` (comportamento do visualizador).
//     - Alias privado nunca e emitido (ja filtrado pela PublicProjection).
//
// Requisitos cobertos: 9.1, 9.2, 9.3, 9.8, 9.9, 9.10, 10.7, 10.16, 16.1, 16.2.

import type { IsoDate, Uuid, Weekday } from '../schemas/models';
import type {
  PublicAssignment,
  PublicContactDTO,
  PublicProjectionDTO,
  PublicServiceDTO,
} from '../projection/publicProjection';
import { canonicalBytes, canonicalStringify, sha256Hex } from '../schemas/canonical';

// --------------------------------------------------------------------------
// Contrato legado: chaves e delimitadores
// --------------------------------------------------------------------------

/**
 * As 14 chaves exigidas pelo Visualizador_Atual em cada registro de
 * `atual.json`, na ordem canonica em que o visualizador as conhece.
 */
export const ATUAL_KEYS = [
  'DATA',
  'DIA SEMANA',
  'ACOMP',
  'REGENTE LOUVOR',
  'EQUIPE LOUVOR',
  'MENSAGEM MUSICAL',
  'LOUVORES ES',
  'LOUVORES CULTO',
  'TEMA CULTO',
  'AUDIOVISUAL',
  'ANCIÃO',
  'PREGADOR',
  'SUPORTE',
  'OBS',
] as const;

export type AtualKey = (typeof ATUAL_KEYS)[number];

/** Registro legado de `atual.json`: exatamente as 14 chaves, todas string. */
export type LegacyScheduleRecord = Record<AtualKey, string>;

/** Entrada legada de `contatos.json`. */
export interface LegacyContactEntry {
  readonly telefone: string;
  readonly apelidos: readonly string[];
}

/** Objeto legado de `contatos.json`, indexado pelo nome canonico publico. */
export type LegacyContacts = Record<string, LegacyContactEntry>;

/** Delimitador de lista de pessoas (nunca deve aparecer dentro de um nome). */
export const LIST_DELIMITER = ', ';
/** Delimitador de lista de musicas (nunca deve aparecer dentro de um valor). */
export const SONG_DELIMITER = ' | ';

/** Forma legada padrao de `DIA SEMANA` em portugues (pt-BR), por weekday. */
export const DEFAULT_WEEKDAY_LABELS: Readonly<Record<Weekday, string>> = {
  monday: 'segunda-feira',
  tuesday: 'terça-feira',
  wednesday: 'quarta-feira',
  thursday: 'quinta-feira',
  friday: 'sexta-feira',
  saturday: 'sábado',
  sunday: 'domingo',
};

// --------------------------------------------------------------------------
// Mapeamento de colunas (DTO abstrato -> colunas legadas)
// --------------------------------------------------------------------------

/**
 * O `PublicProjectionDTO` e abstrato: atribuicoes referenciam `roleId` (UUID) e
 * os campos publicos do culto sao um mapa aberto. Para produzir as colunas
 * legadas sem introduzir um modelo paralelo, o exportador recebe um mapeamento
 * explicito e versionado do contrato de compatibilidade:
 *
 *   - `roleColumns`: de `roleId` para a coluna legada de atribuicao
 *     (ex.: ANCIÃO, PREGADOR, REGENTE LOUVOR, EQUIPE LOUVOR, AUDIOVISUAL,
 *      MENSAGEM MUSICAL, SUPORTE, ACOMP).
 *   - `fieldColumns`: de uma chave de `publicFields`/insumo para a coluna legada
 *     (ex.: TEMA CULTO, LOUVORES ES, LOUVORES CULTO, OBS).
 *   - `listColumns`: colunas que agregam varias pessoas por `, `.
 *   - `songColumns`: colunas cujos valores de lista usam ` | `.
 *
 * Qualquer coluna sem mapeamento e emitida como string vazia (o visualizador
 * exige a presenca da chave, nao um valor).
 */
export interface LegacyColumnMapping {
  /** `roleId` -> coluna legada de atribuicao. */
  readonly roleColumns: Readonly<Record<Uuid, AtualKey>>;
  /** chave de campo publico/insumo -> coluna legada textual. */
  readonly fieldColumns?: Readonly<Record<string, AtualKey>>;
  /** Colunas que agregam listas de pessoas (join por `, `). */
  readonly listColumns?: ReadonlySet<AtualKey> | readonly AtualKey[];
  /** Colunas cujos valores sao listas de musicas (join por ` | `). */
  readonly songColumns?: ReadonlySet<AtualKey> | readonly AtualKey[];
}

/** Configuracao completa de exportacao legada. */
export interface LegacyExportConfig {
  readonly columns: LegacyColumnMapping;
  /** Rotulos de `DIA SEMANA`; se ausente usa `DEFAULT_WEEKDAY_LABELS`. */
  readonly weekdayLabels?: Readonly<Record<Weekday, string>>;
}

// --------------------------------------------------------------------------
// Resultado e bloqueios
// --------------------------------------------------------------------------

/**
 * Bloqueio de exportacao legada. NUNCA repete conteudo privado; identifica a
 * referencia (culto/coluna/sujeito) e descreve a correcao exigida.
 */
export interface LegacyExportBlock {
  readonly code:
    | 'ambiguous-delimiter' // 9.1/16.2: nome contem delimitador de lista
    | 'invalid-phone' // 9.2: telefone nao e E.164 valido
    | 'duplicate-contact-name' // 9.2: dois sujeitos com o mesmo nome canonico
    | 'invalid-date'; // 9.1: data fora de `YYYY-MM-DD`
  readonly reference: string;
  readonly message: string;
}

/** Artefato legado emitivel (objeto + bytes canonicos + hash). */
export interface LegacyArtifact<T> {
  readonly value: T;
  readonly bytes: Uint8Array;
  readonly sha256: string;
}

/** Resultado da exportacao: artefatos emitiveis OU bloqueios. */
export type LegacyExportResult =
  | {
      readonly ok: true;
      readonly atual: LegacyArtifact<readonly LegacyScheduleRecord[]>;
      readonly contatos: LegacyArtifact<LegacyContacts>;
    }
  | { readonly ok: false; readonly blocks: readonly LegacyExportBlock[] };

// --------------------------------------------------------------------------
// Exportacao
// --------------------------------------------------------------------------

/**
 * Converte a projecao publica nos artefatos legados `atual.json` e
 * `contatos.json`. Retorna os artefatos emitiveis OU a lista de bloqueios.
 * Puro e deterministico: a ordem de `atual.json` e cronologica (por DATA) e as
 * chaves de `contatos.json` sao ordenadas lexicograficamente na serializacao
 * canonica.
 */
export function exportLegacy(
  dto: PublicProjectionDTO,
  config: LegacyExportConfig,
): LegacyExportResult {
  const blocks: LegacyExportBlock[] = [];
  const weekdayLabels = config.weekdayLabels ?? DEFAULT_WEEKDAY_LABELS;
  const listColumns = toSet(config.columns.listColumns);
  const songColumns = toSet(config.columns.songColumns);
  const fieldColumns = config.columns.fieldColumns ?? {};

  // --- atual.json ------------------------------------------------------
  const records: LegacyScheduleRecord[] = dto.services.map((service) =>
    buildRecord(service, config, weekdayLabels, listColumns, songColumns, fieldColumns, blocks),
  );
  // Ordenacao cronologica estavel pela data ISO original do culto (antes do
  // formato DD/MM/YYYY), com desempate pelo serviceId para total determinismo.
  const sortable = dto.services.map((s, i) => ({ date: s.date, id: s.serviceId, rec: records[i]! }));
  sortable.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1));
  const atualValue: LegacyScheduleRecord[] = sortable.map((s) => s.rec);

  // --- contatos.json ---------------------------------------------------
  const contatosValue = buildContacts(dto.contacts, blocks);

  if (blocks.length > 0) {
    blocks.sort(compareBlock);
    return { ok: false, blocks };
  }

  return {
    ok: true,
    atual: artifactOf(atualValue),
    contatos: artifactOf(contatosValue),
  };
}

// --------------------------------------------------------------------------
// atual.json: um registro por culto
// --------------------------------------------------------------------------

function buildRecord(
  service: PublicServiceDTO,
  config: LegacyExportConfig,
  weekdayLabels: Readonly<Record<Weekday, string>>,
  listColumns: ReadonlySet<AtualKey>,
  songColumns: ReadonlySet<AtualKey>,
  fieldColumns: Readonly<Record<string, AtualKey>>,
  blocks: LegacyExportBlock[],
): LegacyScheduleRecord {
  // Inicia todas as 14 colunas como string vazia (o visualizador exige a chave).
  const rec = emptyRecord();

  // DATA e DIA SEMANA.
  rec['DATA'] = formatLegacyDate(service.date, service.serviceId, blocks);
  rec['DIA SEMANA'] = weekdayLabels[service.weekday] ?? '';

  // Agrupa nomes por coluna de atribuicao, preservando a ordem recebida.
  const byColumn = new Map<AtualKey, string[]>();
  for (const assignment of service.assignments) {
    const column = config.columns.roleColumns[assignment.roleId];
    if (!column) continue; // funcao sem coluna legada e ignorada (allowlist)
    const name = assignmentName(assignment);
    if (name === undefined) continue; // nome negado por autorizacao: omite
    assertNoAmbiguousDelimiter(name, service.serviceId, column, songColumns, blocks);
    const list = byColumn.get(column) ?? [];
    list.push(name);
    byColumn.set(column, list);
  }
  for (const [column, names] of byColumn) {
    rec[column] = joinColumn(names, column, listColumns, songColumns);
  }

  // Campos publicos textuais do culto (TEMA CULTO, OBS, LOUVORES ...).
  for (const [key, raw] of Object.entries(service.publicFields)) {
    const column = fieldColumns[key];
    if (!column) continue;
    rec[column] = applyFieldValue(rec[column], raw, column, songColumns, service.serviceId, blocks);
  }

  // Insumos externos publicos (tema, pedidos de musica, observacoes publicas).
  for (const input of service.publicInputs) {
    const column = fieldColumns[input.type];
    if (!column) continue;
    rec[column] = applyFieldValue(
      rec[column],
      input.value,
      column,
      songColumns,
      service.serviceId,
      blocks,
    );
  }

  return rec;
}

/** Resolve o nome publico de uma atribuicao (ou `undefined` se negado). */
function assignmentName(assignment: PublicAssignment): string | undefined {
  return assignment.name;
}

/**
 * Converte o valor de um campo publico (string ou lista de strings) na forma
 * textual legada, respeitando o delimitador da coluna. Se ja houver conteudo na
 * coluna (ex.: tema definido por publicFields e por insumo), o valor adicional
 * e concatenado pelo delimitador da coluna.
 */
function applyFieldValue(
  current: string,
  raw: unknown,
  column: AtualKey,
  songColumns: ReadonlySet<AtualKey>,
  serviceId: Uuid,
  blocks: LegacyExportBlock[],
): string {
  const parts = normalizeFieldValue(raw);
  for (const p of parts) assertNoAmbiguousDelimiter(p, serviceId, column, songColumns, blocks);
  const delimiter = songColumns.has(column) ? SONG_DELIMITER : LIST_DELIMITER;
  const addition = parts.join(delimiter);
  if (current === '') return addition;
  if (addition === '') return current;
  return `${current}${delimiter}${addition}`;
}

/** Normaliza o valor de um campo publico em uma lista de strings. */
function normalizeFieldValue(raw: unknown): string[] {
  if (raw === undefined || raw === null) return [];
  if (Array.isArray(raw)) {
    return raw.filter((v) => v !== undefined && v !== null).map((v) => String(v));
  }
  const s = String(raw);
  return s === '' ? [] : [s];
}

/** Une uma lista de nomes/valores pelo delimitador adequado da coluna. */
function joinColumn(
  values: readonly string[],
  column: AtualKey,
  listColumns: ReadonlySet<AtualKey>,
  songColumns: ReadonlySet<AtualKey>,
): string {
  if (values.length === 0) return '';
  const delimiter = songColumns.has(column)
    ? SONG_DELIMITER
    : listColumns.has(column)
      ? LIST_DELIMITER
      : values.length > 1
        ? LIST_DELIMITER
        : '';
  return values.join(delimiter);
}

/** Registro legado com as 14 chaves presentes e vazias. */
function emptyRecord(): LegacyScheduleRecord {
  const rec = {} as Record<AtualKey, string>;
  for (const key of ATUAL_KEYS) rec[key] = '';
  return rec;
}

/**
 * Formata uma data ISO `YYYY-MM-DD` como `DD/MM/YYYY`. Datas fora do formato
 * geram bloqueio (nunca produzem saida ambigua).
 */
function formatLegacyDate(date: IsoDate, serviceId: Uuid, blocks: LegacyExportBlock[]): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) {
    blocks.push({
      code: 'invalid-date',
      reference: `culto:${serviceId}`,
      message: 'a data do culto nao esta no formato ISO YYYY-MM-DD exigido para a conversao',
    });
    return '';
  }
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/**
 * Rejeita um valor que contenha o delimitador reservado DA COLUNA, pois isso
 * tornaria a agregacao ambigua ao ser lida pelo visualizador (9.1/16.2). A
 * verificacao e especifica por tipo de coluna: colunas de musica usam ` | ` e
 * um valor pode legitimamente conter `, ` (ex.: "128 - Cristo, minha seguranca");
 * colunas de pessoas usam `, ` e rejeitam nomes que contenham a virgula-espaco.
 * O caractere `|` cru nunca e permitido, pois colide com o delimitador de
 * musicas usado por outras colunas do mesmo artefato.
 */
function assertNoAmbiguousDelimiter(
  value: string,
  serviceId: Uuid,
  column: AtualKey,
  songColumns: ReadonlySet<AtualKey>,
  blocks: LegacyExportBlock[],
): void {
  const isSongColumn = songColumns.has(column);
  const violatesColumnDelimiter = isSongColumn
    ? value.includes(SONG_DELIMITER)
    : value.includes(LIST_DELIMITER);
  // O caractere `|` cru e sempre reservado (delimitador de musicas do artefato).
  const violatesPipe = !isSongColumn && value.includes('|');
  if (violatesColumnDelimiter || violatesPipe) {
    blocks.push({
      code: 'ambiguous-delimiter',
      reference: `culto:${serviceId} coluna:${column}`,
      message:
        'um nome ou valor contem um delimitador de lista reservado para a coluna, o que ' +
        'tornaria a lista ambigua no visualizador; corrija o valor antes de exportar',
    });
  }
}

// --------------------------------------------------------------------------
// contatos.json: objeto indexado por nome canonico
// --------------------------------------------------------------------------

function buildContacts(
  contacts: readonly PublicContactDTO[],
  blocks: LegacyExportBlock[],
): LegacyContacts {
  const out: LegacyContacts = {};
  for (const contact of contacts) {
    // Pessoa sem telefone autorizado nao entra em contatos.json (comportamento
    // do visualizador); a PublicProjection ja omite telefone nao autorizado.
    if (contact.phoneE164 === undefined) continue;

    const telefone = waMeFromE164(contact.phoneE164, contact.subjectId, blocks);
    if (telefone === undefined) continue; // telefone invalido -> bloqueio ja emitido

    if (Object.prototype.hasOwnProperty.call(out, contact.canonicalName)) {
      blocks.push({
        code: 'duplicate-contact-name',
        reference: `nome:${contact.canonicalName}`,
        message:
          'dois sujeitos publicos possuem o mesmo nome canonico, o que colidiria no ' +
          'indice de contatos.json; desambigue os nomes antes de exportar',
      });
      continue;
    }

    out[contact.canonicalName] = {
      telefone,
      apelidos: [...contact.aliases],
    };
  }
  return out;
}

/**
 * Deriva a URL `https://wa.me/<digitos>` a partir de um E.164 (`+` seguido de
 * 8-15 digitos), removendo apenas o `+`. Formatos invalidos geram bloqueio.
 */
export function waMeFromE164(
  phoneE164: string,
  subjectId: Uuid,
  blocks: LegacyExportBlock[],
): string | undefined {
  const m = /^\+(\d{8,15})$/.exec(phoneE164);
  if (!m) {
    blocks.push({
      code: 'invalid-phone',
      reference: `pessoa:${subjectId}`,
      message:
        'o telefone autorizado nao esta em E.164 valido (+ seguido de 8 a 15 digitos); ' +
        'nao foi possivel derivar a URL wa.me',
    });
    return undefined;
  }
  return `https://wa.me/${m[1]}`;
}

// --------------------------------------------------------------------------
// Auxiliares
// --------------------------------------------------------------------------

function artifactOf<T>(value: T): LegacyArtifact<T> {
  // Observacao canonica: `atual.json` e um array cuja ORDEM e semantica
  // (cronologica), portanto NAO e reordenado pela serializacao. As chaves de
  // cada objeto sao ordenadas lexicograficamente pela canonicalizacao, o que e
  // irrelevante para o visualizador (ele le por chave, nao por ordem).
  const bytes = canonicalBytes(value);
  return { value, bytes, sha256: sha256Hex(bytes) };
}

function toSet(cols?: ReadonlySet<AtualKey> | readonly AtualKey[]): ReadonlySet<AtualKey> {
  if (!cols) return new Set();
  return cols instanceof Set ? cols : new Set(cols);
}

function compareBlock(a: LegacyExportBlock, b: LegacyExportBlock): number {
  if (a.code !== b.code) return a.code < b.code ? -1 : 1;
  if (a.reference !== b.reference) return a.reference < b.reference ? -1 : 1;
  return 0;
}

/**
 * Serializa um artefato legado em JSON legivel pelo visualizador. Util quando o
 * chamador precisa do texto (ex.: comparar com fixtures ou gravar em um caminho
 * de teste). NAO grava em disco — apenas devolve a string.
 */
export function legacyStringify(value: unknown): string {
  return canonicalStringify(value);
}
