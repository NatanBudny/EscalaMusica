import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { canonicalBytes, canonicalHash, sha256Hex, utf8Encode } from './canonical';
import { InMemorySnapshotStore, stagedWrite, type Snapshot } from './staging';

// Testes de propriedade do modulo de serializacao canonica e escrita por
// staging (tarefa 2.2). Estes exercitam as validacoes objetivas proprias da
// tarefa; nao sao as propriedades numeradas do design (que possuem tarefas de
// PBT dedicadas).
//
// Objetivos verificados:
//   - determinismo dos bytes canonicos para entradas semanticamente
//     equivalentes (Requisitos 9.8, 9.10);
//   - estabilidade sob round-trip JSON (exportar -> importar -> exportar);
//   - falha antes da troca preserva o snapshot anterior (Requisitos 12.3,
//     12.11);
//   - troca bem-sucedida produz a revisao = hash canonico (Requisito 12.1).

const decoder = new TextDecoder();
const asString = (b: Uint8Array): string => decoder.decode(b);

// Gerador de valores JSON arbitrarios (sem undefined/NaN/Infinity), com
// objetos, arrays, strings unicode, numeros finitos, booleanos e null.
const jsonValueArb: fc.Arbitrary<unknown> = fc.letrec((tie) => ({
  value: fc.oneof(
    { depthSize: 'small' },
    fc.constant(null),
    fc.boolean(),
    fc.integer(),
    fc.double({ noNaN: true, noDefaultInfinity: true }),
    fc.string(),
    fc.array(tie('value')),
    fc.dictionary(fc.string(), tie('value')),
  ),
})).value;

/** Reordena recursivamente as chaves de todo objeto, preservando semantica. */
function shuffleKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(shuffleKeys);
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    // Reverte a ordem das chaves (equivalente semantico, bytes diferentes
    // antes da canonicalizacao).
    return Object.fromEntries(entries.reverse().map(([k, v]) => [k, shuffleKeys(v)]));
  }
  return value;
}

describe('Propriedade: bytes canonicos sao deterministicos (Req 9.8/9.10)', () => {
  it('entradas semanticamente equivalentes geram os mesmos bytes e hash', () => {
    fc.assert(
      fc.property(jsonValueArb, (value) => {
        const reordered = shuffleKeys(value);
        expect(asString(canonicalBytes(reordered))).toBe(asString(canonicalBytes(value)));
        expect(canonicalHash(reordered)).toBe(canonicalHash(value));
      }),
    );
  });

  it('round-trip JSON (exportar -> importar -> exportar) reproduz os bytes', () => {
    fc.assert(
      fc.property(jsonValueArb, (value) => {
        const first = canonicalBytes(value);
        const roundTripped = JSON.parse(asString(first)) as unknown;
        const second = canonicalBytes(roundTripped);
        expect(asString(second)).toBe(asString(first));
      }),
    );
  });

  it('o hash canonico sempre tem 64 caracteres hex minusculos', () => {
    fc.assert(
      fc.property(jsonValueArb, (value) => {
        expect(canonicalHash(value)).toMatch(/^[0-9a-f]{64}$/);
      }),
    );
  });

  it('a string canonica nunca contem CR', () => {
    fc.assert(
      fc.property(jsonValueArb, (value) => {
        expect(asString(canonicalBytes(value)).includes('\r')).toBe(false);
      }),
    );
  });
});

describe('Propriedade: SHA-256 confere com a Web Crypto', () => {
  it('coincide com crypto.subtle para bytes arbitrarios', async () => {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) return; // ambiente sem Web Crypto: pula silenciosamente
    await fc.assert(
      fc.asyncProperty(fc.uint8Array(), async (bytes) => {
        const buf = new ArrayBuffer(bytes.length);
        new Uint8Array(buf).set(bytes);
        const expected = new Uint8Array(await subtle.digest('SHA-256', buf));
        let hex = '';
        for (const b of expected) hex += b.toString(16).padStart(2, '0');
        expect(sha256Hex(bytes)).toBe(hex);
      }),
      { numRuns: 50 },
    );
  });

  it('coincide com crypto.subtle para strings unicode', async () => {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) return;
    await fc.assert(
      fc.asyncProperty(fc.string(), async (s) => {
        const bytes = utf8Encode(s);
        const buf = new ArrayBuffer(bytes.length);
        new Uint8Array(buf).set(bytes);
        const expected = new Uint8Array(await subtle.digest('SHA-256', buf));
        let hex = '';
        for (const b of expected) hex += b.toString(16).padStart(2, '0');
        expect(sha256Hex(bytes)).toBe(hex);
      }),
      { numRuns: 50 },
    );
  });
});

describe('Propriedade: escrita por staging preserva o snapshot sob falha (Req 12.3/12.11)', () => {
  function snapshotOf(value: unknown): Snapshot {
    return { bytes: canonicalBytes(value), revision: canonicalHash(value) };
  }

  it('qualquer falha injetada antes da troca mantem o hash anterior', () => {
    fc.assert(
      fc.property(
        jsonValueArb,
        jsonValueArb,
        fc.constantFrom('validation', 'beforeCommit', 'commit'),
        (previousValue, candidate, failurePoint) => {
          const previous = snapshotOf(previousValue);
          const store = new InMemorySnapshotStore(previous);

          let options: Parameters<typeof stagedWrite>[2];
          if (failurePoint === 'validation') {
            options = { validate: () => ({ valid: false, issues: [{ message: 'reprovado' }] }) };
          } else if (failurePoint === 'beforeCommit') {
            options = {
              validate: () => ({ valid: true, issues: [] }),
              beforeCommit: () => {
                throw new Error('injetada');
              },
            };
          } else {
            options = { validate: () => ({ valid: true, issues: [] }) };
            store.failNextCommit('injetada');
          }

          const result = stagedWrite(store, candidate, options);
          expect(result.ok).toBe(false);
          if (!result.ok) {
            expect(result.preservedRevision).toBe(previous.revision);
          }
          // O snapshot persistido continua sendo exatamente o anterior.
          expect(store.revision).toBe(previous.revision);
          expect(asString(store.readStage()!.bytes)).toBe(asString(previous.bytes));
        },
      ),
    );
  });

  it('a troca bem-sucedida efetiva a revisao = hash canonico do candidato (Req 12.1)', () => {
    fc.assert(
      fc.property(jsonValueArb, jsonValueArb, (previousValue, candidate) => {
        const store = new InMemorySnapshotStore(snapshotOf(previousValue));
        const result = stagedWrite(store, candidate, {
          validate: () => ({ valid: true, issues: [] }),
        });
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.revision).toBe(canonicalHash(candidate));
          expect(store.revision).toBe(canonicalHash(candidate));
        }
      }),
    );
  });
});
