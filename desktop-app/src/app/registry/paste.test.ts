import { describe, expect, it } from 'vitest';
import { parsePastedValues } from './paste';

describe('colagem confirmada (parsePastedValues)', () => {
  it('rejeita conteudo vazio', () => {
    const result = parsePastedValues('   ');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/vazio/i);
  });

  it('rejeita conteudo que parece JSON (objeto)', () => {
    const result = parsePastedValues('{ "nome": "Ana" }');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/JSON/i);
  });

  it('rejeita conteudo que parece JSON (array)', () => {
    const result = parsePastedValues('["Ana", "Bruno"]');
    expect(result.ok).toBe(false);
  });

  it('separa por quebra de linha e normaliza', () => {
    const result = parsePastedValues('  Ana \n Bruno  \n');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.values).toEqual(['Ana', 'Bruno']);
  });

  it('separa por virgula e ponto e virgula', () => {
    const result = parsePastedValues('Ana, Bruno; Carlos');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.values).toEqual(['Ana', 'Bruno', 'Carlos']);
  });

  it('remove duplicatas por caixa preservando a ordem', () => {
    const result = parsePastedValues('Ana\nana\nBruno');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.values).toEqual(['Ana', 'Bruno']);
  });
});
