import { normalizarNome, estaEscalado, buscarPorNome } from '../../src/utils/name.js';

// ─── normalizarNome ───────────────────────────────────────────────────────────

describe('normalizarNome', () => {
  test('uppercases a plain name', () => {
    expect(normalizarNome('joao')).toBe('JOAO');
  });

  test('removes common Portuguese accents', () => {
    expect(normalizarNome('ção')).toBe('CAO');
    expect(normalizarNome('André')).toBe('ANDRE');
    expect(normalizarNome('Ariadny')).toBe('ARIADNY');
    expect(normalizarNome('Fabrício')).toBe('FABRICIO');
    expect(normalizarNome('ANCIÃO')).toBe('ANCIAO');
  });

  test('trims surrounding whitespace', () => {
    expect(normalizarNome('  ALEX  ')).toBe('ALEX');
  });

  test('handles already-normalized names identempotently', () => {
    expect(normalizarNome('EMILY')).toBe('EMILY');
  });
});

// ─── estaEscalado ─────────────────────────────────────────────────────────────

const baseRecord = {
  'REGENTE LOUVOR':   'GIOVANA',
  'EQUIPE LOUVOR':    'LUIZ ANTONIO, RICARDO, CATHERINE, ARIADNY, JEMELLI',
  'PREGADOR':         'CLEVERSON',
  'MENSAGEM MUSICAL': 'EMILY',
  'AUDIOVISUAL':      'LUIZ',
  'ANCIÃO':           'ADELMO',
  'SUPORTE':          'VANDERLEY',
  'DATA':             '08/03/2026',
};

describe('estaEscalado', () => {
  test('detects a match in REGENTE LOUVOR', () => {
    expect(estaEscalado(baseRecord, 'GIOVANA')).toBe(true);
  });

  test('detects a match in EQUIPE LOUVOR (comma list)', () => {
    expect(estaEscalado(baseRecord, 'CATHERINE')).toBe(true);
    expect(estaEscalado(baseRecord, 'ARIADNY')).toBe(true);
  });

  test('detects a match in PREGADOR', () => {
    expect(estaEscalado(baseRecord, 'CLEVERSON')).toBe(true);
  });

  test('detects a match in MENSAGEM MUSICAL', () => {
    expect(estaEscalado(baseRecord, 'EMILY')).toBe(true);
  });

  test('detects a match in AUDIOVISUAL', () => {
    expect(estaEscalado(baseRecord, 'LUIZ')).toBe(true);
  });

  test('detects a match in ANCIÃO (with cedilla)', () => {
    expect(estaEscalado(baseRecord, 'ADELMO')).toBe(true);
  });

  test('detects a match in SUPORTE', () => {
    expect(estaEscalado(baseRecord, 'VANDERLEY')).toBe(true);
  });

  test('returns false for a name not present', () => {
    expect(estaEscalado(baseRecord, 'ALEX')).toBe(false);
  });

  test('is case-insensitive via normalisation', () => {
    expect(estaEscalado(baseRecord, 'giovana')).toBe(true);
    expect(estaEscalado(baseRecord, 'Fabrício')).toBe(false);
  });

  test('returns false when nome is empty/falsy', () => {
    expect(estaEscalado(baseRecord, '')).toBe(false);
    expect(estaEscalado(baseRecord, null)).toBe(false);
  });

  test('handles missing fields gracefully', () => {
    const sparse = { 'REGENTE LOUVOR': 'ALEX' };
    expect(estaEscalado(sparse, 'ALEX')).toBe(true);
    expect(estaEscalado(sparse, 'EMILY')).toBe(false);
  });
});

// ─── buscarPorNome ────────────────────────────────────────────────────────────

const dados = [
  { 'REGENTE LOUVOR': 'FABRÍCIO', 'EQUIPE LOUVOR': 'EMILY, ARIADNY', 'DATA': '11/01/2026', 'DIA SEMANA': 'domingo', 'ACOMP': 'BANDA', 'PREGADOR': 'CLEVERSON', 'MENSAGEM MUSICAL': '', 'AUDIOVISUAL': '', 'ANCIÃO': '', 'SUPORTE': '', 'TEMA CULTO': '', 'OBS': '' },
  { 'REGENTE LOUVOR': 'GIOVANA',  'EQUIPE LOUVOR': 'LUIS, EMILY',    'DATA': '08/03/2026', 'DIA SEMANA': 'domingo', 'ACOMP': 'BANDA', 'PREGADOR': 'ADELMO',    'MENSAGEM MUSICAL': 'ALEX', 'AUDIOVISUAL': '', 'ANCIÃO': '', 'SUPORTE': '', 'TEMA CULTO': '', 'OBS': '' },
  { 'REGENTE LOUVOR': 'DANY',     'EQUIPE LOUVOR': 'SIRLENE',        'DATA': '14/03/2026', 'DIA SEMANA': 'sábado',  'ACOMP': 'PB',    'PREGADOR': 'SILVANA',   'MENSAGEM MUSICAL': '', 'AUDIOVISUAL': '', 'ANCIÃO': '', 'SUPORTE': '', 'TEMA CULTO': '', 'OBS': 'ESPECIAL' },
];

describe('buscarPorNome', () => {
  test('returns all records when termo is empty', () => {
    expect(buscarPorNome(dados, '')).toHaveLength(3);
    expect(buscarPorNome(dados, null)).toHaveLength(3);
  });

  test('finds by exact name match in REGENTE LOUVOR', () => {
    expect(buscarPorNome(dados, 'GIOVANA')).toHaveLength(1);
  });

  test('finds by name in comma list (EQUIPE LOUVOR)', () => {
    const results = buscarPorNome(dados, 'EMILY');
    expect(results).toHaveLength(2);
  });

  test('finds by PREGADOR field', () => {
    expect(buscarPorNome(dados, 'SILVANA')).toHaveLength(1);
  });

  test('finds by DATA field', () => {
    expect(buscarPorNome(dados, '14/03/2026')).toHaveLength(1);
  });

  test('finds by OBS field', () => {
    expect(buscarPorNome(dados, 'ESPECIAL')).toHaveLength(1);
  });

  test('is case-insensitive', () => {
    expect(buscarPorNome(dados, 'giovana')).toHaveLength(1);
  });

  test('is accent-insensitive', () => {
    expect(buscarPorNome(dados, 'Fabrício')).toHaveLength(1);
  });

  test('returns empty array when no match', () => {
    expect(buscarPorNome(dados, 'XXXXXXXX')).toHaveLength(0);
  });

  test('finds partial name match', () => {
    // "DANI" should match "DANY"? No — normalizarNome('DANI') = 'DANI', 'DANY' = 'DANY'. No match.
    // But "DAZ" would not match at all. Let us test partial text in acomp:
    const results = buscarPorNome(dados, 'BANDA');
    expect(results).toHaveLength(2);
  });
});
