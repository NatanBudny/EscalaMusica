// Testes de vínculos (Task 7): Property 8 (vínculos válidos e simétricos) e
// a migração das regras por nome sobre o pessoas.json real.

import fc from 'fast-check';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { aplicarVinculos } from '../../montador/lib/pessoas.mjs';
import { migrarRegrasPorNome, migracoesPendentes } from '../../montador/lib/migracoes.mjs';
import { carregarPessoas } from '../../scripts/lib/cadastro.js';
import { criarRepoTemporario } from '../helpers/repo-temporario.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');

/** Valida um pessoasArquivo em memória via carregarPessoas. */
function validar(pessoasArquivo, dir) {
  const caminho = resolve(dir, '.validar.tmp.json');
  const arquivo = { ...pessoasArquivo };
  arquivo.proximo_id = Math.max(0, ...arquivo.pessoas.map((p) => p.id)) + 1;
  writeFileSync(caminho, `${JSON.stringify(arquivo, null, 2)}\n`, 'utf8');
  carregarPessoas(caminho);
  unlinkSync(caminho);
}

function pessoaMin(id, nome) {
  return {
    id,
    nome,
    aliases: [],
    telefone: '',
    genero: 'M',
    ativo: true,
    perfil_canto: 'base',
    notas: '',
    habilitacoes: { regente: false, equipe: true, mensagem_musical: { es: false, culto: false, domingo: false } },
    afastado: null,
    vinculos: [],
    dias_permitidos: null,
  };
}

describe('Property 8: Vínculos válidos e simétricos', () => {
  // Feature: melhoras-domingao, Property 8: Vínculos válidos e simétricos
  test('sequência de criações/remoções mantém cadastro válido e sempre_junto simétrico', () => {
    const repo = criarRepoTemporario();
    try {
      fc.assert(
        fc.property(
          fc
            .integer({ min: 3, max: 6 })
            .chain((n) =>
              fc.tuple(
                fc.constant(n),
                // sequência de operações: cada op define vínculos de uma pessoa.
                fc.array(
                  fc.record({
                    pessoa: fc.integer({ min: 1, max: n }),
                    sempreJunto: fc.subarray(
                      Array.from({ length: n }, (_, i) => i + 1),
                      { maxLength: 2 },
                    ),
                    precisaDe: fc.subarray(
                      Array.from({ length: n }, (_, i) => i + 1),
                      { maxLength: 2 },
                    ),
                  }),
                  { minLength: 1, maxLength: 6 },
                ),
              ),
            ),
          ([n, ops]) => {
            const arquivo = {
              grupos: {},
              pessoas: Array.from({ length: n }, (_, i) => pessoaMin(i + 1, `PESSOA ${String.fromCharCode(65 + i)}`)),
            };
            for (const op of ops) {
              aplicarVinculos(arquivo, op.pessoa, {
                sempreJunto: op.sempreJunto,
                precisaDe: op.precisaDe,
              });
            }

            // Cadastro resultante passa no validador (simetria, IDs, precisa_de).
            expect(() => validar(arquivo, repo.dir)).not.toThrow();

            // Toda relação sempre_junto tem recíproco.
            for (const p of arquivo.pessoas) {
              for (const v of p.vinculos) {
                if (v.tipo === 'sempre_junto') {
                  const outro = arquivo.pessoas.find((x) => x.id === v.com_id);
                  expect(outro).toBeDefined();
                  expect(
                    outro.vinculos.some((w) => w.tipo === 'sempre_junto' && w.com_id === p.id),
                  ).toBe(true);
                }
                if (v.tipo === 'precisa_de') {
                  expect(v.com_ids.length).toBeGreaterThan(0);
                  expect(v.com_ids).not.toContain(p.id);
                }
              }
            }
          },
        ),
        { numRuns: 100 },
      );
    } finally {
      repo.limpar();
    }
  }, 60000);

  test('precisa_de com a própria pessoa é descartado; familia_requerida cria/usa grupo', () => {
    const repo = criarRepoTemporario();
    try {
      const arquivo = {
        grupos: {},
        pessoas: [pessoaMin(1, 'A'), pessoaMin(2, 'B'), pessoaMin(3, 'C')],
      };
      // precisa_de incluindo a própria pessoa (1) → removido.
      aplicarVinculos(arquivo, 1, { precisaDe: [1, 2] });
      const a = arquivo.pessoas.find((p) => p.id === 1);
      const pd = a.vinculos.find((v) => v.tipo === 'precisa_de');
      expect(pd.com_ids).toEqual([2]);

      // familia_requerida cria grupo novo.
      aplicarVinculos(arquivo, 2, {
        novoGrupo: { chave: 'familia_bc', membros_ids: [2, 3] },
      });
      expect(arquivo.grupos.familia_bc).toBeDefined();
      const b = arquivo.pessoas.find((p) => p.id === 2);
      expect(b.vinculos.some((v) => v.tipo === 'familia_requerida' && v.grupo === 'familia_bc')).toBe(true);
      expect(() => validar(arquivo, repo.dir)).not.toThrow();
    } finally {
      repo.limpar();
    }
  });
});

/**
 * Cópia do pessoas.json real como estava antes da migração regras_por_nome
 * (aplicada em 05/11/2026): sem a marca, sem os precisa_de das quatro
 * pessoas e sem a restrição de sábado da Ariadny. Assim o teste não depende de
 * a migração ainda estar pendente no repositório.
 */
function pessoasAntesDaMigracao() {
  const arquivo = JSON.parse(readFileSync(resolve(ROOT, 'pessoas.json'), 'utf8'));
  if (arquivo.migracoes) delete arquivo.migracoes.regras_por_nome;
  for (const p of arquivo.pessoas) {
    if (['MANU C.', 'MANU S.', 'MIRELLA', 'MARCELA'].includes(p.nome)) {
      p.vinculos = (p.vinculos || []).filter((v) => v.tipo !== 'precisa_de');
    }
    if (p.nome === 'ARIADNY') p.dias_permitidos = null;
  }
  return arquivo;
}

describe('Task 7.2: migração das regras por nome sobre o pessoas.json real', () => {
  const pessoasArquivo = pessoasAntesDaMigracao();

  function porNome(arquivo, nome) {
    return arquivo.pessoas.find((p) => p.nome === nome);
  }
  function id(arquivo, nome) {
    const p = porNome(arquivo, nome);
    return p ? p.id : null;
  }

  test('resultado esperado, aprovado por carregarPessoas e idempotente', () => {
    const repo = criarRepoTemporario();
    try {
      const r1 = migrarRegrasPorNome(pessoasArquivo);

      // ARIADNY e CATHERINE: dias_permitidos ["sabado"].
      expect(porNome(r1, 'ARIADNY').dias_permitidos).toEqual(['sabado']);
      expect(porNome(r1, 'CATHERINE').dias_permitidos).toEqual(['sabado']);

      // MANU C. → precisa_de SILVANA.
      const manuC = porNome(r1, 'MANU C.');
      const pdC = manuC.vinculos.find((v) => v.tipo === 'precisa_de');
      expect(pdC.com_ids).toEqual([id(r1, 'SILVANA')]);

      // MANU S. → precisa_de JESSICA ou JOAS.
      const manuS = porNome(r1, 'MANU S.');
      const pdS = manuS.vinculos.find((v) => v.tipo === 'precisa_de');
      expect(pdS.com_ids.sort()).toEqual([id(r1, 'JESSICA'), id(r1, 'JOAS')].sort());

      // MIRELLA e MARCELA → precisa_de NILSINHO.
      const nilsinho = id(r1, 'NILSINHO');
      expect(porNome(r1, 'MIRELLA').vinculos.find((v) => v.tipo === 'precisa_de').com_ids).toEqual([nilsinho]);
      expect(porNome(r1, 'MARCELA').vinculos.find((v) => v.tipo === 'precisa_de').com_ids).toEqual([nilsinho]);

      // Marca a migração.
      expect(r1.migracoes.regras_por_nome).toMatch(/^\d{4}-\d{2}-\d{2}$/);

      // Aprovado pelo validador.
      expect(() => validar(r1, repo.dir)).not.toThrow();

      // Idempotente: aplicar de novo não muda os vínculos.
      const r2 = migrarRegrasPorNome(r1);
      expect(porNome(r2, 'MANU S.').vinculos.find((v) => v.tipo === 'precisa_de').com_ids.sort()).toEqual(
        pdS.com_ids.sort(),
      );
      expect(porNome(r2, 'MIRELLA').vinculos.filter((v) => v.tipo === 'precisa_de').length).toBe(1);
    } finally {
      repo.limpar();
    }
  });

  test('regras_por_nome aparece como pendente até ser aplicada', () => {
    // Antes de aplicar: a migração ainda tem efeito → pendente.
    const pendentesAntes = migracoesPendentes(pessoasArquivo, {});
    expect(pendentesAntes).toContain('regras_por_nome');

    // Depois de aplicar: marcada e sem mais efeito → não pendente.
    const aplicado = migrarRegrasPorNome(pessoasArquivo);
    const pendentesDepois = migracoesPendentes(aplicado, {});
    expect(pendentesDepois).not.toContain('regras_por_nome');
  });
});
