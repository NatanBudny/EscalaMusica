import { jest } from '@jest/globals';

// ── DOM mock ──────────────────────────────────────────────────────────────────
// Needs to cover all elements used by renderizar → montarTabela + montarCards + verificarAlertas

function makeEl(opts = {}) {
  const el = {
    _html: '',
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = v; if (v === '') this.children = []; },
    className: '',
    style: {},
    dataset: {},
    value: '',
    textContent: '',
    options: [{ text: 'Todos' }],
    onchange: null,
    children: [],
    classList: {
      _s: new Set(),
      contains(c) { return this._s.has(c); },
      add(c) { this._s.add(c); },
    },
    appendChild(child) { this.children.push(child); return child; },
  };
  return Object.assign(el, opts);
}

// Persistent elements shared across all renderers
const tableBody       = makeEl();
const containerFuturo = makeEl();
const containerPassado = makeEl();
const pastDivider     = makeEl();
const alertContainer  = makeEl();
const searchInput     = makeEl({ value: '' });

const _idMap = { tableBody, containerFuturo, containerPassado, pastDivider, alertContainer, searchInput };

// Selects returned by querySelectorAll — tests set this before each assertion
let _selects = [];

global.document = {
  getElementById:  (id)  => _idMap[id] ?? makeEl(),
  querySelectorAll: (sel) => sel === '#filtros select' ? _selects : [],
  createElement:   ()    => makeEl(),
};

// ── Imports ───────────────────────────────────────────────────────────────────

import { state }                       from '../../src/state.js';
import { montarFiltros, aplicarFiltros } from '../../src/ui/filters.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

const FIXED = new Date(2026, 2, 5); // March 5, 2026

function rec(data, dia, acomp, extra = {}) {
  return {
    DATA: data, 'DIA SEMANA': dia, ACOMP: acomp,
    'REGENTE LOUVOR': 'GIOVANA', 'EQUIPE LOUVOR': 'EMILY',
    'MENSAGEM MUSICAL': '', AUDIOVISUAL: '', SUPORTE: '',
    'ANCIÃO': 'ADELMO', PREGADOR: 'CLEVERSON',
    'LOUVORES ES': '', 'LOUVORES CULTO': '', 'TEMA CULTO': '', OBS: '',
    ...extra,
  };
}

const dados = [
  rec('10/03/2026', 'Terça',  'BANDA'),
  rec('14/03/2026', 'Sábado', 'PB'),
  rec('17/03/2026', 'Terça',  'BANDA'),
];

function resetContainers() {
  for (const el of [tableBody, containerFuturo, containerPassado, alertContainer]) {
    el._html = ''; el.children = [];
  }
  pastDivider.style = {};
  searchInput.value = '';
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(FIXED);
  state.dadosGlobais = [...dados];
  state.contatosMap  = {};
  state.usuarioAtual = null;
  _selects = [];
  resetContainers();
});

afterEach(() => jest.useRealTimers());

// ── montarFiltros ─────────────────────────────────────────────────────────────

describe('montarFiltros', () => {
  test('creates one option per distinct value for each select', () => {
    const sDia   = makeEl({ dataset: { col: 'DIA SEMANA' }, options: [{ text: 'Todos os dias' }] });
    const sAcomp = makeEl({ dataset: { col: 'ACOMP' },      options: [{ text: 'Todos' }] });
    _selects = [sDia, sAcomp];

    montarFiltros(dados);

    // Terça and Sábado → 2 distinct
    expect(sDia.children).toHaveLength(2);
    // BANDA and PB → 2 distinct
    expect(sAcomp.children).toHaveLength(2);
  });

  test('DATA column is sorted chronologically', () => {
    const s = makeEl({ dataset: { col: 'DATA' }, options: [{ text: 'Todas' }] });
    _selects = [s];

    montarFiltros([rec('17/03/2026', 'Terça', 'BANDA'), rec('10/03/2026', 'Terça', 'BANDA')]);

    expect(s.children[0].value).toBe('10/03/2026');
    expect(s.children[1].value).toBe('17/03/2026');
  });

  test('non-DATA columns are sorted alphabetically', () => {
    const s = makeEl({ dataset: { col: 'ACOMP' }, options: [{ text: 'Todos' }] });
    _selects = [s];

    montarFiltros([rec('10/03/2026', 'Terça', 'PB'), rec('17/03/2026', 'Terça', 'BANDA')]);

    expect(s.children[0].value).toBe('BANDA');
    expect(s.children[1].value).toBe('PB');
  });

  test('assigns a function as onchange handler', () => {
    const s = makeEl({ dataset: { col: 'ACOMP' }, options: [{ text: 'Todos' }] });
    _selects = [s];

    montarFiltros(dados);

    expect(typeof s.onchange).toBe('function');
  });

  test('skips columns where all values are empty', () => {
    const s = makeEl({ dataset: { col: 'MENSAGEM MUSICAL' }, options: [{ text: 'Todos' }] });
    _selects = [s];

    montarFiltros(dados); // all records have '' for MENSAGEM MUSICAL

    expect(s.children).toHaveLength(0);
  });

  test('added options carry correct value', () => {
    const s = makeEl({ dataset: { col: 'DIA SEMANA' }, options: [{ text: 'Todos' }] });
    _selects = [s];

    montarFiltros([rec('14/03/2026', 'Sábado', 'PB')]);

    expect(s.children[0].value).toBe('Sábado');
  });
});

// ── aplicarFiltros ────────────────────────────────────────────────────────────
// Counts rows in tableBody (montarTabela appends one <tr> per record) to verify
// that the correct subset reaches the renderer.

describe('aplicarFiltros', () => {
  test('renders all records when no filter is active', () => {
    _selects = [makeEl({ dataset: { col: 'ACOMP' }, value: '' })];
    aplicarFiltros();
    expect(tableBody.children).toHaveLength(3);
  });

  test('filters records by an exact column value', () => {
    _selects = [makeEl({ dataset: { col: 'ACOMP' }, value: 'PB' })];
    aplicarFiltros();
    expect(tableBody.children).toHaveLength(1);
  });

  test('EQUIPE LOUVOR uses substring matching (not strict equality)', () => {
    state.dadosGlobais = [
      rec('10/03/2026', 'Terça', 'BANDA', { 'EQUIPE LOUVOR': 'EMILY, KHEYCIANE' }),
      rec('17/03/2026', 'Terça', 'BANDA', { 'EQUIPE LOUVOR': 'GIOVANA, JESSÉ' }),
    ];
    _selects = [makeEl({ dataset: { col: 'EQUIPE LOUVOR' }, value: 'EMILY' })];
    aplicarFiltros();
    expect(tableBody.children).toHaveLength(1);
  });

  test('search text filters across all searchable fields', () => {
    _selects = [];
    searchInput.value = 'Adelmo'; // matches ANCIÃO field in all 3 records
    aplicarFiltros();
    expect(tableBody.children).toHaveLength(3);
  });

  test('unmatched search returns no records', () => {
    _selects = [];
    searchInput.value = 'XYZNOTHERE';
    aplicarFiltros();
    expect(tableBody.children).toHaveLength(0);
  });

  test('column filter and search are combined with AND logic', () => {
    state.dadosGlobais = [
      rec('10/03/2026', 'Terça',  'BANDA', { 'REGENTE LOUVOR': 'NATAN',   'EQUIPE LOUVOR': 'PEDRO' }),
      rec('14/03/2026', 'Sábado', 'PB',   { 'REGENTE LOUVOR': 'NATAN',   'EQUIPE LOUVOR': 'PEDRO' }),
      rec('17/03/2026', 'Terça',  'BANDA', { 'REGENTE LOUVOR': 'GIOVANA', 'EQUIPE LOUVOR': 'JESSICA' }),
    ];
    _selects = [makeEl({ dataset: { col: 'ACOMP' }, value: 'BANDA' })];
    searchInput.value = 'NATAN';
    aplicarFiltros();
    // BANDA + NATAN: record 1 passes; record 2 excluded by ACOMP; record 3 excluded by search
    expect(tableBody.children).toHaveLength(1);
  });

  test('multiple active selects narrow the result set', () => {
    _selects = [
      makeEl({ dataset: { col: 'ACOMP' },      value: 'BANDA' }),
      makeEl({ dataset: { col: 'DIA SEMANA' },  value: 'Terça' }),
    ];
    aplicarFiltros();
    // 2 BANDA records, both on Terça
    expect(tableBody.children).toHaveLength(2);
  });
});
