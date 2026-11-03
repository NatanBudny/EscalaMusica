// Testes da Sonoplastia (Task 16):
// - sonoplasta+suporte do cadastro viram 2 IDs em cultosDoMes/externosPorCulto;
// - arquivo antigo sem ids resolve por nome;
// - texto livre com vírgula recusado;
// - sem sonoplastia.json o comportamento atual não muda.

import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { carregarPessoas } from '../../scripts/lib/cadastro.js';
import {
  validarSonoplastia,
  salvarSonoplastia,
  lerSonoplastia,
} from '../../montador/lib/insumos.mjs';
import { cultosDoMes } from '../../montador/lib/regras.mjs';

function pessoa(id, nome, sonoplastia, extras = {}) {
  return {
    id,
    nome,
    aliases: extras.aliases || [],
    telefone: extras.telefone || '',
    genero: extras.genero || 'M',
    ativo: extras.ativo !== false,
    perfil_canto: null,
    notas: '',
    habilitacoes: {
      regente: false,
      equipe: true,
      mensagem_musical: { es: false, culto: false, domingo: false },
      sonoplastia: sonoplastia === true,
    },
    afastado: null,
    vinculos: [],
    dias_permitidos: null,
  };
}

function montarRoot() {
  const dir = mkdtempSync(resolve(tmpdir(), 'escala-son-'));
  const pessoas = [
    pessoa(3, 'ALEX', true, { aliases: ['ALEXANDRE'] }),
    pessoa(16, 'DIEGO', true),
    pessoa(5, 'BRUNO', false), // sem habilitação de sonoplastia
  ];
  const arquivo = { versao: '1.0.0', proximo_id: 17, grupos: {}, pessoas };
  writeFileSync(resolve(dir, 'pessoas.json'), `${JSON.stringify(arquivo, null, 2)}\n`, 'utf8');
  mkdirSync(resolve(dir, 'escalas/2026/09/insumos'), { recursive: true });
  return { dir, cadastro: carregarPessoas(resolve(dir, 'pessoas.json')) };
}

describe('Task 16: validarSonoplastia', () => {
  test('aceita sonoplasta e suporte do cadastro', () => {
    const { dir, cadastro } = montarRoot();
    const problemas = validarSonoplastia('2026-09', {
      itens: [{ data: '2026-09-05', dia: 'sabado', sonoplastia: ['ALEX', 'DIEGO'], ids: [3, 16] }],
    }, cadastro);
    expect(problemas).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });

  test('recusa ID sem habilitação de sonoplastia', () => {
    const { dir, cadastro } = montarRoot();
    const problemas = validarSonoplastia('2026-09', {
      itens: [{ data: '2026-09-05', dia: 'sabado', sonoplastia: ['BRUNO'], ids: [5] }],
    }, cadastro);
    expect(problemas.some((p) => p.includes('habilitação'))).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  test('recusa texto livre com vírgula', () => {
    const { dir, cadastro } = montarRoot();
    const problemas = validarSonoplastia('2026-09', {
      itens: [{ data: '2026-09-02', dia: 'quarta-feira', sonoplastia: ['FULANO, BELTRANO'], ids: [null] }],
    }, cadastro);
    expect(problemas.some((p) => p.includes('texto livre'))).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  test('aceita texto livre sem vírgula', () => {
    const { dir, cadastro } = montarRoot();
    const problemas = validarSonoplastia('2026-09', {
      itens: [{ data: '2026-09-02', dia: 'quarta-feira', sonoplastia: ['VOLUNTÁRIO'], ids: [null] }],
    }, cadastro);
    expect(problemas).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('Task 16: salvar/ler e cultosDoMes', () => {
  test('salvar grava ids e cultosDoMes expõe audiovisual, suporte e sonoplastiaIds', () => {
    const { dir, cadastro } = montarRoot();
    // Acionato mínimo para o mês.
    writeFileSync(
      resolve(dir, 'escalas/2026/09/insumos/acionato.json'),
      `${JSON.stringify({
        mes: '2026-09',
        itens: [
          { data: '2026-09-05', dia: 'sabado', anciao: 'X', pregador: 'Y', observacoes: 'CULTO', modelo_louvor: 'sabado' },
        ],
      }, null, 2)}\n`,
      'utf8',
    );

    const { arquivos } = salvarSonoplastia('2026-09', {
      itens: [{ data: '2026-09-05', dia: 'sabado', sonoplastia: ['ALEX', 'DIEGO'], ids: [3, 16] }],
    }, { root: dir });
    expect(arquivos).toEqual(['escalas/2026/09/insumos/sonoplastia.json']);

    const son = lerSonoplastia('2026-09', { root: dir });
    expect(son.itens[0].ids).toEqual([3, 16]);

    const cultos = cultosDoMes('2026-09', cadastro, dir);
    const culto = cultos.find((c) => c.data === '2026-09-05');
    expect(culto.audiovisual).toBe('ALEX');
    expect(culto.suporte).toBe('DIEGO');
    expect([...culto.sonoplastiaIds].sort((a, b) => a - b)).toEqual([3, 16]);
    expect(culto.obs).toBe('CULTO');
    rmSync(dir, { recursive: true, force: true });
  });

  test('arquivo antigo sem ids resolve nomes por nome/apelido', () => {
    const { dir, cadastro } = montarRoot();
    writeFileSync(
      resolve(dir, 'escalas/2026/09/insumos/acionato.json'),
      `${JSON.stringify({ mes: '2026-09', itens: [{ data: '2026-09-05', dia: 'sabado', modelo_louvor: 'sabado' }] }, null, 2)}\n`,
      'utf8',
    );
    // Sem campo "ids": formato antigo.
    writeFileSync(
      resolve(dir, 'escalas/2026/09/insumos/sonoplastia.json'),
      `${JSON.stringify({ mes: '2026-09', itens: [{ data: '2026-09-05', dia: 'sabado', sonoplastia: ['ALEXANDRE', 'VOLUNTÁRIO'] }] }, null, 2)}\n`,
      'utf8',
    );
    const cultos = cultosDoMes('2026-09', cadastro, dir);
    const culto = cultos.find((c) => c.data === '2026-09-05');
    // ALEXANDRE é apelido de ALEX (id 3); VOLUNTÁRIO é texto livre (sem id).
    expect(culto.sonoplastiaIds).toEqual([3]);
    expect(culto.suporte).toBe('VOLUNTÁRIO');
    rmSync(dir, { recursive: true, force: true });
  });

  test('sem sonoplastia.json, audiovisual vem do acionato e suporte é "-"', () => {
    const { dir, cadastro } = montarRoot();
    writeFileSync(
      resolve(dir, 'escalas/2026/09/insumos/acionato.json'),
      `${JSON.stringify({ mes: '2026-09', itens: [{ data: '2026-09-05', dia: 'sabado', audiovisual: 'ALEX', modelo_louvor: 'sabado' }] }, null, 2)}\n`,
      'utf8',
    );
    const cultos = cultosDoMes('2026-09', cadastro, dir);
    const culto = cultos.find((c) => c.data === '2026-09-05');
    expect(culto.audiovisual).toBe('ALEX');
    expect(culto.suporte).toBe('-');
    expect(culto.sonoplastiaIds).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });
});
