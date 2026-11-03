// Testes do filtro do cadastro (Task 9): Property 10 (filtros) e ultimaVez.

import fc from 'fast-check';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { filtrarPessoas } from '../../montador/public/modulos/filtro.js';
import { listarPessoas } from '../../montador/lib/pessoas.mjs';
import { derivarContatos } from '../../scripts/lib/contatos.js';
import { criarRepoTemporario } from '../helpers/repo-temporario.js';

function pessoa(id, over = {}) {
  return {
    id,
    nome: over.nome || `PESSOA ${id}`,
    aliases: over.aliases || [],
    telefone: over.telefone || '',
    genero: over.genero || 'M',
    ativo: over.ativo === undefined ? true : over.ativo,
    perfil_canto: over.perfil_canto === undefined ? 'base' : over.perfil_canto,
    notas: '',
    habilitacoes: over.habilitacoes || {
      regente: false,
      equipe: true,
      mensagem_musical: { es: false, culto: false, domingo: false },
      sonoplastia: false,
    },
    afastado: over.afastado || null,
    vinculos: [],
    dias_permitidos: over.dias_permitidos === undefined ? null : over.dias_permitidos,
  };
}

/** Referência: condição de inclusão independente de filtrarPessoas. */
function casaRef(p, busca, f) {
  const norm = (t) =>
    String(t || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .trim();
  const termo = norm(busca);
  if (termo) {
    const alvo = [p.nome, ...(p.aliases || [])].map(norm).join(' ');
    if (!alvo.includes(termo)) return false;
  }
  const hab = p.habilitacoes || {};
  const mm = hab.mensagem_musical || {};
  for (const fn of f.funcoes || []) {
    if (fn === 'regente' && hab.regente !== true) return false;
    if (fn === 'equipe' && hab.equipe !== true) return false;
    if (fn === 'sonoplastia' && hab.sonoplastia !== true) return false;
    if (fn === 'mm' && !(mm.es || mm.culto || mm.domingo)) return false;
  }
  if (f.situacao === 'ativo' && p.ativo === false) return false;
  if (f.situacao === 'inativo' && p.ativo !== false) return false;
  const afa = !!(p.afastado && p.afastado.ativo);
  if (f.afastado === true && !afa) return false;
  if (f.afastado === false && afa) return false;
  for (const d of f.dias || []) {
    if (p.dias_permitidos != null && !p.dias_permitidos.includes(d)) return false;
  }
  if (f.perfil != null && f.perfil !== '' && (p.perfil_canto || null) !== f.perfil) return false;
  return true;
}

describe('Property 10: Filtros do cadastro', () => {
  const arbPessoa = (id) =>
    fc.record({
      nome: fc.constantFrom(`ANA ${id}`, `BRUNO ${id}`, `CARLA ${id}`),
      ativo: fc.boolean(),
      perfil_canto: fc.constantFrom('base', 'participacao', null),
      dias_permitidos: fc.oneof(fc.constant(null), fc.subarray(['sabado', 'domingo'], { minLength: 1 })),
      habilitacoes: fc.record({
        regente: fc.boolean(),
        equipe: fc.boolean(),
        sonoplastia: fc.boolean(),
        mensagem_musical: fc.record({ es: fc.boolean(), culto: fc.boolean(), domingo: fc.boolean() }),
      }),
      afastado: fc.oneof(fc.constant(null), fc.record({ ativo: fc.boolean() })),
    }).map((o) => pessoa(id, o));

  // Feature: melhoras-domingao, Property 10: Filtros do cadastro
  test('lista filtrada = pessoas que atendem busca e todos os filtros; contador = tamanho', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 50 }), { minLength: 1, maxLength: 12 }).chain((ids) => {
          const unicos = [...new Set(ids)];
          return fc.tuple(...unicos.map((id) => arbPessoa(id)));
        }),
        fc.record({
          busca: fc.constantFrom('', 'ANA', 'bru', 'z'),
          funcoes: fc.subarray(['regente', 'equipe', 'mm', 'sonoplastia']),
          situacao: fc.constantFrom(null, 'ativo', 'inativo'),
          afastado: fc.constantFrom(null, true, false),
          dias: fc.subarray(['sabado', 'domingo']),
          perfil: fc.constantFrom(null, 'base', 'participacao'),
        }),
        (pessoas, filtros) => {
          const { busca, ...resto } = filtros;
          const esperado = pessoas.filter((p) => casaRef(p, busca, resto));
          const obtido = filtrarPessoas(pessoas, busca, resto);
          expect(obtido.map((p) => p.id).sort()).toEqual(esperado.map((p) => p.id).sort());
          expect(obtido.length).toBe(esperado.length);
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe('Task 9.2: ultimaVez e habilitacoes.sonoplastia', () => {
  function cadastro() {
    return {
      versao: '1.0.0',
      proximo_id: 3,
      ultima_atualizacao: '2026-01-01',
      grupos: {},
      departamentos_contato: {},
      pessoas: [
        pessoa(1, { nome: 'ALICE', habilitacoes: { regente: true, equipe: true, mensagem_musical: { es: false, culto: false, domingo: false }, sonoplastia: true } }),
        // Pessoa sem a chave sonoplastia nas habilitações (arquivo antigo).
        {
          id: 2,
          nome: 'BOB',
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
        },
      ],
    };
  }

  test('ultimaVez varre atual.json e old/AAAA/*.json (arrays)', () => {
    const repo = criarRepoTemporario();
    try {
      const c = cadastro();
      repo.escrever('pessoas.json', `${JSON.stringify(c, null, 2)}\n`);
      repo.escrever('contatos.json', `${JSON.stringify(derivarContatos(c.pessoas, {}), null, 2)}\n`);

      // atual.json: ALICE na equipe em 2026-09-05.
      repo.escrever(
        'atual.json',
        `${JSON.stringify([{ DATA: '2026-09-05', 'EQUIPE LOUVOR': 'ALICE, BOB' }], null, 2)}\n`,
      );
      // old/2026/062026.json: ALICE regente em 2026-06-06 (mais antigo).
      mkdirSync(resolve(repo.dir, 'old', '2026'), { recursive: true });
      writeFileSync(
        resolve(repo.dir, 'old', '2026', '062026.json'),
        `${JSON.stringify([{ DATA: '2026-06-06', 'REGENTE LOUVOR': 'ALICE' }], null, 2)}\n`,
        'utf8',
      );
      // Um arquivo que não é array (ignorado).
      writeFileSync(
        resolve(repo.dir, 'old', '2026', 'config.json'),
        `${JSON.stringify({ naoArray: true })}\n`,
        'utf8',
      );

      const { ultimaVez } = listarPessoas({ root: repo.dir });
      expect(ultimaVez[1]).toBe('2026-09-05'); // mais recente de ALICE
      expect(ultimaVez[2]).toBe('2026-09-05'); // BOB apareceu em 09-05
    } finally {
      repo.limpar();
    }
  });

  test('carregarPessoas aceita pessoa com e sem habilitacoes.sonoplastia', async () => {
    const repo = criarRepoTemporario();
    try {
      const c = cadastro();
      const caminho = resolve(repo.dir, 'pessoas.json');
      writeFileSync(caminho, `${JSON.stringify(c, null, 2)}\n`, 'utf8');
      const { carregarPessoas } = await import('../../scripts/lib/cadastro.js');
      expect(() => carregarPessoas(caminho)).not.toThrow();
    } finally {
      repo.limpar();
    }
  });
});

// ---------------------------------------------------------------------------
// Task 19: datasVisiveis (filtro por dia na montagem)
// ---------------------------------------------------------------------------

import { datasVisiveis } from '../../montador/public/modulos/filtro.js';

describe('Task 19: datasVisiveis', () => {
  const cultos = [
    { data: '2026-09-02', dia_semana: 'quarta-feira', extraordinario: false },
    { data: '2026-09-05', dia_semana: 'sabado', extraordinario: false },
    { data: '2026-09-06', dia_semana: 'domingo', extraordinario: false },
    { data: '2026-09-11', dia_semana: 'sexta-feira', extraordinario: true },
    { data: '2026-09-12', dia_semana: 'sabado', extraordinario: false },
  ];

  test('sem filtro: todos os cultos visíveis', () => {
    const r = datasVisiveis(cultos, {});
    expect([...r].sort()).toEqual(['2026-09-02', '2026-09-05', '2026-09-06', '2026-09-11', '2026-09-12']);
  });

  test('só sábados', () => {
    const r = datasVisiveis(cultos, { dias: ['sabado'] });
    expect([...r].sort()).toEqual(['2026-09-05', '2026-09-12']);
  });

  test('sábados e domingos', () => {
    const r = datasVisiveis(cultos, { dias: new Set(['sabado', 'domingo']) });
    expect([...r].sort()).toEqual(['2026-09-05', '2026-09-06', '2026-09-12']);
  });

  test('quartas', () => {
    const r = datasVisiveis(cultos, { dias: ['quarta'] });
    expect([...r]).toEqual(['2026-09-02']);
  });

  test('extraordinários', () => {
    const r = datasVisiveis(cultos, { extraordinarios: true });
    expect([...r]).toEqual(['2026-09-11']);
  });

  test('extraordinários combinados com sábados', () => {
    const r = datasVisiveis(cultos, { dias: ['sabado'], extraordinarios: true });
    expect([...r].sort()).toEqual(['2026-09-05', '2026-09-11', '2026-09-12']);
  });

  test('data exata restringe a um culto', () => {
    const r = datasVisiveis(cultos, { data: '2026-09-06' });
    expect([...r]).toEqual(['2026-09-06']);
  });

  test('data exata que não casa com os dias fica vazia', () => {
    const r = datasVisiveis(cultos, { dias: ['sabado'], data: '2026-09-06' });
    expect([...r]).toEqual([]);
  });
});
