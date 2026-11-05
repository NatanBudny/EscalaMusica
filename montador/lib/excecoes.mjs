// Exceções a regras confirmadas pelo diretor (decisão de 05/11/2026).
//
// Um bloqueio de regra de escala (ex.: Juliana Alves num domingo, regra de
// dia permitido) não impede mais a publicação quando o diretor confirma que
// está violando a regra de propósito. A confirmação é registrada fora do site,
// em escalas/AAAA/MM/excecoes.json, e nunca vai para a OBS pública.
//
// Só os bloqueios de regra (validarEscala) são "excecionáveis". Continuam sem
// exceção: nome fora do cadastro, falta de telefone, OBS pública inválida,
// catálogo de regras quebrado e conferência de links — sem eles o site
// publicaria dado errado ou link quebrado.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Chaves de bloqueio que nunca aceitam exceção. */
// `regente_vazio`: culto sem regente não é escolha do diretor, é vaga aberta.
export const SEM_EXCECAO = new Set(['fora_do_cadastro', 'sem_telefone', 'obs', 'catalogo', 'ajuste', 'regente_vazio']);

/** O item de validação pode ser liberado por exceção do diretor? */
export function ehExcecionavel(item) {
  if (!item || typeof item !== 'object') return false;
  const chave = String(item.chave || '');
  if (SEM_EXCECAO.has(chave) || chave.startsWith('conferencia_')) return false;
  return item.nivel === 'bloqueio';
}

/** Marca cada erro de regra com `excecionavel: true` (os demais ficam como estão). */
export function marcarExcecionaveis(erros) {
  return (Array.isArray(erros) ? erros : []).map((e) => (ehExcecionavel(e) ? { ...e, excecionavel: true } : e));
}

/**
 * Separa os erros em pendentes (impedem publicar) e exceções confirmadas.
 *
 * @param {object[]} erros - ItemValidacao[] (com `excecionavel` quando cabe)
 * @param {string[]} excecoes - ids confirmados pelo diretor
 * @returns {{ pendentes: object[], confirmadas: object[] }}
 */
export function separarExcecoes(erros, excecoes = []) {
  const ids = new Set(Array.isArray(excecoes) ? excecoes : []);
  const pendentes = [];
  const confirmadas = [];
  for (const e of Array.isArray(erros) ? erros : []) {
    if (e && e.excecionavel === true && ids.has(e.id)) confirmadas.push(e);
    else pendentes.push(e);
  }
  return { pendentes, confirmadas };
}

/** Caminho relativo do registro de exceções do mês. */
export function caminhoExcecoes(mes) {
  const [ano, mm] = String(mes).split('-');
  return `escalas/${ano}/${mm}/excecoes.json`;
}

/**
 * Monta o conteúdo novo de escalas/AAAA/MM/excecoes.json acrescentando as
 * exceções confirmadas às já registradas (o arquivo só cresce).
 *
 * @param {string} mes - 'AAAA-MM'
 * @param {object[]} confirmadas - itens de separarExcecoes
 * @param {{ root: string, autor?: string, origem?: string, agora?: Date }} opts
 * @returns {{ rel: string, dados: object } | null} null quando não há exceção
 */
export function registroExcecoes(mes, confirmadas, { root, autor = '', origem = 'fechamento', agora = new Date() }) {
  if (!Array.isArray(confirmadas) || confirmadas.length === 0) return null;
  const rel = caminhoExcecoes(mes);
  const abs = resolve(root, rel);
  let anterior = { mes, excecoes: [] };
  if (existsSync(abs)) {
    try {
      const lido = JSON.parse(readFileSync(abs, 'utf8'));
      if (lido && Array.isArray(lido.excecoes)) anterior = lido;
    } catch {
      /* arquivo ilegível: recomeça, o histórico do git guarda o anterior */
    }
  }
  const confirmadoEm = agora.toISOString();
  const novas = confirmadas.map((e) => ({
    id: e.id,
    regra: e.chave,
    refs: e.refs || [],
    data: e.data || null,
    funcao: e.slot || null,
    texto: e.texto || '',
    origem,
    confirmado_por: autor,
    confirmado_em: confirmadoEm,
  }));
  return { rel, dados: { mes, excecoes: [...anterior.excecoes, ...novas] } };
}
