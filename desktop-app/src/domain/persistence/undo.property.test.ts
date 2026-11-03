// Teste baseado em propriedade — Property 40: Desfazer restaura exatamente a
// revisao anterior (tarefa 11.7).
//
// Property 40 (design.md, "Correctness Properties"): desfazer uma alteracao
// elegivel restaura EXATAMENTE a revisao imediatamente anterior — o conteudo e
// o hash do estado restaurado sao identicos aos do pai registrado na cadeia.
//
// Estrategia: construimos uma CADEIA linear de snapshots confirmados aplicando
// uma sequencia arbitraria de conteudos (cada um derivado por makeSnapshot, que
// encadeia parentHash). Para qualquer snapshot nao-raiz da cadeia, `undo`
// devolve o pai e o hash do restaurado e identico ao parentHash do atual; o
// conteudo restaurado e byte a byte igual ao conteudo do pai.
//
// **Validates: Requirement 12.2**

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { canonicalHash } from '../schemas/canonical';
import { makeSnapshot, undo, type Snapshot } from './journal';

const AT = '2026-02-20T10:00:00Z';

/** Conteudo arbitrario e serializavel em JSON canonico. */
const contentArb = fc.record({
  n: fc.integer({ min: 0, max: 1000 }),
  tag: fc.constantFrom('a', 'b', 'c', 'd'),
  list: fc.array(fc.integer({ min: 0, max: 9 }), { maxLength: 4 }),
});

type Content = { n: number; tag: string; list: number[] };

/** Constroi uma cadeia linear de snapshots a partir de uma lista de conteudos. */
function buildChain(contents: readonly Content[]): Snapshot<Content>[] {
  const chain: Snapshot<Content>[] = [];
  let parent: Snapshot<Content> | undefined;
  contents.forEach((content, i) => {
    const snap = parent === undefined
      ? makeSnapshot({ content, operationId: `op-${i}`, at: AT })
      : makeSnapshot({ content, parent, operationId: `op-${i}`, at: AT });
    chain.push(snap);
    parent = snap;
  });
  return chain;
}

describe('journal — Property 40: desfazer restaura exatamente a revisao anterior', () => {
  it('undo de qualquer snapshot nao-raiz devolve o pai com conteudo e hash identicos', () => {
    // Feature: gestao-leiga-de-escalas, Property 40: Desfazer restaura exatamente a revisão anterior
    fc.assert(
      fc.property(
        fc.array(contentArb, { minLength: 2, maxLength: 12 }),
        fc.integer({ min: 1, max: 1000 }),
        (contents, pick) => {
          const chain = buildChain(contents);
          // Escolhe um indice nao-raiz (>=1) de forma deterministica.
          const idx = 1 + (pick % (chain.length - 1));
          const current = chain[idx] as Snapshot<Content>;

          const result = undo(current, chain);
          expect(result.ok).toBe(true);
          if (!result.ok) return;

          const parent = chain[idx - 1] as Snapshot<Content>;
          // Restaura EXATAMENTE a revisao anterior: mesma referencia de pai,
          // mesmo hash e mesmo conteudo canonico.
          expect(result.restored).toBe(parent);
          expect(result.restored.hash).toBe(current.parentHash);
          expect(result.restored.hash).toBe(parent.hash);
          expect(canonicalHash(result.restored.content)).toBe(canonicalHash(parent.content));
        },
      ),
      { numRuns: 200 },
    );
  });

  it('a raiz da cadeia nao pode ser desfeita (sem pai)', () => {
    // Feature: gestao-leiga-de-escalas, Property 40: Desfazer restaura exatamente a revisão anterior
    fc.assert(
      fc.property(fc.array(contentArb, { minLength: 1, maxLength: 8 }), (contents) => {
        const chain = buildChain(contents);
        const root = chain[0] as Snapshot<Content>;
        const result = undo(root, chain);
        expect(result.ok).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});
