// Camada de regras do montador: REUSA a lógica já existente do projeto
// (solver-filtros, solver-score, solver-selecao, solver-historico, cadastro)
// e expõe funções focadas na interface de montagem:
//
//  - carregarContexto(mes): monta pessoas + indisponibilidade vinculada +
//    histórico + cultos do mês (vazios), pronto para a UI.
//  - candidatosParaCelula(...): quem PODE entrar numa célula (regente/equipe/MM)
//    de um culto, já respeitando indisponibilidade (enquete), habilitação, dias
//    permitidos, escala externa, e a exclusão mútua MM<->equipe<->regente no
//    mesmo culto (RF019 + regra implementada no solver).
//  - sugerirMes(...): roda o solver oficial para preencher a escala toda.
//  - validarEscala(...): aplica as regras duras sobre a escala montada e
//    devolve erros/avisos legíveis.
//
// Nada de regra nova é inventado aqui: as decisões vêm dos módulos de scripts/lib.

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { carregarPessoas } from '../../scripts/lib/cadastro.js';
import { carregarHistorico } from '../../scripts/lib/solver-historico.js';
import { pessoasAtivasParaSlot, diaDaSemana } from '../../scripts/lib/solver-filtros.js';
import { sortByScore } from '../../scripts/lib/solver-score.js';
import { sugerirCulto } from '../../scripts/lib/solver-selecao.js';
import {
  carregarParametros,
  PARAMETROS_PADRAO,
  nivel as nivelDe,
  valorRegra as valorRegraDe,
} from '../../scripts/lib/parametros.js';
import { gruposEscalaveis } from './grupos.mjs';
import {
  criarEstadoMes,
  avaliarAtribuicao,
  avaliarCulto,
  resolverOcupante,
} from './avaliacao.mjs';
import { slotsDoCulto, tipoDoCulto, ehOcupanteGrupo } from './contexto.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(__dirname, '../..');

/** Departamentos reconhecidos (RF015) — louvor assumido pelo departamento. */
export const DEPARTAMENTOS = new Set([
  'JOVENS',
  'AVENTUREIROS',
  'DESBRAVADORES',
  'DORCAS',
  'M. MULHER',
  'QUARTETO',
  'MELHOR IDADE',
]);

/** Papéis/slots da célula de montagem. */
export const SLOTS = {
  regente: 'regente',
  equipe: 'equipe',
  mm_es: 'mm_es',
  mm_culto: 'mm_culto',
  mm_domingo: 'mm_domingo',
};

const TAMANHO_EQUIPE = 5;

function lerJSON(caminho, fallback = null) {
  if (!existsSync(caminho)) return fallback;
  try {
    return JSON.parse(readFileSync(caminho, 'utf8'));
  } catch {
    return fallback;
  }
}

function converterDataBR(dataBR) {
  const partes = String(dataBR || '').trim().split('/');
  if (partes.length !== 3) return null;
  const [dia, mes, ano] = partes;
  return `${ano}-${mes.padStart(2, '0')}-${dia.padStart(2, '0')}`;
}

function toBrDate(isoDate) {
  const [ano, mes, dia] = String(isoDate || '').split('-');
  if (!dia || !mes || !ano) return '';
  return `${dia}/${mes}/${ano}`;
}

function normalizarDiaSemana(dia) {
  return String(dia || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/** Coleta os caminhos de históricos antigos em old/AAAA/*.json. */
function coletarPathsOld(root = ROOT) {
  const paths = [];
  const oldBase = resolve(root, 'old');
  if (!existsSync(oldBase)) return paths;
  for (const anoDir of readdirSync(oldBase)) {
    // A pasta old/ guarda apenas históricos de escala por ano (ex.: old/2026).
    // Ignoramos qualquer subpasta que não seja de ano (ex.: backups de outras
    // coisas) para não tentar ler arquivos que não são arrays de cultos.
    if (!/^\d{4}$/.test(anoDir)) continue;
    const anoPath = resolve(oldBase, anoDir);
    try {
      for (const arq of readdirSync(anoPath)) {
        if (!arq.endsWith('.json')) continue;
        const full = resolve(anoPath, arq);
        // Defesa extra: só inclui arquivos cujo conteúdo é um array (formato de
        // histórico de escalas). Qualquer outro JSON é ignorado com segurança.
        try {
          const conteudo = JSON.parse(readFileSync(full, 'utf8'));
          if (Array.isArray(conteudo)) paths.push(full);
        } catch {
          /* arquivo ilegível/invalido: ignora */
        }
      }
    } catch {
      /* ignora diretório ilegível */
    }
  }
  return paths;
}

/** `true` quando o nome do pregador é um departamento (RF015). */
export function ehDepartamental(pregador) {
  if (!pregador) return false;
  const norm = String(pregador)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim();
  return DEPARTAMENTOS.has(norm);
}

function resolverExternoParaId(nome, porNome) {
  if (!nome || !nome.trim()) return null;
  const pessoa = porNome.get(nome.toUpperCase().trim());
  return pessoa ? pessoa.id : null;
}

/**
 * Deriva os cultos do mês. Prioriza o acionato do mês (insumos/acionato.json);
 * se não houver, extrai do atual.json filtrando o mês; e, por fim, gera o
 * calendário (quartas, sábados e domingos) do mês a partir do zero.
 */
export function cultosDoMes(mesAlvo, cadastro, root = ROOT) {
  const [ano, mes] = mesAlvo.split('-');
  const insumosDir = resolve(root, `escalas/${ano}/${mes}/insumos`);

  // Sonoplastia do mês (opcional): preenche audiovisual/suporte/sonoplastiaIds.
  const sonoplastiaPorData = lerSonoplastiaPorData(resolve(insumosDir, 'sonoplastia.json'), cadastro);

  function modeloPadrao(diaNorm) {
    if (diaNorm === 'sabado') return 'sabado';
    if (diaNorm === 'domingo') return 'domingo';
    return 'sem_louvor';
  }

  // 1) acionato.json (template {itens:[...]} ou array estilo atual.json)
  const acionato = lerJSON(resolve(insumosDir, 'acionato.json'));
  if (acionato) {
    const itens = Array.isArray(acionato) ? acionato : acionato.itens;
    if (Array.isArray(itens) && itens.length > 0) {
      return itens
        .map((item) => {
          const dataISO = item.data && item.data.includes('/') ? converterDataBR(item.data) : item.data;
          if (!dataISO || !dataISO.startsWith(mesAlvo)) return null;
          const diaNorm = normalizarDiaSemana(item.dia || item['DIA SEMANA'] || diaDaSemana(dataISO));
          const son = sonoplastiaPorData.get(dataISO) || {};
          const modeloLouvor =
            item.modelo_louvor && ['sabado', 'domingo', 'sem_louvor'].includes(item.modelo_louvor)
              ? item.modelo_louvor
              : modeloPadrao(diaNorm);
          return {
            data: dataISO,
            dia_semana: diaNorm,
            anciao: item.anciao || item['ANCIÃO'] || '',
            pregador: item.pregador || item.PREGADOR || '',
            audiovisual: son.audiovisual != null ? son.audiovisual : (item.audiovisual || item.AUDIOVISUAL || ''),
            suporte: son.suporte != null ? son.suporte : '-',
            sonoplastiaIds: son.sonoplastiaIds || [],
            obs: item.observacoes || item.OBS || '',
            modelo_louvor: modeloLouvor,
            extraordinario: item.extraordinario === true,
          };
        })
        .filter(Boolean)
        .sort((a, b) => a.data.localeCompare(b.data));
    }
  }

  // 2) gerar calendário do mês do zero (quartas, sábados, domingos)
  return gerarCalendarioMes(mesAlvo);
}

/**
 * Lê sonoplastia.json e indexa por data: { audiovisual (sonoplasta), suporte
 * (ou '-'), sonoplastiaIds (ids não nulos) }. Em arquivo sem `ids` (anterior ao
 * editor), resolve cada nome por nome/apelido do cadastro; texto livre fica sem
 * ID (não gera conflito).
 */
function lerSonoplastiaPorData(caminho, cadastro) {
  const mapa = new Map();
  const dados = lerJSON(caminho);
  if (!dados) return mapa;
  const itens = Array.isArray(dados) ? dados : dados.itens || [];
  const porNome = cadastro && cadastro.porNome ? cadastro.porNome : new Map();
  for (const item of itens) {
    if (!item || !item.data) continue;
    const nomes = Array.isArray(item.sonoplastia) ? item.sonoplastia : [];
    const idsArq = Array.isArray(item.ids) ? item.ids : null;
    const ids = [];
    for (let i = 0; i < nomes.length; i += 1) {
      const nome = nomes[i];
      if (nome == null || String(nome).trim() === '') {
        ids.push(null);
        continue;
      }
      if (idsArq) {
        ids.push(idsArq[i] != null ? idsArq[i] : null);
      } else {
        const pessoa = porNome.get(String(nome).toUpperCase().trim());
        ids.push(pessoa ? pessoa.id : null);
      }
    }
    const audiovisual = nomes[0] != null ? nomes[0] : '';
    const suporte = nomes[1] != null && String(nomes[1]).trim() !== '' ? nomes[1] : '-';
    const sonoplastiaIds = ids.filter((x) => x != null);
    mapa.set(item.data, { audiovisual, suporte, sonoplastiaIds });
  }
  return mapa;
}

/** Gera quartas, sábados e domingos do mês (cultos vazios). */
export function gerarCalendarioMes(mesAlvo) {
  const [ano, mes] = mesAlvo.split('-').map(Number);
  const cultos = [];
  const diasNoMes = new Date(ano, mes, 0).getDate();
  for (let dia = 1; dia <= diasNoMes; dia++) {
    const date = new Date(ano, mes - 1, dia);
    const dow = date.getDay(); // 0=domingo ... 6=sabado
    let diaNome = null;
    if (dow === 3) diaNome = 'quarta-feira';
    else if (dow === 6) diaNome = 'sabado';
    else if (dow === 0) diaNome = 'domingo';
    if (!diaNome) continue;
    const iso = `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
    cultos.push({ data: iso, dia_semana: diaNome, anciao: '', pregador: '', audiovisual: '' });
  }
  return cultos;
}

/**
 * Carrega todo o contexto de montagem do mês: cadastro, indisponibilidade
 * vinculada, histórico e cultos. Retorna também a lista de pessoas "ativas"
 * (para a UI listar) e o snapshot das regras.
 */
export function carregarContexto(mesAlvo, { root = ROOT } = {}) {
  // Quando root vem de fora (teste de regressão), pessoas.json está na fixture.
  const cadastro =
    root === ROOT ? carregarPessoas() : carregarPessoas(resolve(root, 'pessoas.json'));
  const [ano, mes] = mesAlvo.split('-');
  const insumosDir = resolve(root, `escalas/${ano}/${mes}/insumos`);

  const indisponibilidade =
    lerJSON(resolve(insumosDir, 'indisponibilidade-cantores-vinculada.json')) || {
      datas: [],
      indisponiveis_mes_inteiro: { ids: [], nomes: [] },
    };

  // Parâmetros executáveis das regras (ausente/inválido → padrão + aviso).
  const { parametros, avisos: avisosParametros } = carregarParametros(
    resolve(root, 'processos/regras/parametros.json'),
  );

  const janelaMeses = (parametros.historico && parametros.historico.janela_meses) || 4;
  const historico = carregarHistorico(
    cadastro,
    coletarPathsOld(root),
    resolve(root, 'atual.json'),
    janelaMeses,
  );
  const cultos = cultosDoMes(mesAlvo, cadastro, root);

  // Grupos escaláveis do cadastro (para avaliação de 'grupo:<chave>').
  const arquivoPessoas =
    root === ROOT
      ? lerJSON(resolve(ROOT, 'pessoas.json'), { grupos: {} })
      : lerJSON(resolve(root, 'pessoas.json'), { grupos: {} });
  const grupos = gruposEscalaveis(arquivoPessoas || { grupos: {} });

  return {
    cadastro,
    grupos,
    indisponibilidade,
    historico,
    cultos,
    mesAlvo,
    parametros,
    avisosParametros,
  };
}

/**
 * Constrói o contexto no formato que o solver/filtros esperam, a partir do
 * estado atual da escala em montagem (para que a elegibilidade considere quem
 * já foi colocado em cada culto).
 *
 * @param {object} base - { cadastro, indisponibilidade, historico }
 * @param {object} culto - { data, dia_semana, anciao, pregador, audiovisual }
 * @param {object} atribuicoesCulto - { regente, equipe:[], mm:[] } com nomes/ids já escolhidos
 */
function montarContextoSolver(base, culto, atribuicoesCulto) {
  const contexto = {
    pessoas: base.cadastro,
    indisponibilidade: base.indisponibilidade,
    historico: base.historico,
    parametros: base.parametros || PARAMETROS_PADRAO,
    escaladosNesteMes: base.escaladosNesteMes || new Map(),
    escaladosPorCulto: new Map(),
    externosPorCulto: new Map(),
    dataAnterior: base.dataAnterior || null,
    grupoPreferencialRegente: null,
  };

  // Externos deste culto (audiovisual/pregador, exceto ancião).
  const externos = { audiovisual: [], pregador: [] };
  if (Array.isArray(culto.sonoplastiaIds) && culto.sonoplastiaIds.length > 0) {
    for (const id of culto.sonoplastiaIds) if (id != null) externos.audiovisual.push(id);
  } else {
    const avId = resolverExternoParaId(culto.audiovisual, base.cadastro.porNome);
    if (avId) externos.audiovisual.push(avId);
  }
  const pregId = resolverExternoParaId(culto.pregador, base.cadastro.porNome);
  if (pregId && !ehDepartamental(culto.pregador)) externos.pregador.push(pregId);
  contexto.externosPorCulto.set(culto.data, externos);

  // Quem já está escalado NESTE culto (para exclusão mútua MM<->equipe<->regente).
  const jaNoCulto = new Set();
  if (atribuicoesCulto) {
    for (const id of idsDeAtribuicoes(atribuicoesCulto, base.cadastro)) jaNoCulto.add(id);
  }
  contexto.escaladosPorCulto.set(culto.data, jaNoCulto);

  return contexto;
}

/** Resolve nomes/ids de uma estrutura de atribuição para um Set de ids. */
function idsDeAtribuicoes(atrib, cadastro) {
  const ids = new Set();
  const add = (valor) => {
    if (valor == null || valor === '') return;
    if (typeof valor === 'number') {
      ids.add(valor);
      return;
    }
    const pessoa = cadastro.porNome.get(String(valor).toUpperCase().trim());
    if (pessoa) ids.add(pessoa.id);
  };
  add(atrib.regente);
  for (const e of atrib.equipe || []) add(e);
  for (const m of atrib.mm || []) add(m);
  return ids;
}

/** Encontra o culto (por data) na lista de cultos da escala do mês. */
function acharCulto(cultos, data) {
  return (Array.isArray(cultos) ? cultos : []).find((c) => c.data === data) || null;
}

/**
 * Constrói um contexto de ordenação por score a partir da escala do mês inteira
 * (quem já está escalado em cada culto e no mês), para ordenar os elegíveis.
 */
function contextoOrdenacao(base, cultos, dataAlvo) {
  const cadastro = base.cadastro;
  const contexto = {
    pessoas: cadastro,
    indisponibilidade: base.indisponibilidade,
    historico: base.historico,
    parametros: base.parametros || PARAMETROS_PADRAO,
    escaladosNesteMes: new Map(),
    escaladosPorCulto: new Map(),
    externosPorCulto: new Map(),
    dataAnterior: null,
    grupoPreferencialRegente: null,
  };

  const idDe = (valor) => {
    if (valor == null || valor === '') return null;
    if (typeof valor === 'number') return valor;
    if (typeof valor === 'string' && valor.startsWith('grupo:')) return null;
    const p = cadastro.porNome.get(String(valor).toUpperCase().trim());
    return p ? p.id : null;
  };

  const ordenados = [...(cultos || [])].sort((a, b) => String(a.data).localeCompare(String(b.data)));
  for (const culto of ordenados) {
    const ids = new Set();
    const addMes = (id, slot) => {
      if (id == null) return;
      ids.add(id);
      if (!contexto.escaladosNesteMes.has(id)) {
        contexto.escaladosNesteMes.set(id, { slots: new Set(), count: 0 });
      }
      const e = contexto.escaladosNesteMes.get(id);
      e.slots.add(slot);
      e.count += 1;
    };
    addMes(idDe(culto.regente), 'regente');
    for (const v of culto.equipe || []) addMes(idDe(v), 'equipe');
    const mm = culto.mm || {};
    for (const slot of Object.keys(mm)) addMes(idDe(mm[slot]), slot);
    contexto.escaladosPorCulto.set(culto.data, ids);
    if (culto.data < dataAlvo) contexto.dataAnterior = culto.data;
  }
  return contexto;
}

/**
 * Retorna os candidatos de uma célula (data, slot) separados em três grupos:
 *  - elegiveis: sem bloqueio e sem aviso (pessoas por score; grupos ao fim);
 *  - elegiveisComAviso: só avisos (com os textos dos avisos);
 *  - naoElegiveis: com bloqueio (motivoBloqueio = texto do primeiro bloqueio).
 *
 * A escala do mês inteira é passada para que a avaliação considere quem já está
 * escalado em cada culto.
 *
 * @param {object} base - contexto de carregarContexto
 * @param {object[]} cultos - escala do mês (CultoMontagem[])
 * @param {string} data - ISO
 * @param {string} slot
 * @param {object} [opts] - { excluir?: number|string } (ocupante a desconsiderar)
 * @returns {{ elegiveis: object[], elegiveisComAviso: object[], naoElegiveis: object[] }}
 */
export function candidatosParaCelula(base, cultos, data, slot, opts = {}) {
  const excluir = opts.excluir != null ? opts.excluir : null;
  const estado = criarEstadoMes(base, cultos);
  const culto = acharCulto(cultos, data) || { data };
  const contextoScore = contextoOrdenacao(base, cultos, data);

  const elegiveis = [];
  const elegiveisComAviso = [];
  const naoElegiveis = [];

  // Pessoas ativas.
  const pessoasAtivas = base.cadastro.pessoas.filter((p) => p.ativo);
  const infoPessoa = new Map();
  for (const p of pessoasAtivas) {
    if (excluir != null && p.id === excluir) continue;
    const { bloqueios, avisos } = avaliarAtribuicao(base, estado, data, slot, p.id);
    infoPessoa.set(p.id, { p, bloqueios, avisos });
  }

  // Ordena os elegíveis (sem bloqueio) por score usando o solver.
  const elegiveisBrutos = [];
  for (const { p, bloqueios } of infoPessoa.values()) {
    if (bloqueios.length === 0) elegiveisBrutos.push(p);
  }
  let ordenados = elegiveisBrutos;
  try {
    ordenados = sortByScore(elegiveisBrutos, slot, data, contextoScore);
  } catch {
    ordenados = elegiveisBrutos;
  }

  const comum = (p, posicao, avisos) => ({
    tipo: 'pessoa',
    id: p.id,
    nome: p.nome,
    genero: p.genero,
    perfil_canto: p.perfil_canto,
    ...resumoHistorico(base.historico, p.id, slot),
    porque: motivoSugestao(p, posicao, base.historico, slot),
    avisos: avisos.map((m) => m.texto),
  });

  let pos = 0;
  for (const p of ordenados) {
    const { avisos } = infoPessoa.get(p.id);
    if (avisos.length === 0) elegiveis.push(comum(p, pos, avisos));
    else elegiveisComAviso.push(comum(p, pos, avisos));
    pos += 1;
  }

  // Não elegíveis (bloqueio) — só pessoas habilitadas para o slot (não poluir).
  for (const { p, bloqueios } of infoPessoa.values()) {
    if (bloqueios.length === 0) continue;
    // Ignora quem nem é habilitada (não interessa listar).
    if (bloqueios.length === 1 && bloqueios[0].chave === 'habilitacao') continue;
    naoElegiveis.push({
      tipo: 'pessoa',
      id: p.id,
      nome: p.nome,
      genero: p.genero,
      motivoBloqueio: bloqueios[0].texto,
    });
  }
  naoElegiveis.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

  // Grupos escaláveis com o slot em funcoes, ao fim de cada seção.
  const grupos = base.grupos || new Map();
  for (const [chave, g] of grupos.entries()) {
    const ocupante = `grupo:${chave}`;
    if (excluir != null && excluir === ocupante) continue;
    const { bloqueios, avisos } = avaliarAtribuicao(base, estado, data, slot, ocupante);
    const item = {
      tipo: 'grupo',
      chave,
      nome: g.nome_exibicao,
      avisos: avisos.map((m) => m.texto),
    };
    if (bloqueios.length > 0) {
      if (bloqueios.length === 1 && bloqueios[0].chave === 'habilitacao') continue;
      naoElegiveis.push({ tipo: 'grupo', chave, nome: g.nome_exibicao, motivoBloqueio: bloqueios[0].texto });
    } else if (avisos.length > 0) {
      elegiveisComAviso.push(item);
    } else {
      elegiveis.push(item);
    }
  }

  return { elegiveis, elegiveisComAviso, naoElegiveis };
}

/**
 * Substitutos para (data, slot): mesmas regras de candidatosParaCelula, sem a
 * pessoa/ocupante atualmente escalado.
 */
export function candidatosSubstitutos(base, cultos, data, slot, pessoaId) {
  return candidatosParaCelula(base, cultos, data, slot, { excluir: pessoaId });
}

/** Resumo do histórico recente de uma pessoa para o slot (contagem + datas). */
function resumoHistorico(historico, id, slot) {
  const h = historico?.get(id);
  if (!h) return { historicoCount: 0, historicoDatas: [] };
  let count = 0;
  if (slot === 'regente') count = h.regencias || 0;
  else if (slot === 'equipe') count = h.escalas_equipe || 0;
  else count = (h.mm_es || 0) + (h.mm_culto || 0) + (h.mm_domingo || 0);
  const datas = (h.datas_escalado || []).slice(-3).map((iso) => {
    const [, m, d] = iso.split('-');
    return `${d}/${m}`;
  });
  return { historicoCount: count, historicoDatas: datas };
}

/** Motivo curto do porquê a pessoa é sugerida (para o 1º da lista, sobretudo). */
function motivoSugestao(pessoa, posicao, historico, slot) {
  const h = historico?.get(pessoa.id);
  const total = h ? (h.regencias || 0) + (h.escalas_equipe || 0) + (h.mm_es || 0) + (h.mm_culto || 0) + (h.mm_domingo || 0) : 0;
  if (posicao === 0) {
    if (total === 0) return 'mais indicado — sem escalas recentes';
    return 'mais indicado — há mais tempo sem servir';
  }
  if (pessoa.perfil_canto === 'participacao') return 'participação (frequência baixa)';
  if (total === 0) return 'sem escalas recentes';
  return '';
}

/**
 * Determina por que uma pessoa NÃO é elegível para o slot/data. Retorna uma
 * frase curta ou null quando a pessoa simplesmente não faz essa função (aí nem
 * listamos, para não poluir).
 */
function motivoInelegivel(base, culto, slot, pessoa, atribuicoesCulto, contexto) {
  // Não habilitada para o slot → não interessa listar.
  const hab = pessoa.habilitacoes || {};
  const temHab =
    (slot === 'regente' && hab.regente) ||
    (slot === 'equipe' && hab.equipe) ||
    (slot === 'mm_es' && hab.mensagem_musical?.es) ||
    (slot === 'mm_culto' && hab.mensagem_musical?.culto) ||
    (slot === 'mm_domingo' && hab.mensagem_musical?.domingo);
  if (!temHab) return null;

  // Afastada.
  if (pessoa.afastado && pessoa.afastado.ativo === true) {
    return pessoa.afastado.motivo ? `afastada (${pessoa.afastado.motivo})` : 'afastada';
  }

  // Indisponível na data (voto da enquete) ou mês inteiro.
  const indispData = new Set(
    (base.indisponibilidade.datas || []).find((d) => d.data_referencia === culto.data)?.indisponiveis_ids || [],
  );
  const indispMes = new Set(base.indisponibilidade.indisponiveis_mes_inteiro?.ids || []);
  if (indispData.has(pessoa.id)) return 'votou que não pode nesta data';
  if (indispMes.has(pessoa.id)) return 'indisponível o mês inteiro';

  // Dia não permitido (ex.: só sábado).
  const dia = culto.dia_semana;
  if (Array.isArray(pessoa.dias_permitidos) && pessoa.dias_permitidos.length > 0) {
    if (!pessoa.dias_permitidos.includes(dia)) {
      return `só serve ${pessoa.dias_permitidos.join('/')}`;
    }
  }

  // Já escalada neste culto em outra função.
  const jaNoCulto = contexto.escaladosPorCulto.get(culto.data) || new Set();
  if (jaNoCulto.has(pessoa.id)) return 'já está em outra função neste culto';

  // Em escala externa (audiovisual/pregador) do culto.
  const externos = contexto.externosPorCulto.get(culto.data) || { audiovisual: [], pregador: [] };
  if (externos.audiovisual.includes(pessoa.id)) return 'está na sonoplastia deste culto';
  if (externos.pregador.includes(pessoa.id)) return 'está pregando neste culto';

  return 'indisponível para esta função nesta data';
}

/**
 * Roda o solver OFICIAL para o mês inteiro e devolve as sugestões por culto.
 * Mantém o contexto acumulado entre cultos (rotação, consecutivo, etc.).
 *
 * Compatibilidade: `sugerirMes(base)` (sem opções) percorre `base.cultos` em
 * modo 'tudo' e devolve exatamente o formato da regressão de julho/2026
 * (objetos com nomes). Quando `opts` traz `cultos`, percorre essa lista (que já
 * pode conter dias extraordinários com `modelo_louvor`). Em modo 'vazios',
 * pré-carrega as atribuições existentes como `culto.fixos` e mantém grupos e
 * cultos assumidos fora da sugestão.
 *
 * @param {object} base - contexto de carregarContexto
 * @param {{ cultos?: object[], modo?: 'tudo'|'vazios' }} [opts]
 * @returns {object[]} sugestões por culto
 */
export function sugerirMes(base, opts = {}) {
  const cultosExplicitos = Array.isArray(opts.cultos);
  const cultos = cultosExplicitos ? opts.cultos : base.cultos;
  const modo = opts.modo === 'vazios' ? 'vazios' : 'tudo';

  const contexto = {
    pessoas: base.cadastro,
    indisponibilidade: base.indisponibilidade,
    historico: base.historico,
    parametros: base.parametros || PARAMETROS_PADRAO,
    escaladosNesteMes: new Map(),
    escaladosPorCulto: new Map(),
    papeisPorCulto: new Map(),
    externosPorCulto: new Map(),
    dataAnterior: null,
    grupoPreferencialRegente: null,
  };

  // Em modo 'vazios', pré-carrega todas as atribuições existentes (pessoas) no
  // contexto, para que o solver as respeite na rotação e as receba como fixos.
  if (modo === 'vazios') {
    precarregarFixos(base, cultos, contexto);
  }

  const sugestoes = [];
  for (const culto of cultos) {
    const { data, dia_semana, anciao, pregador, audiovisual } = culto;
    // O modelo_louvor só rege o fluxo quando os cultos vêm explicitamente da
    // montagem (opts.cultos). No caminho padrão (sugerirMes(base)), preservamos
    // o comportamento histórico: só 'quarta-feira' é pulado (regressão julho).
    const modeloLouvor =
      cultosExplicitos &&
      culto.modelo_louvor &&
      ['sabado', 'domingo', 'sem_louvor'].includes(culto.modelo_louvor)
        ? culto.modelo_louvor
        : null;

    // Externos do culto.
    const externos = { audiovisual: [], pregador: [] };
    if (Array.isArray(culto.sonoplastiaIds) && culto.sonoplastiaIds.length > 0) {
      for (const id of culto.sonoplastiaIds) if (id != null) externos.audiovisual.push(id);
    } else {
      const avId = resolverExternoParaId(audiovisual, base.cadastro.porNome);
      if (avId) externos.audiovisual.push(avId);
    }
    const pregId = resolverExternoParaId(pregador, base.cadastro.porNome);
    if (pregId && !ehDepartamental(pregador)) externos.pregador.push(pregId);
    contexto.externosPorCulto.set(data, externos);

    // Dia sem louvor: quarta-feira sempre; ou um Dia_Extraordinario com modelo
    // 'sem_louvor'. (Dias de calendário com modelo padrão 'sem_louvor' que não
    // são quarta-feira — como a regressão de julho — seguem o fluxo normal.)
    const semLouvor =
      dia_semana === 'quarta-feira' ||
      (modeloLouvor === 'sem_louvor' && culto.extraordinario === true);
    if (semLouvor) {
      sugestoes.push({ data, dia_semana, tipo: 'quarta', anciao, pregador, audiovisual });
      contexto.dataAnterior = data;
      continue;
    }

    if (ehDepartamental(pregador)) {
      sugestoes.push({
        data,
        dia_semana,
        tipo: 'departamental',
        departamento: pregador.toUpperCase().trim(),
        anciao,
        pregador,
        audiovisual,
      });
      contexto.dataAnterior = data;
      continue;
    }

    // Culto assumido por um grupo (modo 'vazios'): fica inteiro fora da sugestão.
    if (modo === 'vazios' && culto.assumidoPor) {
      sugestoes.push({
        data,
        dia_semana,
        tipo: 'normal',
        regente: '',
        equipe: [],
        mm: [],
        assumidoPor: culto.assumidoPor,
        anciao,
        pregador,
        audiovisual,
      });
      contexto.dataAnterior = data;
      continue;
    }

    // Monta o culto para o solver: no modo 'vazios', passa os fixos (pessoas já
    // escolhidas à mão). O solver só escala pessoas, nunca grupos.
    const cultoSolver = { data, dia_semana, anciao, pregador, audiovisual };
    if (modeloLouvor) cultoSolver.modelo_louvor = modeloLouvor;
    if (modo === 'vazios') cultoSolver.fixos = fixosDoCulto(culto, base.cadastro);

    const s = sugerirCulto(cultoSolver, contexto);
    sugestoes.push({
      data,
      dia_semana,
      tipo: 'normal',
      regente: s.regente ? s.regente.nome : '',
      equipe: s.equipe.map((p) => p.nome),
      mm: s.mm.map((p) => p.nome),
      anciao,
      pregador,
      audiovisual,
    });
    contexto.dataAnterior = data;
  }
  return sugestoes;
}

/**
 * Extrai os fixos de um CultoMontagem (atribuições já escolhidas à mão) no
 * formato que `sugerirCulto` aceita: { regente, equipe: [], mm: { slot: valor } }.
 * Grupos ('grupo:<chave>') não são escaláveis e ficam de fora dos fixos de
 * pessoa (mas seus membros já entram no contexto via precarregarFixos).
 */
function fixosDoCulto(culto, cadastro) {
  const soPessoa = (valor) => {
    if (valor == null || valor === '') return undefined;
    if (typeof valor === 'string' && valor.startsWith('grupo:')) return undefined;
    return valor;
  };
  const fixos = { regente: undefined, equipe: [], mm: {} };
  const r = soPessoa(culto.regente);
  if (r !== undefined) fixos.regente = r;
  for (const e of culto.equipe || []) {
    const v = soPessoa(e);
    if (v !== undefined) fixos.equipe.push(v);
  }
  const mm = culto.mm || {};
  if (!Array.isArray(mm) && typeof mm === 'object') {
    for (const slot of Object.keys(mm)) {
      const v = soPessoa(mm[slot]);
      if (v !== undefined) fixos.mm[slot] = v;
    }
  }
  return fixos;
}

/**
 * Pré-carrega todas as atribuições existentes (pessoas e membros de grupos
 * escalados) no contexto do solver, para o modo 'vazios': alimenta
 * escaladosPorCulto, escaladosNesteMes e papeisPorCulto, garantindo que o
 * solver não reescolha quem já está e respeite a exclusão no culto.
 */
function precarregarFixos(base, cultos, contexto) {
  const cadastro = base.cadastro;
  const grupos = base.grupos || new Map();

  const idDe = (valor) => {
    if (valor == null || valor === '') return null;
    if (typeof valor === 'number') return valor;
    if (typeof valor === 'string' && valor.startsWith('grupo:')) return null;
    const p = cadastro.porNome.get(String(valor).toUpperCase().trim());
    return p ? p.id : null;
  };

  const marcar = (data, id, slot) => {
    if (id == null) return;
    if (!contexto.escaladosPorCulto.has(data)) contexto.escaladosPorCulto.set(data, new Set());
    contexto.escaladosPorCulto.get(data).add(id);
    if (!contexto.escaladosNesteMes.has(id)) {
      contexto.escaladosNesteMes.set(id, { slots: new Set(), count: 0 });
    }
    const e = contexto.escaladosNesteMes.get(id);
    e.slots.add(slot);
    e.count += 1;
    if (!contexto.papeisPorCulto.has(data)) contexto.papeisPorCulto.set(data, new Map());
    const papeis = contexto.papeisPorCulto.get(data);
    if (!papeis.has(id)) papeis.set(id, new Set());
    papeis.get(id).add(slot);
  };

  const marcarGrupo = (data, chave, slot) => {
    const g = grupos.get(chave);
    if (!g) return;
    for (const id of g.membros_ids || []) marcar(data, id, slot);
  };

  for (const culto of cultos) {
    const data = culto.data;
    // Regente.
    if (typeof culto.regente === 'string' && culto.regente.startsWith('grupo:')) {
      marcarGrupo(data, culto.regente.slice('grupo:'.length), 'regente');
    } else {
      marcar(data, idDe(culto.regente), 'regente');
    }
    // Equipe.
    for (const v of culto.equipe || []) {
      if (typeof v === 'string' && v.startsWith('grupo:')) marcarGrupo(data, v.slice('grupo:'.length), 'equipe');
      else marcar(data, idDe(v), 'equipe');
    }
    // MM.
    const mm = culto.mm || {};
    if (!Array.isArray(mm) && typeof mm === 'object') {
      for (const slot of Object.keys(mm)) {
        const v = mm[slot];
        if (typeof v === 'string' && v.startsWith('grupo:')) marcarGrupo(data, v.slice('grupo:'.length), slot);
        else marcar(data, idDe(v), slot);
      }
    }
  }
}

// --------------------------------------------------------------------------
// Validação das regras duras sobre a escala montada
// --------------------------------------------------------------------------

function splitNomes(raw) {
  if (!raw) return [];
  return String(raw)
    .split(',')
    .map((n) => n.trim())
    .filter(Boolean);
}

/**
 * Normaliza um culto da UI (name-based, mm como array) para o formato
 * CultoMontagem usado pela avaliação (mm como objeto por slot, ocupantes por
 * ID/nome/'grupo:<chave>'). Aceita tanto o formato antigo quanto o novo.
 */
function normalizarCultoParaAvaliacao(culto, parametros) {
  const slots = Array.isArray(culto.slots) && culto.slots.length
    ? culto.slots
    : slotsDoCulto(culto, parametros);

  // mm: já objeto? mantém. Senão, mapeia array para os slots de MM do modelo.
  let mm = {};
  if (culto.mm && !Array.isArray(culto.mm) && typeof culto.mm === 'object') {
    mm = { ...culto.mm };
  } else {
    const arr = Array.isArray(culto.mm) ? culto.mm.filter((x) => x != null && x !== '') : [];
    const slotsMm = slots.filter((s) => s.startsWith('mm_'));
    arr.forEach((valor, i) => {
      if (slotsMm[i]) mm[slotsMm[i]] = valor;
    });
  }

  const equipe = Array.isArray(culto.equipe)
    ? culto.equipe.filter((x) => x != null && x !== '')
    : [];

  return {
    ...culto,
    tipo: culto.tipo || tipoDoCulto(culto),
    slots,
    regente: culto.regente || null,
    equipe,
    mm,
  };
}

/** Texto legível do nome de um ocupante (para mensagens). */
function nomeDoOcupante(ocupante, base) {
  if (ocupante == null) return '';
  if (typeof ocupante === 'number') return (base.cadastro.porId.get(ocupante) || {}).nome || `#${ocupante}`;
  if (typeof ocupante === 'string' && ocupante.startsWith('grupo:')) {
    const g = base.grupos && base.grupos.get(ocupante.slice('grupo:'.length));
    return g ? g.nome_exibicao : ocupante;
  }
  if (ocupante && ocupante.foraDoCadastro) return ocupante.foraDoCadastro;
  return String(ocupante);
}

/**
 * Valida a escala montada via avaliação única. Cada atribuição passa por
 * `avaliarAtribuicao` e cada culto por `avaliarCulto`; nome ou ID fora do
 * Cadastro é erro. Devolve { erros, avisos } com ItemValidacao (id estável,
 * chave, refs, nivel, data, slot, pessoaId, texto).
 */
export function validarEscala(base, cultos) {
  const parametros = base.parametros || PARAMETROS_PADRAO;
  const normalizados = (Array.isArray(cultos) ? cultos : []).map((c) =>
    normalizarCultoParaAvaliacao(c, parametros),
  );
  const estado = criarEstadoMes(base, normalizados);

  const erros = [];
  const avisos = [];

  const empurrar = (motivo) => {
    (motivo.nivel === 'bloqueio' ? erros : avisos).push(motivo);
  };

  for (const culto of normalizados) {
    if (culto.tipo !== 'louvor') continue;
    const data = culto.data;

    // Cada ocupante de cada slot.
    for (const slot of culto.slots) {
      for (const valor of ocupantesValoresDoSlot(culto, slot)) {
        const ocupante = resolverOcupante(valor, base.cadastro);
        if (ocupante == null) continue;

        // Fora do cadastro (nome/id desconhecido) = erro de cadastro.
        if (ocupante && ocupante.foraDoCadastro) {
          erros.push({
            id: `fora_do_cadastro|${data}|${slot}|${ocupante.foraDoCadastro}`,
            chave: 'fora_do_cadastro',
            refs: [],
            nivel: 'bloqueio',
            data,
            slot,
            pessoaId: null,
            texto: `${toBrDate(data)}: ${ocupante.foraDoCadastro} (${slot}) não está no cadastro.`,
          });
          continue;
        }

        const { bloqueios, avisos: avs } = avaliarAtribuicao(base, estado, data, slot, ocupante);
        const nome = nomeDoOcupante(ocupante, base);
        const ocId = typeof ocupante === 'number' ? ocupante : ocupante;
        for (const m of [...bloqueios, ...avs]) {
          empurrar({
            id: `${m.chave}|${data}|${slot}|${idOcupante(ocupante)}`,
            chave: m.chave,
            refs: m.refs,
            nivel: m.nivel,
            data,
            slot,
            pessoaId: typeof ocupante === 'number' ? ocupante : null,
            ocupante: ocId,
            texto: `${toBrDate(data)}: ${nome} — ${m.texto}.`,
          });
        }
      }
    }

    // Avaliação do culto (cobertura/mínimos/excedentes).
    for (const m of avaliarCulto(base, estado, data)) {
      empurrar({
        id: `${m.chave}|${data}`,
        chave: m.chave,
        refs: m.refs,
        nivel: m.nivel,
        data,
        slot: null,
        pessoaId: null,
        texto: `${toBrDate(data)}: ${m.texto}.`,
      });
    }
  }

  return { erros, avisos };
}

/** Chave estável do ocupante para o id do ItemValidacao. */
function idOcupante(ocupante) {
  if (typeof ocupante === 'number') return ocupante;
  if (typeof ocupante === 'string') return ocupante;
  return 'desconhecido';
}

/** Valores (ids/nomes) de um slot de um culto normalizado. */
function ocupantesValoresDoSlot(culto, slot) {
  if (slot === 'regente') return culto.regente ? [culto.regente] : [];
  if (slot === 'equipe') return culto.equipe || [];
  if (slot.startsWith('mm_')) {
    const v = (culto.mm || {})[slot];
    return v != null && v !== '' ? [v] : [];
  }
  return [];
}

export { toBrDate, converterDataBR, normalizarDiaSemana };
