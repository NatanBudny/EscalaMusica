import { state } from './state.js';
import { STORAGE_KEYS } from './config.js';
import { carregarCSV } from './data/loader.js';
import { verificarAutenticacao, mostrarAuth, salvarNomeVinculado } from './auth/auth.js';
import { estaEscalado } from './utils/name.js';
import { getDetalhesAgenda } from './business/agenda.js';
import { renderizar, aplicarFiltros, aplicarFiltroAutomatico } from './ui/filters.js';

// ── Functions exposed to inline onclick handlers in the HTML ──────────────────

window.salvarNomeVinculado = salvarNomeVinculado;

window.exportarParaAgenda = (dataStr) => {
  if (!state.usuarioAtual?.nomeVinculado) return;
  const registro = state.dadosGlobais.find((r) => r.DATA === dataStr);
  if (!registro) return;

  const detalhes   = getDetalhesAgenda(registro, state.usuarioAtual.nomeVinculado);
  const [dia, mes, ano] = registro.DATA.split('/');
  const diaSemana  = (registro['DIA SEMANA'] || '').toUpperCase();

  let horaInicio = '194500', horaFim = '210000';
  if (diaSemana.includes('SÁBADO') || diaSemana.includes('SABADO')) {
    horaInicio = '083000'; horaFim = '120000';
  } else if (diaSemana.includes('DOMINGO')) {
    horaInicio = '184500'; horaFim = '200000';
  }

  const alarmes = [
    'BEGIN:VALARM\nTRIGGER:-PT12H\nACTION:DISPLAY\nDESCRIPTION:Lembrete de Escala\nEND:VALARM',
    'BEGIN:VALARM\nTRIGGER:-P1D\nACTION:DISPLAY\nDESCRIPTION:Lembrete de Escala\nEND:VALARM',
    'BEGIN:VALARM\nTRIGGER:-P3D\nACTION:DISPLAY\nDESCRIPTION:Lembrete de Escala\nEND:VALARM',
    'BEGIN:VALARM\nTRIGGER:-P1W\nACTION:DISPLAY\nDESCRIPTION:Lembrete de Escala\nEND:VALARM',
  ].join('\n');

  const icsContent = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Escala de Louvor//PT', 'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `DTSTART:${ano}${mes}${dia}T${horaInicio}`,
    `DTEND:${ano}${mes}${dia}T${horaFim}`,
    `SUMMARY:${detalhes.papel}`,
    `DESCRIPTION:${detalhes.descricao}`,
    alarmes,
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\n');

  const blob     = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
  const fileName = `Escala_${ano}${mes}${dia}.ics`;

  // On a touch-capable mobile device the browser hands the .ics directly to the
  // native calendar app, so keep the original download flow.  On desktop the
  // file lands in Downloads with no visible action, so show a small modal that
  // lets the user pick between Google Calendar (opens the web UI pre-filled)
  // or a plain .ics download for Outlook / Apple Calendar.
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (isMobile) {
    _baixarICS(blob, fileName);
  } else {
    const dtStart  = `${ano}${mes}${dia}T${horaInicio}`;
    const dtEnd    = `${ano}${mes}${dia}T${horaFim}`;
    const googleUrl =
      'https://calendar.google.com/calendar/render?action=TEMPLATE' +
      `&text=${encodeURIComponent(detalhes.papel)}` +
      `&dates=${dtStart}/${dtEnd}` +
      `&details=${encodeURIComponent(detalhes.descricao)}`;
    _mostrarModalAgenda(blob, fileName, googleUrl);
  }
};

function _baixarICS(blob, fileName) {
  const link = document.createElement('a');
  link.href  = window.URL.createObjectURL(blob);
  link.setAttribute('download', fileName);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function _mostrarModalAgenda(blob, fileName, googleUrl) {
  const existing = document.getElementById('modalAgenda');
  if (existing) existing.remove();

  const blobUrl = window.URL.createObjectURL(blob);

  const overlay = document.createElement('div');
  overlay.id = 'modalAgenda';
  overlay.innerHTML = `
    <div class="modal-agenda-backdrop"></div>
    <div class="modal-agenda-box" role="dialog" aria-modal="true" aria-label="Adicionar à agenda">
      <p class="modal-agenda-title">Adicionar à agenda</p>
      <button class="modal-agenda-btn btn-gcal" type="button">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
        Google Calendar
      </button>
      <button class="modal-agenda-btn btn-ics" type="button">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
        Baixar .ics <small>(Outlook, Apple Calendar)</small>
      </button>
      <button class="modal-agenda-close" type="button" aria-label="Fechar">&times;</button>
    </div>`;
  document.body.appendChild(overlay);

  const close = () => { window.URL.revokeObjectURL(blobUrl); overlay.remove(); };

  overlay.querySelector('.modal-agenda-backdrop').addEventListener('click', close);
  overlay.querySelector('.modal-agenda-close').addEventListener('click', close);
  overlay.querySelector('.btn-gcal').addEventListener('click', () => {
    window.open(googleUrl, '_blank', 'noopener,noreferrer');
    close();
  });
  overlay.querySelector('.btn-ics').addEventListener('click', () => {
    _baixarICS(blob, fileName);
    close();
  });
}

// ── Event listeners ───────────────────────────────────────────────────────────

document.getElementById('logoutBtn').onclick = () => {
  localStorage.removeItem(STORAGE_KEYS.GOOGLE_TOKEN);
  localStorage.removeItem(STORAGE_KEYS.USER_DATA);
  if (typeof google !== 'undefined' && google.accounts?.id)
    google.accounts.id.disableAutoSelect();
  state.usuarioAtual = null;
  mostrarAuth();
};

document.getElementById('btnToggleSearch').onclick = () => {
  const sw = document.getElementById('searchWrapper');
  sw.classList.toggle('active');
  if (sw.classList.contains('active')) document.getElementById('searchInput').focus();
};

document.getElementById('btnMyScales').onclick = () => {
  if (!state.usuarioAtual?.nomeVinculado)
    return alert('Faça login e vincule seu nome para usar esta função');
  const btn = document.getElementById('btnMyScales');
  if (btn.classList.contains('active')) {
    btn.classList.remove('active');
    aplicarFiltroAutomatico();
  } else {
    btn.classList.add('active');
    document.getElementById('searchInput').value = '';
    document.querySelectorAll('#filtros select').forEach((s) => (s.value = ''));
    renderizar(state.dadosGlobais.filter((x) => estaEscalado(x, state.usuarioAtual.nomeVinculado)));
  }
};

document.getElementById('btnToggleFilters').onclick = () =>
  document.getElementById('filtros').classList.toggle('active');

document.getElementById('btnClearFilters').onclick = () => {
  document.querySelectorAll('#filtros select').forEach((s) => (s.value = ''));
  document.getElementById('searchInput').value = '';
  document.getElementById('btnMyScales').classList.remove('active');
  aplicarFiltroAutomatico();
};

document.getElementById('btnTogglePast').onclick = () => {
  const c = document.getElementById('containerPassado');
  c.classList.toggle('show');
  document.getElementById('btnTogglePast').classList.toggle('active');
  document.getElementById('pastDivider').style.display =
    c.classList.contains('show') ? 'flex' : 'none';
};

document.getElementById('searchInput').addEventListener('input', () => {
  document.getElementById('btnMyScales').classList.remove('active');
  aplicarFiltros();
});

// ── Entry point ───────────────────────────────────────────────────────────────

async function init() {
  await carregarCSV();
  verificarAutenticacao();
}

if (document.readyState === 'loading')
  document.addEventListener('DOMContentLoaded', init);
else
  init();
