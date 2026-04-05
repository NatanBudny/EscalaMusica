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
    classList: {
      _s: new Set(),
      contains(c) { return this._s.has(c); },
      add(c) { this._s.add(c); },
    },
    appendChild(child) { this.children.push(child); return child; },
  };
}

const containerFuturo  = makeEl();
const containerPassado = makeEl();
const pastDivider      = makeEl();

global.document = {
  getElementById: (id) => {
    if (id === 'containerFuturo')  return containerFuturo;
    if (id === 'containerPassado') return containerPassado;
    if (id === 'pastDivider')      return pastDivider;
    return makeEl();
  },
  createElement: () => makeEl(),
};

// ── Imports ───────────────────────────────────────────────────────────────────

import { state }      from '../../src/state.js';
import { montarCards } from '../../src/ui/cards.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

const FIXED = new Date(2026, 2, 5); // March 5, 2026

function rec(data, extra = {}) {
  return {
    DATA: data, 'DIA SEMANA': 'Quarta', ACOMP: 'BANDA',
    'REGENTE LOUVOR': 'GIOVANA', 'EQUIPE LOUVOR': 'EMILY',
    'MENSAGEM MUSICAL': '', AUDIOVISUAL: 'ALEX', SUPORTE: '',
    'ANCIÃO': 'ADELMO', PREGADOR: 'CLEVERSON',
    'LOUVORES ES': '', 'LOUVORES CULTO': '', 'TEMA CULTO': '', OBS: '',
    ...extra,
  };
}

function resetContainers() {
  for (const el of [containerFuturo, containerPassado]) {
    el._html = ''; el.children = [];
  }
  pastDivider.style = {};
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(FIXED);
  state.contatosMap  = {};
  state.usuarioAtual = null;
  resetContainers();
});

afterEach(() => jest.useRealTimers());

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('montarCards', () => {
  test('appends future records to containerFuturo', () => {
    montarCards([rec('10/03/2026'), rec('17/03/2026')]);
    expect(containerFuturo.children).toHaveLength(2);
    expect(containerPassado.children).toHaveLength(0);
  });

  test('appends past records to containerPassado', () => {
    montarCards([rec('01/03/2026'), rec('03/03/2026')]);
    expect(containerPassado.children).toHaveLength(2);
    expect(containerFuturo.children).toHaveLength(0);
  });

  test('past card has "past-card" class', () => {
    montarCards([rec('01/03/2026')]);
    expect(containerPassado.children[0].className).toContain('past-card');
  });

  test('future card does not have "past-card" class', () => {
    montarCards([rec('10/03/2026')]);
    expect(containerFuturo.children[0].className).not.toContain('past-card');
  });

  test('card HTML contains the formatted date', () => {
    montarCards([rec('10/03/2026')]);
    // formatarDataExtenso converts '10/03/2026' → '10 de março'
    expect(containerFuturo.children[0].innerHTML).toContain('10 de mar');
  });

  test('card HTML contains the day-of-week', () => {
    montarCards([rec('10/03/2026', { 'DIA SEMANA': 'Sábado' })]);
    expect(containerFuturo.children[0].innerHTML).toContain('Sábado');
  });

  test('agenda button appears for user\'s own future record', () => {
    state.usuarioAtual = { nomeVinculado: 'EMILY' };
    montarCards([rec('10/03/2026')]);
    expect(containerFuturo.children[0].innerHTML).toContain('exportarParaAgenda');
  });

  test('no agenda button for user\'s past record', () => {
    state.usuarioAtual = { nomeVinculado: 'EMILY' };
    montarCards([rec('01/03/2026')]);
    expect(containerPassado.children[0].innerHTML).not.toContain('exportarParaAgenda');
  });

  test('no agenda button when user is not in the record', () => {
    state.usuarioAtual = { nomeVinculado: 'OUTRO' };
    montarCards([rec('10/03/2026')]);
    expect(containerFuturo.children[0].innerHTML).not.toContain('exportarParaAgenda');
  });

  test('pastDivider is hidden when there are no past records', () => {
    montarCards([rec('10/03/2026')]);
    expect(pastDivider.style.display).toBe('none');
  });

  test('mixed records go to correct containers', () => {
    montarCards([rec('01/03/2026'), rec('10/03/2026'), rec('17/03/2026'), rec('03/03/2026')]);
    expect(containerFuturo.children).toHaveLength(2);
    expect(containerPassado.children).toHaveLength(2);
  });

  test('clears both containers before re-render', () => {
    montarCards([rec('10/03/2026')]);
    montarCards([]);
    expect(containerFuturo.children).toHaveLength(0);
    expect(containerPassado.children).toHaveLength(0);
  });
});
