import { describe, expect, it } from 'vitest';

import { normalizeName } from './index';

describe('normalizeName (exemplos e bordas)', () => {
  it('remove espacos no inicio e no fim', () => {
    expect(normalizeName('  Andre  ')).toBe('Andre');
  });

  it('colapsa sequencias internas de espacos em um unico espaco', () => {
    expect(normalizeName('Joao   da    Silva')).toBe('Joao da Silva');
  });

  it('combina trim e colapso', () => {
    expect(normalizeName('   Maria   das   Dores   ')).toBe('Maria das Dores');
  });

  it('preserva letras acentuadas e sinais (nao destrutiva)', () => {
    expect(normalizeName('  José  Ñandú - "D’Ávila"  ')).toBe('José Ñandú - "D’Ávila"');
  });

  it('preserva a caixa das letras (nao aplica casefold)', () => {
    expect(normalizeName('ANA maria MACEDO')).toBe('ANA maria MACEDO');
  });

  it('colapsa diferentes tipos de espaco em branco em um unico espaco comum', () => {
    // Tabulacao, quebra de linha e espaco sem quebra (U+00A0).
    expect(normalizeName('a\t\n\u00a0b')).toBe('a b');
  });

  it('string vazia permanece vazia', () => {
    expect(normalizeName('')).toBe('');
  });

  it('string composta apenas por espacos vira string vazia', () => {
    expect(normalizeName('   \t  ')).toBe('');
  });

  it('e idempotente em um caso concreto', () => {
    const once = normalizeName('  a   b   c  ');
    expect(normalizeName(once)).toBe(once);
    expect(once).toBe('a b c');
  });
});
