// Testes dos parâmetros executáveis e da refatoração do solver (Task 12).
//  - 12.1 Property 13: PARAMETROS_PADRAO preservam o Solver.
//  - 12.2 Regressão julho/2026: sugerirMes e sugerir-rascunho.js --root.
//  - 12.3 Unitários: carregar/validar parâmetros.

import fc from 'fast-check';
import { execFileSync } from 'node:child_process';
import {
  readFileSync,
  writeFileSync,
  mkdtempSync,
  mkdirSync,
  cpSync,
  rmSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  PARAMETROS_PADRAO,
  carregarParametros,
  validarParametros,
  nivel,
  evitarNaSugestao,
} from '../../scripts/lib/parametros.js';
import { pessoasAtivasParaSlot } from '../../scripts/lib/solver-filtros.js';
import { scoreCandidato } from '../../scripts/lib/solver-score.js';
import { sugerirCulto } from '../../scripts/lib/solver-selecao.js';
import { carregarPessoas } from '../../scripts/lib/cadastro.js';
import { carregarHistorico } from '../../scripts/lib/solver-historico.js';
import { carregarContexto, sugerirMes } from '../../montador/lib/regras.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const FIXTURE = resolve(ROOT, 'tests/fixtures/regressao-2026-07');

const SLOTS = ['regente', 'equipe', 'mm_es', 'mm_culto', 'mm_domingo'];
const DATAS = [
  '2026-07-04',
  '2026-07-05',
  '2026-07-11',
  '2026-07-12',
  '2026-07-18',
  '2026-07-19',
  '2026-07-25',
  '2026-07-26',
];

/** Carrega o cadastro e o histórico da fixture (uma vez). */
const cadastro = carregarPessoas(resolve(FIXTURE, 'pessoas.json'));
const idsPessoas = cadastro.pessoas.map((p) => p.id);
const historico = carregarHistorico(
  cadastro,
  [
    resolve(FIXTURE, 'old/2026/01-2026.json'),
    resolve(FIXTURE, 'old/2026/02-2026.json'),
    resolve(FIXTURE, 'old/2026/032026.json'),
    resolve(FIXTURE, 'old/2026/042026.json'),
    resolve(FIXTURE, 'old/2026/052026.json'),
    resolve(FIXTURE, 'old/2026/062026.json'),
  ],
  resolve(FIXTURE, 'atual.json'),
  4,
);
const indisponibilidade =
  JSON.parse(
    readFileSync(
      resolve(FIXTURE, 'escalas/2026/07/insumos/indisponibilidade-cantores-vinculada.json'),
      'utf8',
    ),
  );

/** Monta um contexto base para o solver a partir de atribuições já feitas. */
function montarContexto(escaladosData, params) {
  const escaladosPorCulto = new Map();
  for (const [data, ids] of Object.entries(escaladosData)) {
    escaladosPorCulto.set(data, new Set(ids));
  }
  const ctx = {
    pessoas: cadastro,
    indisponibilidade,
    historico,
    escaladosNesteMes: new Map(),
    escaladosPorCulto,
    externosPorCulto: new Map(),
    dataAnterior: null,
    grupoPreferencialRegente: null,
  };
  if (params !== undefined) ctx.parametros = params;
  return ctx;
}

// ───────────────────────────────────────────────────────────────────────────
// 12.1 Property 13: parâmetros padrão preservam o Solver
// ───────────────────────────────────────────────────────────────────────────

describe('Property 13: parâmetros padrão preservam o Solver', () => {
  // Feature: melhoras-domingao, Property 13: Parâmetros padrão preservam o Solver
  // Validates: Requirements 10.3, 10.4, 10.5

  test('pessoasAtivasParaSlot: PARAMETROS_PADRAO === sem parametros', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...SLOTS),
        fc.constantFrom(...DATAS),
        fc.subarray(idsPessoas, { minLength: 0, maxLength: 4 }),
        (slot, data, jaEscalados) => {
          const esc = { [data]: jaEscalados };
          const semParam = pessoasAtivasParaSlot(slot, data, montarContexto(esc, undefined)).map((p) => p.id);
          const comParam = pessoasAtivasParaSlot(slot, data, montarContexto(esc, PARAMETROS_PADRAO)).map((p) => p.id);
          expect(comParam).toEqual(semParam);
        },
      ),
      { numRuns: 120 },
    );
  });

  test('scoreCandidato: PARAMETROS_PADRAO === sem parametros', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...SLOTS),
        fc.constantFrom(...DATAS),
        fc.constantFrom(...idsPessoas),
        (slot, data, pessoaId) => {
          const pessoa = cadastro.porId.get(pessoaId);
          const s1 = scoreCandidato(pessoa, slot, data, montarContexto({}, undefined));
          const s2 = scoreCandidato(pessoa, slot, data, montarContexto({}, PARAMETROS_PADRAO));
          expect(s2).toBe(s1);
        },
      ),
      { numRuns: 120 },
    );
  });

  test('sugerirCulto: PARAMETROS_PADRAO === sem parametros', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...DATAS),
        fc.constantFrom('sabado', 'domingo'),
        (data, dia) => {
          const culto = { data, dia_semana: dia, anciao: '', pregador: '', audiovisual: '' };
          const r1 = sugerirCulto(culto, montarContexto({}, undefined));
          const r2 = sugerirCulto(culto, montarContexto({}, PARAMETROS_PADRAO));
          const resumo = (r) => ({
            regente: r.regente ? r.regente.id : null,
            equipe: r.equipe.map((p) => p.id),
            mm: r.mm.map((p) => p.id),
          });
          expect(resumo(r2)).toEqual(resumo(r1));
        },
      ),
      { numRuns: 120 },
    );
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 12.2 Regressão julho/2026
// ───────────────────────────────────────────────────────────────────────────

describe('Regressão julho/2026', () => {
  const esperadoSugestao = JSON.parse(readFileSync(resolve(FIXTURE, 'esperado-sugestao.json'), 'utf8'));
  const esperadoRascunho = readFileSync(resolve(FIXTURE, 'esperado-rascunho.md'), 'utf8');

  test('sugerirMes com o parametros.json do repositório', () => {
    const base = carregarContexto('2026-07', { root: FIXTURE });
    expect(sugerirMes(base)).toEqual(esperadoSugestao);
  });

  test('sugerirMes com PARAMETROS_PADRAO (sem contexto.parametros também)', () => {
    const base = carregarContexto('2026-07', { root: FIXTURE });
    base.parametros = JSON.parse(JSON.stringify(PARAMETROS_PADRAO));
    expect(sugerirMes(base)).toEqual(esperadoSugestao);

    const base2 = carregarContexto('2026-07', { root: FIXTURE });
    delete base2.parametros;
    expect(sugerirMes(base2)).toEqual(esperadoSugestao);
  });

  test('sugerir-rascunho.js --root gera o rascunho.md esperado', () => {
    // Copia a fixture para uma raiz temporária (o script grava rascunho.md).
    const base = mkdtempSync(resolve(tmpdir(), 'escala-reg-'));
    cpSync(FIXTURE, base, { recursive: true });
    try {
      execFileSync(
        'node',
        ['scripts/ciclo/sugerir-rascunho.js', '--mes=2026-07', `--root=${base}`],
        { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
      );
      const gerado = readFileSync(resolve(base, 'escalas/2026/07/rascunho.md'), 'utf8');
      expect(gerado).toBe(esperadoRascunho);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  test('sugerir-rascunho.js --root sem parametros.json cai no padrão (mesmo rascunho)', () => {
    const base = mkdtempSync(resolve(tmpdir(), 'escala-reg-'));
    cpSync(FIXTURE, base, { recursive: true });
    try {
      const paramsPath = resolve(base, 'processos/regras/parametros.json');
      if (existsSync(paramsPath)) rmSync(paramsPath, { force: true });
      execFileSync(
        'node',
        ['scripts/ciclo/sugerir-rascunho.js', '--mes=2026-07', `--root=${base}`],
        { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
      );
      const gerado = readFileSync(resolve(base, 'escalas/2026/07/rascunho.md'), 'utf8');
      expect(gerado).toBe(esperadoRascunho);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 12.3 Unitários de parâmetros
// ───────────────────────────────────────────────────────────────────────────

describe('carregarParametros e validarParametros', () => {
  test('arquivo ausente → padrão + aviso', () => {
    const { parametros, avisos } = carregarParametros(resolve(tmpdir(), 'nao-existe-123.json'));
    expect(parametros.equipe.tamanho).toBe(PARAMETROS_PADRAO.equipe.tamanho);
    expect(avisos.length).toBeGreaterThan(0);
  });

  test('arquivo inválido (JSON quebrado) → padrão + aviso', () => {
    const caminho = resolve(tmpdir(), `params-invalido-${Date.now()}.json`);
    writeFileSync(caminho, '{ isso nao e json', 'utf8');
    try {
      const { parametros, avisos } = carregarParametros(caminho);
      expect(parametros.equipe.tamanho).toBe(PARAMETROS_PADRAO.equipe.tamanho);
      expect(avisos.length).toBeGreaterThan(0);
    } finally {
      rmSync(caminho, { force: true });
    }
  });

  test('estrutura inválida (sem regras) → padrão + aviso', () => {
    const caminho = resolve(tmpdir(), `params-semregras-${Date.now()}.json`);
    writeFileSync(caminho, JSON.stringify({ equipe: { tamanho: 5 } }), 'utf8');
    try {
      const { parametros, avisos } = carregarParametros(caminho);
      expect(parametros).toEqual(expect.objectContaining({ regras: expect.any(Object) }));
      expect(avisos.length).toBeGreaterThan(0);
    } finally {
      rmSync(caminho, { force: true });
    }
  });

  test('validarParametros aceita o arquivo do repositório', () => {
    const repo = JSON.parse(readFileSync(resolve(ROOT, 'processos/regras/parametros.json'), 'utf8'));
    expect(validarParametros(repo)).toEqual([]);
  });

  test('validarParametros aceita PARAMETROS_PADRAO', () => {
    expect(validarParametros(PARAMETROS_PADRAO)).toEqual([]);
  });

  test('nivel e evitarNaSugestao refletem os padrões', () => {
    expect(nivel(PARAMETROS_PADRAO, 'indisponibilidade')).toBe('bloqueio');
    expect(nivel(PARAMETROS_PADRAO, 'conflito_pregador')).toBe('aviso');
    expect(evitarNaSugestao(PARAMETROS_PADRAO, 'conflito_pregador')).toBe(true);
    expect(evitarNaSugestao(PARAMETROS_PADRAO, 'indisponibilidade')).toBe(true);
    // Regra inativa → nivel null, não evita.
    const desligada = JSON.parse(JSON.stringify(PARAMETROS_PADRAO));
    desligada.regras.minimo_homens.ativa = false;
    expect(nivel(desligada, 'minimo_homens')).toBeNull();
  });
});
