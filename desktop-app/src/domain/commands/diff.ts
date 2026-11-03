// Diff real (campo a campo) entre dois estados de dominio.
//
// Objetivo (design.md, Property 10 "Toda alteracao de dominio e auditada pelo
// diff real"; requisitos 3.10, 4.17, 6.4, 8.7): produzir, de forma pura e
// deterministica, EXATAMENTE os campos que mudaram entre um valor anterior e
// um posterior, com os valores de antes e depois.
//
// Propriedades garantidas:
//   - Um campo so aparece no diff quando seu valor canonico mudou. Campos
//     inalterados NUNCA aparecem (criterio "campos inalterados ... nao
//     aparecem").
//   - A comparacao usa a serializacao JSON canonica (ver `canonical.ts`), logo
//     dois valores semanticamente equivalentes (p.ex. chaves em outra ordem)
//     nao geram diff.
//   - Se nada mudou, o diff e vazio -> nenhuma revisao/evento deve ser gerado.
//
// Este modulo e TypeScript puro: nao faz I/O e nao muta as entradas.

import { canonicalHash, canonicalStringify } from '../schemas/canonical';

/** Uma mudanca de um unico campo (caminho) entre dois estados. */
export interface FieldChange {
  /** Caminho do campo em notacao de ponto (ex.: `aliases.0.value`). */
  readonly field: string;
  /** Valor anterior; `undefined` quando o campo foi adicionado. */
  readonly before?: unknown;
  /** Valor posterior; `undefined` quando o campo foi removido. */
  readonly after?: unknown;
  /** Hash SHA-256 do valor anterior (presente quando havia valor). */
  readonly beforeHash?: string;
  /** Hash SHA-256 do valor posterior (presente quando ha valor). */
  readonly afterHash?: string;
  /** Natureza da mudanca. */
  readonly kind: 'added' | 'removed' | 'changed';
}

/** Resultado de um diff: a lista ordenada de mudancas. */
export interface Diff {
  readonly changes: readonly FieldChange[];
}

const PLAIN_OBJECT_PROTO = Object.prototype;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (typeof v !== 'object' || v === null) return false;
  if (Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v) as object | null;
  return proto === PLAIN_OBJECT_PROTO || proto === null;
}

/** Serializa de forma canonica, tratando `undefined` como o sentinela "ausente". */
function canonicalOrAbsent(v: unknown): string {
  return v === undefined ? '\u0000absent' : canonicalStringify(v);
}

/**
 * `true` quando os dois valores sao canonicamente equivalentes. `undefined`
 * (ausencia) e tratado como um valor distinto de qualquer valor presente.
 */
export function canonicalEqual(a: unknown, b: unknown): boolean {
  // Comparacao rapida por identidade primeiro.
  if (a === b) return true;
  return canonicalOrAbsent(a) === canonicalOrAbsent(b);
}

/**
 * Calcula o diff real, campo a campo, entre `before` e `after`.
 *
 * - Desce recursivamente por objetos "planos" (literais), comparando chave a
 *   chave, de modo que apenas as folhas/ramos que realmente mudaram aparecam.
 * - Arrays e valores primitivos sao tratados como folhas: se o conteudo
 *   canonico diferir, a folha inteira entra como `changed` (ou `added`/
 *   `removed`).
 * - Chaves ausentes de um lado viram `added`/`removed`.
 *
 * A saida e ordenada por `field` para ser deterministica.
 */
export function diffStates(before: unknown, after: unknown): Diff {
  const changes: FieldChange[] = [];
  walk('', before, after, changes);
  changes.sort((x, y) => (x.field < y.field ? -1 : x.field > y.field ? 1 : 0));
  return { changes };
}

function walk(path: string, before: unknown, after: unknown, out: FieldChange[]): void {
  const beforeMissing = before === undefined;
  const afterMissing = after === undefined;

  if (beforeMissing && afterMissing) return;

  // Ambos presentes e ambos objetos planos: comparar chave a chave.
  if (!beforeMissing && !afterMissing && isPlainObject(before) && isPlainObject(after)) {
    const keys = new Set<string>([...Object.keys(before), ...Object.keys(after)]);
    // Ordena para percurso determinista.
    for (const key of [...keys].sort()) {
      const childPath = path === '' ? key : `${path}.${key}`;
      walk(childPath, before[key], after[key], out);
    }
    return;
  }

  // Folhas (primitivos, arrays, ou troca de tipo): compara canonicamente.
  // So comparamos quando ambos estao presentes; `undefined` nao e serializavel
  // como raiz canonica, entao os casos de ausencia sao tratados a seguir.
  if (!beforeMissing && !afterMissing && canonicalEqual(before, after)) return;

  if (beforeMissing) {
    out.push({
      field: path,
      after,
      afterHash: canonicalHash(after),
      kind: 'added',
    });
    return;
  }
  if (afterMissing) {
    out.push({
      field: path,
      before,
      beforeHash: canonicalHash(before),
      kind: 'removed',
    });
    return;
  }
  out.push({
    field: path,
    before,
    after,
    beforeHash: canonicalHash(before),
    afterHash: canonicalHash(after),
    kind: 'changed',
  });
}
