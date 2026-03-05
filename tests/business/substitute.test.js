import { jest } from '@jest/globals';
import { gerarLinkSubstituto } from '../../src/business/substitute.js';

const FIXED_DATE = new Date(2026, 2, 5); // March 5, 2026

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(FIXED_DATE);
});
afterEach(() => jest.useRealTimers());

const contatosMap = {
  'GIOVANA':  { telefone: 'https://wa.me/5543984876102', apelidos: [] },
  'ADELMO':   { telefone: 'https://wa.me/554399512450',  apelidos: [] },
  'NATAN':    { telefone: 'https://wa.me/5543999990001', apelidos: [] },
  'YASSER':   { telefone: 'https://wa.me/5543999990002', apelidos: [] },
  'ALEX':     { telefone: 'https://wa.me/5543999990003', apelidos: [] },
};

const futureRecord = {
  'DATA':           '15/03/2026',
  'REGENTE LOUVOR': 'GIOVANA',
  'EQUIPE LOUVOR':  'EMILY, NATAN',
  'ANCIÃO':         'ADELMO',
  'PREGADOR':       'CLEVERSON',
  'MENSAGEM MUSICAL': '', 'AUDIOVISUAL': '', 'SUPORTE': '',
};

describe('gerarLinkSubstituto', () => {
  test('returns empty string when usuarioAtual is null', () => {
    expect(gerarLinkSubstituto(contatosMap, null, futureRecord)).toBe('');
  });

  test('returns empty string when usuarioAtual has no nomeVinculado', () => {
    expect(gerarLinkSubstituto(contatosMap, { name: 'Test' }, futureRecord)).toBe('');
  });

  test('returns empty string when user is not scheduled in this record', () => {
    const usuario = { nomeVinculado: 'ALEX' };
    expect(gerarLinkSubstituto(contatosMap, usuario, futureRecord)).toBe('');
  });

  test('returns empty string for a past date', () => {
    const pastRecord = { ...futureRecord, 'DATA': '01/03/2026' }; // before March 5
    const usuario = { nomeVinculado: 'EMILY' };
    expect(gerarLinkSubstituto(contatosMap, usuario, pastRecord)).toBe('');
  });

  test('generates a valid anchor when all conditions are met (user in equipe)', () => {
    const usuario = { nomeVinculado: 'EMILY' };
    const html = gerarLinkSubstituto(contatosMap, usuario, futureRecord);
    expect(html).toContain('<a');
    expect(html).toContain('btn-substituto');
    expect(html).toContain('api.whatsapp.com');
  });

  test('contact link targets the regente first', () => {
    const usuario = { nomeVinculado: 'EMILY' };
    const html = gerarLinkSubstituto(contatosMap, usuario, futureRecord);
    // GIOVANA is the regente — her phone digits should appear
    expect(html).toContain('5543984876102');
  });

  test('falls back to louvor coordinator (NATAN) when regente has no contact', () => {
    const mapWithoutGiovana = { 'NATAN': contatosMap['NATAN'], 'ADELMO': contatosMap['ADELMO'] };
    const usuario = { nomeVinculado: 'EMILY' };
    const html = gerarLinkSubstituto(mapWithoutGiovana, usuario, futureRecord);
    expect(html).toContain('5543999990001');
  });

  test('returns empty string when regente and louvor coordinator both have no contact', () => {
    const usuario = { nomeVinculado: 'EMILY' };
    expect(gerarLinkSubstituto({}, usuario, futureRecord)).toBe('');
  });

  test('message includes the record date', () => {
    const usuario = { nomeVinculado: 'NATAN' };
    const html = gerarLinkSubstituto(contatosMap, usuario, futureRecord);
    expect(html).toContain(encodeURIComponent('15/03/2026'));
  });
});

// ── Additional role branches ───────────────────────────────────────────────────

const baseRecord = (overrides) => ({
  DATA: '15/03/2026', 'DIA SEMANA': 'Domingo',
  'REGENTE LOUVOR': '', 'EQUIPE LOUVOR': '',
  'MENSAGEM MUSICAL': '', 'PREGADOR': '',
  'ANCIÃO': 'ADELMO', 'AUDIOVISUAL': '', 'SUPORTE': '',
  ...overrides,
});

describe('role: MENSAGEM MUSICAL', () => {
  const r = baseRecord({ 'MENSAGEM MUSICAL': 'PEDRO', 'ANCIÃO': '' });

  test('notifies louvor coordinator (NATAN)', () => {
    const html = gerarLinkSubstituto(contatosMap, { nomeVinculado: 'PEDRO' }, r);
    expect(html).toContain('5543999990001');
  });

  test('message mentions mensagem musical', () => {
    const html = gerarLinkSubstituto(contatosMap, { nomeVinculado: 'PEDRO' }, r);
    expect(html).toContain(encodeURIComponent('mensagem musical'));
  });

  test('returns empty when coordinator has no contact', () => {
    const html = gerarLinkSubstituto({}, { nomeVinculado: 'PEDRO' }, r);
    expect(html).toBe('');
  });
});

describe('role: PREGADOR', () => {
  const r = baseRecord({ 'PREGADOR': 'CLEVERSON' });

  test('notifies the scheduled ancião directly', () => {
    const html = gerarLinkSubstituto(contatosMap, { nomeVinculado: 'CLEVERSON' }, r);
    expect(html).toContain('554399512450'); // ADELMO
  });

  test('falls back to YASSER when ancião has no contact', () => {
    const noAdelmo = { 'YASSER': contatosMap['YASSER'] };
    const html = gerarLinkSubstituto(noAdelmo, { nomeVinculado: 'CLEVERSON' }, r);
    expect(html).toContain('5543999990002'); // YASSER
  });

  test('returns empty when neither ancião nor YASSER has a contact', () => {
    const html = gerarLinkSubstituto({}, { nomeVinculado: 'CLEVERSON' }, r);
    expect(html).toBe('');
  });
});

describe('role: ANCIÃO', () => {
  const r = baseRecord({ 'ANCIÃO': 'ADELMO' });

  test('notifies YASSER coordinator', () => {
    const html = gerarLinkSubstituto(contatosMap, { nomeVinculado: 'ADELMO' }, r);
    expect(html).toContain('5543999990002'); // YASSER
  });

  test('returns empty when YASSER has no contact', () => {
    const noYasser = { 'ADELMO': contatosMap['ADELMO'] };
    const html = gerarLinkSubstituto(noYasser, { nomeVinculado: 'ADELMO' }, r);
    expect(html).toBe('');
  });

  test('message mentions ancião de culto', () => {
    const html = gerarLinkSubstituto(contatosMap, { nomeVinculado: 'ADELMO' }, r);
    expect(html).toContain(encodeURIComponent('ancião de culto'));
  });
});

describe('role: AUDIOVISUAL', () => {
  const r = baseRecord({ 'AUDIOVISUAL': 'PEDRO', 'ANCIÃO': '' });

  test('notifies ALEX coordinator', () => {
    const html = gerarLinkSubstituto(contatosMap, { nomeVinculado: 'PEDRO' }, r);
    expect(html).toContain('5543999990003'); // ALEX
  });

  test('returns empty when ALEX has no contact', () => {
    const noAlex = { 'NATAN': contatosMap['NATAN'] };
    const html = gerarLinkSubstituto(noAlex, { nomeVinculado: 'PEDRO' }, r);
    expect(html).toBe('');
  });
});

describe('role: SUPORTE', () => {
  const r = baseRecord({ 'SUPORTE': 'PEDRO', 'ANCIÃO': '' });

  test('also routes to ALEX coordinator', () => {
    const html = gerarLinkSubstituto(contatosMap, { nomeVinculado: 'PEDRO' }, r);
    expect(html).toContain('5543999990003'); // ALEX
  });

  test('message mentions audiovisual', () => {
    const html = gerarLinkSubstituto(contatosMap, { nomeVinculado: 'PEDRO' }, r);
    expect(html).toContain(encodeURIComponent('audiovisual'));
  });
});
