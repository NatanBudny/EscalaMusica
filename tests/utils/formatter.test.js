import {
  linkarNome,
  formatarNome,
  formatarLista,
  formatarMusicasComYouTube,
} from '../../src/utils/formatter.js';

const contatosMap = {
  'EMILY': { telefone: 'https://wa.me/554391240309', apelidos: [] },
  'FABRÍCIO': { telefone: 'https://wa.me/554396670568', apelidos: ['FABRICIO'] },
};

// ─── linkarNome ───────────────────────────────────────────────────────────────

describe('linkarNome', () => {
  test('wraps name in a WhatsApp anchor when contact exists', () => {
    const html = linkarNome(contatosMap, 'EMILY');
    expect(html).toContain('<a');
    expect(html).toContain('https://wa.me/554391240309');
    expect(html).toContain('EMILY');
  });

  test('returns plain name when no contact exists', () => {
    const html = linkarNome(contatosMap, 'UNKNOWN');
    expect(html).toBe('UNKNOWN');
    expect(html).not.toContain('<a');
  });

  test('returns empty string for empty name', () => {
    expect(linkarNome(contatosMap, '')).toBe('');
  });

  test('returns dash for dash input', () => {
    expect(linkarNome(contatosMap, '-')).toBe('-');
  });

  test('finds contact via alias', () => {
    const html = linkarNome(contatosMap, 'FABRICIO');
    expect(html).toContain('https://wa.me/554396670568');
  });
});

// ─── formatarNome ─────────────────────────────────────────────────────────────

describe('formatarNome', () => {
  const usuarioAtual = { nomeVinculado: 'EMILY' };

  test('highlights the current user name', () => {
    const html = formatarNome(contatosMap, usuarioAtual, 'EMILY');
    expect(html).toContain('class="highlight-me"');
  });

  test('does not highlight a different name', () => {
    const html = formatarNome(contatosMap, usuarioAtual, 'FABRÍCIO');
    expect(html).not.toContain('highlight-me');
  });

  test('does not highlight when no user is logged in', () => {
    const html = formatarNome(contatosMap, null, 'EMILY');
    expect(html).not.toContain('highlight-me');
  });

  test('still links to WhatsApp inside the highlight span', () => {
    const html = formatarNome(contatosMap, usuarioAtual, 'EMILY');
    expect(html).toContain('<a');
    expect(html).toContain('highlight-me');
  });

  test('returns empty string for empty input', () => {
    expect(formatarNome(contatosMap, usuarioAtual, '')).toBe('');
  });
});

// ─── formatarLista ────────────────────────────────────────────────────────────

describe('formatarLista', () => {
  const usuario = { nomeVinculado: 'EMILY' };

  test('splits a comma-separated list and formats each name', () => {
    const html = formatarLista(contatosMap, usuario, 'EMILY, FABRÍCIO');
    expect(html).toContain('EMILY');
    expect(html).toContain('FABRÍCIO');
    // Two names → ", " separator
    const parts = html.split(', ');
    expect(parts.length).toBeGreaterThanOrEqual(2);
  });

  test('returns "-" for empty string', () => {
    expect(formatarLista(contatosMap, usuario, '')).toBe('-');
  });

  test('returns "-" for dash input', () => {
    expect(formatarLista(contatosMap, usuario, '-')).toBe('-');
  });

  test('returns "-" for null/undefined', () => {
    expect(formatarLista(contatosMap, usuario, null)).toBe('-');
    expect(formatarLista(contatosMap, usuario, undefined)).toBe('-');
  });

  test('handles single name without comma', () => {
    const html = formatarLista(contatosMap, null, 'EMILY');
    expect(html).toContain('EMILY');
  });
});

// ─── formatarMusicasComYouTube ────────────────────────────────────────────────

describe('formatarMusicasComYouTube', () => {
  test('returns "-" for empty string', () => {
    expect(formatarMusicasComYouTube('')).toBe('-');
  });

  test('returns "-" for null', () => {
    expect(formatarMusicasComYouTube(null)).toBe('-');
  });

  test('returns "-" for dash input', () => {
    expect(formatarMusicasComYouTube('-')).toBe('-');
  });

  test('creates one entry per pipe-separated song', () => {
    const html = formatarMusicasComYouTube('407 - O poder do amor | 210 - Sempre confiante');
    // Each song gets a <div>
    const divCount = (html.match(/<div/g) || []).length;
    expect(divCount).toBe(2);
  });

  test('each entry contains a YouTube search link', () => {
    const html = formatarMusicasComYouTube('Meu Pastor');
    expect(html).toContain('https://www.youtube.com/results?search_query=');
    expect(html).toContain(encodeURIComponent('Meu Pastor música louvor'));
  });

  test('each entry contains the song text', () => {
    const html = formatarMusicasComYouTube('Bondade de Deus');
    expect(html).toContain('Bondade de Deus');
  });

  test('handles a single song without pipe', () => {
    const html = formatarMusicasComYouTube('Tudo Por Ele');
    expect(html).toContain('Tudo Por Ele');
    expect(html).toContain('<a');
  });

  test('skips empty segments between pipes', () => {
    const html = formatarMusicasComYouTube('Canção A | | Canção B');
    expect(html).not.toContain('undefined');
  });
});
