// Testes da migração do contatos.json (Task 4): Property 4 (parte pessoas) e
// teste com os arquivos reais do repositório.

import fc from 'fast-check';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  diferencasContatos,
  aplicarMigracaoContatos,
  pendenciasCaracteresCadastro,
  aplicarMigracaoGrupos,
} from '../../montador/lib/migracoes.mjs';
import { derivarContatos } from '../../scripts/lib/contatos.js';
import { carregarPessoas } from '../../scripts/lib/cadastro.js';
import { problemasNome } from '../../scripts/lib/texto-publico.js';
import { criarRepoTemporario } from '../helpers/repo-temporario.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');

/** Valida um pessoasArquivo em memória via carregarPessoas (grava tmp). */
function validar(pessoasArquivo, dir) {
  const caminho = resolve(dir, '.validar.tmp.json');
  const arquivo = { ...pessoasArquivo };
  arquivo.proximo_id = Math.max(0, ...arquivo.pessoas.map((p) => p.id)) + 1;
  writeFileSync(caminho, `${JSON.stringify(arquivo, null, 2)}\n`, 'utf8');
  carregarPessoas(caminho);
  unlinkSync(caminho);
}

describe('diferencasContatos classifica pendências', () => {
  const pessoasArquivo = {
    proximo_id: 3,
    grupos: {},
    pessoas: [
      { id: 1, nome: 'LAURA', aliases: [], telefone: '554396284856', ativo: true },
      { id: 2, nome: 'ANA', aliases: [], telefone: '554399990002', ativo: true },
    ],
  };

  test('entrada com telefone de uma pessoa fica pendente por telefone', () => {
    const contatos = {
      'LAURA GESSNER': { telefone: 'https://wa.me/554396284856', apelidos: ['LAURA'] },
    };
    const diffs = diferencasContatos(contatos, pessoasArquivo);
    const laura = diffs.find((d) => d.chave === 'LAURA GESSNER');
    expect(laura.pendencia.motivo).toBe('telefone_compartilhado');
    expect(laura.pendencia.pessoas.map((p) => p.nome)).toContain('LAURA');
    const tipos = laura.pendencia.opcoes.map((o) => o.tipo);
    expect(tipos).toContain('apelido_de');
    expect(tipos).toContain('pessoa_nova');
  });

  test('entrada sem pessoa de mesmo telefone e com caractere inválido fica pendente por caractere', () => {
    const contatos = {
      'ZÉ, DA ESQUINA': { telefone: 'https://wa.me/554399990099', apelidos: [] },
    };
    const diffs = diferencasContatos(contatos, pessoasArquivo);
    const ze = diffs.find((d) => d.chave === 'ZÉ, DA ESQUINA');
    expect(ze.pendencia.motivo).toBe('caracteres');
  });

  test('entrada nova sem telefone de pessoa e nome válido vira pessoa nova', () => {
    const contatos = {
      JOANA: { telefone: 'https://wa.me/554399990088', apelidos: ['JÔ'] },
    };
    const diffs = diferencasContatos(contatos, pessoasArquivo);
    const joana = diffs.find((d) => d.chave === 'JOANA');
    expect(joana.pendencia).toBeUndefined();
    expect(joana.proposta.viraPessoaNova).toBe(true);
  });
});

describe('Property 4 (pessoas): Migração de contatos sem perda', () => {
  // Gera pessoas e entradas extras no contatos.json.
  const arbTelefone = fc.string({
    minLength: 11,
    maxLength: 11,
    unit: fc.constantFrom(...'0123456789'.split('')),
  }).map((d) => `55${d}`);

  // Nome só com letras (sem dígitos) para não gerar pendência de caractere.
  const LETRAS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const arbPessoa = (id) =>
    fc.record({
      id: fc.constant(id),
      nome: fc.constant(`PESSOA ${LETRAS[id % LETRAS.length]}${LETRAS[(id * 7) % LETRAS.length]}`),
      aliases: fc.constant([]),
      telefone: fc.oneof(fc.constant(''), arbTelefone),
      ativo: fc.constant(true),
    });

  // Feature: melhoras-domingao, Property 4: Migração de contatos sem perda
  test('entradas pendentes nunca viram apelido sem decisão; nada se perde após aplicar', () => {
    const repo = criarRepoTemporario();
    try {
      fc.assert(
        fc.property(
          fc
            .integer({ min: 1, max: 4 })
            .chain((n) => fc.tuple(...Array.from({ length: n }, (_, i) => arbPessoa(i + 1)))),
          // Entradas extras só no contatos.json.
          fc.array(
            fc.record({
              chave: fc.string({
                minLength: 3,
                maxLength: 8,
                unit: fc.constantFrom(...'ABCDEFGH'.split('')),
              }),
              telefone: arbTelefone,
            }),
            { maxLength: 3 },
          ),
          (pessoas, extras) => {
            const pessoasArquivo = { proximo_id: pessoas.length + 1, grupos: {}, pessoas };

            // Monta contatos atual: entradas derivadas + extras com chave única.
            // Apelidos únicos por índice evitam colisões artificiais (nomes de
            // pessoas, chaves e apelidos devem ser globalmente únicos).
            const contatos = derivarContatos(pessoas, {});
            const nomesUsados = new Set(pessoas.map((p) => p.nome));
            const extrasUnicos = [];
            const usados = new Set(Object.keys(contatos));
            extras.forEach((e, i) => {
              const chave = `EXTRA ${String.fromCharCode(65 + i)} ${e.chave}`;
              if (usados.has(chave) || nomesUsados.has(chave)) return;
              usados.add(chave);
              const apelido = `APELIDO ${String.fromCharCode(65 + i)}`;
              contatos[chave] = {
                telefone: `https://wa.me/${e.telefone}`,
                apelidos: [apelido],
              };
              extrasUnicos.push({ chave, telefone: e.telefone, apelido });
            });

            // Decide cada pendência.
            const diffs = diferencasContatos(contatos, pessoasArquivo);
            const decisoes = {};
            for (const d of diffs) {
              if (!d.pendencia) continue;
              if (d.pendencia.motivo === 'telefone_compartilhado') {
                // Escolhe "pessoa nova" para manter o telefone/apelidos.
                decisoes[d.chave] = { tipo: 'pessoa_nova' };
              } else if (d.pendencia.motivo === 'caracteres') {
                decisoes[d.chave] = { tipo: 'remover' };
              }
            }
            for (const c of pendenciasCaracteresCadastro(pessoasArquivo)) {
              decisoes[c.chave] = c.escopo === 'apelido'
                ? { tipo: 'remover' }
                : { tipo: 'renomear', novoNome: 'RENOMEADO' };
            }

            // Sem decisão, aplicar deve lançar quando há pendência.
            const temPendencia = diffs.some((d) => d.pendencia) ||
              pendenciasCaracteresCadastro(pessoasArquivo).length > 0;
            if (temPendencia) {
              expect(() => aplicarMigracaoContatos(pessoasArquivo, contatos, {})).toThrow();
            }

            const resultado = aplicarMigracaoContatos(pessoasArquivo, contatos, decisoes);

            // O cadastro resultante é aprovado pelo validador.
            expect(() => validar(resultado, repo.dir)).not.toThrow();

            // derivarContatos do resultado contém telefone e apelidos de cada
            // entrada mantida (as decididas "remover" por caractere são exceção).
            const gerado = derivarContatos(resultado.pessoas, resultado.grupos || {});
            for (const e of extrasUnicos) {
              const temCaractere = problemasNome(e.chave).length > 0;
              if (temCaractere) continue; // removida por decisão
              // O telefone da entrada deve aparecer em alguma chave do gerado.
              const digitos = e.telefone;
              const algum = Object.values(gerado).some(
                (v) => v.telefone === `https://wa.me/${digitos}`,
              );
              expect(algum).toBe(true);
            }

            // Migração marcada como concluída.
            expect(resultado.migracoes.contatos_para_pessoas).toMatch(/^\d{4}-\d{2}-\d{2}$/);
          },
        ),
        { numRuns: 100 },
      );
    } finally {
      repo.limpar();
    }
  }, 120000);
});

describe('Task 4.2: migração com os arquivos reais do repositório', () => {
  // Baseline agosto/2026 da migração: pessoas.json real (antes da migração de
  // grupos) e um contatos.json com as entradas manuais legadas (LAURA GESSNER,
  // MIN. JOVEM e FAMILIA NILSINHO) que a migração de grupos converte em
  // Grupo_Escalavel. O contatos.json vivo do repositório já é derivado e não
  // carrega mais MIN. JOVEM/FAMILIA NILSINHO, por isso usamos a fixture.
  const FIX = resolve(ROOT, 'tests/fixtures/migracao-contatos');
  const pessoasArquivo = JSON.parse(readFileSync(resolve(FIX, 'pessoas.json'), 'utf8'));
  const contatos = JSON.parse(readFileSync(resolve(FIX, 'contatos.json'), 'utf8'));

  test('LAURA GESSNER e MIN. JOVEM pendentes por telefone; FABRICIO 1 pendente por caractere', () => {
    const diffs = diferencasContatos(contatos, pessoasArquivo);

    const laura = diffs.find((d) => d.chave === 'LAURA GESSNER');
    expect(laura).toBeDefined();
    expect(laura.pendencia.motivo).toBe('telefone_compartilhado');
    expect(laura.pendencia.pessoas.map((p) => p.nome)).toContain('LAURA');

    const minJovem = diffs.find((d) => d.chave === 'MIN. JOVEM');
    expect(minJovem).toBeDefined();
    // Sem migração de grupos (Task 8), MIN. JOVEM tem o telefone de FABRICIO →
    // pendência por telefone compartilhado.
    expect(minJovem.pendencia.motivo).toBe('telefone_compartilhado');
    expect(minJovem.pendencia.pessoas.map((p) => p.nome)).toContain('FABRICIO');

    // Apelido FABRICIO 1 (dígito) é pendência de caractere no cadastro.
    const caracteres = pendenciasCaracteresCadastro(pessoasArquivo);
    const fab1 = caracteres.find((c) => c.chave === 'FABRICIO 1');
    expect(fab1).toBeDefined();
    expect(fab1.escopo).toBe('apelido');
  });

  test('após decidir e aplicar, telefones/apelidos mantidos estão no contatos.json regenerado', () => {
    // Task 8: a migração de grupos roda antes da de contatos. Depois dela,
    // MIN. JOVEM vira coberto_por_grupo e sai das pendências de contatos.
    const comGrupos = aplicarMigracaoGrupos(pessoasArquivo);
    const diffs = diferencasContatos(contatos, comGrupos);
    const decisoes = {};
    for (const d of diffs) {
      if (!d.pendencia) continue;
      if (d.pendencia.motivo === 'telefone_compartilhado') {
        // Vira apelido da pessoa de mesmo telefone (primeira opção).
        const opc = d.pendencia.opcoes.find((o) => o.tipo === 'apelido_de');
        decisoes[d.chave] = { tipo: 'apelido_de', pessoaId: opc.pessoaId };
      } else if (d.pendencia.motivo === 'caracteres') {
        decisoes[d.chave] = { tipo: 'remover' };
      }
    }
    for (const c of pendenciasCaracteresCadastro(comGrupos)) {
      // Renomeia o apelido FABRICIO 1 para FABRICIO UM (sem dígito).
      decisoes[c.chave] = c.escopo === 'apelido'
        ? { tipo: 'renomear', novoNome: 'FABRICIO UM' }
        : { tipo: 'renomear', novoNome: c.chave.replace(/[^\p{L} .'-]/gu, '') };
    }

    const resultado = aplicarMigracaoContatos(comGrupos, contatos, decisoes);

    // LAURA agora tem o apelido "LAURA GESSNER".
    const laura = resultado.pessoas.find((p) => p.nome === 'LAURA');
    expect(laura.aliases).toContain('LAURA GESSNER');

    // FABRICIO tem o apelido renomeado. MIN. JOVEM é coberto pelo grupo, então
    // não vira apelido de FABRICIO.
    const fabricio = resultado.pessoas.find((p) => p.nome === 'FABRICIO');
    expect(fabricio.aliases).toContain('FABRICIO UM');
    expect(fabricio.aliases).not.toContain('FABRICIO 1');
    expect(fabricio.aliases).not.toContain('MIN. JOVEM');

    // O contatos.json regenerado contém os telefones originais.
    const gerado = derivarContatos(resultado.pessoas, resultado.grupos || {});
    expect(gerado.LAURA.telefone).toBe('https://wa.me/554396284856');
    expect(gerado.FABRICIO.telefone).toBe('https://wa.me/554396670568');
  });
});
