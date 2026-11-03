// Testes da derivação de contatos (Task 3): Property 3 e unitário do script.

import fc from 'fast-check';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { derivarContatos } from '../../scripts/lib/contatos.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');

/** Gerador de uma pessoa simples com id/nome dados. */
function arbPessoa(id, nome) {
  return fc.record({
    id: fc.constant(id),
    nome: fc.constant(nome),
    aliases: fc.array(
      fc.string({ minLength: 1, maxLength: 6, unit: fc.constantFrom(...'ABCDEF'.split('')) }),
      { maxLength: 3 },
    ),
    // telefone: dígitos ou vazio.
    telefone: fc.oneof(
      fc.constant(''),
      fc.string({ minLength: 10, maxLength: 13, unit: fc.constantFrom(...'0123456789'.split('')) }),
    ),
  });
}

function arbPessoas(min = 1, max = 8) {
  return fc.integer({ min, max }).chain((n) => {
    const arbs = [];
    for (let i = 0; i < n; i += 1) {
      arbs.push(arbPessoa(i + 1, `PESSOA${String(i + 1).padStart(2, '0')}`));
    }
    return fc.tuple(...arbs);
  });
}

describe('Property 3: Derivação de contatos', () => {
  // Feature: melhoras-domingao, Property 3: Derivação de contatos
  test('inclui só pessoas com telefone, no formato wa.me, ordem alfabética e determinístico', () => {
    fc.assert(
      fc.property(arbPessoas(), (pessoas) => {
        const contatos = derivarContatos(pessoas, {});
        const chaves = Object.keys(contatos);

        // Pessoas com telefone estão presentes; sem telefone, ausentes.
        for (const p of pessoas) {
          const temTel = String(p.telefone || '').replace(/\D/g, '') !== '';
          if (temTel) {
            expect(contatos[p.nome]).toBeDefined();
            expect(contatos[p.nome].telefone).toBe(`https://wa.me/${p.telefone}`);
            expect(contatos[p.nome].apelidos).toEqual(p.aliases);
          } else {
            expect(contatos[p.nome]).toBeUndefined();
          }
        }

        // Ordem alfabética (pt-BR, sem acento/caixa).
        const ordenadas = [...chaves].sort((a, b) =>
          a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }),
        );
        expect(chaves).toEqual(ordenadas);

        // Determinístico: duas chamadas iguais.
        expect(derivarContatos(pessoas, {})).toEqual(contatos);
      }),
      { numRuns: 100 },
    );
  });

  // Feature: melhoras-domingao, Property 3: Derivação de contatos (grupos)
  test('inclui uma entrada por grupo escalável cujo responsável tem telefone', () => {
    const pessoas = [
      { id: 1, nome: 'NILSINHO', aliases: ['NILSON'], telefone: '554396557195' },
      { id: 2, nome: 'JULIANA', aliases: [], telefone: '' },
    ];
    const grupos = {
      familia: {
        escalavel: true,
        nome_exibicao: 'FAMILIA NILSINHO',
        responsavel_id: 1,
        membros_ids: [1, 2],
      },
      // Grupo não escalável não entra.
      outro: { membros_ids: [1, 2] },
      // Grupo escalável cujo responsável não tem telefone não entra.
      semtel: {
        escalavel: true,
        nome_exibicao: 'GRUPO SEM TEL',
        responsavel_id: 2,
        membros_ids: [1, 2],
      },
    };
    const contatos = derivarContatos(pessoas, grupos);
    expect(contatos['FAMILIA NILSINHO']).toEqual({
      telefone: 'https://wa.me/554396557195',
      apelidos: [],
    });
    expect(contatos['GRUPO SEM TEL']).toBeUndefined();
  });
});

describe('Task 3.3: gerar-contatos derivado bate com o cadastro do repositório', () => {
  test('derivarContatos reproduz a lógica do script antigo (só pessoas) para pessoas.json', () => {
    const arquivo = JSON.parse(readFileSync(resolve(ROOT, 'pessoas.json'), 'utf8'));

    // Reprodução da lógica do script anterior (somente pessoas com telefone).
    const esperadoObj = {};
    for (const p of arquivo.pessoas) {
      if (!p.telefone) continue;
      esperadoObj[p.nome] = {
        telefone: `https://wa.me/${p.telefone}`,
        apelidos: p.aliases || [],
      };
    }
    const chaves = Object.keys(esperadoObj).sort((a, b) =>
      a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }),
    );
    const esperado = {};
    for (const c of chaves) esperado[c] = esperadoObj[c];

    // O repositório atual não tem grupos escaláveis, então derivarContatos deve
    // produzir exatamente o mesmo que o script antigo produzia.
    expect(derivarContatos(arquivo.pessoas, arquivo.grupos || {})).toEqual(esperado);
  });
});
