// Testes do Acionato e contexto do culto (Task 15):
// validarAcionato (data duplicada/fora/modelo inválido), ida e volta de salvar/ler,
// slotsDoCulto por modelo e inclusão de sexta "como domingo".

import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import {
  lerAcionato,
  validarAcionato,
  salvarAcionato,
} from '../../montador/lib/insumos.mjs';
import { slotsDoCulto, tipoDoCulto, modeloPorDiaSemana } from '../../montador/lib/contexto.mjs';

describe('Task 15: validarAcionato', () => {
  test('recusa data duplicada', () => {
    const problemas = validarAcionato('2026-09', {
      itens: [
        { data: '2026-09-05', dia: 'sabado', modelo_louvor: 'sabado' },
        { data: '2026-09-05', dia: 'sabado', modelo_louvor: 'sabado' },
      ],
    });
    expect(problemas.some((p) => p.includes('duplicada'))).toBe(true);
  });

  test('recusa data fora do mês', () => {
    const problemas = validarAcionato('2026-09', {
      itens: [{ data: '2026-10-03', dia: 'sabado', modelo_louvor: 'sabado' }],
    });
    expect(problemas.some((p) => p.includes('fora do mês'))).toBe(true);
  });

  test('recusa modelo de louvor inválido', () => {
    const problemas = validarAcionato('2026-09', {
      itens: [{ data: '2026-09-05', dia: 'sabado', modelo_louvor: 'especial' }],
    });
    expect(problemas.some((p) => p.includes('Modelo de louvor inválido'))).toBe(true);
  });

  test('aceita acionato válido', () => {
    const problemas = validarAcionato('2026-09', {
      itens: [
        { data: '2026-09-05', dia: 'sabado', modelo_louvor: 'sabado' },
        { data: '2026-09-06', dia: 'domingo', modelo_louvor: 'domingo' },
      ],
    });
    expect(problemas).toEqual([]);
  });
});

describe('Task 15: salvar e ler preserva itens', () => {
  let dir;
  beforeEach(() => {
    dir = mkdtempSync(resolve(tmpdir(), 'escala-acionato-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test('ida e volta com dia extraordinário sexta "como domingo"', () => {
    const acionato = {
      itens: [
        {
          data: '2026-09-05',
          dia: 'sabado',
          anciao: 'RICARDO',
          pregador: 'PR. HOFNI',
          observacoes: '',
          modelo_louvor: 'sabado',
          extraordinario: false,
        },
        {
          data: '2026-09-11',
          dia: 'sexta-feira',
          anciao: '',
          pregador: '',
          observacoes: 'SEMANA DE ORAÇÃO',
          modelo_louvor: 'domingo',
          extraordinario: true,
        },
      ],
    };
    const { arquivos } = salvarAcionato('2026-09', acionato, { root: dir });
    expect(arquivos).toEqual(['escalas/2026/09/insumos/acionato.json']);
    expect(existsSync(resolve(dir, arquivos[0]))).toBe(true);

    const lido = lerAcionato('2026-09', { root: dir });
    expect(lido.itens).toHaveLength(2);
    const extra = lido.itens.find((i) => i.data === '2026-09-11');
    expect(extra.modelo_louvor).toBe('domingo');
    expect(extra.extraordinario).toBe(true);
    expect(extra.observacoes).toBe('SEMANA DE ORAÇÃO');
  });

  test('salvar recusa acionato inválido', () => {
    expect(() =>
      salvarAcionato('2026-09', {
        itens: [{ data: '2026-10-01', dia: 'sabado', modelo_louvor: 'sabado' }],
      }, { root: dir }),
    ).toThrow();
  });
});

describe('Task 15: slotsDoCulto por modelo', () => {
  test('sábado tem 4 slots (com 2 MM por padrão)', () => {
    expect(slotsDoCulto({ dia_semana: 'sabado', modelo_louvor: 'sabado' })).toEqual([
      'regente',
      'equipe',
      'mm_es',
      'mm_culto',
    ]);
  });

  test('sábado com mm_sabado.quantidade = 1 tem 3 slots', () => {
    const params = { regras: { mm_sabado: { valores: { quantidade: 1 } } } };
    expect(slotsDoCulto({ modelo_louvor: 'sabado' }, params)).toEqual([
      'regente',
      'equipe',
      'mm_culto',
    ]);
  });

  test('domingo tem regente, equipe, mm_domingo', () => {
    expect(slotsDoCulto({ dia_semana: 'domingo', modelo_louvor: 'domingo' })).toEqual([
      'regente',
      'equipe',
      'mm_domingo',
    ]);
  });

  test('sem louvor e quarta não têm slots', () => {
    expect(slotsDoCulto({ dia_semana: 'quarta-feira' })).toEqual([]);
    expect(slotsDoCulto({ modelo_louvor: 'sem_louvor', dia_semana: 'sexta-feira' })).toEqual([]);
  });

  test('sexta "como domingo" oferece slots de domingo', () => {
    const culto = { dia_semana: 'sexta-feira', modelo_louvor: 'domingo', extraordinario: true };
    expect(tipoDoCulto(culto)).toBe('louvor');
    expect(slotsDoCulto(culto)).toEqual(['regente', 'equipe', 'mm_domingo']);
  });

  test('modeloPorDiaSemana', () => {
    expect(modeloPorDiaSemana('sabado')).toBe('sabado');
    expect(modeloPorDiaSemana('domingo')).toBe('domingo');
    expect(modeloPorDiaSemana('quarta-feira')).toBe('sem_louvor');
  });
});
