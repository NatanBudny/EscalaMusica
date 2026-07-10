import normalizar from '../../scripts/lib/normalizar.js';

describe('normalizar()', () => {
  describe('transformações básicas', () => {
    test('remove acentos (NFD strip)', () => {
      expect(normalizar('José')).toBe('JOSE');
      expect(normalizar('Conceição')).toBe('CONCEICAO');
    });

    test('converte para uppercase', () => {
      expect(normalizar('maria')).toBe('MARIA');
    });

    test('remove dígitos', () => {
      expect(normalizar('João123')).toBe('JOAO');
    });

    test('remove caractere ?', () => {
      expect(normalizar('Quem?')).toBe('QUEM');
    });

    test('colapsa espaços múltiplos', () => {
      expect(normalizar('Maria   Helena')).toBe('MARIA HELENA');
    });

    test('trim nas extremidades', () => {
      expect(normalizar('  Ana  ')).toBe('ANA');
    });

    test('valor null retorna string vazia', () => {
      expect(normalizar(null)).toBe('');
    });

    test('valor undefined retorna string vazia', () => {
      expect(normalizar(undefined)).toBe('');
    });

    test('valor vazio retorna string vazia', () => {
      expect(normalizar('')).toBe('');
    });

    test('converte número para string antes de normalizar', () => {
      expect(normalizar(42)).toBe('');
    });
  });

  describe('remoção de sufixos comuns', () => {
    test('remove sufixo IASD', () => {
      expect(normalizar('João IASD')).toBe('JOAO');
    });

    test('remove sufixo CENTRAL', () => {
      expect(normalizar('Maria Central')).toBe('MARIA');
    });

    test('remove sufixo IASD CENTRAL', () => {
      expect(normalizar('Pedro IASD Central')).toBe('PEDRO');
    });

    test('não remove IASD no meio do nome', () => {
      expect(normalizar('IASD Maria')).toBe('IASD MARIA');
    });

    test('string que é apenas o sufixo retorna vazio', () => {
      expect(normalizar('IASD')).toBe('');
      expect(normalizar('Central')).toBe('');
      expect(normalizar('IASD Central')).toBe('');
    });

    test('sufixo case-insensitive (lowercase input)', () => {
      expect(normalizar('ana iasd')).toBe('ANA');
      expect(normalizar('ana central')).toBe('ANA');
      expect(normalizar('ana iasd central')).toBe('ANA');
    });

    test('nomes sem sufixo permanecem inalterados', () => {
      expect(normalizar('Catherine')).toBe('CATHERINE');
      expect(normalizar('Luiz da Silva')).toBe('LUIZ DA SILVA');
    });

    test('não remove sufixo parcial (IASD como parte de palavra)', () => {
      expect(normalizar('AIASD')).toBe('AIASD');
    });
  });
});
