// RegistryService: cadastro central de Pessoas_Canonicas, Departamentos e
// autorizacoes publicas de contato (design.md, "Components and Interfaces" ->
// RegistryService; "Data Models"; requisitos 3.1-3.15, 11.4, 11.15, 11.16).
//
// O servico e uma camada PURA e sem I/O que compoe:
//  - os comandos puros de agregado de `aggregates/people.ts` (invariantes de
//    pessoa/departamento: nomes, aliases, telefone E.164, estados,
//    habilitacoes, dias, afastamentos, vinculos e desativacao);
//  - o namespace de identidade de `registry/identity.ts` (unicidade global de
//    nomes/aliases com normalizacao e casefold, requisitos 3.6 e 3.7).
//
// Alem disso, o servico aplica as regras que exigem o CONJUNTO do cadastro, e
// nao um agregado isolado:
//  - unicidade global de identidade entre pessoas e departamentos (3.7);
//  - protecao de referencias na exclusao (3.13) e restricao de novas
//    atribuicoes na desativacao (3.9);
//  - autorizacoes publicas de contato por sujeito, valor, finalidade e
//    vigencia (11.4), usadas para decidir se um telefone/alias/nome pode
//    integrar os Dados_Publicos (11.15, 11.16).
//
// INVARIANTE CENTRAL: toda operacao e transacional em relacao ao estado do
// servico. Quando uma operacao e rejeitada, o estado anterior e preservado
// integralmente (nenhuma mutacao). O servico nunca muta os objetos que recebe
// nem os que retorna via snapshot; ele trabalha sobre copias.

import { SCHEMA_VERSION } from '../schemas/models';
import type {
  Department,
  LeavePeriod,
  Person,
  PersonAlias,
  PersonLink,
  PublicAuthorization,
  Uuid,
  Weekday,
} from '../schemas/models';
import {
  addAlias,
  addLeave,
  addLink,
  createDepartment,
  createPerson,
  deactivatePerson,
  setAllowedWeekdays,
  setPhone,
  type AggregateError,
  type AggregateResult,
  type CreateDepartmentInput,
  type CreatePersonInput,
} from '../aggregates/people';
import { findIdentityCollisions, type IdentityCollision, type IdentitySubject } from './identity';

// --------------------------------------------------------------------------
// Resultado tipado do servico
// --------------------------------------------------------------------------

export type RegistryErrorCode =
  | AggregateError['code']
  // conjunto (cross-aggregate):
  | 'identity-collision' // 3.7: nome/alias colide com outro sujeito
  | 'not-found' // referencia a id inexistente no cadastro
  | 'duplicate-id' // id ja utilizado por outro sujeito
  | 'reference-protected' // 3.13: exclusao bloqueada por referencias
  | 'inactive-subject' // 3.9: nova atribuicao a sujeito inativo
  // autorizacoes publicas (11.4):
  | 'authorization-not-found'
  | 'authorization-range'; // validUntil anterior a validFrom

export interface RegistryError {
  code: RegistryErrorCode;
  /** Mensagem legivel em portugues. */
  message: string;
  /**
   * Quando o codigo e `identity-collision`, identifica as colisoes detectadas
   * (rotulo existente x rotulo conflitante), para a UI indicar o registro
   * conflitante (requisito 3.7).
   */
  collisions?: IdentityCollision[];
}

export type RegistryResult<T> = { ok: true; value: T } | { ok: false; error: RegistryError };

const ok = <T>(value: T): RegistryResult<T> => ({ ok: true, value });
const fail = <T>(
  code: RegistryErrorCode,
  message: string,
  collisions?: IdentityCollision[],
): RegistryResult<T> => ({
  ok: false,
  error: { code, message, ...(collisions ? { collisions } : {}) },
});

/** Converte uma falha de agregado em falha de servico (mesmo codigo). */
const fromAggregate = <T>(error: AggregateError): RegistryResult<T> => ({
  ok: false,
  error: { code: error.code, message: error.message },
});

// --------------------------------------------------------------------------
// Snapshot imutavel do cadastro
// --------------------------------------------------------------------------

/**
 * Estado observavel do cadastro. As colecoes sao copias defensivas; o chamador
 * nunca recebe referencias ao estado interno.
 */
export interface RegistrySnapshot {
  people: readonly Person[];
  departments: readonly Department[];
  authorizations: readonly PublicAuthorization[];
}

/**
 * Referencias externas que podem apontar para uma Pessoa_Canonica fora do
 * proprio cadastro (regras, vinculos, escalas, historico). O servico as usa
 * para decidir se uma exclusao e segura (requisito 3.13). A funcao e injetada
 * para manter o servico puro e desacoplado dos demais agregados.
 */
export type ReferenceLookup = (personId: Uuid) => boolean;

// --------------------------------------------------------------------------
// Entradas dos comandos de autorizacao
// --------------------------------------------------------------------------

export interface RegisterAuthorizationInput {
  id: Uuid;
  subjectId: Uuid;
  field: 'canonicalName' | 'alias' | 'phone';
  /** Hash SHA-256 do valor autorizado (telefone/nome/alias). */
  valueHash: string;
  purpose: string;
  approvedBy: Uuid;
  validFrom: string;
  validUntil?: string;
  now: string;
}

/** Criterio de consulta de autorizacao vigente (11.15, 11.16). */
export interface AuthorizationQuery {
  subjectId: Uuid;
  field: 'canonicalName' | 'alias' | 'phone';
  /** Hash SHA-256 do valor consultado; deve coincidir com o autorizado. */
  valueHash: string;
  purpose: string;
  /** Instante civil (`YYYY-MM-DD`) usado para avaliar a vigencia. */
  at: string;
}

// --------------------------------------------------------------------------
// Servico
// --------------------------------------------------------------------------

/**
 * Cadastro central. Construido vazio ou a partir de um snapshot. Toda operacao
 * de mutacao retorna uma falha tipada ou aplica a mudanca ao estado interno,
 * sempre preservando o estado anterior em caso de falha.
 */
export class RegistryService {
  private people: Map<Uuid, Person>;
  private departments: Map<Uuid, Department>;
  private authorizations: Map<Uuid, PublicAuthorization>;

  constructor(snapshot?: RegistrySnapshot) {
    this.people = new Map((snapshot?.people ?? []).map((p) => [p.id, clone(p)]));
    this.departments = new Map((snapshot?.departments ?? []).map((d) => [d.id, clone(d)]));
    this.authorizations = new Map((snapshot?.authorizations ?? []).map((a) => [a.id, clone(a)]));
  }

  // ---- Consulta --------------------------------------------------------

  /** Snapshot imutavel do cadastro (copias defensivas, ordem estavel por id). */
  snapshot(): RegistrySnapshot {
    return {
      people: sortById([...this.people.values()]).map(clone),
      departments: sortById([...this.departments.values()]).map(clone),
      authorizations: sortById([...this.authorizations.values()]).map(clone),
    };
  }

  getPerson(id: Uuid): Person | undefined {
    const p = this.people.get(id);
    return p ? clone(p) : undefined;
  }

  getDepartment(id: Uuid): Department | undefined {
    const d = this.departments.get(id);
    return d ? clone(d) : undefined;
  }

  // ---- Pessoas ---------------------------------------------------------

  /**
   * Cria uma Pessoa_Canonica. Aplica as invariantes de agregado (3.1-3.4, 3.8,
   * 3.14, 3.15) e a unicidade global de identidade (3.7). O id nao pode
   * coincidir com um sujeito ja cadastrado.
   */
  addPerson(input: CreatePersonInput): RegistryResult<Person> {
    if (this.hasSubject(input.id)) {
      return fail('duplicate-id', `id ja utilizado no cadastro: ${input.id}`);
    }
    const built = createPerson(input);
    if (!built.ok) return fromAggregate(built.error);

    const collision = this.checkIdentity(built.value.id, 'person', built.value);
    if (collision) return collision;

    this.people.set(built.value.id, built.value);
    return ok(clone(built.value));
  }

  /**
   * Cria um Departamento. Aplica as invariantes de agregado (3.5) e a
   * unicidade global de identidade (3.7).
   */
  addDepartment(input: CreateDepartmentInput): RegistryResult<Department> {
    if (this.hasSubject(input.id)) {
      return fail('duplicate-id', `id ja utilizado no cadastro: ${input.id}`);
    }
    const built = createDepartment(input);
    if (!built.ok) return fromAggregate(built.error);

    const collision = this.checkIdentity(built.value.id, 'department', built.value);
    if (collision) return collision;

    this.departments.set(built.value.id, built.value);
    return ok(clone(built.value));
  }

  /**
   * Adiciona um afastamento a uma pessoa (3.3, 3.14). Falha preserva o estado.
   */
  addLeave(personId: Uuid, leave: LeavePeriod, now: string): RegistryResult<Person> {
    return this.mutatePerson(personId, (p) => addLeave(p, leave, now));
  }

  /**
   * Adiciona um vinculo a uma pessoa (3.4, 3.15). O destino do vinculo deve
   * existir no cadastro; caso contrario a operacao e rejeitada como referencia
   * invalida. Self-link, tipo desconhecido e duplicidade sao tratados pelo
   * agregado.
   */
  addLink(
    personId: Uuid,
    link: PersonLink,
    knownLinkTypeIds: ReadonlySet<Uuid>,
    now: string,
  ): RegistryResult<Person> {
    if (!this.people.has(link.otherPersonId)) {
      return fail('not-found', `vinculo referencia pessoa inexistente: ${link.otherPersonId}`);
    }
    return this.mutatePerson(personId, (p) => addLink(p, link, knownLinkTypeIds, now));
  }

  /**
   * Adiciona um alias a uma pessoa (3.1), reavaliando a unicidade global de
   * identidade (3.7) sobre o agregado resultante.
   */
  addAlias(personId: Uuid, alias: PersonAlias, now: string): RegistryResult<Person> {
    return this.mutatePerson(
      personId,
      (p) => addAlias(p, alias, now),
      (next) => this.checkIdentity(next.id, 'person', next),
    );
  }

  /** Define/remove o telefone de uma pessoa (3.8). */
  setPhone(personId: Uuid, phone: string | undefined, now: string): RegistryResult<Person> {
    return this.mutatePerson(personId, (p) => setPhone(p, phone, now));
  }

  /** Define os dias da semana permitidos de uma pessoa (3.2). */
  setAllowedWeekdays(
    personId: Uuid,
    days: readonly Weekday[],
    now: string,
  ): RegistryResult<Person> {
    return this.mutatePerson(personId, (p) => setAllowedWeekdays(p, days, now));
  }

  /**
   * Desativa uma Pessoa_Canonica (3.9): preserva atribuicoes, vinculos,
   * afastamentos e auditoria existentes (nenhum e removido) e marca o estado
   * como inativo. A restricao de novas atribuicoes e aplicada por
   * `isSelectable` / `selectablePersonIds`.
   */
  deactivatePerson(personId: Uuid, now: string): RegistryResult<Person> {
    const current = this.people.get(personId);
    if (!current) return fail('not-found', `pessoa inexistente: ${personId}`);
    const next = deactivatePerson(current, now);
    this.people.set(personId, next);
    return ok(clone(next));
  }

  /**
   * Exclui uma Pessoa_Canonica (3.13). A exclusao SO e permitida quando a
   * pessoa nao e referenciada por nenhuma outra fonte: vinculos de outras
   * pessoas, autorizacoes vigentes, ou referencias externas informadas por
   * `referencedExternally` (regras, escalas, historico). Caso contrario a
   * exclusao e bloqueada, o registro e preservado e a desativacao e a
   * alternativa indicada.
   */
  deletePerson(
    personId: Uuid,
    referencedExternally: ReferenceLookup = () => false,
  ): RegistryResult<Person> {
    const person = this.people.get(personId);
    if (!person) return fail('not-found', `pessoa inexistente: ${personId}`);

    if (this.isReferenced(personId, referencedExternally)) {
      return fail(
        'reference-protected',
        'exclusao bloqueada: a pessoa e referenciada por vinculos, regras, escalas ou historico; use a desativacao',
      );
    }

    this.people.delete(personId);
    // Autorizacoes do proprio sujeito deixam de ter alvo; sao removidas junto.
    for (const [id, auth] of this.authorizations) {
      if (auth.subjectId === personId) this.authorizations.delete(id);
    }
    return ok(clone(person));
  }

  // ---- Elegibilidade (restricao de novas atribuicoes, 3.9) -------------

  /** `true` quando a pessoa pode receber novas atribuicoes (ativa). */
  isSelectable(personId: Uuid): boolean {
    const p = this.people.get(personId);
    return p !== undefined && p.participation === 'active';
  }

  /** Ids de pessoas ativas, elegiveis a novas atribuicoes. */
  selectablePersonIds(): Uuid[] {
    return sortById([...this.people.values()].filter((p) => p.participation === 'active')).map(
      (p) => p.id,
    );
  }

  // ---- Autorizacoes publicas de contato (11.4, 11.15, 11.16) -----------

  /**
   * Registra uma autorizacao publica (11.4): sujeito, campo, valor (por hash),
   * finalidade, responsavel, vigencia e estado. O sujeito deve existir. A
   * autorizacao nasce com estado `active`. Tambem indexa o id no agregado de
   * pessoa quando o sujeito for uma pessoa.
   */
  registerAuthorization(input: RegisterAuthorizationInput): RegistryResult<PublicAuthorization> {
    if (!this.hasSubject(input.subjectId)) {
      return fail('not-found', `autorizacao referencia sujeito inexistente: ${input.subjectId}`);
    }
    if (this.authorizations.has(input.id)) {
      return fail('duplicate-id', `id de autorizacao ja utilizado: ${input.id}`);
    }
    if (input.validUntil !== undefined && input.validUntil < input.validFrom) {
      return fail('authorization-range', 'data final da autorizacao anterior a data inicial');
    }

    const auth: PublicAuthorization = {
      schemaVersion: SCHEMA_VERSION,
      id: input.id,
      subjectId: input.subjectId,
      field: input.field,
      valueHash: input.valueHash,
      purpose: input.purpose,
      approvedBy: input.approvedBy,
      validFrom: input.validFrom,
      ...(input.validUntil !== undefined ? { validUntil: input.validUntil } : {}),
      status: 'active',
      createdAt: input.now,
    };

    this.authorizations.set(auth.id, auth);
    this.indexAuthorizationOnPerson(auth);
    return ok(clone(auth));
  }

  /**
   * Revoga uma autorizacao (11.4: estado vigente/revogado). Falha preserva o
   * estado quando o id nao existe.
   */
  revokeAuthorization(authorizationId: Uuid): RegistryResult<PublicAuthorization> {
    const current = this.authorizations.get(authorizationId);
    if (!current) {
      return fail('authorization-not-found', `autorizacao inexistente: ${authorizationId}`);
    }
    if (current.status === 'revoked') return ok(clone(current));
    const next: PublicAuthorization = { ...current, status: 'revoked' };
    this.authorizations.set(authorizationId, next);
    return ok(clone(next));
  }

  /**
   * Decide se um valor (por hash) de um sujeito esta autorizado como
   * Dado_Publico para uma finalidade em um instante (11.15, 11.16).
   *
   * Uma autorizacao e vigente quando:
   *  - o sujeito, o campo, o hash do valor e a finalidade coincidem;
   *  - o estado e `active`;
   *  - `validFrom <= at` e (`validUntil` ausente OU `at <= validUntil`),
   *    vigencia inclusiva nas duas extremidades.
   *
   * Autorizacao ausente, expirada, revogada ou para valor/finalidade diferente
   * NAO autoriza (retorna `false`).
   */
  isPublicAuthorized(query: AuthorizationQuery): boolean {
    for (const auth of this.authorizations.values()) {
      if (
        auth.subjectId === query.subjectId &&
        auth.field === query.field &&
        auth.valueHash === query.valueHash &&
        auth.purpose === query.purpose &&
        auth.status === 'active' &&
        isWithinInclusive(query.at, auth.validFrom, auth.validUntil)
      ) {
        return true;
      }
    }
    return false;
  }

  /** Autorizacoes vigentes (ativas) de um sujeito em um instante. */
  activeAuthorizationsFor(subjectId: Uuid, at: string): PublicAuthorization[] {
    return sortById(
      [...this.authorizations.values()].filter(
        (a) =>
          a.subjectId === subjectId &&
          a.status === 'active' &&
          isWithinInclusive(at, a.validFrom, a.validUntil),
      ),
    ).map(clone);
  }

  // ---- Internos --------------------------------------------------------

  /** Verdadeiro se o id pertence a uma pessoa ou departamento. */
  private hasSubject(id: Uuid): boolean {
    return this.people.has(id) || this.departments.has(id);
  }

  /**
   * Aplica um comando puro de mutacao a uma pessoa. Garante not-found, aplica
   * a transformacao sobre uma copia e, opcionalmente, uma verificacao extra
   * (ex.: unicidade de identidade) antes de confirmar. Falha preserva o estado.
   */
  private mutatePerson(
    personId: Uuid,
    command: (p: Person) => AggregateResult<Person>,
    extraCheck?: (next: Person) => RegistryResult<Person> | null,
  ): RegistryResult<Person> {
    const current = this.people.get(personId);
    if (!current) return fail('not-found', `pessoa inexistente: ${personId}`);

    const result = command(clone(current));
    if (!result.ok) return fromAggregate(result.error);

    if (extraCheck) {
      const extra = extraCheck(result.value);
      if (extra && !extra.ok) return extra;
    }

    this.people.set(personId, result.value);
    return ok(clone(result.value));
  }

  /**
   * Verifica a unicidade global de identidade (3.7) considerando o cadastro
   * atual com o sujeito `subject` substituindo (ou adicionando) a entrada de
   * `subjectId`. Retorna uma falha quando ha colisao; `null` quando esta livre.
   */
  private checkIdentity(
    subjectId: Uuid,
    kind: 'person' | 'department',
    subject: Person | Department,
  ): RegistryResult<never> | null {
    const subjects: IdentitySubject[] = this.identitySubjectsExcept(subjectId);
    subjects.push(toIdentitySubject(subjectId, kind, subject));

    const collisions = findIdentityCollisions(subjects);
    // Apenas colisoes que envolvem o sujeito sob analise sao relevantes aqui;
    // o cadastro ja e consistente para os demais.
    const relevant = collisions.filter(
      (c) => c.existing.subjectId === subjectId || c.incoming.subjectId === subjectId,
    );
    if (relevant.length > 0) {
      return fail(
        'identity-collision',
        'nome canonico ou alias coincide com outro registro do cadastro',
        relevant,
      );
    }
    return null;
  }

  /** Sujeitos de identidade de todo o cadastro, exceto o id informado. */
  private identitySubjectsExcept(exceptId: Uuid): IdentitySubject[] {
    const subjects: IdentitySubject[] = [];
    for (const p of this.people.values()) {
      if (p.id === exceptId) continue;
      subjects.push(toIdentitySubject(p.id, 'person', p));
    }
    for (const d of this.departments.values()) {
      if (d.id === exceptId) continue;
      subjects.push(toIdentitySubject(d.id, 'department', d));
    }
    return subjects;
  }

  /**
   * Verdadeiro se a pessoa e referenciada por vinculos de outras pessoas,
   * autorizacoes vigentes OU referencias externas informadas (3.13).
   */
  private isReferenced(personId: Uuid, referencedExternally: ReferenceLookup): boolean {
    for (const p of this.people.values()) {
      if (p.id === personId) continue;
      if (p.links.some((l) => l.otherPersonId === personId)) return true;
    }
    for (const a of this.authorizations.values()) {
      if (a.subjectId === personId && a.status === 'active') return true;
    }
    return referencedExternally(personId);
  }

  /** Mantem o indice `publicContactAuthorizationIds` do agregado de pessoa. */
  private indexAuthorizationOnPerson(auth: PublicAuthorization): void {
    const person = this.people.get(auth.subjectId);
    if (!person) return;
    if (person.publicContactAuthorizationIds.includes(auth.id)) return;
    this.people.set(auth.subjectId, {
      ...person,
      publicContactAuthorizationIds: [...person.publicContactAuthorizationIds, auth.id],
    });
  }
}

// --------------------------------------------------------------------------
// Auxiliares puros
// --------------------------------------------------------------------------

function toIdentitySubject(
  id: Uuid,
  kind: 'person' | 'department',
  subject: Person | Department,
): IdentitySubject {
  return {
    id,
    kind,
    canonicalName: subject.canonicalName,
    aliases: subject.aliases.map((a) => a.value),
  };
}

/** Vigencia inclusiva: `from <= at <= until` (until ausente => sem limite). */
function isWithinInclusive(at: string, from: string, until?: string): boolean {
  if (at < from) return false;
  if (until !== undefined && at > until) return false;
  return true;
}

function sortById<T extends { id: Uuid }>(items: T[]): T[] {
  return [...items].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Copia profunda segura para os modelos de dados (JSON-serializaveis). */
function clone<T>(value: T): T {
  return structuredClone(value);
}
