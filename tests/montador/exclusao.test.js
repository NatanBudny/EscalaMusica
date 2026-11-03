// Testes de desativar/excluir (Task 10): Property 11 (exclusão definitiva).

import fc from 'fast-check';
import { writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import {
  desativarPessoa,
  motivosBloqueioExclusao,
  excluirPessoa,
} from '../../montador/lib/pessoas.mjs';
import { derivarContatos } from '../../scripts/lib/contatos.js';

function pessoaMin(id, nome, over = {}) {
  return {
    id,
    nome,
    aliases: [],
    telefone: '',
    genero: 'M',
    ativo: true,
    perfil_canto: 'base',
    notas: '',
    habilitacoes: { regente: false, equipe: true, mensagem_musical: { es: false, culto: false, domingo: false }, sonoplastia: false },
    afastado: null,
    vinculos: [],
    dias_permitidos: null,
    ...over,
  };
}

// Estas funções só leem/gravam arquivos (não dependem de git), então usamos uma
// pasta temporária simples (sem git) para manter a propriedade rápida.
function montarRepo({ pessoas, grupos = {}, atual = [], old = {} }) {
  const dir = mkdtempSync(resolve(tmpdir(), 'escala-excl-'));
  const arquivo = {
    versao: '1.0.0',
    proximo_id: Math.max(0, ...pessoas.map((p) => p.id)) + 1,
    ultima_atualizacao: '2026-01-01',
    grupos,
    departamentos_contato: {},
    pessoas,
  };
  const escrever = (rel, dados) => {
    const caminho = resolve(dir, rel);
    mkdirSync(resolve(caminho, '..'), { recursive: true });
    writeFileSync(caminho, `${JSON.stringify(dados, null, 2)}\n`, 'utf8');
  };
  escrever('pessoas.json', arquivo);
  escrever('contatos.json', derivarContatos(pessoas, grupos));
  escrever('atual.json', atual);
  for (const [rel, dados] of Object.entries(old)) escrever(rel, dados);
  return { dir, limpar: () => rmSync(dir, { recursive: true, force: true }) };
}

describe('Property 11: Exclusão definitiva', () => {
  // Feature: melhoras-domingao, Property 11: Exclusão definitiva
  test('excluir permitido sse não há vínculo, grupo nem histórico', () => {
    fc.assert(
      fc.property(
        fc.record({
          temVinculoProprio: fc.boolean(),
          referidaPorOutro: fc.boolean(),
          membroDeGrupo: fc.boolean(),
          responsavelDeGrupo: fc.boolean(),
          noAtual: fc.boolean(),
          noOld: fc.boolean(),
        }),
        (cond) => {
          // Pessoa alvo = id 1 (nome ALVO). Outras: 2 (OUTRA), 3 (RESP).
          const alvo = pessoaMin(1, 'ALVO');
          const outra = pessoaMin(2, 'OUTRA');
          const resp = pessoaMin(3, 'RESP');

          if (cond.temVinculoProprio) {
            alvo.vinculos = [{ tipo: 'sempre_junto', com_id: 2 }];
            outra.vinculos = [{ tipo: 'sempre_junto', com_id: 1 }];
          }
          if (cond.referidaPorOutro && !cond.temVinculoProprio) {
            outra.vinculos = [{ tipo: 'precisa_de', com_ids: [1] }];
          }

          const grupos = {};
          if (cond.membroDeGrupo) {
            grupos.familia = { membros_ids: [1, 2] };
          }
          if (cond.responsavelDeGrupo) {
            grupos.min = {
              escalavel: true,
              nome_exibicao: 'GRUPO RESP',
              responsavel_id: 1,
              membros_ids: [1, 3],
              modo: 'funcao',
              funcoes: ['mm'],
            };
          }

          const atual = cond.noAtual ? [{ DATA: '2026-09-05', 'EQUIPE LOUVOR': 'ALVO' }] : [];
          const old = cond.noOld
            ? { 'old/2026/062026.json': [{ DATA: '2026-06-06', 'REGENTE LOUVOR': 'ALVO' }] }
            : {};

          const repo = montarRepo({ pessoas: [alvo, outra, resp], grupos, atual, old });
          try {
            const motivos = motivosBloqueioExclusao(1, { root: repo.dir });
            const bloqueado =
              cond.temVinculoProprio ||
              cond.referidaPorOutro ||
              cond.membroDeGrupo ||
              cond.responsavelDeGrupo ||
              cond.noAtual ||
              cond.noOld;

            if (bloqueado) {
              expect(motivos.length).toBeGreaterThan(0);
              expect(() => excluirPessoa(1, { root: repo.dir })).toThrow();
            } else {
              expect(motivos).toEqual([]);
              const { pessoa } = excluirPessoa(1, { root: repo.dir });
              expect(pessoa.nome).toBe('ALVO');
            }
          } finally {
            repo.limpar();
          }
        },
      ),
      { numRuns: 100 },
    );
  }, 120000);

  test('desativarPessoa grava ativo=false e zera habilitações', () => {
    const repo = montarRepo({
      pessoas: [pessoaMin(1, 'ALICE', { habilitacoes: { regente: true, equipe: true, mensagem_musical: { es: true, culto: true, domingo: true }, sonoplastia: true } })],
    });
    try {
      const { pessoa } = desativarPessoa(1, { root: repo.dir });
      expect(pessoa.ativo).toBe(false);
      expect(pessoa.habilitacoes.regente).toBe(false);
      expect(pessoa.habilitacoes.equipe).toBe(false);
      expect(pessoa.habilitacoes.sonoplastia).toBe(false);
      expect(pessoa.habilitacoes.mensagem_musical).toEqual({ es: false, culto: false, domingo: false });
    } finally {
      repo.limpar();
    }
  });
});
