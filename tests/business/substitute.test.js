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
