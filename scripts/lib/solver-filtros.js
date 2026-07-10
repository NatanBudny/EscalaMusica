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

/** Slots válidos reconhecidos pelo solver */
const SLOTS_VALIDOS = new Set(['regente', 'equipe', 'mm_es', 'mm_culto', 'mm_domingo']);

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
 * Retorna os IDs que estão em escala externa (audiovisual/pregador) para o culto.
 * Exceção RF004-A: ANCIÃO (pregador tipo ancião) não bloqueia.
 * @param {object} contexto - Contexto do solver
 * @param {string} data - ISO date
 * @returns {Set<number>} Set de IDs em escala externa
 */
function idsEscalaExterna(contexto, data) {
  const externos = new Set();

  if (!contexto.externosPorCulto) return externos;

  const cultoDados = contexto.externosPorCulto.get(data);
  if (!cultoDados) return externos;

  // Audiovisual sempre bloqueia
  if (Array.isArray(cultoDados.audiovisual)) {
    for (const id of cultoDados.audiovisual) {
      if (typeof id === 'number') {
        externos.add(id);
      }
    }
  }

  // Pregador bloqueia, exceto tipo ANCIÃO (RF004-A)
  if (Array.isArray(cultoDados.pregador)) {
    for (const entry of cultoDados.pregador) {
      if (typeof entry === 'number') {
        externos.add(entry);
      } else if (typeof entry === 'object' && entry !== null) {
        // Se for objeto com tipo, verificar exceção ANCIÃO
        if (entry.tipo && entry.tipo.toUpperCase() === 'ANCIAO') {
          // Ancião não bloqueia (RF004-A)
          continue;
        }
        if (typeof entry.id === 'number') {
          externos.add(entry.id);
        }
      }
    }
  }

  return externos;
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
  const diaDoEvento = diaDaSemana(data);

  // Pré-computar sets de IDs para filtros 5-8
  const indisponiveisData = idsIndisponiveisNaData(indisponibilidade, data);
  const indisponivelMes = idsIndisponivelMesInteiro(indisponibilidade);
  const externosCulto = idsEscalaExterna(contexto, data);
  const jaEscalados = idsJaEscaladosNoCulto(contexto, data);

  const candidatos = [];

  for (const pessoa of todasPessoas) {
    // Filtro 1: ativo === true
    if (pessoa.ativo !== true) continue;

    // Filtro 2: afastado === null OU afastado.ativo === false
    if (pessoa.afastado !== null && pessoa.afastado.ativo === true) continue;

    // Filtro 3: Habilitação correspondente ao slot
    if (!temHabilitacao(pessoa, slot)) continue;

    // Filtro 4: dias_permitidos === null OU inclui o dia da semana
    if (pessoa.dias_permitidos !== null) {
      if (!Array.isArray(pessoa.dias_permitidos) || !pessoa.dias_permitidos.includes(diaDoEvento)) {
        continue;
      }
    }

    // Filtro 5: Não está indisponível na data específica
    if (indisponiveisData.has(pessoa.id)) continue;

    // Filtro 6: Não está indisponível o mês inteiro
    if (indisponivelMes.has(pessoa.id)) continue;

    // Filtro 7: Não está em escala externa (audiovisual/pregador, exceto ancião)
    if (externosCulto.has(pessoa.id)) continue;

    // Filtro 8: Não já escalado no mesmo culto
    if (jaEscalados.has(pessoa.id)) continue;

    candidatos.push(pessoa);
  }

  return candidatos;
}
