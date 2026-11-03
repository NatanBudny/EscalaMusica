/**
 * Baseline contract tests for the legacy public artifacts consumed by the
 * Visualizador_Atual: atual.json and contatos.json.
 *
 * These tests freeze the SHAPE the current viewer depends on (keys, value
 * types, formats). They run against both the live repo artifacts and the
 * frozen baseline fixtures, so any future scaffold that changes the public
 * contract will fail here. They never write or publish anything.
 *
 * Spec: gestao-leiga-de-escalas / Task 1.2
 * Requirements: 9.1, 9.2, 9.3, 16.1, 16.8
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../..');
const fixturesDir = resolve(__dirname, '../fixtures/baseline');

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

// Keys the viewer (table.js / cards.js) reads from each schedule record.
const ATUAL_KNOWN_KEYS = [
  'DATA', 'DIA SEMANA', 'ACOMP', 'REGENTE LOUVOR', 'EQUIPE LOUVOR',
  'MENSAGEM MUSICAL', 'LOUVORES ES', 'LOUVORES CULTO', 'TEMA CULTO',
  'AUDIOVISUAL', 'ANCIÃO', 'PREGADOR', 'SUPORTE', 'OBS',
];

const DATE_RE = /^\d{2}\/\d{2}\/\d{4}$/;
const WA_RE = /^https:\/\/wa\.me\/\d{8,15}$/;

/** Shared assertions for any atual.json-shaped array. */
function assertAtualContract(dados, label) {
  test(`${label}: is a non-empty array`, () => {
    expect(Array.isArray(dados)).toBe(true);
    expect(dados.length).toBeGreaterThan(0);
  });

  test(`${label}: every record carries all known viewer keys`, () => {
    for (const rec of dados) {
      for (const key of ATUAL_KNOWN_KEYS) {
        expect(Object.prototype.hasOwnProperty.call(rec, key)).toBe(true);
      }
    }
  });

  test(`${label}: every known value is a string`, () => {
    for (const rec of dados) {
      for (const key of ATUAL_KNOWN_KEYS) {
        expect(typeof rec[key]).toBe('string');
      }
    }
  });

  test(`${label}: DATA uses DD/MM/YYYY`, () => {
    for (const rec of dados) {
      expect(rec['DATA']).toMatch(DATE_RE);
    }
  });

  test(`${label}: DIA SEMANA is non-empty`, () => {
    for (const rec of dados) {
      expect(rec['DIA SEMANA'].trim().length).toBeGreaterThan(0);
    }
  });
}

/** Shared assertions for any contatos.json-shaped object. */
function assertContatosContract(contatos, label) {
  test(`${label}: is a plain object (not array)`, () => {
    expect(typeof contatos).toBe('object');
    expect(contatos).not.toBeNull();
    expect(Array.isArray(contatos)).toBe(false);
  });

  test(`${label}: every entry has telefone and apelidos[]`, () => {
    for (const nome of Object.keys(contatos)) {
      const entry = contatos[nome];
      expect(entry).toHaveProperty('telefone');
      expect(entry).toHaveProperty('apelidos');
      expect(typeof entry.telefone).toBe('string');
      expect(Array.isArray(entry.apelidos)).toBe(true);
    }
  });

  test(`${label}: telefone is a wa.me URL`, () => {
    for (const nome of Object.keys(contatos)) {
      expect(contatos[nome].telefone).toMatch(WA_RE);
    }
  });

  test(`${label}: aliases are strings`, () => {
    for (const nome of Object.keys(contatos)) {
      for (const alias of contatos[nome].apelidos) {
        expect(typeof alias).toBe('string');
      }
    }
  });
}

describe('atual.json contract — live repo artifact', () => {
  assertAtualContract(readJson(resolve(repoRoot, 'atual.json')), 'live atual.json');
});

describe('atual.json contract — frozen baseline fixture', () => {
  assertAtualContract(readJson(resolve(fixturesDir, 'atual.baseline.json')), 'baseline atual.json');
});

describe('contatos.json contract — live repo artifact', () => {
  assertContatosContract(readJson(resolve(repoRoot, 'contatos.json')), 'live contatos.json');
});

describe('contatos.json contract — frozen baseline fixture', () => {
  assertContatosContract(readJson(resolve(fixturesDir, 'contatos.baseline.json')), 'baseline contatos.json');
});
