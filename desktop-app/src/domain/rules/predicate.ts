// DSL declarativa limitada de predicados das regras (design.md -> "Data
// Models" -> "A linguagem de predicados sera declarativa, versionada e limitada
// a operacoes conhecidas. Nao aceitara JavaScript, expressoes de shell ou
// codigo arbitrario."; "Limites e seguranca de entrada" -> "A DSL de regras
// nao executa codigo arbitrario.").
//
// TypeScript puro, sem I/O, deterministico. Este modulo define:
//   - a forma estrutural de um `RulePredicate` (op + args), reusando o modelo
//     de `schemas/models.ts` sem criar um modelo paralelo;
//   - o CONJUNTO FECHADO de operacoes conhecidas (OPERATOR_TABLE);
//   - a compilacao/validacao de um predicado (arity, tipos, operacoes
//     conhecidas e referencias a campos/variaveis conhecidos);
//   - a avaliacao pura de um predicado sobre um contexto imutavel.
//
// NENHUMA operacao executa codigo arbitrario: nao ha `eval`, acesso a funcoes,
// a `globalThis`, a propriedades fora da allowlist de campos, nem invocacao
// dinamica. A unica forma de "logica" e a composicao das operacoes fechadas
// abaixo (and/or/not/comparadores/pertinencia/consultas de campo).

import type { RulePredicate } from '../schemas/models';

export type { RulePredicate };

// --------------------------------------------------------------------------
// Operacoes conhecidas (conjunto fechado)
// --------------------------------------------------------------------------

/**
 * Nomes das operacoes suportadas pela DSL. Qualquer `op` fora desta lista e um
 * predicado invalido (design.md: conjunto fechado de operacoes conhecidas).
 *
 *  Logicas (args sao predicados):
 *   - `and`   : conjuncao de zero+ predicados (vazio => verdadeiro)
 *   - `or`    : disjuncao de zero+ predicados (vazio => falso)
 *   - `not`   : negacao de exatamente um predicado
 *   - `true`  : constante verdadeira (sem args)
 *   - `false` : constante falsa (sem args)
 *
 *  Comparacao (args: [RefOrLiteral, RefOrLiteral]):
 *   - `eq`    : igualdade estrita de escalares (string|number|boolean)
 *   - `ne`    : diferenca estrita de escalares
 *   - `lt`,`le`,`gt`,`ge` : ordem entre escalares comparaveis (number|string)
 *
 *  Pertinencia:
 *   - `in`      : [RefOrLiteral, literal-array] — escalar pertence ao conjunto
 *   - `includes`: [field-list, RefOrLiteral]    — lista contem o escalar
 *
 *  Consulta (somente leitura sobre o contexto; nunca executa codigo):
 *   - `field`   : [path:string] — le um campo conhecido do contexto
 *   - `has`     : [path:string] — campo conhecido existe e nao e nulo
 */
export type OperatorName =
  | 'and'
  | 'or'
  | 'not'
  | 'true'
  | 'false'
  | 'eq'
  | 'ne'
  | 'lt'
  | 'le'
  | 'gt'
  | 'ge'
  | 'in'
  | 'includes'
  | 'field'
  | 'has';

/** Categoria do argumento esperado por uma operacao. */
export type ArgKind = 'predicate' | 'term' | 'literal-array' | 'path';

interface OperatorSpec {
  /** Aridade minima (inclusive). */
  readonly minArgs: number;
  /** Aridade maxima (inclusive). `Infinity` para variadica. */
  readonly maxArgs: number;
  /**
   * Tipo esperado de cada argumento pela posicao. Para operacoes variadicas
   * (`and`/`or`), descreve o tipo de TODOS os argumentos.
   */
  readonly argKinds: readonly ArgKind[];
  /** `true` quando `argKinds[0]` descreve todos os args (variadica). */
  readonly variadic: boolean;
  /** Categoria do valor retornado: booleano (predicado) ou termo. */
  readonly returns: 'boolean' | 'term';
}

/** Tabela imutavel das operacoes conhecidas. */
export const OPERATOR_TABLE: Readonly<Record<OperatorName, OperatorSpec>> = {
  and: {
    minArgs: 0,
    maxArgs: Infinity,
    argKinds: ['predicate'],
    variadic: true,
    returns: 'boolean',
  },
  or: {
    minArgs: 0,
    maxArgs: Infinity,
    argKinds: ['predicate'],
    variadic: true,
    returns: 'boolean',
  },
  not: { minArgs: 1, maxArgs: 1, argKinds: ['predicate'], variadic: false, returns: 'boolean' },
  true: { minArgs: 0, maxArgs: 0, argKinds: [], variadic: false, returns: 'boolean' },
  false: { minArgs: 0, maxArgs: 0, argKinds: [], variadic: false, returns: 'boolean' },
  eq: { minArgs: 2, maxArgs: 2, argKinds: ['term', 'term'], variadic: false, returns: 'boolean' },
  ne: { minArgs: 2, maxArgs: 2, argKinds: ['term', 'term'], variadic: false, returns: 'boolean' },
  lt: { minArgs: 2, maxArgs: 2, argKinds: ['term', 'term'], variadic: false, returns: 'boolean' },
  le: { minArgs: 2, maxArgs: 2, argKinds: ['term', 'term'], variadic: false, returns: 'boolean' },
  gt: { minArgs: 2, maxArgs: 2, argKinds: ['term', 'term'], variadic: false, returns: 'boolean' },
  ge: { minArgs: 2, maxArgs: 2, argKinds: ['term', 'term'], variadic: false, returns: 'boolean' },
  in: {
    minArgs: 2,
    maxArgs: 2,
    argKinds: ['term', 'literal-array'],
    variadic: false,
    returns: 'boolean',
  },
  includes: {
    minArgs: 2,
    maxArgs: 2,
    argKinds: ['path', 'term'],
    variadic: false,
    returns: 'boolean',
  },
  field: { minArgs: 1, maxArgs: 1, argKinds: ['path'], variadic: false, returns: 'term' },
  has: { minArgs: 1, maxArgs: 1, argKinds: ['path'], variadic: false, returns: 'boolean' },
};

/** `true` quando `op` e uma operacao conhecida da DSL. */
export function isKnownOperator(op: string): op is OperatorName {
  return Object.prototype.hasOwnProperty.call(OPERATOR_TABLE, op);
}

// --------------------------------------------------------------------------
// Termo: referencia de campo ou literal
// --------------------------------------------------------------------------

/** Valor escalar admitido como literal/resultado de termo. */
export type Scalar = string | number | boolean;

/**
 * Um "termo" e um `RulePredicate` cuja `op` retorna um termo (`field`) ou um
 * literal embrulhado. Para manter a estrutura homogenea com `RulePredicate`,
 * literais sao representados por `{ op: 'lit', args: [valor] }`.
 *
 * `lit` NAO esta na OPERATOR_TABLE porque nao e um predicado booleano; e um
 * termo puro. A validacao/avaliacao tratam `lit` explicitamente onde um termo
 * e esperado.
 */
export const LIT_OP = 'lit' as const;

/** Constroi um literal-termo. */
export function lit(value: Scalar): RulePredicate {
  return { op: LIT_OP, args: [value] };
}

/** Constroi uma referencia de campo. */
export function field(path: string): RulePredicate {
  return { op: 'field', args: [path] };
}

// --------------------------------------------------------------------------
// Validacao (compilacao) do predicado
// --------------------------------------------------------------------------

/** Erro estrutural/semantico encontrado ao validar um predicado. */
export interface PredicateIssue {
  /** Caminho JSON-pointer-like dentro do predicado (ex.: `args[0].args[1]`). */
  readonly at: string;
  /** Codigo estavel do problema. */
  readonly code:
    | 'unknown-operator'
    | 'arity'
    | 'expected-predicate'
    | 'expected-term'
    | 'expected-path'
    | 'expected-literal-array'
    | 'unknown-field'
    | 'malformed';
  /** Mensagem legivel em portugues. */
  readonly message: string;
}

export interface ValidatePredicateOptions {
  /**
   * Allowlist de caminhos de campo conhecidos (ex.: `service.weekday`,
   * `assignment.roleId`). Uma referencia a um campo fora desta lista e uma
   * "referencia ausente" (design.md: ativacao detecta referencias ausentes).
   * Quando ausente, qualquer caminho string e aceito estruturalmente.
   */
  readonly knownFields?: ReadonlySet<string>;
}

/**
 * Valida (compila) um predicado contra o conjunto fechado de operacoes e,
 * quando fornecida, a allowlist de campos conhecidos. Retorna a lista de
 * problemas; vazia quando o predicado e valido. Funcao pura.
 */
export function validatePredicate(
  predicate: unknown,
  options: ValidatePredicateOptions = {},
): PredicateIssue[] {
  const issues: PredicateIssue[] = [];
  validateNode(predicate, 'root', 'boolean', options, issues);
  return issues;
}

/** `true` quando o predicado nao tem nenhum problema de validacao. */
export function isValidPredicate(
  predicate: unknown,
  options: ValidatePredicateOptions = {},
): boolean {
  return validatePredicate(predicate, options).length === 0;
}

function validateNode(
  node: unknown,
  at: string,
  expect: 'boolean' | 'term',
  options: ValidatePredicateOptions,
  issues: PredicateIssue[],
): void {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) {
    issues.push({ at, code: 'malformed', message: 'predicado deve ser um objeto { op, args? }' });
    return;
  }
  const rec = node as { op?: unknown; args?: unknown };
  if (typeof rec.op !== 'string') {
    issues.push({ at, code: 'malformed', message: 'campo `op` ausente ou nao textual' });
    return;
  }
  const args = rec.args === undefined ? [] : rec.args;
  if (!Array.isArray(args)) {
    issues.push({ at: `${at}.args`, code: 'malformed', message: '`args` deve ser um array' });
    return;
  }

  // Literal-termo (`lit`): valido somente onde um termo e esperado.
  if (rec.op === LIT_OP) {
    if (expect !== 'term') {
      issues.push({
        at,
        code: 'expected-predicate',
        message: 'literal usado onde se espera um predicado booleano',
      });
      return;
    }
    if (args.length !== 1 || !isScalar(args[0])) {
      issues.push({
        at: `${at}.args`,
        code: 'malformed',
        message: 'literal deve ter exatamente um escalar',
      });
    }
    return;
  }

  if (!isKnownOperator(rec.op)) {
    issues.push({ at, code: 'unknown-operator', message: `operacao desconhecida: ${rec.op}` });
    return;
  }

  const spec = OPERATOR_TABLE[rec.op];

  // Coerencia do tipo de retorno com o contexto esperado.
  if (expect === 'term' && spec.returns !== 'term') {
    issues.push({ at, code: 'expected-term', message: `operacao ${rec.op} nao retorna um termo` });
    return;
  }
  if (expect === 'boolean' && spec.returns !== 'boolean') {
    issues.push({
      at,
      code: 'expected-predicate',
      message: `operacao ${rec.op} nao retorna um booleano`,
    });
    return;
  }

  // Aridade.
  if (args.length < spec.minArgs || args.length > spec.maxArgs) {
    issues.push({
      at: `${at}.args`,
      code: 'arity',
      message: `operacao ${rec.op} espera de ${spec.minArgs} a ${spec.maxArgs} argumentos; recebeu ${args.length}`,
    });
    return;
  }

  // Validacao posicional dos argumentos.
  for (let i = 0; i < args.length; i++) {
    const kind: ArgKind = spec.variadic
      ? (spec.argKinds[0] as ArgKind)
      : (spec.argKinds[i] as ArgKind);
    validateArg(args[i], `${at}.args[${i}]`, kind, options, issues);
  }
}

function validateArg(
  arg: unknown,
  at: string,
  kind: ArgKind,
  options: ValidatePredicateOptions,
  issues: PredicateIssue[],
): void {
  switch (kind) {
    case 'predicate':
      validateNode(arg, at, 'boolean', options, issues);
      return;
    case 'term':
      validateTerm(arg, at, options, issues);
      return;
    case 'path':
      validatePath(arg, at, options, issues);
      return;
    case 'literal-array':
      if (!Array.isArray(arg) || !arg.every(isScalar)) {
        issues.push({
          at,
          code: 'expected-literal-array',
          message: 'esperado um array de escalares',
        });
      }
      return;
    default: {
      const never: never = kind;
      throw new Error(`argumento desconhecido: ${String(never)}`);
    }
  }
}

/** Um termo e um literal escalar cru, `lit`, `field` ou outra op que retorna termo. */
function validateTerm(
  arg: unknown,
  at: string,
  options: ValidatePredicateOptions,
  issues: PredicateIssue[],
): void {
  // Escalar cru e aceito como literal direto.
  if (isScalar(arg)) return;
  // Caso contrario, deve ser um no que retorna termo.
  validateNode(arg, at, 'term', options, issues);
}

function validatePath(
  arg: unknown,
  at: string,
  options: ValidatePredicateOptions,
  issues: PredicateIssue[],
): void {
  if (typeof arg !== 'string' || arg.length === 0) {
    issues.push({
      at,
      code: 'expected-path',
      message: 'esperado um caminho de campo (string nao vazia)',
    });
    return;
  }
  if (options.knownFields && !options.knownFields.has(arg)) {
    issues.push({ at, code: 'unknown-field', message: `referencia a campo desconhecido: ${arg}` });
  }
}

/** `true` quando `v` e um escalar admitido (string|number|boolean). */
export function isScalar(v: unknown): v is Scalar {
  const t = typeof v;
  return t === 'string' || (t === 'number' && Number.isFinite(v)) || t === 'boolean';
}

// --------------------------------------------------------------------------
// Avaliacao do predicado
// --------------------------------------------------------------------------

/**
 * Contexto de avaliacao: um mapa somente-leitura de caminho -> valor. A
 * avaliacao NUNCA acessa nada fora deste mapa; nao ha acesso a prototipos,
 * funcoes ou `globalThis`.
 */
export interface EvalContext {
  /** Le um campo pelo caminho; retorna `undefined` quando ausente. */
  readonly get: (path: string) => unknown;
}

/** Constroi um `EvalContext` a partir de um objeto simples path -> valor. */
export function contextFromMap(map: Readonly<Record<string, unknown>>): EvalContext {
  return {
    get: (path) => (Object.prototype.hasOwnProperty.call(map, path) ? map[path] : undefined),
  };
}

/**
 * Avalia um predicado (previamente validado) contra um contexto. Lanca
 * `TypeError` apenas quando o predicado nao foi validado e esta malformado;
 * use `validatePredicate` antes de avaliar em producao.
 *
 * Semantica deterministica:
 *  - comparacoes de ordem exigem ambos os termos number ou ambos string;
 *    tipos incompativeis resultam em `false` (nunca lancam em runtime).
 *  - `field` de caminho ausente retorna `undefined`; comparacoes com
 *    `undefined` resultam em `false` (exceto `has`, que retorna `false`).
 */
export function evaluatePredicate(predicate: RulePredicate, ctx: EvalContext): boolean {
  const v = evalNode(predicate, ctx);
  return v === true;
}

function evalNode(node: RulePredicate, ctx: EvalContext): unknown {
  const op = node.op;
  const args = node.args ?? [];

  switch (op) {
    case LIT_OP:
      return args[0];
    case 'true':
      return true;
    case 'false':
      return false;
    case 'and':
      return (args as RulePredicate[]).every((a) => evalNode(a, ctx) === true);
    case 'or':
      return (args as RulePredicate[]).some((a) => evalNode(a, ctx) === true);
    case 'not':
      return evalNode(args[0] as RulePredicate, ctx) !== true;
    case 'field':
      return ctx.get(args[0] as string);
    case 'has': {
      const value = ctx.get(args[0] as string);
      return value !== undefined && value !== null;
    }
    case 'eq':
      return scalarEq(evalTerm(args[0], ctx), evalTerm(args[1], ctx));
    case 'ne':
      return !scalarEq(evalTerm(args[0], ctx), evalTerm(args[1], ctx));
    case 'lt':
      return compareOrder(evalTerm(args[0], ctx), evalTerm(args[1], ctx), (c) => c < 0);
    case 'le':
      return compareOrder(evalTerm(args[0], ctx), evalTerm(args[1], ctx), (c) => c <= 0);
    case 'gt':
      return compareOrder(evalTerm(args[0], ctx), evalTerm(args[1], ctx), (c) => c > 0);
    case 'ge':
      return compareOrder(evalTerm(args[0], ctx), evalTerm(args[1], ctx), (c) => c >= 0);
    case 'in': {
      const needle = evalTerm(args[0], ctx);
      const set = args[1] as Scalar[];
      return isScalar(needle) && set.some((s) => scalarEq(s, needle));
    }
    case 'includes': {
      const listValue = ctx.get(args[0] as string);
      const needle = evalTerm(args[1], ctx);
      return Array.isArray(listValue) && listValue.some((x) => scalarEq(x as Scalar, needle));
    }
    default: {
      // Operacao desconhecida: o predicado nao foi validado.
      throw new TypeError(`operacao desconhecida na avaliacao: ${op}`);
    }
  }
}

/** Avalia um argumento-termo: escalar cru, `lit`, `field`, etc. */
function evalTerm(arg: unknown, ctx: EvalContext): unknown {
  if (isScalar(arg)) return arg;
  if (arg !== null && typeof arg === 'object' && 'op' in (arg as object)) {
    return evalNode(arg as RulePredicate, ctx);
  }
  return undefined;
}

function scalarEq(a: unknown, b: unknown): boolean {
  if (!isScalar(a) || !isScalar(b)) return false;
  return a === b;
}

/**
 * Compara dois termos para ordem. Retorna `false` quando os tipos sao
 * incompativeis (um nao e comparavel com o outro) ou quando algum e ausente.
 */
function compareOrder(a: unknown, b: unknown, test: (cmp: number) => boolean): boolean {
  if (typeof a === 'number' && typeof b === 'number') return test(a - b);
  if (typeof a === 'string' && typeof b === 'string') return test(a < b ? -1 : a > b ? 1 : 0);
  return false;
}
