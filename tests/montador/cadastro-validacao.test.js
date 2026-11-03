// Testes das validações do cadastro (Task 6): Property 6 (telefone) e
// Property 7 (regras de salvamento).

import fc from 'fast-check';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  validarTelefone,
  verificarPessoa,
  salvarPessoa,
} from '../../montador/lib/pessoas.mjs';
import { derivarContatos } from '../../scripts/lib/contatos.js';
import { criarRepoTemporario } from '../helpers/repo-temporario.js';

/** pessoas.json mínimo e válido, com telefones conhecidos. */
function cadastroBase() {
  return {
    versao: '1.0.0',
    proximo_id: 4,
    ultima_atualizacao: '2026-01-01',
    grupos: {},
    departamentos_contato: {},
    pessoas: [
      {
        id: 1,
        nome: 'ANA',
        aliases: ['ANINHA'],
        telefone: '5543999990001',
        genero: 'F',
        ativo: true,
        perfil_canto: 'base',
        notas: '',
        habilitacoes: { regente: false, equipe: true, mensagem_musical: { es: false, culto: false, domingo: false } },
        afastado: null,
        vinculos: [],
        dias_permitidos: null,
      },
      {
        id: 2,
        nome: 'BERNARDO',
        aliases: [],
        telefone: '5543999990002',
        genero: 'M',
        ativo: true,
        perfil_canto: 'base',
        notas: '',
        habilitacoes: { regente: true, equipe: true, mensagem_musical: { es: false, culto: false, domingo: false } },
        afastado: null,
        vinculos: [],
        dias_permitidos: null,
      },
      {
        id: 3,
        nome: 'RONI',
        aliases: [],
        telefone: '5543999990002', // mesmo número de BERNARDO (compartilhado)
        genero: 'M',
        ativo: true,
        perfil_canto: 'base',
        notas: '',
        habilitacoes: { regente: false, equipe: true, mensagem_musical: { es: false, culto: false, domingo: false } },
        afastado: null,
        vinculos: [],
        dias_permitidos: null,
      },
    ],
  };
}

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

describe('Property 6: Formato de telefone', () => {
  // Feature: melhoras-domingao, Property 6: Formato de telefone
  test('validarTelefone aceita sse dígitos vazios ou casam com ^55[1-9]{2}\\d{8,9}$', () => {
    const re = /^55[1-9]{2}\d{8,9}$/;
    fc.assert(
      fc.property(
        fc.oneof(
          fc.string({ maxLength: 20, unit: fc.constantFrom(...'0123456789 ()-+'.split('')) }),
          // Gera também números plausíveis.
          fc
            .tuple(
              fc.integer({ min: 1, max: 9 }),
              fc.integer({ min: 1, max: 9 }),
              fc.string({ minLength: 7, maxLength: 10, unit: fc.constantFrom(...'0123456789'.split('')) }),
            )
            .map(([a, b, resto]) => `55${a}${b}${resto}`),
        ),
        (texto) => {
          const dig = String(texto).replace(/\D/g, '');
          const esperado = dig === '' || re.test(dig);
          expect(validarTelefone(texto).ok).toBe(esperado);
        },
      ),
      { numRuns: 300 },
    );
  });

  test('exemplos', () => {
    expect(validarTelefone('').ok).toBe(true);
    expect(validarTelefone('5543999998888').ok).toBe(true); // 9 dígitos
    expect(validarTelefone('554399998888').ok).toBe(true); // 8 dígitos
    expect(validarTelefone('55 (43) 99999-8888').ok).toBe(true);
    expect(validarTelefone('999998888').ok).toBe(false); // sem 55
    expect(validarTelefone('5503999998888').ok).toBe(false); // DDD com 0
    expect(validarTelefone('5543').ok).toBe(false);
  });
});

describe('Property 7: Regras de salvamento do cadastro', () => {
  // Feature: melhoras-domingao, Property 7: Regras de salvamento do cadastro
  test('duplicidade exata/normalizada; confirmação de telefone; telefone compartilhado', () => {
    const repo = prepararRepo();
    try {
      // nome igual ao de outra pessoa → erro.
      let r = verificarPessoa({ nome: 'ANA', telefone: '' }, null, { root: repo.dir });
      expect(r.erros.length).toBeGreaterThan(0);

      // apelido igual ao de outra pessoa → erro.
      r = verificarPessoa({ nome: 'NOVA', aliases: ['ANINHA'], telefone: '' }, null, { root: repo.dir });
      expect(r.erros.length).toBeGreaterThan(0);

      // coincidência só após normalização → aviso (não erro).
      r = verificarPessoa({ nome: 'ÂNA', telefone: '' }, null, { root: repo.dir });
      expect(r.erros).toEqual([]);
      expect(r.avisos.length).toBeGreaterThan(0);

      // telefone compartilhado com BERNARDO e RONI → informado, sem erro.
      r = verificarPessoa({ nome: 'NOVA', telefone: '5543999990002' }, null, { root: repo.dir });
      expect(r.erros).toEqual([]);
      expect(r.telefoneCompartilhadoCom.sort()).toEqual(['BERNARDO', 'RONI']);

      // salvar com telefone novo sem confirmação → recusa.
      expect(() =>
        salvarPessoa({ nome: 'CARLA', telefone: '5543999990009' }, { root: repo.dir }),
      ).toThrow(/[Cc]onfirme/);

      // salvar com telefone novo e confirmação → ok.
      const { pessoa } = salvarPessoa(
        { nome: 'CARLA', telefone: '5543999990009' },
        { confirmacaoTelefone: true, root: repo.dir },
      );
      expect(pessoa.nome).toBe('CARLA');

      // editar sem mudar telefone não exige confirmação.
      const { pessoa: anaEdit } = salvarPessoa(
        { nome: 'ANA', telefone: '5543999990001', notas: 'x' },
        { id: 1, root: repo.dir },
      );
      expect(anaEdit.notas).toBe('x');

      // salvar aviso de duplicidade sem confirmar → recusa; com confirmar → ok.
      expect(() =>
        salvarPessoa({ nome: 'ÂNA', telefone: '' }, { root: repo.dir }),
      ).toThrow(/avisos/);
      const { pessoa: ana2 } = salvarPessoa(
        { nome: 'ÂNA', telefone: '' },
        { confirmarAvisos: true, root: repo.dir },
      );
      expect(ana2.nome).toBe('ÂNA');
    } finally {
      repo.limpar();
    }
  });

  // Feature: melhoras-domingao, Property 7: Regras de salvamento do cadastro
  test('propriedade: telefone compartilhado devolve exatamente as outras pessoas do número', () => {
    const repo = prepararRepo();
    try {
      fc.assert(
        fc.property(
          fc.constantFrom('5543999990001', '5543999990002', '5543999990099', ''),
          (telefone) => {
            const r = verificarPessoa({ nome: 'ZZZ TESTE', telefone }, null, { root: repo.dir });
            const dig = telefone.replace(/\D/g, '');
            const esperado = dig
              ? cadastroBase()
                  .pessoas.filter((p) => p.telefone === dig)
                  .map((p) => p.nome)
              : [];
            expect(r.telefoneCompartilhadoCom.sort()).toEqual(esperado.sort());
            // Telefone compartilhado nunca gera erro.
            if (dig && esperado.length) {
              expect(r.erros).toEqual([]);
            }
          },
        ),
        { numRuns: 100 },
      );
    } finally {
      repo.limpar();
    }
  });
});
