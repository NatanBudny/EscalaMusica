import { normalizarNome } from './name.js';
import { buscarContato } from './contact.js';

const YT_SVG = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M21.582,6.186c-0.23-0.86-0.908-1.538-1.768-1.768C18.254,4,12,4,12,4S5.746,4,4.186,4.418c-0.86,0.23-1.538,0.908-1.768,1.768C2,7.746,2,12,2,12s0,4.254,0.418,5.814c0.23,0.86,0.908,1.538,1.768,1.768C5.746,20,12,20,12,20s6.254,0,7.814-0.418c0.86-0.23,1.538-0.908,1.768-1.768C22,16.254,22,12,22,12S22,7.746,21.582,6.186z M10,15.464V8.536L16,12L10,15.464z"/></svg>`;

/** Returns the name wrapped in a WhatsApp link if a contact exists; otherwise plain text. */
export function linkarNome(contatosMap, nome) {
  if (!nome || nome === '-') return nome || '';
  const c = buscarContato(contatosMap, nome);
  return c?.telefone
    ? `<a class="whats" href="${c.telefone}" target="_blank" title="Mandar WhatsApp">${nome}</a>`
    : nome;
}

/**
 * Returns the name with a WhatsApp link and, if it belongs to the current user,
 * wraps it in a `.highlight-me` span.
 */
export function formatarNome(contatosMap, usuarioAtual, nome) {
  if (!nome || nome === '-') return nome || '';
  let html = linkarNome(contatosMap, nome);
  if (
    usuarioAtual?.nomeVinculado &&
    normalizarNome(nome) === normalizarNome(usuarioAtual.nomeVinculado)
  ) {
    html = `<span class="highlight-me">${html}</span>`;
  }
  return html;
}

/** Maps a comma-separated list of names through `formatarNome` and joins with ", ". */
export function formatarLista(contatosMap, usuarioAtual, txt) {
  if (!txt || txt === '-') return '-';
  return txt
    .split(',')
    .map((n) => formatarNome(contatosMap, usuarioAtual, n.trim()))
    .join(', ');
}

/** Converts a pipe-separated song list into HTML divs, each with a YouTube search link. */
export function formatarMusicasComYouTube(texto) {
  if (!texto || texto === '-') return '-';
  return texto
    .split('|')
    .map((musica) => {
      const m = musica.trim();
      if (!m) return '';
      const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(m + ' música louvor')}`;
      return `<div style="display:flex; align-items:center; gap:4px; margin-bottom:6px; line-height:1.2;"><a href="${url}" target="_blank" style="color:inherit;text-decoration:none;" title="Ouvir no YouTube">${m}</a> <a href="${url}" target="_blank" class="yt-icon" title="Ouvir no YouTube">${YT_SVG}</a></div>`;
    })
    .join('');
}
