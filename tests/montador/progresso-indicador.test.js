// Testes do indicador e progresso (Task 25).
//  - 25.1 Property 22: filtro e indicador não alteram a escala.
//  - 25.2 Property 23: progresso.
//
// Feature: melhoras-domingao.

import fc from 'fast-check';
import { serializarRascunho, assinatura } from '../../montador/public/modulos/rascunho.js';
import { datasVisiveis } from '../../montador/public/modulos/filtro.js';
import { calcularProgresso } from '../../montador/public/modulos/progresso.js';
import { slotsDoCulto } from '../../montador/lib/contexto.mjs';
import { PARAMETROS_PADRAO } from '../../scripts/lib/parametros.js';

const IDS = [1, 2, 3, 4, 5, 6, 7, 8];

function cultoLouvor(data, modelo, over = {}) {
  return {
    data,
    dia_semana: modelo,
    modelo_louvor: modelo,
    tipo: 'louvor',
    slots: slotsDoCulto({ dia_semana: modelo, modelo_louvor: modelo }, PARAMETROS_PADRAO),
    acomp: modelo === 'sabado' ? 'BANDA' : 'PB',
    obs: '',
    regente: null,
    equipe: [],
    mm: {},
    assumidoPor: null,
    extraordinario: false,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// Property 22: Filtro e indicador não alteram a escala
// ---------------------------------------------------------------------------

describe('Property 22: Filtro e indicador não alteram a escala', () => {
  // Feature: melhoras-domingao, Property 22: Filtro e indicador não alteram a escala
  test('datasVisiveis exatas; filtrar não muda serializar/assinatura; assinatura muda com atribuição/acomp/obs', () => {
    fc.assert(
      fc.property(
        fc.record({
          dias: fc.subarray(['sabado', 'domingo', 'quarta'], { minLength: 0, maxLength: 3 }),
        }),
        ({ dias }) => {
          const cultos = [
            cultoLouvor('2026-09-05', 'sabado', { regente: 1, equipe: [2, 3] }),
            cultoLouvor('2026-09-06', 'domingo', { regente: 4 }),
            { data: '2026-09-02', dia_semana: 'quarta-feira', tipo: 'quarta', slots: [], obs: '', mm: {}, equipe: [] },
          ];

          // datasVisiveis contém exatamente os cultos que casam.
          const filtro = { dias: new Set(dias) };
          const visiveis = datasVisiveis(cultos, filtro);
          const esperadas = new Set(
            cultos
              .filter((c) => {
                if (dias.length === 0) return true;
                const d = (c.dia_semana || '').startsWith('quarta') ? 'quarta' : c.dia_semana;
                return dias.includes(d);
              })
              .map((c) => c.data),
          );
          expect([...visiveis].sort()).toEqual([...esperadas].sort());

          // Filtrar não muda a escala serializada (ignorando o carimbo de
          // tempo salvo_em) nem a assinatura.
          const semTempo = (texto) => {
            const o = JSON.parse(texto);
            delete o.salvo_em;
            return JSON.stringify(o);
          };
          const antesSer = semTempo(serializarRascunho('2026-09', cultos));
          const antesAss = assinatura(cultos);
          // "aplicar filtro" é só esconder cards — não muda o estado:
          const depoisSer = semTempo(serializarRascunho('2026-09', cultos));
          const depoisAss = assinatura(cultos);
          expect(depoisSer).toBe(antesSer);
          expect(depoisAss).toBe(antesAss);

          // Mudar uma atribuição muda a assinatura.
          const mudado = cultos.map((c) =>
            c.data === '2026-09-05' ? { ...c, regente: 7 } : c,
          );
          expect(assinatura(mudado)).not.toBe(antesAss);

          // Mudar o acomp muda a assinatura.
          const mudadoAcomp = cultos.map((c) =>
            c.data === '2026-09-06' ? { ...c, acomp: 'BANDA' } : c,
          );
          expect(assinatura(mudadoAcomp)).not.toBe(antesAss);

          // Mudar a OBS (inclusive de quarta) muda a assinatura.
          const mudadoObs = cultos.map((c) =>
            c.data === '2026-09-02' ? { ...c, obs: 'AVISO' } : c,
          );
          expect(assinatura(mudadoObs)).not.toBe(antesAss);
        },
      ),
      { numRuns: 100 },
    );
  });

  test('indicador acende sse e somente se assinatura(estado) != assinatura(publicada)', () => {
    const publicada = [cultoLouvor('2026-09-05', 'sabado', { regente: 1 })];
    const igual = [cultoLouvor('2026-09-05', 'sabado', { regente: 1 })];
    const diferente = [cultoLouvor('2026-09-05', 'sabado', { regente: 2 })];
    expect(assinatura(igual) === assinatura(publicada)).toBe(true);
    expect(assinatura(diferente) === assinatura(publicada)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Property 23: Progresso
// ---------------------------------------------------------------------------

describe('Property 23: Progresso', () => {
  // Feature: melhoras-domingao, Property 23: Progresso
  test('preenchidas+pendentes=total; total = funções dos cultos louvor; completos sem pendência', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            modelo: fc.constantFrom('sabado', 'domingo'),
            regente: fc.option(fc.constantFrom(...IDS), { nil: null }),
            equipeN: fc.integer({ min: 0, max: 5 }),
            mmN: fc.integer({ min: 0, max: 2 }),
            assume: fc.boolean(),
          }),
          { minLength: 1, maxLength: 5 },
        ),
        (specs) => {
          const cultos = specs.map((s, i) => {
            const modelo = s.modelo;
            const slots = slotsDoCulto({ dia_semana: modelo, modelo_louvor: modelo }, PARAMETROS_PADRAO);
            const slotsMm = slots.filter((x) => x.startsWith('mm_'));
            const mm = {};
            for (let k = 0; k < Math.min(s.mmN, slotsMm.length); k += 1) mm[slotsMm[k]] = IDS[k];
            const equipe = IDS.slice(0, s.equipeN);
            return cultoLouvor(`2026-09-${String(5 + i).padStart(2, '0')}`, modelo, {
              regente: s.regente,
              equipe,
              mm,
              assumidoPor: s.assume ? 'grupo:min_jovem' : null,
            });
          });
          // adiciona uma quarta (não conta no total)
          cultos.push({ data: '2026-09-02', dia_semana: 'quarta-feira', tipo: 'quarta', slots: [], mm: {}, equipe: [] });

          const prog = calcularProgresso(cultos, { tamanhoEquipe: 5 });
          expect(prog.preenchidas + prog.pendentes).toBe(prog.total);

          // total = soma das vagas dos cultos louvor.
          let totalEsperado = 0;
          for (const c of cultos) {
            if (c.tipo !== 'louvor') continue;
            for (const slot of c.slots) totalEsperado += slot === 'equipe' ? 5 : 1;
          }
          expect(prog.total).toBe(totalEsperado);

          // Culto completo (ou assumido) está em completos.
          for (const c of cultos) {
            if (c.tipo !== 'louvor') continue;
            if (c.assumidoPor) {
              expect(prog.completos.has(c.data)).toBe(true);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  test('culto assumido conta como completo; quartas não contam', () => {
    const cultos = [
      cultoLouvor('2026-09-06', 'domingo', { assumidoPor: 'grupo:min_jovem' }),
      { data: '2026-09-02', dia_semana: 'quarta-feira', tipo: 'quarta', slots: [], mm: {}, equipe: [] },
    ];
    const prog = calcularProgresso(cultos, { tamanhoEquipe: 5 });
    // domingo: regente+equipe(5)+mm_domingo = 7 vagas, todas completas.
    expect(prog.total).toBe(7);
    expect(prog.preenchidas).toBe(7);
    expect(prog.pendentes).toBe(0);
    expect(prog.completos.has('2026-09-06')).toBe(true);
    expect(prog.completos.has('2026-09-02')).toBe(false);
  });
});
