/**
 * texto-publico.js
 *
 * Regras do que o viewer da escala online exibe sem escape. Nome, apelido e
 * nome_exibicao só podem conter Caracteres_de_Nome (letras com acento, espaço,
 * ponto, apóstrofo e hífen). Vírgula e demais caracteres ficam de fora, porque
 * a vírgula separa participantes e os símbolos poderiam quebrar o HTML.
 *
 * Feature: melhoras-domingao (B. Cadastro) — Property 29; Requisitos 4.9, 6.2.
 */

/** Letras (com acento), espaço, ponto, apóstrofo e hífen. */
export const CARACTERES_DE_NOME = /^[\p{L} .'-]+$/u;

/**
 * Lista os problemas de um nome/apelido/nome_exibicao.
 * Recusa vazio e qualquer caractere fora de CARACTERES_DE_NOME (inclui vírgula
 * e dígitos).
 *
 * @param {string} texto
 * @returns {string[]} problemas (vazio = ok)
 */
export function problemasNome(texto) {
  const valor = String(texto == null ? '' : texto);
  const problemas = [];
  if (valor.trim() === '') {
    problemas.push('Nome vazio.');
    return problemas;
  }
  if (!CARACTERES_DE_NOME.test(valor)) {
    // Coleta os caracteres inválidos distintos para a mensagem.
    const invalidos = [...new Set([...valor].filter((c) => !CARACTERES_DE_NOME.test(c)))];
    problemas.push(
      `Caractere não permitido em nome: ${invalidos.map((c) => `"${c}"`).join(', ')}.`,
    );
  }
  return problemas;
}

import { termoProibido } from './obs-publico.js';

/**
 * Lista os problemas de um texto livre (ANCIÃO, PREGADOR): recusa "<" e ">".
 *
 * @param {string} texto
 * @returns {string[]} problemas (vazio = ok)
 */
export function problemasTextoLivre(texto) {
  const valor = String(texto == null ? '' : texto);
  const problemas = [];
  if (valor.includes('<') || valor.includes('>')) {
    problemas.push('Texto não pode conter "<" ou ">".');
  }
  return problemas;
}

/**
 * Lista os problemas de uma Observação pública do card: recusa "<", ">" e os
 * termos proibidos de obs-publico.js. Diferente do script de linha de comando,
 * NÃO exige o prefixo "PUBLICAR:".
 *
 * @param {string} texto
 * @returns {string[]} problemas (vazio = ok)
 */
export function problemasObs(texto) {
  const valor = String(texto == null ? '' : texto);
  const problemas = [];
  if (valor.includes('<') || valor.includes('>')) {
    problemas.push('Observação não pode conter "<" ou ">".');
  }
  const termo = termoProibido(valor);
  if (termo) {
    problemas.push('Observação contém termo não permitido para publicação.');
  }
  return problemas;
}
