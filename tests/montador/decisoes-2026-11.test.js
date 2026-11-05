// Decisões do diretor de 05/11/2026 para o montador (ferramenta do sucessor):
//  1. dependências (precisa_de) passam a valer na validação;
//  2. fundamentais e vínculos com nível editável (bloqueio na validação);
//  3. campos do cadastro que a tela não edita (incentivo) não se perdem;
//  4. limite de escalas no mês no cadastro (limite_mensal);
//  5. culto departamental copiado do ancionato (louvor_departamento);
//  6. convidado precisa de contato (próprio ou de pessoa já cadastrada);
//  8. exceção a uma regra confirmada pelo diretor.
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { criarEstadoMes, avaliarAtribuicao } from '../../montador/lib/avaliacao.mjs';
import { validarEscala, candidatosParaCelula } from '../../montador/lib/regras.mjs';
import { departamentoDoCulto, tipoDoCulto, tipoDaLinhaAtual } from '../../montador/lib/contexto.mjs';
import {
  ehExcecionavel,
  marcarExcecionaveis,
  separarExcecoes,
  registroExcecoes,
} from '../../montador/lib/excecoes.mjs';
import { linhaLog } from '../../montador/lib/fechamento.mjs';
import { conferirLinks } from '../../montador/lib/conferencia.mjs';
import { salvarPessoa, verificarPessoa } from '../../montador/lib/pessoas.mjs';
import { lerAcionato, salvarAcionato, validarAcionato } from '../../montador/lib/insumos.mjs';
import { pessoasAtivasParaSlot } from '../../scripts/lib/solver-filtros.js';
import { PARAMETROS_PADRAO } from '../../scripts/lib/parametros.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pessoa(id, over = {}) {
  return {
    id,
    nome: over.nome || `P${id}`,
    genero: over.genero || 'M',
    ativo: true,
    perfil_canto: 'base',
    habilitacoes: { regente: true, equipe: true, mensagem_musical: { es: true, culto: true, domingo: true } },
    afastado: null,
    vinculos: over.vinculos || [],
    dias_permitidos: over.dias_permitidos === undefined ? null : over.dias_permitidos,
    ...(over.limite_mensal != null ? { limite_mensal: over.limite_mensal } : {}),
  };
}

function montarBase(pessoas, parametros) {
  const porId = new Map(pessoas.map((p) => [p.id, p]));
  const porNome = new Map(pessoas.map((p) => [p.nome, p]));
  return {
    cadastro: { pessoas, porId, porNome, grupos: new Map() },
    grupos: new Map(),
    indisponibilidade: { datas: [], indisponiveis_mes_inteiro: { ids: [] } },
    historico: new Map(),
    parametros: parametros || JSON.parse(JSON.stringify(PARAMETROS_PADRAO)),
  };
}

function comNivel(chave, nivel) {
  const p = JSON.parse(JSON.stringify(PARAMETROS_PADRAO));
  p.regras[chave] = { ...p.regras[chave], ativa: true, nivel };
  return p;
}

const domingo = (data, equipe, extra = {}) => ({
  data,
  dia_semana: 'domingo',
  modelo_louvor: 'domingo',
  tipo: 'louvor',
  slots: ['regente', 'equipe', 'mm_domingo'],
  regente: null,
  equipe,
  mm: {},
  ...extra,
});

// ---------------------------------------------------------------------------
// 1 e 2. Vínculo: lembrete na escolha, nível de parametros.json na validação
// ---------------------------------------------------------------------------

describe('vínculo (precisa_de) com nível editável', () => {
  const manu = pessoa(1, { nome: 'MANU C.', genero: 'F', vinculos: [{ tipo: 'precisa_de', com_ids: [2] }] });
  const silvana = pessoa(2, { nome: 'SILVANA', genero: 'F' });
  const outro = pessoa(3, { nome: 'ALEX' });

  test('na escolha é só aviso, mesmo com nível bloqueio (o par ainda pode vir depois)', () => {
    const base = montarBase([manu, silvana, outro], comNivel('vinculo', 'bloqueio'));
    const estado = criarEstadoMes(base, [domingo('2026-11-08', [3])]);
    const r = avaliarAtribuicao(base, estado, '2026-11-08', 'equipe', 1);
    expect(r.bloqueios.some((m) => m.chave === 'vinculo')).toBe(false);
    expect(r.avisos.some((m) => m.chave === 'vinculo')).toBe(true);
  });

  test('na validação segue o nível: bloqueio impede, aviso só alerta', () => {
    const cultos = [domingo('2026-11-08', [1, 3])];
    const bloq = validarEscala(montarBase([manu, silvana, outro], comNivel('vinculo', 'bloqueio')), cultos);
    expect(bloq.erros.some((e) => e.chave === 'vinculo' && e.pessoaId === 1)).toBe(true);

    const av = validarEscala(montarBase([manu, silvana, outro], comNivel('vinculo', 'aviso')), cultos);
    expect(av.erros.some((e) => e.chave === 'vinculo')).toBe(false);
    expect(av.avisos.some((e) => e.chave === 'vinculo')).toBe(true);
  });

  test('com a pessoa de que depende no culto, não há motivo', () => {
    const base = montarBase([manu, silvana, outro], comNivel('vinculo', 'bloqueio'));
    const r = validarEscala(base, [domingo('2026-11-08', [1, 2, 3])]);
    expect([...r.erros, ...r.avisos].some((e) => e.chave === 'vinculo')).toBe(false);
  });

  test('regra desligada na tela de regras não confere o vínculo', () => {
    const par = JSON.parse(JSON.stringify(PARAMETROS_PADRAO));
    par.regras.vinculo.ativa = false;
    const r = validarEscala(montarBase([manu, silvana, outro], par), [domingo('2026-11-08', [1, 3])]);
    expect([...r.erros, ...r.avisos].some((e) => e.chave === 'vinculo')).toBe(false);
  });

  test('parametros.json do repositório trata vínculo como bloqueio', () => {
    const repo = JSON.parse(readFileSync(resolve(process.cwd(), 'processos/regras/parametros.json'), 'utf8'));
    expect(repo.regras.vinculo.nivel).toBe('bloqueio');
    for (const chave of ['minimo_homens', 'mm_por_mes', 'conflito_pregador', 'equipe_e_mm_mesmo_culto', 'equipe_incompleta']) {
      expect(repo.regras[chave].nivel).toBe('bloqueio');
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Limite de escalas no mês (cadastro)
// ---------------------------------------------------------------------------

describe('limite_mensal do cadastro', () => {
  const mirian = pessoa(1, { nome: 'MIRIAN', genero: 'F', limite_mensal: 1 });
  const alex = pessoa(2, { nome: 'ALEX' });

  test('avisa quando a pessoa já está em outro culto do mês', () => {
    const base = montarBase([mirian, alex]);
    const cultos = [domingo('2026-11-08', [1]), domingo('2026-11-15', [])];
    const estado = criarEstadoMes(base, cultos);
    const r = avaliarAtribuicao(base, estado, '2026-11-15', 'equipe', 1);
    expect(r.avisos.some((m) => m.chave === 'limite_mensal')).toBe(true);
    // O próprio culto não conta.
    const r2 = avaliarAtribuicao(base, estado, '2026-11-08', 'equipe', 1);
    expect([...r2.avisos, ...r2.bloqueios].some((m) => m.chave === 'limite_mensal')).toBe(false);
  });

  test('parametros.json antigo sem a regra ainda avisa', () => {
    const par = JSON.parse(JSON.stringify(PARAMETROS_PADRAO));
    delete par.regras.limite_mensal;
    const base = montarBase([mirian, alex], par);
    const estado = criarEstadoMes(base, [domingo('2026-11-08', [1]), domingo('2026-11-15', [])]);
    const r = avaliarAtribuicao(base, estado, '2026-11-15', 'equipe', 1);
    expect(r.avisos.some((m) => m.chave === 'limite_mensal')).toBe(true);
  });

  test('a sugestão automática não passa do limite', () => {
    const cadastro = { pessoas: [mirian, alex], porId: new Map([[1, mirian], [2, alex]]) };
    const contexto = {
      pessoas: cadastro,
      indisponibilidade: { datas: [], indisponiveis_mes_inteiro: { ids: [] } },
      historico: new Map(),
      parametros: JSON.parse(JSON.stringify(PARAMETROS_PADRAO)),
      escaladosNesteMes: new Map(),
      escaladosPorCulto: new Map([['2026-11-08', new Set([1])]]),
      externosPorCulto: new Map(),
    };
    const ids = pessoasAtivasParaSlot('equipe', '2026-11-15', contexto).map((p) => p.id);
    expect(ids).toContain(2);
    expect(ids).not.toContain(1);
  });
});

// ---------------------------------------------------------------------------
// 5. Culto departamental copiado do ancionato
// ---------------------------------------------------------------------------

describe('culto departamental', () => {
  test('campo explícito vale mais que o pregador', () => {
    // 31/10/2026: Quarteto pregou, nossa equipe cantou.
    const quarteto = { dia_semana: 'sabado', modelo_louvor: 'sabado', pregador: 'QUARTETO', louvor_departamento: '' };
    expect(departamentoDoCulto(quarteto)).toBe('');
    expect(tipoDoCulto(quarteto)).toBe('louvor');
    // 10/10/2026: PR. HOFNI pregou, Jovens assumiram o louvor.
    const jovens = { dia_semana: 'sabado', modelo_louvor: 'sabado', pregador: 'PR. HOFNI', louvor_departamento: 'jovens' };
    expect(departamentoDoCulto(jovens)).toBe('JOVENS');
    expect(tipoDoCulto(jovens)).toBe('departamental');
  });

  test('acionato antigo, sem o campo, usa a regra pelo pregador', () => {
    expect(tipoDoCulto({ dia_semana: 'sabado', pregador: 'JOVENS' })).toBe('departamental');
    expect(tipoDoCulto({ dia_semana: 'sabado', pregador: 'PR. HOFNI' })).toBe('louvor');
  });

  test('linha publicada: regente com nome de departamento define o culto', () => {
    expect(tipoDaLinhaAtual({ 'DIA SEMANA': 'sábado', PREGADOR: 'PR. HOFNI', 'REGENTE LOUVOR': 'JOVENS' })).toBe('departamental');
    expect(tipoDaLinhaAtual({ 'DIA SEMANA': 'sábado', PREGADOR: 'QUARTETO', 'REGENTE LOUVOR': 'SUELLEN' })).toBe('louvor');
    expect(tipoDaLinhaAtual({ 'DIA SEMANA': 'sábado', PREGADOR: 'JOVENS', 'REGENTE LOUVOR': '' })).toBe('departamental');
  });

  test('acionato grava o campo e recusa departamento fora da lista', () => {
    const root = mkdtempSync(resolve(tmpdir(), 'escala-acionato-'));
    try {
      const itens = [
        { data: '2026-11-07', dia: 'sabado', pregador: 'PR. MAURICI', modelo_louvor: 'sabado', louvor_departamento: 'jovens' },
        { data: '2026-11-08', dia: 'domingo', pregador: 'JOVENS', modelo_louvor: 'domingo', louvor_departamento: '' },
      ];
      salvarAcionato('2026-11', { itens }, { root });
      const lido = lerAcionato('2026-11', { root });
      expect(lido.itens.map((i) => i.louvor_departamento)).toEqual(['JOVENS', '']);
      expect(validarAcionato('2026-11', { itens: [{ ...itens[0], louvor_departamento: 'CORAL X' }] }).join(' ')).toMatch(
        /não está na lista/,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// 8. Exceção confirmada pelo diretor
// ---------------------------------------------------------------------------

describe('exceção do diretor', () => {
  const regra = { id: 'dias_permitidos|2026-10-18|equipe|32', chave: 'dias_permitidos', nivel: 'bloqueio', texto: 'só sábado' };
  const semTel = { id: 'sem_telefone|x', chave: 'sem_telefone', nivel: 'bloqueio', texto: 'sem telefone' };
  const fora = { id: 'fora_do_cadastro|x', chave: 'fora_do_cadastro', nivel: 'bloqueio', texto: 'fora' };
  const link = { id: 'conferencia_x', chave: 'conferencia_link', nivel: 'bloqueio', texto: 'link' };

  test('só bloqueios de regra aceitam exceção', () => {
    expect(ehExcecionavel(regra)).toBe(true);
    for (const e of [semTel, fora, link]) expect(ehExcecionavel(e)).toBe(false);
    expect(ehExcecionavel({ id: 'regente_vazio|2026-11-08', chave: 'regente_vazio', nivel: 'bloqueio' })).toBe(false);
    // Culto da Mulher (exceção da RF001) e equipe com 4 podem ser liberados.
    expect(ehExcecionavel({ id: 'minimo_homens|2026-11-08', chave: 'minimo_homens', nivel: 'bloqueio' })).toBe(true);
    expect(ehExcecionavel({ id: 'equipe_incompleta|2026-11-08', chave: 'equipe_incompleta', nivel: 'bloqueio' })).toBe(true);
    const marcados = marcarExcecionaveis([regra, semTel]);
    expect(marcados[0].excecionavel).toBe(true);
    expect(marcados[1].excecionavel).toBeUndefined();
  });

  test('erro confirmado sai dos pendentes; erro sem exceção possível continua', () => {
    const erros = marcarExcecionaveis([regra, semTel]);
    const { pendentes, confirmadas } = separarExcecoes(erros, [regra.id, semTel.id]);
    expect(confirmadas.map((e) => e.id)).toEqual([regra.id]);
    expect(pendentes.map((e) => e.id)).toEqual([semTel.id]);
  });

  test('registro de exceções só cresce e fica fora do site', () => {
    const root = mkdtempSync(resolve(tmpdir(), 'escala-excecao-'));
    try {
      const agora = new Date('2026-11-05T12:00:00Z');
      const r1 = registroExcecoes('2026-11', [regra], { root, autor: 'Natan', agora });
      expect(r1.rel).toBe('escalas/2026/11/excecoes.json');
      mkdirSync(resolve(root, 'escalas/2026/11'), { recursive: true });
      writeFileSync(resolve(root, r1.rel), JSON.stringify(r1.dados));
      const r2 = registroExcecoes('2026-11', [regra], { root, autor: 'Natan', agora, origem: 'ajuste' });
      expect(r2.dados.excecoes).toHaveLength(2);
      expect(r2.dados.excecoes[0]).toMatchObject({ regra: 'dias_permitidos', confirmado_por: 'Natan', origem: 'fechamento' });
      expect(registroExcecoes('2026-11', [], { root })).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('log da publicação cita as exceções', () => {
    const agora = new Date('2026-11-05T12:00:00Z');
    expect(linhaLog('2026-11', 'Natan', agora)).not.toMatch(/exceção/);
    expect(linhaLog('2026-11', 'Natan', agora, 2)).toMatch(/2 exceção\(ões\) confirmada\(s\).*escalas\/2026\/11\/excecoes\.json/);
  });

  test('não elegível traz os bloqueios para o diretor escolher como exceção', () => {
    const juliana = pessoa(32, { nome: 'JULIANA ALVES', genero: 'F', dias_permitidos: ['sabado'] });
    const base = montarBase([juliana, pessoa(2)]);
    const { naoElegiveis } = candidatosParaCelula(base, [domingo('2026-10-18', [])], '2026-10-18', 'equipe');
    const item = naoElegiveis.find((c) => c.id === 32);
    expect(item.bloqueios.map((b) => b.chave)).toContain('dias_permitidos');
  });
});

// ---------------------------------------------------------------------------
// Conferência de links: escala externa escrita pelo apelido
// ---------------------------------------------------------------------------

describe('conferência de links com apelido na sonoplastia', () => {
  test('"JÚNIOR OLIVEIRA" (apelido de ENOQUE JR.) não é link de outra pessoa', () => {
    const enoque = { ...pessoa(74, { nome: 'ENOQUE JR.' }), aliases: ['JÚNIOR OLIVEIRA'], telefone: '554399053835' };
    const base = montarBase([enoque]);
    const contatos = { 'ENOQUE JR.': { telefone: 'https://wa.me/554399053835', apelidos: ['JÚNIOR OLIVEIRA'] } };
    const linha = { DATA: '21/11/2026', AUDIOVISUAL: 'JÚNIOR OLIVEIRA' };
    expect(conferirLinks([linha], contatos, base).erros).toEqual([]);
    // Apelido que aponta para outro número continua sendo erro.
    const outro = { 'ENOQUE JR.': { telefone: 'https://wa.me/554300000000', apelidos: ['JÚNIOR OLIVEIRA'] } };
    expect(conferirLinks([linha], outro, base).erros.map((e) => e.chave)).toContain('conferencia_link_de_outra_pessoa');
  });
});

// ---------------------------------------------------------------------------
// 3 e 6. Cadastro: campos preservados e contato via outra pessoa
// ---------------------------------------------------------------------------

describe('cadastro pela tela', () => {
  function criarRaiz() {
    const root = mkdtempSync(resolve(tmpdir(), 'escala-pessoas-'));
    const base = (id, nome, telefone, extra = {}) => ({
      id,
      nome,
      aliases: [],
      telefone,
      genero: 'F',
      ativo: true,
      perfil_canto: 'base',
      notas: '',
      habilitacoes: { regente: false, equipe: true, mensagem_musical: { es: false, culto: false, domingo: false } },
      afastado: null,
      vinculos: [],
      dias_permitidos: null,
      ...extra,
    });
    const arquivo = {
      versao: '1.0.0',
      proximo_id: 3,
      grupos: {},
      pessoas: [
        base(1, 'CARLA', '5543999890085'),
        base(2, 'ROSANA', '5543999063257', { incentivo: { ativo: true, intervalo_meses: 1.5 } }),
      ],
    };
    writeFileSync(resolve(root, 'pessoas.json'), `${JSON.stringify(arquivo, null, 2)}\n`);
    writeFileSync(resolve(root, 'contatos.json'), '{}\n');
    return root;
  }
  const ler = (root) => JSON.parse(readFileSync(resolve(root, 'pessoas.json'), 'utf8'));

  test('editar pela tela mantém o incentivo e grava o limite mensal', () => {
    const root = criarRaiz();
    try {
      const rosana = ler(root).pessoas.find((p) => p.id === 2);
      const { incentivo: _fora, ...daTela } = rosana; // a tela não manda o incentivo
      salvarPessoa({ ...daTela, notas: 'editada', limite_mensal: '1' }, { id: 2, root });
      const salva = ler(root).pessoas.find((p) => p.id === 2);
      expect(salva.incentivo).toEqual({ ativo: true, intervalo_meses: 1.5 });
      expect(salva.limite_mensal).toBe(1);
      expect(salva.notas).toBe('editada');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('limite mensal inválido é recusado', () => {
    const root = criarRaiz();
    try {
      const { erros } = verificarPessoa({ nome: 'NOVA', telefone: '', limite_mensal: 0 }, null, { root });
      expect(erros.join(' ')).toMatch(/Máximo de escalas no mês/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('convidada com o WhatsApp de outra pessoa: copia o número sem pedir confirmação', () => {
    const root = criarRaiz();
    try {
      const { pessoa: lilian } = salvarPessoa(
        { nome: 'LILIAN', telefone: '', contato_via_id: 1, genero: 'F', habilitacoes: { mensagem_musical: { es: true, culto: true } } },
        { root },
      );
      expect(lilian.telefone).toBe('5543999890085');
      expect(lilian.contato_via_id).toBe(1);

      // A Carla troca de número: a Lilian acompanha.
      const carla = ler(root).pessoas.find((p) => p.id === 1);
      salvarPessoa({ ...carla, telefone: '5543988887777' }, { id: 1, root, confirmacaoTelefone: true });
      expect(ler(root).pessoas.find((p) => p.nome === 'LILIAN').telefone).toBe('5543988887777');

      // Voltar para telefone próprio desfaz o vínculo.
      const lil = ler(root).pessoas.find((p) => p.nome === 'LILIAN');
      salvarPessoa({ ...lil, contato_via_id: null, telefone: '5543977776666' }, { id: lil.id, root, confirmacaoTelefone: true });
      const final = ler(root).pessoas.find((p) => p.nome === 'LILIAN');
      expect(final.contato_via_id).toBeUndefined();
      expect(final.telefone).toBe('5543977776666');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('contato via pessoa sem telefone é recusado', () => {
    const root = criarRaiz();
    try {
      const arquivo = ler(root);
      arquivo.pessoas[0].telefone = '';
      writeFileSync(resolve(root, 'pessoas.json'), JSON.stringify(arquivo));
      expect(() => salvarPessoa({ nome: 'LILIAN', contato_via_id: 1 }, { root })).toThrow(/não tem telefone/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
