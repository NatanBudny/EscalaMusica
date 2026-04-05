/** Centralised mutable application state. All UI modules read/write this object. */
export const state = {
  /** @type {Array<Object>} Schedule records loaded from atual.json */
  dadosGlobais: [],
  /** @type {Record<string, {telefone: string, apelidos: string[]}>} */
  contatosMap: {},
  /** @type {{email:string, name:string, picture:string, sub:string, nomeVinculado:string}|null} */
  usuarioAtual: null,
};
