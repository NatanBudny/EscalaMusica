// Testes de contexto.mjs focados no Task 18: paraParticipacao.
//  - dia extraordinário conta como o modelo escolhido;
//  - sem_louvor fica de fora (vira quarta-feira);
//  - atribuições por ID/'grupo:<chave>' são resolvidas para nomes.
//
// Feature: melhoras-domingao (E. Montagem) — Task 18; Requisitos 12.7, 17.4.

import {
  paraParticipacao,
  tipoDoCulto,
  slotsDoCulto,
} from '../../montador/lib/contexto.mjs';

function cadastroFalso() {
  const pessoas = [
    { id: 1, nome: 'ANA' },
    { id: 2, nome: 'BRUNO' },
    { id: 3, nome: 'CARLA' },
  ];
  return {
    porId: new Map(pessoas.map((p) => [p.id, p])),
    grupos: new Map([['fam_nilsinho', { nome_exibicao: 'FAMILIA NILSINHO' }]]),
  };
}

describe('Task 18: paraParticipacao', () => {
  test('dia extraordinário "como domingo" conta como domingo', () => {
    const cultos = [
      {
        data: '2026-09-11',
        dia_semana: 'sexta-feira',
        modelo_louvor: 'domingo',
        extraordinario: true,
        regente: 1,
        equipe: [2, 3],
        mm: { mm_domingo: 1 },
      },
    ];
    const [c] = paraParticipacao(cultos, cadastroFalso());
    expect(c.dia_semana).toBe('domingo');
    expect(c.regente).toBe('ANA');
    expect(c.equipe).toBe('BRUNO, CARLA');
    expect(c.mm).toBe('ANA');
  });

  test('modelo sem_louvor é tratado como quarta-feira (fica de fora do louvor)', () => {
    const cultos = [
      { data: '2026-09-10', dia_semana: 'quinta-feira', modelo_louvor: 'sem_louvor', regente: null, equipe: [], mm: {} },
    ];
    const [c] = paraParticipacao(cultos, cadastroFalso());
    expect(c.dia_semana).toBe('quarta-feira');
  });

  test("resolve 'grupo:<chave>' pelo nome_exibicao", () => {
    const cultos = [
      { data: '2026-09-05', dia_semana: 'sabado', modelo_louvor: 'sabado', regente: 2, equipe: [1], mm: { mm_es: 'grupo:fam_nilsinho' } },
    ];
    const [c] = paraParticipacao(cultos, cadastroFalso());
    expect(c.dia_semana).toBe('sabado');
    expect(c.mm).toBe('FAMILIA NILSINHO');
  });

  test('tipoDoCulto e slotsDoCulto do modelo sábado/domingo', () => {
    expect(tipoDoCulto({ dia_semana: 'sabado', modelo_louvor: 'sabado' })).toBe('louvor');
    expect(slotsDoCulto({ dia_semana: 'sabado', modelo_louvor: 'sabado' })).toEqual([
      'regente',
      'equipe',
      'mm_es',
      'mm_culto',
    ]);
    expect(slotsDoCulto({ dia_semana: 'domingo', modelo_louvor: 'domingo' })).toEqual([
      'regente',
      'equipe',
      'mm_domingo',
    ]);
    expect(slotsDoCulto({ dia_semana: 'quinta-feira', modelo_louvor: 'sem_louvor' })).toEqual([]);
  });
});
