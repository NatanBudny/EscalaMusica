import { state } from '../state.js';
import { isPastDate } from '../utils/date.js';
import { estaEscalado } from '../utils/name.js';
import { formatarNome, formatarLista, formatarMusicasComYouTube } from '../utils/formatter.js';

/** Renders the full-width desktop `<table>` with the given schedule records. */
export function montarTabela(d) {
  const tb = document.getElementById('tableBody');
  tb.innerHTML = '';
  d.forEach((x) => {
    const past = isPastDate(x['DATA']);
    const tr = document.createElement('tr');
    if (past) tr.style.opacity = '0.5';

    const isMyScale = state.usuarioAtual?.nomeVinculado && estaEscalado(x, state.usuarioAtual.nomeVinculado);
    const btnAgenda = (isMyScale && !past)
      ? `<button class="btn-agenda" onclick="exportarParaAgenda('${x['DATA']}')" title="Adicionar à agenda">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
            <line x1="16" y1="2" x2="16" y2="6"></line>
            <line x1="8" y1="2" x2="8" y2="6"></line>
            <line x1="3" y1="10" x2="21" y2="10"></line>
          </svg> Me lembre</button>`
      : '';

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
      `<td>${formatarNome(state.contatosMap, state.usuarioAtual, x['PREGADOR'] || '')}</td>` +
      `<td>${btnAgenda}</td>`;
    tb.appendChild(tr);
  });
}
