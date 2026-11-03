/**
 * Baseline integration test for the current Visualizador_Atual pipeline.
 *
 * It wires the real viewer modules together over frozen fixtures and locks the
 * observable behaviour of: loading atual.json/contatos.json, offline cache,
 * table rendering, card rendering, filters, agenda export details, contact
 * lookup, and the Google-login name-linking path.
 *
 * The goal is a regression baseline: if a future scaffold changes any of these
 * behaviours, this suite fails. It performs no network, no writes, no publish.
 *
 * Spec: gestao-leiga-de-escalas / Task 1.2
 * Requirements: 9.1, 9.2, 9.3, 11.13, 16.1, 16.8
 */

import { jest } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(__dirname, '../fixtures/baseline');

const ATUAL = JSON.parse(readFileSync(resolve(fixturesDir, 'atual.baseline.json'), 'utf8'));
const CONTATOS = JSON.parse(readFileSync(resolve(fixturesDir, 'contatos.baseline.json'), 'utf8'));

// ── Minimal DOM mock (no jsdom) ───────────────────────────────────────────────

function makeEl() {
  return {
    _html: '',
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = v; if (v === '') this.children = []; },
    className: '',
    dataset: {},
    style: {},
    options: [{ text: 'Todos' }],
    value: '',
    children: [],
    onchange: null,
    classList: { contains: () => false, add() {}, remove() {} },
    appendChild(child) { this.children.push(child); return child; },
  };
}

const els = {
  tableBody: makeEl(),
  containerFuturo: makeEl(),
  containerPassado: makeEl(),
  pastDivider: makeEl(),
  alertContainer: makeEl(),
  offlineIndicator: makeEl(),
  searchInput: makeEl(),
};

// filter selects — one per schedule column used by montarFiltros
const filterSelects = [];
function makeSelect(col) {
  const s = makeEl();
  s.dataset.col = col;
  filterSelects.push(s);
  return s;
}
['DATA', 'DIA SEMANA', 'REGENTE LOUVOR', 'EQUIPE LOUVOR'].forEach(makeSelect);

global.document = {
  getElementById: (id) => els[id] ?? makeEl(),
  querySelectorAll: (sel) => (sel === '#filtros select' ? filterSelects : []),
  createElement: () => makeEl(),
};

const _ls = {};
global.localStorage = {
  getItem: (k) => _ls[k] ?? null,
  setItem: (k, v) => { _ls[k] = String(v); },
  removeItem: (k) => { delete _ls[k]; },
};

// ── Imports (after globals) ───────────────────────────────────────────────────

const { state } = await import('../../src/state.js');
const { STORAGE_KEYS } = await import('../../src/config.js');
const { carregarCSV } = await import('../../src/data/loader.js');
const { aplicarFiltroAutomatico, aplicarFiltros } = await import('../../src/ui/filters.js');
const { getDetalhesAgenda } = await import('../../src/business/agenda.js');
const { buscarContato } = await import('../../src/utils/contact.js');
const { salvarVinculoPorSub, obterNomeVinculadoPorSub } = await import('../../src/auth/storage.js');

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(2026, 7, 7)); // 07/08/2026 — between the 3 fixture dates
  Object.keys(_ls).forEach((k) => delete _ls[k]);
  state.dadosGlobais = [];
  state.contatosMap = {};
  state.usuarioAtual = null;
  Object.values(els).forEach((el) => { el._html = ''; el.children = []; el.style = {}; });
  els.searchInput.value = '';
  els.offlineIndicator.style = {};
  filterSelects.forEach((s) => { s.value = ''; s._html = ''; s.children = []; });
});

afterEach(() => jest.useRealTimers());

function mockFetchOk() {
  global.fetch = jest.fn()
    .mockResolvedValueOnce({ json: async () => ATUAL })
    .mockResolvedValueOnce({ json: async () => CONTATOS });
}

// ── Loading + cache ───────────────────────────────────────────────────────────

describe('baseline — load atual.json/contatos.json', () => {
  test('populates global state from the fixtures', async () => {
    mockFetchOk();
    await carregarCSV();
    expect(state.dadosGlobais).toHaveLength(3);
    expect(state.contatosMap).toHaveProperty('ANDRE');
    expect(els.offlineIndicator.style.display).toBe('none');
  });

  test('writes both payloads to the offline cache', async () => {
    mockFetchOk();
    await carregarCSV();
    expect(JSON.parse(_ls[STORAGE_KEYS.CACHE_DADOS])).toHaveLength(3);
    expect(JSON.parse(_ls[STORAGE_KEYS.CACHE_CONTATOS]).ALEX.telefone).toContain('wa.me');
  });

  test('offline fallback restores from cache and flags offline', async () => {
    _ls[STORAGE_KEYS.CACHE_DADOS] = JSON.stringify(ATUAL);
    _ls[STORAGE_KEYS.CACHE_CONTATOS] = JSON.stringify(CONTATOS);
    global.fetch = jest.fn().mockRejectedValue(new Error('offline'));
    await carregarCSV();
    expect(state.dadosGlobais).toHaveLength(3);
    expect(els.offlineIndicator.style.display).toBe('inline-block');
  });
});

// ── Table + cards rendering ─────────────────────────────────────────────────

describe('baseline — table and cards render all records', () => {
  beforeEach(async () => {
    mockFetchOk();
    await carregarCSV();
    aplicarFiltroAutomatico();
  });

  test('table body has one row per fixture record', () => {
    expect(els.tableBody.children).toHaveLength(3);
  });

  test('future + today cards go to containerFuturo, past to containerPassado', () => {
    // 05/08 is past (before 07/08); 08/08 and 09/08 are future
    expect(els.containerPassado.children).toHaveLength(1);
    expect(els.containerFuturo.children).toHaveLength(2);
  });

  test('table renders regente name and theme from fixture', () => {
    const html = els.tableBody.children.map((r) => r.innerHTML).join('');
    expect(html).toContain('ANDRÉ');
    expect(html).toContain('A GRAÇA DE DEUS');
  });

  test('contact names become wa.me links in rendered output', () => {
    const html = els.tableBody.children.map((r) => r.innerHTML).join('');
    expect(html).toContain('https://wa.me/5543920008370'); // ANDRE
  });
});

// ── Filters ───────────────────────────────────────────────────────────────────

describe('baseline — filters', () => {
  beforeEach(async () => {
    mockFetchOk();
    await carregarCSV();
    aplicarFiltroAutomatico();
  });

  test('montarFiltros populates DIA SEMANA select with distinct values', () => {
    const diaSelect = filterSelects.find((s) => s.dataset.col === 'DIA SEMANA');
    const vals = diaSelect.children.map((o) => o.value);
    expect(vals).toEqual(expect.arrayContaining(['quarta-feira', 'sábado', 'domingo']));
  });

  test('selecting a DIA SEMANA value narrows the rendered table', () => {
    const diaSelect = filterSelects.find((s) => s.dataset.col === 'DIA SEMANA');
    diaSelect.value = 'domingo';
    aplicarFiltros();
    expect(els.tableBody.children).toHaveLength(1);
  });

  test('EQUIPE LOUVOR filter matches substring within the team list', () => {
    const equipeSelect = filterSelects.find((s) => s.dataset.col === 'EQUIPE LOUVOR');
    equipeSelect.value = 'ARIADNY';
    aplicarFiltros();
    expect(els.tableBody.children).toHaveLength(1); // 08/08 team contains ARIADNY
  });

  test('search input filters by name across fields', () => {
    els.searchInput.value = 'YASSER';
    aplicarFiltros();
    expect(els.tableBody.children).toHaveLength(1); // ancião YASSER on 09/08
  });
});

// ── Agenda export details ─────────────────────────────────────────────────────

describe('baseline — agenda role detection', () => {
  test('detects regente role and includes culto theme', () => {
    const rec = ATUAL.find((r) => r.DATA === '09/08/2026');
    const det = getDetalhesAgenda(rec, 'FABRÍCIO');
    expect(det.papel).toContain('REGÊNCIA NA CENTRAL');
    expect(det.descricao).toContain('A GRAÇA DE DEUS');
  });

  test('detects a team member inside a comma-separated list', () => {
    const rec = ATUAL.find((r) => r.DATA === '08/08/2026');
    const det = getDetalhesAgenda(rec, 'ARIADNY');
    expect(det.papel).toContain('CANTAR LOUVOR');
  });

  test('falls back to generic role when name is not scheduled', () => {
    const rec = ATUAL.find((r) => r.DATA === '08/08/2026');
    const det = getDetalhesAgenda(rec, 'NINGUÉM');
    expect(det.papel).toBe('ESCALA NA CENTRAL');
  });
});

// ── Contacts lookup ───────────────────────────────────────────────────────────

describe('baseline — contact lookup', () => {
  test('resolves a contact by exact canonical name', () => {
    expect(buscarContato(CONTATOS, 'ALEX').telefone).toBe('https://wa.me/554396849723');
  });

  test('resolves a contact by alias (diacritics-insensitive)', () => {
    expect(buscarContato(CONTATOS, 'DANI')).toBe(CONTATOS['DANY KALLAS']);
  });

  test('returns null for an unknown name', () => {
    expect(buscarContato(CONTATOS, 'DESCONHECIDO')).toBeNull();
  });
});

// ── Google login name-linking path ────────────────────────────────────────────

describe('baseline — Google login name binding', () => {
  test('persisted sub→name binding round-trips', () => {
    salvarVinculoPorSub('google-sub-1', 'NATAN');
    expect(obterNomeVinculadoPorSub('google-sub-1')).toBe('NATAN');
  });

  test('linked user name is highlighted in the rendered table', async () => {
    mockFetchOk();
    await carregarCSV();
    state.usuarioAtual = { nomeVinculado: 'FABRÍCIO', sub: 'google-sub-1' };
    aplicarFiltroAutomatico();
    const html = els.tableBody.children.map((r) => r.innerHTML).join('');
    expect(html).toContain('highlight-me');
  });

  test('alert banner appears for a linked user scheduled within 7 days', async () => {
    mockFetchOk();
    await carregarCSV();
    state.usuarioAtual = { nomeVinculado: 'FABRÍCIO', sub: 'google-sub-1' };
    aplicarFiltroAutomatico();
    expect(els.alertContainer.children.length).toBeGreaterThan(0);
  });
});
