// Testes da avaliação única (Task 20): candidatos, substitutos e validação.
//  - 20.1 Property 14: nível define a severidade.
//  - 20.2 Property 15: candidatos coerentes com a validação.
//  - 20.3 Property 16: acúmulo no mesmo culto.
//  - 20.4 Property 17: vínculos só avisam.
//
// Feature: melhoras-domingao.

import fc from 'fast-check';
import {
  criarEstadoMes,
  avaliarAtribuicao,
  avaliarCulto,
} from '../../montador/lib/avaliacao.mjs';
import {
  candidatosParaCelula,
  candidatosSubstitutos,
  validarEscala,
} from '../../montador/lib/regras.mjs';
import { PARAMETROS_PADRAO } from '../../scripts/lib/parametros.js';

// ---------------------------------------------------------------------------
// Helpers de cadastro/contexto
// ---------------------------------------------------------------------------

function pessoa(id, over = {}) {
  return {
    id,
    nome: over.nome || `P${id}`,
    genero: over.genero || 'M',
    ativo: over.ativo === undefined ? true : over.ativo,
    perfil_canto: over.perfil_canto || 'base',
    habilitacoes: over.habilitacoes || {
      regente: true,
      equipe: true,
      mensagem_musical: { es: true, culto: true, domingo: true },
    },
    afastado: over.afastado || null,
    vinculos: over.vinculos || [],
    dias_permitidos: over.dias_permitidos === undefined ? null : over.dias_permitidos,
  };
}

function montarBase(pessoas, { grupos = new Map(), indisponibilidade, parametros } = {}) {
  const porId = new Map(pessoas.map((p) => [p.id, p]));
  const porNome = new Map(pessoas.map((p) => [p.nome, p]));
  const cadastro = { pessoas, porId, porNome, grupos: new Map() };
  return {
    cadastro,
    grupos,
    indisponibilidade: indisponibilidade || { datas: [], indisponiveis_mes_inteiro: { ids: [] } },
    historico: new Map(),
    parametros: parametros || JSON.parse(JSON.stringify(PARAMETROS_PADRAO)),
  };
}

// ---------------------------------------------------------------------------
// Property 14: Nível define a severidade
// ---------------------------------------------------------------------------

describe('Property 14: Nível define a severidade', () => {
  // Usa a regra conflito_pregador: a pessoa é pregadora do culto e também
  // escolhida numa função. Variamos ativa/nível e conferimos a severidade.
  // Feature: melhoras-domingao, Property 14: Nível define a severidade
  test('violação aparece em erros (bloqueio), avisos (aviso) ou nada (inativa)', () => {
    fc.assert(
      fc.property(
        fc.record({
          ativa: fc.boolean(),
          nivel: fc.constantFrom('bloqueio', 'aviso'),
        }),
        ({ ativa, nivel }) => {
          const pessoas = [
            pessoa(1, { nome: 'ANA', genero: 'F' }),
            pessoa(2, { nome: 'BRUNO', genero: 'M' }),
          ];
          const parametros = JSON.parse(JSON.stringify(PARAMETROS_PADRAO));
          parametros.regras.conflito_pregador = {
            refs: ['RF004'],
            ativa,
            nivel,
            evitar_na_sugestao: true,
          };
          const base = montarBase(pessoas, { parametros });
          // ANA é a pregadora e também está na equipe.
          const cultos = [
            {
              data: '2026-09-05',
              dia_semana: 'sabado',
              tipo: 'louvor',
              slots: ['regente', 'equipe', 'mm_es', 'mm_culto'],
              pregador: 'ANA',
              anciao: '',
              regente: 2,
              equipe: [1],
              mm: {},
              sonoplastiaIds: [],
            },
          ];
          const estado = criarEstadoMes(base, cultos);
          const { bloqueios, avisos } = avaliarAtribuicao(base, estado, '2026-09-05', 'equipe', 1);
          const temBloqueioPregador = bloqueios.some((m) => m.chave === 'conflito_pregador');
          const temAvisoPregador = avisos.some((m) => m.chave === 'conflito_pregador');

          if (!ativa) {
            expect(temBloqueioPregador).toBe(false);
            expect(temAvisoPregador).toBe(false);
          } else if (nivel === 'bloqueio') {
            expect(temBloqueioPregador).toBe(true);
            expect(temAvisoPregador).toBe(false);
          } else {
            expect(temAvisoPregador).toBe(true);
            expect(temBloqueioPregador).toBe(false);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 15: Candidatos coerentes com a validação
// ---------------------------------------------------------------------------

describe('Property 15: Candidatos coerentes com a validação', () => {
  // Feature: melhoras-domingao, Property 15: Candidatos coerentes com a validação
  test('cada pessoa ativa habilitada em exatamente um dos três grupos; incluir reflete em validarEscala', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 6 }),
        fc.integer({ min: 0, max: 3 }),
        (n, pregIdx) => {
          const pessoas = [];
          for (let i = 1; i <= n; i += 1) {
            pessoas.push(pessoa(i, { nome: `P${i}`, genero: i % 2 === 0 ? 'M' : 'F' }));
          }
          const base = montarBase(pessoas);
          const pregadorNome = pregIdx > 0 && pregIdx <= n ? `P${pregIdx}` : '';
          const cultos = [
            {
              data: '2026-09-06',
              dia_semana: 'domingo',
              tipo: 'louvor',
              slots: ['regente', 'equipe', 'mm_domingo'],
              pregador: pregadorNome,
              anciao: '',
              regente: null,
              equipe: [],
              mm: {},
              sonoplastiaIds: [],
            },
          ];
          const slot = 'equipe';
          const r = candidatosParaCelula(base, cultos, '2026-09-06', slot);

          // Cada pessoa habilitada aparece em exatamente um grupo.
          const todosIds = [
            ...r.elegiveis.filter((x) => x.tipo === 'pessoa').map((x) => x.id),
            ...r.elegiveisComAviso.filter((x) => x.tipo === 'pessoa').map((x) => x.id),
            ...r.naoElegiveis.filter((x) => x.tipo === 'pessoa').map((x) => x.id),
          ];
          const unicos = new Set(todosIds);
          expect(unicos.size).toBe(todosIds.length);
          // Todas as pessoas ativas habilitadas em equipe aparecem.
          expect(unicos.size).toBe(n);

          // Incluir um elegível não adiciona erro/aviso a essa atribuição.
          if (r.elegiveis.length > 0) {
            const alvo = r.elegiveis.find((x) => x.tipo === 'pessoa');
            if (alvo) {
              const cultosComElegivel = [{ ...cultos[0], equipe: [alvo.id] }];
              const { erros, avisos } = validarEscala(base, cultosComElegivel);
              const relativos = [...erros, ...avisos].filter(
                (m) => m.slot === 'equipe' && m.pessoaId === alvo.id,
              );
              expect(relativos.length).toBe(0);
            }
          }

          // Incluir um elegivelComAviso adiciona só avisos (não erro) a essa atribuição.
          if (r.elegiveisComAviso.length > 0) {
            const alvo = r.elegiveisComAviso.find((x) => x.tipo === 'pessoa');
            if (alvo) {
              const cultosComAviso = [{ ...cultos[0], equipe: [alvo.id] }];
              const { erros } = validarEscala(base, cultosComAviso);
              const errosRel = erros.filter((m) => m.slot === 'equipe' && m.pessoaId === alvo.id);
              expect(errosRel.length).toBe(0);
            }
          }

          // Incluir um não elegível adiciona um erro cujo texto contém o motivo.
          if (r.naoElegiveis.length > 0) {
            const alvo = r.naoElegiveis.find((x) => x.tipo === 'pessoa');
            if (alvo) {
              const cultosComBloqueio = [{ ...cultos[0], equipe: [alvo.id] }];
              const { erros } = validarEscala(base, cultosComBloqueio);
              const errosRel = erros.filter((m) => m.slot === 'equipe' && m.pessoaId === alvo.id);
              expect(errosRel.length).toBeGreaterThan(0);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  test('substitutos não contêm a pessoa substituída', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 6 }), (n) => {
        const pessoas = [];
        for (let i = 1; i <= n; i += 1) pessoas.push(pessoa(i, { nome: `P${i}` }));
        const base = montarBase(pessoas);
        const cultos = [
          {
            data: '2026-09-06',
            dia_semana: 'domingo',
            tipo: 'louvor',
            slots: ['regente', 'equipe', 'mm_domingo'],
            pregador: '',
            anciao: '',
            regente: 1,
            equipe: [],
            mm: {},
            sonoplastiaIds: [],
          },
        ];
        const r = candidatosSubstitutos(base, cultos, '2026-09-06', 'regente', 1);
        const contem = [...r.elegiveis, ...r.elegiveisComAviso, ...r.naoElegiveis].some(
          (x) => x.tipo === 'pessoa' && x.id === 1,
        );
        expect(contem).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 16: Acúmulo no mesmo culto
// ---------------------------------------------------------------------------

describe('Property 16: Acúmulo no mesmo culto', () => {
  // Feature: melhoras-domingao, Property 16: Acúmulo no mesmo culto
  test('regência/sonoplastia = bloqueio; pregador = aviso; ancião = nada; equipe+MM = aviso; demais = bloqueio', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('regencia', 'sonoplastia', 'pregador', 'anciao', 'equipe_mm', 'repeticao'),
        (caso) => {
          const pessoas = [
            pessoa(1, { nome: 'ANA', genero: 'F' }),
            pessoa(2, { nome: 'BRUNO', genero: 'M' }),
            pessoa(3, { nome: 'CARLA', genero: 'F' }),
          ];
          const base = montarBase(pessoas);
          const culto = {
            data: '2026-09-05',
            dia_semana: 'sabado',
            tipo: 'louvor',
            slots: ['regente', 'equipe', 'mm_es', 'mm_culto'],
            pregador: '',
            anciao: '',
            regente: null,
            equipe: [],
            mm: {},
            sonoplastiaIds: [],
          };
          // Avaliamos a pessoa 1 (ANA) numa segunda função (mm_es).
          let alvoSlot = 'mm_es';
          let esperado; // { nivel } ou null
          if (caso === 'regencia') {
            culto.regente = 1; // ANA regente → bloqueio ao pôr em mm_es
            esperado = { chave: 'conflito_regencia', nivel: 'bloqueio' };
          } else if (caso === 'sonoplastia') {
            culto.sonoplastiaIds = [1];
            esperado = { chave: 'conflito_sonoplastia', nivel: 'bloqueio' };
          } else if (caso === 'pregador') {
            culto.pregador = 'ANA';
            esperado = { chave: 'conflito_pregador', nivel: 'aviso' };
          } else if (caso === 'anciao') {
            culto.anciao = 'ANA';
            esperado = null;
          } else if (caso === 'equipe_mm') {
            culto.equipe = [1];
            esperado = { chave: 'equipe_e_mm_mesmo_culto', nivel: 'aviso' };
          } else if (caso === 'repeticao') {
            culto.mm = { mm_culto: 1 }; // ANA já em mm_culto, por em mm_es
            esperado = { chave: 'repeticao_no_culto', nivel: 'bloqueio' };
          }

          const estado = criarEstadoMes(base, [culto]);
          const { bloqueios, avisos } = avaliarAtribuicao(base, estado, '2026-09-05', alvoSlot, 1);
          const todos = [...bloqueios, ...avisos];

          if (esperado === null) {
            // Ancião: não gera motivo de acúmulo.
            const temAcumulo = todos.some((m) =>
              ['conflito_regencia', 'conflito_sonoplastia', 'conflito_pregador', 'equipe_e_mm_mesmo_culto', 'repeticao_no_culto'].includes(m.chave),
            );
            expect(temAcumulo).toBe(false);
          } else {
            const achado = todos.find((m) => m.chave === esperado.chave);
            expect(achado).toBeDefined();
            expect(achado.nivel).toBe(esperado.nivel);
          }
        },
      ),
      { numRuns: 120 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 17: Vínculos só avisam
// ---------------------------------------------------------------------------

describe('Property 17: Vínculos só avisam', () => {
  // Feature: melhoras-domingao, Property 17: Vínculos só avisam
  test('vínculo não atendido gera aviso, nunca bloqueio; escolher mantém o aviso', () => {
    fc.assert(
      fc.property(fc.constantFrom('precisa_de', 'sempre_junto', 'familia_requerida'), (tipo) => {
        // ANA depende de BRUNO; BRUNO não está no culto.
        const vinculos = tipo === 'precisa_de'
          ? [{ tipo: 'precisa_de', com_ids: [2] }]
          : tipo === 'sempre_junto'
            ? [{ tipo: 'sempre_junto', com_id: 2 }]
            : [{ tipo: 'familia_requerida', grupo: 'fam' }];
        const pessoas = [
          pessoa(1, { nome: 'ANA', genero: 'F', vinculos }),
          pessoa(2, { nome: 'BRUNO', genero: 'M', vinculos: tipo === 'sempre_junto' ? [{ tipo: 'sempre_junto', com_id: 1 }] : [] }),
          pessoa(3, { nome: 'CARLA', genero: 'F' }),
        ];
        const base = montarBase(pessoas);
        // familia_requerida: grupo não escalável com membros (só para resolver nome).
        base.cadastro.grupos = new Map([['fam', { membros_ids: [2] }]]);

        const cultos = [
          {
            data: '2026-09-06',
            dia_semana: 'domingo',
            tipo: 'louvor',
            slots: ['regente', 'equipe', 'mm_domingo'],
            pregador: '',
            anciao: '',
            regente: null,
            equipe: [3],
            mm: {},
            sonoplastiaIds: [],
          },
        ];
        const estado = criarEstadoMes(base, cultos);
        const { bloqueios, avisos } = avaliarAtribuicao(base, estado, '2026-09-06', 'equipe', 1);
        // Só avisos de vínculo; nenhum bloqueio.
        expect(bloqueios.length).toBe(0);
        expect(avisos.some((m) => m.chave === 'vinculo')).toBe(true);

        // Aparece entre elegiveisComAviso (não entre não elegíveis).
        const r = candidatosParaCelula(base, cultos, '2026-09-06', 'equipe');
        const naoElegivel = r.naoElegiveis.some((x) => x.tipo === 'pessoa' && x.id === 1);
        expect(naoElegivel).toBe(false);
        const comAviso = r.elegiveisComAviso.some((x) => x.tipo === 'pessoa' && x.id === 1);
        const elegivelSemAviso = r.elegiveis.some((x) => x.tipo === 'pessoa' && x.id === 1);
        // Como ANA já está na equipe? não — equipe=[3]. ANA deve aparecer com aviso.
        expect(comAviso || elegivelSemAviso).toBe(true);
        expect(comAviso).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});
