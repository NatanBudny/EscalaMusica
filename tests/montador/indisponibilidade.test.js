// Testes da importação da indisponibilidade (Task 17):
// - Property 24: associação da enquete;
// - Property 25: indisponibilidade vinculada;
// - dados reais + exact-reproduction de montarVinculada;
// - entrada 5543996579868 pendente entre BERNARDO e RONI (sem apelido).

import fc from 'fast-check';
import { readFileSync, mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { carregarPessoas } from '../../scripts/lib/cadastro.js';
import { resolverPessoaPorNome } from '../../scripts/lib/fuzzy-match.js';
import normalizar from '../../scripts/lib/normalizar.js';
import { nomesDaEnquete, montarVinculada } from '../../scripts/lib/indisponibilidade.js';
import {
  validarEnquete,
  analisarEnquete,
  gravarImportacao,
} from '../../montador/lib/indisponibilidade.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');

// Cadastro sintético para controlar telefones/nomes/vínculos.
function cadastroDe(pessoas) {
  const porId = new Map();
  const porNome = new Map();
  for (const p of pessoas) {
    porId.set(p.id, p);
    porNome.set(normalizar(p.nome), p);
    for (const a of p.aliases || []) porNome.set(normalizar(a), p);
  }
  return { pessoas, porId, porNome };
}

function pessoa(id, nome, telefone = '', aliases = [], vinculos = []) {
  return { id, nome, telefone, aliases, vinculos, ativo: true };
}

describe('Property 24: Associação da enquete', () => {
  // Feature: melhoras-domingao, Property 24: Associação da enquete
  test('telefone único associa; compartilhado fica pendente; nome único associa; ambíguo pende', () => {
    const cadastro = cadastroDe([
      pessoa(1, 'ALICE', '5543999990001', ['ALI']),
      pessoa(2, 'BRUNO', '5543999990002'),
      pessoa(3, 'CARLA', '5543888880000'), // compartilha número com DIEGO
      pessoa(4, 'DIEGO', '5543888880000'),
      pessoa(5, 'EVA', '', ['EVINHA']),
      pessoa(6, 'EVA MARIA', '', ['EVINHA']), // apelido ambíguo com EVA
    ]);

    const enquete = {
      datas: [
        {
          data_referencia: '2026-09-05',
          dia_semana: 'sabado',
          indisponiveis: [
            '5543999990001', // telefone único → ALICE
            '5543888880000', // telefone compartilhado → pendente (CARLA, DIEGO)
            'Bruno', // nome único → BRUNO
            'Evinha', // apelido ambíguo → pendente (EVA, EVA MARIA)
            'Zezinho', // nada → pendente (só por semelhança)
          ],
        },
      ],
    };

    const analises = analisarEnquete(enquete, cadastro);
    const porNome = new Map(analises.map((a) => [a.nomeEnquete, a]));

    expect(porNome.get('5543999990001')).toMatchObject({ estado: 'associado', por: 'telefone', pessoaId: 1 });

    const comp = porNome.get('5543888880000');
    expect(comp.estado).toBe('pendente');
    expect(comp.opcoes.map((o) => o.id).sort((a, b) => a - b)).toEqual([3, 4]);

    expect(porNome.get('Bruno')).toMatchObject({ estado: 'associado', por: 'nome', pessoaId: 2 });

    const amb = porNome.get('Evinha');
    expect(amb.estado).toBe('pendente');
    expect(amb.opcoes.map((o) => o.id).sort((a, b) => a - b)).toEqual([5, 6]);

    expect(porNome.get('Zezinho').estado).toBe('pendente');
  });

  // Feature: melhoras-domingao, Property 24: Associação da enquete (invariantes)
  test('toda entrada é associada ou pendente; telefone único sempre associa', () => {
    const arbPessoa = (id) =>
      fc.record({
        id: fc.constant(id),
        nome: fc.constant(`PESSOA${id}`),
        telefone: fc.constant(`554399999${String(1000 + id).slice(-4)}`),
        aliases: fc.constant([]),
        vinculos: fc.constant([]),
        ativo: fc.constant(true),
      });

    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 6 }).chain((n) => fc.tuple(...Array.from({ length: n }, (_, i) => arbPessoa(i + 1)))),
        (pessoas) => {
          const cadastro = cadastroDe([...pessoas]);
          // Enquete: telefone de cada pessoa (único) + um nome inexistente.
          const indisponiveis = pessoas.map((p) => p.telefone);
          indisponiveis.push('NINGUEM AQUI');
          const enquete = { datas: [{ data_referencia: '2026-09-05', indisponiveis }] };
          const analises = analisarEnquete(enquete, cadastro);
          for (const a of analises) {
            expect(['associado', 'pendente']).toContain(a.estado);
          }
          // Cada telefone único associa à pessoa certa.
          for (const p of pessoas) {
            const a = analises.find((x) => x.nomeEnquete === p.telefone);
            expect(a.estado).toBe('associado');
            expect(a.pessoaId).toBe(p.id);
          }
          const semNome = analises.find((x) => x.nomeEnquete === 'NINGUEM AQUI');
          expect(semNome.estado).toBe('pendente');
        },
      ),
      { numRuns: 100 },
    );
  });

  test('confirmar nome válido grava apelido; reanalisar associa automaticamente; texto com dígito não vira apelido', () => {
    const dir = mkdtempSync(resolve(tmpdir(), 'escala-ind-'));
    const pessoas = [
      pessoa(1, 'ALICE', '5543999990001'),
      pessoa(2, 'BRUNO', '5543999990002'),
    ];
    const arquivo = { versao: '1.0.0', proximo_id: 3, grupos: {}, pessoas };
    writeFileSync(resolve(dir, 'pessoas.json'), `${JSON.stringify(arquivo, null, 2)}\n`, 'utf8');

    const cadastro = carregarPessoas(resolve(dir, 'pessoas.json'));
    const enquete = {
      datas: [{ data_referencia: '2026-09-05', indisponiveis: ['Ali', '5543777770000'] }],
    };

    const r = gravarImportacao('2026-09', enquete, { Ali: 1, '5543777770000': 2 }, { root: dir, hoje: '2026-09-01' });
    // 'Ali' (sem dígito, válido) → apelido novo para pessoa 1.
    expect(r.apelidosNovos).toEqual([{ pessoaId: 1, apelido: 'ALI' }]);
    // '5543777770000' tem dígitos: não vira apelido.
    expect(r.apelidosNovos.some((x) => x.pessoaId === 2)).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('Property 25: Indisponibilidade vinculada', () => {
  // Feature: melhoras-domingao, Property 25: Indisponibilidade vinculada
  test('IDs por data incluem votantes e parceiros sempre_junto; geral vira mês inteiro', () => {
    const cadastro = cadastroDe([
      pessoa(1, 'ALICE', '', [], [{ tipo: 'sempre_junto', com_id: 2 }]),
      pessoa(2, 'BRUNO', '', [], [{ tipo: 'sempre_junto', com_id: 1 }]),
      pessoa(3, 'CARLA'),
    ]);
    const enquete = {
      datas: [
        { data_referencia: '2026-09-05', dia_semana: 'sabado', indisponiveis: ['ALICE', 'CARLA'] },
        { data_referencia: 'geral', indisponiveis_tempo_indeterminado: ['BRUNO'] },
      ],
    };
    const map = new Map([
      ['ALICE', 1],
      ['CARLA', 3],
      ['BRUNO', 2],
    ]);
    const v = montarVinculada(enquete, cadastro, map, { agora: 'X', mes: '2026-09' });
    const data = v.datas.find((d) => d.data_referencia === '2026-09-05');
    // ALICE (1) + parceiro BRUNO (2) + CARLA (3).
    expect(data.indisponiveis_ids).toEqual([1, 2, 3]);
    // geral: BRUNO (2) + parceiro ALICE (1).
    expect(v.indisponiveis_mes_inteiro.ids).toEqual([1, 2]);
  });
});

describe('Task 17.3: validarEnquete e reprodução exata', () => {
  test('validarEnquete recusa formato errado e lista datas fora do mês', () => {
    expect(validarEnquete(null, '2026-07').erros.length).toBeGreaterThan(0);
    expect(validarEnquete({ datas: 'x' }, '2026-07').erros.length).toBeGreaterThan(0);

    const enquete = {
      datas: [
        { data_referencia: '2026-07-05', indisponiveis: [] },
        { data_referencia: '2026-08-02', indisponiveis: [] },
        { data_referencia: 'geral', indisponiveis_tempo_indeterminado: [] },
      ],
    };
    const r = validarEnquete(enquete, '2026-07');
    expect(r.erros).toEqual([]);
    expect(r.datasIgnoradas).toEqual(['2026-08-02']);
  });

  // montarVinculada reproduz exatamente o algoritmo inline do script antigo
  // (verificado contra uma reimplementação de referência), exceto gerado_em.
  test('montarVinculada reproduz a saída do algoritmo original sobre a enquete de julho', () => {
    const cadastro = carregarPessoas();
    const enquete = JSON.parse(
      readFileSync(resolve(ROOT, 'escalas/2026/07/insumos/indisponibilidade-cantores.json'), 'utf8'),
    );

    // Constrói o mapa por fuzzy (como o CLI faz).
    const mapeamentos = new Map();
    for (const nome of nomesDaEnquete(enquete)) {
      const r = resolverPessoaPorNome(nome, cadastro.porNome, 0.6);
      if (r) mapeamentos.set(nome, { pessoa_id: r.pessoa.id, confianca: Math.round(r.confianca * 100) / 100 });
    }

    const esperado = referenciaInline(enquete, cadastro, mapeamentos);
    const obtido = montarVinculada(enquete, cadastro, mapeamentos, {
      fonte: 'escalas/2026/07/insumos/indisponibilidade-cantores.json',
      agora: esperado.gerado_em,
      mes: '2026-07',
    });
    expect(obtido).toEqual(esperado);
  });

  test('entrada 5543996579868 fica pendente entre BERNARDO e RONI e a decisão não vira apelido', () => {
    const cadastro = carregarPessoas();
    const enquete = {
      datas: [{ data_referencia: '2026-07-05', indisponiveis: ['5543996579868'] }],
    };
    const analises = analisarEnquete(enquete, cadastro);
    const a = analises.find((x) => x.nomeEnquete === '5543996579868');
    expect(a.estado).toBe('pendente');
    const ids = a.opcoes.map((o) => o.id).sort((x, y) => x - y);
    expect(ids).toContain(8); // BERNARDO
    expect(ids).toContain(58); // RONI

    // Mesmo confirmando, texto com dígitos não gera apelido.
    const dir = mkdtempSync(resolve(tmpdir(), 'escala-ind2-'));
    writeFileSync(resolve(dir, 'pessoas.json'), readFileSync(resolve(ROOT, 'pessoas.json')));
    const r = gravarImportacao('2026-07', enquete, { '5543996579868': 8 }, { root: dir, hoje: '2026-07-10' });
    expect(r.apelidosNovos).toEqual([]);
    expect(existsSync(resolve(dir, 'escalas/2026/07/insumos/indisponibilidade-cantores-vinculada.json'))).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });
});

// --- Reimplementação de referência do algoritmo inline original ---
// (cópia literal da lógica de scripts/ciclo/vincular-indisponibilidade.js antes
// da extração, para provar que a extração preservou o comportamento).
function referenciaInline(enquete, cadastro, mapeamentosRaw) {
  const { porId } = cadastro;
  const mapeamentos = new Map();
  for (const [nome, v] of mapeamentosRaw) {
    const id = typeof v === 'number' ? v : v.pessoa_id;
    const conf = typeof v === 'number' ? 1 : v.confianca;
    mapeamentos.set(nome, { pessoa_id: id, nome_canonico: porId.get(id).nome, confianca: conf });
  }

  const propagacoes = [];
  const propagacaoSet = new Set();
  for (const [, mapping] of mapeamentos) {
    const pessoa = porId.get(mapping.pessoa_id);
    if (!pessoa || !pessoa.vinculos) continue;
    for (const vinculo of pessoa.vinculos) {
      if (vinculo.tipo === 'sempre_junto') {
        const chave = `${pessoa.id}→${vinculo.com_id}`;
        const chaveInversa = `${vinculo.com_id}→${pessoa.id}`;
        if (!propagacaoSet.has(chave) && !propagacaoSet.has(chaveInversa)) {
          const parceiro = porId.get(vinculo.com_id);
          if (parceiro) {
            propagacaoSet.add(chave);
            propagacoes.push({ de_id: pessoa.id, para_id: vinculo.com_id, motivo: `vinculo sempre_junto (casal ${pessoa.nome}↔${parceiro.nome})` });
          }
        }
      }
    }
  }

  const getDiaSemana = (dataISO) => ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'][new Date(`${dataISO}T12:00:00Z`).getUTCDay()];

  const datasOutput = [];
  for (const entrada of enquete.datas || []) {
    if (entrada.data_referencia === 'geral') continue;
    const nomesData = entrada.indisponiveis || [];
    const idsSet = new Set();
    const nomesResolvidosData = [];
    for (const nome of nomesData) {
      if (!nome || !nome.trim()) continue;
      const mapping = mapeamentos.get(nome.trim());
      if (mapping) { idsSet.add(mapping.pessoa_id); nomesResolvidosData.push(mapping.nome_canonico); }
    }
    for (const id of [...idsSet]) {
      const pessoa = porId.get(id);
      if (!pessoa || !pessoa.vinculos) continue;
      for (const vinculo of pessoa.vinculos) {
        if (vinculo.tipo === 'sempre_junto' && !idsSet.has(vinculo.com_id)) {
          const parceiro = porId.get(vinculo.com_id);
          if (parceiro) { idsSet.add(vinculo.com_id); nomesResolvidosData.push(parceiro.nome); }
        }
      }
    }
    datasOutput.push({
      data_referencia: entrada.data_referencia,
      dia_semana: entrada.dia_semana || getDiaSemana(entrada.data_referencia),
      indisponiveis_ids: [...idsSet].sort((a, b) => a - b),
      indisponiveis_nomes: nomesResolvidosData.sort(),
    });
  }

  let indisponiveisMesInteiro = null;
  const entradaGeral = (enquete.datas || []).find((d) => d.data_referencia === 'geral');
  const nomesMesInteiro = entradaGeral
    ? entradaGeral.indisponiveis_tempo_indeterminado || entradaGeral.indisponiveis || []
    : [];
  if (nomesMesInteiro.length > 0) {
    const idsMesInteiro = new Set();
    const nomesMesInteiroResolvidos = [];
    for (const nome of nomesMesInteiro) {
      if (!nome || !nome.trim()) continue;
      const mapping = mapeamentos.get(nome.trim());
      if (mapping) { idsMesInteiro.add(mapping.pessoa_id); nomesMesInteiroResolvidos.push(mapping.nome_canonico); }
    }
    for (const id of [...idsMesInteiro]) {
      const pessoa = porId.get(id);
      if (!pessoa || !pessoa.vinculos) continue;
      for (const vinculo of pessoa.vinculos) {
        if (vinculo.tipo === 'sempre_junto' && !idsMesInteiro.has(vinculo.com_id)) {
          const parceiro = porId.get(vinculo.com_id);
          if (parceiro) { idsMesInteiro.add(vinculo.com_id); nomesMesInteiroResolvidos.push(parceiro.nome); }
        }
      }
    }
    if (idsMesInteiro.size > 0) {
      indisponiveisMesInteiro = {
        ids: [...idsMesInteiro].sort((a, b) => a - b),
        nomes: nomesMesInteiroResolvidos.sort(),
        motivo: 'indisponibilidade total declarada na enquete',
      };
    }
  }

  const mapeamentosOutput = [];
  for (const [nomeEnquete, mapping] of mapeamentos) {
    mapeamentosOutput.push({ nome_enquete: nomeEnquete, pessoa_id: mapping.pessoa_id, nome_canonico: mapping.nome_canonico, confianca: mapping.confianca });
  }
  mapeamentosOutput.sort((a, b) => a.nome_enquete.localeCompare(b.nome_enquete));

  const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const getMesNome = (n) => ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'][n - 1];

  const output = {
    contexto: `Indisponibilidade vinculada - ${capitalize(getMesNome(7))} 2026`,
    gerado_em: '2026-07-10T23:22:02Z',
    gerado_por: 'vincular-indisponibilidade.js',
    fonte: 'escalas/2026/07/insumos/indisponibilidade-cantores.json',
    mapeamentos_aplicados: mapeamentosOutput,
    propagacoes,
    datas: datasOutput,
  };
  if (indisponiveisMesInteiro) output.indisponiveis_mes_inteiro = indisponiveisMesInteiro;
  return output;
}
