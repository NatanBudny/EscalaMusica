import { scoreCandidato, sortByScore } from '../../../scripts/lib/solver-score.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function criarPessoa(overrides = {}) {
  return {
    id: 1,
    nome: 'TESTE',
    perfil_canto: 'base',
    habilitacoes: { regente: true, equipe: true, mensagem_musical: { es: true, culto: true, domingo: true } },
    vinculos: [],
    ...overrides,
  };
}

function criarContextoVazio() {
  return {
    historico: new Map(),
    escaladosNesteMes: new Map(),
    escaladosPorCulto: new Map(),
    dataAnterior: null,
    regenteAtual: null,
    grupoPreferencialRegente: null,
  };
}

// ─── scoreCandidato ───────────────────────────────────────────────────────────

describe('scoreCandidato', () => {
  describe('score base (sem histórico)', () => {
    test('retorna score baseado apenas em diasDesdeUltima quando sem histórico', () => {
      const pessoa = criarPessoa();
      const contexto = criarContextoVazio();
      const score = scoreCandidato(pessoa, 'equipe', '2026-07-12', contexto);
      // Sem histórico: contadorRotacao=0, diasDesdeUltima=1 (nunca escalada)
      // score = 1.0*0 + 10.0*0 + 20.0*0 + (-0.5)*0 + 5.0*0 + 15.0*0 + (-0.3)*1
      expect(score).toBeCloseTo(-0.3);
    });

    test('pessoa com perfil_canto=participacao recebe penalidade', () => {
      const pessoa = criarPessoa({ perfil_canto: 'participacao' });
      const contexto = criarContextoVazio();
      const score = scoreCandidato(pessoa, 'equipe', '2026-07-12', contexto);
      // score = 0 + 0 + 0 + 0 + 5.0*1 + 0 + (-0.3)*1
      expect(score).toBeCloseTo(4.7);
    });

    test('pessoa com perfil_canto=base não recebe penalidade de participação', () => {
      const pessoa = criarPessoa({ perfil_canto: 'base' });
      const contexto = criarContextoVazio();
      const score = scoreCandidato(pessoa, 'equipe', '2026-07-12', contexto);
      expect(score).toBeCloseTo(-0.3);
    });
  });

  describe('contadorRotacao', () => {
    test('peso 1.0 multiplicado pelo contador de rotação do slot', () => {
      const pessoa = criarPessoa({ id: 5 });
      const contexto = criarContextoVazio();
      contexto.historico.set(5, {
        regencias: 0,
        escalas_equipe: 3,
        mm_es: 0,
        mm_culto: 0,
        mm_domingo: 0,
        ultima_equipe: '2026-06-28',
        ultima_regencia: null,
        ultima_mm: null,
        datas_escalado: [],
      });
      const score = scoreCandidato(pessoa, 'equipe', '2026-07-12', contexto);
      // contadorRotacao = 3, diasDesdeUltima = 14/120 ≈ 0.1167
      // score = 1.0*3 + 0 + 0 + 0 + 0 + 0 + (-0.3)*0.1167
      expect(score).toBeCloseTo(3 + (-0.3) * (14 / 120), 2);
    });

    test('usa contador correto para slot regente', () => {
      const pessoa = criarPessoa({ id: 2 });
      const contexto = criarContextoVazio();
      contexto.historico.set(2, {
        regencias: 5,
        escalas_equipe: 10,
        mm_es: 0,
        mm_culto: 0,
        mm_domingo: 0,
        ultima_regencia: '2026-06-01',
        ultima_equipe: null,
        ultima_mm: null,
        datas_escalado: [],
      });
      const score = scoreCandidato(pessoa, 'regente', '2026-07-12', contexto);
      // contadorRotacao = 5 (regencias), diasDesdeUltima = 41/120
      const diasNorm = 41 / 120;
      expect(score).toBeCloseTo(1.0 * 5 + (-0.3) * diasNorm, 2);
    });

    test('usa contador correto para slot mm_es', () => {
      const pessoa = criarPessoa({ id: 3 });
      const contexto = criarContextoVazio();
      contexto.historico.set(3, {
        regencias: 0,
        escalas_equipe: 0,
        mm_es: 2,
        mm_culto: 5,
        mm_domingo: 1,
        ultima_regencia: null,
        ultima_equipe: null,
        ultima_mm: '2026-07-05',
        datas_escalado: [],
      });
      const score = scoreCandidato(pessoa, 'mm_es', '2026-07-12', contexto);
      // contadorRotacao = 2 (mm_es), diasDesdeUltima = 7/120
      const diasNorm = 7 / 120;
      expect(score).toBeCloseTo(1.0 * 2 + (-0.3) * diasNorm, 2);
    });
  });

  describe('penalConsecutivo', () => {
    test('penaliza pessoa que cantou no culto anterior', () => {
      const pessoa = criarPessoa({ id: 7 });
      const contexto = criarContextoVazio();
      contexto.dataAnterior = '2026-07-05';
      contexto.escaladosPorCulto = new Map([['2026-07-05', new Set([7, 8, 9])]]);

      const score = scoreCandidato(pessoa, 'equipe', '2026-07-12', contexto);
      // penalConsecutivo = 1 → w * 1 = 10.0
      // diasDesdeUltima = 1 (sem histórico)
      expect(score).toBeCloseTo(10.0 + (-0.3) * 1, 2);
    });

    test('não penaliza pessoa que NÃO cantou no culto anterior', () => {
      const pessoa = criarPessoa({ id: 7 });
      const contexto = criarContextoVazio();
      contexto.dataAnterior = '2026-07-05';
      contexto.escaladosPorCulto = new Map([['2026-07-05', new Set([8, 9, 10])]]);

      const score = scoreCandidato(pessoa, 'equipe', '2026-07-12', contexto);
      // penalConsecutivo = 0
      expect(score).toBeCloseTo(-0.3, 2);
    });

    test('não penaliza quando não há dataAnterior', () => {
      const pessoa = criarPessoa({ id: 7 });
      const contexto = criarContextoVazio();
      // dataAnterior = null

      const score = scoreCandidato(pessoa, 'equipe', '2026-07-12', contexto);
      expect(score).toBeCloseTo(-0.3, 2);
    });
  });

  describe('penalMesmoMes', () => {
    test('penaliza pessoa já escalada no mesmo slot neste mês', () => {
      const pessoa = criarPessoa({ id: 4 });
      const contexto = criarContextoVazio();
      contexto.escaladosNesteMes = new Map([
        [4, { slots: new Set(['mm_culto']), datas: ['2026-07-05'] }],
      ]);

      const score = scoreCandidato(pessoa, 'mm_culto', '2026-07-12', contexto);
      // penalMesmoMes = 1 → 20.0
      expect(score).toBeCloseTo(20.0 + (-0.3) * 1, 2);
    });

    test('não penaliza se escalado em slot diferente', () => {
      const pessoa = criarPessoa({ id: 4 });
      const contexto = criarContextoVazio();
      contexto.escaladosNesteMes = new Map([
        [4, { slots: new Set(['equipe']), datas: ['2026-07-05'] }],
      ]);

      const score = scoreCandidato(pessoa, 'mm_culto', '2026-07-12', contexto);
      // penalMesmoMes = 0 (slot diferente)
      expect(score).toBeCloseTo(-0.3, 2);
    });

    test('não penaliza se pessoa não aparece em escaladosNesteMes', () => {
      const pessoa = criarPessoa({ id: 99 });
      const contexto = criarContextoVazio();
      contexto.escaladosNesteMes = new Map([
        [4, { slots: new Set(['equipe']), datas: ['2026-07-05'] }],
      ]);

      const score = scoreCandidato(pessoa, 'equipe', '2026-07-12', contexto);
      expect(score).toBeCloseTo(-0.3, 2);
    });
  });

  describe('bonusGrupoRegente', () => {
    test('bônus (score reduz) para pessoa no grupo do regente', () => {
      const pessoa = criarPessoa({ id: 10 });
      const contexto = criarContextoVazio();
      contexto.grupoPreferencialRegente = new Set([10, 11, 12]);

      const score = scoreCandidato(pessoa, 'equipe', '2026-07-12', contexto);
      // bonusGrupoRegente component = 1, w = -0.5 → contribution = -0.5
      // diasDesdeUltima = 1 (sem histórico), w = -0.3 → contribution = -0.3
      // total = -0.5 + (-0.3) = -0.8
      expect(score).toBeCloseTo(-0.8, 2);
    });

    test('sem bônus para pessoa fora do grupo do regente', () => {
      const pessoa = criarPessoa({ id: 99 });
      const contexto = criarContextoVazio();
      contexto.grupoPreferencialRegente = new Set([10, 11, 12]);

      const score = scoreCandidato(pessoa, 'equipe', '2026-07-12', contexto);
      // bonusGrupoRegente = 0 (não está no grupo)
      expect(score).toBeCloseTo(-0.3, 2);
    });

    test('sem bônus quando grupo é null', () => {
      const pessoa = criarPessoa({ id: 10 });
      const contexto = criarContextoVazio();
      contexto.grupoPreferencialRegente = null;

      const score = scoreCandidato(pessoa, 'equipe', '2026-07-12', contexto);
      expect(score).toBeCloseTo(-0.3, 2);
    });
  });

  describe('penalRepeticaoRegente', () => {
    test('penaliza regente que já regeu neste mês (PE007)', () => {
      const pessoa = criarPessoa({ id: 2 });
      const contexto = criarContextoVazio();
      contexto.escaladosNesteMes = new Map([
        [2, { slots: new Set(['regente']), datas: ['2026-07-05'] }],
      ]);

      const score = scoreCandidato(pessoa, 'regente', '2026-07-12', contexto);
      // penalRepeticaoRegente = 1 → 15.0
      // penalMesmoMes also fires for slot 'regente': 20.0
      // diasDesdeUltima = 1 (no historico)
      expect(score).toBeCloseTo(15.0 + 20.0 + (-0.3) * 1, 2);
    });

    test('não aplica penalidade de repetição para slot não-regente', () => {
      const pessoa = criarPessoa({ id: 2 });
      const contexto = criarContextoVazio();
      contexto.escaladosNesteMes = new Map([
        [2, { slots: new Set(['regente']), datas: ['2026-07-05'] }],
      ]);

      // Testando slot 'equipe' — penalRepeticaoRegente não se aplica
      const score = scoreCandidato(pessoa, 'equipe', '2026-07-12', contexto);
      // penalRepeticaoRegente = 0 (slot não é regente)
      // penalMesmoMes = 0 (slot registrado é 'regente', estamos consultando 'equipe')
      expect(score).toBeCloseTo(-0.3, 2);
    });
  });

  describe('diasDesdeUltima', () => {
    test('pessoa nunca escalada recebe bônus máximo (normalizado = 1)', () => {
      const pessoa = criarPessoa({ id: 20 });
      const contexto = criarContextoVazio();
      // Sem entrada no historico → diasDesdeUltima = 1
      const score = scoreCandidato(pessoa, 'equipe', '2026-07-12', contexto);
      expect(score).toBeCloseTo((-0.3) * 1, 2);
    });

    test('pessoa escalada recentemente recebe menos bônus', () => {
      const pessoa = criarPessoa({ id: 20 });
      const contexto = criarContextoVazio();
      contexto.historico.set(20, {
        regencias: 0,
        escalas_equipe: 1,
        mm_es: 0,
        mm_culto: 0,
        mm_domingo: 0,
        ultima_equipe: '2026-07-05',
        ultima_regencia: null,
        ultima_mm: null,
        datas_escalado: [],
      });

      const score = scoreCandidato(pessoa, 'equipe', '2026-07-12', contexto);
      // diasDesdeUltima = 7/120, contadorRotacao = 1
      const diasNorm = 7 / 120;
      expect(score).toBeCloseTo(1.0 * 1 + (-0.3) * diasNorm, 2);
    });

    test('normalização limita em 1 para mais de 120 dias', () => {
      const pessoa = criarPessoa({ id: 20 });
      const contexto = criarContextoVazio();
      contexto.historico.set(20, {
        regencias: 0,
        escalas_equipe: 1,
        mm_es: 0,
        mm_culto: 0,
        mm_domingo: 0,
        ultima_equipe: '2026-01-01',
        ultima_regencia: null,
        ultima_mm: null,
        datas_escalado: [],
      });

      const score = scoreCandidato(pessoa, 'equipe', '2026-07-12', contexto);
      // 192 dias desde 2026-01-01 → normalizado = min(192/120, 1) = 1
      expect(score).toBeCloseTo(1.0 * 1 + (-0.3) * 1, 2);
    });
  });

  describe('composição de múltiplos componentes', () => {
    test('acumula todas as penalidades corretamente', () => {
      const pessoa = criarPessoa({ id: 5, perfil_canto: 'participacao' });
      const contexto = criarContextoVazio();

      // Setup: pessoa escalada no culto anterior e no mesmo mês no mesmo slot
      contexto.dataAnterior = '2026-07-05';
      contexto.escaladosPorCulto = new Map([['2026-07-05', new Set([5])]]);
      contexto.escaladosNesteMes = new Map([
        [5, { slots: new Set(['equipe']), datas: ['2026-07-05'] }],
      ]);
      contexto.historico.set(5, {
        regencias: 0,
        escalas_equipe: 4,
        mm_es: 0,
        mm_culto: 0,
        mm_domingo: 0,
        ultima_equipe: '2026-07-05',
        ultima_regencia: null,
        ultima_mm: null,
        datas_escalado: [],
      });

      const score = scoreCandidato(pessoa, 'equipe', '2026-07-12', contexto);
      // contadorRotacao = 4 → 1.0 * 4 = 4.0
      // penalConsecutivo = 1 → 10.0 * 1 = 10.0
      // penalMesmoMes = 1 → 20.0 * 1 = 20.0
      // bonusGrupoRegente = 0 → 0
      // penalPerfilParticipacao = 1 → 5.0 * 1 = 5.0
      // penalRepeticaoRegente = 0 (slot != regente) → 0
      // diasDesdeUltima = 7/120 → (-0.3) * (7/120)
      const diasNorm = 7 / 120;
      const expected = 4.0 + 10.0 + 20.0 + 0 + 5.0 + 0 + (-0.3) * diasNorm;
      expect(score).toBeCloseTo(expected, 2);
    });
  });
});

// ─── sortByScore ──────────────────────────────────────────────────────────────

describe('sortByScore', () => {
  test('ordena por score crescente (menor = melhor)', () => {
    const pessoas = [
      criarPessoa({ id: 1, perfil_canto: 'participacao' }), // penalidade +5
      criarPessoa({ id: 2, perfil_canto: 'base' }),          // sem penalidade
      criarPessoa({ id: 3, perfil_canto: 'base' }),          // sem penalidade
    ];
    const contexto = criarContextoVazio();

    // Dar histórico diferente para distinguir IDs 2 e 3
    contexto.historico.set(2, {
      regencias: 0, escalas_equipe: 0, mm_es: 0, mm_culto: 0, mm_domingo: 0,
      ultima_equipe: null, ultima_regencia: null, ultima_mm: null, datas_escalado: [],
    });
    contexto.historico.set(3, {
      regencias: 0, escalas_equipe: 2, mm_es: 0, mm_culto: 0, mm_domingo: 0,
      ultima_equipe: '2026-07-05', ultima_regencia: null, ultima_mm: null, datas_escalado: [],
    });

    const sorted = sortByScore(pessoas, 'equipe', '2026-07-12', contexto);

    // ID 2: score = (-0.3)*1 = -0.3 (sem historico para equipe = nunca escalada → diasDesdeUltima=1)
    // ID 3: score = 1.0*2 + (-0.3)*(7/120) = ~1.9825
    // ID 1: score = 5.0 + (-0.3)*1 = 4.7
    expect(sorted[0].id).toBe(2);
    expect(sorted[1].id).toBe(3);
    expect(sorted[2].id).toBe(1);
  });

  test('desempate por menor ID quando scores iguais', () => {
    const pessoas = [
      criarPessoa({ id: 10, perfil_canto: 'base' }),
      criarPessoa({ id: 5, perfil_canto: 'base' }),
      criarPessoa({ id: 8, perfil_canto: 'base' }),
    ];
    const contexto = criarContextoVazio();
    // Todos sem histórico → mesmo score

    const sorted = sortByScore(pessoas, 'equipe', '2026-07-12', contexto);

    expect(sorted[0].id).toBe(5);
    expect(sorted[1].id).toBe(8);
    expect(sorted[2].id).toBe(10);
  });

  test('não muta o array original', () => {
    const pessoas = [
      criarPessoa({ id: 3 }),
      criarPessoa({ id: 1 }),
      criarPessoa({ id: 2 }),
    ];
    const contexto = criarContextoVazio();

    const original = [...pessoas];
    sortByScore(pessoas, 'equipe', '2026-07-12', contexto);

    expect(pessoas[0].id).toBe(original[0].id);
    expect(pessoas[1].id).toBe(original[1].id);
    expect(pessoas[2].id).toBe(original[2].id);
  });

  test('retorna array vazio para input vazio', () => {
    const contexto = criarContextoVazio();
    const sorted = sortByScore([], 'equipe', '2026-07-12', contexto);
    expect(sorted).toEqual([]);
  });

  test('determinismo: múltiplas execuções produzem mesmo resultado', () => {
    const pessoas = [
      criarPessoa({ id: 10, perfil_canto: 'base' }),
      criarPessoa({ id: 3, perfil_canto: 'participacao' }),
      criarPessoa({ id: 7, perfil_canto: 'base' }),
      criarPessoa({ id: 1, perfil_canto: 'base' }),
    ];
    const contexto = criarContextoVazio();

    const resultado1 = sortByScore(pessoas, 'equipe', '2026-07-12', contexto);
    const resultado2 = sortByScore(pessoas, 'equipe', '2026-07-12', contexto);
    const resultado3 = sortByScore(pessoas, 'equipe', '2026-07-12', contexto);

    expect(resultado1.map((p) => p.id)).toEqual(resultado2.map((p) => p.id));
    expect(resultado2.map((p) => p.id)).toEqual(resultado3.map((p) => p.id));
  });
});
