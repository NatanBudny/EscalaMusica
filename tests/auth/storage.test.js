import {
  lerVinculosGoogle,
  obterNomeVinculadoPorSub,
  salvarVinculoPorSub,
} from '../../src/auth/storage.js';

// Manual localStorage mock (no jsdom needed)
const localStorageMock = (() => {
  let store = {};
  return {
    getItem:    (k) => store[k] ?? null,
    setItem:    (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear:      () => { store = {}; },
  };
})();
global.localStorage = localStorageMock;

beforeEach(() => localStorage.clear());

// ─── lerVinculosGoogle ────────────────────────────────────────────────────────

describe('lerVinculosGoogle', () => {
  test('returns an empty object when storage is empty', () => {
    expect(lerVinculosGoogle()).toEqual({});
  });

  test('returns the stored object', () => {
    localStorage.setItem('googleVinculosPorSub', JSON.stringify({ abc123: 'EMILY' }));
    expect(lerVinculosGoogle()).toEqual({ abc123: 'EMILY' });
  });

  test('returns an empty object for corrupt JSON', () => {
    localStorage.setItem('googleVinculosPorSub', '{not valid json');
    expect(lerVinculosGoogle()).toEqual({});
  });
});

// ─── obterNomeVinculadoPorSub ─────────────────────────────────────────────────

describe('obterNomeVinculadoPorSub', () => {
  test('returns the linked name for a known sub', () => {
    localStorage.setItem('googleVinculosPorSub', JSON.stringify({ sub1: 'FABRÍCIO' }));
    expect(obterNomeVinculadoPorSub('sub1')).toBe('FABRÍCIO');
  });

  test('returns empty string for an unknown sub', () => {
    expect(obterNomeVinculadoPorSub('unknownSub')).toBe('');
  });

  test('returns empty string for a null sub', () => {
    expect(obterNomeVinculadoPorSub(null)).toBe('');
  });

  test('returns empty string for an undefined sub', () => {
    expect(obterNomeVinculadoPorSub(undefined)).toBe('');
  });
});

// ─── salvarVinculoPorSub ──────────────────────────────────────────────────────

describe('salvarVinculoPorSub', () => {
  test('persists a sub→name mapping', () => {
    salvarVinculoPorSub('sub42', 'GIOVANA');
    expect(lerVinculosGoogle()['sub42']).toBe('GIOVANA');
  });

  test('does not overwrite other entries when adding a new one', () => {
    salvarVinculoPorSub('sub1', 'EMILY');
    salvarVinculoPorSub('sub2', 'ALEX');
    const v = lerVinculosGoogle();
    expect(v['sub1']).toBe('EMILY');
    expect(v['sub2']).toBe('ALEX');
  });

  test('is a no-op when sub is falsy', () => {
    salvarVinculoPorSub(null, 'EMILY');
    salvarVinculoPorSub('', 'EMILY');
    expect(lerVinculosGoogle()).toEqual({});
  });

  test('is a no-op when nomeVinculado is falsy', () => {
    salvarVinculoPorSub('sub1', null);
    salvarVinculoPorSub('sub2', '');
    expect(lerVinculosGoogle()).toEqual({});
  });

  test('round-trips through obterNomeVinculadoPorSub', () => {
    salvarVinculoPorSub('subX', 'DANY KALLAS');
    expect(obterNomeVinculadoPorSub('subX')).toBe('DANY KALLAS');
  });
});
