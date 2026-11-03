// Testes do módulo git (Task 2): Property 1, Property 2 e unitários.

import fc from 'fast-check';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { criarGit } from '../../montador/lib/git.mjs';
import { criarRepoTemporario, clonar, git as gitRaw } from '../helpers/repo-temporario.js';

// Restaura o repositório ao commit base: descarta mudanças e não rastreados.
function resetHard(dir, baseRef) {
  gitRaw(dir, ['reset', '--hard', baseRef]);
  gitRaw(dir, ['clean', '-fdx']);
}

// Helpers de inspeção do estado do repositório.
function statusPorcelana(dir) {
  return gitRaw(dir, ['status', '--porcelain']);
}
function arquivosDoUltimoCommit(dir) {
  return gitRaw(dir, ['show', '--name-only', '--pretty=format:', 'HEAD'])
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .sort();
}
function totalCommits(dir) {
  return Number(gitRaw(dir, ['rev-list', '--count', 'HEAD']));
}

describe('Property 1: Commit seletivo exato', () => {
  let repo;
  let base;

  beforeAll(() => {
    repo = criarRepoTemporario();
    // Cria uma base com arquivos rastreados candidatos a "modificar".
    repo.escrever('a.json', 'original-a\n');
    repo.escrever('b.json', 'original-b\n');
    repo.escrever('c.json', 'original-c\n');
    repo.escrever('d.json', 'original-d\n');
    repo.git(['add', '-A']);
    repo.git(['commit', '-m', 'base candidatos']);
    base = repo.git(['rev-parse', 'HEAD']);
  });

  afterAll(() => repo.limpar());

  // Feature: melhoras-domingao, Property 1: Commit seletivo exato
  test('o commit contém exatamente o subconjunto S; o resto fica fora; sem mudanças → sem commit', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            nome: fc.constantFrom('a.json', 'b.json', 'nova1.json', 'nova2.json'),
            noS: fc.boolean(),
          }),
          { minLength: 0, maxLength: 4 },
        ),
        async (itens) => {
          resetHard(repo.dir, base);

          // Nomes únicos.
          const vistos = new Set();
          const alvos = itens.filter((i) => {
            if (vistos.has(i.nome)) return false;
            vistos.add(i.nome);
            return true;
          });

          // Aplica mudanças de trabalho (modifica rastreados / cria novos).
          for (const it of alvos) {
            repo.escrever(it.nome, `conteudo-${Math.random()}\n`);
          }

          const S = alvos.filter((i) => i.noS).map((i) => i.nome);
          const commitsAntes = totalCommits(repo.dir);

          const git = criarGit({ cwd: repo.dir, env: process.env });
          const r = await git.commitSeletivo(S, 'commit seletivo de teste');

          expect(r.ok).toBe(true);

          // S realmente mudou? (todos os alvos foram reescritos, então sim)
          const sComMudanca = [...new Set(S)];

          if (sComMudanca.length === 0) {
            expect(r.semAlteracoes).toBe(true);
            expect(totalCommits(repo.dir)).toBe(commitsAntes);
          } else {
            expect(totalCommits(repo.dir)).toBe(commitsAntes + 1);
            expect(arquivosDoUltimoCommit(repo.dir)).toEqual(sComMudanca.sort());
            // Arquivos fora de S continuam modificados na árvore de trabalho.
            const foraS = alvos.map((i) => i.nome).filter((n) => !S.includes(n));
            const status = statusPorcelana(repo.dir);
            for (const n of foraS) {
              expect(status).toContain(n);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  }, 120000);
});

describe('Property 2: Sincronização sem perda', () => {
  let repo;
  let outro;
  let base;

  beforeAll(() => {
    repo = criarRepoTemporario();
    outro = clonar(repo.remoto, `outro-${Math.random().toString(36).slice(2)}`);
    base = repo.git(['rev-parse', 'HEAD']);
    // Upstream já configurado uma vez (criarRepoTemporario fez push -u).
    repo.git(['branch', '--set-upstream-to=origin/main', 'main']);
  }, 30000);

  afterAll(() => repo.limpar());

  /** Volta local, remoto e "outro" ao commit base. */
  function reiniciar() {
    resetHard(repo.dir, base);
    resetHard(outro.dir, base);
    // Força o bare remoto de volta ao base (permitido só no cenário de teste).
    gitRaw(repo.remoto, ['update-ref', 'refs/heads/main', base]);
    repo.git(['update-ref', 'refs/remotes/origin/main', base]);
  }

  // Feature: melhoras-domingao, Property 2: Sincronização sem perda
  test('enviar() não reescreve o remoto; conflito só em atual.json fica com a versão local; outro conflito aborta', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          remotoAtual: fc.string({ minLength: 1, maxLength: 8, unit: fc.constantFrom(...'abcdefgh'.split('')) }),
          localAtual: fc.string({ minLength: 1, maxLength: 8, unit: fc.constantFrom(...'ijklmnop'.split('')) }),
          conflitoExtra: fc.boolean(),
        }),
        async ({ remotoAtual, localAtual, conflitoExtra }) => {
          reiniciar();

          // Outro computador avança o remoto.
          outro.escrever('atual.json', `["${remotoAtual}"]\n`);
          if (conflitoExtra) outro.escrever('b.json', 'remoto\n');
          outro.git(['add', '-A']);
          outro.git(['commit', '-m', 'mudanca remota']);
          outro.git(['push', 'origin', 'main']);

          // Local diverge.
          repo.escrever('atual.json', `["${localAtual}"]\n`);
          if (conflitoExtra) repo.escrever('b.json', 'local\n');
          repo.git(['add', '-A']);
          repo.git(['commit', '-m', 'mudanca local']);

          const headRemotoAntes = gitRaw(repo.remoto, ['rev-parse', 'main']);
          const git = criarGit({ cwd: repo.dir, env: process.env });
          const r = await git.enviar();

          if (conflitoExtra) {
            expect(r.push).toBe('conflito');
            expect(r.conflitos).toBeDefined();
            expect(repo.git(['log', '-1', '--pretty=%s'])).toBe('mudanca local');
            // Remoto não reescrito.
            expect(gitRaw(repo.remoto, ['rev-parse', 'main'])).toBe(headRemotoAntes);
          } else {
            // RF021: fica com a versão local e envia.
            expect(r.ok).toBe(true);
            expect(r.push).toBe('ok');
            expect(readFileSync(resolve(repo.dir, 'atual.json'), 'utf8')).toBe(`["${localAtual}"]\n`);
            // O commit remoto não foi descartado (push sem force).
            const historicoRemoto = gitRaw(repo.remoto, ['log', '--pretty=%s']);
            expect(historicoRemoto).toContain('mudanca remota');
          }
        },
      ),
      { numRuns: 100 },
    );
  }, 300000);

  test('status().pendentes = commits locais ausentes no remoto', async () => {
    reiniciar();
    const git = criarGit({ cwd: repo.dir, env: process.env });
    expect((await git.status()).pendentes).toBe(0);

    repo.escrever('c.json', 'x\n');
    repo.git(['add', '-A']);
    repo.git(['commit', '-m', 'local 1']);
    repo.escrever('c.json', 'y\n');
    repo.git(['add', '-A']);
    repo.git(['commit', '-m', 'local 2']);

    expect((await git.status()).pendentes).toBe(2);
  });
});

describe('Módulo git — unitários (Task 2.3)', () => {
  test('commitSeletivo faz add de arquivo novo e commita só ele', async () => {
    const repo = criarRepoTemporario();
    try {
      repo.escrever('novo.json', '{"a":1}\n');
      repo.escrever('outro.json', 'solto\n');
      const git = criarGit({ cwd: repo.dir, env: process.env });
      const r = await git.commitSeletivo(['novo.json'], 'add novo');
      expect(r.ok).toBe(true);
      expect(arquivosDoUltimoCommit(repo.dir)).toEqual(['novo.json']);
      // outro.json continua fora (não rastreado).
      expect(statusPorcelana(repo.dir)).toContain('outro.json');
    } finally {
      repo.limpar();
    }
  });

  test('commitSeletivo sem mudanças devolve semAlteracoes', async () => {
    const repo = criarRepoTemporario();
    try {
      const git = criarGit({ cwd: repo.dir, env: process.env });
      const r = await git.commitSeletivo(['atual.json'], 'nada muda');
      expect(r).toEqual({ ok: true, semAlteracoes: true });
    } finally {
      repo.limpar();
    }
  });

  test('push falha (remoto inexistente) vira envio pendente, sem --force', async () => {
    const repo = criarRepoTemporario();
    try {
      // Aponta o remoto para um caminho inexistente.
      repo.git(['remote', 'set-url', 'origin', resolve(repo.dir, 'nao-existe.git')]);
      repo.escrever('atual.json', '["z"]\n');
      repo.git(['add', '-A']);
      repo.git(['commit', '-m', 'local']);

      const git = criarGit({ cwd: repo.dir, env: process.env });
      const r = await git.enviar();
      expect(r.ok).toBe(false);
      expect(r.push).toBe('pendente');
      // O commit local permanece.
      expect(repo.git(['log', '-1', '--pretty=%s'])).toBe('local');
    } finally {
      repo.limpar();
    }
  });

  test('autor devolve o user.name configurado', async () => {
    const repo = criarRepoTemporario();
    try {
      repo.git(['config', 'user.name', 'Fulano de Tal']);
      const git = criarGit({ cwd: repo.dir, env: process.env });
      expect(await git.autor()).toBe('Fulano de Tal');
    } finally {
      repo.limpar();
    }
  });

  test('execFile é usado sem shell: mensagem com metacaracteres não executa comando', async () => {
    const repo = criarRepoTemporario();
    try {
      repo.escrever('atual.json', '["seguro"]\n');
      const git = criarGit({ cwd: repo.dir, env: process.env });
      // Se passasse por shell, "$(...)" seria interpretado. Como é execFile com
      // array, a mensagem fica literal.
      const msg = 'commit $(touch HACKEADO) `whoami`';
      const r = await git.commitSeletivo(['atual.json'], msg);
      expect(r.ok).toBe(true);
      expect(existsSync(resolve(repo.dir, 'HACKEADO'))).toBe(false);
      expect(repo.git(['log', '-1', '--pretty=%s'])).toBe(msg);
    } finally {
      repo.limpar();
    }
  });
});
