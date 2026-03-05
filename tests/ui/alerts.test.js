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

const alertContainer = makeEl();

global.document = {
  getElementById: (id) => id === 'alertContainer' ? alertContainer : makeEl(),
  createElement:  ()   => makeEl(),
};

// ── Imports ───────────────────────────────────────────────────────────────────

import { state }            from '../../src/state.js';
import { verificarAlertas } from '../../src/ui/alerts.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

const FIXED = new Date(2026, 2, 5); // March 5, 2026

/** Minimal schedule record with NATAN as REGENTE LOUVOR by default. */
function rec(data, nome = 'NATAN') {
  return {
    DATA: data, 'DIA SEMANA': 'Quarta',
    'REGENTE LOUVOR': nome, 'EQUIPE LOUVOR': '',
    'MENSAGEM MUSICAL': '', 'PREGADOR': '',
    'ANCIÃO': '', 'AUDIOVISUAL': '', 'SUPORTE': '',
  };
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(FIXED);
  state.dadosGlobais = [];
  state.usuarioAtual = null;
  alertContainer._html = '';
  alertContainer.children = [];
});

afterEach(() => jest.useRealTimers());

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('verificarAlertas', () => {
  test('shows no alert when user is not logged in', () => {
    state.dadosGlobais = [rec('08/03/2026')];
    verificarAlertas();
    expect(alertContainer.children).toHaveLength(0);
  });

  test('shows no alert when user has no nomeVinculado', () => {
    state.dadosGlobais = [rec('08/03/2026')];
    state.usuarioAtual = { name: 'Natan' };
    verificarAlertas();
    expect(alertContainer.children).toHaveLength(0);
  });

  test('shows no alert when user is not scheduled in any record', () => {
    state.dadosGlobais = [rec('08/03/2026', 'OUTRO')];
    state.usuarioAtual = { nomeVinculado: 'NATAN' };
    verificarAlertas();
    expect(alertContainer.children).toHaveLength(0);
  });

  test('shows no alert when next event is 8 days away', () => {
    state.dadosGlobais = [rec('13/03/2026')]; // 8 days from March 5
    state.usuarioAtual = { nomeVinculado: 'NATAN' };
    verificarAlertas();
    expect(alertContainer.children).toHaveLength(0);
  });

  test('shows alert when next event is exactly 7 days away', () => {
    state.dadosGlobais = [rec('12/03/2026')]; // 7 days from March 5
    state.usuarioAtual = { nomeVinculado: 'NATAN' };
    verificarAlertas();
    expect(alertContainer.children).toHaveLength(1);
    expect(alertContainer.children[0].innerHTML).toContain('Em 7 dias');
  });

  test('shows "Hoje" when event is today', () => {
    state.dadosGlobais = [rec('05/03/2026')];
    state.usuarioAtual = { nomeVinculado: 'NATAN' };
    verificarAlertas();
    expect(alertContainer.children[0].innerHTML).toContain('Hoje');
  });

  test('shows "Amanhã" when event is tomorrow', () => {
    state.dadosGlobais = [rec('06/03/2026')];
    state.usuarioAtual = { nomeVinculado: 'NATAN' };
    verificarAlertas();
    expect(alertContainer.children[0].innerHTML).toContain('Amanhã');
  });

  test('shows "Em N dias" for an event N days away (N=3)', () => {
    state.dadosGlobais = [rec('08/03/2026')]; // 3 days from March 5
    state.usuarioAtual = { nomeVinculado: 'NATAN' };
    verificarAlertas();
    expect(alertContainer.children[0].innerHTML).toContain('Em 3 dias');
  });

  test('includes the record date in the alert text', () => {
    state.dadosGlobais = [rec('10/03/2026')];
    state.usuarioAtual = { nomeVinculado: 'NATAN' };
    verificarAlertas();
    expect(alertContainer.children[0].innerHTML).toContain('10/03/2026');
  });

  test('uses only the nearest upcoming record', () => {
    state.dadosGlobais = [rec('08/03/2026'), rec('10/03/2026')];
    state.usuarioAtual = { nomeVinculado: 'NATAN' };
    verificarAlertas();
    expect(alertContainer.children[0].innerHTML).toContain('08/03/2026');
    expect(alertContainer.children[0].innerHTML).not.toContain('10/03/2026');
  });

  test('clears a previous alert before each render', () => {
    state.dadosGlobais = [rec('08/03/2026')];
    state.usuarioAtual = { nomeVinculado: 'NATAN' };
    verificarAlertas();
    verificarAlertas();
    expect(alertContainer.children).toHaveLength(1);
  });

  test('banner element has class "alert-banner success"', () => {
    state.dadosGlobais = [rec('08/03/2026')];
    state.usuarioAtual = { nomeVinculado: 'NATAN' };
    verificarAlertas();
    expect(alertContainer.children[0].className).toBe('alert-banner success');
  });
});
