import { state } from '../state.js';
import { isPastDate } from '../utils/date.js';
import { formatarNome, formatarLista, formatarMusicasComYouTube } from '../utils/formatter.js';

/** Renders the full-width desktop `<table>` with the given schedule records. */
export function montarTabela(d) {
  const tb = document.getElementById('tableBody');
  tb.innerHTML = '';
  d.forEach((x) => {
    const tr = document.createElement('tr');
    if (isPastDate(x['DATA'])) tr.style.opacity = '0.5';
    tr.innerHTML =
      `<td>${x['DATA']}<br><small style="color:var(--text-muted)">${x['DIA SEMANA']}</small></td>` +
      `<td>${x['ACOMP'] || '-'}</td>` +
      `<td>${formatarNome(state.contatosMap, state.usuarioAtual, x['REGENTE LOUVOR'])}</td>` +
      `<td>${formatarLista(state.contatosMap, state.usuarioAtual, x['EQUIPE LOUVOR'])}</td>` +
      `<td>${formatarLista(state.contatosMap, state.usuarioAtual, x['MENSAGEM MUSICAL'] || '')}</td>` +
      `<td>${formatarMusicasComYouTube(x['LOUVORES ES'])}</td>` +
      `<td>${formatarMusicasComYouTube(x['LOUVORES CULTO'])}</td>` +
      `<td>${x['TEMA CULTO'] || '-'}</td>` +
      `<td>${formatarNome(state.contatosMap, state.usuarioAtual, x['AUDIOVISUAL'] || '')}</td>` +
      `<td>${formatarNome(state.contatosMap, state.usuarioAtual, x['ANCIÃO'] || '')}</td>` +
      `<td>${formatarNome(state.contatosMap, state.usuarioAtual, x['PREGADOR'] || '')}</td>`;
    tb.appendChild(tr);
  });
}
