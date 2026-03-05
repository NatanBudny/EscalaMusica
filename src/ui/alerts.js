import { state } from '../state.js';
import { isPastDate, parseDate } from '../utils/date.js';
import { estaEscalado } from '../utils/name.js';

/** Shows a banner if the user's next schedule is within 7 days. */
export function verificarAlertas() {
  const container = document.getElementById('alertContainer');
  container.innerHTML = '';
  if (!state.usuarioAtual?.nomeVinculado) return;

  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);

  const futuras = state.dadosGlobais.filter(
    (r) => !isPastDate(r.DATA) && estaEscalado(r, state.usuarioAtual.nomeVinculado),
  );

  if (futuras.length > 0) {
    const proxima  = futuras[0];
    const diffDias = Math.floor((parseDate(proxima.DATA) - hoje) / (1000 * 60 * 60 * 24));
    if (diffDias <= 7) {
      const el      = document.createElement('div');
      el.className  = 'alert-banner success';
      const txtDia  = diffDias === 0 ? 'Hoje' : diffDias === 1 ? 'Amanhã' : `Em ${diffDias} dias`;
      el.innerHTML  = `<span class="alert-icon">📅</span><span class="alert-text">Sua próxima escala é ${proxima.DATA} (${txtDia})</span>`;
      container.appendChild(el);
    }
  }
}
