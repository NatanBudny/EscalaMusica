// Testes do dia extraordinário de ponta a ponta (Task 22).
//  - 22.1 Property 19: sugestão respeita bloqueios, evitações e modelo.
//  - 22.2 Exemplo ponta a ponta: sexta "como domingo"/"como sábado"/quinta
//    "sem louvor": candidatos, validarEscala, paraParticipacao e gerarLinhasAtual.
//
// Feature: melhoras-domingao.

import fc from 'fast-check';
import {
  carregarContexto,
  sugerirMes,
  candidatosParaCelula,
  validarEscala,
} from '../../montador/lib/regras.mjs';
import { gerarLinhasAtual } from '../../montador/lib/publicar.mjs';
import { paraParticipacao, slotsDoCulto, tipoDoCulto } from '../../montador/lib/contexto.mjs';
import { PARAMETROS_PADRAO } from '../../scripts/lib/parametros.js';

// ---------------------------------------------------------------------------
// Helpers de cadastro/base (sem tocar o disco).
// ---------------------------------------------------------------------------

function pessoa(id, over = {}) {
  return {
    id,
    nome: over.nome || `P${id}`,
    genero: over.genero || (id % 2 === 0 ? 'M' : 'F'),
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

function montarBase(pessoas, { indisponibilidade, parametros } = {}) {
  const porId = new Map(pessoas.map((p) => [p.id, p]));
  const porNome = new Map(pessoas.map((p) => [p.nome.toUpperCase(), p]));
  const cadastro = { pessoas, porId, porNome, grupos: new Map() };
  return {
    cadastro,
    grupos: new Map(),
    indisponibilidade: indisponibilidade || { datas: [], indisponiveis_mes_inteiro: { ids: [] } },
    historico: new Map(),
    parametros: parametros || JSON.parse(JSON.stringify(PARAMETROS_PADRAO)),
  };
}

/** Enriquecer um culto com tipo/slots como faz /api/dados. */
function montar(culto, parametros) {
  const tipo = tipoDoCulto(culto);
  return { ...culto, tipo, slots: slotsDoCulto(culto, parametros) };
}

// ---------------------------------------------------------------------------
// Property 19: Sugestão respeita bloqueios, evitações e modelo
// ---------------------------------------------------------------------------

describe('Property 19: Sugestão respeita bloqueios, evitações e modelo', () => {
  // Feature: melhoras-domingao, Property 19: Sugestão respeita bloqueios, evitações e modelo
  test('sugerirMes não bloqueia, não escala pregador, respeita modelo e dias_permitidos', () => {
    fc.assert(
      fc.property(
        fc.record({
          nPessoas: fc.integer({ min: 8, max: 14 }),
          modelo: fc.constantFrom('sabado', 'domingo'),
          // índice do pregador (0 = ninguém)
          pregIdx: fc.integer({ min: 0, max: 6 }),
          // uma pessoa só serve sábado (dias_permitidos)
          restritaIdx: fc.integer({ min: 0, max: 6 }),
        }),
        ({ nPessoas, modelo, pregIdx, restritaIdx }) => {
          const pessoas = [];
          for (let i = 1; i <= nPessoas; i += 1) {
            const over = { nome: `P${i}`, genero: i % 2 === 0 ? 'M' : 'F' };
            if (i === restritaIdx) over.dias_permitidos = ['sabado'];
            pessoas.push(pessoa(i, over));
          }
          const base = montarBase(pessoas);
          // Dia extraordinário: sexta-feira "como <modelo>".
          const data = '2026-09-11'; // sexta-feira
          const pregadorNome = pregIdx > 0 && pregIdx <= nPessoas ? `P${pregIdx}` : '';
          const culto = montar(
            {
              data,
              dia_semana: 'sexta-feira',
              modelo_louvor: modelo,
              extraordinario: true,
              anciao: '',
              pregador: pregadorNome,
              audiovisual: '',
              regente: null,
              equipe: [],
              mm: {},
            },
            base.parametros,
          );

          const sugestoes = sugerirMes(base, { cultos: [culto], modo: 'tudo' });
          expect(sugestoes.length).toBe(1);
          const s = sugestoes[0];

          // Monta o CultoMontagem a partir da sugestão (nomes → estrutura).
          const nomeParaId = new Map(pessoas.map((p) => [p.nome, p.id]));
          const slotsMm = slotsDoCulto(culto, base.parametros).filter((x) => x.startsWith('mm_'));
          const mmObj = {};
          s.mm.forEach((nome, i) => {
            if (slotsMm[i]) mmObj[slotsMm[i]] = nomeParaId.get(nome);
          });
          const montado = montar(
            {
              ...culto,
              regente: s.regente ? nomeParaId.get(s.regente) : null,
              equipe: s.equipe.map((n) => nomeParaId.get(n)),
              mm: mmObj,
            },
            base.parametros,
          );

          const { erros } = validarEscala(base, [montado]);
          // Nenhum erro de atribuição (bloqueio) nas pessoas escaladas.
          const errosAtribuicao = erros.filter((e) => e.pessoaId != null);
          expect(errosAtribuicao.length).toBe(0);

          // Não escala o pregador.
          if (pregadorNome) {
            const pregId = nomeParaId.get(pregadorNome);
            const escalados = [
              montado.regente,
              ...montado.equipe,
              ...Object.values(montado.mm),
            ].filter((x) => x != null);
            expect(escalados.includes(pregId)).toBe(false);
          }

          // Respeita o modelo: só preenche os slots do modelo.
          const slotsModelo = slotsDoCulto(culto, base.parametros);
          if (!slotsModelo.includes('regente')) expect(montado.regente).toBeFalsy();
          // Dias permitidos: pessoa restrita a sábado nunca entra num modelo que
          // caia numa sexta-feira (dia real da data é sexta).
          if (restritaIdx > 0 && restritaIdx <= nPessoas) {
            const restritaId = nomeParaId.get(`P${restritaIdx}`);
            const escalados = [
              montado.regente,
              ...montado.equipe,
              ...Object.values(montado.mm),
            ].filter((x) => x != null);
            expect(escalados.includes(restritaId)).toBe(false);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// 22.2 Exemplo ponta a ponta
// ---------------------------------------------------------------------------

describe('22.2 Dia extraordinário ponta a ponta', () => {
  const pessoas = [];
  for (let i = 1; i <= 12; i += 1) {
    pessoas.push(pessoa(i, { nome: `P${i}`, genero: i % 2 === 0 ? 'M' : 'F' }));
  }

  test('sexta "como sábado": duas MMs e nenhum aviso mm_vazia quando preenchidas', () => {
    const base = montarBase(pessoas);
    const culto = montar(
      {
        data: '2026-09-11',
        dia_semana: 'sexta-feira',
        modelo_louvor: 'sabado',
        extraordinario: true,
        pregador: '',
        anciao: '',
      },
      base.parametros,
    );
    // Slots do modelo sábado incluem mm_es e mm_culto.
    expect(slotsDoCulto(culto, base.parametros)).toEqual(['regente', 'equipe', 'mm_es', 'mm_culto']);

    const montado = {
      ...culto,
      regente: 1,
      equipe: [2, 3, 4, 5, 6],
      mm: { mm_es: 7, mm_culto: 8 },
    };
    const linhas = gerarLinhasAtual(base, [montado]);
    expect(linhas[0]['MENSAGEM MUSICAL']).toBe('P7, P8');
    const { avisos } = validarEscala(base, [montado]);
    expect(avisos.some((a) => a.chave === 'mm_vazia')).toBe(false);
  });

  test('sexta "como sábado" com uma só MM: campo com um nome e aviso mm_vazia', () => {
    const base = montarBase(pessoas);
    const culto = montar(
      {
        data: '2026-09-11',
        dia_semana: 'sexta-feira',
        modelo_louvor: 'sabado',
        extraordinario: true,
        pregador: '',
        anciao: '',
      },
      base.parametros,
    );
    const montado = {
      ...culto,
      regente: 1,
      equipe: [2, 3, 4, 5, 6],
      mm: { mm_culto: 8 }, // só uma MM preenchida
    };
    const linhas = gerarLinhasAtual(base, [montado]);
    expect(linhas[0]['MENSAGEM MUSICAL']).toBe('P8');
    const { avisos } = validarEscala(base, [montado]);
    expect(avisos.some((a) => a.chave === 'mm_vazia')).toBe(true);
  });

  test('sexta "como domingo": slots de domingo (uma MM)', () => {
    const base = montarBase(pessoas);
    const culto = montar(
      {
        data: '2026-09-11',
        dia_semana: 'sexta-feira',
        modelo_louvor: 'domingo',
        extraordinario: true,
        pregador: '',
        anciao: '',
      },
      base.parametros,
    );
    expect(slotsDoCulto(culto, base.parametros)).toEqual(['regente', 'equipe', 'mm_domingo']);
    const montado = { ...culto, regente: 1, equipe: [2, 3, 4, 5, 6], mm: { mm_domingo: 7 } };
    const linhas = gerarLinhasAtual(base, [montado]);
    expect(linhas[0]['MENSAGEM MUSICAL']).toBe('P7');
  });

  test('quinta "sem louvor": sem funções e "-" nos campos de louvor', () => {
    const base = montarBase(pessoas);
    const culto = montar(
      {
        data: '2026-09-10',
        dia_semana: 'quinta-feira',
        modelo_louvor: 'sem_louvor',
        extraordinario: true,
        pregador: '',
        anciao: '',
      },
      base.parametros,
    );
    expect(slotsDoCulto(culto, base.parametros)).toEqual([]);
    const linhas = gerarLinhasAtual(base, [{ ...culto, regente: null, equipe: [], mm: {} }]);
    expect(linhas[0]['REGENTE LOUVOR']).toBe('-');
    expect(linhas[0]['EQUIPE LOUVOR']).toBe('-');
    expect(linhas[0]['MENSAGEM MUSICAL']).toBe('-');

    // paraParticipacao: sem_louvor conta como quarta (fora do louvor).
    const part = paraParticipacao([{ ...culto, regente: null, equipe: [], mm: {} }], base.cadastro);
    expect(part[0].dia_semana).toBe('quarta-feira');
  });

  test('candidatos do dia extraordinário trazem pessoas elegíveis', () => {
    const base = montarBase(pessoas);
    const culto = montar(
      {
        data: '2026-09-11',
        dia_semana: 'sexta-feira',
        modelo_louvor: 'sabado',
        extraordinario: true,
        pregador: 'P3',
        anciao: '',
        regente: null,
        equipe: [],
        mm: {},
      },
      base.parametros,
    );
    const r = candidatosParaCelula(base, [culto], '2026-09-11', 'equipe');
    const total =
      r.elegiveis.filter((x) => x.tipo === 'pessoa').length +
      r.elegiveisComAviso.filter((x) => x.tipo === 'pessoa').length;
    expect(total).toBeGreaterThan(0);
    // O pregador P3 aparece com aviso (conflito_pregador), não como elegível puro.
    const p3 = base.cadastro.porNome.get('P3').id;
    const p3ComAviso = r.elegiveisComAviso.some((x) => x.tipo === 'pessoa' && x.id === p3);
    expect(p3ComAviso).toBe(true);
  });
});
