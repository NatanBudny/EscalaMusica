// ExternalInputService: entrada manual de Insumos_Externos e conferencia de PDF
// (design.md -> "Components and Interfaces" -> CycleService: "Calendario,
// cultos, insumos..."; "Fluxo mensal na interface" -> etapa de Coleta; "Data
// Models" -> ExternalInput).
//
// TypeScript PURO, sem I/O e deterministico. Toda operacao:
//  - nunca muta a entrada (retorna um novo estado em caso de sucesso);
//  - retorna um resultado tipado; em falha, preserva o estado anterior
//    (ausencia de mutacao).
//
// O PDF e APENAS referencia externa: nunca e interpretado como fonte de dados
// (design.md, "Limites e seguranca de entrada": "PDFs nao sao interpretados na
// v1"). Os dados de anciao, pregador e sonoplastia sao DIGITADOS manualmente e
// conferidos em uma tela-resumo antes de confirmar (Requisitos 4.18-4.20).
//
// Requisitos cobertos:
//  4.1  anciao responsavel: selecao de uma Pessoa_Canonica.
//  4.2  pregador responsavel: selecao de uma Pessoa_Canonica OU Departamento.
//  4.3  audiovisual/sonoplastia: 1 a 20 Pessoas_Canonicas.
//  4.4  musicas da Escola Sabatina: ate 50, titulo de 1 a 200 caracteres cada.
//  4.5  tema do culto: 1 a 200 caracteres.
//  4.6  pedidos de musica: ate 20, descricao de 1 a 200 caracteres cada.
//  4.7  observacao: exigir classificacao publica OU privada antes de salvar.
//  4.8  todo insumo registra fonte, data da atualizacao e operador (proveniencia).
//  4.15 (apoio) ausencia de campo obrigatorio e tratada pelo Validador; aqui
//       garantimos que nenhum insumo e salvo sem tipo/proveniencia validos.
//  4.18 permitir a digitacao manual dos dados recebidos em PDF.
//  4.19 a digitacao manual e o procedimento completo de entrada da v1.
//  4.20 apresentar os dados digitados para conferencia antes de confirmar.

import { SCHEMA_VERSION } from '../schemas/models';
import type { ExternalInput, ExternalInputType, Uuid } from '../schemas/models';

// --------------------------------------------------------------------------
// Limites de cardinalidade e comprimento (Requisitos 4.3-4.6)
// --------------------------------------------------------------------------

export const EXTERNAL_INPUT_LIMITS = {
  /** 4.3 audiovisual/sonoplastia: 1 a 20 pessoas. */
  audioMin: 1,
  audioMax: 20,
  /** 4.4 musicas da Escola Sabatina: ate 50, titulo 1-200. */
  sabbathSongMax: 50,
  /** 4.6 pedidos de musica: ate 20, descricao 1-200. */
  songRequestMax: 20,
  /** 4.4/4.5/4.6 comprimento de titulo/tema/pedido. */
  textMin: 1,
  textMax: 200,
  /** 4.7 observacao publica/privada: comprimento do texto. */
  observationMin: 1,
  observationMax: 1000,
} as const;

// --------------------------------------------------------------------------
// Valores tipados por tipo de insumo
// --------------------------------------------------------------------------

/** 4.1 anciao: referencia a exatamente uma Pessoa_Canonica. */
export interface ElderValue {
  personId: Uuid;
}

/** 4.2 pregador: pessoa OU departamento. */
export interface PreacherValue {
  subject: { type: 'person' | 'department'; id: Uuid };
}

/** 4.3 audiovisual/sonoplastia: 1 a 20 Pessoas_Canonicas (sem duplicidade). */
export interface AudioValue {
  personIds: Uuid[];
}

/** 4.4 uma musica da Escola Sabatina (titulo 1-200). */
export interface SabbathSchoolSongValue {
  title: string;
}

/** 4.5 tema do culto (1-200). */
export interface ThemeValue {
  text: string;
}

/** 4.6 um pedido de musica do pregador (descricao 1-200). */
export interface SongRequestValue {
  description: string;
}

/** 4.7 observacao com classificacao publica/privada obrigatoria. */
export interface ObservationValue {
  text: string;
  classification: 'public' | 'private';
}

/**
 * Proveniencia obrigatoria de todo insumo (Requisito 4.8): fonte, operador e
 * instante da atualizacao. O servico rejeita qualquer insumo sem fonte ou sem
 * operador ("insumo sem proveniencia nao e salvo").
 */
export interface Provenance {
  /** Fonte do insumo (ex.: "PDF anciaos 2026-02", "mensagem do pregador"). */
  source: string;
  operatorId: Uuid;
  /** Instante UTC da atualizacao. */
  updatedAt: string;
}

// --------------------------------------------------------------------------
// Resultado tipado
// --------------------------------------------------------------------------

export type ExternalInputErrorCode =
  | 'unknown-type'
  | 'missing-provenance' // 4.8: fonte/operador ausentes
  | 'observation-missing-classification' // 4.7
  | 'observation-length'
  | 'elder-missing-person'
  | 'preacher-missing-subject'
  | 'audio-cardinality' // 4.3: fora de 1..20
  | 'audio-duplicate'
  | 'sabbath-song-cardinality' // 4.4: > 50
  | 'sabbath-song-length' // 4.4: titulo fora de 1..200
  | 'theme-length' // 4.5: fora de 1..200
  | 'song-request-cardinality' // 4.6: > 20
  | 'song-request-length' // 4.6: descricao fora de 1..200
  | 'not-found'
  | 'duplicate-id';

export interface ExternalInputError {
  code: ExternalInputErrorCode;
  /** Mensagem legivel em portugues. */
  message: string;
  /** Campo afetado, quando aplicavel (apoio ao Requisito 4.15). */
  field?: string;
}

export type ExternalInputResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: ExternalInputError };

const ok = <T>(value: T): ExternalInputResult<T> => ({ ok: true, value });
const fail = <T>(
  code: ExternalInputErrorCode,
  message: string,
  field?: string,
): ExternalInputResult<T> => ({
  ok: false,
  error: { code, message, ...(field !== undefined ? { field } : {}) },
});

// --------------------------------------------------------------------------
// Entrada do comando de registro
// --------------------------------------------------------------------------

/** Mapa de tipo -> forma do valor aceito pelo registro. */
export interface ExternalInputPayloadByType {
  elder: ElderValue;
  preacher: PreacherValue;
  audio: AudioValue;
  'sabbath-school-song': SabbathSchoolSongValue;
  theme: ThemeValue;
  'song-request': SongRequestValue;
  observation: ObservationValue;
}

export interface RegisterExternalInput<T extends ExternalInputType = ExternalInputType> {
  /** Id (UUID) do novo insumo. */
  id: Uuid;
  /** Culto ao qual o insumo pertence. */
  serviceId: Uuid;
  type: T;
  value: ExternalInputPayloadByType[T];
  provenance: Provenance;
}

// --------------------------------------------------------------------------
// Validacao da proveniencia (Requisito 4.8)
// --------------------------------------------------------------------------

function checkProvenance(p: Provenance | undefined): ExternalInputError | null {
  if (p === undefined) {
    return { code: 'missing-provenance', message: 'insumo sem proveniencia nao e salvo' };
  }
  if (typeof p.source !== 'string' || p.source.trim().length === 0) {
    return {
      code: 'missing-provenance',
      message: 'insumo sem fonte (proveniencia) nao e salvo',
      field: 'source',
    };
  }
  if (typeof p.operatorId !== 'string' || p.operatorId.length === 0) {
    return {
      code: 'missing-provenance',
      message: 'insumo sem operador responsavel (proveniencia) nao e salvo',
      field: 'operatorId',
    };
  }
  if (typeof p.updatedAt !== 'string' || p.updatedAt.length === 0) {
    return {
      code: 'missing-provenance',
      message: 'insumo sem data da atualizacao (proveniencia) nao e salvo',
      field: 'updatedAt',
    };
  }
  return null;
}

// --------------------------------------------------------------------------
// Validacao por tipo (cardinalidades e comprimentos de borda)
// --------------------------------------------------------------------------

function isNonEmptyId(id: unknown): id is Uuid {
  return typeof id === 'string' && id.length > 0;
}

function lengthWithinInclusive(text: string, min: number, max: number): boolean {
  return text.length >= min && text.length <= max;
}

/**
 * Valida o valor do insumo conforme o tipo. Retorna o erro tipado, ou null se
 * valido. A visibilidade derivada e `public` para observacao publica e
 * `private` nos demais casos (observacao privada e qualquer insumo nao-publico
 * por padrao).
 */
function checkValue(
  type: ExternalInputType,
  value: unknown,
): ExternalInputError | null {
  switch (type) {
    case 'elder': {
      const v = value as ElderValue;
      if (!isNonEmptyId(v?.personId)) {
        return {
          code: 'elder-missing-person',
          message: 'o anciao exige a selecao de exatamente uma Pessoa_Canonica',
          field: 'personId',
        };
      }
      return null;
    }
    case 'preacher': {
      const v = value as PreacherValue;
      if (
        v?.subject === undefined ||
        (v.subject.type !== 'person' && v.subject.type !== 'department') ||
        !isNonEmptyId(v.subject.id)
      ) {
        return {
          code: 'preacher-missing-subject',
          message: 'o pregador exige a selecao de uma Pessoa_Canonica ou de um Departamento',
          field: 'subject',
        };
      }
      return null;
    }
    case 'audio': {
      const v = value as AudioValue;
      const ids = Array.isArray(v?.personIds) ? v.personIds : [];
      if (
        ids.length < EXTERNAL_INPUT_LIMITS.audioMin ||
        ids.length > EXTERNAL_INPUT_LIMITS.audioMax ||
        !ids.every(isNonEmptyId)
      ) {
        return {
          code: 'audio-cardinality',
          message:
            `audiovisual/sonoplastia exige de ${EXTERNAL_INPUT_LIMITS.audioMin} a ` +
            `${EXTERNAL_INPUT_LIMITS.audioMax} Pessoas_Canonicas`,
          field: 'personIds',
        };
      }
      if (new Set(ids).size !== ids.length) {
        return {
          code: 'audio-duplicate',
          message: 'audiovisual/sonoplastia nao aceita a mesma pessoa repetida',
          field: 'personIds',
        };
      }
      return null;
    }
    case 'sabbath-school-song': {
      const v = value as SabbathSchoolSongValue;
      if (
        typeof v?.title !== 'string' ||
        !lengthWithinInclusive(v.title, EXTERNAL_INPUT_LIMITS.textMin, EXTERNAL_INPUT_LIMITS.textMax)
      ) {
        return {
          code: 'sabbath-song-length',
          message:
            `o titulo da musica deve ter de ${EXTERNAL_INPUT_LIMITS.textMin} a ` +
            `${EXTERNAL_INPUT_LIMITS.textMax} caracteres`,
          field: 'title',
        };
      }
      return null;
    }
    case 'theme': {
      const v = value as ThemeValue;
      if (
        typeof v?.text !== 'string' ||
        !lengthWithinInclusive(v.text, EXTERNAL_INPUT_LIMITS.textMin, EXTERNAL_INPUT_LIMITS.textMax)
      ) {
        return {
          code: 'theme-length',
          message:
            `o tema do culto deve ter de ${EXTERNAL_INPUT_LIMITS.textMin} a ` +
            `${EXTERNAL_INPUT_LIMITS.textMax} caracteres`,
          field: 'text',
        };
      }
      return null;
    }
    case 'song-request': {
      const v = value as SongRequestValue;
      if (
        typeof v?.description !== 'string' ||
        !lengthWithinInclusive(
          v.description,
          EXTERNAL_INPUT_LIMITS.textMin,
          EXTERNAL_INPUT_LIMITS.textMax,
        )
      ) {
        return {
          code: 'song-request-length',
          message:
            `a descricao do pedido deve ter de ${EXTERNAL_INPUT_LIMITS.textMin} a ` +
            `${EXTERNAL_INPUT_LIMITS.textMax} caracteres`,
          field: 'description',
        };
      }
      return null;
    }
    case 'observation': {
      const v = value as ObservationValue;
      // 4.7: exigir classificacao publica/privada ANTES de salvar.
      if (v?.classification !== 'public' && v?.classification !== 'private') {
        return {
          code: 'observation-missing-classification',
          message: 'a observacao exige classificacao publica ou privada antes de salvar',
          field: 'classification',
        };
      }
      if (
        typeof v.text !== 'string' ||
        !lengthWithinInclusive(
          v.text,
          EXTERNAL_INPUT_LIMITS.observationMin,
          EXTERNAL_INPUT_LIMITS.observationMax,
        )
      ) {
        return {
          code: 'observation-length',
          message:
            `a observacao deve ter de ${EXTERNAL_INPUT_LIMITS.observationMin} a ` +
            `${EXTERNAL_INPUT_LIMITS.observationMax} caracteres`,
          field: 'text',
        };
      }
      return null;
    }
    default: {
      return { code: 'unknown-type', message: `tipo de insumo desconhecido: ${String(type)}` };
    }
  }
}

/** Visibilidade derivada do insumo: publica apenas para observacao publica. */
function deriveVisibility(
  type: ExternalInputType,
  value: unknown,
): 'public' | 'private' {
  if (type === 'observation') {
    return (value as ObservationValue).classification === 'public' ? 'public' : 'private';
  }
  // Demais insumos sao dados de trabalho; a projecao publica decide a emissao.
  return 'private';
}

// --------------------------------------------------------------------------
// Resumo de conferencia (Requisito 4.20)
// --------------------------------------------------------------------------

/** Item do resumo de conferencia apresentado antes de confirmar o insumo. */
export interface ConfirmationSummary {
  type: ExternalInputType;
  /** Rotulo legivel do tipo em portugues. */
  typeLabel: string;
  serviceId: Uuid;
  source: string;
  /** Linhas legiveis dos dados digitados para conferencia. */
  lines: string[];
  /** Observacao sem classificacao nao pode ser confirmada (4.7). */
  classification?: 'public' | 'private';
}

const TYPE_LABELS: Record<ExternalInputType, string> = {
  elder: 'Anciao',
  preacher: 'Pregador',
  audio: 'Audiovisual/Sonoplastia',
  'sabbath-school-song': 'Musica da Escola Sabatina',
  theme: 'Tema do culto',
  'song-request': 'Pedido de musica',
  observation: 'Observacao',
};

/**
 * Monta o resumo de conferencia (Requisito 4.20) dos dados digitados, SEM
 * salvar. A UI deve apresentar este resumo antes de confirmar o insumo. O
 * resumo tambem reflete erros de validacao: se o valor for invalido, as
 * `lines` descrevem o problema para a conferencia.
 */
export function buildConfirmationSummary<T extends ExternalInputType>(
  input: RegisterExternalInput<T>,
): ConfirmationSummary {
  const lines: string[] = [];
  let classification: 'public' | 'private' | undefined;

  switch (input.type) {
    case 'elder': {
      const v = input.value as ElderValue;
      lines.push(`Anciao: pessoa ${v.personId}`);
      break;
    }
    case 'preacher': {
      const v = input.value as PreacherValue;
      const kind = v.subject.type === 'person' ? 'pessoa' : 'departamento';
      lines.push(`Pregador: ${kind} ${v.subject.id}`);
      break;
    }
    case 'audio': {
      const v = input.value as AudioValue;
      lines.push(`Audiovisual/Sonoplastia (${v.personIds.length}): ${v.personIds.join(', ')}`);
      break;
    }
    case 'sabbath-school-song': {
      const v = input.value as SabbathSchoolSongValue;
      lines.push(`Musica ES: ${v.title}`);
      break;
    }
    case 'theme': {
      const v = input.value as ThemeValue;
      lines.push(`Tema: ${v.text}`);
      break;
    }
    case 'song-request': {
      const v = input.value as SongRequestValue;
      lines.push(`Pedido: ${v.description}`);
      break;
    }
    case 'observation': {
      const v = input.value as ObservationValue;
      classification = v.classification;
      const classLabel =
        v.classification === 'public'
          ? 'publica'
          : v.classification === 'private'
            ? 'privada'
            : 'SEM CLASSIFICACAO';
      lines.push(`Observacao (${classLabel}): ${v.text ?? ''}`);
      break;
    }
    default:
      lines.push('Tipo de insumo desconhecido.');
  }

  return {
    type: input.type,
    typeLabel: TYPE_LABELS[input.type] ?? String(input.type),
    serviceId: input.serviceId,
    source: input.provenance?.source ?? '',
    lines,
    ...(classification !== undefined ? { classification } : {}),
  };
}

// --------------------------------------------------------------------------
// Snapshot imutavel
// --------------------------------------------------------------------------

export interface ExternalInputSnapshot {
  inputs: readonly ExternalInput[];
}

// --------------------------------------------------------------------------
// Servico
// --------------------------------------------------------------------------

/**
 * Armazena Insumos_Externos de um ciclo. Construido vazio ou a partir de um
 * snapshot. Toda operacao de mutacao retorna uma falha tipada ou aplica a
 * mudanca, sempre preservando o estado anterior em caso de falha. O servico
 * nunca muta os objetos recebidos nem os retornados via snapshot.
 */
export class ExternalInputService {
  private inputs: Map<Uuid, ExternalInput>;

  constructor(snapshot?: ExternalInputSnapshot) {
    this.inputs = new Map((snapshot?.inputs ?? []).map((i) => [i.id, clone(i)]));
  }

  /** Snapshot imutavel (copias defensivas, ordem estavel por id). */
  snapshot(): ExternalInputSnapshot {
    return {
      inputs: [...this.inputs.values()]
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        .map(clone),
    };
  }

  /** Insumos de um culto especifico. */
  forService(serviceId: Uuid): ExternalInput[] {
    return [...this.inputs.values()]
      .filter((i) => i.serviceId === serviceId)
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map(clone);
  }

  /**
   * Valida um insumo SEM salvar. Util para a conferencia (4.20): a UI pode
   * exibir o resultado antes de confirmar. Nao altera o estado.
   */
  validate<T extends ExternalInputType>(
    input: RegisterExternalInput<T>,
  ): ExternalInputResult<ConfirmationSummary> {
    const prov = checkProvenance(input.provenance);
    if (prov) return { ok: false, error: prov };

    const valueErr = checkValue(input.type, input.value);
    if (valueErr) return { ok: false, error: valueErr };

    return ok(buildConfirmationSummary(input));
  }

  /**
   * Registra um Insumo_Externo apos a validacao objetiva. SO salva quando:
   *  - a proveniencia (fonte, operador, data) esta presente (4.8);
   *  - cardinalidades e comprimentos de borda sao respeitados (4.3-4.6);
   *  - observacao possui classificacao publica ou privada (4.7).
   *
   * Em qualquer falha, o estado anterior e preservado (nenhuma mutacao).
   */
  register<T extends ExternalInputType>(
    input: RegisterExternalInput<T>,
  ): ExternalInputResult<ExternalInput> {
    if (this.inputs.has(input.id)) {
      return fail('duplicate-id', `id de insumo ja utilizado: ${input.id}`);
    }

    const prov = checkProvenance(input.provenance);
    if (prov) return { ok: false, error: prov };

    const valueErr = checkValue(input.type, input.value);
    if (valueErr) return { ok: false, error: valueErr };

    const record: ExternalInput = {
      schemaVersion: SCHEMA_VERSION,
      id: input.id,
      serviceId: input.serviceId,
      type: input.type,
      value: clone(input.value),
      visibility: deriveVisibility(input.type, input.value),
      source: input.provenance.source,
      updatedAt: input.provenance.updatedAt,
      operatorId: input.provenance.operatorId,
    };

    this.inputs.set(record.id, record);
    return ok(clone(record));
  }

  /** Remove um insumo. Falha preserva o estado quando o id nao existe. */
  remove(id: Uuid): ExternalInputResult<ExternalInput> {
    const current = this.inputs.get(id);
    if (!current) return fail('not-found', `insumo inexistente: ${id}`);
    this.inputs.delete(id);
    return ok(clone(current));
  }
}

/** Copia profunda segura para os modelos de dados (JSON-serializaveis). */
function clone<T>(value: T): T {
  return structuredClone(value);
}
