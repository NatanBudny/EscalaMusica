import { STORAGE_KEYS } from '../config.js';

/** Reads the entire sub→name mapping from localStorage. */
export function lerVinculosGoogle() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEYS.VINCULOS) || '{}');
  } catch {
    return {};
  }
}

/** Returns the linked name for a Google sub-id, or '' if none. */
export function obterNomeVinculadoPorSub(sub) {
  if (!sub) return '';
  return lerVinculosGoogle()[sub] || '';
}

/** Persists a sub→name mapping to localStorage. No-op if either argument is falsy. */
export function salvarVinculoPorSub(sub, nomeVinculado) {
  if (!sub || !nomeVinculado) return;
  const vinculos = lerVinculosGoogle();
  vinculos[sub] = nomeVinculado;
  localStorage.setItem(STORAGE_KEYS.VINCULOS, JSON.stringify(vinculos));
}
