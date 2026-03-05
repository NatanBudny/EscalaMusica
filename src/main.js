import { state } from './state.js';
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

  const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
  const link = document.createElement('a');
  link.href  = window.URL.createObjectURL(blob);
  link.setAttribute('download', `Escala_${ano}${mes}${dia}.ics`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

// ── Event listeners ───────────────────────────────────────────────────────────

document.getElementById('logoutBtn').onclick = () => {
  localStorage.removeItem('googleToken');
  localStorage.removeItem('userData');
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
