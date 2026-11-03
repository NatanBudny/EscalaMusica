// Busca de sujeitos do cadastro por nome canonico ou alias.
//
// A busca usa a mesma normalizacao de identidade do dominio (trim + colapso de
// espacos + casefold), de modo que a UI encontre registros sem distincao de
// maiusculas/minusculas nem de espacos repetidos, coerente com a unicidade
// global de identidade (requisito 3.7) e com a busca por nome/alias prevista
// para a montagem (requisito 5.3).

import { identityKey } from '../../domain/registry/identity';
import type { Department, Person } from '../../domain/schemas/models';

export type SubjectKind = 'person' | 'department';

/** Linha de exibicao de um sujeito na grade de cadastro. */
export interface SubjectRow {
  id: string;
  kind: SubjectKind;
  canonicalName: string;
  aliases: string[];
  /** Estado de participacao (pessoa) ou status (departamento). */
  active: boolean;
  phoneE164?: string;
}

export function personToRow(person: Person): SubjectRow {
  return {
    id: person.id,
    kind: 'person',
    canonicalName: person.canonicalName,
    aliases: person.aliases.map((a) => a.value),
    active: person.participation === 'active',
    ...(person.phoneE164 !== undefined ? { phoneE164: person.phoneE164 } : {}),
  };
}

export function departmentToRow(department: Department): SubjectRow {
  return {
    id: department.id,
    kind: 'department',
    canonicalName: department.canonicalName,
    aliases: department.aliases.map((a) => a.value),
    active: department.status === 'active',
  };
}

/**
 * `true` quando o nome canonico OU um dos aliases do sujeito contem o termo
 * buscado (comparacao por chave de identidade, insensivel a caixa/espacos).
 * Um termo vazio corresponde a todos os sujeitos.
 */
export function matchesQuery(row: SubjectRow, query: string): boolean {
  const key = identityKey(query);
  if (key.length === 0) return true;
  const haystacks = [row.canonicalName, ...row.aliases];
  return haystacks.some((value) => identityKey(value).includes(key));
}

/**
 * Filtra e ordena as linhas por nome canonico (ordem estavel e previsivel para
 * a navegacao por teclado). A ordenacao usa a chave de identidade para evitar
 * surpresas de caixa.
 */
export function filterSubjects(rows: readonly SubjectRow[], query: string): SubjectRow[] {
  return rows
    .filter((row) => matchesQuery(row, query))
    .sort((a, b) => {
      const ka = identityKey(a.canonicalName);
      const kb = identityKey(b.canonicalName);
      if (ka < kb) return -1;
      if (ka > kb) return 1;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
}
