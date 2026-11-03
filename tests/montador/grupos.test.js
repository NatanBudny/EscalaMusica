// Testes de grupos escaláveis (Task 8):
// - Property 9 (grupos escaláveis válidos),
// - Property 3 parte grupos (derivação de contatos),
// - Property 4 parte grupos (entrada coberta por grupo),
// - dados reais (migração de grupos).

import fc from 'fast-check';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { carregarPessoas } from '../../scripts/lib/cadastro.js';
import { derivarContatos } from '../../scripts/lib/contatos.js';
import { normalizarNome } from '../../src/utils/name.js';
import { problemasNome } from '../../scripts/lib/texto-publico.js';
import {
  aplicarMigracaoGrupos,
  diferencasContatos,
} from '../../montador/lib/migracoes.mjs';
import { gruposEscalaveis } from '../../montador/lib/grupos.mjs';
import { criarRepoTemporario } from '../helpers/repo-temporario.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');

function validar(pessoasArquivo, dir) {
  const caminho = resolve(dir, '.validar.tmp.json');
  const arquivo = { ...pessoasArquivo };
  arquivo.proximo_id = Math.max(0, ...arquivo.pessoas.map((p) => p.id)) + 1;
  writeFileSync(caminho, `${JSON.stringify(arquivo, null, 2)}\n`, 'utf8');
  try {
    carregarPessoas(caminho);
    return null;
  } catch (e) {
    return e.message;
  } finally {
    try {
      unlinkSync(caminho);
    } catch {
      /* ignore */
    }
  }
}

function pessoaMin(id, nome, telefone = '') {
  return {
    id,
    nome,
    aliases: [],
    telefone,
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

describe('Property 9: Grupos escaláveis válidos', () => {
  // Feature: melhoras-domingao, Property 9: Grupos escaláveis válidos
  test('aceita sse responsável/membros existem, membros não vazio, modo/funcoes válidos, nome_exibicao único', () => {
    const repo = criarRepoTemporario();
    try {
      const pessoas = [
        pessoaMin(1, 'ALICE'),
        pessoaMin(2, 'BRUNO'),
        { ...pessoaMin(3, 'CARLA'), aliases: ['CACA'] },
      ];

      fc.assert(
        fc.property(
          fc.record({
            nome_exibicao: fc.constantFrom(
              'FAMILIA TESTE', // ok
              'ALICE', // colide com pessoa → inválido
              'CACA', // colide com apelido → inválido
              'ZÉ, DA ESQUINA', // caractere inválido
              'MIN. JOVEM', // ok
            ),
            responsavel_id: fc.constantFrom(1, 2, 99),
            membros_ids: fc.subarray([1, 2, 3], { minLength: 0 }),
            modo: fc.constantFrom('funcao', 'culto_inteiro', 'errado'),
            funcoes: fc.subarray(['regente', 'equipe', 'mm', 'xx'], { minLength: 0 }),
          }),
          (def) => {
            const arquivo = {
              grupos: { grupo_a: { escalavel: true, ...def } },
              pessoas,
            };
            const erro = validar(arquivo, repo.dir);

            const respExiste = [1, 2, 3].includes(def.responsavel_id);
            const membrosExistem = def.membros_ids.every((m) => [1, 2, 3].includes(m));
            const membrosNaoVazio = def.membros_ids.length > 0;
            const modoOk = def.modo === 'funcao' || def.modo === 'culto_inteiro';
            const funcoesOk = def.funcoes.every((f) => ['regente', 'equipe', 'mm'].includes(f));
            const nomeProbs = problemasNome(def.nome_exibicao).length === 0;
            const chaveNorm = normalizarNome(def.nome_exibicao);
            const coliderPessoa =
              chaveNorm === normalizarNome('ALICE') ||
              chaveNorm === normalizarNome('BRUNO') ||
              chaveNorm === normalizarNome('CARLA') ||
              chaveNorm === normalizarNome('CACA');

            const esperadoValido =
              respExiste &&
              membrosExistem &&
              membrosNaoVazio &&
              modoOk &&
              funcoesOk &&
              nomeProbs &&
              !coliderPessoa;

            if (esperadoValido) {
              expect(erro).toBeNull();
            } else {
              expect(erro).not.toBeNull();
            }
          },
        ),
        { numRuns: 200 },
      );
    } finally {
      repo.limpar();
    }
  });

  test('grupo sem escalavel continua aceito', () => {
    const repo = criarRepoTemporario();
    try {
      const arquivo = {
        grupos: { familia: { membros_ids: [1, 2] } },
        pessoas: [pessoaMin(1, 'A'), pessoaMin(2, 'B')],
      };
      expect(validar(arquivo, repo.dir)).toBeNull();
    } finally {
      repo.limpar();
    }
  });

  test('dois grupos escaláveis com nome_exibicao igual (após normalização) são recusados', () => {
    const repo = criarRepoTemporario();
    try {
      const arquivo = {
        grupos: {
          g1: { escalavel: true, nome_exibicao: 'FAMILIA X', responsavel_id: 1, membros_ids: [1], modo: 'funcao', funcoes: ['mm'] },
          g2: { escalavel: true, nome_exibicao: 'FAMÍLIA X', responsavel_id: 2, membros_ids: [2], modo: 'funcao', funcoes: ['mm'] },
        },
        pessoas: [pessoaMin(1, 'A'), pessoaMin(2, 'B')],
      };
      expect(validar(arquivo, repo.dir)).not.toBeNull();
    } finally {
      repo.limpar();
    }
  });
});

describe('Property 3 (grupos): Derivação de contatos', () => {
  // Feature: melhoras-domingao, Property 3: Derivação de contatos (grupos)
  test('entrada por grupo escalável cujo responsável tem telefone; chave nome_exibicao', () => {
    fc.assert(
      fc.property(
        fc.record({
          respTel: fc.oneof(fc.constant(''), fc.constant('5543999990001')),
        }),
        ({ respTel }) => {
          const pessoas = [pessoaMin(1, 'NILSINHO', respTel), pessoaMin(2, 'JULIANA', '')];
          const grupos = {
            fam: {
              escalavel: true,
              nome_exibicao: 'FAMILIA NILSINHO',
              responsavel_id: 1,
              membros_ids: [1, 2],
            },
            naoescal: { membros_ids: [1, 2] },
          };
          const contatos = derivarContatos(pessoas, grupos);
          if (respTel) {
            expect(contatos['FAMILIA NILSINHO']).toEqual({
              telefone: `https://wa.me/${respTel}`,
              apelidos: [],
            });
          } else {
            expect(contatos['FAMILIA NILSINHO']).toBeUndefined();
          }
          // Determinístico.
          expect(derivarContatos(pessoas, grupos)).toEqual(contatos);
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('Property 4 (grupos): entrada coberta por grupo não vira pessoa nem apelido', () => {
  // Feature: melhoras-domingao, Property 4: Migração de contatos sem perda (grupos)
  test('entrada cuja chave = nome_exibicao vira coberto_por_grupo', () => {
    const pessoas = [pessoaMin(21, 'FABRICIO', '5543999990021')];
    const arquivo = {
      grupos: {
        min_jovem: {
          escalavel: true,
          nome_exibicao: 'MIN. JOVEM',
          responsavel_id: 21,
          membros_ids: [21],
          modo: 'culto_inteiro',
        },
      },
      pessoas,
    };
    const contatos = {
      'MIN. JOVEM': { telefone: 'https://wa.me/5543999990021', apelidos: [] },
    };
    const diffs = diferencasContatos(contatos, arquivo);
    const mj = diffs.find((d) => d.chave === 'MIN. JOVEM');
    expect(mj.tipo).toBe('coberto_por_grupo');
    expect(mj.pendencia).toBeUndefined();
  });
});

describe('Task 8.4: migração de grupos com os dados reais', () => {
  // Baseline agosto/2026: pessoas.json real (sem os grupos escaláveis) e um
  // contatos.json com as entradas manuais legadas MIN. JOVEM e FAMILIA
  // NILSINHO. O contatos.json vivo do repositório já é derivado e não contém
  // mais essas entradas; a migração de grupos (esta task) é o que as converte
  // em Grupo_Escalavel com o link do responsável.
  const FIX = resolve(ROOT, 'tests/fixtures/migracao-contatos');
  const pessoasArquivo = JSON.parse(readFileSync(resolve(FIX, 'pessoas.json'), 'utf8'));
  const contatos = JSON.parse(readFileSync(resolve(FIX, 'contatos.json'), 'utf8'));

  test('gera 2 grupos aprovados por carregarPessoas; contatos com FAMILIA NILSINHO e MIN. JOVEM', () => {
    const repo = criarRepoTemporario();
    try {
      const comGrupos = aplicarMigracaoGrupos(pessoasArquivo);

      // Aprovado pelo validador.
      expect(validar(comGrupos, repo.dir)).toBeNull();

      // gruposEscalaveis vê os dois.
      const mapa = gruposEscalaveis(comGrupos);
      expect(mapa.has('familia_nilsinho')).toBe(true);
      expect(mapa.has('min_jovem')).toBe(true);

      // contatos.json gerado tem as entradas de grupo com o telefone certo.
      const gerado = derivarContatos(comGrupos.pessoas, comGrupos.grupos);
      const nilsinho = comGrupos.pessoas.find((p) => p.nome === 'NILSINHO');
      const fabricio = comGrupos.pessoas.find((p) => p.nome === 'FABRICIO');
      expect(gerado['FAMILIA NILSINHO'].telefone).toBe(`https://wa.me/${nilsinho.telefone}`);
      expect(gerado['MIN. JOVEM'].telefone).toBe(`https://wa.me/${fabricio.telefone}`);

      // MIN. JOVEM sai das pendências da migração de contatos (coberto_por_grupo).
      const diffs = diferencasContatos(contatos, comGrupos);
      const mj = diffs.find((d) => d.chave === 'MIN. JOVEM');
      expect(mj.tipo).toBe('coberto_por_grupo');
    } finally {
      repo.limpar();
    }
  });
});
