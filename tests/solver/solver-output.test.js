/**
 * Testes unitários para scripts/lib/solver-output.js
 * Verifica formatarRascunhoMd e gerarJustificativa.
 */
import { formatarRascunhoMd, gerarJustificativa } from '../../scripts/lib/solver-output.js';
import { pessoaFixa } from '../helpers/pbt-setup.js';

// --- Helpers ---

function criarSugestao(overrides = {}) {
  return {
    data: '2026-07-05',
    dia_semana: 'domingo',
    anciao: 'DULCINEIA',
    pregador: 'R. KOCH',
    audiovisual: 'DIEGO',
    regente: pessoaFixa(1, 'CATHERINE', {
      habilitacoes: { regente: true, equipe: true, mensagem_musical: { es: false, culto: false, domingo: false } },
    }),
    equipe: [
      pessoaFixa(2, 'FABRICIO', { genero: 'M' }),
      pessoaFixa(3, 'JESSE', { genero: 'M' }),
      pessoaFixa(4, 'JESSIE', { genero: 'F' }),
      pessoaFixa(5, 'BERNARDO', { genero: 'M' }),
      pessoaFixa(6, 'ALEX', { genero: 'M' }),
    ],
    mm: [pessoaFixa(7, 'RONI')],
    justificativas: [
      {
        tipo: 'escolha',
        data: '2026-07-05',
        slot: 'REGENTE',
        pessoa: { id: 1, nome: 'CATHERINE' },
        motivo: 'menor score entre 8 candidato(s)',
        candidatos_avaliados: ['CATHERINE', 'SILVANA', 'DANY KALLAS', 'FABRICIO', 'GIOVANA'],
      },
      {
        tipo: 'escolha',
        data: '2026-07-05',
        slot: 'EQUIPE',
        pessoa: { id: 2, nome: 'FABRICIO' },
        motivo: 'menor score entre 12 candidato(s)',
        candidatos_avaliados: ['FABRICIO', 'JESSE', 'JESSIE', 'BERNARDO', 'ALEX'],
      },
      {
        tipo: 'escolha',
        data: '2026-07-05',
        slot: 'EQUIPE',
        pessoa: { id: 3, nome: 'JESSE' },
        motivo: 'par sempre_junto (JESSE↔JESSIE)',
        candidatos_avaliados: ['JESSE', 'BERNARDO', 'ALEX'],
      },
      {
        tipo: 'escolha',
        data: '2026-07-05',
        slot: 'EQUIPE',
        pessoa: { id: 4, nome: 'JESSIE' },
        motivo: 'par sempre_junto (JESSE↔JESSIE)',
        candidatos_avaliados: [],
      },
      {
        tipo: 'escolha',
        data: '2026-07-05',
        slot: 'EQUIPE',
        pessoa: { id: 5, nome: 'BERNARDO' },
        motivo: 'menor score entre 12 candidato(s)',
        candidatos_avaliados: ['BERNARDO', 'ALEX', 'ROSANA'],
      },
      {
        tipo: 'escolha',
        data: '2026-07-05',
        slot: 'EQUIPE',
        pessoa: { id: 6, nome: 'ALEX' },
        motivo: 'menor score entre 12 candidato(s)',
        candidatos_avaliados: ['ALEX', 'ROSANA', 'MARAIR'],
      },
      {
        tipo: 'escolha',
        data: '2026-07-05',
        slot: 'MM_DOMINGO',
        pessoa: { id: 7, nome: 'RONI' },
        motivo: 'menor score entre 5 candidato(s)',
        candidatos_avaliados: ['RONI', 'VONI', 'JEMELLI'],
      },
      {
        tipo: 'exclusao',
        data: '2026-07-05',
        pessoa: { id: 20, nome: 'YASSER' },
        motivo: 'parceiro(a) LIDIANE indisponível (sempre_junto)',
      },
    ],
    obs: '',
    ...overrides,
  };
}

describe('formatarRascunhoMd', () => {
  test('gera tabela markdown com header correto', () => {
    const sugestoes = [criarSugestao()];
    const md = formatarRascunhoMd(sugestoes);

    expect(md).toContain('# Rascunho - Escala Julho 2026');
    expect(md).toContain('| DATA | DIA SEMANA | ANCIÃO | PREGADOR | AUDIOVISUAL | REGENTE LOUVOR | EQUIPE LOUVOR | MENSAGEM MUSICAL | OBS |');
    expect(md).toContain('|------|------------|--------|----------|-------------|----------------|---------------|------------------|-----|');
  });

  test('formata data ISO para formato brasileiro (DD/MM/YYYY)', () => {
    const sugestoes = [criarSugestao({ data: '2026-07-12' })];
    const md = formatarRascunhoMd(sugestoes);

    expect(md).toContain('12/07/2026');
  });

  test('formata dia da semana corretamente', () => {
    const sugestoes = [criarSugestao({ dia_semana: 'sabado' })];
    const md = formatarRascunhoMd(sugestoes);

    expect(md).toContain('Sábado');
  });

  test('inclui nomes de regente, equipe e MM na linha', () => {
    const sugestoes = [criarSugestao()];
    const md = formatarRascunhoMd(sugestoes);

    expect(md).toContain('CATHERINE');
    expect(md).toContain('FABRICIO, JESSE, JESSIE, BERNARDO, ALEX');
    expect(md).toContain('RONI');
  });

  test('inclui dados externos (ancião, pregador, audiovisual)', () => {
    const sugestoes = [criarSugestao()];
    const md = formatarRascunhoMd(sugestoes);

    expect(md).toContain('DULCINEIA');
    expect(md).toContain('R. KOCH');
    expect(md).toContain('DIEGO');
  });

  test('usa "-" quando regente é null', () => {
    const sugestoes = [criarSugestao({ regente: null })];
    const md = formatarRascunhoMd(sugestoes);

    // Verifica que a coluna de regente contém "-"
    const linhas = md.split('\n').filter((l) => l.includes('05/07/2026'));
    expect(linhas[0]).toContain('| - |');
  });

  test('usa "-" quando equipe é vazia', () => {
    const sugestoes = [criarSugestao({ equipe: [] })];
    const md = formatarRascunhoMd(sugestoes);

    const linhas = md.split('\n').filter((l) => l.includes('05/07/2026'));
    expect(linhas[0]).toMatch(/\|\s*-\s*\|\s*RONI/);
  });

  test('retorna mensagem padrão para array vazio', () => {
    const md = formatarRascunhoMd([]);
    expect(md).toContain('Nenhuma sugestão gerada');
  });

  test('gera múltiplas linhas para múltiplos cultos', () => {
    const sugestoes = [
      criarSugestao({ data: '2026-07-05', dia_semana: 'domingo' }),
      criarSugestao({ data: '2026-07-11', dia_semana: 'sabado' }),
    ];
    const md = formatarRascunhoMd(sugestoes);

    expect(md).toContain('05/07/2026');
    expect(md).toContain('11/07/2026');
  });

  test('formato compatível com validar-rascunho.js (linha começa com | DD/MM/YYYY |)', () => {
    const sugestoes = [criarSugestao()];
    const md = formatarRascunhoMd(sugestoes);
    const dataLines = md.split('\n').filter((l) => /^\|\s\d{2}\/\d{2}\/\d{4}\s\|/.test(l));

    expect(dataLines.length).toBe(1);
    // Verificar que tem 9 colunas (10 separadores |)
    const pipes = dataLines[0].split('|').length;
    expect(pipes).toBe(11); // |col1|col2|...|col9| = 11 parts when split
  });

  test('quarta-feira com campos vazios de louvor', () => {
    const sugestao = criarSugestao({
      data: '2026-07-02',
      dia_semana: 'quarta-feira',
      regente: null,
      equipe: [],
      mm: [],
    });
    const md = formatarRascunhoMd([sugestao]);

    expect(md).toContain('Quarta-feira');
    expect(md).toContain('02/07/2026');
  });
});

describe('gerarJustificativa', () => {
  test('gera título com mês/ano corretos', () => {
    const sugestoes = [criarSugestao()];
    const md = gerarJustificativa(sugestoes, {});

    expect(md).toContain('# Justificativa - Escala Julho 2026');
  });

  test('gera seção por data com dia da semana', () => {
    const sugestoes = [criarSugestao()];
    const md = gerarJustificativa(sugestoes, {});

    expect(md).toContain('## 05/07/2026 (Domingo)');
  });

  test('lista regente com motivo e candidatos', () => {
    const sugestoes = [criarSugestao()];
    const md = gerarJustificativa(sugestoes, {});

    expect(md).toContain('### Regente: CATHERINE');
    expect(md).toContain('menor score entre 8 candidato(s)');
    expect(md).toContain('Candidatos avaliados: CATHERINE, SILVANA, DANY KALLAS, FABRICIO, GIOVANA');
  });

  test('lista equipe com membros e motivos', () => {
    const sugestoes = [criarSugestao()];
    const md = gerarJustificativa(sugestoes, {});

    expect(md).toContain('### Equipe: FABRICIO, JESSE, JESSIE, BERNARDO, ALEX');
    expect(md).toContain('- FABRICIO: menor score entre 12 candidato(s)');
    expect(md).toContain('- JESSE: par sempre_junto (JESSE↔JESSIE)');
  });

  test('lista MM com motivo', () => {
    const sugestoes = [criarSugestao()];
    const md = gerarJustificativa(sugestoes, {});

    expect(md).toContain('### MM Domingo: RONI');
    expect(md).toContain('- RONI: menor score entre 5 candidato(s)');
  });

  test('lista exclusões com motivo', () => {
    const sugestoes = [criarSugestao()];
    const md = gerarJustificativa(sugestoes, {});

    expect(md).toContain('### Exclusões:');
    expect(md).toContain('- YASSER: parceiro(a) LIDIANE indisponível (sempre_junto)');
  });

  test('P6: cada nome no rascunho aparece na justificativa', () => {
    const sugestao = criarSugestao();
    const sugestoes = [sugestao];
    const justificativaMd = gerarJustificativa(sugestoes, {});

    // Nomes no rascunho (regente + equipe + mm)
    const nomesRascunho = [
      sugestao.regente.nome,
      ...sugestao.equipe.map((p) => p.nome),
      ...sugestao.mm.map((p) => p.nome),
    ];

    for (const nome of nomesRascunho) {
      expect(justificativaMd).toContain(nome);
    }
  });

  test('retorna mensagem padrão para array vazio', () => {
    const md = gerarJustificativa([], {});
    expect(md).toContain('Nenhuma sugestão gerada');
  });

  test('pula cultos sem justificativas (quartas-feiras)', () => {
    const quartaFeira = criarSugestao({
      data: '2026-07-02',
      dia_semana: 'quarta-feira',
      regente: null,
      equipe: [],
      mm: [],
      justificativas: [],
    });
    const md = gerarJustificativa([quartaFeira], {});

    expect(md).not.toContain('02/07/2026');
  });

  test('inclui avisos quando presentes', () => {
    const sugestao = criarSugestao();
    sugestao.justificativas.push({
      tipo: 'aviso',
      data: '2026-07-05',
      mensagem: 'RF001: equipe sem homem — impossível atender com candidatos disponíveis',
    });

    const md = gerarJustificativa([sugestao], {});
    expect(md).toContain('### Avisos:');
    expect(md).toContain('RF001: equipe sem homem');
  });

  test('determinismo: mesmo input gera mesmo output', () => {
    const sugestoes = [criarSugestao()];
    const md1 = gerarJustificativa(sugestoes, {});
    const md2 = gerarJustificativa(sugestoes, {});
    expect(md1).toBe(md2);
  });

  test('MM ES e MM Culto no sábado', () => {
    const sugestao = criarSugestao({
      data: '2026-07-11',
      dia_semana: 'sabado',
      mm: [pessoaFixa(8, 'JEMELLI'), pessoaFixa(9, 'VONI')],
      justificativas: [
        {
          tipo: 'escolha',
          data: '2026-07-11',
          slot: 'MM_ES',
          pessoa: { id: 8, nome: 'JEMELLI' },
          motivo: 'menor score entre 5 candidato(s)',
          candidatos_avaliados: ['JEMELLI', 'VONI', 'RONI'],
        },
        {
          tipo: 'escolha',
          data: '2026-07-11',
          slot: 'MM_CULTO',
          pessoa: { id: 9, nome: 'VONI' },
          motivo: 'menor score entre 4 candidato(s)',
          candidatos_avaliados: ['VONI', 'RONI', 'ALEX'],
        },
      ],
    });

    const md = gerarJustificativa([sugestao], {});

    expect(md).toContain('### MM ES: JEMELLI');
    expect(md).toContain('### MM Culto: VONI');
  });
});
