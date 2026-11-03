// Testes da observação pública editável (Task 26).
//  - 26.1 Property 29: texto exibido sem escape.
//  - 26.2 Unitários: rascunho preserva OBS; assinatura muda só com OBS;
//    validar-obs-publico.js mantém a saída; "<b>" e "pendente" → dois problemas.
//
// Feature: melhoras-domingao.

import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';
import { problemasNome, problemasObs, problemasTextoLivre } from '../../scripts/lib/texto-publico.js';
import { TERMOS_PROIBIDOS, termoProibido } from '../../scripts/lib/obs-publico.js';
import { serializarRascunho, desserializarRascunho, assinatura } from '../../montador/public/modulos/rascunho.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');

// ---------------------------------------------------------------------------
// Property 29: Texto exibido sem escape
// ---------------------------------------------------------------------------

describe('Property 29: Texto exibido sem escape', () => {
  // Feature: melhoras-domingao, Property 29: Texto exibido sem escape
  test('problemasNome vazio sse texto não vazio e só Caracteres_de_Nome; problemasObs sse "<"/">"/termo', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 40 }), (texto) => {
        const CARACTERES = /^[\p{L} .'-]+$/u;
        const soNome = texto.trim() !== '' && CARACTERES.test(texto);
        expect(problemasNome(texto).length === 0).toBe(soNome);
        // Vírgula sempre é problema de nome.
        if (texto.includes(',')) expect(problemasNome(texto).length).toBeGreaterThan(0);

        const temMarca = texto.includes('<') || texto.includes('>');
        const temTermo = termoProibido(texto) != null;
        expect(problemasObs(texto).length > 0).toBe(temMarca || temTermo);
      }),
      { numRuns: 200 },
    );
  });

  test('problemasTextoLivre aponta "<"/">"', () => {
    expect(problemasTextoLivre('PR. HOFNI')).toEqual([]);
    expect(problemasTextoLivre('a<b').length).toBe(1);
    expect(problemasTextoLivre('a>b').length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 26.2 Unitários
// ---------------------------------------------------------------------------

describe('26.2 OBS no rascunho e assinatura', () => {
  const culto = (obs) => ({
    data: '2026-09-05',
    dia_semana: 'sabado',
    tipo: 'louvor',
    acomp: 'BANDA',
    regente: 1,
    equipe: [2, 3],
    mm: {},
    assumidoPor: null,
    obs,
  });

  test('rascunho preserva a OBS', () => {
    const texto = serializarRascunho('2026-09', [culto('CULTO DA FAMÍLIA')]);
    const { cultos } = desserializarRascunho(texto, new Map([[1, {}], [2, {}], [3, {}]]), new Map());
    expect(cultos[0].obs).toBe('CULTO DA FAMÍLIA');
  });

  test('assinatura muda quando só a OBS muda', () => {
    const a = assinatura([culto('')]);
    const b = assinatura([culto('DIA DOS PAIS')]);
    expect(a).not.toBe(b);
  });

  test('"<b>" e "pendente" geram dois problemas em problemasObs', () => {
    const problemas = problemasObs('<b>pendente</b>');
    expect(problemas.length).toBe(2);
  });

  test('a lista de termos proibidos não está vazia', () => {
    expect(TERMOS_PROIBIDOS.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// validar-obs-publico.js mantém a saída de CLI
// ---------------------------------------------------------------------------

describe('validar-obs-publico.js mantém a saída de CLI', () => {
  test('roda sobre o atual.json do repositório sem erro de execução', () => {
    // O script pode sair 0 ou 1 conforme o conteúdo de atual.json; o importante
    // é que continue executável e produza a seção de validação.
    let saida = '';
    try {
      saida = execFileSync('node', ['scripts/validacao/validar-obs-publico.js'], {
        cwd: ROOT,
        encoding: 'utf8',
      });
    } catch (err) {
      // Falha de validação (exit 1) ainda produz stdout.
      saida = (err.stdout || '').toString();
    }
    expect(saida).toContain('Validacao de OBS Publico');
  });
});
