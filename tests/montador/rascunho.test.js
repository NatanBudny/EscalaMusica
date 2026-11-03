// Testes do rascunho automático por ID (Task 24).
//  - 24.1 Property 21: rascunho por ID (ida e volta, renomear, fora do cadastro).
//
// Feature: melhoras-domingao.

import fc from 'fast-check';
import {
  chaveRascunho,
  serializarRascunho,
  desserializarRascunho,
} from '../../montador/public/modulos/rascunho.js';

// Gerador de CultoMontagem com ocupantes por ID / 'grupo:<chave>'.
function geradorCultos(idsValidos, gruposValidos) {
  const ocupante = fc.oneof(
    fc.constantFrom(...idsValidos),
    fc.constantFrom(...gruposValidos.map((g) => `grupo:${g}`)),
  );
  return fc.array(
    fc.record({
      data: fc.constantFrom('2026-09-05', '2026-09-06', '2026-09-12', '2026-09-13'),
      acomp: fc.constantFrom('BANDA', 'PB'),
      obs: fc.constantFrom('', 'CULTO DA FAMÍLIA', 'DIA DOS PAIS'),
      regente: fc.option(ocupante, { nil: null }),
      equipe: fc.array(fc.constantFrom(...idsValidos), { maxLength: 5 }),
      mm: fc.record({
        mm_es: fc.option(ocupante, { nil: undefined }),
        mm_culto: fc.option(ocupante, { nil: undefined }),
      }),
      assumidoPor: fc.option(
        fc.constantFrom(...gruposValidos.map((g) => `grupo:${g}`)),
        { nil: null },
      ),
    }),
    { minLength: 1, maxLength: 4 },
  );
}

describe('Property 21: Rascunho por ID', () => {
  const idsValidos = [1, 2, 3, 4, 5, 6, 7, 8];
  const gruposValidos = ['familia_nilsinho', 'min_jovem'];
  const pessoasPorId = new Map(idsValidos.map((id) => [id, { id, nome: `P${id}` }]));
  const gruposPorChave = new Map(gruposValidos.map((c) => [c, { nome_exibicao: c }]));

  // Feature: melhoras-domingao, Property 21: Rascunho por ID
  test('ida e volta devolve as mesmas atribuições, acomp, obs, assumidoPor', () => {
    fc.assert(
      fc.property(geradorCultos(idsValidos, gruposValidos), (cultos) => {
        const texto = serializarRascunho('2026-09', cultos);
        const { cultos: volta, foraDoCadastro } = desserializarRascunho(
          texto,
          pessoasPorId,
          gruposPorChave,
        );
        expect(foraDoCadastro.length).toBe(0);
        expect(volta.length).toBe(cultos.length);
        for (let i = 0; i < cultos.length; i += 1) {
          const a = cultos[i];
          const b = volta[i];
          expect(b.data).toBe(a.data);
          expect(b.acomp).toBe(a.acomp);
          expect(b.obs).toBe(a.obs);
          expect(b.regente ?? null).toEqual(a.regente ?? null);
          // equipe (só IDs válidos preservados, mesma ordem)
          expect(b.equipe).toEqual(a.equipe);
          expect(b.assumidoPor ?? null).toEqual(a.assumidoPor ?? null);
          // mm por slot
          for (const slot of ['mm_es', 'mm_culto']) {
            const va = a.mm[slot];
            if (va == null) {
              expect(b.mm[slot]).toBeUndefined();
            } else {
              expect(b.mm[slot]).toEqual(va);
            }
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  test('renomear pessoas no cadastro não altera as atribuições recuperadas', () => {
    const cultos = [
      { data: '2026-09-05', acomp: 'BANDA', obs: '', regente: 1, equipe: [2, 3], mm: { mm_es: 4 }, assumidoPor: null },
    ];
    const texto = serializarRascunho('2026-09', cultos);
    // cadastro "renomeado"
    const renomeado = new Map([
      [1, { id: 1, nome: 'NOVO NOME 1' }],
      [2, { id: 2, nome: 'OUTRO 2' }],
      [3, { id: 3, nome: 'P3' }],
      [4, { id: 4, nome: 'ZZZ' }],
    ]);
    const { cultos: volta } = desserializarRascunho(texto, renomeado, new Map());
    expect(volta[0].regente).toBe(1);
    expect(volta[0].equipe).toEqual([2, 3]);
    expect(volta[0].mm.mm_es).toBe(4);
  });

  test('IDs ausentes do cadastro aparecem em foraDoCadastro e nunca são descartados', () => {
    const cultos = [
      { data: '2026-09-05', acomp: 'BANDA', obs: '', regente: 999, equipe: [2, 1000], mm: { mm_es: 'grupo:inexistente' }, assumidoPor: null },
    ];
    const texto = serializarRascunho('2026-09', cultos);
    const { cultos: volta, foraDoCadastro } = desserializarRascunho(texto, pessoasPorId, gruposPorChave);
    // ocupantes preservados (ainda presentes)
    expect(volta[0].regente).toBe(999);
    expect(volta[0].equipe).toEqual([2, 1000]);
    expect(volta[0].mm.mm_es).toBe('grupo:inexistente');
    // reportados como fora do cadastro
    const ids = foraDoCadastro.map((f) => f.id);
    expect(ids).toContain(999);
    expect(ids).toContain(1000);
    expect(ids).toContain('grupo:inexistente');
    expect(ids).not.toContain(2);
  });

  test('chaveRascunho usa o mês', () => {
    expect(chaveRascunho('2026-09')).toBe('escala:rascunho:2026-09');
  });
});
