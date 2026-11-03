// Testes da sugestão com confirmação e fixos (Task 23).
//  - 23.1 Property 20: "só preencher vazios" preserva os fixos.
//  - 23.2 Regressão: modo 'vazios' com escala vazia = esperado-sugestao.json.
//
// Feature: melhoras-domingao.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';
import { carregarContexto, sugerirMes } from '../../montador/lib/regras.mjs';
import { slotsDoCulto, tipoDoCulto } from '../../montador/lib/contexto.mjs';
import { PARAMETROS_PADRAO } from '../../scripts/lib/parametros.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(__dirname, '../fixtures/regressao-2026-07');

function pessoa(id, over = {}) {
  return {
    id,
    nome: over.nome || `P${id}`,
    genero: over.genero || (id % 2 === 0 ? 'M' : 'F'),
    ativo: true,
    perfil_canto: 'base',
    habilitacoes: {
      regente: true,
      equipe: true,
      mensagem_musical: { es: true, culto: true, domingo: true },
    },
    afastado: null,
    vinculos: [],
    dias_permitidos: null,
  };
}

function montarBase(pessoas) {
  const porId = new Map(pessoas.map((p) => [p.id, p]));
  const porNome = new Map(pessoas.map((p) => [p.nome.toUpperCase(), p]));
  return {
    cadastro: { pessoas, porId, porNome, grupos: new Map() },
    grupos: new Map(),
    indisponibilidade: { datas: [], indisponiveis_mes_inteiro: { ids: [] } },
    historico: new Map(),
    parametros: JSON.parse(JSON.stringify(PARAMETROS_PADRAO)),
  };
}

function montar(culto, parametros) {
  return { ...culto, tipo: tipoDoCulto(culto), slots: slotsDoCulto(culto, parametros) };
}

// ---------------------------------------------------------------------------
// Property 20: "Só preencher vazios" preserva os fixos
// ---------------------------------------------------------------------------

describe('Property 20: "Só preencher vazios" preserva os fixos', () => {
  // Feature: melhoras-domingao, Property 20: "Só preencher vazios" preserva os fixos
  test('modo vazios mantém atribuições existentes; modo tudo = a partir do vazio', () => {
    fc.assert(
      fc.property(
        fc.record({
          n: fc.integer({ min: 10, max: 16 }),
          regenteFixoIdx: fc.integer({ min: 0, max: 8 }),
          fixarMm: fc.boolean(),
        }),
        ({ n, regenteFixoIdx, fixarMm }) => {
          const pessoas = [];
          for (let i = 1; i <= n; i += 1) pessoas.push(pessoa(i, { nome: `P${i}` }));
          const base = montarBase(pessoas);

          const cultoVazio = montar(
            {
              data: '2026-09-05',
              dia_semana: 'sabado',
              modelo_louvor: 'sabado',
              pregador: '',
              anciao: '',
              regente: null,
              equipe: [],
              mm: {},
            },
            base.parametros,
          );

          // Escala parcialmente preenchida com fixos.
          const regenteFixo = regenteFixoIdx > 0 && regenteFixoIdx <= n ? regenteFixoIdx : null;
          const mmFixo = fixarMm ? (regenteFixo === n ? n - 1 : n) : null;
          const cultoParcial = montar(
            {
              ...cultoVazio,
              regente: regenteFixo,
              equipe: [],
              mm: mmFixo ? { mm_es: mmFixo } : {},
            },
            base.parametros,
          );

          const sugVazios = sugerirMes(base, { cultos: [cultoParcial], modo: 'vazios' });
          const sVazios = sugVazios[0];
          const nomeDe = (id) => (id ? base.cadastro.porId.get(id).nome : '');

          // Regente fixo mantido.
          if (regenteFixo) {
            expect(sVazios.regente).toBe(nomeDe(regenteFixo));
          }
          // MM fixa (mm_es) mantida na lista de MM.
          if (mmFixo) {
            expect(sVazios.mm).toContain(nomeDe(mmFixo));
          }

          // modo 'tudo' a partir do vazio = sugestão da escala vazia.
          const sugTudoParcial = sugerirMes(base, { cultos: [cultoParcial], modo: 'tudo' });
          const sugTudoVazio = sugerirMes(base, { cultos: [cultoVazio], modo: 'tudo' });
          expect(sugTudoParcial).toEqual(sugTudoVazio);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// 23.2 Regressão: modo vazios com escala vazia = esperado-sugestao.json
// ---------------------------------------------------------------------------

describe('23.2 Regressão modo vazios', () => {
  const esperado = JSON.parse(readFileSync(resolve(FIXTURE, 'esperado-sugestao.json'), 'utf8'));

  test('modo vazios sobre base.cultos (escala vazia) = esperado-sugestao.json', () => {
    const base = carregarContexto('2026-07', { root: FIXTURE });
    base.parametros = JSON.parse(JSON.stringify(PARAMETROS_PADRAO));
    const vazios = sugerirMes(base, { cultos: base.cultos, modo: 'vazios' });
    expect(vazios).toEqual(esperado);
  });

  test('modo tudo sobre base.cultos = esperado-sugestao.json (compatível com sugerirMes(base))', () => {
    const base = carregarContexto('2026-07', { root: FIXTURE });
    base.parametros = JSON.parse(JSON.stringify(PARAMETROS_PADRAO));
    expect(sugerirMes(base)).toEqual(esperado);
    expect(sugerirMes(base, { cultos: base.cultos, modo: 'tudo' })).toEqual(esperado);
  });
});
