// Controle dos contatos de WhatsApp já enviados, por mês (localStorage).
// Lógica pura (ESM, sem DOM), testada em tests/montador/.
//
// A tela de WhatsApp (aberta por "vi a escala atualizada") lista os envios de
// `listaDoMes` (GET /api/whatsapp). Ao clicar num contato, o link abre e o
// contato desce para a seção "Enviados" (recolhível, com "reenviar"). O estado
// é guardado por mês no localStorage como a lista de chaves já enviadas
// (ex.: ['pessoa:DANY KALLAS', 'grupo:FAMILIA NILSINHO', 'fixo:ADELAIDE',
// 'convite:grupo-louvor']).
//
// Feature: melhoras-domingao (F. Envio) — Task 35; Property 35;
// Requisitos 25.1, 25.5, 25.6, 25.7.

/** Chave de localStorage dos enviados de um mês. */
export const chaveEnviados = (mes) => `escala:whatsapp:${mes}`;

/**
 * Marca uma chave de envio como enviada, devolvendo um novo Set (idempotente:
 * marcar a mesma chave de novo não muda o conjunto).
 *
 * @param {Iterable<string>} enviados - chaves já enviadas
 * @param {string} chave - chave do envio (ex.: 'pessoa:DANY KALLAS')
 * @returns {Set<string>}
 */
export function marcarEnviado(enviados, chave) {
  const proximo = new Set(enviados || []);
  if (chave != null && chave !== '') proximo.add(chave);
  return proximo;
}

/**
 * Particiona a lista de envios em pendentes e enviados, preservando a ordem
 * original da lista em cada grupo.
 *
 * @param {object[]} envios - Envio[] (cada um com `chave`)
 * @param {Iterable<string>} enviados - chaves já enviadas
 * @returns {{ pendentes: object[], enviados: object[] }}
 */
export function separar(envios, enviados) {
  const marcados = enviados instanceof Set ? enviados : new Set(enviados || []);
  const lista = Array.isArray(envios) ? envios : [];
  const pendentes = [];
  const enviadosLista = [];
  for (const envio of lista) {
    if (marcados.has(envio.chave)) enviadosLista.push(envio);
    else pendentes.push(envio);
  }
  return { pendentes, enviados: enviadosLista };
}
