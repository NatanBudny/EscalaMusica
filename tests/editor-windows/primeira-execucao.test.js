// Testes da primeira execução da Casca (Task 41).
//
// validarToken com fetch falso (válido, token_invalido, sem_push) e clonar a
// partir de um remoto bare local, sem rede e sem token real.
//
// Feature: melhoras-domingao (G. Instalador) — Requisitos 31.2, 31.3, 31.5, 31.6.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  validarToken,
  clonar,
  configurarIdentidade,
  URL_REPO,
} from '../../editor-windows/lib/primeira-execucao.mjs';
import { criarRepoTemporario } from '../helpers/repo-temporario.js';

/**
 * Monta um fetch falso que responde por URL. Cada entrada do mapa é
 * `{ status, body }`; `body` é devolvido por `.json()`.
 */
function fetchFalso(mapa) {
  const chamadas = [];
  const fn = async (url, opcoes) => {
    chamadas.push({ url, opcoes });
    const entrada = mapa[url];
    if (!entrada) throw new Error(`URL inesperada no fetch falso: ${url}`);
    if (entrada.erro) throw new Error('falha de rede simulada');
    return {
      status: entrada.status,
      ok: entrada.status >= 200 && entrada.status < 300,
      json: async () => entrada.body,
    };
  };
  fn.chamadas = chamadas;
  return fn;
}

const URL_REPO_API = 'https://api.github.com/repos/NatanBudny/EscalaMusica';
const URL_USER_API = 'https://api.github.com/user';

describe('validarToken', () => {
  test('token válido com push devolve login e id', async () => {
    const fetch = fetchFalso({
      [URL_REPO_API]: { status: 200, body: { permissions: { push: true } } },
      [URL_USER_API]: { status: 200, body: { login: 'natan', id: 42 } },
    });

    const r = await validarToken('tok-bom', fetch);

    expect(r).toEqual({ ok: true, login: 'natan', id: 42 });
    // Confere que os cabeçalhos exigidos pela API foram enviados.
    const cab = fetch.chamadas[0].opcoes.headers;
    expect(cab.Authorization).toBe('Bearer tok-bom');
    expect(cab['User-Agent']).toBeTruthy();
    expect(cab.Accept).toBe('application/vnd.github+json');
  });

  test('token inválido (401) devolve motivo token_invalido', async () => {
    const fetch = fetchFalso({
      [URL_REPO_API]: { status: 401, body: {} },
    });

    const r = await validarToken('tok-ruim', fetch);

    expect(r.ok).toBe(false);
    expect(r.motivo).toBe('token_invalido');
  });

  test('token sem permissão de push devolve motivo sem_push', async () => {
    const fetch = fetchFalso({
      [URL_REPO_API]: { status: 200, body: { permissions: { push: false } } },
    });

    const r = await validarToken('tok-leitura', fetch);

    expect(r.ok).toBe(false);
    expect(r.motivo).toBe('sem_push');
    // Não precisa consultar /user quando já faltou push.
    expect(fetch.chamadas).toHaveLength(1);
  });

  test('token vazio é recusado sem chamar a rede', async () => {
    let chamou = false;
    const fetch = async () => {
      chamou = true;
    };
    const r = await validarToken('', fetch);
    expect(r).toEqual({ ok: false, motivo: 'token_invalido' });
    expect(chamou).toBe(false);
  });

  test('falha de rede devolve motivo erro_rede', async () => {
    const fetch = fetchFalso({
      [URL_REPO_API]: { erro: true },
    });
    const r = await validarToken('tok', fetch);
    expect(r.ok).toBe(false);
    expect(r.motivo).toBe('erro_rede');
  });
});

describe('clonar e configurarIdentidade', () => {
  let origem;

  beforeAll(() => {
    // Usa o remoto bare do helper como "repositório do GitHub" local.
    origem = criarRepoTemporario();
  });

  afterAll(() => {
    origem.limpar();
  });

  test('clona a partir de um remoto bare local sem rede', async () => {
    const destino = resolve(origem.dir, '..', 'clone-primeira-execucao');

    const r = await clonar({ destino, repoUrl: origem.remoto });

    expect(r.ok).toBe(true);
    expect(existsSync(resolve(destino, '.git'))).toBe(true);
    // O conteúdo do commit inicial do helper veio junto.
    expect(existsSync(resolve(destino, 'README.md'))).toBe(true);
  });

  test('configurarIdentidade grava user.name/email locais do clone', async () => {
    const destino = resolve(origem.dir, '..', 'clone-identidade');
    await clonar({ destino, repoUrl: origem.remoto });

    await configurarIdentidade({ repo: destino, login: 'natan', id: 42 });

    const nome = execFileSync('git', ['-C', destino, 'config', '--local', 'user.name'], {
      encoding: 'utf8',
    }).trim();
    const email = execFileSync('git', ['-C', destino, 'config', '--local', 'user.email'], {
      encoding: 'utf8',
    }).trim();

    expect(nome).toBe('natan');
    expect(email).toBe('42+natan@users.noreply.github.com');
  });

  test('a URL pública de clone aponta para o repositório certo', () => {
    expect(URL_REPO).toBe('https://github.com/NatanBudny/EscalaMusica.git');
  });
});
