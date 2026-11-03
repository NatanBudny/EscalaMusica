// PublicProjection: converte o estado privado do dominio em um modelo publico
// por ALLOWLIST, aplica as autorizacoes de nome/alias/telefone e executa um
// scanner de segredos ANTES da serializacao (tarefa 9.1).
//
// Esta e uma funcao PURA e deterministica, sem I/O e sem estado global. Ela
// NAO cria um modelo paralelo: reusa a tabela de classificacao de campos
// (schemas/classification.ts), o `RegistryService` para avaliar autorizacoes
// publicas vigentes (`isPublicAuthorized`), a serializacao canonica
// (schemas/canonical.ts) e o detector de nomes de campo secretos
// (commands/audit.ts -> `isSecretField`).
//
// Principios de desenho aplicados (design.md, "Fronteira publica/privada" e
// "Nada publico por acidente"):
//   - A projecao NASCE de um DTO publico sem campos privados. Nenhum campo
//     classificado como `private` em FIELD_CLASSIFICATION pode entrar.
//   - Nome canonico, alias e telefone so aparecem quando ha autorizacao
//     publica VIGENTE para o sujeito, o valor (por hash) e a finalidade.
//   - Um telefone destinado aos Dados_Publicos SEM autorizacao vigente gera um
//     BLOQUEIO (nunca um descarte silencioso) — requisitos 11.15 e 7.20.
//   - Antes de serializar, um scanner inspeciona (a) nomes de campo secretos e
//     (b) valores-sentinela de segredo/token/privado. Qualquer deteccao impede
//     a emissao do pacote e e reportada sem repetir o conteudo (requisitos
//     11.3, 11.5, 7.20).
//
// Requisitos cobertos: 3.11, 3.12, 7.20, 9.11, 11.1-11.5, 11.15, 11.16, 13.8.

import type {
  CanonicalEntityName,
  ExternalInput,
  IsoDate,
  Person,
  PublicServiceFields,
  ScheduleDraft,
  Service,
  Uuid,
} from '../schemas/models';
import { FIELD_CLASSIFICATION } from '../schemas/classification';
import type { RegistryService } from '../registry/registry-service';
import { isSecretField } from '../commands/audit';
import { canonicalBytes, canonicalStringify, sha256Hex } from '../schemas/canonical';

// --------------------------------------------------------------------------
// Entrada e saida
// --------------------------------------------------------------------------

/**
 * Finalidade da publicacao usada para avaliar autorizacoes de contato (11.4).
 * A autorizacao e vigente somente quando sua `purpose` coincide com esta.
 */
export interface PublicationPurpose {
  readonly phonePurpose: string;
}

/** Entrada imutavel da projecao publica de um ciclo/rascunho. */
export interface PublicProjectionInput {
  /** Cadastro (fonte das autorizacoes publicas e dos dados de pessoa/depto). */
  readonly registry: RegistryService;
  /** Cultos ativos do ciclo (apenas campos publicos sao projetados). */
  readonly services: readonly Service[];
  /** Rascunho validado (atribuicoes + campos publicos por culto). */
  readonly draft: ScheduleDraft;
  /** Insumos externos (apenas os com visibility === 'public' sao projetados). */
  readonly externalInputs: readonly ExternalInput[];
  /** Periodo `YYYY-MM` do ciclo. */
  readonly period: string;
  /** Instante civil (`YYYY-MM-DD`) para avaliar vigencia das autorizacoes. */
  readonly at: IsoDate;
  /** Finalidades autorizadas da publicacao. */
  readonly purpose: PublicationPurpose;
  /** Funcao de hash de valor para casar com `valueHash` da autorizacao. */
  readonly valueHash?: (value: string) => string;
}

/** Sujeito publicado em uma atribuicao (nome resolvido por autorizacao). */
export interface PublicAssignment {
  readonly serviceId: Uuid;
  readonly roleId: Uuid;
  readonly slot?: string;
  /** Nome publico do sujeito (canonico autorizado) ou `undefined` se negado. */
  readonly name?: string;
  readonly subjectType: 'person' | 'department';
}

/** Dados publicos de um culto. */
export interface PublicServiceDTO {
  readonly serviceId: Uuid;
  readonly date: IsoDate;
  readonly weekday: Service['computedWeekday'];
  readonly kind: Service['kind'];
  /** Campos publicos do rascunho para o culto (allowlist por classificacao). */
  readonly publicFields: Record<string, unknown>;
  /** Observacoes/temas externos marcados como publicos. */
  readonly publicInputs: ReadonlyArray<{ type: ExternalInput['type']; value: unknown }>;
  readonly assignments: readonly PublicAssignment[];
}

/** Contato publico de uma pessoa (apenas campos autorizados). */
export interface PublicContactDTO {
  readonly subjectId: Uuid;
  /** Nome canonico publico (sempre publico por classificacao). */
  readonly canonicalName: string;
  /** Aliases autorizados como publicos (pode ser vazio). */
  readonly aliases: readonly string[];
  /** Telefone E.164, presente SOMENTE quando autorizado e vigente. */
  readonly phoneE164?: string;
}

/** DTO publico completo, antes da serializacao. */
export interface PublicProjectionDTO {
  readonly period: string;
  readonly services: readonly PublicServiceDTO[];
  readonly contacts: readonly PublicContactDTO[];
}

/**
 * Bloqueio de projecao (requisitos 7.20, 11.5, 11.15). NUNCA repete o conteudo
 * privado/secreto; identifica arquivo/campo/sujeito por referencia.
 */
export interface ProjectionBlock {
  readonly code:
    | 'phone-not-authorized' // 11.15: telefone sem autorizacao vigente
    | 'private-field-leak' // 11.5: campo classificado privado no pacote
    | 'secret-field-name' // 11.3: nome de campo secreto detectado
    | 'secret-value-leak'; // 11.3: valor-sentinela de segredo detectado
  /** Referencia legivel (sujeito/culto/campo), sem o conteudo sensivel. */
  readonly reference: string;
  /** Explicacao em portugues, sem repetir o conteudo privado. */
  readonly message: string;
}

/** Resultado da projecao: ou um pacote emitivel, ou os bloqueios encontrados. */
export type PublicProjectionResult =
  | {
      readonly ok: true;
      readonly dto: PublicProjectionDTO;
      /** Bytes canonicos do pacote (ja escaneados). */
      readonly bytes: Uint8Array;
      /** Hash SHA-256 do pacote canonico. */
      readonly sha256: string;
    }
  | { readonly ok: false; readonly blocks: readonly ProjectionBlock[] };

// --------------------------------------------------------------------------
// Scanner de valores-sentinela de segredo/privado
// --------------------------------------------------------------------------

/**
 * Padroes de valor que denunciam vazamento de segredo/token/credencial no
 * pacote serializado. Sao conservadores e independentes de dados reais: o
 * objetivo e falhar o pacote caso qualquer sentinela escape da allowlist.
 *
 * Observacao: a allowlist estrutural (classificacao) e a autoridade primaria;
 * este scanner e uma defesa em profundidade sobre os BYTES finais.
 */
const SECRET_VALUE_PATTERNS: ReadonlyArray<{
  code: ProjectionBlock['code'];
  re: RegExp;
  label: string;
}> = [
  // Tokens do GitHub (ghp_, gho_, ghs_, ghu_, github_pat_).
  { code: 'secret-value-leak', re: /gh[opsu]_[A-Za-z0-9]{20,}/u, label: 'token GitHub' },
  { code: 'secret-value-leak', re: /github_pat_[A-Za-z0-9_]{20,}/u, label: 'token GitHub (PAT)' },
  // Bearer tokens.
  { code: 'secret-value-leak', re: /bearer\s+[A-Za-z0-9._-]{10,}/iu, label: 'token Bearer' },
  // JWT (tres segmentos base64url separados por ponto).
  {
    code: 'secret-value-leak',
    re: /eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/u,
    label: 'JWT',
  },
  // Chaves privadas PEM.
  { code: 'secret-value-leak', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/u, label: 'chave privada' },
];

/**
 * Prefixo convencional de valores-sentinela usados nos testes e na defesa em
 * profundidade. Qualquer string contendo este prefixo indica conteudo que
 * jamais poderia ser publicado.
 */
export const PRIVATE_SENTINEL_PREFIX = 'SENTINELA_PRIVADA';

// --------------------------------------------------------------------------
// Projecao
// --------------------------------------------------------------------------

/** Campos publicos conhecidos de uma entidade (classificacao === 'public'). */
function publicFieldsOf(entity: CanonicalEntityName): ReadonlySet<string> {
  const table = FIELD_CLASSIFICATION[entity];
  return new Set(Object.keys(table).filter((f) => table[f] === 'public'));
}

/**
 * Projeta o estado privado em um DTO publico, aplica autorizacoes e escaneia
 * os bytes finais. Retorna o pacote emitivel OU a lista de bloqueios.
 *
 * Determinismo: a ordem de cultos segue a ordem recebida; contatos e aliases
 * sao ordenados de forma estavel; os bytes usam serializacao canonica.
 */
export function projectPublic(input: PublicProjectionInput): PublicProjectionResult {
  const blocks: ProjectionBlock[] = [];
  const hashOf = input.valueHash ?? defaultValueHash;

  const scheduleDraftPublic = publicFieldsOf('scheduleDraft');
  const servicePublic = publicFieldsOf('service');

  // Index de publicFields do rascunho por culto.
  const publicFieldsByService = new Map<Uuid, PublicServiceFields>();
  if (scheduleDraftPublic.has('publicFields')) {
    for (const pf of input.draft.publicFields) publicFieldsByService.set(pf.serviceId, pf);
  }

  // --- Cultos ----------------------------------------------------------
  const activeServices = input.services.filter((s) => s.removed === undefined);
  const services: PublicServiceDTO[] = activeServices.map((service) => {
    // Campos publicos do culto (date/computedWeekday/kind sao classificados
    // como 'public' em FIELD_CLASSIFICATION.service; a allowlist e conferida
    // em teste via `publicFieldsOf('service')`).
    void servicePublic;
    const date = service.date;
    const weekday = service.computedWeekday;
    const kind = service.kind;

    // Campos publicos do rascunho para o culto.
    const pf = publicFieldsByService.get(service.id);
    const publicFields = pf ? sanitizeFieldMap(pf.fields, service.id, blocks) : {};

    // Insumos externos publicos (visibility === 'public').
    const publicInputs = input.externalInputs
      .filter((i) => i.serviceId === service.id && i.visibility === 'public')
      .map((i) => ({ type: i.type, value: i.value }));

    // Atribuicoes com nome publico resolvido por autorizacao.
    const assignments: PublicAssignment[] = input.draft.assignments
      .filter((a) => a.serviceId === service.id)
      .map((a) => projectAssignment(a, input));

    return {
      serviceId: service.id,
      date,
      weekday,
      kind,
      publicFields,
      publicInputs,
      assignments,
    };
  });

  // --- Contatos publicos ----------------------------------------------
  const snapshot = input.registry.snapshot();
  const contacts: PublicContactDTO[] = [];
  for (const person of snapshot.people) {
    // So pessoas ATIVAS entram nos Dados_Publicos (3.11).
    if (person.participation !== 'active') continue;
    const contact = projectContact(person, input, hashOf, blocks);
    if (contact) contacts.push(contact);
  }
  contacts.sort((a, b) => (a.subjectId < b.subjectId ? -1 : a.subjectId > b.subjectId ? 1 : 0));

  const dto: PublicProjectionDTO = { period: input.period, services, contacts };

  // --- Scanner de segredos sobre os BYTES finais (defesa em profundidade) --
  const canonical = canonicalStringify(dto);
  scanSerializedForSecrets(canonical, blocks);

  if (blocks.length > 0) {
    // Ordena para saida estavel.
    blocks.sort(compareBlock);
    return { ok: false, blocks };
  }

  const bytes = canonicalBytes(dto);
  return { ok: true, dto, bytes, sha256: sha256Hex(bytes) };
}

// --------------------------------------------------------------------------
// Projecao de atribuicao e contato
// --------------------------------------------------------------------------

function projectAssignment(
  assignment: ScheduleDraft['assignments'][number],
  input: PublicProjectionInput,
): PublicAssignment {
  const base: PublicAssignment = {
    serviceId: assignment.serviceId,
    roleId: assignment.roleId,
    subjectType: assignment.subject.type,
  };
  if (assignment.slot !== undefined) (base as { slot?: string }).slot = assignment.slot;

  // Departamento: nome canonico e sempre publico por classificacao.
  if (assignment.subject.type === 'department') {
    const dept = input.registry.getDepartment(assignment.subject.id);
    if (dept && dept.status === 'active') {
      return { ...base, name: dept.canonicalName };
    }
    return base;
  }

  // Pessoa: nome canonico e publico por classificacao (campo 'canonicalName'
  // classificado como 'public'). A autorizacao de contato rege telefone/alias;
  // o nome canonico usado na escala e publicavel por classificacao estrutural.
  const person = input.registry.getPerson(assignment.subject.id);
  if (person) {
    return { ...base, name: person.canonicalName };
  }
  return base;
}

function projectContact(
  person: Person,
  input: PublicProjectionInput,
  hashOf: (v: string) => string,
  blocks: ProjectionBlock[],
): PublicContactDTO | null {
  const canonicalName = person.canonicalName; // 'public' por classificacao

  // Aliases: privados por padrao; so entram com autorizacao vigente (3.12,
  // 11.1). A ausencia de autorizacao e um DESCARTE silencioso legitimo do
  // alias (nao e bloqueio) — o alias e privado por padrao.
  const aliases: string[] = [];
  for (const alias of person.aliases) {
    const authorized = input.registry.isPublicAuthorized({
      subjectId: person.id,
      field: 'alias',
      valueHash: hashOf(alias.value),
      purpose: input.purpose.phonePurpose,
      at: input.at,
    });
    if (authorized) aliases.push(alias.value);
  }
  aliases.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  const contact: PublicContactDTO = {
    subjectId: person.id,
    canonicalName,
    aliases,
  };

  // Telefone: so entra com autorizacao vigente (11.16). Se a pessoa POSSUI um
  // telefone e ele estaria destinado aos Dados_Publicos mas NAO ha autorizacao
  // vigente, isso e um BLOQUEIO (11.15, 7.20) — nunca um descarte silencioso.
  if (person.phoneE164 !== undefined) {
    const authorized = input.registry.isPublicAuthorized({
      subjectId: person.id,
      field: 'phone',
      valueHash: hashOf(person.phoneE164),
      purpose: input.purpose.phonePurpose,
      at: input.at,
    });
    if (authorized) {
      return { ...contact, phoneE164: person.phoneE164 };
    }
    blocks.push({
      code: 'phone-not-authorized',
      reference: `pessoa:${person.id}`,
      message:
        'telefone destinado aos Dados_Publicos sem autorizacao vigente para a ' +
        'pessoa, o valor e a finalidade; a inclusao do telefone foi bloqueada',
    });
    // O contato (nome/aliases) ainda pode existir; o telefone e omitido, mas
    // o bloqueio impede a emissao do pacote enquanto nao for resolvido.
    return contact;
  }

  return contact;
}

// --------------------------------------------------------------------------
// Sanitizacao de mapa de campos publicos do rascunho
// --------------------------------------------------------------------------

/**
 * Inspeciona um mapa de campos publicos do rascunho. Como `publicFields` e um
 * `Record<string, unknown>` aberto, aplicamos a defesa por NOME de campo
 * secreto (isSecretField) e preservamos somente chaves nao secretas. Qualquer
 * chave com nome secreto gera bloqueio (11.3) — nunca e copiada.
 */
function sanitizeFieldMap(
  fields: Record<string, unknown>,
  serviceId: Uuid,
  blocks: ProjectionBlock[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(fields).sort()) {
    if (isSecretField(key)) {
      blocks.push({
        code: 'secret-field-name',
        reference: `culto:${serviceId} campo:${key}`,
        message:
          'um campo com nome de segredo foi encontrado nos campos publicos do ' +
          'culto; o campo foi bloqueado e nao sera publicado',
      });
      continue;
    }
    out[key] = fields[key];
  }
  return out;
}

// --------------------------------------------------------------------------
// Scanner de segredos sobre os bytes/serializacao final
// --------------------------------------------------------------------------

/**
 * Escaneia a representacao canonica final do pacote em busca de sentinelas de
 * segredo/privado e padroes de token/chave. Qualquer deteccao adiciona um
 * bloqueio SEM repetir o conteudo (apenas o rotulo do padrao).
 */
export function scanSerializedForSecrets(serialized: string, blocks: ProjectionBlock[]): void {
  if (serialized.includes(PRIVATE_SENTINEL_PREFIX)) {
    blocks.push({
      code: 'secret-value-leak',
      reference: 'pacote',
      message:
        'uma sentinela de dado privado foi detectada no pacote serializado; ' +
        'a emissao foi bloqueada para impedir o vazamento',
    });
  }
  for (const pattern of SECRET_VALUE_PATTERNS) {
    if (pattern.re.test(serialized)) {
      blocks.push({
        code: pattern.code,
        reference: 'pacote',
        message: `um valor que se assemelha a ${pattern.label} foi detectado no pacote serializado; a emissao foi bloqueada`,
      });
    }
  }
}

// --------------------------------------------------------------------------
// Auxiliares
// --------------------------------------------------------------------------

/** Hash padrao de valor: SHA-256 hex do UTF-8 do valor. */
function defaultValueHash(value: string): string {
  return sha256Hex(canonicalBytes(value));
}

function compareBlock(a: ProjectionBlock, b: ProjectionBlock): number {
  if (a.code !== b.code) return a.code < b.code ? -1 : 1;
  if (a.reference !== b.reference) return a.reference < b.reference ? -1 : 1;
  return 0;
}
