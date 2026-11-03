// Serializacao JSON canonica e hashing SHA-256 do dominio.
//
// Objetivo (Requisitos 9.8, 9.10, 12.1-12.3): produzir, de forma deterministica
// e pura (sem I/O), uma representacao em bytes estavel para qualquer valor
// persistido, de modo que:
//
//   - entradas semanticamente equivalentes gerem exatamente os mesmos bytes
//     (Requisito 9.8) e, por consequencia, o mesmo hash SHA-256;
//   - um ciclo exportar -> importar -> exportar reproduza os mesmos bytes
//     (Requisito 9.10);
//   - a revisao de um estado seja o hash SHA-256 do JSON canonico (design.md,
//     "Data Models": "Revisoes usam hash SHA-256 do JSON canonico").
//
// Convencoes do formato canonico (design.md, "Estado local e persistencia"):
//   - Codificacao UTF-8.
//   - Final de linha LF (o serializador nunca emite CR; a string resultante
//     nao contem `\r`).
//   - Chaves de objeto ordenadas lexicograficamente de forma recursiva.
//   - Arrays sao ordenados SOMENTE quando a ordem nao tem significado. A ordem
//     de um array e semantica por padrao; a reordenacao e um ato explicito do
//     chamador (ver `canonicalBytesUnordered` / opcao `sortArraysAtPaths`).
//
// Este modulo e TypeScript puro: nao usa `fs`, `crypto` nativo do Node nem
// Web APIs. A funcao de hash e uma implementacao autossuficiente de SHA-256,
// o que mantem o dominio deterministico e testavel de forma sincrona.

/** Bytes canonicos: UTF-8, LF, chaves ordenadas. */
export type CanonicalBytes = Uint8Array;

/** Opcoes de serializacao canonica. */
export interface CanonicalOptions {
  /**
   * Conjunto de caminhos (notacao de ponto a partir da raiz, usando `[]` para
   * indicar "qualquer elemento de array") cujas COLECOES devem ser ordenadas
   * por nao possuirem ordem semantica. Exemplo: `['aliases', 'links[].tags']`.
   *
   * A ordenacao de um array so acontece quando seu caminho esta listado aqui.
   * Isso garante o default seguro: a ordem de um array e preservada (semantica)
   * a menos que o chamador declare explicitamente o contrario.
   */
  readonly sortArraysAtPaths?: readonly string[];
}

// --------------------------------------------------------------------------
// Serializacao canonica para string (JSON estavel)
// --------------------------------------------------------------------------

/**
 * Produz a string JSON canonica de um valor. Chaves de objeto sao ordenadas
 * recursivamente; `undefined` em propriedades de objeto e omitido (como no
 * JSON padrao); arrays preservam a ordem salvo quando seu caminho estiver em
 * `sortArraysAtPaths`.
 *
 * Lanca `TypeError` para valores nao serializaveis em JSON canonico
 * (`undefined` na raiz, numeros nao finitos, funcoes, symbols, BigInt).
 */
export function canonicalStringify(value: unknown, options: CanonicalOptions = {}): string {
  const sortSet = new Set(options.sortArraysAtPaths ?? []);
  const out = encodeValue(value, '', sortSet, new Set());
  if (out === undefined) {
    throw new TypeError('Valor nao serializavel em JSON canonico na raiz.');
  }
  // Nota: nenhum passo adiciona `\r`; a saida ja esta em LF.
  return out;
}

/**
 * Produz os bytes canonicos (UTF-8) de um valor. A string canonica nunca
 * contem CR, logo os bytes estao em final de linha LF.
 */
export function canonicalBytes(value: unknown, options: CanonicalOptions = {}): CanonicalBytes {
  return utf8Encode(canonicalStringify(value, options));
}

/**
 * Conveniencia: trata TODOS os arrays como colecoes sem ordem semantica,
 * ordenando-os por sua propria serializacao canonica. Util para comparar dois
 * conjuntos quando a ordem comprovadamente nao importa. Use com cautela: so e
 * correto quando nenhuma ordem de array carrega significado.
 */
export function canonicalBytesUnordered(value: unknown): CanonicalBytes {
  return utf8Encode(encodeValueSortAll(value, new Set()) ?? bail());
}

function bail(): never {
  throw new TypeError('Valor nao serializavel em JSON canonico na raiz.');
}

// --------------------------------------------------------------------------
// Codificacao recursiva
// --------------------------------------------------------------------------

function encodeValue(
  value: unknown,
  path: string,
  sortSet: ReadonlySet<string>,
  seen: Set<object>,
): string | undefined {
  if (value === null) return 'null';

  const t = typeof value;
  if (t === 'string') return JSON.stringify(value);
  if (t === 'boolean') return value ? 'true' : 'false';
  if (t === 'number') {
    if (!Number.isFinite(value as number)) {
      throw new TypeError(`Numero nao finito nao e serializavel: ${String(value)}`);
    }
    // JSON.stringify produz a forma canonica de numero do ECMAScript.
    return JSON.stringify(value);
  }
  if (t === 'bigint') throw new TypeError('BigInt nao e serializavel em JSON canonico.');
  if (t === 'function' || t === 'symbol') return undefined;
  if (t === 'undefined') return undefined;

  // Objetos e arrays.
  const obj = value as object;

  // Suporte a toJSON (ex.: Date) para coerencia com o JSON padrao.
  if (typeof (obj as { toJSON?: unknown }).toJSON === 'function') {
    const primitive = (obj as { toJSON: (key?: string) => unknown }).toJSON();
    return encodeValue(primitive, path, sortSet, seen);
  }

  if (seen.has(obj)) {
    throw new TypeError('Referencia circular nao e serializavel em JSON canonico.');
  }
  seen.add(obj);
  try {
    if (Array.isArray(obj)) {
      return encodeArray(obj, path, sortSet, seen);
    }
    return encodeObject(obj as Record<string, unknown>, path, sortSet, seen);
  } finally {
    seen.delete(obj);
  }
}

function encodeArray(
  arr: readonly unknown[],
  path: string,
  sortSet: ReadonlySet<string>,
  seen: Set<object>,
): string {
  const itemPath = `${path}[]`;
  const parts = arr.map((item) => {
    // Em array, `undefined`/funcao/symbol viram `null` (como no JSON padrao).
    const encoded = encodeValue(item, itemPath, sortSet, seen);
    return encoded === undefined ? 'null' : encoded;
  });
  if (sortSet.has(path)) {
    // Ordenacao estavel por conteudo canonico: so quando o caminho foi
    // declarado como colecao sem ordem semantica.
    parts.sort(compareStrings);
  }
  return `[${parts.join(',')}]`;
}

function encodeObject(
  obj: Record<string, unknown>,
  path: string,
  sortSet: ReadonlySet<string>,
  seen: Set<object>,
): string {
  const keys = Object.keys(obj).sort(compareStrings);
  const parts: string[] = [];
  for (const key of keys) {
    const childPath = path === '' ? key : `${path}.${key}`;
    const encoded = encodeValue(obj[key], childPath, sortSet, seen);
    if (encoded === undefined) continue; // omite propriedades undefined
    parts.push(`${JSON.stringify(key)}:${encoded}`);
  }
  return `{${parts.join(',')}}`;
}

// Variante que ordena TODOS os arrays (ver `canonicalBytesUnordered`).
function encodeValueSortAll(value: unknown, seen: Set<object>): string | undefined {
  if (value === null) return 'null';
  const t = typeof value;
  if (t === 'string') return JSON.stringify(value);
  if (t === 'boolean') return value ? 'true' : 'false';
  if (t === 'number') {
    if (!Number.isFinite(value as number)) {
      throw new TypeError(`Numero nao finito nao e serializavel: ${String(value)}`);
    }
    return JSON.stringify(value);
  }
  if (t === 'bigint') throw new TypeError('BigInt nao e serializavel em JSON canonico.');
  if (t === 'function' || t === 'symbol' || t === 'undefined') return undefined;

  const obj = value as object;
  if (typeof (obj as { toJSON?: unknown }).toJSON === 'function') {
    return encodeValueSortAll((obj as { toJSON: () => unknown }).toJSON(), seen);
  }
  if (seen.has(obj)) {
    throw new TypeError('Referencia circular nao e serializavel em JSON canonico.');
  }
  seen.add(obj);
  try {
    if (Array.isArray(obj)) {
      const parts = obj.map((i) => encodeValueSortAll(i, seen) ?? 'null');
      parts.sort(compareStrings);
      return `[${parts.join(',')}]`;
    }
    const o = obj as Record<string, unknown>;
    const keys = Object.keys(o).sort(compareStrings);
    const parts: string[] = [];
    for (const key of keys) {
      const encoded = encodeValueSortAll(o[key], seen);
      if (encoded === undefined) continue;
      parts.push(`${JSON.stringify(key)}:${encoded}`);
    }
    return `{${parts.join(',')}}`;
  } finally {
    seen.delete(obj);
  }
}

/**
 * Comparacao determinista de strings por unidade de codigo UTF-16. Independe do
 * locale (ao contrario do `<` sobre strings com Intl), garantindo bytes iguais
 * em qualquer maquina.
 */
function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

// --------------------------------------------------------------------------
// UTF-8
// --------------------------------------------------------------------------

/**
 * Codifica uma string JavaScript (UTF-16) em bytes UTF-8. Implementacao propria
 * para nao depender de `TextEncoder` (mantendo pureza e determinismo), tratando
 * corretamente pares substitutos (surrogate pairs).
 */
export function utf8Encode(str: string): Uint8Array {
  const bytes: number[] = [];
  for (let i = 0; i < str.length; i++) {
    let code = str.charCodeAt(i);
    // Par substituto (surrogate pair) -> code point acima de 0xFFFF.
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < str.length) {
      const next = str.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
        i++;
      }
    }
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }
  return Uint8Array.from(bytes);
}

// --------------------------------------------------------------------------
// SHA-256 (implementacao pura, sincrona e deterministica)
// --------------------------------------------------------------------------

// Constantes de arredondamento do SHA-256 (RFC 6234).
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

/** Calcula o SHA-256 de uma sequencia de bytes e retorna 32 bytes. */
export function sha256Bytes(data: Uint8Array): Uint8Array {
  // Estado inicial (RFC 6234).
  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  // Padding: append 0x80, zeros, e comprimento em bits (64 bits big-endian).
  const bitLenHigh = Math.floor(data.length / 0x20000000); // (len*8) >>> 32
  const bitLenLow = (data.length << 3) >>> 0;
  const withOne = data.length + 1;
  const totalLen = withOne + ((64 - ((withOne + 8) % 64)) % 64) + 8;
  const padded = new Uint8Array(totalLen);
  padded.set(data, 0);
  padded[data.length] = 0x80;
  // Comprimento em bits nos ultimos 8 bytes (big-endian).
  padded[totalLen - 8] = (bitLenHigh >>> 24) & 0xff;
  padded[totalLen - 7] = (bitLenHigh >>> 16) & 0xff;
  padded[totalLen - 6] = (bitLenHigh >>> 8) & 0xff;
  padded[totalLen - 5] = bitLenHigh & 0xff;
  padded[totalLen - 4] = (bitLenLow >>> 24) & 0xff;
  padded[totalLen - 3] = (bitLenLow >>> 16) & 0xff;
  padded[totalLen - 2] = (bitLenLow >>> 8) & 0xff;
  padded[totalLen - 1] = bitLenLow & 0xff;

  const w = new Uint32Array(64);

  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) {
      const j = offset + i * 4;
      w[i] =
        ((padded[j] as number) << 24) |
        ((padded[j + 1] as number) << 16) |
        ((padded[j + 2] as number) << 8) |
        (padded[j + 3] as number);
    }
    for (let i = 16; i < 64; i++) {
      const w15 = w[i - 15] as number;
      const w2 = w[i - 2] as number;
      const s0 = rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3);
      const s1 = rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10);
      w[i] = ((w[i - 16] as number) + s0 + (w[i - 7] as number) + s1) >>> 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let i = 0; i < 64; i++) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + ch + (K[i] as number) + (w[i] as number)) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  const out = new Uint8Array(32);
  const words = [h0, h1, h2, h3, h4, h5, h6, h7];
  for (let i = 0; i < 8; i++) {
    const word = words[i] as number;
    out[i * 4] = (word >>> 24) & 0xff;
    out[i * 4 + 1] = (word >>> 16) & 0xff;
    out[i * 4 + 2] = (word >>> 8) & 0xff;
    out[i * 4 + 3] = word & 0xff;
  }
  return out;
}

/** Converte bytes em hexadecimal minusculo. */
export function toHex(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) {
    s += (bytes[i] as number).toString(16).padStart(2, '0');
  }
  return s;
}

/** SHA-256 de bytes em hexadecimal minusculo (64 caracteres). */
export function sha256Hex(data: Uint8Array): string {
  return toHex(sha256Bytes(data));
}

/**
 * Calcula a revisao canonica de um valor: SHA-256 hex do seu JSON canonico.
 * Dois valores semanticamente equivalentes produzem a mesma revisao
 * (Requisitos 9.8, 9.10; design.md "Revisoes usam hash SHA-256 do JSON
 * canonico").
 */
export function canonicalHash(value: unknown, options: CanonicalOptions = {}): string {
  return sha256Hex(canonicalBytes(value, options));
}
