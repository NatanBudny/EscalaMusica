import { state } from '../state.js';
import { obterNomeVinculadoPorSub, salvarVinculoPorSub } from './storage.js';
import { aplicarFiltroAutomatico } from '../ui/filters.js';
import { GOOGLE_CLIENT_ID, STORAGE_KEYS } from '../config.js';

// ── View helpers ──────────────────────────────────────────────────────────────

export function mostrarAuth() {
  document.getElementById('authContainer').style.display = 'block';
  document.getElementById('nameSelectionContainer').style.display = 'none';
  document.getElementById('appContainer').style.display = 'none';
  document.getElementById('googleSignIn').innerHTML = '';
  inicializarGoogleComTentativas();
}

export function mostrarSelecaoNome() {
  document.getElementById('authContainer').style.display = 'none';
  document.getElementById('appContainer').style.display = 'none';
  document.getElementById('nameSelectionContainer').style.display = 'block';
  const select = document.getElementById('selectNomeContato');
  select.innerHTML = '<option value="">Selecione seu nome na equipe...</option>';
  Object.keys(state.contatosMap).sort().forEach((nome) => {
    const opt = document.createElement('option');
    opt.value = opt.textContent = nome;
    select.appendChild(opt);
  });
}

export function salvarNomeVinculado() {
  const select = document.getElementById('selectNomeContato');
  if (!select.value) return alert('Por favor, selecione seu nome na lista.');
  state.usuarioAtual.nomeVinculado = select.value;
  salvarVinculoPorSub(state.usuarioAtual.sub, state.usuarioAtual.nomeVinculado);
  localStorage.setItem(STORAGE_KEYS.USER_DATA, JSON.stringify(state.usuarioAtual));
  document.getElementById('nameSelectionContainer').style.display = 'none';
  mostrarApp();
  aplicarFiltroAutomatico();
}

export function mostrarApp() {
  document.getElementById('authContainer').style.display = 'none';
  document.getElementById('nameSelectionContainer').style.display = 'none';
  document.getElementById('appContainer').style.display = 'block';
  if (state.usuarioAtual) {
    document.getElementById('userInfo').style.display = 'flex';
    document.getElementById('userName').textContent =
      state.usuarioAtual.nomeVinculado || state.usuarioAtual.name;
    const avatar = document.getElementById('userAvatar');
    if (state.usuarioAtual.picture) {
      avatar.src = state.usuarioAtual.picture;
      avatar.style.display = 'block';
    } else {
      avatar.style.display = 'none';
    }
  }
}

// ── Google auth ───────────────────────────────────────────────────────────────

export function verificarAutenticacao() {
  const token    = localStorage.getItem(STORAGE_KEYS.GOOGLE_TOKEN);
  const userData = localStorage.getItem(STORAGE_KEYS.USER_DATA);
  if (token && userData) {
    try {
      state.usuarioAtual = JSON.parse(userData);
      if (!state.usuarioAtual.nomeVinculado) mostrarSelecaoNome();
      else { mostrarApp(); aplicarFiltroAutomatico(); }
      return;
    } catch {
      localStorage.removeItem(STORAGE_KEYS.GOOGLE_TOKEN);
      localStorage.removeItem(STORAGE_KEYS.USER_DATA);
    }
  }
  mostrarAuth();
}

export function inicializarGoogleComTentativas() {
  let tentativas = 0;
  function checar() {
    tentativas++;
    if (typeof google !== 'undefined' && google.accounts?.id) {
      google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: handleCredentialResponse });
      const btn = document.getElementById('googleSignIn');
      if (btn) google.accounts.id.renderButton(btn, { theme: 'outline', size: 'large', width: '100%' });
    } else if (tentativas < 50) {
      setTimeout(checar, 100);
    }
  }
  setTimeout(checar, 300);
}

export function handleCredentialResponse(response) {
  fetch('https://www.googleapis.com/oauth2/v3/tokeninfo?id_token=' + response.credential)
    .then((r) => r.json())
    .then((data) => {
      const nomeVinculado = obterNomeVinculadoPorSub(data.sub);
      state.usuarioAtual = {
        email: data.email, name: data.name, picture: data.picture,
        sub: data.sub, nomeVinculado,
      };
      localStorage.setItem(STORAGE_KEYS.GOOGLE_TOKEN, response.credential);
      localStorage.setItem(STORAGE_KEYS.USER_DATA, JSON.stringify(state.usuarioAtual));
      if (!state.usuarioAtual.nomeVinculado) mostrarSelecaoNome();
      else { mostrarApp(); aplicarFiltroAutomatico(); }
    })
    .catch(() => mostrarAuth());
}
