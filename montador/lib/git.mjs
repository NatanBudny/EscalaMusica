// Módulo git do editor de escala.
//
// Toda gravação passa por aqui. Faz commit seletivo (só os arquivos da
// operação), sincroniza com `pull --rebase --autostash` e `push` sem force, e
// aplica a política RF021 (conflito só em atual.json fica com a versão local).
//
// Sempre por `execFile(executavel, args, { cwd, env })` — nomes e mensagens
// nunca passam por shell. Nunca lança: erros viram { ok: false, erro }.
//
// Feature: melhoras-domingao (A. Fundação) — Requisitos 2.1 a 2.14.

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT } from './regras.mjs';

/**
 * @typedef {{ ok:boolean, semAlteracoes?:boolean, commit?:string,
 *   push?:'ok'|'pendente'|'conflito', conflitos?:string[],
 *   codigoAlterado?:boolean, erro?:string, mensagem?:string }} ResultadoGit
 */

/**
 * Cria um cliente git amarrado a um diretório de trabalho.
 *
 * @param {{ cwd?: string, executavel?: string, env?: NodeJS.ProcessEnv }} opcoes
 */
export function criarGit({
  cwd = ROOT,
  executavel = process.env.MONTADOR_GIT || 'git',
  env = process.env,
} = {}) {
  const ambiente = { ...env, GIT_TERMINAL_PROMPT: '0' };

  /** Executa o git. Resolve com { codigo, stdout, stderr }, nunca rejeita. */
  function git(args) {
    return new Promise((resolver) => {
      execFile(executavel, args, { cwd, env: ambiente, maxBuffer: 50 * 1024 * 1024 }, (erro, stdout, stderr) => {
        resolver({
          codigo: erro ? (typeof erro.code === 'number' ? erro.code : 1) : 0,
          stdout: String(stdout || ''),
          stderr: String(stderr || ''),
        });
      });
    });
  }

  /** Executa e lança se falhar (uso interno, sempre dentro de try/catch). */
  async function gitOuFalha(args) {
    const r = await git(args);
    if (r.codigo !== 0) {
      throw new Error((r.stderr || r.stdout || `git ${args.join(' ')}`).trim());
    }
    return r.stdout.trim();
  }

  /** Lista os caminhos que ainda não são rastreados dentre os informados. */
  async function naoRastreados(arquivos) {
    const fora = [];
    for (const arq of arquivos) {
      const r = await git(['ls-files', '--error-unmatch', '--', arq]);
      if (r.codigo !== 0) fora.push(arq);
    }
    return fora;
  }

  /** Há algo a commitar (staged) dentre os arquivos? */
  async function temMudancaStaged(arquivos) {
    const r = await git(['diff', '--cached', '--quiet', '--', ...arquivos]);
    // --quiet: código 1 quando há diferenças.
    return r.codigo !== 0;
  }

  /**
   * Commit contendo exatamente as mudanças dos arquivos informados.
   * - `git add -- <não rastreados existentes>` antes do commit.
   * - `git commit -m <msg> -- <arquivos>` só com os caminhos da operação.
   * - Sem mudanças → { ok: true, semAlteracoes: true }, nenhum commit criado.
   *
   * @param {string[]} arquivos caminhos relativos a `cwd`
   * @param {string} mensagem
   * @returns {Promise<ResultadoGit>}
   */
  async function commitSeletivo(arquivos, mensagem) {
    try {
      const lista = [...new Set((arquivos || []).filter(Boolean))];

      // Ignora caminhos removidos que nunca foram rastreados: não existem no
      // disco E não estão rastreados → nada a fazer com eles.
      const relevantes = [];
      for (const arq of lista) {
        const existe = existsSync(resolve(cwd, arq));
        if (existe) {
          relevantes.push(arq);
        } else {
          // Arquivo ausente: só interessa se era rastreado (remoção real).
          const r = await git(['ls-files', '--error-unmatch', '--', arq]);
          if (r.codigo === 0) relevantes.push(arq);
        }
      }

      if (relevantes.length === 0) {
        return { ok: true, semAlteracoes: true };
      }

      // Adiciona os não rastreados (que existem) ao stage.
      const novos = (await naoRastreados(relevantes)).filter((a) =>
        existsSync(resolve(cwd, a)),
      );
      if (novos.length > 0) {
        await gitOuFalha(['add', '--', ...novos]);
      }

      // Garante que as remoções e modificações dos arquivos entrem no stage,
      // sem tocar em nada fora da lista.
      await gitOuFalha(['add', '--', ...relevantes]);

      if (!(await temMudancaStaged(relevantes))) {
        // Nada mudou em relação ao HEAD para esses arquivos.
        return { ok: true, semAlteracoes: true };
      }

      await gitOuFalha(['commit', '-m', mensagem, '--', ...relevantes]);
      return { ok: true, commit: mensagem };
    } catch (erro) {
      return { ok: false, erro: erro.message };
    }
  }

  /** HEAD atual (sha) ou null se não houver commits. */
  async function cabeca() {
    const r = await git(['rev-parse', 'HEAD']);
    return r.codigo === 0 ? r.stdout.trim() : null;
  }

  /**
   * `git pull --rebase --autostash` com a política RF021.
   * @returns {Promise<ResultadoGit>}
   */
  async function pullRebase() {
    try {
      const antes = await cabeca();
      const r = await git(['pull', '--rebase', '--autostash']);

      if (r.codigo !== 0) {
        // Pode ser conflito de rebase: inspeciona os arquivos em conflito.
        const conflito = await git(['diff', '--name-only', '--diff-filter=U']);
        const arquivos = conflito.stdout
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean);

        if (arquivos.length === 1 && arquivos[0] === 'atual.json') {
          // RF021: mantém a versão local recém-publicada (theirs no rebase) e
          // conclui o rebase.
          try {
            await gitOuFalha(['checkout', '--theirs', '--', 'atual.json']);
            await gitOuFalha(['add', '--', 'atual.json']);
            await gitOuFalha(['-c', 'core.editor=true', 'rebase', '--continue']);
            const depois = await cabeca();
            return { ok: true, codigoAlterado: await codigoAlterado(antes, depois) };
          } catch (e) {
            await git(['rebase', '--abort']);
            return { ok: false, erro: e.message, conflitos: arquivos };
          }
        }

        if (arquivos.length > 0) {
          // Qualquer outro conflito: aborta e preserva os commits locais.
          await git(['rebase', '--abort']);
          return { ok: false, conflitos: arquivos, push: 'conflito' };
        }

        // Falha que não é conflito (ex.: remoto inexistente / sem rede).
        return { ok: false, erro: (r.stderr || r.stdout).trim() };
      }

      const depois = await cabeca();
      return { ok: true, codigoAlterado: await codigoAlterado(antes, depois) };
    } catch (erro) {
      return { ok: false, erro: erro.message };
    }
  }

  /** Algum caminho alterado entre dois HEADs começa com montador/ ou scripts/? */
  async function codigoAlterado(antes, depois) {
    if (!antes || !depois || antes === depois) return false;
    const r = await git(['diff', '--name-only', `${antes}`, `${depois}`]);
    if (r.codigo !== 0) return false;
    return r.stdout
      .split('\n')
      .map((s) => s.trim())
      .some((caminho) => caminho.startsWith('montador/') || caminho.startsWith('scripts/'));
  }

  /**
   * Sincroniza e envia: pullRebase() e, sem conflito, `git push` (nunca force).
   * @returns {Promise<ResultadoGit>}
   */
  async function enviar() {
    const pull = await pullRebase();
    if (pull.conflitos) {
      return { ok: false, push: 'conflito', conflitos: pull.conflitos };
    }
    if (!pull.ok) {
      // Falha de rede/remoto: commit local permanece como envio pendente.
      return { ok: false, push: 'pendente', erro: pull.erro };
    }
    const r = await git(['push']);
    if (r.codigo !== 0) {
      return { ok: false, push: 'pendente', erro: (r.stderr || r.stdout).trim() };
    }
    return { ok: true, push: 'ok', codigoAlterado: pull.codigoAlterado };
  }

  /**
   * Estado da sincronização.
   * @returns {Promise<{ pendentes: number, ramo: string }>}
   */
  async function status() {
    const ramoR = await git(['rev-parse', '--abbrev-ref', 'HEAD']);
    const ramo = ramoR.codigo === 0 ? ramoR.stdout.trim() : '';
    const countR = await git(['rev-list', '--count', '@{u}..HEAD']);
    const pendentes = countR.codigo === 0 ? Number(countR.stdout.trim()) || 0 : 0;
    return { pendentes, ramo };
  }

  /** Autor para os logs: git config user.name || 'editor de escala'. */
  async function autor() {
    const r = await git(['config', 'user.name']);
    const nome = r.codigo === 0 ? r.stdout.trim() : '';
    return nome || 'editor de escala';
  }

  return { commitSeletivo, pullRebase, enviar, status, autor };
}
