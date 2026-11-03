// Fonte única das regras de contexto do culto (RF005, RF015, "-"/vazio) usadas
// por montagem, validação, publicação, controles e WhatsApp.
//
// DEPARTAMENTOS e ehDepartamental continuam definidos em regras.mjs (para
// manter a compatibilidade com quem já os importava de lá) e são reexportados
// aqui. As demais funções de contexto nascem neste módulo.
//
// Feature: melhoras-domingao (E. Montagem) — Task 15; Requisitos 12.x, 17.4, 29.x.

import { DEPARTAMENTOS, ehDepartamental } from './regras.mjs';

export { DEPARTAMENTOS, ehDepartamental };

/** Normaliza o dia da semana (sem acento, minúsculo, trim). */
function normalizarDia(dia) {
  return String(dia || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Classifica um culto (objeto com dia_semana/modelo_louvor/pregador) em
 * 'louvor' | 'quarta' | 'departamental' | 'sem_louvor'.
 *
 * Regras:
 * - dia_semana 'quarta-feira' → 'quarta';
 * - pregador departamental → 'departamental';
 * - modelo_louvor 'sem_louvor' → 'sem_louvor';
 * - caso contrário → 'louvor'.
 */
export function tipoDoCulto(culto) {
  if (!culto) return 'louvor';
  const dia = normalizarDia(culto.dia_semana || culto.dia);
  if (dia === 'quarta-feira') return 'quarta';
  if (ehDepartamental(culto.pregador)) return 'departamental';
  if ((culto.modelo_louvor || '') === 'sem_louvor') return 'sem_louvor';
  return 'louvor';
}

/** Mesmo enum para uma linha de atual.json (campos em maiúsculas). */
export function tipoDaLinhaAtual(linha) {
  if (!linha) return 'louvor';
  const dia = normalizarDia(linha['DIA SEMANA'] || linha.dia_semana);
  if (dia === 'quarta-feira') return 'quarta';
  const pregador = linha.PREGADOR || linha.pregador;
  if (ehDepartamental(pregador)) return 'departamental';
  return 'louvor';
}

/**
 * Slots de um culto conforme o Modelo_de_Louvor:
 * - sabado → ['regente','equipe','mm_es','mm_culto'] (mm_es some se mm_sabado.quantidade = 1);
 * - domingo → ['regente','equipe','mm_domingo'];
 * - demais tipos → [].
 *
 * @param {object} culto
 * @param {object} [parametros] - parâmetros executáveis (mm_sabado.valores.quantidade)
 * @returns {string[]}
 */
export function slotsDoCulto(culto, parametros) {
  const tipo = tipoDoCulto(culto);
  if (tipo !== 'louvor') return [];
  const modelo = culto.modelo_louvor || modeloPorDiaSemana(culto.dia_semana || culto.dia);
  if (modelo === 'sabado') {
    const q =
      (parametros && parametros.regras && parametros.regras.mm_sabado &&
        parametros.regras.mm_sabado.valores &&
        parametros.regras.mm_sabado.valores.quantidade) || 2;
    return q <= 1
      ? ['regente', 'equipe', 'mm_culto']
      : ['regente', 'equipe', 'mm_es', 'mm_culto'];
  }
  if (modelo === 'domingo') return ['regente', 'equipe', 'mm_domingo'];
  return [];
}

/** Modelo de louvor padrão derivado do dia da semana. */
export function modeloPorDiaSemana(dia) {
  const d = normalizarDia(dia);
  if (d === 'sabado') return 'sabado';
  if (d === 'domingo') return 'domingo';
  return 'sem_louvor'; // quarta e demais
}

/**
 * Divide um valor de campo em nomes de participantes, ignorando '', '-' e
 * nomes de Departamento. O nome_exibicao de um Grupo_Escalavel conta como
 * participante (não é departamento).
 *
 * @param {string} valor
 * @returns {string[]}
 */
export function nomesParticipantes(valor) {
  return String(valor || '')
    .split(',')
    .map((n) => n.trim())
    .filter((n) => n && n !== '-' && !ehDepartamental(n));
}

/** Ocupante de grupo? ('grupo:<chave>'). */
export function ehOcupanteGrupo(ocupante) {
  return typeof ocupante === 'string' && ocupante.startsWith('grupo:');
}

/**
 * Adapta os cultos para o resumo de participação (participacao.mjs), que usa
 * dia_semana para classificar o culto e campos com nomes separados por vírgula.
 * Aqui dia_semana recebe o modelo_louvor (para um Dia_Extraordinario contar
 * como o modelo escolhido) e as atribuições por ID/'grupo:<chave>' são
 * resolvidas para nomes. Modelo `sem_louvor` fica de fora (tratado como quarta).
 *
 * @param {object[]} cultos - CultoMontagem (ocupantes por ID/nome/'grupo:<chave>')
 * @param {object} [cadastro] - { porId, grupos } para resolver nomes
 * @returns {object[]}
 */
export function paraParticipacao(cultos, cadastro) {
  const lista = Array.isArray(cultos) ? cultos : [];
  const porId = cadastro && cadastro.porId ? cadastro.porId : new Map();
  const grupos = cadastro && cadastro.grupos ? cadastro.grupos : new Map();

  const nome = (valor) => {
    if (valor == null || valor === '') return '';
    if (typeof valor === 'number') return (porId.get(valor) || {}).nome || '';
    if (typeof valor === 'string' && valor.startsWith('grupo:')) {
      const g = grupos.get(valor.slice('grupo:'.length));
      return g ? g.nome_exibicao : '';
    }
    return String(valor);
  };
  const juntar = (campo) => {
    if (campo == null) return '';
    if (Array.isArray(campo)) return campo.map(nome).filter(Boolean).join(', ');
    return nome(campo);
  };

  return lista.map((culto) => {
    const modelo = culto.modelo_louvor || modeloPorDiaSemana(culto.dia_semana || culto.dia);
    // mm pode ser objeto {slot: ocupante} ou array.
    let mm = '';
    if (culto.mm && !Array.isArray(culto.mm) && typeof culto.mm === 'object') {
      mm = Object.values(culto.mm).map(nome).filter(Boolean).join(', ');
    } else {
      mm = juntar(culto.mm);
    }
    return {
      ...culto,
      dia_semana: modelo === 'sem_louvor' ? 'quarta-feira' : modelo,
      regente: juntar(culto.regente),
      equipe: juntar(culto.equipe),
      mm,
    };
  });
}
