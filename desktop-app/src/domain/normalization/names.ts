// Normalizacao canonica de nomes e aliases do Cadastro_Central.
//
// Regra de normalizacao (Requisito 3.6):
//  - remover espacos no inicio e no fim;
//  - substituir cada sequencia interna de espacos por um unico espaco;
//  - preservar as demais letras e sinais informados (nao destrutiva).
//
// Esta normalizacao NAO altera a caixa (maiusculas/minusculas) nem remove
// diacriticos. A unicidade de identidade (casefold Unicode) e tratada
// separadamente; aqui apenas padronizamos o espacamento do valor exibido.
//
// Observacoes sobre "espaco": consideramos espaco todo caractere de espaco em
// branco Unicode (classe \s do JavaScript, que inclui espaco comum, tabulacao,
// quebras de linha, espacos tipograficos como U+00A0 etc.). Qualquer sequencia
// de um ou mais desses caracteres entre dois caracteres nao-espaco e colapsada
// para um unico espaco comum (U+0020). Qualquer caractere que nao seja espaco
// em branco e preservado exatamente como informado.

/** Conjunto de espacos em branco (Unicode) usado para trim e colapso. */
const WHITESPACE_RUN = /\s+/gu;
const LEADING_WHITESPACE = /^\s+/u;
const TRAILING_WHITESPACE = /\s+$/u;

/**
 * Normaliza um nome canonico ou alias conforme o Requisito 3.6.
 *
 * - remove espacos nas extremidades;
 * - colapsa cada sequencia interna de espacos em um unico espaco comum;
 * - preserva todas as demais letras e sinais.
 *
 * E idempotente: `normalizeName(normalizeName(x)) === normalizeName(x)`.
 */
export function normalizeName(value: string): string {
  // Remove espacos no inicio e no fim.
  const trimmed = value.replace(LEADING_WHITESPACE, '').replace(TRAILING_WHITESPACE, '');
  // Colapsa sequencias internas de espacos em um unico espaco comum.
  return trimmed.replace(WHITESPACE_RUN, ' ');
}
