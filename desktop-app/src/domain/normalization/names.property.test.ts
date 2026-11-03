import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { normalizeName } from './index';

// Feature: gestao-leiga-de-escalas, Property 6: Normalização de nomes é idempotente e não destrutiva

// Property 6 (design.md):
// "Para toda string de nome ou alias, normalizá-la duas vezes produz o mesmo
//  resultado que normalizá-la uma vez; a operação remove espaços externos,
//  colapsa espaços internos e preserva as demais letras e sinais."
// Valida: Requisito 3.6.

// Remove todos os caracteres de espaco em branco (Unicode), preservando a
// ordem dos demais caracteres. Usado para verificar que a normalizacao nao e
// destrutiva: nenhum caractere nao-espaco e adicionado, removido ou reordenado.
const stripWhitespace = (value: string): string => value.replace(/\s+/gu, '');

describe('Propriedade 6: normalizacao de nomes e idempotente e nao destrutiva', () => {
  it('normalizar duas vezes equivale a normalizar uma vez (idempotencia)', () => {
    fc.assert(
      fc.property(fc.string(), (value) => {
        const once = normalizeName(value);
        const twice = normalizeName(once);
        expect(twice).toBe(once);
      }),
      { numRuns: 100 },
    );
  });

  it('remove espacos externos, colapsa internos e preserva demais caracteres', () => {
    fc.assert(
      fc.property(fc.string(), (value) => {
        const result = normalizeName(value);

        // Nao destrutiva: a sequencia de caracteres nao-espaco e preservada
        // exatamente (nenhum caractere adicionado, removido ou reordenado).
        expect(stripWhitespace(result)).toBe(stripWhitespace(value));

        // Remove espacos externos: sem espaco em branco nas extremidades.
        if (result.length > 0) {
          expect(/^\s/u.test(result)).toBe(false);
          expect(/\s$/u.test(result)).toBe(false);
        }

        // Colapsa espacos internos: nenhum par de espacos consecutivos e todo
        // espaco e o espaco comum U+0020.
        expect(/\s\s/u.test(result)).toBe(false);
        expect(/[^\S ]/u.test(result)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});
