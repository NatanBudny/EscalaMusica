// Testes da geração/leitura do atual.json (Tasks 24, 27).
//  - 24.2 Property 26: geração do atual.json e ida e volta (pessoas).
//  - 24.3 Property 27: leitura do atual.json sem descarte.
//  - 24.4 Regressão sábado agosto/2026 (DANI HERREIRA, BERNARDO; três nomes).
//
// Feature: melhoras-domingao.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';
import { carregarPessoas } from '../../scripts/lib/cadastro.js';
import { gruposEscalaveis } from '../../montador/lib/grupos.mjs';
import {
  gerarLinhasAtual,
  cultosDeAtual,
  CAMPOS_ATUAL,
} from '../../montador/lib/publicar.mjs';
import { validarEscala } from '../../montador/lib/regras.mjs';
import { slotsDoCulto } from '../../montador/lib/contexto.mjs';
import { PARAMETROS_PADRAO } from '../../scripts/lib/parametros.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIX = resolve(__dirname, '../fixtures/agosto-2026');
// root inexistente para gerarLinhasAtual NÃO preservar campos do disco.
const ROOT_VAZIO = resolve(__dirname, '../fixtures/__inexistente__');

function baseFixture() {
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
  };
}

// ---------------------------------------------------------------------------
// Property 26: Geração do atual.json e ida e volta (pessoas)
// ---------------------------------------------------------------------------

describe('Property 26: Geração do atual.json e ida e volta (pessoas)', () => {
  const base = baseFixture();
  const ids = base.cadastro.pessoas.slice(0, 20).map((p) => p.id);

  function geradorCulto(data, modelo) {
    const slotsMm = slotsDoCulto({ dia_semana: modelo, modelo_louvor: modelo }, base.parametros).filter((s) => s.startsWith('mm_'));
    return fc.record({
      regente: fc.constantFrom(...ids),
      equipe: fc.uniqueArray(fc.constantFrom(...ids), { minLength: 1, maxLength: 5 }),
      mmCount: fc.integer({ min: 0, max: slotsMm.length }),
      obs: fc.constantFrom('', 'DIA DOS PAIS', 'CULTO DA FAMÍLIA'),
      acomp: fc.constantFrom('BANDA', 'PB'),
    }).map(({ regente, equipe, mmCount, obs, acomp }) => {
      const mm = {};
      // escolhe MMs distintos dos já usados
      const usados = new Set([regente, ...equipe]);
      let next = 0;
      for (let i = 0; i < mmCount; i += 1) {
        while (next < ids.length && usados.has(ids[next])) next += 1;
        if (next >= ids.length) break;
        mm[slotsMm[i]] = ids[next];
        usados.add(ids[next]);
        next += 1;
      }
      return {
        data,
        dia_semana: modelo,
        modelo_louvor: modelo,
        tipo: 'louvor',
        slots: slotsDoCulto({ dia_semana: modelo, modelo_louvor: modelo }, base.parametros),
        acomp,
        obs,
        anciao: 'ANCIAO X',
        pregador: 'PREGADOR Y',
        audiovisual: 'AUDIO Z',
        suporte: '-',
        louvoresEs: '',
        temaCulto: '',
        regente,
        equipe,
        mm,
        assumidoPor: null,
        excedentes: [],
      };
    });
  }

  // Feature: melhoras-domingao, Property 26: Geração do atual.json e ida e volta
  test('linhas em ordem de data, chaves de CAMPOS_ATUAL, OBS/AUDIOVISUAL/SUPORTE, nomes por ID, ida e volta', () => {
    fc.assert(
      fc.property(
        geradorCulto('2026-09-05', 'sabado'),
        geradorCulto('2026-09-06', 'domingo'),
        (sabado, domingo) => {
          // ordem de entrada invertida para checar ordenação por data
          const linhas = gerarLinhasAtual(base, [domingo, sabado]);
          expect(linhas.length).toBe(2);
          expect(linhas[0].DATA).toBe('05/09/2026');
          expect(linhas[1].DATA).toBe('06/09/2026');
          for (const linha of linhas) {
            expect(Object.keys(linha)).toEqual(CAMPOS_ATUAL);
          }
          // OBS / AUDIOVISUAL / SUPORTE.
          expect(linhas[0].OBS).toBe(sabado.obs);
          expect(linhas[0].AUDIOVISUAL).toBe('AUDIO Z');
          expect(linhas[0].SUPORTE).toBe('-');

          // Nomes por ID.
          const nomeDe = (id) => base.cadastro.porId.get(id).nome;
          expect(linhas[0]['REGENTE LOUVOR']).toBe(nomeDe(sabado.regente));

          // MENSAGEM MUSICAL do sábado: "NOME_ES, NOME_CULTO" ou só preenchido.
          const mmNomes = ['mm_es', 'mm_culto']
            .filter((s) => sabado.mm[s] != null)
            .map((s) => nomeDe(sabado.mm[s]));
          expect(linhas[0]['MENSAGEM MUSICAL']).toBe(mmNomes.join(', '));

          // Ida e volta: gerarLinhasAtual(cultosDeAtual(linhas)) = linhas.
          const volta = cultosDeAtual(linhas, base);
          const rt = gerarLinhasAtual(base, volta);
          expect(rt).toEqual(linhas);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 27: Leitura do atual.json sem descarte
// ---------------------------------------------------------------------------

describe('Property 27: Leitura do atual.json sem descarte', () => {
  const base = baseFixture();
  const nomes = base.cadastro.pessoas.slice(0, 20).map((p) => p.nome);

  // Feature: melhoras-domingao, Property 27: Leitura do atual.json sem descarte
  test('MM sábado: 1º→es, 2º→culto; excedentes para o resto; total de nomes preservado', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.constantFrom(...nomes), { minLength: 1, maxLength: 6 }),
        (mmNomes) => {
          const linha = {
            DATA: '05/09/2026',
            'DIA SEMANA': 'sábado',
            ACOMP: 'BANDA',
            'REGENTE LOUVOR': base.cadastro.pessoas[0].nome,
            'EQUIPE LOUVOR': base.cadastro.pessoas
              .slice(1, 6)
              .map((p) => p.nome)
              .join(', '),
            'MENSAGEM MUSICAL': mmNomes.join(', '),
            'LOUVORES ES': '',
            'LOUVORES CULTO': '',
            'TEMA CULTO': '',
            AUDIOVISUAL: '',
            'ANCIÃO': '',
            PREGADOR: '',
            SUPORTE: '-',
            OBS: '',
          };
          const [culto] = cultosDeAtual([linha], base);
          const slotsMm = culto.slots.filter((s) => s.startsWith('mm_')); // ['mm_es','mm_culto']
          // 1º nome → mm_es, 2º → mm_culto.
          if (mmNomes.length >= 1) expect(culto.mm.mm_es).toBeDefined();
          if (mmNomes.length >= 2) expect(culto.mm.mm_culto).toBeDefined();
          // Excedentes = nomes além das vagas.
          const excedentesMm = culto.excedentes.filter((e) => e.campo === 'MENSAGEM MUSICAL');
          expect(excedentesMm.length).toBe(Math.max(0, mmNomes.length - slotsMm.length));
          // Total de nomes lidos (vagas + excedentes) = número de nomes do campo.
          const nasVagas = Object.keys(culto.mm).length;
          expect(nasVagas + excedentesMm.length).toBe(mmNomes.length);

          // Excedentes geram aviso em validarEscala.
          if (excedentesMm.length > 0) {
            const { avisos } = validarEscala(base, [culto]);
            expect(avisos.some((a) => a.chave === 'excedente')).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// 24.4 Regressão sábado agosto/2026
// ---------------------------------------------------------------------------

describe('24.4 Regressão sábado agosto/2026', () => {
  const base = baseFixture();
  const atual = JSON.parse(readFileSync(resolve(FIX, 'atual.json'), 'utf8'));

  test('08/08 "DANI HERREIRA, BERNARDO" → mm_es=DANI HERREIRA, mm_culto=BERNARDO e ida/volta igual', () => {
    const cultos = cultosDeAtual(atual, base);
    const c0808 = cultos.find((c) => c.data === '2026-08-08');
    expect(base.cadastro.porId.get(c0808.mm.mm_es).nome).toBe('DANI HERREIRA');
    expect(base.cadastro.porId.get(c0808.mm.mm_culto).nome).toBe('BERNARDO');

    // gerarLinhasAtual devolve a mesma string para a linha de 08/08.
    const linhas = gerarLinhasAtual({ ...base, root: FIX }, cultos);
    const l0808 = linhas.find((l) => l.DATA === '08/08/2026');
    expect(l0808['MENSAGEM MUSICAL']).toBe('DANI HERREIRA, BERNARDO');
  });

  test('ida e volta de todo o atual.json de agosto é idêntica', () => {
    const cultos = cultosDeAtual(atual, base);
    const linhas = gerarLinhasAtual({ ...base, root: FIX }, cultos);
    expect(linhas).toEqual(atual);
  });

  test('MM com três nomes num sábado: dois nas vagas, um excedente e aviso', () => {
    const tres = base.cadastro.pessoas.slice(0, 3).map((p) => p.nome);
    const linha = {
      DATA: '15/08/2026',
      'DIA SEMANA': 'sábado',
      ACOMP: 'BANDA',
      'REGENTE LOUVOR': base.cadastro.pessoas[10].nome,
      'EQUIPE LOUVOR': base.cadastro.pessoas.slice(4, 9).map((p) => p.nome).join(', '),
      'MENSAGEM MUSICAL': tres.join(', '),
      'LOUVORES ES': '',
      'LOUVORES CULTO': '',
      'TEMA CULTO': '',
      AUDIOVISUAL: '',
      'ANCIÃO': '',
      PREGADOR: '',
      SUPORTE: '-',
      OBS: '',
    };
    const [culto] = cultosDeAtual([linha], base);
    expect(Object.keys(culto.mm).length).toBe(2); // mm_es, mm_culto
    const exc = culto.excedentes.filter((e) => e.campo === 'MENSAGEM MUSICAL');
    expect(exc.length).toBe(1);
    const { avisos } = validarEscala(base, [culto]);
    expect(avisos.some((a) => a.chave === 'excedente')).toBe(true);
  });
});
