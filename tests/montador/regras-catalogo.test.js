// Testes do catálogo de regras e versionamento de texto (Task 11).
//  - 11.1 Property 12: histórico só por acréscimo e reversão fiel.
//  - 11.2 unitários: listarCatalogo cobre os 5 arquivos; validar-regras.js
//    mantém a saída (via validar-catalogo); edição em repo temporário gera
//    commit com os dois arquivos.

import fc from 'fast-check';
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  copyFileSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  listarCatalogo,
  historico,
  editarTexto,
  reverter,
  salvarParametros,
  validarCatalogo,
} from '../../montador/lib/regras-catalogo.mjs';
import { validarSnapshotEMd } from '../../scripts/lib/validar-catalogo.js';
import { criarGit } from '../../montador/lib/git.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');

/** Arquivos de regras copiados para a raiz temporária. */
const ARQUIVOS_REGRAS = [
  'processos/regras/fundamentais.json',
  'processos/regras/preferencias.json',
  'processos/regras/restricoes-pessoais.json',
  'processos/regras/papeis.json',
  'processos/regras/glossario.json',
  'processos/regras/parametros.json',
  'processos/regras/historico-versoes.json',
  'processos/regras/regras.snapshot.json',
  'processos/regras/REGRAS.md',
  'processos/regras/regras.index.json',
];

/** Cria uma raiz temporária com cópias dos arquivos de regras. */
function raizTemporaria() {
  const base = mkdtempSync(resolve(tmpdir(), 'escala-regras-'));
  mkdirSync(resolve(base, 'processos/regras'), { recursive: true });
  for (const rel of ARQUIVOS_REGRAS) {
    const origem = resolve(ROOT, rel);
    if (existsSync(origem)) copyFileSync(origem, resolve(base, rel));
  }
  return base;
}

// ───────────────────────────────────────────────────────────────────────────
// 11.2 Unitários
// ───────────────────────────────────────────────────────────────────────────

describe('listarCatalogo cobre todas as entradas dos cinco arquivos', () => {
  test('conta cada entrada dos cinco arquivos canônicos', () => {
    const catalogo = listarCatalogo();
    const porCategoria = {};
    for (const e of catalogo) porCategoria[e.categoria] = (porCategoria[e.categoria] || 0) + 1;

    const fundamentais = JSON.parse(
      readFileSync(resolve(ROOT, 'processos/regras/fundamentais.json'), 'utf8'),
    );
    const preferencias = JSON.parse(
      readFileSync(resolve(ROOT, 'processos/regras/preferencias.json'), 'utf8'),
    );
    const restricoes = JSON.parse(
      readFileSync(resolve(ROOT, 'processos/regras/restricoes-pessoais.json'), 'utf8'),
    );
    const papeis = JSON.parse(readFileSync(resolve(ROOT, 'processos/regras/papeis.json'), 'utf8'));
    const glossario = JSON.parse(
      readFileSync(resolve(ROOT, 'processos/regras/glossario.json'), 'utf8'),
    );

    const totalRestricoes = Object.values(restricoes).reduce(
      (s, arr) => s + (Array.isArray(arr) ? arr.length : 1),
      0,
    );

    expect(porCategoria.fundamentais).toBe(fundamentais.length);
    expect(porCategoria.preferencias).toBe(preferencias.length);
    expect(porCategoria.restricoes_pessoais).toBe(totalRestricoes);
    expect(porCategoria.papeis).toBe(Object.keys(papeis).length);
    expect(porCategoria.glossario).toBe(Object.keys(glossario).length);
  });

  test('cada entrada tem id, categoria e arquivo de origem', () => {
    for (const e of listarCatalogo()) {
      expect(typeof e.id).toBe('string');
      expect(e.id.length).toBeGreaterThan(0);
      expect(e.categoria).toBeTruthy();
      expect(e.arquivo).toMatch(/^processos\/regras\//);
      expect(typeof e.textos).toBe('object');
    }
  });

  test('entrada traz os parâmetros que a referenciam', () => {
    const rf001 = listarCatalogo().find((e) => e.id === 'RF001');
    expect(rf001.parametros).toContain('minimo_homens');
    const rf026 = listarCatalogo().find((e) => e.id === 'RF026');
    expect(rf026.parametros).toContain('indisponibilidade');
  });
});

describe('validarCatalogo mantém a saída de validar-regras', () => {
  test('o repositório atual é válido (sem erros)', () => {
    const { erros } = validarCatalogo({ root: ROOT });
    expect(erros).toEqual([]);
  });

  test('validarSnapshotEMd conta RF/PE/RP como o CLI', () => {
    const { erros, contagens } = validarSnapshotEMd(ROOT);
    expect(erros).toEqual([]);
    expect(contagens.rf).toBeGreaterThan(0);
    expect(contagens.pe).toBeGreaterThan(0);
    expect(contagens.rp).toBeGreaterThan(0);
  });
});

describe('edição gera commit com os dois arquivos (repo temporário)', () => {
  const ENV_GIT = {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
    GIT_AUTHOR_NAME: 'Teste',
    GIT_AUTHOR_EMAIL: 'teste@example.com',
    GIT_COMMITTER_NAME: 'Teste',
    GIT_COMMITTER_EMAIL: 'teste@example.com',
  };
  function g(cwd, args) {
    return execFileSync('git', args, { cwd, env: ENV_GIT, encoding: 'utf8' }).trim();
  }

  test('PUT texto comita preferencias.json e o histórico', async () => {
    const dir = raizTemporaria();
    g(dir, ['init', '-b', 'main']);
    g(dir, ['config', 'user.name', 'Teste']);
    g(dir, ['config', 'user.email', 'teste@example.com']);
    g(dir, ['add', '-A']);
    g(dir, ['commit', '-m', 'inicial']);

    const { versao, arquivos } = editarTexto(
      'PE001',
      { descricao: 'EQUIPE LOUVOR deve ter idealmente 3 ou mais homens' },
      { autor: 'Teste', root: dir },
    );

    // Primeira edição gera versão 1 (original) + versão 2 (edição).
    expect(versao).toBe(2);
    expect(arquivos).toContain('processos/regras/preferencias.json');
    expect(arquivos).toContain('processos/regras/historico-versoes.json');

    const git = criarGit({ cwd: dir, env: ENV_GIT });
    const commit = await git.commitSeletivo(arquivos, 'Regras: editar PE001');
    expect(commit.ok).toBe(true);

    // O commit tem exatamente os dois arquivos.
    const nomes = g(dir, ['show', '--name-only', '--pretty=format:', 'HEAD'])
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
      .sort();
    expect(nomes).toEqual(
      ['processos/regras/historico-versoes.json', 'processos/regras/preferencias.json'].sort(),
    );

    rmSync(dir, { recursive: true, force: true });
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 11.1 Property 12: histórico somente por acréscimo e reversão fiel
// ───────────────────────────────────────────────────────────────────────────

describe('Property 12: histórico só por acréscimo e reversão fiel', () => {
  // Feature: melhoras-domingao, Property 12: Histórico somente por acréscimo e reversão fiel
  // Validates: Requirements 9.2, 9.3, 9.4, 9.5, 10.6

  /** Lê o texto vigente de uma regra do catálogo. */
  function textoVigente(root, id) {
    const e = listarCatalogo({ root }).find((x) => x.id === id);
    return e ? e.textos : null;
  }

  test('edições/reversões só acrescentam; números consecutivos; reversão fiel', () => {
    fc.assert(
      fc.property(
        // Uma sequência de ações: editar (texto novo) ou reverter (para número já existente).
        fc.array(
          fc.oneof(
            fc.record({ tipo: fc.constant('editar'), texto: fc.string({ minLength: 1, maxLength: 40 }) }),
            fc.record({ tipo: fc.constant('reverter'), alvoRel: fc.double({ min: 0, max: 0.999, noNaN: true }) }),
          ),
          { minLength: 1, maxLength: 8 },
        ),
        (acoes) => {
          const root = raizTemporaria();
          try {
            const id = 'PE001';
            let anterior = []; // snapshot do histórico do alvo

            for (const acao of acoes) {
              if (acao.tipo === 'editar') {
                const texto = acao.texto.replace(/[\n\r]/g, ' ').trim() || 'x';
                editarTexto(id, { descricao: texto }, { autor: 'T', root });
              } else {
                const versoes = historico(id, { root });
                if (versoes.length === 0) continue; // nada para reverter ainda
                const idx = Math.min(versoes.length - 1, Math.floor(acao.alvoRel * versoes.length));
                const numeroAlvo = versoes[idx].numero;
                reverter(id, numeroAlvo, { autor: 'T', root });

                // Reversão fiel: o texto vigente = texto da versão escolhida.
                const vigente = textoVigente(root, id);
                expect(vigente.descricao).toBe(versoes[idx].textos.descricao);
              }

              const atual = historico(id, { root });

              // Só por acréscimo: o histórico anterior é prefixo do atual (versões antigas idênticas).
              expect(atual.length).toBeGreaterThanOrEqual(anterior.length);
              for (let i = 0; i < anterior.length; i++) {
                expect(atual[i]).toEqual(anterior[i]);
              }

              // Números consecutivos por alvo a partir de 1.
              for (let i = 0; i < atual.length; i++) {
                expect(atual[i].numero).toBe(i + 1);
              }

              // A primeira versão é sempre o texto original.
              if (atual.length > 0) {
                expect(atual[0].origem).toBe('original');
              }

              // O texto vigente é o da última versão.
              if (atual.length > 0) {
                const vigente = textoVigente(root, id);
                expect(vigente.descricao).toBe(atual[atual.length - 1].textos.descricao);
              }

              anterior = atual;
            }
          } finally {
            rmSync(root, { recursive: true, force: true });
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  test('alteração de parâmetros também é registrada por acréscimo', () => {
    const root = raizTemporaria();
    try {
      const base = JSON.parse(
        readFileSync(resolve(root, 'processos/regras/parametros.json'), 'utf8'),
      );
      const novo = JSON.parse(JSON.stringify(base));
      novo.equipe.tamanho = 4;
      const r1 = salvarParametros(novo, { autor: 'T', root });
      expect(r1.versao).toBe(1);

      novo.equipe.tamanho = 6;
      const r2 = salvarParametros(novo, { autor: 'T', root });
      expect(r2.versao).toBe(2);

      const versoes = historico('parametros', { root });
      expect(versoes.map((v) => v.numero)).toEqual([1, 2]);
      expect(versoes[0].conteudo.equipe.tamanho).toBe(4);
      expect(versoes[1].conteudo.equipe.tamanho).toBe(6);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
