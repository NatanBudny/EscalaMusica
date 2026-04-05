import { state } from '../state.js';
import { isPastDate, formatarDataExtenso } from '../utils/date.js';
import { estaEscalado } from '../utils/name.js';
import { formatarNome, formatarLista, formatarMusicasComYouTube } from '../utils/formatter.js';
import { gerarLinkSubstituto } from '../business/substitute.js';

/** Renders the mobile card layout for the given schedule records. */
export function montarCards(d) {
  const containerF = document.getElementById('containerFuturo');
  const containerP = document.getElementById('containerPassado');
  const divider    = document.getElementById('pastDivider');
  containerF.innerHTML = '';
  containerP.innerHTML = '';
  let hasPast = false;

  d.forEach((x, idx) => {
    const past     = isPastDate(x['DATA']);
    const card     = document.createElement('div');
    card.className = 'day-card' + (past ? ' past-card' : '');
    card.style.animationDelay = `${idx * 0.05}s`;

    const isMyScale   = state.usuarioAtual?.nomeVinculado && estaEscalado(x, state.usuarioAtual.nomeVinculado);
    const btnAgenda   = (isMyScale && !past) ? _btnAgendaHTML(x.DATA) : '';
    const btnSubs     = gerarLinkSubstituto(state.contatosMap, state.usuarioAtual, x);
    const suporte     = x['SUPORTE'];
    const textoSuporte = (suporte && suporte !== '-')
      ? ' e ' + formatarNome(state.contatosMap, state.usuarioAtual, suporte)
      : '';

    card.innerHTML = `
      <div class="card-header">
        <div class="date-pill">
          <span class="day-name">${x['DIA SEMANA']}</span>
          <span class="full-date">${formatarDataExtenso(x['DATA'])}</span>
        </div>
        <div class="card-actions">${btnSubs}${btnAgenda}</div>
      </div>
      <div class="card-grid">
        <div class="block responsaveis">
          <h4><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg> Liderança</h4>
          <div class="info-row"><span class="info-label">Ancião</span><span class="info-value">${formatarNome(state.contatosMap, state.usuarioAtual, x['ANCIÃO'] || '-')}</span></div>
          <div class="info-row"><span class="info-label">Regente</span><span class="info-value">${formatarNome(state.contatosMap, state.usuarioAtual, x['REGENTE LOUVOR'] || '-')}</span></div>
          ${x['OBS'] ? `<div class="info-row"><span class="info-label">OBS</span><span class="info-value">${x['OBS']}</span></div>` : ''}
        </div>
        <div class="block equipe">
          <h4><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg> Louvor e Áudio</h4>
          <div class="info-row"><span class="info-label">Equipe Vocal</span><span class="info-value">${formatarLista(state.contatosMap, state.usuarioAtual, x['EQUIPE LOUVOR'] || '-')}</span></div>
          <div class="info-row"><span class="info-label">Instrumentos</span><span class="info-value">${x['ACOMP'] || '-'}</span></div>
          <div class="info-row"><span class="info-label">Audiovisual</span><span class="info-value">${formatarNome(state.contatosMap, state.usuarioAtual, x['AUDIOVISUAL'] || '-')}${textoSuporte}</span></div>
          <div class="info-row"><span class="info-label">Mensagem Musical</span><span class="info-value">${formatarLista(state.contatosMap, state.usuarioAtual, x['MENSAGEM MUSICAL'] || '-')}</span></div>
        </div>
        <div class="block culto">
          <h4><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg> Detalhes do Culto</h4>
          <div class="info-row"><span class="info-label">Pregador</span><span class="info-value">${formatarNome(state.contatosMap, state.usuarioAtual, x['PREGADOR'] || '-')}</span></div>
          <div class="info-row"><span class="info-label">Tema</span><span class="info-value">${x['TEMA CULTO'] || '-'}</span></div>
          <div class="info-row"><span class="info-label">Músicas ES</span><span class="info-value">${formatarMusicasComYouTube(x['LOUVORES ES'])}</span></div>
          <div class="info-row"><span class="info-label">Músicas Culto</span><span class="info-value">${formatarMusicasComYouTube(x['LOUVORES CULTO'])}</span></div>
        </div>
      </div>`;

    if (past) { containerP.appendChild(card); hasPast = true; }
    else       { containerF.appendChild(card); }
  });

  divider.style.display = (hasPast && containerP.classList.contains('show')) ? 'flex' : 'none';
}

function _btnAgendaHTML(dataStr) {
  return `<button class="btn-agenda" onclick="exportarParaAgenda('${dataStr}')">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
      <line x1="16" y1="2" x2="16" y2="6"></line>
      <line x1="8" y1="2" x2="8" y2="6"></line>
      <line x1="3" y1="10" x2="21" y2="10"></line>
    </svg> Me lembre</button>`;
}
