import { buscarContato } from '../../src/utils/contact.js';

const contatosMap = {
  'EMILY': {
    telefone: 'https://wa.me/554391240309',
    apelidos: [],
  },
  'FABRÍCIO': {
    telefone: 'https://wa.me/554396670568',
    apelidos: ['FABRICIO', 'JOVENS'],
  },
  'DANY KALLAS': {
    telefone: 'https://wa.me/554399830142',
    apelidos: ['DANY'],
  },
  'RICARDO': {
    telefone: 'https://wa.me/554396158431',
    apelidos: ['RICARDO HERREIRA'],
  },
};

describe('buscarContato', () => {
  test('finds a contact by exact canonical name', () => {
    const result = buscarContato(contatosMap, 'EMILY');
    expect(result).not.toBeNull();
    expect(result.telefone).toBe('https://wa.me/554391240309');
  });

  test('is case-insensitive', () => {
    expect(buscarContato(contatosMap, 'emily')).not.toBeNull();
    expect(buscarContato(contatosMap, 'Emily')).not.toBeNull();
  });

  test('is accent-insensitive for input', () => {
    // "Fabrício" should resolve to "FABRÍCIO"
    expect(buscarContato(contatosMap, 'Fabrício')).not.toBeNull();
  });

  test('finds a contact by alias (single alias)', () => {
    const result = buscarContato(contatosMap, 'FABRICIO');
    expect(result).not.toBeNull();
    expect(result.telefone).toBe('https://wa.me/554396670568');
  });

  test('finds a contact by alias with spaces', () => {
    const result = buscarContato(contatosMap, 'RICARDO HERREIRA');
    expect(result).not.toBeNull();
    expect(result.telefone).toBe('https://wa.me/554396158431');
  });

  test('finds a contact by short alias', () => {
    const result = buscarContato(contatosMap, 'DANY');
    expect(result).not.toBeNull();
    expect(result.telefone).toBe('https://wa.me/554399830142');
  });

  test('returns null for an unknown name', () => {
    expect(buscarContato(contatosMap, 'ZZZUNKNOWN')).toBeNull();
  });

  test('returns null for empty name', () => {
    expect(buscarContato(contatosMap, '')).toBeNull();
  });

  test('returns null for dash placeholder', () => {
    expect(buscarContato(contatosMap, '-')).toBeNull();
  });

  test('works with an empty contacts map', () => {
    expect(buscarContato({}, 'EMILY')).toBeNull();
  });
});
