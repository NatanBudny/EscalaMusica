/**
 * Testes unitários para scripts/lib/solver-selecao.js
 * Verifica sugerirCulto com cenários de vínculos, RF001, MM, e pool insuficiente.
 */
import { sugerirCulto } from '../../scripts/lib/solver-selecao.js';
import { pessoaFixa } from '../helpers/pbt-setup.js';

// --- Helper: cria contexto completo para o solver ---
function criarContexto(pessoas, opcoes = {}) {
  const {
    indisponibilidade = { datas: [], indisponiveis_mes_inteiro: { ids: [] } },
    escaladosPorCulto = new Map(),
    escaladosNesteMes = new Map(),
    externosPorCulto = new Map(),
    historico = new Map(),
    gruposRaw = {},
  } = opcoes;

  return {
    pessoas: {
      pessoas,
      porId: new Map(pessoas.map((p) => [p.id, p])),
      porNome: new Map(pessoas.map((p) => [p.nome, p])),
      grupos: new Map(Object.entries(gruposRaw)),
    },
    indisponibilidade,
    escaladosPorCulto,
    escaladosNesteMes,
    externosPorCulto,
    historico,
  };
}

describe('sugerirCulto', () => {
  const DATA_DOMINGO = '2026-07-05'; // domingo
  const DATA_SABADO = '2026-07-04'; // sábado

  describe('Fase 1: Regente', () => {
    test('seleciona regente com menor score', () => {
      const regente1 = pessoaFixa(1, 'REGENTE_A', {
        habilitacoes: { regente: true, equipe: true, mensagem_musical: { es: false, culto: false, domingo: false } },
      });
      const regente2 = pessoaFixa(2, 'REGENTE_B', {
        habilitacoes: { regente: true, equipe: true, mensagem_musical: { es: false, culto: false, domingo: false } },
      });
      // Membros para equipe
      const membros = Array.from({ length: 5 }, (_, i) =>
        pessoaFixa(10 + i, `MEMBRO_${i}`, { genero: i === 0 ? 'M' : 'F' })
      );
      const pessoas = [regente1, regente2, ...membros];
      const contexto = criarContexto(pessoas);
      const culto = { data: DATA_DOMINGO, dia_semana: 'domingo' };

      const result = sugerirCulto(culto, contexto);

      expect(result.regente).not.toBeNull();
      // Menor ID como desempate (ambos score 0 no início)
      expect(result.regente.id).toBe(1);
    });

    test('emite aviso quando nenhum regente disponível', () => {
      const membros = Array.from({ length: 5 }, (_, i) =>
        pessoaFixa(10 + i, `MEMBRO_${i}`, { genero: 'M' })
      );
      const contexto = criarContexto(membros); // nenhum habilitado como regente
      const culto = { data: DATA_DOMINGO, dia_semana: 'domingo' };

      const result = sugerirCulto(culto, contexto);

      expect(result.regente).toBeNull();
      const avisos = result.justificativas.filter((j) => j.tipo === 'aviso');
      expect(avisos.some((a) => a.mensagem.includes('Nenhum regente'))).toBe(true);
    });
  });

  describe('Fase 2: Equipe', () => {
    test('preenche equipe com 5 membros', () => {
      const regente = pessoaFixa(1, 'REGENTE', {
        habilitacoes: { regente: true, equipe: true, mensagem_musical: { es: false, culto: false, domingo: false } },
      });
      const membros = Array.from({ length: 7 }, (_, i) =>
        pessoaFixa(10 + i, `MEMBRO_${i}`, { genero: i < 2 ? 'M' : 'F' })
      );
      const contexto = criarContexto([regente, ...membros]);
      const culto = { data: DATA_DOMINGO, dia_semana: 'domingo' };

      const result = sugerirCulto(culto, contexto);

      expect(result.equipe).toHaveLength(5);
      // Regente não está na equipe
      expect(result.equipe.find((p) => p.id === regente.id)).toBeUndefined();
    });

    test('RF001: emite aviso se equipe sem homem', () => {
      const regente = pessoaFixa(1, 'REGENTE', {
        genero: 'F',
        habilitacoes: { regente: true, equipe: true, mensagem_musical: { es: false, culto: false, domingo: false } },
      });
      // Todas mulheres
      const membros = Array.from({ length: 5 }, (_, i) =>
        pessoaFixa(10 + i, `MEMBRO_${i}`, { genero: 'F' })
      );
      const contexto = criarContexto([regente, ...membros]);
      const culto = { data: DATA_DOMINGO, dia_semana: 'domingo' };

      const result = sugerirCulto(culto, contexto);

      const avisos = result.justificativas.filter((j) => j.tipo === 'aviso');
      expect(avisos.some((a) => a.mensagem.includes('RF001'))).toBe(true);
    });

    test('RF001: sem aviso quando equipe tem homem', () => {
      const regente = pessoaFixa(1, 'REGENTE', {
        genero: 'F',
        habilitacoes: { regente: true, equipe: true, mensagem_musical: { es: false, culto: false, domingo: false } },
      });
      const membros = Array.from({ length: 5 }, (_, i) =>
        pessoaFixa(10 + i, `MEMBRO_${i}`, { genero: i === 0 ? 'M' : 'F' })
      );
      const contexto = criarContexto([regente, ...membros]);
      const culto = { data: DATA_DOMINGO, dia_semana: 'domingo' };

      const result = sugerirCulto(culto, contexto);

      const avisos = result.justificativas.filter((j) => j.tipo === 'aviso' && j.mensagem.includes('RF001'));
      expect(avisos).toHaveLength(0);
    });

    test('emite aviso quando pool insuficiente (< 5 membros)', () => {
      const regente = pessoaFixa(1, 'REGENTE', {
        habilitacoes: { regente: true, equipe: true, mensagem_musical: { es: false, culto: false, domingo: false } },
      });
      const membros = Array.from({ length: 3 }, (_, i) =>
        pessoaFixa(10 + i, `MEMBRO_${i}`, { genero: 'M' })
      );
      const contexto = criarContexto([regente, ...membros]);
      const culto = { data: DATA_DOMINGO, dia_semana: 'domingo' };

      const result = sugerirCulto(culto, contexto);

      expect(result.equipe.length).toBeLessThan(5);
      const avisos = result.justificativas.filter((j) => j.tipo === 'aviso');
      expect(avisos.some((a) => a.mensagem.includes('membros disponíveis'))).toBe(true);
    });
  });

  describe('Fase 3: Mensagem Musical', () => {
    test('sábado: seleciona 2 MMs (ES + Culto)', () => {
      const regente = pessoaFixa(1, 'REGENTE', {
        habilitacoes: { regente: true, equipe: true, mensagem_musical: { es: false, culto: false, domingo: false } },
      });
      const membros = Array.from({ length: 5 }, (_, i) =>
        pessoaFixa(10 + i, `MEMBRO_${i}`, { genero: 'M' })
      );
      const mmPessoas = [
        pessoaFixa(20, 'MM_ES', {
          habilitacoes: { regente: false, equipe: false, mensagem_musical: { es: true, culto: false, domingo: false } },
        }),
        pessoaFixa(21, 'MM_CULTO', {
          habilitacoes: { regente: false, equipe: false, mensagem_musical: { es: false, culto: true, domingo: false } },
        }),
      ];
      const contexto = criarContexto([regente, ...membros, ...mmPessoas]);
      const culto = { data: DATA_SABADO, dia_semana: 'sabado' };

      const result = sugerirCulto(culto, contexto);

      expect(result.mm).toHaveLength(2);
    });

    test('domingo: seleciona 1 MM (domingo)', () => {
      const regente = pessoaFixa(1, 'REGENTE', {
        habilitacoes: { regente: true, equipe: true, mensagem_musical: { es: false, culto: false, domingo: false } },
      });
      const membros = Array.from({ length: 5 }, (_, i) =>
        pessoaFixa(10 + i, `MEMBRO_${i}`, { genero: 'M' })
      );
      const mmDom = pessoaFixa(20, 'MM_DOM', {
        habilitacoes: { regente: false, equipe: false, mensagem_musical: { es: false, culto: false, domingo: true } },
      });
      const contexto = criarContexto([regente, ...membros, mmDom]);
      const culto = { data: DATA_DOMINGO, dia_semana: 'domingo' };

      const result = sugerirCulto(culto, contexto);

      expect(result.mm).toHaveLength(1);
      expect(result.mm[0].id).toBe(20);
    });

    test('MM não inclui membros da equipe ou regente', () => {
      // Pessoa é habilitada para equipe E mm_domingo
      const regente = pessoaFixa(1, 'REGENTE', {
        habilitacoes: { regente: true, equipe: true, mensagem_musical: { es: false, culto: false, domingo: true } },
      });
      const membros = Array.from({ length: 5 }, (_, i) =>
        pessoaFixa(10 + i, `MEMBRO_${i}`, {
          genero: 'M',
          habilitacoes: { regente: false, equipe: true, mensagem_musical: { es: false, culto: false, domingo: true } },
        })
      );
      const mmExclusivo = pessoaFixa(30, 'MM_EXCLUSIVO', {
        habilitacoes: { regente: false, equipe: false, mensagem_musical: { es: false, culto: false, domingo: true } },
      });
      const contexto = criarContexto([regente, ...membros, mmExclusivo]);
      const culto = { data: DATA_DOMINGO, dia_semana: 'domingo' };

      const result = sugerirCulto(culto, contexto);

      // MM não deve incluir regente nem membros da equipe
      const idsEquipeRegente = new Set([regente.id, ...result.equipe.map((p) => p.id)]);
      for (const mm of result.mm) {
        expect(idsEquipeRegente.has(mm.id)).toBe(false);
      }
    });
  });

  describe('Vínculos: sempre_junto', () => {
    test('parceiro do regente é adicionado automaticamente à equipe', () => {
      const regente = pessoaFixa(2, 'JESSIE', {
        genero: 'F',
        habilitacoes: { regente: true, equipe: true, mensagem_musical: { es: false, culto: false, domingo: false } },
        vinculos: [{ tipo: 'sempre_junto', com_id: 3 }],
      });
      const parceiro = pessoaFixa(3, 'JESSE', {
        genero: 'M',
        habilitacoes: { regente: false, equipe: true, mensagem_musical: { es: false, culto: false, domingo: false } },
        vinculos: [{ tipo: 'sempre_junto', com_id: 2 }],
      });
      const membros = Array.from({ length: 6 }, (_, i) =>
        pessoaFixa(10 + i, `MEMBRO_${i}`, { genero: 'M' })
      );
      const contexto = criarContexto([regente, parceiro, ...membros]);
      const culto = { data: DATA_DOMINGO, dia_semana: 'domingo' };

      const result = sugerirCulto(culto, contexto);

      // JESSE deve estar na equipe por vínculo com regente JESSIE
      expect(result.equipe.find((p) => p.id === 3)).toBeDefined();
      expect(result.equipe).toHaveLength(5);
    });

    test('candidato com sempre_junto adiciona ambos quando há vaga', () => {
      const regente = pessoaFixa(1, 'REGENTE', {
        habilitacoes: { regente: true, equipe: true, mensagem_musical: { es: false, culto: false, domingo: false } },
      });
      // Par com sempre_junto (IDs 5 e 6)
      const pessoaA = pessoaFixa(5, 'YASSER', {
        genero: 'M',
        vinculos: [{ tipo: 'sempre_junto', com_id: 6 }],
      });
      const pessoaB = pessoaFixa(6, 'LIDIANE', {
        genero: 'F',
        vinculos: [{ tipo: 'sempre_junto', com_id: 5 }],
      });
      // Outros membros com IDs maiores (pior desempate)
      const outros = Array.from({ length: 5 }, (_, i) =>
        pessoaFixa(20 + i, `OUTRO_${i}`, { genero: 'M' })
      );
      const contexto = criarContexto([regente, pessoaA, pessoaB, ...outros]);
      const culto = { data: DATA_DOMINGO, dia_semana: 'domingo' };

      const result = sugerirCulto(culto, contexto);

      const idsEquipe = result.equipe.map((p) => p.id);
      // Ambos devem estar ou nenhum (ambos devem estar pois há vaga e score menor)
      if (idsEquipe.includes(5)) {
        expect(idsEquipe).toContain(6);
      }
      if (idsEquipe.includes(6)) {
        expect(idsEquipe).toContain(5);
      }
    });

    test('candidato excluído se parceiro sempre_junto indisponível', () => {
      const regente = pessoaFixa(1, 'REGENTE', {
        habilitacoes: { regente: true, equipe: true, mensagem_musical: { es: false, culto: false, domingo: false } },
      });
      // YASSER com vínculo, mas LIDIANE indisponível
      const yasser = pessoaFixa(5, 'YASSER', {
        genero: 'M',
        vinculos: [{ tipo: 'sempre_junto', com_id: 6 }],
      });
      const lidiane = pessoaFixa(6, 'LIDIANE', {
        genero: 'F',
        vinculos: [{ tipo: 'sempre_junto', com_id: 5 }],
      });
      const outros = Array.from({ length: 5 }, (_, i) =>
        pessoaFixa(20 + i, `OUTRO_${i}`, { genero: 'M' })
      );
      const contexto = criarContexto([regente, yasser, lidiane, ...outros], {
        indisponibilidade: {
          datas: [{ data_referencia: DATA_DOMINGO, indisponiveis_ids: [6] }], // LIDIANE indisponível
          indisponiveis_mes_inteiro: { ids: [] },
        },
      });
      const culto = { data: DATA_DOMINGO, dia_semana: 'domingo' };

      const result = sugerirCulto(culto, contexto);

      // YASSER não deve estar na equipe (parceira indisponível)
      expect(result.equipe.find((p) => p.id === 5)).toBeUndefined();
      // Justificativa de exclusão registrada
      const exclusoes = result.justificativas.filter((j) => j.tipo === 'exclusao');
      expect(exclusoes.some((e) => e.pessoa.id === 5 && e.motivo.includes('sempre_junto'))).toBe(true);
    });

    test('candidato com sempre_junto excluído se não há vaga para par', () => {
      const regente = pessoaFixa(1, 'REGENTE', {
        habilitacoes: { regente: true, equipe: true, mensagem_musical: { es: false, culto: false, domingo: false } },
      });
      // 4 membros com IDs menores (entram primeiro) + 1 extra to fill the 5th spot
      const membros = Array.from({ length: 4 }, (_, i) =>
        pessoaFixa(2 + i, `MEMBRO_${i}`, { genero: 'M' })
      );
      // Um membro extra com ID entre os normais e o par (entra antes do par)
      const membroExtra = pessoaFixa(6, 'MEMBRO_EXTRA', { genero: 'M' });
      // Par com sempre_junto (IDs altos, entram depois dos 5 normais preenchidos)
      const pessoaA = pessoaFixa(50, 'PAR_A', {
        genero: 'M',
        vinculos: [{ tipo: 'sempre_junto', com_id: 51 }],
      });
      const pessoaB = pessoaFixa(51, 'PAR_B', {
        genero: 'F',
        vinculos: [{ tipo: 'sempre_junto', com_id: 50 }],
      });
      const contexto = criarContexto([regente, ...membros, membroExtra, pessoaA, pessoaB]);
      const culto = { data: DATA_DOMINGO, dia_semana: 'domingo' };

      const result = sugerirCulto(culto, contexto);

      // 5 membros normais fill the equipe, par needs 2 spots but 0 available
      expect(result.equipe).toHaveLength(5);
      const idsEquipe = result.equipe.map((p) => p.id);
      expect(idsEquipe).not.toContain(50);
      expect(idsEquipe).not.toContain(51);
    });
  });

  describe('Vínculos: familia_requerida', () => {
    test('candidato com familia_requerida é incluído se familiar está na equipe', () => {
      const regente = pessoaFixa(1, 'REGENTE', {
        habilitacoes: { regente: true, equipe: true, mensagem_musical: { es: false, culto: false, domingo: false } },
      });
      // Membro da familia_silva (ID 5) — lower ID so enters equipe first
      const familiar = pessoaFixa(5, 'FAMILIAR_SILVA', { genero: 'M' });
      // Pessoa com familia_requerida (dependente) — higher ID, enters after familiar
      const luiz = pessoaFixa(10, 'LUIZ DA SILVA', {
        genero: 'M',
        vinculos: [{ tipo: 'familia_requerida', grupo: 'familia_silva' }],
      });
      const outros = Array.from({ length: 5 }, (_, i) =>
        pessoaFixa(40 + i, `OUTRO_${i}`, { genero: 'F' })
      );
      const contexto = criarContexto([regente, familiar, luiz, ...outros], {
        gruposRaw: { familia_silva: { membros_ids: [5, 31, 32] } },
      });
      const culto = { data: DATA_DOMINGO, dia_semana: 'domingo' };

      const result = sugerirCulto(culto, contexto);

      const idsEquipe = result.equipe.map((p) => p.id);
      // Familiar enters first (lower ID → lower score → enters equipe)
      expect(idsEquipe).toContain(5);
      // Then LUIZ can enter because family member is already present
      expect(idsEquipe).toContain(10);
    });

    test('candidato com familia_requerida é excluído se nenhum familiar presente', () => {
      const regente = pessoaFixa(1, 'REGENTE', {
        habilitacoes: { regente: true, equipe: true, mensagem_musical: { es: false, culto: false, domingo: false } },
      });
      // LUIZ precisa de familia_silva mas nenhum membro do grupo está disponível
      const luiz = pessoaFixa(10, 'LUIZ DA SILVA', {
        genero: 'M',
        vinculos: [{ tipo: 'familia_requerida', grupo: 'familia_silva' }],
      });
      // Outros membros que NÃO pertencem ao grupo
      const outros = Array.from({ length: 5 }, (_, i) =>
        pessoaFixa(40 + i, `OUTRO_${i}`, { genero: 'M' })
      );
      const contexto = criarContexto([regente, luiz, ...outros], {
        gruposRaw: { familia_silva: { membros_ids: [30, 31, 32] } }, // nenhum dos IDs 30-32 está nas pessoas
      });
      const culto = { data: DATA_DOMINGO, dia_semana: 'domingo' };

      const result = sugerirCulto(culto, contexto);

      // LUIZ não deve estar na equipe
      const idsEquipe = result.equipe.map((p) => p.id);
      expect(idsEquipe).not.toContain(10);
      // Justificativa registrada
      const exclusoes = result.justificativas.filter((j) => j.tipo === 'exclusao');
      expect(exclusoes.some((e) => e.pessoa.id === 10 && e.motivo.includes('familia_requerida'))).toBe(true);
    });

    test('familia_requerida satisfeita pelo regente', () => {
      // Regente é membro do grupo familia_silva
      const regente = pessoaFixa(30, 'FAMILIAR_REGENTE', {
        genero: 'M',
        habilitacoes: { regente: true, equipe: true, mensagem_musical: { es: false, culto: false, domingo: false } },
      });
      const luiz = pessoaFixa(10, 'LUIZ DA SILVA', {
        genero: 'M',
        vinculos: [{ tipo: 'familia_requerida', grupo: 'familia_silva' }],
      });
      const outros = Array.from({ length: 5 }, (_, i) =>
        pessoaFixa(40 + i, `OUTRO_${i}`, { genero: 'F' })
      );
      const contexto = criarContexto([regente, luiz, ...outros], {
        gruposRaw: { familia_silva: { membros_ids: [30, 31, 32] } },
      });
      const culto = { data: DATA_DOMINGO, dia_semana: 'domingo' };

      const result = sugerirCulto(culto, contexto);

      // Regente (ID 30) é membro de familia_silva, então LUIZ pode participar
      const idsEquipe = result.equipe.map((p) => p.id);
      expect(idsEquipe).toContain(10);
    });
  });

  describe('Contexto atualizado', () => {
    test('marca regente como escalado no contexto', () => {
      const regente = pessoaFixa(1, 'REGENTE', {
        habilitacoes: { regente: true, equipe: true, mensagem_musical: { es: false, culto: false, domingo: false } },
      });
      const membros = Array.from({ length: 5 }, (_, i) =>
        pessoaFixa(10 + i, `MEMBRO_${i}`, { genero: 'M' })
      );
      const contexto = criarContexto([regente, ...membros]);
      const culto = { data: DATA_DOMINGO, dia_semana: 'domingo' };

      sugerirCulto(culto, contexto);

      // Regente marcado em escaladosPorCulto
      expect(contexto.escaladosPorCulto.get(DATA_DOMINGO).has(1)).toBe(true);
      // Regente marcado em escaladosNesteMes
      expect(contexto.escaladosNesteMes.get(1).slots.has('regente')).toBe(true);
    });

    test('marca membros da equipe como escalados', () => {
      const regente = pessoaFixa(1, 'REGENTE', {
        habilitacoes: { regente: true, equipe: true, mensagem_musical: { es: false, culto: false, domingo: false } },
      });
      const membros = Array.from({ length: 5 }, (_, i) =>
        pessoaFixa(10 + i, `MEMBRO_${i}`, { genero: 'M' })
      );
      const contexto = criarContexto([regente, ...membros]);
      const culto = { data: DATA_DOMINGO, dia_semana: 'domingo' };

      const result = sugerirCulto(culto, contexto);

      for (const membro of result.equipe) {
        expect(contexto.escaladosPorCulto.get(DATA_DOMINGO).has(membro.id)).toBe(true);
        expect(contexto.escaladosNesteMes.get(membro.id).slots.has('equipe')).toBe(true);
      }
    });

    test('nenhum indisponível aparece na sugestão', () => {
      const regente = pessoaFixa(1, 'REGENTE', {
        habilitacoes: { regente: true, equipe: true, mensagem_musical: { es: false, culto: false, domingo: false } },
      });
      const membros = Array.from({ length: 7 }, (_, i) =>
        pessoaFixa(10 + i, `MEMBRO_${i}`, { genero: 'M' })
      );
      const indisponiveis = [11, 12]; // IDs 11 e 12 indisponíveis
      const contexto = criarContexto([regente, ...membros], {
        indisponibilidade: {
          datas: [{ data_referencia: DATA_DOMINGO, indisponiveis_ids: indisponiveis }],
          indisponiveis_mes_inteiro: { ids: [] },
        },
      });
      const culto = { data: DATA_DOMINGO, dia_semana: 'domingo' };

      const result = sugerirCulto(culto, contexto);

      const todosIds = [
        result.regente?.id,
        ...result.equipe.map((p) => p.id),
        ...result.mm.map((p) => p.id),
      ].filter(Boolean);

      for (const id of indisponiveis) {
        expect(todosIds).not.toContain(id);
      }
    });
  });

  describe('Justificativas', () => {
    test('registra justificativa para cada escolha', () => {
      const regente = pessoaFixa(1, 'REGENTE', {
        habilitacoes: { regente: true, equipe: true, mensagem_musical: { es: false, culto: false, domingo: false } },
      });
      const membros = Array.from({ length: 5 }, (_, i) =>
        pessoaFixa(10 + i, `MEMBRO_${i}`, { genero: 'M' })
      );
      const contexto = criarContexto([regente, ...membros]);
      const culto = { data: DATA_DOMINGO, dia_semana: 'domingo' };

      const result = sugerirCulto(culto, contexto);

      const escolhas = result.justificativas.filter((j) => j.tipo === 'escolha');
      // Pelo menos regente + 5 membros equipe = 6 escolhas
      expect(escolhas.length).toBeGreaterThanOrEqual(6);
    });
  });
});
