// Colagem confirmada de valores de texto (ex.: lista de aliases).
//
// A UI NUNCA aceita JSON livre nem estruturas arbitrarias (requisito 1.7: o
// fluxo bloqueia qualquer acao que exigiria editar JSON). Quando o Operador
// cola um bloco de texto, este modulo o transforma em uma lista de valores
// simples (um por linha ou separados por `;`/`,`), normaliza cada valor e
// apresenta um RESUMO para confirmacao explicita antes de aplicar.
//
// Qualquer entrada que pareca JSON (comeca por `{`, `[` ou `"` apos o trim, ou
// contem pares chave/valor com dois-pontos entre chaves) e REJEITADA com uma
// mensagem em portugues, para impedir a entrada de estruturas internas.

import { normalizeName } from '../../domain/registry/identity';

/** Resultado da analise de um bloco colado. */
export type PasteParseResult = { ok: true; values: string[] } | { ok: false; reason: string };

const LOOKS_LIKE_JSON_START = /^[[{"]/;

/**
 * Analisa um bloco de texto colado em uma lista de valores simples.
 *
 * - Separa por quebras de linha e tambem por `;` e `,`.
 * - Normaliza cada valor (trim + colapso de espacos) e descarta vazios.
 * - Remove duplicatas preservando a ordem de primeira aparicao.
 * - Rejeita conteudo que pareca JSON/estrutura (requisito 1.7).
 */
export function parsePastedValues(raw: string): PasteParseResult {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: false, reason: 'Nada para colar: o conteudo esta vazio.' };
  }
  if (LOOKS_LIKE_JSON_START.test(trimmed)) {
    return {
      ok: false,
      reason:
        'Conteudo parece JSON ou estrutura de dados. Cole apenas nomes/apelidos, um por linha; a edicao de JSON nao e permitida.',
    };
  }

  const pieces = trimmed
    .split(/[\n\r;,]+/u)
    .map((piece) => normalizeName(piece))
    .filter((piece) => piece.length > 0);

  if (pieces.length === 0) {
    return { ok: false, reason: 'Nenhum valor valido encontrado no conteudo colado.' };
  }

  const seen = new Set<string>();
  const values: string[] = [];
  for (const value of pieces) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    values.push(value);
  }

  return { ok: true, values };
}
