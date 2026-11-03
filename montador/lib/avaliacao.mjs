// Avaliação única de atribuições e cultos, reutilizada por candidatos,
// substitutos, validação e revalidação da interface.
//
// A avaliação decide, para um ocupante (pessoa por ID ou 'grupo:<chave>') numa
// função de um culto, se ele é BLOQUEADO, tem AVISO ou está livre — lendo os
// níveis de parametros.json e os avisos de vínculo. O resultado é uma lista de
// Motivo = { chave, refs, nivel: 'bloqueio'|'aviso', texto }.
//
// Este módulo é o núcleo reutilizado depois por grupos (Task 27), revalidação
// (Task 29) e ajuste (Task 37). O suporte a grupos ('grupo:<chave>') aqui é um
// esqueleto (avaliarGrupo) que a Task 27 completa; o esqueleto já aceita
// ocupante = pessoaId | 'grupo:<chave>'.
//
// Feature: melhoras-domingao (E. Montagem) — Task 20; Properties 14, 15, 16, 17.

import { PARAMETROS_PADRAO, nivel as nivelDe, valorRegra as valorRegraDe } from '../../scripts/lib/parametros.js';
import { ehOcupanteGrupo, tipoDoCulto, slotsDoCulto } from './contexto.mjs';
import { gruposEscalaveis } from './grupos.mjs';

/** Slots de mensagem musical. */
const SLOTS_MM = new Set(['mm_es', 'mm_culto', 'mm_domingo']);

/** Converte uma data ISO para DD/MM/AAAA (mensagens de validação). */
function toBrDate(iso) {
  const [ano, mes, dia] = String(iso || '').split('-');
  if (!dia || !mes || !ano) return String(iso || '');
  return `${dia}/${mes}/${ano}`;
}

/** Dia da semana real (0=dom..6=sab) → nome em português (normalizado). */
function diaRealDaData(iso) {
  const [ano, mes, dia] = String(iso).split('-').map(Number);
  if (!ano || !mes || !dia) return '';
  const dow = new Date(ano, mes - 1, dia).getDay();
  return ['domingo', 'segunda', 'terca', 'quarta-feira', 'quinta', 'sexta', 'sabado'][dow];
}

/** `dias_permitidos` inclui o dia real? (trata quarta ~ quarta-feira). */
function diaPermitido(diasPermitidos, iso) {
  const real = diaRealDaData(iso);
  const curto = real === 'quarta-feira' ? 'quarta' : real;
  return diasPermitidos.some((d) => d === real || d === curto);
}

/** A pessoa tem a habilitação do slot? */
function temHabilitacaoPessoa(pessoa, slot) {
  const hab = pessoa.habilitacoes || {};
  const mm = hab.mensagem_musical || {};
  switch (slot) {
    case 'regente':
      return hab.regente === true;
    case 'equipe':
      return hab.equipe === true;
    case 'mm_es':
      return mm.es === true;
    case 'mm_culto':
      return mm.culto === true;
    case 'mm_domingo':
      return mm.domingo === true;
    default:
      return false;
  }
}

/** Função abstrata do slot ('mm_*' → 'mm'). */
function funcaoDoSlot(slot) {
  if (SLOTS_MM.has(slot)) return 'mm';
  return slot;
}

/** Normaliza um nome para comparar com nome/apelido do cadastro. */
function chaveNome(texto) {
  return String(texto || '').toUpperCase().trim();
}

/**
 * Resolve o valor de uma atribuição (id numérico, 'grupo:<chave>' ou nome) para
 * um ocupante canônico: número (id) | 'grupo:<chave>' | null (desconhecido).
 */
export function resolverOcupante(valor, cadastro) {
  if (valor == null || valor === '') return null;
  if (typeof valor === 'number') return valor;
  if (typeof valor === 'string') {
    if (valor.startsWith('grupo:')) return valor;
    const pessoa = cadastro.porNome.get(chaveNome(valor));
    if (pessoa) return pessoa.id;
    return { foraDoCadastro: valor };
  }
  return null;
}

/** Divide um campo de nomes por vírgula. */
function splitNomes(raw) {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw.map((x) => String(x || '').trim()).filter(Boolean);
  return String(raw)
    .split(',')
    .map((n) => n.trim())
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Estado do mês
// ---------------------------------------------------------------------------

/**
 * Constrói o estado do mês a partir da escala em montagem (lista de
 * CultoMontagem com atribuições por ID / 'grupo:<chave>'). Guarda, por culto:
 * os ocupantes de cada slot, o conjunto de papéis por ocupante, a sonoplastia,
 * o pregador e o ancião; e, por ocupante, quantas MMs tem no mês e em quais
 * cultos de louvor participa (para "cantou no culto anterior").
 *
 * @param {object} base - contexto (cadastro, indisponibilidade, grupos, parametros)
 * @param {object[]} cultos - CultoMontagem[] (data, slots, regente, equipe[], mm{}, ...)
 * @returns {object} estado
 */
export function criarEstadoMes(base, cultos) {
  const cadastro = base.cadastro;
  const lista = Array.isArray(cultos) ? cultos : [];

  // Ordena por data para "culto anterior" fazer sentido.
  const ordenados = [...lista].sort((a, b) => String(a.data).localeCompare(String(b.data)));

  const porData = new Map(); // data → info do culto
  const mmPorOcupante = new Map(); // ocupanteKey → Set(data)
  const cultosDeLouvorComOcupante = new Map(); // ocupanteKey → Set(data de cultos de louvor em que participa)
  const datasOrdenadas = [];

  const chaveOc = (oc) => (typeof oc === 'number' ? `p:${oc}` : String(oc));

  for (const culto of ordenados) {
    const data = culto.data;
    datasOrdenadas.push(data);

    // Mapa ocupante → Set(slot) neste culto.
    const papeis = new Map();
    const registrar = (ocupante, slot) => {
      if (ocupante == null) return;
      const k = chaveOc(ocupante);
      if (!papeis.has(k)) papeis.set(k, { ocupante, slots: new Set() });
      papeis.get(k).slots.add(slot);
    };

    const slots = Array.isArray(culto.slots) && culto.slots.length
      ? culto.slots
      : slotsDoCulto(culto, base.parametros);

    for (const slot of slots) {
      for (const ocupante of ocupantesDoSlot(culto, slot, cadastro)) {
        if (ocupante == null || (ocupante && ocupante.foraDoCadastro)) {
          // ainda registramos para "repetição" detectar? Não; fora do cadastro
          // é tratado como erro de cadastro na validação, não entra em papéis.
          continue;
        }
        registrar(ocupante, slot);
        if (SLOTS_MM.has(slot)) {
          const k = chaveOc(ocupante);
          if (!mmPorOcupante.has(k)) mmPorOcupante.set(k, new Set());
          mmPorOcupante.get(k).add(data);
        }
      }
    }

    // Sonoplastia (ids vindos do insumo).
    const sonoplastiaIds = new Set((culto.sonoplastiaIds || []).filter((x) => x != null));

    // Pregador e ancião por ID (quando existem no cadastro).
    const pregadorId = idPorNome(culto.pregador, cadastro);
    const anciaoId = idPorNome(culto.anciao, cadastro);

    const tipo = culto.tipo || tipoDoCulto(culto);

    porData.set(data, {
      culto,
      tipo,
      papeis,
      sonoplastiaIds,
      pregadorId,
      anciaoId,
      assumidoPor: culto.assumidoPor || null,
    });

    // Para "culto anterior com louvor": registra participantes de cultos de louvor.
    if (tipo === 'louvor') {
      for (const { ocupante } of papeis.values()) {
        const k = chaveOc(ocupante);
        if (!cultosDeLouvorComOcupante.has(k)) cultosDeLouvorComOcupante.set(k, new Set());
        cultosDeLouvorComOcupante.get(k).add(data);
      }
    }
  }

  // Datas de cultos de louvor em ordem (para encontrar o "anterior").
  const datasLouvor = ordenados
    .filter((c) => (c.tipo || tipoDoCulto(c)) === 'louvor')
    .map((c) => c.data);

  return {
    base,
    porData,
    datasOrdenadas,
    datasLouvor,
    mmPorOcupante,
    cultosDeLouvorComOcupante,
    chaveOc,

    /** Info do culto por data. */
    culto(data) {
      return porData.get(data) || null;
    },

    /** Slots ocupados por um ocupante no culto (opcionalmente exceto um slot). */
    papeisNoCulto(data, ocupante, { exceto } = {}) {
      const info = porData.get(data);
      if (!info) return new Set();
      const k = chaveOc(ocupante);
      const entrada = info.papeis.get(k);
      if (!entrada) return new Set();
      if (!exceto) return new Set(entrada.slots);
      return new Set([...entrada.slots].filter((s) => s !== exceto));
    },

    /** Quantas MMs um ocupante tem no mês, exceto a posição [data, slot] atual. */
    mmNoMes(ocupante, { exceto } = {}) {
      const k = chaveOc(ocupante);
      const datas = mmPorOcupante.get(k);
      if (!datas) return 0;
      if (!exceto) return datas.size;
      const [dataExcluida] = exceto;
      // Conta datas distintas com MM, descontando a data atual se faz parte.
      let total = 0;
      for (const d of datas) {
        if (d === dataExcluida) continue;
        total += 1;
      }
      return total;
    },

    /** O ocupante participou do culto de louvor imediatamente anterior a `data`? */
    noCultoAnterior(data, ocupante) {
      const idx = datasLouvor.indexOf(data);
      if (idx <= 0) return false;
      const anterior = datasLouvor[idx - 1];
      const k = chaveOc(ocupante);
      const set = cultosDeLouvorComOcupante.get(k);
      return !!(set && set.has(anterior));
    },
  };
}

/** Ocupantes (ids/grupos) escolhidos num slot de um culto. */
function ocupantesDoSlot(culto, slot, cadastro) {
  const out = [];
  const add = (valor) => {
    const oc = resolverOcupante(valor, cadastro);
    if (oc !== null) out.push(oc);
  };
  if (slot === 'regente') {
    add(culto.regente);
  } else if (slot === 'equipe') {
    for (const e of culto.equipe || []) add(e);
  } else if (SLOTS_MM.has(slot)) {
    const mm = culto.mm || {};
    if (mm[slot] != null && mm[slot] !== '') add(mm[slot]);
  }
  return out;
}

/** ID da pessoa de um nome/ID (ou null). */
function idPorNome(valor, cadastro) {
  if (valor == null || valor === '') return null;
  if (typeof valor === 'number') return valor;
  const pessoa = cadastro.porNome.get(chaveNome(valor));
  return pessoa ? pessoa.id : null;
}

// ---------------------------------------------------------------------------
// Avaliação de uma atribuição
// ---------------------------------------------------------------------------

/** Motivo fixo (bloqueio do cadastro, sem parâmetro). */
function fixoBloqueio(chave, texto) {
  return { chave, refs: [], nivel: 'bloqueio', texto: texto || chave };
}

/** Motivo fixo de aviso (sem parâmetro). */
function fixoAviso(chave, texto) {
  return { chave, refs: [], nivel: 'aviso', texto: texto || chave };
}

/**
 * Avalia a atribuição de um ocupante a (data, slot) na escala do mês.
 *
 * @param {object} base - contexto
 * @param {object} estado - de criarEstadoMes
 * @param {string} data - ISO
 * @param {string} slot - 'regente'|'equipe'|'mm_es'|'mm_culto'|'mm_domingo'
 * @param {number|string} ocupante - pessoaId | 'grupo:<chave>'
 * @returns {{ bloqueios: object[], avisos: object[] }}
 */
export function avaliarAtribuicao(base, estado, data, slot, ocupante) {
  if (ehOcupanteGrupo(ocupante)) {
    return avaliarGrupo(base, estado, data, slot, ocupante.slice('grupo:'.length));
  }

  const par = base.parametros || PARAMETROS_PADRAO;
  const cadastro = base.cadastro;
  const p = typeof ocupante === 'number' ? cadastro.porId.get(ocupante) : null;
  const info = estado.culto(data) || {};
  const b = [];
  const a = [];

  const add = (chave, texto) => {
    const n = nivelDe(par, chave);
    if (!n) return;
    const refs = (par.regras && par.regras[chave] && par.regras[chave].refs) || [];
    (n === 'bloqueio' ? b : a).push({ chave, refs, nivel: n, texto });
  };

  if (!p) {
    return { bloqueios: [fixoBloqueio('fora_do_cadastro', 'não está no cadastro')], avisos: [] };
  }

  if (p.ativo !== true) b.push(fixoBloqueio('inativo', 'está inativa'));
  if (p.afastado && p.afastado.ativo === true) {
    b.push(fixoBloqueio('afastado', p.afastado.motivo ? `afastada (${p.afastado.motivo})` : 'afastada'));
  }
  if (!temHabilitacaoPessoa(p, slot)) b.push(fixoBloqueio('habilitacao', 'não é habilitada para esta função'));
  if (Array.isArray(p.dias_permitidos) && p.dias_permitidos.length > 0 && !diaPermitido(p.dias_permitidos, data)) {
    b.push(fixoBloqueio('dias_permitidos', `só serve ${p.dias_permitidos.join('/')}`));
  }

  if (indisponivel(base, data, ocupante)) add('indisponibilidade', 'votou que não pode nesta data');

  if (info.sonoplastiaIds && info.sonoplastiaIds.has(ocupante)) {
    add('conflito_sonoplastia', 'está na sonoplastia deste culto');
  }

  // Acúmulo no mesmo culto.
  const outros = estado.papeisNoCulto(data, ocupante, { exceto: slot });
  const envolveRegencia = slot === 'regente' ? outros.size > 0 : outros.has('regente');
  if (envolveRegencia) {
    add('conflito_regencia', 'está na regência deste culto');
  } else if (ehEquipeEMM(slot, outros)) {
    add('equipe_e_mm_mesmo_culto', 'está na equipe e na mensagem musical');
  } else if (outros.size > 0) {
    add('repeticao_no_culto', 'já está em outra função neste culto');
  }

  if (info.pregadorId != null && info.pregadorId === ocupante) {
    add('conflito_pregador', 'é o pregador deste culto');
  }
  // Ancião: sem regra (RF004-A) — nunca bloqueia nem avisa.

  if (SLOTS_MM.has(slot)) {
    const maximo = valorRegraDe(par, 'mm_por_mes', 'maximo', 1);
    if (estado.mmNoMes(ocupante, { exceto: [data, slot] }) >= maximo) {
      add('mm_por_mes', `já tem ${maximo} mensagem(ns) musical(is) no mês`);
    }
  }

  if (estado.noCultoAnterior(data, ocupante)) add('consecutivo', 'cantou no culto anterior');

  // Avisos de vínculo não atendido no culto.
  for (const texto of vinculosNaoAtendidos(base, estado, data, p)) {
    a.push({ chave: 'vinculo', refs: [], nivel: 'aviso', texto });
  }

  // Aviso: membro de Grupo_Escalavel já escalado no culto.
  for (const texto of membroDeGrupoEscaladoNoCulto(base, estado, data, p.id, slot)) {
    a.push(fixoAviso('membro_em_outra_funcao', texto));
  }

  return { bloqueios: b, avisos: a };
}

/** Equipe + MM no mesmo culto? */
function ehEquipeEMM(slot, outros) {
  const souMm = SLOTS_MM.has(slot);
  const outroMm = [...outros].some((s) => SLOTS_MM.has(s));
  const outroEquipe = outros.has('equipe');
  return (souMm && outroEquipe) || (slot === 'equipe' && outroMm);
}

/** O ocupante (pessoa id ou 'grupo:<chave>') está indisponível nesta data? */
function indisponivel(base, data, ocupante) {
  const ind = base.indisponibilidade || {};
  const idsData = new Set(
    (ind.datas || []).find((d) => d.data_referencia === data)?.indisponiveis_ids || [],
  );
  const idsMes = new Set((ind.indisponiveis_mes_inteiro && ind.indisponiveis_mes_inteiro.ids) || []);
  if (typeof ocupante === 'number') return idsData.has(ocupante) || idsMes.has(ocupante);
  return false;
}

/**
 * Textos de vínculos não atendidos de uma pessoa no culto:
 * - precisa_de: nenhuma das pessoas de com_ids está no culto;
 * - sempre_junto: o parceiro não está no culto;
 * - familia_requerida: nenhum membro do grupo está no culto.
 */
function vinculosNaoAtendidos(base, estado, data, pessoa) {
  const out = [];
  const info = estado.culto(data);
  if (!info) return out;
  const cadastro = base.cadastro;
  const presentes = idsPresentesNoCulto(info);

  for (const v of pessoa.vinculos || []) {
    if (v.tipo === 'precisa_de') {
      const ok = (v.com_ids || []).some((id) => presentes.has(id));
      if (!ok) {
        const nomes = (v.com_ids || [])
          .map((id) => (cadastro.porId.get(id) || {}).nome || `#${id}`)
          .join(' ou ');
        out.push(`precisa de ${nomes} no culto`);
      }
    } else if (v.tipo === 'sempre_junto') {
      if (!presentes.has(v.com_id)) {
        const nome = (cadastro.porId.get(v.com_id) || {}).nome || `#${v.com_id}`;
        out.push(`deve estar junto de ${nome}`);
      }
    } else if (v.tipo === 'familia_requerida') {
      const grupo = cadastro.grupos && cadastro.grupos.get(v.grupo);
      const membros = (grupo && grupo.membros_ids) || [];
      const ok = membros.some((id) => presentes.has(id) && id !== pessoa.id);
      if (!ok) out.push(`requer alguém do grupo ${v.grupo} no culto`);
    }
  }
  return out;
}

/** IDs de pessoas presentes no culto (de qualquer slot). */
function idsPresentesNoCulto(info) {
  const ids = new Set();
  for (const { ocupante } of info.papeis.values()) {
    if (typeof ocupante === 'number') ids.add(ocupante);
  }
  return ids;
}

/**
 * Para uma pessoa, textos de aviso quando ela é membro de um Grupo_Escalavel já
 * escalado em outra função no culto.
 */
function membroDeGrupoEscaladoNoCulto(base, estado, data, pessoaId, slot) {
  const out = [];
  const info = estado.culto(data);
  if (!info) return out;
  const grupos = base.grupos;
  if (!grupos) return out;
  // Para cada grupo escalado neste culto, se a pessoa é membro, avisa.
  for (const { ocupante, slots } of info.papeis.values()) {
    if (typeof ocupante !== 'string' || !ocupante.startsWith('grupo:')) continue;
    const chave = ocupante.slice('grupo:'.length);
    const g = grupos.get(chave);
    if (g && g.membros_ids.includes(pessoaId)) {
      out.push(`é membro de ${g.nome_exibicao}, escalado neste culto`);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Avaliação de um Grupo_Escalavel (esqueleto; Task 27 completa)
// ---------------------------------------------------------------------------

/**
 * Avalia um Grupo_Escalavel ('grupo:<chave>') em (data, slot).
 * Esqueleto conforme o design: habilitação pelas funcoes, indisponível só sem
 * nenhum membro disponível, avisos de membros indisponíveis e de membro em
 * outra função, repetição no culto, MM por mês e consecutivo pela chave.
 */
export function avaliarGrupo(base, estado, data, slot, chave) {
  const par = base.parametros || PARAMETROS_PADRAO;
  const grupos = base.grupos;
  const g = grupos && grupos.get(chave);
  const b = [];
  const a = [];
  const ocupante = `grupo:${chave}`;

  const add = (chaveRegra, texto) => {
    const n = nivelDe(par, chaveRegra);
    if (!n) return;
    const refs = (par.regras && par.regras[chaveRegra] && par.regras[chaveRegra].refs) || [];
    (n === 'bloqueio' ? b : a).push({ chave: chaveRegra, refs, nivel: n, texto });
  };

  if (!g) return { bloqueios: [fixoBloqueio('fora_do_cadastro', 'grupo não está no cadastro')], avisos: [] };

  if (!g.funcoes.includes(funcaoDoSlot(slot))) {
    b.push(fixoBloqueio('habilitacao', 'o grupo não ocupa esta função'));
  }

  const indispMembros = g.membros_ids.filter((id) => indisponivel(base, data, id));
  if (indispMembros.length === g.membros_ids.length && g.membros_ids.length > 0) {
    add('indisponibilidade', 'nenhum membro do grupo está disponível');
  } else if (indispMembros.length > 0) {
    const nomes = indispMembros.map((id) => (base.cadastro.porId.get(id) || {}).nome || `#${id}`).join(', ');
    a.push(fixoAviso('membros_indisponiveis', `membros indisponíveis: ${nomes}`));
  }

  // Membro do grupo ocupando outra função no culto.
  const info = estado.culto(data);
  if (info) {
    for (const id of g.membros_ids) {
      const slots = estado.papeisNoCulto(data, id);
      for (const s of slots) {
        const nome = (base.cadastro.porId.get(id) || {}).nome || `#${id}`;
        a.push(fixoAviso('membro_em_outra_funcao', `${nome} está em ${s}`));
      }
    }
  }

  const outros = estado.papeisNoCulto(data, ocupante, { exceto: slot });
  if (outros.size > 0 && !(info && info.assumidoPor)) {
    add('repeticao_no_culto', 'o grupo já está em outra função neste culto');
  }

  if (SLOTS_MM.has(slot)) {
    const maximo = valorRegraDe(par, 'mm_por_mes', 'maximo', 1);
    if (estado.mmNoMes(ocupante, { exceto: [data, slot] }) >= maximo) {
      add('mm_por_mes', `o grupo já tem ${maximo} mensagem(ns) musical(is) no mês`);
    }
  }

  if (estado.noCultoAnterior(data, ocupante)) add('consecutivo', 'o grupo cantou no culto anterior');

  return { bloqueios: b, avisos: a };
}

// ---------------------------------------------------------------------------
// Avaliação de um culto (cobertura/mínimos)
// ---------------------------------------------------------------------------

/**
 * Avalia um culto inteiro: mínimo de homens, equipe incompleta, regente vazio,
 * MM vazia e excedentes. Um culto com `assumidoPor` dispensa esses motivos.
 *
 * @returns {object[]} Motivo[]
 */
export function avaliarCulto(base, estado, data) {
  const par = base.parametros || PARAMETROS_PADRAO;
  const info = estado.culto(data);
  if (!info) return [];
  const culto = info.culto;
  const motivos = [];

  if (info.tipo !== 'louvor') return motivos;
  if (info.assumidoPor) return motivos; // grupo assume: dispensa mínimos

  const cadastro = base.cadastro;
  const add = (chave, texto) => {
    const n = nivelDe(par, chave);
    if (!n) return;
    const refs = (par.regras && par.regras[chave] && par.regras[chave].refs) || [];
    motivos.push({ chave, refs, nivel: n, texto, data });
  };

  const slots = Array.isArray(culto.slots) && culto.slots.length ? culto.slots : slotsDoCulto(culto, par);

  // regente_vazio.
  if (slots.includes('regente')) {
    const r = ocupantesDoSlot(culto, 'regente', cadastro);
    if (r.length === 0) add('regente_vazio', 'regente vazio');
  }

  // equipe_incompleta.
  if (slots.includes('equipe')) {
    const tamanho = (par.equipe && par.equipe.tamanho) || 5;
    const eq = ocupantesDoSlot(culto, 'equipe', cadastro);
    if (eq.length < tamanho) add('equipe_incompleta', `equipe incompleta (${eq.length}/${tamanho})`);

    // minimo_homens.
    const minimo = valorRegraDe(par, 'minimo_homens', 'minimo', 1);
    const homens = eq.filter((oc) => {
      if (typeof oc !== 'number') return false;
      const p = cadastro.porId.get(oc);
      return p && p.genero === 'M';
    }).length;
    if (eq.length > 0 && homens < minimo) add('minimo_homens', 'equipe sem o mínimo de homens');
  }

  // mm_vazia.
  for (const slot of slots) {
    if (!SLOTS_MM.has(slot)) continue;
    const mm = ocupantesDoSlot(culto, slot, cadastro);
    if (mm.length === 0) add('mm_vazia', `mensagem musical vazia (${slot})`);
  }

  // excedente (nomes lidos de atual.json além das vagas).
  for (const exc of culto.excedentes || []) {
    const nome = exc && exc.nome ? exc.nome : String(exc);
    motivos.push({ chave: 'excedente', refs: [], nivel: 'aviso', texto: `${nome} excede as vagas`, data });
  }

  return motivos;
}

/** Grupos escaláveis do cadastro (atalho para montar `base.grupos`). */
export function gruposDoBase(base) {
  if (base.grupos) return base.grupos;
  const arquivo = base.cadastroArquivo || null;
  if (arquivo) return gruposEscalaveis(arquivo);
  // Reconstroi um pseudo-arquivo a partir do Map de grupos do cadastro.
  const grupos = base.cadastro && base.cadastro.grupos;
  const mapa = new Map();
  if (grupos) {
    for (const [chave, def] of grupos.entries()) {
      if (def && def.escalavel === true) {
        mapa.set(chave, {
          chave,
          nome_exibicao: def.nome_exibicao,
          membros_ids: def.membros_ids || [],
          responsavel_id: def.responsavel_id,
          modo: def.modo || 'funcao',
          funcoes: def.funcoes || ['mm'],
          mensagem: def.mensagem == null ? null : def.mensagem,
        });
      }
    }
  }
  return mapa;
}

export { toBrDate };
