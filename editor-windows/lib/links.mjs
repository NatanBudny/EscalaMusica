// Links externos permitidos pela Casca.
//
// A janela do Electron só pode navegar para a origem local
// (http://127.0.0.1:4599). Quando a interface tenta abrir um link externo, a
// Casca só o entrega ao navegador padrão se a URL começar por um dos três
// prefixos permitidos; qualquer outra é bloqueada.
//
// Feature: melhoras-domingao (G. Casca) — Requisito 30.8.

/** Prefixos de URL que a Casca pode abrir no navegador padrão. */
export const PREFIXOS_PERMITIDOS = [
  'https://wa.me/',
  'https://chat.whatsapp.com/',
  'https://natanbudny.github.io/EscalaMusica/',
];

/**
 * Diz se uma URL pode ser aberta no navegador padrão.
 *
 * Verdadeiro se e somente se a URL (string) começa com um dos prefixos
 * permitidos. Qualquer outro valor (incluindo não-string) é bloqueado.
 *
 * @param {unknown} url
 * @returns {boolean}
 */
export function linkPermitido(url) {
  if (typeof url !== 'string') return false;
  return PREFIXOS_PERMITIDOS.some((prefixo) => url.startsWith(prefixo));
}
