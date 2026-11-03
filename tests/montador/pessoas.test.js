// Testes do cadastro gravando pessoas.json + contatos.json (Task 3).
// Property 5 (parte do cadastro): operação inválida não muda arquivos nem HEAD.

import fc from 'fast-check';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  criarPessoa,
  atualizarPessoa,
  listarPessoas,
} from '../../montador/lib/pessoas.mjs';
import { derivarContatos } from '../../scripts/lib/contatos.js';
import { criarRepoTemporario, git as gitRaw } from '../helpers/repo-temporario.js';

/** pessoas.json mínimo e válido. */
function cadastroBase() {
  return {
    versao: '1.0.0',
    proximo_id: 3,
    ultima_atualizacao: '2026-01-01',
    grupos: {},
    departamentos_contato: {},
    pessoas: [
      {
        id: 1,
        nome: 'ANA',
        aliases: ['ANINHA'],
        telefone: '554399990001',
        genero: 'F',
        ativo: true,
        perfil_canto: 'base',
        notas: '',
        habilitacoes: {
          regente: false,
          equipe: true,
          mensagem_musical: { es: false, culto: false, domingo: false },
        },
        afastado: null,
        vinculos: [],
        dias_permitidos: null,
      },
      {
        id: 2,
        nome: 'BRUNO',
        aliases: [],
        telefone: '',
        genero: 'M',
        ativo: true,
        perfil_canto: 'base',
        notas: '',
        habilitacoes: {
          regente: true,
          equipe: true,
          mensagem_musical: { es: false, culto: false, domingo: false },
        },
        afastado: null,
        vinculos: [],
        dias_permitidos: null,
      },
    ],
  };
}

/** Cria um repo temporário com pessoas.json + contatos.json commitados. */
function prepararRepo() {
  const repo = criarRepoTemporario();
  const cadastro = cadastroBase();
  repo.escrever('pessoas.json', `${JSON.stringify(cadastro, null, 2)}\n`);
  repo.escrever(
    'contatos.json',
    `${JSON.stringify(derivarContatos(cadastro.pessoas, cadastro.grupos), null, 2)}\n`,
  );
  repo.git(['add', '-A']);
  repo.git(['commit', '-m', 'cadastro inicial']);
  return repo;
}

describe('Cadastro grava pessoas.json e contatos.json', () => {
  test('criarPessoa com telefone grava os dois arquivos e devolve os caminhos', () => {
    const repo = prepararRepo();
    try {
      const { pessoa, arquivos } = criarPessoa(
        { nome: 'CARLA', telefone: '5543 9999-0003', genero: 'F' },
        { root: repo.dir },
      );
      expect(pessoa.nome).toBe('CARLA');
      expect(arquivos.sort()).toEqual(['contatos.json', 'pessoas.json']);

      const contatos = JSON.parse(readFileSync(resolve(repo.dir, 'contatos.json'), 'utf8'));
      expect(contatos.CARLA).toEqual({
        telefone: 'https://wa.me/554399990003',
        apelidos: [],
      });
    } finally {
      repo.limpar();
    }
  });

  test('listarPessoas aceita root', () => {
    const repo = prepararRepo();
    try {
      const { pessoas } = listarPessoas({ root: repo.dir });
      expect(pessoas.map((p) => p.nome).sort()).toEqual(['ANA', 'BRUNO']);
    } finally {
      repo.limpar();
    }
  });
});

describe('Property 5 (cadastro): falha não deixa rastro', () => {
  // Feature: melhoras-domingao, Property 5: Falha não deixa rastro
  test('operação inválida não muda arquivos nem HEAD', () => {
    fc.assert(
      fc.property(
        fc.record({
          // Nome duplicado (igual a ANA) deve reprovar o cadastro.
          nome: fc.constantFrom('ANA', 'ANINHA'),
        }),
        ({ nome }) => {
          const repo = prepararRepo();
          try {
            const headAntes = gitRaw(repo.dir, ['rev-parse', 'HEAD']);
            const pessoasAntes = readFileSync(resolve(repo.dir, 'pessoas.json'), 'utf8');
            const contatosAntes = readFileSync(resolve(repo.dir, 'contatos.json'), 'utf8');

            let lancou = false;
            try {
              // Nome igual ao de outra pessoa (ou a um alias) → validador rejeita.
              criarPessoa({ nome, telefone: '554399990009', genero: 'F' }, { root: repo.dir });
            } catch {
              lancou = true;
            }
            expect(lancou).toBe(true);

            // Arquivos e HEAD idênticos ao estado anterior.
            expect(readFileSync(resolve(repo.dir, 'pessoas.json'), 'utf8')).toBe(pessoasAntes);
            expect(readFileSync(resolve(repo.dir, 'contatos.json'), 'utf8')).toBe(contatosAntes);
            expect(gitRaw(repo.dir, ['rev-parse', 'HEAD'])).toBe(headAntes);
          } finally {
            repo.limpar();
          }
        },
      ),
      { numRuns: 100 },
    );
  }, 60000);

  test('tmp inválido não contamina (atualizarPessoa com nome duplicado)', () => {
    const repo = prepararRepo();
    try {
      const pessoasAntes = readFileSync(resolve(repo.dir, 'pessoas.json'), 'utf8');
      expect(() =>
        atualizarPessoa(2, { nome: 'ANA' }, { root: repo.dir }),
      ).toThrow(/Validação falhou/);
      expect(readFileSync(resolve(repo.dir, 'pessoas.json'), 'utf8')).toBe(pessoasAntes);
      // O tmp pode existir vazio, mas não deve ter conteúdo inválido persistido.
      const tmp = resolve(repo.dir, '.pessoas.tmp.json');
      if (existsSync(tmp)) {
        expect(readFileSync(tmp, 'utf8')).toBe('');
      }
    } finally {
      repo.limpar();
    }
  });
});
