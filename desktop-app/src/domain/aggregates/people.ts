// Comandos puros de construcao e mutacao dos agregados de Pessoa_Canonica e
// Departamento (design.md, secao "Components and Interfaces" -> RegistryService,
// e "Data Models").
//
// Estas funcoes sao PURAS: nao fazem I/O, nao mutam a entrada e sao
// deterministicas. Elas aplicam as invariantes do dominio ANTES de produzir o
// agregado resultante. Quando um comando viola uma invariante, o resultado e
// uma falha tipada (`Err`) e o agregado anterior permanece inalterado.
//
// Invariantes aplicadas (requisitos 3.1-3.5, 3.8, 3.14, 3.15):
//  - 3.1  nome canonico 1-120; no maximo 20 aliases de 1-120 cada; no maximo
//         um telefone; estado ativo|inativo; habilitacoes sem duplicidade.
//  - 3.2  0 a 7 dias da semana permitidos, sem duplicidade.
//  - 3.3  no maximo 1.000 afastamentos; cada um com data inicial obrigatoria e
//         data final opcional >= data inicial.
//  - 3.4  no maximo 50 vinculos vigentes; cada um com tipo previsto pelo
//         conjunto de regras ativo e referencia a OUTRA pessoa.
//  - 3.5  Departamento: id estavel, nome canonico 1-120, no maximo 20 aliases,
//         estado ativo|inativo.
//  - 3.8  telefone comeca por '+' seguido de 8 a 15 algarismos.
//  - 3.14 data final de afastamento anterior a inicial OU exceder 1.000
//         afastamentos e rejeitado, preservando os existentes.
//  - 3.15 self-link, vinculo duplicado do mesmo tipo ou tipo desconhecido e
//         rejeitado, preservando os vinculos existentes.
//
// O ID de cada agregado NUNCA muda apos a criacao: nenhuma funcao de mutacao
// aceita alterar `id`.

import { SCHEMA_VERSION } from '../schemas/models';
import type {
  Department,
  LeavePeriod,
  Person,
  PersonAlias,
  PersonLink,
  Uuid,
  Weekday,
} from '../schemas/models';

// --------------------------------------------------------------------------
// Resultado tipado
// --------------------------------------------------------------------------

export type AggregateErrorCode =
  | 'canonical-name-length'
  | 'alias-count'
  | 'alias-length'
  | 'phone-format'
  | 'participation-invalid'
  | 'capability-duplicate'
  | 'weekday-count'
  | 'weekday-duplicate'
  | 'leave-count'
  | 'leave-range'
  | 'link-count'
  | 'link-self'
  | 'link-duplicate'
  | 'link-unknown-type';

export interface AggregateError {
  code: AggregateErrorCode;
  /** Mensagem legivel em portugues. */
  message: string;
}

export type AggregateResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: AggregateError };

const ok = <T>(value: T): AggregateResult<T> => ({ ok: true, value });
const err = <T>(code: AggregateErrorCode, message: string): AggregateResult<T> => ({
  ok: false,
  error: { code, message },
});

// --------------------------------------------------------------------------
// Limites do dominio
// --------------------------------------------------------------------------

export const LIMITS = {
  nameMin: 1,
  nameMax: 120,
  aliasMax: 20,
  aliasMin: 1,
  weekdayMax: 7,
  leaveMax: 1000,
  linkMax: 50,
  phoneMin: 8,
  phoneMax: 15,
} as const;

const WEEKDAYS: readonly Weekday[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];

const PHONE_RE = /^\+[0-9]{8,15}$/;

// --------------------------------------------------------------------------
// Validadores de campo isolados (reutilizados por pessoa e departamento)
// --------------------------------------------------------------------------

function checkCanonicalName(name: string): AggregateError | null {
  if (name.length < LIMITS.nameMin || name.length > LIMITS.nameMax) {
    return {
      code: 'canonical-name-length',
      message: `nome canonico deve ter de ${LIMITS.nameMin} a ${LIMITS.nameMax} caracteres`,
    };
  }
  return null;
}

function checkAliases(aliases: readonly PersonAlias[]): AggregateError | null {
  if (aliases.length > LIMITS.aliasMax) {
    return {
      code: 'alias-count',
      message: `no maximo ${LIMITS.aliasMax} aliases`,
    };
  }
  for (const a of aliases) {
    if (a.value.length < LIMITS.aliasMin || a.value.length > LIMITS.nameMax) {
      return {
        code: 'alias-length',
        message: `cada alias deve ter de ${LIMITS.aliasMin} a ${LIMITS.nameMax} caracteres`,
      };
    }
  }
  return null;
}

function checkPhone(phone: string | undefined): AggregateError | null {
  if (phone === undefined) return null;
  if (!PHONE_RE.test(phone)) {
    return {
      code: 'phone-format',
      message: `telefone deve comecar por '+' seguido de ${LIMITS.phoneMin} a ${LIMITS.phoneMax} algarismos`,
    };
  }
  return null;
}

function checkParticipation(p: unknown): AggregateError | null {
  if (p !== 'active' && p !== 'inactive') {
    return { code: 'participation-invalid', message: "estado deve ser 'active' ou 'inactive'" };
  }
  return null;
}

function checkCapabilities(ids: readonly Uuid[]): AggregateError | null {
  if (new Set(ids).size !== ids.length) {
    return { code: 'capability-duplicate', message: 'habilitacao duplicada' };
  }
  return null;
}

function checkWeekdays(days: readonly Weekday[]): AggregateError | null {
  if (days.length > LIMITS.weekdayMax) {
    return { code: 'weekday-count', message: `no maximo ${LIMITS.weekdayMax} dias da semana` };
  }
  if (new Set(days).size !== days.length) {
    return { code: 'weekday-duplicate', message: 'dia da semana duplicado' };
  }
  for (const d of days) {
    if (!WEEKDAYS.includes(d)) {
      return { code: 'weekday-duplicate', message: `dia da semana invalido: ${String(d)}` };
    }
  }
  return null;
}

function checkLeaves(leaves: readonly LeavePeriod[]): AggregateError | null {
  if (leaves.length > LIMITS.leaveMax) {
    return { code: 'leave-count', message: `no maximo ${LIMITS.leaveMax} afastamentos` };
  }
  for (const l of leaves) {
    if (l.end !== undefined && l.end < l.start) {
      return {
        code: 'leave-range',
        message: 'data final do afastamento anterior a data inicial',
      };
    }
  }
  return null;
}

/**
 * Valida os vinculos de uma pessoa. `selfId` e o id da propria pessoa (para
 * detectar self-link) e `knownLinkTypeIds` e o conjunto de tipos previstos
 * pelo conjunto de regras ativo.
 */
function checkLinks(
  links: readonly PersonLink[],
  selfId: Uuid,
  knownLinkTypeIds: ReadonlySet<Uuid>,
): AggregateError | null {
  if (links.length > LIMITS.linkMax) {
    return { code: 'link-count', message: `no maximo ${LIMITS.linkMax} vinculos vigentes` };
  }
  const seen = new Set<string>();
  for (const l of links) {
    if (l.otherPersonId === selfId) {
      return { code: 'link-self', message: 'vinculo referencia a propria pessoa (self-link)' };
    }
    if (!knownLinkTypeIds.has(l.typeId)) {
      return {
        code: 'link-unknown-type',
        message: `tipo de vinculo ausente do conjunto de regras ativo: ${l.typeId}`,
      };
    }
    // Duplicidade: mesmo tipo de vinculo vigente para a mesma pessoa de destino.
    const key = `${l.typeId}::${l.otherPersonId}`;
    if (seen.has(key)) {
      return {
        code: 'link-duplicate',
        message: 'vinculo duplicado do mesmo tipo para a mesma pessoa',
      };
    }
    seen.add(key);
  }
  return null;
}

// --------------------------------------------------------------------------
// Entradas dos comandos
// --------------------------------------------------------------------------

export interface CreatePersonInput {
  id: Uuid;
  legacyId?: number;
  canonicalName: string;
  aliases?: PersonAlias[];
  phoneE164?: string;
  participation?: 'active' | 'inactive';
  publicContactAuthorizationIds?: Uuid[];
  capabilityIds?: Uuid[];
  allowedWeekdays?: Weekday[];
  leaves?: LeavePeriod[];
  links?: PersonLink[];
  administrativeNotes?: string;
  now: string;
  /** Tipos de vinculo previstos pelo conjunto de regras ativo. */
  knownLinkTypeIds?: readonly Uuid[];
}

export interface CreateDepartmentInput {
  id: Uuid;
  legacyId?: number;
  canonicalName: string;
  aliases?: PersonAlias[];
  status?: 'active' | 'inactive';
  now: string;
}

// --------------------------------------------------------------------------
// Construcao
// --------------------------------------------------------------------------

/**
 * Cria uma Pessoa_Canonica aplicando todas as invariantes. O `id` informado
 * torna-se imutavel; nenhuma mutacao futura o altera.
 */
export function createPerson(input: CreatePersonInput): AggregateResult<Person> {
  const aliases = input.aliases ?? [];
  const participation = input.participation ?? 'active';
  const capabilityIds = input.capabilityIds ?? [];
  const allowedWeekdays = input.allowedWeekdays ?? [];
  const leaves = input.leaves ?? [];
  const links = input.links ?? [];
  const knownLinkTypeIds = new Set(input.knownLinkTypeIds ?? links.map((l) => l.typeId));

  const checks = [
    checkCanonicalName(input.canonicalName),
    checkAliases(aliases),
    checkPhone(input.phoneE164),
    checkParticipation(participation),
    checkCapabilities(capabilityIds),
    checkWeekdays(allowedWeekdays),
    checkLeaves(leaves),
    checkLinks(links, input.id, knownLinkTypeIds),
  ];
  for (const c of checks) {
    if (c) return { ok: false, error: c };
  }

  const person: Person = {
    schemaVersion: SCHEMA_VERSION,
    id: input.id,
    ...(input.legacyId !== undefined ? { legacyId: input.legacyId } : {}),
    canonicalName: input.canonicalName,
    aliases: [...aliases],
    ...(input.phoneE164 !== undefined ? { phoneE164: input.phoneE164 } : {}),
    participation,
    publicContactAuthorizationIds: [...(input.publicContactAuthorizationIds ?? [])],
    capabilityIds: [...capabilityIds],
    allowedWeekdays: [...allowedWeekdays],
    leaves: leaves.map((l) => ({ ...l })),
    links: links.map((l) => ({ ...l })),
    ...(input.administrativeNotes !== undefined
      ? { administrativeNotes: input.administrativeNotes }
      : {}),
    createdAt: input.now,
    updatedAt: input.now,
  };
  return ok(person);
}

/** Cria um Departamento aplicando as invariantes do requisito 3.5. */
export function createDepartment(input: CreateDepartmentInput): AggregateResult<Department> {
  const aliases = input.aliases ?? [];
  const status = input.status ?? 'active';

  const nameErr = checkCanonicalName(input.canonicalName);
  if (nameErr) return { ok: false, error: nameErr };
  const aliasErr = checkAliases(aliases);
  if (aliasErr) return { ok: false, error: aliasErr };
  if (status !== 'active' && status !== 'inactive') {
    return err('participation-invalid', "estado deve ser 'active' ou 'inactive'");
  }

  const department: Department = {
    schemaVersion: SCHEMA_VERSION,
    id: input.id,
    ...(input.legacyId !== undefined ? { legacyId: input.legacyId } : {}),
    canonicalName: input.canonicalName,
    aliases: [...aliases],
    status,
    createdAt: input.now,
    updatedAt: input.now,
  };
  return ok(department);
}

// --------------------------------------------------------------------------
// Mutacao (nao altera a entrada; preserva o anterior em caso de falha)
// --------------------------------------------------------------------------

/** Adiciona um afastamento, aplicando limite de 1.000 e coerencia de datas. */
export function addLeave(
  person: Person,
  leave: LeavePeriod,
  now: string,
): AggregateResult<Person> {
  const next = [...person.leaves, leave];
  const e = checkLeaves(next);
  if (e) return { ok: false, error: e };
  return ok({ ...person, leaves: next.map((l) => ({ ...l })), updatedAt: now });
}

/**
 * Adiciona um vinculo, aplicando limite de 50, rejeicao de self-link, tipo
 * desconhecido e duplicidade do mesmo tipo.
 */
export function addLink(
  person: Person,
  link: PersonLink,
  knownLinkTypeIds: ReadonlySet<Uuid>,
  now: string,
): AggregateResult<Person> {
  const next = [...person.links, link];
  const e = checkLinks(next, person.id, knownLinkTypeIds);
  if (e) return { ok: false, error: e };
  return ok({ ...person, links: next.map((l) => ({ ...l })), updatedAt: now });
}

/** Adiciona um alias, aplicando limite de 20 e comprimento 1-120. */
export function addAlias(
  person: Person,
  alias: PersonAlias,
  now: string,
): AggregateResult<Person> {
  const next = [...person.aliases, alias];
  const e = checkAliases(next);
  if (e) return { ok: false, error: e };
  return ok({ ...person, aliases: next.map((a) => ({ ...a })), updatedAt: now });
}

/** Define o telefone (ou o remove quando `phone` e undefined). */
export function setPhone(
  person: Person,
  phone: string | undefined,
  now: string,
): AggregateResult<Person> {
  const e = checkPhone(phone);
  if (e) return { ok: false, error: e };
  const next: Person = { ...person, updatedAt: now };
  if (phone === undefined) {
    delete (next as { phoneE164?: string }).phoneE164;
  } else {
    next.phoneE164 = phone;
  }
  return ok(next);
}

/** Define os dias da semana permitidos, aplicando limite 0-7 e unicidade. */
export function setAllowedWeekdays(
  person: Person,
  days: readonly Weekday[],
  now: string,
): AggregateResult<Person> {
  const e = checkWeekdays(days);
  if (e) return { ok: false, error: e };
  return ok({ ...person, allowedWeekdays: [...days], updatedAt: now });
}

/** Desativa a pessoa (estado inativo), preservando o restante do agregado. */
export function deactivatePerson(person: Person, now: string): Person {
  return { ...person, participation: 'inactive', updatedAt: now };
}
