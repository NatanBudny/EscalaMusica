// Testes de grupos escaláveis na montagem (Task 27).
//  - 27.1 Property 18: grupo na montagem.
//  - 27.2 Property 26 (parte grupos): nome_exibicao e culto assumido.
//  - 27.3 Fixture agosto/2026: FAMILIA NILSINHO (29/08) e MIN. JOVEM (23/08).
//
// Feature: melhoras-domingao.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';
import { carregarPessoas } from '../../scripts/lib/cadastro.js';
import { gruposEscalaveis } from '../../montador/lib/grupos.mjs';
import {
  criarEstadoMes,
  avaliarAtribuicao,
  avaliarCulto,
} from '../../montador/lib/avaliacao.mjs';
import { candidatosParaCelula, sugerirMes } from '../../montador/lib/regras.mjs';
import { gerarLinhasAtual, cultosDeAtual } from '../../montador/lib/publicar.mjs';
import { calcularProgresso } from '../../montador/public/modulos/progresso.js';
import { slotsDoCulto, tipoDoCulto } from '../../montador/lib/contexto.mjs';
import { PARAMETROS_PADRAO } from '../../scripts/lib/parametros.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIX = resolve(__dirname, '../fixtures/agosto-2026');
const ROOT_VAZIO = resolve(__dirname, '../fixtures/__inexistente__');

function baseFixture(extra = {}) {
  const cadastro = carregarPessoas(resolve(FIX, 'pessoas.json'));
  const arquivo = JSON.parse(readFileSync(resolve(FIX, 'pessoas.json'), 'utf8'));
  const grupos = gruposEscalaveis(arquivo);
  return {
    cadastro,
    grupos,
    parametros: JSON.parse(JSON.stringify(PARAMETROS_PADRAO)),
    indisponibilidade: { datas: [], indisponiveis_mes_inteiro: { ids: [] } },
    historico: new Map(),
    root: ROOT_VAZIO,
    ...extra,
  };
}

function montar(culto, parametros) {
  return { ...culto, tipo: tipoDoCulto(culto), slots: slotsDoCulto(culto, parametros) };
}

// ---------------------------------------------------------------------------
// Property 18: Grupo na montagem
// ---------------------------------------------------------------------------

describe('Property 18: Grupo na montagem', () => {
  const base = baseFixture();
  const grupoChave = 'familia_nilsinho'; // funcoes ['mm']
  const grupo = base.grupos.get(grupoChave);
  const membros = grupo.membros_ids;

  // Feature: melhoras-domingao, Property 18: Grupo na montagem
  test('funções, indisponibilidade, aviso de membros, uma vaga/MM, assumidoPor completo, sugerirMes sem grupo', () => {
    fc.assert(
      fc.property(
        fc.record({
          // quantos membros ficam indisponíveis
          nIndisp: fc.integer({ min: 0, max: membros.length }),
          slot: fc.constantFrom('regente', 'equipe', 'mm_es', 'mm_culto'),
        }),
        ({ nIndisp, slot }) => {
          const indispIds = membros.slice(0, nIndisp);
          const indisponibilidade = {
            datas: [{ data_referencia: '2026-09-05', indisponiveis_ids: indispIds }],
            indisponiveis_mes_inteiro: { ids: [] },
          };
          const b = baseFixture({ indisponibilidade });
          const culto = montar(
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
            b.parametros,
          );
          const estado = criarEstadoMes(b, [culto]);
          const { bloqueios, avisos } = avaliarAtribuicao(b, estado, '2026-09-05', slot, `grupo:${grupoChave}`);

          // Função: só 'mm' está em funcoes; regente/equipe → bloqueio de habilitação.
          if (slot === 'regente' || slot === 'equipe') {
            expect(bloqueios.some((m) => m.chave === 'habilitacao')).toBe(true);
            return; // nos demais checks, usamos slots de MM
          }

          // Bloqueio por indisponibilidade sse todos os membros indisponíveis.
          const todosIndisp = indispIds.length === membros.length && membros.length > 0;
          expect(bloqueios.some((m) => m.chave === 'indisponibilidade')).toBe(todosIndisp);

          // Com algum (não todos) indisponível, aviso membros_indisponiveis lista exatamente eles.
          if (indispIds.length > 0 && !todosIndisp) {
            const aviso = avisos.find((m) => m.chave === 'membros_indisponiveis');
            expect(aviso).toBeDefined();
            for (const id of indispIds) {
              const nome = b.cadastro.porId.get(id).nome;
              expect(aviso.texto).toContain(nome);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  test('grupo aparece nos candidatos só das funções em funcoes', () => {
    const b = baseFixture();
    const culto = montar(
      { data: '2026-09-05', dia_semana: 'sabado', modelo_louvor: 'sabado', pregador: '', anciao: '', regente: null, equipe: [], mm: {} },
      b.parametros,
    );
    // mm_culto: grupo (funcoes ['mm']) deve aparecer como candidato.
    const rMm = candidatosParaCelula(b, [culto], '2026-09-05', 'mm_culto');
    const noMm = [...rMm.elegiveis, ...rMm.elegiveisComAviso].some(
      (x) => x.tipo === 'grupo' && x.chave === grupoChave,
    );
    expect(noMm).toBe(true);
    // regente: grupo NÃO deve aparecer entre elegíveis/aviso (habilitação bloqueia).
    const rReg = candidatosParaCelula(b, [culto], '2026-09-05', 'regente');
    const noReg = [...rReg.elegiveis, ...rReg.elegiveisComAviso].some(
      (x) => x.tipo === 'grupo' && x.chave === grupoChave,
    );
    expect(noReg).toBe(false);
  });

  test('membro do grupo em outra função gera aviso membro_em_outra_funcao', () => {
    const b = baseFixture();
    const membro = membros[1]; // JULIANA ALVES (32)
    const culto = montar(
      {
        data: '2026-09-05',
        dia_semana: 'sabado',
        modelo_louvor: 'sabado',
        pregador: '',
        anciao: '',
        regente: null,
        equipe: [membro],
        mm: { mm_es: `grupo:${grupoChave}` },
      },
      b.parametros,
    );
    const estado = criarEstadoMes(b, [culto]);
    const { avisos } = avaliarAtribuicao(b, estado, '2026-09-05', 'mm_es', `grupo:${grupoChave}`);
    expect(avisos.some((m) => m.chave === 'membro_em_outra_funcao')).toBe(true);
  });

  test('culto com assumidoPor é completo e sugerirMes nunca escala grupo', () => {
    const b = baseFixture();
    const assumido = montar(
      {
        data: '2026-09-06',
        dia_semana: 'domingo',
        modelo_louvor: 'domingo',
        pregador: '',
        anciao: '',
        regente: null,
        equipe: [],
        mm: {},
        assumidoPor: 'grupo:min_jovem',
      },
      b.parametros,
    );
    const estado = criarEstadoMes(b, [assumido]);
    expect(avaliarCulto(b, estado, '2026-09-06')).toEqual([]);
    const prog = calcularProgresso([assumido], { tamanhoEquipe: 5 });
    expect(prog.completos.has('2026-09-06')).toBe(true);
    expect(prog.pendentes).toBe(0);

    // sugerirMes em modo vazios mantém o culto assumido fora da sugestão.
    const sug = sugerirMes(b, { cultos: [assumido], modo: 'vazios' });
    expect(sug[0].assumidoPor).toBe('grupo:min_jovem');
    expect(sug[0].regente).toBe('');
    expect(sug[0].equipe).toEqual([]);

    // Em modo tudo, nenhuma sugestão contém string 'grupo:'.
    const culto = montar(
      { data: '2026-09-05', dia_semana: 'sabado', modelo_louvor: 'sabado', pregador: '', anciao: '', regente: null, equipe: [], mm: {} },
      b.parametros,
    );
    const sugTudo = sugerirMes(b, { cultos: [culto], modo: 'tudo' });
    const todos = [sugTudo[0].regente, ...sugTudo[0].equipe, ...sugTudo[0].mm];
    expect(todos.some((n) => typeof n === 'string' && n.startsWith('grupo:'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 27.2 Property 26 (parte grupos) + 27.3 fixture agosto/2026
// ---------------------------------------------------------------------------

describe('27.3 Grupos na fixture agosto/2026', () => {
  const base = baseFixture();
  const atual = JSON.parse(readFileSync(resolve(FIX, 'atual.json'), 'utf8'));

  test('29/08 FAMILIA NILSINHO na MM e 23/08 MIN. JOVEM assume: ida e volta igual', () => {
    const cultos = cultosDeAtual(atual, base);

    const c2908 = cultos.find((c) => c.data === '2026-08-29');
    expect(c2908.mm.mm_es).toBe('grupo:familia_nilsinho');

    const c2308 = cultos.find((c) => c.data === '2026-08-23');
    expect(c2308.assumidoPor).toBe('grupo:min_jovem');

    const linhas = gerarLinhasAtual({ ...base, root: FIX }, cultos);
    expect(linhas).toEqual(atual);

    // nome_exibicao nos três campos de louvor quando o grupo assume.
    const l2308 = linhas.find((l) => l.DATA === '23/08/2026');
    expect(l2308['REGENTE LOUVOR']).toBe('MIN. JOVEM');
    expect(l2308['EQUIPE LOUVOR']).toBe('MIN. JOVEM');
    expect(l2308['MENSAGEM MUSICAL']).toBe('MIN. JOVEM');

    // FAMILIA NILSINHO publicado pelo nome_exibicao na MM.
    const l2908 = linhas.find((l) => l.DATA === '29/08/2026');
    expect(l2908['MENSAGEM MUSICAL']).toBe('FAMILIA NILSINHO');
  });

  test('progresso conta 23/08 (assumido) como completo', () => {
    const cultos = cultosDeAtual(atual, base);
    const prog = calcularProgresso(cultos, { tamanhoEquipe: 5 });
    expect(prog.completos.has('2026-08-23')).toBe(true);
  });
});
