import { describe, expect, it } from 'vitest';
import { filterSubjects, matchesQuery, type SubjectRow } from './search';

const row = (
  overrides: Partial<SubjectRow> & Pick<SubjectRow, 'id' | 'canonicalName'>,
): SubjectRow => ({
  kind: 'person',
  aliases: [],
  active: true,
  ...overrides,
});

describe('busca de sujeitos por nome/alias', () => {
  it('termo vazio corresponde a todos os sujeitos', () => {
    const r = row({ id: 'a', canonicalName: 'Ana' });
    expect(matchesQuery(r, '')).toBe(true);
    expect(matchesQuery(r, '   ')).toBe(true);
  });

  it('corresponde pelo nome canonico sem distincao de caixa e espacos', () => {
    const r = row({ id: 'a', canonicalName: 'Joao  Silva' });
    expect(matchesQuery(r, 'joao silva')).toBe(true);
    expect(matchesQuery(r, 'JOAO')).toBe(true);
    expect(matchesQuery(r, 'silva')).toBe(true);
  });

  it('corresponde por alias', () => {
    const r = row({ id: 'a', canonicalName: 'Maria', aliases: ['Mari', 'Mah'] });
    expect(matchesQuery(r, 'mah')).toBe(true);
    expect(matchesQuery(r, 'mari')).toBe(true);
  });

  it('nao corresponde quando o termo nao esta no nome nem nos aliases', () => {
    const r = row({ id: 'a', canonicalName: 'Maria', aliases: ['Mari'] });
    expect(matchesQuery(r, 'joao')).toBe(false);
  });

  it('filtra e ordena por nome canonico de forma estavel', () => {
    const rows = [
      row({ id: 'b', canonicalName: 'Bruno' }),
      row({ id: 'a', canonicalName: 'ana' }),
      row({ id: 'c', canonicalName: 'Carlos' }),
    ];
    const filtered = filterSubjects(rows, '');
    expect(filtered.map((r) => r.canonicalName)).toEqual(['ana', 'Bruno', 'Carlos']);
  });

  it('o filtro reduz o conjunto ao termo buscado', () => {
    const rows = [
      row({ id: 'a', canonicalName: 'Ana', aliases: ['Aninha'] }),
      row({ id: 'b', canonicalName: 'Bruno' }),
    ];
    expect(filterSubjects(rows, 'aninha').map((r) => r.id)).toEqual(['a']);
  });
});
