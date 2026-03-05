import { state } from '../state.js';
import { parseDate } from '../utils/date.js';
import { buscarPorNome } from '../utils/name.js';
import { montarTabela } from './table.js';
import { montarCards } from './cards.js';
import { verificarAlertas } from './alerts.js';

/** Renders table, cards, and alerts for the given dataset. */
export function renderizar(d) {
  montarTabela(d);
  montarCards(d);
  verificarAlertas();
}

/** Renders the full dataset and rebuilds all filter dropdowns. */
export function aplicarFiltroAutomatico() {
  renderizar(state.dadosGlobais);
  montarFiltros(state.dadosGlobais);
}

/** Populates each `<select>` in the filter panel with distinct values from `d`. */
export function montarFiltros(d) {
  document.querySelectorAll('#filtros select').forEach((s) => {
    const col  = s.dataset.col;
    let vals   = [...new Set(d.map((x) => x[col]).filter((v) => v && v.trim() !== ''))];
    col === 'DATA'
      ? vals.sort((a, b) => parseDate(a) - parseDate(b))
      : vals.sort();
    s.innerHTML = `<option value="">${s.options[0].text}</option>`;
    vals.forEach((v) => {
      const o = document.createElement('option');
      o.value = v; o.textContent = v;
      s.appendChild(o);
    });
    s.onchange = aplicarFiltros;
  });
}

/** Reads active filter selects + search input and re-renders the matching subset. */
export function aplicarFiltros() {
  let f = [...state.dadosGlobais];
  document.querySelectorAll('#filtros select').forEach((s) => {
    if (s.value) {
      const col = s.dataset.col;
      f = col === 'EQUIPE LOUVOR'
        ? f.filter((x) => (x[col] || '').toUpperCase().includes(s.value.toUpperCase()))
        : f.filter((x) => x[col] === s.value);
    }
  });
  const busca = document.getElementById('searchInput').value.trim();
  if (busca) f = buscarPorNome(f, busca);
  renderizar(f);
}
