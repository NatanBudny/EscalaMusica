/**
 * Testes unitários para scripts/lib/solver-filtros.js
 * Verifica a função pessoasAtivasParaSlot e o helper diaDaSemana.
 */
import { pessoasAtivasParaSlot, diaDaSemana } from '../../scripts/lib/solver-filtros.js';
import { pessoaFixa } from '../helpers/pbt-setup.js';

// --- Helper: cria contexto mínimo ---
function criarContexto(pessoas, opcoes = {}) {
  const {
    indisponibilidade = { datas: [], indisponiveis_mes_inteiro: { ids: [] } },
    escaladosPorCulto = new Map(),
    externosPorCulto = new Map(),
  } = opcoes;

  return {
    pessoas: {
      pessoas,
      porId: new Map(pessoas.map((p) => [p.id, p])),
      porNome: new Map(pessoas.map((p) => [p.nome, p])),
      grupos: new Map(),
    },
    indisponibilidade,
    escaladosPorCulto,
    externosPorCulto,
  };
}

describe('diaDaSemana', () => {
  test('retorna "sabado" para 2026-07-04', () => {
    expect(diaDaSemana('2026-07-04')).toBe('sabado');
  });

  test('retorna "domingo" para 2026-07-05', () => {
    expect(diaDaSemana('2026-07-05')).toBe('domingo');
  });

  test('retorna "segunda" para 2026-07-06', () => {
    expect(diaDaSemana('2026-07-06')).toBe('segunda');
  });

  test('retorna "quarta" para 2026-07-01', () => {
    expect(diaDaSemana('2026-07-01')).toBe('quarta');
  });
});

describe('pessoasAtivasParaSlot', () => {
  const DATA = '2026-07-05'; // domingo

  describe('validação de slot', () => {
    test('lança erro para slot inválido', () => {
      const contexto = criarContexto([]);
      expect(() => pessoasAtivasParaSlot('invalido', DATA, contexto)).toThrow(/Slot inválido/);
    });

    test('aceita todos os 5 slots válidos', () => {
      const contexto = criarContexto([]);
      const slots = ['regente', 'equipe', 'mm_es', 'mm_culto', 'mm_domingo'];
      for (const slot of slots) {
        expect(() => pessoasAtivasParaSlot(slot, DATA, contexto)).not.toThrow();
      }
    });
  });

  describe('Filtro 1: ativo', () => {
    test('exclui pessoa inativa', () => {
      const p = pessoaFixa(1, 'INATIVO', { ativo: false });
      const contexto = criarContexto([p]);
      const result = pessoasAtivasParaSlot('equipe', DATA, contexto);
      expect(result).toHaveLength(0);
    });

    test('inclui pessoa ativa', () => {
      const p = pessoaFixa(1, 'ATIVO');
      const contexto = criarContexto([p]);
      const result = pessoasAtivasParaSlot('equipe', DATA, contexto);
      expect(result).toContain(p);
    });
  });

  describe('Filtro 2: afastado', () => {
    test('exclui pessoa com afastamento ativo', () => {
      const p = pessoaFixa(1, 'AFASTADO', {
        afastado: { ativo: true, ate: null, motivo: 'teste' },
      });
      const contexto = criarContexto([p]);
      const result = pessoasAtivasParaSlot('equipe', DATA, contexto);
      expect(result).toHaveLength(0);
    });

    test('inclui pessoa com afastamento inativo', () => {
      const p = pessoaFixa(1, 'NAO_AFASTADO', {
        afastado: { ativo: false, ate: '2026-01-01', motivo: 'retornou' },
      });
      const contexto = criarContexto([p]);
      const result = pessoasAtivasParaSlot('equipe', DATA, contexto);
      expect(result).toContain(p);
    });

    test('inclui pessoa com afastado === null', () => {
      const p = pessoaFixa(1, 'SEM_AFASTAMENTO', { afastado: null });
      const contexto = criarContexto([p]);
      const result = pessoasAtivasParaSlot('equipe', DATA, contexto);
      expect(result).toContain(p);
    });
  });

  describe('Filtro 3: habilitação', () => {
    test('exclui pessoa sem habilitação de regente para slot regente', () => {
      const p = pessoaFixa(1, 'NAO_REGENTE', {
        habilitacoes: { regente: false, equipe: true, mensagem_musical: { es: false, culto: false, domingo: false } },
      });
      const contexto = criarContexto([p]);
      const result = pessoasAtivasParaSlot('regente', DATA, contexto);
      expect(result).toHaveLength(0);
    });

    test('inclui pessoa com habilitação de regente', () => {
      const p = pessoaFixa(1, 'REGENTE', {
        habilitacoes: { regente: true, equipe: true, mensagem_musical: { es: false, culto: false, domingo: false } },
      });
      const contexto = criarContexto([p]);
      const result = pessoasAtivasParaSlot('regente', DATA, contexto);
      expect(result).toContain(p);
    });

    test('exclui pessoa sem habilitação mm_es para slot mm_es', () => {
      const p = pessoaFixa(1, 'SEM_MM_ES', {
        habilitacoes: { regente: false, equipe: true, mensagem_musical: { es: false, culto: true, domingo: true } },
      });
      const contexto = criarContexto([p]);
      const result = pessoasAtivasParaSlot('mm_es', DATA, contexto);
      expect(result).toHaveLength(0);
    });

    test('inclui pessoa com habilitação mm_domingo para slot mm_domingo', () => {
      const p = pessoaFixa(1, 'COM_MM_DOM', {
        habilitacoes: { regente: false, equipe: false, mensagem_musical: { es: false, culto: false, domingo: true } },
      });
      const contexto = criarContexto([p]);
      const result = pessoasAtivasParaSlot('mm_domingo', DATA, contexto);
      expect(result).toContain(p);
    });
  });

  describe('Filtro 4: dias_permitidos', () => {
    test('exclui pessoa que só pode sábado quando data é domingo', () => {
      const p = pessoaFixa(1, 'SO_SABADO', { dias_permitidos: ['sabado'] });
      const contexto = criarContexto([p]);
      // DATA = 2026-07-05 = domingo
      const result = pessoasAtivasParaSlot('equipe', DATA, contexto);
      expect(result).toHaveLength(0);
    });

    test('inclui pessoa que pode domingo quando data é domingo', () => {
      const p = pessoaFixa(1, 'PODE_DOMINGO', { dias_permitidos: ['domingo'] });
      const contexto = criarContexto([p]);
      const result = pessoasAtivasParaSlot('equipe', DATA, contexto);
      expect(result).toContain(p);
    });

    test('inclui pessoa com dias_permitidos === null (todos os dias)', () => {
      const p = pessoaFixa(1, 'TODOS_DIAS', { dias_permitidos: null });
      const contexto = criarContexto([p]);
      const result = pessoasAtivasParaSlot('equipe', DATA, contexto);
      expect(result).toContain(p);
    });

    test('inclui pessoa que pode sábado quando data é sábado', () => {
      const p = pessoaFixa(1, 'SO_SABADO', { dias_permitidos: ['sabado'] });
      const contexto = criarContexto([p]);
      // 2026-07-04 = sábado
      const result = pessoasAtivasParaSlot('equipe', '2026-07-04', contexto);
      expect(result).toContain(p);
    });
  });

  describe('Filtro 5: indisponibilidade na data', () => {
    test('exclui pessoa indisponível na data', () => {
      const p = pessoaFixa(1, 'INDISPONIVEL');
      const contexto = criarContexto([p], {
        indisponibilidade: {
          datas: [{ data_referencia: DATA, indisponiveis_ids: [1] }],
          indisponiveis_mes_inteiro: { ids: [] },
        },
      });
      const result = pessoasAtivasParaSlot('equipe', DATA, contexto);
      expect(result).toHaveLength(0);
    });

    test('inclui pessoa disponível na data', () => {
      const p = pessoaFixa(1, 'DISPONIVEL');
      const contexto = criarContexto([p], {
        indisponibilidade: {
          datas: [{ data_referencia: DATA, indisponiveis_ids: [99] }],
          indisponiveis_mes_inteiro: { ids: [] },
        },
      });
      const result = pessoasAtivasParaSlot('equipe', DATA, contexto);
      expect(result).toContain(p);
    });
  });

  describe('Filtro 6: indisponibilidade mês inteiro', () => {
    test('exclui pessoa indisponível o mês inteiro', () => {
      const p = pessoaFixa(1, 'INDISPONIVEL_MES');
      const contexto = criarContexto([p], {
        indisponibilidade: {
          datas: [],
          indisponiveis_mes_inteiro: { ids: [1] },
        },
      });
      const result = pessoasAtivasParaSlot('equipe', DATA, contexto);
      expect(result).toHaveLength(0);
    });

    test('inclui pessoa não listada no mês inteiro', () => {
      const p = pessoaFixa(1, 'DISPONIVEL_MES');
      const contexto = criarContexto([p], {
        indisponibilidade: {
          datas: [],
          indisponiveis_mes_inteiro: { ids: [99] },
        },
      });
      const result = pessoasAtivasParaSlot('equipe', DATA, contexto);
      expect(result).toContain(p);
    });
  });

  describe('Filtro 7: escala externa', () => {
    test('exclui pessoa no audiovisual', () => {
      const p = pessoaFixa(1, 'AUDIOVISUAL');
      const externosPorCulto = new Map([[DATA, { audiovisual: [1], pregador: [] }]]);
      const contexto = criarContexto([p], { externosPorCulto });
      const result = pessoasAtivasParaSlot('equipe', DATA, contexto);
      expect(result).toHaveLength(0);
    });

    test('exclui pessoa pregador (não ancião)', () => {
      const p = pessoaFixa(1, 'PREGADOR');
      const externosPorCulto = new Map([[DATA, { audiovisual: [], pregador: [1] }]]);
      const contexto = criarContexto([p], { externosPorCulto });
      const result = pessoasAtivasParaSlot('equipe', DATA, contexto);
      expect(result).toHaveLength(0);
    });

    test('inclui pessoa que é ancião pregador (RF004-A exceção)', () => {
      const p = pessoaFixa(1, 'ANCIAO');
      const externosPorCulto = new Map([
        [DATA, { audiovisual: [], pregador: [{ id: 1, tipo: 'ANCIAO' }] }],
      ]);
      const contexto = criarContexto([p], { externosPorCulto });
      const result = pessoasAtivasParaSlot('equipe', DATA, contexto);
      expect(result).toContain(p);
    });

    test('inclui pessoa não listada em externos', () => {
      const p = pessoaFixa(1, 'LIVRE');
      const externosPorCulto = new Map([[DATA, { audiovisual: [99], pregador: [88] }]]);
      const contexto = criarContexto([p], { externosPorCulto });
      const result = pessoasAtivasParaSlot('equipe', DATA, contexto);
      expect(result).toContain(p);
    });
  });

  describe('Filtro 8: conflito mesmo culto', () => {
    test('exclui pessoa já escalada no mesmo culto', () => {
      const p = pessoaFixa(1, 'JA_ESCALADO');
      const escaladosPorCulto = new Map([[DATA, new Set([1])]]);
      const contexto = criarContexto([p], { escaladosPorCulto });
      const result = pessoasAtivasParaSlot('equipe', DATA, contexto);
      expect(result).toHaveLength(0);
    });

    test('inclui pessoa não escalada no mesmo culto', () => {
      const p = pessoaFixa(1, 'NAO_ESCALADO');
      const escaladosPorCulto = new Map([[DATA, new Set([99])]]);
      const contexto = criarContexto([p], { escaladosPorCulto });
      const result = pessoasAtivasParaSlot('equipe', DATA, contexto);
      expect(result).toContain(p);
    });
  });

  describe('Filtros combinados', () => {
    test('aplica todos os filtros sequencialmente', () => {
      const pessoas = [
        pessoaFixa(1, 'PASSA_TUDO'), // passa todos
        pessoaFixa(2, 'INATIVA', { ativo: false }), // filtro 1
        pessoaFixa(3, 'AFASTADA', { afastado: { ativo: true, ate: null, motivo: 'x' } }), // filtro 2
        pessoaFixa(4, 'SEM_HAB', {
          habilitacoes: { regente: false, equipe: false, mensagem_musical: { es: false, culto: false, domingo: false } },
        }), // filtro 3
        pessoaFixa(5, 'DIA_ERRADO', { dias_permitidos: ['sabado'] }), // filtro 4 (DATA é domingo)
        pessoaFixa(6, 'INDISPONIVEL_DATA'), // filtro 5
        pessoaFixa(7, 'INDISPONIVEL_MES'), // filtro 6
        pessoaFixa(8, 'EXTERNO'), // filtro 7
        pessoaFixa(9, 'JA_ESCALADO'), // filtro 8
      ];

      const contexto = criarContexto(pessoas, {
        indisponibilidade: {
          datas: [{ data_referencia: DATA, indisponiveis_ids: [6] }],
          indisponiveis_mes_inteiro: { ids: [7] },
        },
        externosPorCulto: new Map([[DATA, { audiovisual: [8], pregador: [] }]]),
        escaladosPorCulto: new Map([[DATA, new Set([9])]]),
      });

      const result = pessoasAtivasParaSlot('equipe', DATA, contexto);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(1);
    });

    test('retorna lista vazia quando ninguém passa', () => {
      const pessoas = [
        pessoaFixa(1, 'A', { ativo: false }),
        pessoaFixa(2, 'B', { afastado: { ativo: true, ate: null, motivo: 'x' } }),
      ];
      const contexto = criarContexto(pessoas);
      const result = pessoasAtivasParaSlot('equipe', DATA, contexto);
      expect(result).toHaveLength(0);
    });

    test('retorna múltiplos candidatos quando todos passam', () => {
      const pessoas = [
        pessoaFixa(1, 'A'),
        pessoaFixa(2, 'B'),
        pessoaFixa(3, 'C'),
      ];
      const contexto = criarContexto(pessoas);
      const result = pessoasAtivasParaSlot('equipe', DATA, contexto);
      expect(result).toHaveLength(3);
    });
  });

  describe('Contexto sem dados opcionais', () => {
    test('funciona sem externosPorCulto no contexto', () => {
      const p = pessoaFixa(1, 'NORMAL');
      const contexto = criarContexto([p]);
      delete contexto.externosPorCulto;
      const result = pessoasAtivasParaSlot('equipe', DATA, contexto);
      expect(result).toContain(p);
    });

    test('funciona sem escaladosPorCulto no contexto', () => {
      const p = pessoaFixa(1, 'NORMAL');
      const contexto = criarContexto([p]);
      delete contexto.escaladosPorCulto;
      const result = pessoasAtivasParaSlot('equipe', DATA, contexto);
      expect(result).toContain(p);
    });

    test('funciona com indisponibilidade vazia', () => {
      const p = pessoaFixa(1, 'NORMAL');
      const contexto = criarContexto([p], {
        indisponibilidade: null,
      });
      contexto.indisponibilidade = null;
      const result = pessoasAtivasParaSlot('equipe', DATA, contexto);
      expect(result).toContain(p);
    });
  });
});
