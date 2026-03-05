import { jest } from '@jest/globals';

// ── Globals (set before test suite runs) ──────────────────────────────────────

const _ls = {};
global.localStorage = {
  getItem:    (k) => _ls[k] ?? null,
  setItem:    (k, v) => { _ls[k] = v; },
  removeItem: (k) => { delete _ls[k]; },
};

const offlineEl = { style: { display: '' } };
global.document = { getElementById: (id) => id === 'offlineIndicator' ? offlineEl : null };

// ── Imports ───────────────────────────────────────────────────────────────────

import { carregarCSV }  from '../../src/data/loader.js';
import { state }        from '../../src/state.js';
import { STORAGE_KEYS } from '../../src/config.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const DADOS    = [{ DATA: '01/04/2026', REGENTE: 'NATAN' }];
const CONTATOS = { NATAN: { telefone: 'https://wa.me/123', apelidos: [] } };

// ── Suite ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  Object.keys(_ls).forEach((k) => delete _ls[k]);
  state.dadosGlobais = [];
  state.contatosMap  = {};
  offlineEl.style.display = '';
});

describe('carregarCSV — success', () => {
  test('populates state.dadosGlobais and state.contatosMap', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ json: async () => DADOS })
      .mockResolvedValueOnce({ json: async () => CONTATOS });

    await carregarCSV();

    expect(state.dadosGlobais).toEqual(DADOS);
    expect(state.contatosMap).toEqual(CONTATOS);
  });

  test('caches both payloads in localStorage', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ json: async () => DADOS })
      .mockResolvedValueOnce({ json: async () => CONTATOS });

    await carregarCSV();

    expect(JSON.parse(_ls[STORAGE_KEYS.CACHE_DADOS])).toEqual(DADOS);
    expect(JSON.parse(_ls[STORAGE_KEYS.CACHE_CONTATOS])).toEqual(CONTATOS);
  });

  test('hides the offline indicator', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ json: async () => DADOS })
      .mockResolvedValueOnce({ json: async () => CONTATOS });

    await carregarCSV();

    expect(offlineEl.style.display).toBe('none');
  });

  test('URL includes a cache-busting timestamp for both files', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ json: async () => DADOS })
      .mockResolvedValueOnce({ json: async () => CONTATOS });

    await carregarCSV();

    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('atual.json?t='));
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('contatos.json?t='));
  });
});

describe('carregarCSV — offline fallback', () => {
  test('loads from cache and shows offline badge when network fails', async () => {
    _ls[STORAGE_KEYS.CACHE_DADOS]    = JSON.stringify(DADOS);
    _ls[STORAGE_KEYS.CACHE_CONTATOS] = JSON.stringify(CONTATOS);
    global.fetch = jest.fn().mockRejectedValue(new Error('offline'));

    await carregarCSV();

    expect(state.dadosGlobais).toEqual(DADOS);
    expect(state.contatosMap).toEqual(CONTATOS);
    expect(offlineEl.style.display).toBe('inline-block');
  });

  test('leaves state empty and does not show badge when cache is absent', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('offline'));

    await carregarCSV();

    expect(state.dadosGlobais).toEqual([]);
    expect(state.contatosMap).toEqual({});
    expect(offlineEl.style.display).toBe('');
  });
});
