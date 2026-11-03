// Lint estrutural do README em portugues (tarefa 17.2).
//
// Valida (Requisitos 6.9, 9.12, 11.14, 15.1-15.10, 15.15, 15.16, 16.3): o README
// contem TODAS as secoes exigidas e nenhum procedimento do operador pede
// terminal, edicao de JSON/Markdown ou IA.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const README = readFileSync(resolve(__dirname, '../../../README.md'), 'utf8');

/** Secoes obrigatorias (titulos de nivel ## no README). */
const REQUIRED_SECTIONS = [
  'Glossario',
  'As sete etapas',
  'Instalacao',
  'Configuracao inicial',
  'Atualizacao',
  'Remocao',
  'Cadastro',
  'Entradas (insumos externos)',
  'Indisponibilidades',
  'Regras',
  'Sugestao',
  'Validacao',
  'Previa',
  'Publicacao',
  'Git e repositorios',
  'Credenciais',
  'Modo offline',
  'Conciliacao entre maquinas',
  'Backup',
  'Migracao',
  'Rollback (reversao)',
  'Revisoes pos-publicacao',
  'Custos',
  'Formatos',
  'Erros e recuperacao',
  'Responsaveis e historico',
] as const;

describe('README estrutural (17.2)', () => {
  it('contem todas as secoes exigidas', () => {
    const missing = REQUIRED_SECTIONS.filter((s) => !README.includes(`## ${s}`));
    expect(missing).toEqual([]);
  });

  it('as sete etapas estao nomeadas', () => {
    for (const stage of [
      'Abertura',
      'Coleta',
      'Montagem',
      'Validacao',
      'Aprovacao',
      'Publicacao',
      'Fechamento',
    ]) {
      expect(README).toContain(stage);
    }
  });

  it('explica que o login do Google nao protege as URLs publicas', () => {
    expect(README).toMatch(/login do google[\s\S]*nao protege/i);
  });

  it('nenhum procedimento do operador exige terminal, edicao de JSON/Markdown ou IA', () => {
    // O README deve afirmar explicitamente que nao usa terminal/JSON/IA e nao
    // deve instruir o operador a rodar comandos de terminal.
    expect(README).toMatch(/nao precisa de terminal/i);
    expect(README).toMatch(/nao edita json ou markdown/i);
    // Nenhuma instrucao de comando de terminal dirigida ao operador.
    expect(README).not.toMatch(/\bnpm run\b/);
    expect(README).not.toMatch(/\bgit (commit|push|clone)\b/i);
    expect(README).not.toMatch(/\bsudo\b/);
  });

  it('referencia o catalogo de falhas versionado', () => {
    expect(README).toContain('docs/CATALOGO-DE-FALHAS.md');
  });
});
