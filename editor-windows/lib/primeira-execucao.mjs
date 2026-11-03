// Primeira execução da Casca (só Windows).
//
// Configura o login do GitHub uma vez e clona o Repositorio no Clone_Local.
// Três passos puros e testáveis, sem tocar no Electron:
//
//   validarToken(token, fetch)        → confirma push em NatanBudny/EscalaMusica
//   clonar({ token, destino, git })   → git clone no Clone_Local (token por askpass)
//   configurarIdentidade({ repo, ... })→ user.name/user.email locais do clone
//
// O token NUNCA entra na URL, em argumento, em log ou em arquivo do Repositorio:
// o git o recebe por GIT_ASKPASS + a variável ESCALA_GIT_TOKEN do processo,
// exatamente como lib/servidor.mjs já faz para o Servidor_Local.
//
// Feature: melhoras-domingao (G. Instalador) — Requisitos 31.1, 31.2, 31.3,
// 31.4, 31.5, 31.6, 31.7, 31.8.

import { execFile } from 'node:child_process';

/** Dono/repositório do Repositorio público. */
export const DONO = 'NatanBudny';
export const REPOSITORIO = 'EscalaMusica';

/** URL HTTPS de clone do Repositorio (sem token). */
export const URL_REPO = `https://github.com/${DONO}/${REPOSITORIO}.git`;

/** Base da API do GitHub. */
const API = 'https://api.github.com';

/** Cabeçalho User-Agent exigido pela API do GitHub. */
const USER_AGENT = 'EscalaMusica-Editor';

/**
 * Confirma, pela API do GitHub, que o token tem permissão de push no
 * Repositorio e descobre o login e o id da conta.
 *
 * Faz dois GETs autenticados por Bearer:
 *   1) /repos/<dono>/<repo> → `permissions.push === true`
 *   2) /user               → `login`, `id`
 *
 * Motivos de recusa:
 *   'token_invalido' — a API respondeu 401/403 (token errado ou sem acesso).
 *   'sem_push'       — o token lê o repositório mas não tem `permissions.push`.
 *   'erro_rede'      — falha de rede ou resposta inesperada.
 *
 * @param {string} token token pessoal do GitHub
 * @param {typeof globalThis.fetch} [fetch] injetável para teste
 * @returns {Promise<{ ok: boolean, login?: string, id?: number, motivo?: string }>}
 */
export async function validarToken(token, fetch = globalThis.fetch) {
  if (typeof token !== 'string' || token.trim() === '') {
    return { ok: false, motivo: 'token_invalido' };
  }

  const cabecalhos = {
    Authorization: `Bearer ${token}`,
    'User-Agent': USER_AGENT,
    Accept: 'application/vnd.github+json',
  };

  let respRepo;
  try {
    respRepo = await fetch(`${API}/repos/${DONO}/${REPOSITORIO}`, {
      headers: cabecalhos,
    });
  } catch {
    return { ok: false, motivo: 'erro_rede' };
  }

  if (respRepo.status === 401 || respRepo.status === 403) {
    return { ok: false, motivo: 'token_invalido' };
  }
  if (!respRepo.ok) {
    return { ok: false, motivo: 'erro_rede' };
  }

  let repo;
  try {
    repo = await respRepo.json();
  } catch {
    return { ok: false, motivo: 'erro_rede' };
  }

  if (!repo || !repo.permissions || repo.permissions.push !== true) {
    return { ok: false, motivo: 'sem_push' };
  }

  let respUser;
  try {
    respUser = await fetch(`${API}/user`, { headers: cabecalhos });
  } catch {
    return { ok: false, motivo: 'erro_rede' };
  }

  if (respUser.status === 401 || respUser.status === 403) {
    return { ok: false, motivo: 'token_invalido' };
  }
  if (!respUser.ok) {
    return { ok: false, motivo: 'erro_rede' };
  }

  let user;
  try {
    user = await respUser.json();
  } catch {
    return { ok: false, motivo: 'erro_rede' };
  }

  if (!user || typeof user.login !== 'string' || user.id == null) {
    return { ok: false, motivo: 'erro_rede' };
  }

  return { ok: true, login: user.login, id: user.id };
}

/** Executa o git por execFile (lista de argumentos, sem shell). */
function rodarGit(git, args, { cwd, token } = {}) {
  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      // Nunca pergunta no terminal; sem askpass, falha em vez de pendurar.
      GIT_TERMINAL_PROMPT: '0',
    };
    if (token != null) {
      // O askpass.cmd lê ESCALA_GIT_TOKEN; o token não vai em argumento nem URL.
      env.ESCALA_GIT_TOKEN = String(token);
    }
    execFile(git, args, { cwd, env }, (erro, stdout, stderr) => {
      if (erro) {
        // A mensagem do git pode conter a URL, nunca o token (ele só existe no env).
        reject(new Error(stderr || stdout || erro.message));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

/**
 * Clona o Repositorio no Clone_Local.
 *
 * O token chega ao git só por `GIT_ASKPASS` + `ESCALA_GIT_TOKEN` (o askpass.cmd
 * responde `x-access-token` como usuário e o token como senha). Para teste,
 * `repoUrl` aponta para um remoto bare local, dispensando rede e token.
 *
 * @param {{ token?: string, destino: string, git?: string, repoUrl?: string,
 *           askpass?: string }} opcoes
 * @returns {Promise<{ ok: boolean, destino: string }>}
 */
export async function clonar({
  token,
  destino,
  git = process.env.MONTADOR_GIT || 'git',
  repoUrl = URL_REPO,
  askpass = process.env.GIT_ASKPASS,
} = {}) {
  const env = {};
  if (askpass) {
    // Repassa o askpass ao git desta operação (o padrão de lib/servidor.mjs).
    process.env.GIT_ASKPASS = askpass;
    env.askpass = askpass;
  }
  await rodarGit(git, ['clone', repoUrl, destino], { token });
  return { ok: true, destino };
}

/**
 * Configura `user.name` e `user.email` locais do clone com o login do token.
 *
 * O e-mail usa o formato de no-reply do GitHub (`<id>+<login>@users.noreply.
 * github.com`), que não expõe o endereço real. As configurações são locais ao
 * clone — nunca `--global`.
 *
 * @param {{ repo: string, login: string, id: number|string, git?: string }} opcoes
 * @returns {Promise<{ ok: boolean }>}
 */
export async function configurarIdentidade({
  repo,
  login,
  id,
  git = process.env.MONTADOR_GIT || 'git',
} = {}) {
  await rodarGit(git, ['-C', repo, 'config', 'user.name', String(login)]);
  await rodarGit(git, [
    '-C',
    repo,
    'config',
    'user.email',
    `${id}+${login}@users.noreply.github.com`,
  ]);
  return { ok: true };
}
