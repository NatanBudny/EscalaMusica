import { state } from '../state.js';
import { STORAGE_KEYS } from '../config.js';

/** Fetches atual.json and contatos.json, falling back to localStorage cache on failure. */
export async function carregarCSV() {
  try {
    const [rDados, rContatos] = await Promise.all([
      fetch('atual.json?t=' + Date.now()),
      fetch('contatos.json?t=' + Date.now()),
    ]);
    state.dadosGlobais = await rDados.json();
    state.contatosMap  = await rContatos.json();
    localStorage.setItem(STORAGE_KEYS.CACHE_DADOS,    JSON.stringify(state.dadosGlobais));
    localStorage.setItem(STORAGE_KEYS.CACHE_CONTATOS, JSON.stringify(state.contatosMap));
    document.getElementById('offlineIndicator').style.display = 'none';
  } catch {
    console.warn('Loading from offline cache…');
    const cacheDados    = localStorage.getItem(STORAGE_KEYS.CACHE_DADOS);
    const cacheContatos = localStorage.getItem(STORAGE_KEYS.CACHE_CONTATOS);
    if (cacheDados && cacheContatos) {
      state.dadosGlobais = JSON.parse(cacheDados);
      state.contatosMap  = JSON.parse(cacheContatos);
      document.getElementById('offlineIndicator').style.display = 'inline-block';
    } else {
      console.error('Connection failed and no cache available.');
    }
  }
}
