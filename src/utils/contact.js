import { normalizarNome } from './name.js';

/**
 * Finds a contact entry by exact name or any alias.
 * @param {Record<string, {telefone: string, apelidos: string[]}>} contatosMap
 * @param {string} nome
 */
export function buscarContato(contatosMap, nome) {
  const alvo = normalizarNome(nome);
  for (const base in contatosMap) {
    if (normalizarNome(base) === alvo) return contatosMap[base];
    if ((contatosMap[base].apelidos || []).some((ap) => normalizarNome(ap) === alvo))
      return contatosMap[base];
  }
  return null;
}
