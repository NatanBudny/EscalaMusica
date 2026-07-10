/**
 * Módulo de cálculo de score para o solver de escalas.
 * Menor score = melhor candidato (prioridade de escala).
 *
 * Componentes do score:
 * | Componente              | Peso (w) | Descrição                                              |
 * |-------------------------|----------|--------------------------------------------------------|
 * | contadorRotacao         |  1.0     | Contagem histórica no slot específico                  |
 * | penalConsecutivo        | 10.0     | +1 se cantou no culto anterior imediato (RF013)        |
 * | penalMesmoMes           | 20.0     | +1 se já aparece neste mês no mesmo papel (RF014 MM)   |
 * | bonusGrupoRegente       | -0.5     | -1 se pertence ao grupo preferencial do regente (PE004)|
 * | penalPerfilParticipacao |  5.0     | +1 se perfil_canto=participacao (PE009)                |
 * | penalRepeticaoRegente   | 15.0     | +1 se já regeu neste mês (PE007, só slot regente)      |
 * | diasDesdeUltima         | -0.3     | Normalizado: mais dias desde última = bônus            |
 *
 * Desempate: menor pessoa.id vence (determinismo garantido).
 */

/** Pesos dos componentes do score */
const PESOS = {
  contadorRotacao: 1.0,
  penalConsecutivo: 10.0,
  penalMesmoMes: 20.0,
  bonusGrupoRegente: -0.5,
  penalPerfilParticipacao: 5.0,
  penalRepeticaoRegente: 15.0,
  diasDesdeUltima: -0.3,
};

/**
 * Retorna o contador de rotação histórico para uma pessoa num dado slot.
 * @param {object} historicoPessoa - Entrada do historico para a pessoa
 * @param {'regente'|'equipe'|'mm_es'|'mm_culto'|'mm_domingo'} slot
 * @returns {number}
 */
function getContadorRotacao(historicoPessoa, slot) {
  if (!historicoPessoa) return 0;
  switch (slot) {
    case 'regente':
      return historicoPessoa.regencias || 0;
    case 'equipe':
      return historicoPessoa.escalas_equipe || 0;
    case 'mm_es':
      return historicoPessoa.mm_es || 0;
    case 'mm_culto':
      return historicoPessoa.mm_culto || 0;
    case 'mm_domingo':
      return historicoPessoa.mm_domingo || 0;
    default:
      return 0;
  }
}

/**
 * Verifica se a pessoa cantou no culto imediatamente anterior (RF013).
 * @param {object} pessoa
 * @param {string} data - ISO date do culto atual
 * @param {object} contexto
 * @returns {number} 1 se consecutivo, 0 caso contrário
 */
function calcPenalConsecutivo(pessoa, data, contexto) {
  if (!contexto.dataAnterior) return 0;
  const escaladosAnterior = contexto.escaladosPorCulto?.get(contexto.dataAnterior);
  if (!escaladosAnterior) return 0;
  return escaladosAnterior.has(pessoa.id) ? 1 : 0;
}

/**
 * Verifica se a pessoa já aparece neste mês no mesmo papel (RF014 para MM).
 * @param {object} pessoa
 * @param {'regente'|'equipe'|'mm_es'|'mm_culto'|'mm_domingo'} slot
 * @param {string} data - ISO date
 * @param {object} contexto
 * @returns {number} 1 se já escalado no mesmo slot neste mês, 0 caso contrário
 */
function calcPenalMesmoMes(pessoa, slot, data, contexto) {
  const mesAtual = data.slice(0, 7); // YYYY-MM
  const escaladosMes = contexto.escaladosNesteMes?.get(pessoa.id);
  if (!escaladosMes) return 0;

  // Verifica se a pessoa já foi escalada no mesmo slot neste mês
  if (escaladosMes.slots && escaladosMes.slots.has(slot)) {
    return 1;
  }
  return 0;
}

/**
 * Verifica se a pessoa pertence ao grupo preferencial do regente escalado (PE004).
 * O peso é negativo (-0.5), então o valor 1 resulta em bônus (redução do score).
 * @param {object} pessoa
 * @param {object} contexto
 * @returns {number} 1 se pertence ao grupo, 0 caso contrário
 */
function calcBonusGrupoRegente(pessoa, contexto) {
  if (!contexto.grupoPreferencialRegente) return 0;
  return contexto.grupoPreferencialRegente.has(pessoa.id) ? 1 : 0;
}

/**
 * Verifica se a pessoa tem perfil_canto = 'participacao' (PE009).
 * Pessoas com perfil de participação são penalizadas (prioridade menor).
 * @param {object} pessoa
 * @returns {number} 1 se participação, 0 caso contrário
 */
function calcPenalPerfilParticipacao(pessoa) {
  return pessoa.perfil_canto === 'participacao' ? 1 : 0;
}

/**
 * Verifica se o regente já regeu neste mês (PE007).
 * Aplica-se somente ao slot 'regente'.
 * @param {object} pessoa
 * @param {'regente'|'equipe'|'mm_es'|'mm_culto'|'mm_domingo'} slot
 * @param {string} data - ISO date
 * @param {object} contexto
 * @returns {number} 1 se já regeu neste mês, 0 caso contrário
 */
function calcPenalRepeticaoRegente(pessoa, slot, data, contexto) {
  if (slot !== 'regente') return 0;

  const escaladosMes = contexto.escaladosNesteMes?.get(pessoa.id);
  if (!escaladosMes) return 0;

  // Verificar se já tem o slot 'regente' registrado neste mês
  if (escaladosMes.slots && escaladosMes.slots.has('regente')) {
    return 1;
  }
  return 0;
}

/**
 * Calcula o componente "dias desde a última escala" normalizado.
 * Mais dias desde a última vez = valor maior = bônus (multiplicado por peso negativo).
 * @param {object} pessoa
 * @param {'regente'|'equipe'|'mm_es'|'mm_culto'|'mm_domingo'} slot
 * @param {string} data - ISO date do culto
 * @param {object} contexto
 * @returns {number} Valor normalizado (0-1): 1 = máximo de dias, 0 = escalado hoje/recentemente
 */
function calcDiasDesdeUltima(pessoa, slot, data, contexto) {
  const historicoPessoa = contexto.historico?.get(pessoa.id);
  if (!historicoPessoa) return 1; // Nunca escalada = máximo bônus

  let ultimaData = null;
  switch (slot) {
    case 'regente':
      ultimaData = historicoPessoa.ultima_regencia;
      break;
    case 'equipe':
      ultimaData = historicoPessoa.ultima_equipe;
      break;
    case 'mm_es':
    case 'mm_culto':
    case 'mm_domingo':
      ultimaData = historicoPessoa.ultima_mm;
      break;
  }

  if (!ultimaData) return 1; // Nunca escalada neste slot = máximo bônus

  const dataAtual = new Date(data);
  const dataUltima = new Date(ultimaData);
  const diffMs = dataAtual.getTime() - dataUltima.getTime();
  const diffDias = diffMs / (1000 * 60 * 60 * 24);

  if (diffDias <= 0) return 0;

  // Normalizar: considerar janela de 120 dias (4 meses)
  const JANELA_DIAS = 120;
  return Math.min(diffDias / JANELA_DIAS, 1);
}

/**
 * Calcula score composto para ranking de candidatos.
 * Menor score = melhor candidato (prioridade de escala).
 * @param {object} pessoa - Pessoa que passou filtros duros
 * @param {'regente'|'equipe'|'mm_es'|'mm_culto'|'mm_domingo'} slot
 * @param {string} data - ISO date (YYYY-MM-DD)
 * @param {object} contexto - Estado acumulado do solver
 * @returns {number} Score numérico (float)
 */
export function scoreCandidato(pessoa, slot, data, contexto) {
  const historicoPessoa = contexto.historico?.get(pessoa.id);

  const contadorRotacao = getContadorRotacao(historicoPessoa, slot);
  const penalConsecutivo = calcPenalConsecutivo(pessoa, data, contexto);
  const penalMesmoMes = calcPenalMesmoMes(pessoa, slot, data, contexto);
  const bonusGrupoRegente = calcBonusGrupoRegente(pessoa, contexto);
  const penalPerfilParticipacao = calcPenalPerfilParticipacao(pessoa);
  const penalRepeticaoRegente = calcPenalRepeticaoRegente(pessoa, slot, data, contexto);
  const diasDesdeUltima = calcDiasDesdeUltima(pessoa, slot, data, contexto);

  const score =
    PESOS.contadorRotacao * contadorRotacao +
    PESOS.penalConsecutivo * penalConsecutivo +
    PESOS.penalMesmoMes * penalMesmoMes +
    PESOS.bonusGrupoRegente * bonusGrupoRegente +
    PESOS.penalPerfilParticipacao * penalPerfilParticipacao +
    PESOS.penalRepeticaoRegente * penalRepeticaoRegente +
    PESOS.diasDesdeUltima * diasDesdeUltima;

  return score;
}

/**
 * Ordena candidatos por score (menor = melhor).
 * Desempate: menor pessoa.id vence (garante reprodutibilidade).
 * @param {object[]} candidatos - Lista de pessoas que passaram filtros duros
 * @param {'regente'|'equipe'|'mm_es'|'mm_culto'|'mm_domingo'} slot
 * @param {string} data - ISO date (YYYY-MM-DD)
 * @param {object} contexto - Estado acumulado do solver
 * @returns {object[]} Candidatos ordenados por score crescente
 */
export function sortByScore(candidatos, slot, data, contexto) {
  return [...candidatos]
    .map((p) => ({ pessoa: p, score: scoreCandidato(p, slot, data, contexto) }))
    .sort((a, b) => a.score - b.score || a.pessoa.id - b.pessoa.id)
    .map((x) => x.pessoa);
}
