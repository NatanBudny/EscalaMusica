// Namespace de identidade do Cadastro_Central.
//
// TypeScript puro, sem I/O. Define a normalizacao de nomes/aliases e a chave
// canonica de identidade usada para garantir unicidade global entre
// Pessoas_Canonicas e Departamentos.
//
// Regras (design.md, secao "Data Models" e requisitos 3.6 e 3.7):
//  - Normalizacao de exibicao (requisito 3.6): remover espacos nas
//    extremidades, colapsar cada sequencia interna de espacos em um unico
//    espaco e preservar as demais letras e sinais informados.
//  - Chave de identidade (requisito 3.7): `trim + colapso de espacos +
//    casefold Unicode`. A comparacao e sem distincao entre maiusculas e
//    minusculas. A chave decide identidade; o valor de exibicao nao e alterado
//    alem da normalizacao.
//
// O namespace de identidade e GLOBAL: nomes canonicos e aliases de pessoas e
// departamentos compartilham o mesmo espaco. Nenhum sujeito pode ter uma chave
// de identidade que colida com a de outro sujeito.

/** Caractere de espaco horizontal usado para colapso (ASCII + Unicode comuns). */
// Inclui espaco comum, tabulacao, quebras e espacos Unicode (NBSP, etc.).
const WHITESPACE_RUN = /\s+/gu;

/**
 * Normaliza um nome ou alias para exibicao (requisito 3.6).
 *
 * - Remove espacos no inicio e no fim.
 * - Substitui cada sequencia interna de espacos por um unico espaco comum.
 * - Preserva as demais letras e sinais (nao remove diacriticos nem pontuacao).
 *
 * A operacao e idempotente: `normalizeName(normalizeName(x))` equivale a
 * `normalizeName(x)`.
 */
export function normalizeName(value: string): string {
  return value.replace(WHITESPACE_RUN, ' ').trim();
}

/**
 * Chave canonica de identidade (requisito 3.7).
 *
 * Aplica a normalizacao de exibicao e, em seguida, o casefold Unicode para
 * tornar a comparacao insensivel a maiusculas/minusculas. A normalizacao de
 * forma Unicode (NFC) garante que sequencias equivalentes de combinacao
 * produzam a mesma chave.
 *
 * A chave serve exclusivamente para decidir identidade/colisao; ela nao
 * substitui o valor exibido.
 */
export function identityKey(value: string): string {
  // NFC primeiro para unificar formas compostas/decompostas equivalentes.
  const normalized = normalizeName(value.normalize('NFC'));
  // `toLocaleLowerCase` sem locale usa o casefold padrao do runtime; para o
  // namespace de identidade usamos o casefold independente de locale.
  return normalized.toLowerCase();
}

/**
 * Sujeito do namespace de identidade. Pode ser uma Pessoa_Canonica ou um
 * Departamento. Cada sujeito contribui com seu nome canonico e seus aliases.
 */
export interface IdentitySubject {
  /** Identificador estavel do sujeito (UUID). */
  readonly id: string;
  /** Tipo do sujeito no namespace compartilhado. */
  readonly kind: 'person' | 'department';
  /** Nome canonico (ja normalizado ou nao; a chave e derivada aqui). */
  readonly canonicalName: string;
  /** Aliases do sujeito. */
  readonly aliases: readonly string[];
}

/** Um rotulo (nome canonico ou alias) de um sujeito, com sua chave. */
export interface IdentityLabel {
  readonly subjectId: string;
  readonly kind: 'person' | 'department';
  readonly role: 'canonicalName' | 'alias';
  readonly value: string;
  readonly key: string;
}

/** Descreve uma colisao entre dois rotulos distintos no namespace. */
export interface IdentityCollision {
  readonly key: string;
  readonly existing: IdentityLabel;
  readonly incoming: IdentityLabel;
}

/**
 * Enumera todos os rotulos (nome canonico + aliases) de um sujeito, cada um
 * com sua chave de identidade.
 */
export function subjectLabels(subject: IdentitySubject): IdentityLabel[] {
  const labels: IdentityLabel[] = [
    {
      subjectId: subject.id,
      kind: subject.kind,
      role: 'canonicalName',
      value: subject.canonicalName,
      key: identityKey(subject.canonicalName),
    },
  ];
  for (const alias of subject.aliases) {
    labels.push({
      subjectId: subject.id,
      kind: subject.kind,
      role: 'alias',
      value: alias,
      key: identityKey(alias),
    });
  }
  return labels;
}

/**
 * Indice do namespace de identidade: mapeia cada chave para o rotulo que a
 * ocupa. Rotulos do mesmo sujeito com a mesma chave (p.ex. alias igual ao nome
 * canonico) nao sao colisao de identidade entre sujeitos distintos, mas ainda
 * assim representam duplicidade interna; o construtor os reporta.
 */
export class IdentityNamespace {
  private readonly byKey = new Map<string, IdentityLabel>();

  /**
   * Constroi um namespace a partir de uma colecao de sujeitos. Retorna o
   * namespace e as colisoes detectadas. Quando ha colisoes, elas identificam
   * o rotulo existente e o rotulo conflitante.
   */
  static build(subjects: readonly IdentitySubject[]): {
    namespace: IdentityNamespace;
    collisions: IdentityCollision[];
  } {
    const namespace = new IdentityNamespace();
    const collisions: IdentityCollision[] = [];

    for (const subject of subjects) {
      for (const label of subjectLabels(subject)) {
        const existing = namespace.byKey.get(label.key);
        if (existing !== undefined) {
          // Colisao entre dois rotulos distintos (podem ser do mesmo sujeito,
          // p.ex. alias duplicado, ou de sujeitos diferentes).
          collisions.push({ key: label.key, existing, incoming: label });
          continue;
        }
        namespace.byKey.set(label.key, label);
      }
    }

    return { namespace, collisions };
  }

  /** `true` quando a chave ja esta ocupada no namespace. */
  has(key: string): boolean {
    return this.byKey.has(key);
  }

  /** Rotulo que ocupa a chave, ou `undefined`. */
  get(key: string): IdentityLabel | undefined {
    return this.byKey.get(key);
  }

  /** Quantidade de chaves ocupadas. */
  get size(): number {
    return this.byKey.size;
  }

  /** Lista imutavel de todos os rotulos indexados. */
  labels(): IdentityLabel[] {
    return [...this.byKey.values()];
  }
}

/** Resultado de uma tentativa de introduzir um sujeito no namespace. */
export type InsertResult =
  | { ok: true; subjects: readonly IdentitySubject[] }
  | { ok: false; collisions: IdentityCollision[]; subjects: readonly IdentitySubject[] };

/**
 * Tenta adicionar um novo sujeito ao cadastro, preservando a unicidade global.
 *
 * Comportamento (requisito 3.7):
 *  - Se o novo sujeito nao introduz nenhuma colisao com os sujeitos
 *    existentes nem internamente (alias duplicado entre seus proprios
 *    rotulos), a insercao e aceita e retorna o novo cadastro.
 *  - Se qualquer rotulo do novo sujeito colidir (sem distincao de
 *    maiusculas/minusculas) com um rotulo ja presente, a insercao FALHA, o
 *    cadastro anterior e preservado sem alteracao e as colisoes sao
 *    reportadas.
 *
 * Esta funcao e pura: nunca muta `existing`.
 */
export function tryInsertSubject(
  existing: readonly IdentitySubject[],
  incoming: IdentitySubject,
): InsertResult {
  const { namespace } = IdentityNamespace.build(existing);
  const collisions: IdentityCollision[] = [];
  const seenInIncoming = new Map<string, IdentityLabel>();

  for (const label of subjectLabels(incoming)) {
    const existingLabel = namespace.get(label.key);
    if (existingLabel !== undefined) {
      collisions.push({ key: label.key, existing: existingLabel, incoming: label });
      continue;
    }
    const internal = seenInIncoming.get(label.key);
    if (internal !== undefined) {
      // Duplicidade dentro do proprio sujeito (p.ex. alias == nome canonico).
      collisions.push({ key: label.key, existing: internal, incoming: label });
      continue;
    }
    seenInIncoming.set(label.key, label);
  }

  if (collisions.length > 0) {
    // Preserva integralmente o cadastro anterior.
    return { ok: false, collisions, subjects: existing };
  }

  return { ok: true, subjects: [...existing, incoming] };
}

/**
 * Verifica se uma colecao de sujeitos ja satisfaz a unicidade global do
 * namespace. Retorna a lista de colisoes (vazia quando o namespace e unico).
 */
export function findIdentityCollisions(
  subjects: readonly IdentitySubject[],
): IdentityCollision[] {
  return IdentityNamespace.build(subjects).collisions;
}

/** `true` quando nenhum rotulo colide no namespace global. */
export function isIdentityNamespaceUnique(subjects: readonly IdentitySubject[]): boolean {
  return findIdentityCollisions(subjects).length === 0;
}
