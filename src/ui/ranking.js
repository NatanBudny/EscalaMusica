import { state } from '../state.js';
import { normalizarNome } from '../utils/name.js';

const RANKING_FIELDS = ['MENSAGEM MUSICAL', 'REGENTE LOUVOR', 'EQUIPE LOUVOR'];

/** Exclude generic/non-person tokens from the ranking. */
const TOKENS_IGNORADOS = new Set(['JOVENS', '-', '']);

/**
 * Counts participations per person across MENSAGEM MUSICAL, REGENTE LOUVOR,
 * and EQUIPE LOUVOR for the current dataset (state.dadosGlobais).
 * @returns {Array<{nome: string, total: number}>} sorted by total desc.
 */
export function calcularRanking() {
  const counts = new Map();

  state.dadosGlobais.forEach((registro) => {
    RANKING_FIELDS.forEach((campo) => {
      const valor = (registro[campo] || '').trim();
      if (!valor) return;

      const nomes = valor.includes(',')
        ? valor.split(',').map((n) => n.trim())
        : [valor];

      nomes.forEach((nome) => {
        const chave = normalizarNome(nome);
        if (!chave || TOKENS_IGNORADOS.has(chave)) return;
        counts.set(chave, (counts.get(chave) ?? 0) + 1);
      });
    });
  });

  return [...counts.entries()]
    .map(([chave, total]) => ({ nome: chave, total }))
    .sort((a, b) => b.total - a.total || a.nome.localeCompare(b.nome));
}

/** Renders the participation ranking into #rankingBody. */
export function renderizarRanking() {
  const tbody = document.getElementById('rankingBody');
  if (!tbody) return;

  const dados = calcularRanking();
  tbody.innerHTML = '';

  dados.forEach((item, idx) => {
    const tr = document.createElement('tr');
    let medalha;
    if (idx === 0) medalha = '🥇';
    else if (idx === 1) medalha = '🥈';
    else if (idx === 2) medalha = '🥉';
    else medalha = `${idx + 1}.`;
    tr.innerHTML =
      `<td style="font-weight:700; color:var(--text-muted); text-align:center; min-width:40px;">${medalha}</td>` +
      `<td style="font-weight:600;">${_capitalizar(item.nome)}</td>` +
      `<td style="font-weight:800; text-align:center; color:var(--primary);">${item.total}</td>`;
    tbody.appendChild(tr);
  });
}

/** Converts an ALL-CAPS name to Title Case (e.g. "LUIZ ANTONIO" → "Luiz Antonio"). */
function _capitalizar(nome) {
  return nome
    .toLowerCase()
    .split(' ')
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ');
}
