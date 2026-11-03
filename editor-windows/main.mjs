// Casca Electron do editor de escala (só Windows).
//
// Abre o editor como um programa: executa montador/server.mjs de dentro do
// Clone_Local com o Node do Electron, espera o /api/saude, mostra a interface
// numa janela presa à origem local e encerra o servidor ao fechar.
//
// Instância única; reinício único no código 75; links externos só pela lista de
// permissão (linkPermitido); MONTADOR_GIT aponta para o MinGit embutido.
//
// A primeira execução (Task 41) configura o login do GitHub uma vez e clona o
// Repositorio: sem credencial guardada, a Casca mostra configuracao.html, valida
// o token, cifra-o com safeStorage em userData/credencial.bin, clona em
// userData/repo, ajusta a identidade local do clone e cria o atalho. Em
// desenvolvimento, ESCALA_REPO_DIR pula a primeira execução e aponta o clone,
// permitindo `npx electron .`.
//
// Feature: melhoras-domingao (G. Casca) — Requisitos 30.1, 30.2, 30.5, 30.6,
// 30.7, 30.8, 30.9, 30.10, 31.1, 31.4, 31.5, 31.6, 31.7, 31.8.

import { app, BrowserWindow, ipcMain, safeStorage, shell, utilityProcess } from 'electron';
import { join, resolve } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFile } from 'node:child_process';

import { linkPermitido } from './lib/links.mjs';
import {
  PORTA,
  montarEnvServidor,
  caminhoGitDoMinGit,
  decidirReinicio,
  esperarSaude,
} from './lib/servidor.mjs';
import {
  validarToken,
  clonar,
  configurarIdentidade,
} from './lib/primeira-execucao.mjs';

/** Liga o modo smoke quando `--smoke` está nos argumentos. */
const MODO_SMOKE = process.argv.includes('--smoke');

const URL_JANELA = `http://127.0.0.1:${PORTA}/`;

/** Estado do processo do servidor. */
let processoServidor = null;
let jaReiniciou = false;
let encerrando = false;

/** Token do GitHub em memória durante a sessão (nunca gravado em claro). */
let tokenGit = process.env.ESCALA_GIT_TOKEN || null;

/** Caminho do Clone_Local (repositório que a Casca roda). */
function diretorioRepo() {
  if (process.env.ESCALA_REPO_DIR) return resolve(process.env.ESCALA_REPO_DIR);
  return join(app.getPath('userData'), 'repo');
}

/** Caminho do MinGit embutido (dentro de resources no app empacotado). */
function diretorioMinGit() {
  if (process.env.ESCALA_MINGIT_DIR) return resolve(process.env.ESCALA_MINGIT_DIR);
  // process.resourcesPath existe no app empacotado; em dev, usa vendor/mingit.
  const base = process.resourcesPath || join(app.getAppPath(), 'vendor');
  return join(base, 'mingit');
}

/** Caminho do askpass.cmd (entrega o token ao git só por GIT_ASKPASS). */
function caminhoAskpass() {
  if (process.env.ESCALA_ASKPASS) return resolve(process.env.ESCALA_ASKPASS);
  const base = process.resourcesPath || app.getAppPath();
  return join(base, 'askpass.cmd');
}

/** Caminho do cofre do token (fora do Clone_Local, na pasta de dados do app). */
function caminhoCredencial() {
  return join(app.getPath('userData'), 'credencial.bin');
}

/** Guarda o token cifrado com safeStorage em userData/credencial.bin (31.4). */
function guardarToken(token) {
  const cifrado = safeStorage.encryptString(token);
  writeFileSync(caminhoCredencial(), cifrado);
}

/** Lê e decifra o token guardado; null se ausente ou ilegível. */
function lerToken() {
  const caminho = caminhoCredencial();
  if (!existsSync(caminho)) return null;
  try {
    return safeStorage.decryptString(readFileSync(caminho));
  } catch {
    return null;
  }
}

/**
 * Inicia o processo do Servidor_Local de dentro do clone.
 *
 * Usa utilityProcess.fork (Node do Electron); se indisponível, cai para o
 * ELECTRON_RUN_AS_NODE no processo do próprio Electron.
 */
function iniciarServidor({ semPull = false } = {}) {
  const repo = diretorioRepo();
  const servidor = join(repo, 'montador', 'server.mjs');

  const mingitDir = diretorioMinGit();
  const askpass = caminhoAskpass();
  const env = montarEnvServidor({
    porta: PORTA,
    mingitDir: existsSync(mingitDir) ? mingitDir : undefined,
    askpass: existsSync(askpass) ? askpass : undefined,
    token: tokenGit || process.env.ESCALA_GIT_TOKEN,
    base: process.env,
  });

  // No smoke não há rede nem commits: desliga o pull de inicialização.
  if (semPull) env.MONTADOR_SEM_PULL = '1';

  if (typeof utilityProcess !== 'undefined' && utilityProcess.fork) {
    processoServidor = utilityProcess.fork(servidor, [], { cwd: repo, env });
    processoServidor.on('exit', (codigo) => aoEncerrarServidor(codigo));
    return processoServidor;
  }

  // Fallback: roda o server.mjs com o próprio Electron como Node.
  const { spawn } = require('node:child_process');
  processoServidor = spawn(process.execPath, [servidor], {
    cwd: repo,
    env: { ...env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: 'inherit',
  });
  processoServidor.on('exit', (codigo) => aoEncerrarServidor(codigo));
  return processoServidor;
}

/** Trata a saída do servidor: reinício único no código 75, senão encerra. */
function aoEncerrarServidor(codigo) {
  processoServidor = null;
  if (encerrando) return;
  if (decidirReinicio(codigo, jaReiniciou) === 'reiniciar') {
    jaReiniciou = true;
    iniciarServidor();
    return;
  }
  // Servidor encerrou por conta própria: fecha o app.
  app.quit();
}

/** Para o processo do servidor ao fechar a janela. */
function pararServidor() {
  encerrando = true;
  if (!processoServidor) return;
  try {
    if (typeof processoServidor.kill === 'function') processoServidor.kill();
  } catch {
    // ignora
  }
  processoServidor = null;
}

/** Cria o atalho na área de trabalho (silencioso em falha — 31.7). */
function criarAtalho() {
  try {
    const desktop = app.getPath('desktop');
    shell.writeShortcutLink(join(desktop, 'Editor de Escala.lnk'), 'create', {
      target: process.execPath,
      description: 'Editor de Escala',
    });
  } catch (erro) {
    console.error('Não foi possível criar o atalho:', erro.message);
  }
}

/**
 * Executa a primeira execução: valida o token, cifra, clona e configura.
 *
 * Reporta cada passo pela janela de configuração (evento `configuracao:estado`).
 * Em sucesso, guarda o token em memória e cria o atalho. Em falha, devolve o
 * motivo para a tela continuar com "tentar de novo".
 *
 * @returns {Promise<{ ok: boolean, motivo?: string }>}
 */
async function executarPrimeiraExecucao(win, token) {
  const emitir = (estado) => {
    if (!win.isDestroyed()) win.webContents.send('configuracao:estado', estado);
  };

  emitir('validando');
  const resultado = await validarToken(token);
  if (!resultado.ok) {
    emitir(resultado.motivo);
    return { ok: false, motivo: resultado.motivo };
  }

  // Cifra e guarda o token antes de clonar (31.4).
  guardarToken(token);
  tokenGit = token;

  const repo = diretorioRepo();
  const mingitDir = diretorioMinGit();
  const askpass = caminhoAskpass();
  const git = existsSync(mingitDir) ? caminhoGitDoMinGit(mingitDir) : undefined;

  try {
    emitir('clonando');
    await clonar({
      token,
      destino: repo,
      git,
      askpass: existsSync(askpass) ? askpass : undefined,
    });

    emitir('configurando');
    await configurarIdentidade({
      repo,
      login: resultado.login,
      id: resultado.id,
      git,
    });
  } catch (erro) {
    console.error('Falha no clone/configuração:', erro.message);
    emitir('erro_clone');
    return { ok: false, motivo: 'erro_clone' };
  }

  criarAtalho();
  emitir('pronto');
  return { ok: true };
}

/**
 * Mostra a tela de configuração e resolve quando a primeira execução conclui.
 *
 * Trata o canal `configuracao:enviar-token` do preload; cada tentativa falha
 * mantém a janela aberta para "tentar de novo" (31.3, 31.8).
 *
 * @returns {Promise<BrowserWindow>} a janela de configuração já concluída
 */
function mostrarConfiguracao() {
  return new Promise((resolver) => {
    const win = new BrowserWindow({
      width: 640,
      height: 560,
      title: 'Configurar o editor de escala',
      webPreferences: {
        preload: join(app.getAppPath(), 'preload.cjs'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    });

    ipcMain.handle('configuracao:enviar-token', async (_evento, token) => {
      const resultado = await executarPrimeiraExecucao(win, token);
      if (resultado.ok) {
        ipcMain.removeHandler('configuracao:enviar-token');
        resolver(win);
      }
      return resultado;
    });

    win.loadFile(join(app.getAppPath(), 'configuracao.html'));
  });
}

/** Cria a janela presa à origem local, com links externos pela lista. */
function criarJanela() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    show: false,
    title: 'Editor de Escala',
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  // Links externos: só os permitidos vão para o navegador; os demais são
  // bloqueados. A janela nunca abre uma segunda janela.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (linkPermitido(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  // Navegação: a janela só pode permanecer na origem local.
  win.webContents.on('will-navigate', (evento, url) => {
    if (url.startsWith(URL_JANELA)) return;
    evento.preventDefault();
    if (linkPermitido(url)) shell.openExternal(url);
  });

  win.loadURL(URL_JANELA);
  win.once('ready-to-show', () => win.show());
  return win;
}

/**
 * Garante que há credencial e clone antes de subir o servidor.
 *
 * Em desenvolvimento (ESCALA_REPO_DIR definido), pula a primeira execução. Caso
 * contrário, recupera o token guardado; se não houver (ou faltar o clone),
 * mostra configuracao.html e espera a primeira execução concluir.
 *
 * @returns {Promise<BrowserWindow|null>} a janela de config concluída, se houve
 */
async function garantirPrimeiraExecucao() {
  if (process.env.ESCALA_REPO_DIR) return null;

  const guardado = lerToken();
  const repo = diretorioRepo();
  const clonado = existsSync(join(repo, '.git'));

  if (guardado && clonado) {
    tokenGit = guardado;
    return null;
  }

  // Sem credencial ou sem clone: configura do zero (31.1).
  mkdirSync(app.getPath('userData'), { recursive: true });
  return mostrarConfiguracao();
}

/** Fluxo de inicialização: primeira execução → servidor → /api/saude → janela. */
async function iniciar() {
  const janelaConfig = await garantirPrimeiraExecucao();
  if (janelaConfig && !janelaConfig.isDestroyed()) janelaConfig.close();

  iniciarServidor();
  const pronto = await esperarSaude({ porta: PORTA });
  if (!pronto) {
    console.error('O servidor local não respondeu em /api/saude no tempo esperado.');
    pararServidor();
    app.quit();
    return;
  }
  criarJanela();
}

/**
 * Smoke test do app empacotado (usado pelo Workflow_de_Build, RF 32.3).
 *
 * Pula a primeira execução, usa ESCALA_REPO_DIR como Clone_Local, inicia o
 * Servidor_Local com MONTADOR_SEM_PULL=1 (sem rede), exige 200 em /api/saude e
 * em /, e, se vendor/mingit existir, roda `git --version` do MinGit embutido.
 * Sai com código 0 em sucesso, 1 em falha ou após 60 s.
 */
async function rodarSmoke() {
  const limite = setTimeout(() => {
    console.error('SMOKE: tempo esgotado (60 s).');
    pararServidor();
    process.exit(1);
  }, 60000);
  limite.unref?.();

  try {
    const repo = diretorioRepo();
    const servidor = join(repo, 'montador', 'server.mjs');
    if (!existsSync(servidor)) {
      throw new Error(`montador/server.mjs não encontrado em ${repo} (defina ESCALA_REPO_DIR).`);
    }

    iniciarServidor({ semPull: true });

    const pronto = await esperarSaude({ porta: PORTA });
    if (!pronto) throw new Error('/api/saude não respondeu 200.');
    console.log('SMOKE: /api/saude OK (200).');

    const respRaiz = await fetch(URL_JANELA, { cache: 'no-store' });
    if (!respRaiz || respRaiz.status !== 200) {
      throw new Error(`/ respondeu ${respRaiz ? respRaiz.status : 'sem resposta'} (esperado 200).`);
    }
    console.log('SMOKE: / OK (200).');

    const mingitDir = diretorioMinGit();
    if (existsSync(mingitDir)) {
      const git = caminhoGitDoMinGit(mingitDir);
      const versao = await new Promise((resolver, rejeitar) => {
        execFile(git, ['--version'], (erro, stdout) => {
          if (erro) rejeitar(erro);
          else resolver(String(stdout).trim());
        });
      });
      console.log(`SMOKE: MinGit OK (${versao}).`);
    } else {
      console.log('SMOKE: vendor/mingit ausente; pulando `git --version`.');
    }

    clearTimeout(limite);
    pararServidor();
    console.log('SMOKE: sucesso.');
    process.exit(0);
  } catch (erro) {
    clearTimeout(limite);
    console.error(`SMOKE: falhou — ${erro.message}`);
    pararServidor();
    process.exit(1);
  }
}

if (MODO_SMOKE) {
  // No smoke não abrimos janela nem travamos instância única.
  app.whenReady().then(rodarSmoke);
} else {
// Instância única: a segunda instância foca a janela existente e encerra.
const conseguiuLock = app.requestSingleInstanceLock();
if (!conseguiuLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const janelas = BrowserWindow.getAllWindows();
    if (janelas.length > 0) {
      const win = janelas[0];
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(iniciar);

  app.on('window-all-closed', () => {
    pararServidor();
    app.quit();
  });

  app.on('before-quit', pararServidor);
}
}
