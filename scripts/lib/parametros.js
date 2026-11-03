/**
 * parametros.js
 *
 * Parâmetros executáveis das regras aplicadas pelo código (Solver, candidatos e
 * validação). Os valores padrão (PARAMETROS_PADRAO) reproduzem exatamente o
 * comportamento anterior à refatoração; o solver passa a ler esses valores em
 * vez de constantes embutidas.
 *
 * Feature: melhoras-domingao (C. Regras) — Property 13; Requisitos 10.1 a 10.9.
 */

import { readFileSync, existsSync } from 'node:fs';

/** Valores iniciais = comportamento atual (congelado na regressão de julho/2026). */
export const PARAMETROS_PADRAO = {
  versao: 1,
  regras: {
    indisponibilidade: { refs: ['RF026'], ativa: true, nivel: 'bloqueio' },
    conflito_sonoplastia: { refs: ['RF002'], ativa: true, nivel: 'bloqueio' },
    conflito_regencia: {
      refs: [],
      ativa: true,
      nivel: 'bloqueio',
      descricao: 'Regente não acumula outra função no culto (citada como RF019 no código)',
    },
    repeticao_no_culto: { refs: [], ativa: true, nivel: 'bloqueio' },
    conflito_pregador: { refs: ['RF004'], ativa: true, nivel: 'aviso', evitar_na_sugestao: true },
    equipe_e_mm_mesmo_culto: { refs: [], ativa: true, nivel: 'aviso', evitar_na_sugestao: true },
    minimo_homens: { refs: ['RF001'], ativa: true, nivel: 'aviso', valores: { minimo: 1 } },
    mm_sabado: { refs: ['RF012'], ativa: true, valores: { quantidade: 2 } },
    mm_por_mes: { refs: ['RF014'], ativa: true, nivel: 'aviso', valores: { maximo: 1 } },
    consecutivo: { refs: ['PE006', 'PE009'], ativa: true, nivel: 'aviso' },
    equipe_incompleta: { refs: [], ativa: true, nivel: 'aviso' },
    regente_vazio: { refs: [], ativa: true, nivel: 'bloqueio' },
    mm_vazia: { refs: ['RF012'], ativa: true, nivel: 'aviso' },
  },
  equipe: { tamanho: 5 },
  historico: { janela_meses: 4 },
  score: {
    pesos: {
      contadorRotacao: 1.0,
      penalConsecutivo: 10.0,
      penalMesmoMes: 20.0,
      bonusGrupoRegente: -0.5,
      penalPerfilParticipacao: 5.0,
      penalRepeticaoRegente: 15.0,
      diasDesdeUltima: -0.3,
    },
    janela_dias_normalizacao: 120,
  },
};

const NIVEIS_VALIDOS = new Set(['bloqueio', 'aviso']);

/** Cópia profunda simples dos padrões. */
function clonarPadrao() {
  return JSON.parse(JSON.stringify(PARAMETROS_PADRAO));
}

/**
 * Carrega os parâmetros de um caminho. Arquivo ausente ou inválido → padrão +
 * aviso. Sempre devolve um objeto completo (mesclado com os padrões).
 *
 * @param {string} caminho
 * @returns {{ parametros: object, avisos: string[] }}
 */
export function carregarParametros(caminho) {
  if (!caminho || !existsSync(caminho)) {
    return { parametros: clonarPadrao(), avisos: ['parametros.json ausente — usando valores padrão.'] };
  }
  let obj;
  try {
    obj = JSON.parse(readFileSync(caminho, 'utf8'));
  } catch (e) {
    return {
      parametros: clonarPadrao(),
      avisos: [`parametros.json inválido (${e.message}) — usando valores padrão.`],
    };
  }
  const problemas = validarParametros(obj);
  if (problemas.length > 0) {
    return {
      parametros: clonarPadrao(),
      avisos: [`parametros.json inválido — usando valores padrão. ${problemas.join('; ')}`],
    };
  }
  return { parametros: mesclarComPadrao(obj), avisos: [] };
}

/** Mescla o objeto carregado sobre os padrões (preserva chaves ausentes). */
function mesclarComPadrao(obj) {
  const base = clonarPadrao();
  return {
    versao: obj.versao != null ? obj.versao : base.versao,
    regras: { ...base.regras, ...(obj.regras || {}) },
    equipe: { ...base.equipe, ...(obj.equipe || {}) },
    historico: { ...base.historico, ...(obj.historico || {}) },
    score: {
      pesos: { ...base.score.pesos, ...((obj.score && obj.score.pesos) || {}) },
      janela_dias_normalizacao:
        (obj.score && obj.score.janela_dias_normalizacao) || base.score.janela_dias_normalizacao,
    },
  };
}

/**
 * Valida a estrutura de um objeto de parâmetros.
 * @param {object} obj
 * @returns {string[]} problemas (vazio = ok)
 */
export function validarParametros(obj) {
  const problemas = [];
  if (!obj || typeof obj !== 'object') {
    problemas.push('parametros deve ser um objeto.');
    return problemas;
  }
  if (!obj.regras || typeof obj.regras !== 'object') {
    problemas.push('parametros.regras ausente ou inválido.');
  } else {
    for (const [chave, def] of Object.entries(obj.regras)) {
      if (!def || typeof def !== 'object') {
        problemas.push(`regra "${chave}" deve ser um objeto.`);
        continue;
      }
      if (typeof def.ativa !== 'boolean') {
        problemas.push(`regra "${chave}": "ativa" deve ser booleano.`);
      }
      // nivel é opcional em regras sem nível (ex.: mm_sabado só tem valores).
      if (def.nivel != null && !NIVEIS_VALIDOS.has(def.nivel)) {
        problemas.push(`regra "${chave}": "nivel" deve ser "bloqueio" ou "aviso".`);
      }
    }
  }
  if (obj.equipe && typeof obj.equipe.tamanho !== 'number') {
    problemas.push('equipe.tamanho deve ser número.');
  }
  if (obj.historico && typeof obj.historico.janela_meses !== 'number') {
    problemas.push('historico.janela_meses deve ser número.');
  }
  if (obj.score) {
    if (obj.score.pesos && typeof obj.score.pesos !== 'object') {
      problemas.push('score.pesos deve ser um objeto.');
    }
    if (
      obj.score.janela_dias_normalizacao != null &&
      typeof obj.score.janela_dias_normalizacao !== 'number'
    ) {
      problemas.push('score.janela_dias_normalizacao deve ser número.');
    }
  }
  return problemas;
}

/**
 * Nível efetivo de uma regra: 'bloqueio' | 'aviso' | null (null = inativa).
 * @param {object} parametros
 * @param {string} chave
 * @returns {'bloqueio'|'aviso'|null}
 */
export function nivel(parametros, chave) {
  const regra = parametros && parametros.regras && parametros.regras[chave];
  if (!regra || regra.ativa !== true) return null;
  return regra.nivel || null;
}

/**
 * A regra deve ser evitada na sugestão automática?
 * Ativa E (nível bloqueio OU evitar_na_sugestao).
 * @param {object} parametros
 * @param {string} chave
 * @returns {boolean}
 */
export function evitarNaSugestao(parametros, chave) {
  const regra = parametros && parametros.regras && parametros.regras[chave];
  if (!regra || regra.ativa !== true) return false;
  return regra.nivel === 'bloqueio' || regra.evitar_na_sugestao === true;
}

/** Valor de uma regra parametrizada (ex.: mm_por_mes.maximo). */
export function valorRegra(parametros, chave, campo, padrao = undefined) {
  const regra = parametros && parametros.regras && parametros.regras[chave];
  if (!regra || !regra.valores) return padrao;
  return regra.valores[campo] != null ? regra.valores[campo] : padrao;
}
