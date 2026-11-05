/**
 * Módulo de filtros duros do solver.
 * Aplica eliminação sequencial de candidatos inelegíveis para um slot/data.
 *
 * Filtros aplicados nesta ordem:
 * 1. ativo === true
 * 2. afastado === null OU afastado.ativo === false
 * 3. Habilitação correspondente ao slot é true
 * 4. dias_permitidos === null OU inclui o dia da semana da data
 * 5. Pessoa NÃO está em indisponibilidade[data].indisponiveis_ids
 * 6. Pessoa NÃO está em indisponibilidade.indisponiveis_mes_inteiro.ids
 * 7. Pessoa NÃO está na escala externa desse culto (AUDIOVISUAL, PREGADOR — exceto ANCIÃO)
 * 8. Pessoa NÃO já escalada no mesmo culto em papel conflitante
 */

import { PARAMETROS_PADRAO, evitarNaSugestao } from './parametros.js';

/** Slots válidos reconhecidos pelo solver */
const SLOTS_VALIDOS = new Set(['regente', 'equipe', 'mm_es', 'mm_culto', 'mm_domingo']);

/** Parâmetros efetivos do contexto, com fallback nos padrões. */
function parametrosDe(contexto) {
  return (contexto && contexto.parametros) || PARAMETROS_PADRAO;
}

/**
 * Normaliza o dia da semana real da data para comparar com dias_permitidos,
 * tratando 'quarta' e 'quarta-feira' como o mesmo dia.
 */
function diaRealNormalizado(dataISO) {
  const dia = diaDaSemana(dataISO);
  return dia === 'quarta' ? 'quarta-feira' : dia;
}

/** Um valor de dias_permitidos casa com o dia real (quarta ~ quarta-feira)? */
function diaPermitido(diasPermitidos, dataISO) {
  const real = diaRealNormalizado(dataISO); // sempre 'quarta-feira' para quartas
  const realCurto = real === 'quarta-feira' ? 'quarta' : real;
  return diasPermitidos.some((d) => d === real || d === realCurto);
}

/**
 * Mapeia uma data ISO (YYYY-MM-DD) para o dia da semana em português.
 * @param {string} dataISO - Data no formato YYYY-MM-DD
 * @returns {'domingo'|'segunda'|'terca'|'quarta'|'quinta'|'sexta'|'sabado'}
 */
export function diaDaSemana(dataISO) {
  const [ano, mes, dia] = dataISO.split('-').map(Number);
  const date = new Date(ano, mes - 1, dia);
  const diaSemana = date.getDay(); // 0=domingo, 1=segunda, ..., 6=sabado

  const mapa = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
  return mapa[diaSemana];
}

/**
 * Verifica se a pessoa possui a habilitação correspondente ao slot.
 * @param {object} pessoa - Objeto pessoa do cadastro
 * @param {string} slot - Slot a verificar
 * @returns {boolean}
 */
function temHabilitacao(pessoa, slot) {
  const hab = pessoa.habilitacoes;
  if (!hab) return false;

  switch (slot) {
    case 'regente':
      return hab.regente === true;
    case 'equipe':
      return hab.equipe === true;
    case 'mm_es':
      return hab.mensagem_musical && hab.mensagem_musical.es === true;
    case 'mm_culto':
      return hab.mensagem_musical && hab.mensagem_musical.culto === true;
    case 'mm_domingo':
      return hab.mensagem_musical && hab.mensagem_musical.domingo === true;
    default:
      return false;
  }
}

/**
 * Retorna os IDs indisponíveis para uma data específica.
 * @param {object} indisponibilidade - Dados de indisponibilidade vinculada
 * @param {string} data - ISO date (YYYY-MM-DD)
 * @returns {Set<number>} Set de IDs indisponíveis na data
 */
function idsIndisponiveisNaData(indisponibilidade, data) {
  if (!indisponibilidade || !indisponibilidade.datas) return new Set();

  const entrada = indisponibilidade.datas.find((d) => d.data_referencia === data);
  if (!entrada || !entrada.indisponiveis_ids) return new Set();

  return new Set(entrada.indisponiveis_ids);
}

/**
 * Retorna os IDs indisponíveis o mês inteiro.
 * @param {object} indisponibilidade - Dados de indisponibilidade vinculada
 * @returns {Set<number>} Set de IDs indisponíveis o mês inteiro
 */
function idsIndisponivelMesInteiro(indisponibilidade) {
  if (
    !indisponibilidade ||
    !indisponibilidade.indisponiveis_mes_inteiro ||
    !indisponibilidade.indisponiveis_mes_inteiro.ids
  ) {
    return new Set();
  }

  return new Set(indisponibilidade.indisponiveis_mes_inteiro.ids);
}

/**
 * Retorna os IDs já escalados no mesmo culto (mesma data) em papel conflitante.
 * @param {object} contexto - Contexto do solver
 * @param {string} data - ISO date
 * @returns {Set<number>} Set de IDs já escalados neste culto
 */
function idsJaEscaladosNoCulto(contexto, data) {
  if (!contexto.escaladosPorCulto) return new Set();

  const escalados = contexto.escaladosPorCulto.get(data);
  if (!escalados) return new Set();

  // escaladosPorCulto.get(data) retorna um Set<number> de IDs
  return escalados;
}

/**
 * Retorna candidatos elegíveis após filtros duros.
 * Aplica filtros sequenciais na ordem definida pelo design.
 *
 * @param {'regente'|'equipe'|'mm_es'|'mm_culto'|'mm_domingo'} slot
 * @param {string} data - ISO date do culto (YYYY-MM-DD)
 * @param {object} contexto - Estado acumulado do solver
 * @param {object} contexto.pessoas - Resultado de carregarPessoas()
 * @param {object} contexto.indisponibilidade - JSON vinculado de indisponibilidade
 * @param {Map} contexto.escaladosPorCulto - Map: data → Set<personId>
 * @param {Map} [contexto.externosPorCulto] - Map: data → { audiovisual: [], pregador: [] }
 * @returns {object[]} Pessoas que passaram todos os filtros
 */
export function pessoasAtivasParaSlot(slot, data, contexto) {
  // Validar slot
  if (!SLOTS_VALIDOS.has(slot)) {
    throw new Error(
      `Slot inválido: "${slot}". Valores válidos: ${[...SLOTS_VALIDOS].join(', ')}`
    );
  }

  const todasPessoas = contexto.pessoas.pessoas;
  const indisponibilidade = contexto.indisponibilidade;
  const par = parametrosDe(contexto);

  // Parâmetros das regras de filtro (padrão = comportamento atual).
  const evitarIndisponibilidade = evitarNaSugestao(par, 'indisponibilidade'); // bloqueio → true
  const evitarSonoplastia = evitarNaSugestao(par, 'conflito_sonoplastia'); // bloqueio → true
  const evitarPregador = evitarNaSugestao(par, 'conflito_pregador'); // aviso + evitar → true
  const evitarLimiteMensal = evitarNaSugestao(par, 'limite_mensal'); // limite_mensal do cadastro

  // Pré-computar sets de IDs para filtros 5-8
  const indisponiveisData = idsIndisponiveisNaData(indisponibilidade, data);
  const indisponivelMes = idsIndisponivelMesInteiro(indisponibilidade);
  const { audiovisual: avSet, pregador: pregSet } = idsEscalaExternaSeparados(contexto, data);
  const jaEscalados = idsJaEscaladosNoCulto(contexto, data);

  const candidatos = [];

  for (const pessoa of todasPessoas) {
    // Filtro 1: ativo === true
    if (pessoa.ativo !== true) continue;

    // Filtro 2: afastado === null OU afastado.ativo === false
    if (pessoa.afastado !== null && pessoa.afastado.ativo === true) continue;

    // Filtro 3: Habilitação correspondente ao slot
    if (!temHabilitacao(pessoa, slot)) continue;

    // Filtro 4: dias_permitidos === null OU inclui o dia real da data
    //           (quarta e quarta-feira contam como o mesmo dia)
    if (pessoa.dias_permitidos !== null) {
      if (!Array.isArray(pessoa.dias_permitidos) || !diaPermitido(pessoa.dias_permitidos, data)) {
        continue;
      }
    }

    // Filtros 5-6: indisponibilidade (data e mês inteiro) — regra RF026.
    if (evitarIndisponibilidade) {
      if (indisponiveisData.has(pessoa.id)) continue;
      if (indisponivelMes.has(pessoa.id)) continue;
    }

    // Filtro 7a: sonoplastia/audiovisual do culto (RF002).
    if (evitarSonoplastia && avSet.has(pessoa.id)) continue;
    // Filtro 7b: pregador do culto, exceto ancião (RF004).
    if (evitarPregador && pregSet.has(pessoa.id)) continue;

    // Filtro 8: já escalado no mesmo culto em papel conflitante.
    if (bloqueadoNoCulto(contexto, data, pessoa.id, slot, par, jaEscalados)) continue;

    // Filtro 9: limite de escalas no mês do cadastro (limite_mensal), contando
    // os outros cultos do mês em que a pessoa já está.
    if (evitarLimiteMensal && atingiuLimiteMensal(contexto, data, pessoa)) continue;

    candidatos.push(pessoa);
  }

  return candidatos;
}

/**
 * Separa os IDs em escala externa do culto em audiovisual (sonoplastia) e
 * pregador (exceto ancião), para aplicar parâmetros distintos.
 */
function idsEscalaExternaSeparados(contexto, data) {
  const audiovisual = new Set();
  const pregador = new Set();
  const cultoDados = contexto.externosPorCulto && contexto.externosPorCulto.get(data);
  if (!cultoDados) return { audiovisual, pregador };

  if (Array.isArray(cultoDados.audiovisual)) {
    for (const id of cultoDados.audiovisual) if (typeof id === 'number') audiovisual.add(id);
  }
  if (Array.isArray(cultoDados.pregador)) {
    for (const entry of cultoDados.pregador) {
      if (typeof entry === 'number') {
        pregador.add(entry);
      } else if (entry && typeof entry === 'object') {
        if (entry.tipo && String(entry.tipo).toUpperCase() === 'ANCIAO') continue; // RF004-A
        if (typeof entry.id === 'number') pregador.add(entry.id);
      }
    }
  }
  return { audiovisual, pregador };
}

/**
 * Filtro 8: a pessoa já ocupa outra função no mesmo culto de forma conflitante?
 * Usa contexto.papeisPorCulto (Map data → Map id → Set slot) quando presente,
 * aplicando conflito_regencia / repeticao_no_culto / equipe_e_mm_mesmo_culto
 * conforme os níveis dos parâmetros; caso contrário, cai no comportamento
 * histórico (qualquer repetição no culto é bloqueio via escaladosPorCulto).
 */
function bloqueadoNoCulto(contexto, data, pessoaId, slot, par, jaEscalados) {
  const papeisPorCulto = contexto.papeisPorCulto;
  if (papeisPorCulto && papeisPorCulto.get(data)) {
    const slotsOcupados = papeisPorCulto.get(data).get(pessoaId);
    if (!slotsOcupados || slotsOcupados.size === 0) return false;
    const outros = new Set([...slotsOcupados].filter((s) => s !== slot));
    if (outros.size === 0) return false;

    const regencia = ehBloqueioAtivo(par, 'conflito_regencia');
    const repeticao = ehBloqueioAtivo(par, 'repeticao_no_culto');
    const equipeMm = ehBloqueioAtivo(par, 'equipe_e_mm_mesmo_culto');

    const envolveRegencia = slot === 'regente' || outros.has('regente');
    if (envolveRegencia) return regencia; // regente acumulando = conflito_regencia

    const slotsMm = new Set(['mm_es', 'mm_culto', 'mm_domingo']);
    const souMm = slotsMm.has(slot);
    const outroMm = [...outros].some((s) => slotsMm.has(s));
    const outroEquipe = outros.has('equipe');
    const ehEquipeEMm = (souMm && outroEquipe) || (slot === 'equipe' && outroMm);
    if (ehEquipeEMm) return equipeMm;

    return repeticao; // demais repetições
  }

  // Sem papeisPorCulto: comportamento histórico (Set de IDs já escalados).
  return jaEscalados.has(pessoaId);
}

/** A regra está ativa com nível bloqueio? */
/**
 * A pessoa já está em `limite_mensal` cultos do mês (sem contar `data`)?
 * Pessoa sem limite_mensal (null/ausente) nunca atinge o limite.
 */
function atingiuLimiteMensal(contexto, data, pessoa) {
  const limite = Number(pessoa.limite_mensal);
  if (!Number.isInteger(limite) || limite <= 0) return false;
  const porCulto = contexto.escaladosPorCulto;
  if (!porCulto) return false;
  let total = 0;
  for (const [dataCulto, ids] of porCulto) {
    if (dataCulto === data) continue;
    if (ids && ids.has(pessoa.id)) total += 1;
  }
  return total >= limite;
}

function ehBloqueioAtivo(par, chave) {
  const regra = par && par.regras && par.regras[chave];
  return !!(regra && regra.ativa === true && regra.nivel === 'bloqueio');
}
