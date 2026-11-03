// Baixa o MinGit (Git portátil oficial do Git for Windows) descrito em
// mingit.json, confere o SHA-256 ANTES de extrair e só então extrai em
// editor-windows/vendor/mingit.
//
// Se o hash não bater (ou ainda for o placeholder PENDENTE_CONFERIR), o
// script falha com erro claro e NÃO extrai nada — o checksum oficial da
// release precisa ser conferido e preenchido em mingit.json antes do build.
//
// Usa só módulos nativos do Node (node:crypto, node:fs, fetch). A extração do
// .zip usa o utilitário do sistema (Expand-Archive no Windows, unzip nos
// demais) via execFile, para não acrescentar dependência de produção.
//
// Feature: melhoras-domingao (G. Instalador) — Requisitos 30.9, 32.1.

import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

const PLACEHOLDER_SHA256 = 'PENDENTE_CONFERIR';

const DIR_SCRIPT = dirname(fileURLToPath(import.meta.url));
const DIR_EDITOR = resolve(DIR_SCRIPT, '..');

/** Lê e valida o mingit.json. */
export function lerMingitJson(caminho) {
  const bruto = readFileSync(caminho, 'utf8');
  const dados = JSON.parse(bruto);
  if (!dados || typeof dados !== 'object') {
    throw new Error(`mingit.json inválido em ${caminho}: não é um objeto.`);
  }
  for (const campo of ['versao', 'url', 'sha256']) {
    if (typeof dados[campo] !== 'string' || dados[campo].length === 0) {
      throw new Error(`mingit.json inválido: campo "${campo}" ausente ou vazio.`);
    }
  }
  return dados;
}

/** Calcula o SHA-256 (hex minúsculo) de um Buffer/Uint8Array. */
export function sha256Hex(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

/**
 * Confere o SHA-256 esperado contra o conteúdo baixado.
 *
 * Recusa explicitamente o placeholder PENDENTE_CONFERIR com orientação para
 * preencher o hash. Devolve o hash calculado quando confere.
 *
 * @param {Buffer|Uint8Array} buffer conteúdo baixado
 * @param {string} sha256Esperado hash de mingit.json
 * @returns {string} hash calculado (hex)
 */
export function conferirSha256(buffer, sha256Esperado) {
  const esperado = String(sha256Esperado || '').trim();
  if (esperado === PLACEHOLDER_SHA256) {
    throw new Error(
      'O sha256 de mingit.json ainda é o placeholder "PENDENTE_CONFERIR". ' +
        'Confira o checksum SHA-256 oficial da release do Git for Windows ' +
        '(arquivo MinGit-2.47.1-64-bit.zip) e preencha o campo "sha256" em ' +
        'editor-windows/mingit.json antes de rodar o build. ' +
        'Nenhum arquivo foi extraído.',
    );
  }
  const calculado = sha256Hex(buffer).toLowerCase();
  const normalizado = esperado.toLowerCase();
  if (calculado !== normalizado) {
    throw new Error(
      'O SHA-256 do arquivo baixado não bate com o de mingit.json.\n' +
        `  esperado:  ${normalizado}\n` +
        `  calculado: ${calculado}\n` +
        'O download pode estar corrompido ou o hash de mingit.json está ' +
        'desatualizado. Nenhum arquivo foi extraído.',
    );
  }
  return calculado;
}

/** Extrai o .zip em destino usando o utilitário do sistema (sem dependência). */
async function extrairZip(zipPath, destino) {
  rmSync(destino, { recursive: true, force: true });
  mkdirSync(destino, { recursive: true });

  if (process.platform === 'win32') {
    // PowerShell Expand-Archive está sempre disponível no Windows.
    await execFileP('powershell', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${destino}' -Force`,
    ]);
    return;
  }

  // Fallback documentado para dev/CI não-Windows: unzip do sistema.
  await execFileP('unzip', ['-o', '-q', zipPath, '-d', destino]);
}

/**
 * Baixa, confere e extrai o MinGit.
 *
 * O download e a conferência acontecem ANTES da extração: se o hash não bater,
 * nada é extraído. Permite injetar `fetch` (teste) e caminhos.
 *
 * @param {{ mingitPath?: string, destino?: string, tmpZip?: string,
 *           fetch?: typeof globalThis.fetch }} [opcoes]
 */
export async function baixarMinGit({
  mingitPath = join(DIR_EDITOR, 'mingit.json'),
  destino = join(DIR_EDITOR, 'vendor', 'mingit'),
  tmpZip = join(DIR_EDITOR, 'vendor', 'mingit.zip'),
  fetch = globalThis.fetch,
} = {}) {
  const dados = lerMingitJson(mingitPath);

  console.log(`MinGit ${dados.versao}`);
  console.log(`Baixando ${dados.url} ...`);

  const resposta = await fetch(dados.url, { redirect: 'follow' });
  if (!resposta || !resposta.ok) {
    const status = resposta ? resposta.status : 'sem resposta';
    throw new Error(`Falha ao baixar o MinGit: HTTP ${status}.`);
  }
  const arrayBuffer = await resposta.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  // Confere o hash ANTES de extrair; lança erro claro quando não bate.
  const hash = conferirSha256(buffer, dados.sha256);
  console.log(`SHA-256 conferido: ${hash}`);

  mkdirSync(dirname(tmpZip), { recursive: true });
  writeFileSync(tmpZip, buffer);
  try {
    console.log(`Extraindo em ${destino} ...`);
    await extrairZip(tmpZip, destino);
  } finally {
    rmSync(tmpZip, { force: true });
  }

  const git = join(destino, 'cmd', 'git.exe');
  if (!existsSync(git)) {
    console.warn(
      `Aviso: ${git} não encontrado após a extração. ` +
        'Confira o layout do MinGit extraído.',
    );
  }
  console.log('MinGit pronto em vendor/mingit.');
  return destino;
}

// Execução direta pela linha de comando / CI.
const executadoDireto = (() => {
  try {
    return resolve(process.argv[1] || '') === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();

if (executadoDireto) {
  baixarMinGit().catch((erro) => {
    console.error(`\nERRO: ${erro.message}`);
    process.exit(1);
  });
}
