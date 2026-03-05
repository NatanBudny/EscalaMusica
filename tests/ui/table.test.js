import { jest } from '@jest/globals';

// ── DOM mock ──────────────────────────────────────────────────────────────────

function makeEl() {
  return {
    _html: '',
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = v; if (v === '') this.children = []; },
    className: '',
    style: {},
    children: [],
    appendChild(child) { this.children.push(child); return child; },
  };
}

const tableBody = makeEl();

global.document = {
  getElementById: (id) => id === 'tableBody' ? tableBody : makeEl(),
  createElement:  ()   => makeEl(),
};

// ── Imports ───────────────────────────────────────────────────────────────────

import { state }        from '../../src/state.js';
import { montarTabela } from '../../src/ui/table.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function rec(data, extra = {}) {
  return {
    DATA: data, 'DIA SEMANA': 'Quarta', ACOMP: 'BANDA',
    'REGENTE LOUVOR': 'GIOVANA', 'EQUIPE LOUVOR': 'EMILY',
    'MENSAGEM MUSICAL': '', AUDIOVISUAL: 'ALEX',
    'ANCIÃO': 'ADELMO', PREGADOR: 'CLEVERSON',
    'LOUVORES ES': 'Músicas ES', 'LOUVORES CULTO': 'Músicas Culto',
    'TEMA CULTO': 'O Amor de Deus', ...extra,
  };
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(2026, 2, 5)); // March 5, 2026
  state.contatosMap  = {};
  state.usuarioAtual = null;
  tableBody._html = '';
  tableBody.children = [];
});

afterEach(() => jest.useRealTimers());

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('montarTabela', () => {
  test('renders no rows for an empty array', () => {
    montarTabela([]);
    expect(tableBody.children).toHaveLength(0);
  });

  test('renders one row per record', () => {
    montarTabela([rec('10/03/2026'), rec('17/03/2026'), rec('24/03/2026')]);
    expect(tableBody.children).toHaveLength(3);
  });

  test('past record gets opacity 0.5', () => {
    montarTabela([rec('01/03/2026')]); // before March 5
    expect(tableBody.children[0].style.opacity).toBe('0.5');
  });

  test('future record does not get dimmed', () => {
    montarTabela([rec('10/03/2026')]);
    expect(tableBody.children[0].style.opacity).toBeUndefined();
  });

  test('row HTML contains the record date', () => {
    montarTabela([rec('10/03/2026')]);
    expect(tableBody.children[0].innerHTML).toContain('10/03/2026');
  });

  test('row HTML contains the day-of-week', () => {
    montarTabela([rec('10/03/2026', { 'DIA SEMANA': 'Sábado' })]);
    expect(tableBody.children[0].innerHTML).toContain('Sábado');
  });

  test('row HTML contains the ACOMP field', () => {
    montarTabela([rec('10/03/2026', { ACOMP: 'PB' })]);
    expect(tableBody.children[0].innerHTML).toContain('PB');
  });

  test('row HTML contains the culto theme', () => {
    montarTabela([rec('10/03/2026', { 'TEMA CULTO': 'Fé e Graça' })]);
    expect(tableBody.children[0].innerHTML).toContain('Fé e Graça');
  });

  test('row HTML contains the regente name', () => {
    montarTabela([rec('10/03/2026')]);
    expect(tableBody.children[0].innerHTML).toContain('GIOVANA');
  });

  test('clears previous rows before re-render', () => {
    montarTabela([rec('10/03/2026')]);
    montarTabela([]);
    expect(tableBody.children).toHaveLength(0);
  });
});
