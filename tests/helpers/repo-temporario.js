// Helper de testes: cria em os.tmpdir() um repositório git com um remoto bare
// local (sem rede), para exercitar montador/lib/git.mjs.
//
// Feature: melhoras-domingao — testes de git (Tasks 1 e 2).

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';

/** Ambiente determinístico para o git (sem prompts, autor fixo, sem rede). */
const ENV_GIT = {
  ...process.env,
  GIT_TERMINAL_PROMPT: '0',
  GIT_AUTHOR_NAME: 'Teste',
  GIT_AUTHOR_EMAIL: 'teste@example.com',
  GIT_COMMITTER_NAME: 'Teste',
  GIT_COMMITTER_EMAIL: 'teste@example.com',
};

/** Roda o git no diretório informado. Lança em caso de erro. */
export function git(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    env: ENV_GIT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

/** Escreve um arquivo (criando pastas) com conteúdo dado. */
export function escrever(dir, rel, conteudo) {
  const caminho = resolve(dir, rel);
  mkdirSync(dirname(caminho), { recursive: true });
  writeFileSync(caminho, conteudo, 'utf8');
  return rel;
}

/**
 * Cria um repositório de trabalho com um remoto bare local e um commit inicial.
 *
 * @returns {{
 *   dir: string, remoto: string,
 *   git: (args: string[]) => string,
 *   escrever: (rel: string, conteudo: string) => string,
 *   remoteGit: (args: string[]) => string,
 *   limpar: () => void,
 * }}
 */
export function criarRepoTemporario() {
  const base = mkdtempSync(resolve(tmpdir(), 'escala-git-'));
  const dir = resolve(base, 'repo');
  const remoto = resolve(base, 'remoto.git');

  mkdirSync(dir, { recursive: true });
  // Remoto bare.
  git(base, ['init', '--bare', '-b', 'main', remoto]);

  // Repositório de trabalho.
  git(dir, ['init', '-b', 'main']);
  git(dir, ['config', 'user.name', 'Teste']);
  git(dir, ['config', 'user.email', 'teste@example.com']);
  // Commit inicial.
  escrever(dir, 'atual.json', '[]\n');
  escrever(dir, 'README.md', '# repo de teste\n');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-m', 'inicial']);
  git(dir, ['remote', 'add', 'origin', remoto]);
  git(dir, ['push', '-u', 'origin', 'main']);

  return {
    dir,
    remoto,
    git: (args) => git(dir, args),
    remoteGit: (args) => git(remoto, args),
    escrever: (rel, conteudo) => escrever(dir, rel, conteudo),
    limpar: () => rmSync(base, { recursive: true, force: true }),
  };
}

/**
 * Cria um segundo clone do mesmo remoto (outro computador), para simular
 * históricos divergentes.
 */
export function clonar(remoto, nome = 'clone') {
  const base = dirname(remoto);
  const destino = resolve(base, nome);
  git(base, ['clone', remoto, destino]);
  git(destino, ['config', 'user.name', 'Outro']);
  git(destino, ['config', 'user.email', 'outro@example.com']);
  return {
    dir: destino,
    git: (args) => git(destino, args),
    escrever: (rel, conteudo) => escrever(destino, rel, conteudo),
  };
}
