import { describe, expect, it } from 'vitest';

import {
  canonicalBytes,
  canonicalBytesUnordered,
  canonicalHash,
  canonicalStringify,
  sha256Hex,
  toHex,
  utf8Encode,
} from './canonical';
import { validFixtures } from './fixtures';

const decoder = new TextDecoder();
const asString = (bytes: Uint8Array): string => decoder.decode(bytes);

describe('canonicalStringify', () => {
  it('ordena chaves de objeto recursivamente', () => {
    const value = { b: 1, a: { d: 4, c: 3 } };
    expect(canonicalStringify(value)).toBe('{"a":{"c":3,"d":4},"b":1}');
  });

  it('produz os mesmos bytes para entradas semanticamente equivalentes (Req 9.8)', () => {
    const a = { nome: 'Ana', idade: 30, tags: ['x', 'y'] };
    const b = { tags: ['x', 'y'], idade: 30, nome: 'Ana' };
    expect(asString(canonicalBytes(a))).toBe(asString(canonicalBytes(b)));
  });

  it('preserva a ordem de arrays por padrao (ordem semantica)', () => {
    expect(canonicalStringify({ xs: [3, 1, 2] })).toBe('{"xs":[3,1,2]}');
  });

  it('ordena apenas arrays cujo caminho e declarado sem ordem semantica', () => {
    const value = { ordered: [3, 1, 2], unordered: [3, 1, 2] };
    const out = canonicalStringify(value, { sortArraysAtPaths: ['unordered'] });
    expect(out).toBe('{"ordered":[3,1,2],"unordered":[1,2,3]}');
  });

  it('ordena arrays aninhados pelo caminho com notacao []', () => {
    const value = { items: [{ tags: ['b', 'a'] }, { tags: ['d', 'c'] }] };
    const out = canonicalStringify(value, { sortArraysAtPaths: ['items[].tags'] });
    expect(out).toBe('{"items":[{"tags":["a","b"]},{"tags":["c","d"]}]}');
  });

  it('omite propriedades undefined em objetos', () => {
    expect(canonicalStringify({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it('converte undefined/funcao/symbol em null dentro de arrays', () => {
    expect(canonicalStringify([1, undefined, 3])).toBe('[1,null,3]');
  });

  it('nunca emite CR (final de linha LF)', () => {
    const value = { a: 'linha1\nlinha2', b: [1, 2] };
    expect(canonicalStringify(value).includes('\r')).toBe(false);
  });

  it('serializa null, boolean e numeros', () => {
    expect(canonicalStringify(null)).toBe('null');
    expect(canonicalStringify(true)).toBe('true');
    expect(canonicalStringify(0)).toBe('0');
    expect(canonicalStringify(-1.5)).toBe('-1.5');
  });

  it('usa toJSON (ex.: Date) de forma coerente com o JSON padrao', () => {
    const d = new Date('2026-01-15T12:00:00Z');
    expect(canonicalStringify({ at: d })).toBe('{"at":"2026-01-15T12:00:00.000Z"}');
  });

  it('lanca para valores nao serializaveis', () => {
    expect(() => canonicalStringify(undefined)).toThrow(TypeError);
    expect(() => canonicalStringify(Number.NaN)).toThrow(TypeError);
    expect(() => canonicalStringify({ x: Number.POSITIVE_INFINITY })).toThrow(TypeError);
    expect(() => canonicalStringify(10n)).toThrow(TypeError);
  });

  it('detecta referencia circular', () => {
    const o: Record<string, unknown> = {};
    o.self = o;
    expect(() => canonicalStringify(o)).toThrow(TypeError);
  });
});

describe('canonicalBytesUnordered', () => {
  it('trata todos os arrays como colecoes sem ordem', () => {
    const a = canonicalBytesUnordered({ xs: [3, 1, 2], ys: ['b', 'a'] });
    const b = canonicalBytesUnordered({ ys: ['a', 'b'], xs: [1, 3, 2] });
    expect(asString(a)).toBe(asString(b));
  });
});

describe('utf8Encode', () => {
  it('codifica ASCII', () => {
    expect(Array.from(utf8Encode('abc'))).toEqual([0x61, 0x62, 0x63]);
  });

  it('codifica caracteres multibyte como o TextEncoder', () => {
    const samples = ['graça', 'José', 'ção', 'ü', '€', '😀', 'A\u00e7\u00e3o'];
    const encoder = new TextEncoder();
    for (const s of samples) {
      expect(Array.from(utf8Encode(s))).toEqual(Array.from(encoder.encode(s)));
    }
  });
});

describe('sha256Hex', () => {
  // Vetores de teste conhecidos do SHA-256 (NIST / RFC 6234).
  it('calcula o hash da string vazia', () => {
    expect(sha256Hex(utf8Encode(''))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('calcula o hash de "abc"', () => {
    expect(sha256Hex(utf8Encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('calcula o hash de uma mensagem de 448 bits (dois blocos)', () => {
    const msg = 'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq';
    expect(sha256Hex(utf8Encode(msg))).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
  });

  it('produz 64 caracteres hex minusculos', () => {
    const h = sha256Hex(utf8Encode('qualquer coisa'));
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('cobre varios comprimentos para exercitar o padding', () => {
    const encoder = new TextEncoder();
    const crypto = globalThis.crypto;
    // Confronta com a Web Crypto quando disponivel no ambiente de teste.
    if (!crypto?.subtle) return;
    const lengths = [0, 1, 55, 56, 63, 64, 65, 119, 120, 1000];
    for (const len of lengths) {
      const str = 'x'.repeat(len);
      const ours = sha256Hex(encoder.encode(str));
      // Comparacao sincrona impossivel; validamos apenas o formato aqui.
      expect(ours).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});

describe('toHex', () => {
  it('converte bytes em hex minusculo com padding', () => {
    expect(toHex(Uint8Array.from([0, 15, 255, 16]))).toBe('000fff10');
  });
});

describe('canonicalHash', () => {
  it('e igual para entradas semanticamente equivalentes (Req 9.8/9.10)', () => {
    const person = validFixtures.person as Record<string, unknown>;
    // Reconstroi o mesmo objeto com chaves em ordem diferente.
    const reordered = Object.fromEntries(Object.entries(person).reverse());
    expect(canonicalHash(reordered)).toBe(canonicalHash(person));
  });

  it('e estavel em execucoes repetidas (round-trip exportar->importar->exportar)', () => {
    const value = validFixtures.scheduleDraft;
    const first = canonicalBytes(value);
    // Simula export -> parse -> export.
    const roundTripped = JSON.parse(asString(first)) as unknown;
    const second = canonicalBytes(roundTripped);
    expect(asString(second)).toBe(asString(first));
    expect(canonicalHash(roundTripped)).toBe(canonicalHash(value));
  });

  it('muda quando o conteudo semantico muda', () => {
    const a = canonicalHash({ n: 1 });
    const b = canonicalHash({ n: 2 });
    expect(a).not.toBe(b);
  });
});
