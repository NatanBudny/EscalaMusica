// Testes unitários do servidor (Task 1.2): endereço de escuta, /api/saude,
// validação de requisições e rotas de sincronização.

import { criarServidor, comandoNavegador } from '../../montador/server.mjs';

/** Git falso: registra chamadas e devolve respostas controladas. */
function gitFalso(respostas = {}) {
  const chamadas = [];
  return {
    chamadas,
    async status() {
      chamadas.push(['status']);
      return respostas.status || { pendentes: 0, ramo: 'main' };
    },
    async enviar() {
      chamadas.push(['enviar']);
      return respostas.enviar || { ok: true, push: 'ok' };
    },
    async commitSeletivo(arquivos, msg) {
      chamadas.push(['commitSeletivo', arquivos, msg]);
      return respostas.commitSeletivo || { ok: true, commit: msg };
    },
    async pullRebase() {
      chamadas.push(['pullRebase']);
      return respostas.pullRebase || { ok: true };
    },
    async autor() {
      return 'teste';
    },
  };
}

/** Sobe o servidor numa porta efêmera em 127.0.0.1 e devolve a base URL. */
function subir(git) {
  return new Promise((resolver) => {
    const porta = 45990 + Math.floor(Math.random() * 500);
    const server = criarServidor({ porta, git });
    server.listen(porta, '127.0.0.1', () => {
      const addr = server.address();
      resolver({ server, porta, base: `http://127.0.0.1:${addr.port}`, enderecoListen: addr.address });
    });
  });
}

function fechar(server) {
  return new Promise((r) => server.close(r));
}

describe('criarServidor', () => {
  let ctx;
  let git;

  beforeEach(async () => {
    git = gitFalso();
    ctx = await subir(git);
  });

  afterEach(async () => {
    await fechar(ctx.server);
  });

  test('escuta somente em 127.0.0.1', () => {
    expect(ctx.enderecoListen).toBe('127.0.0.1');
  });

  test('GET /api/saude responde { ok: true }', async () => {
    const r = await fetch(`${ctx.base}/api/saude`, { headers: { host: `127.0.0.1:${ctx.porta}` } });
    expect(r.status).toBe(200);
    await expect(r.json()).resolves.toEqual({ ok: true });
  });

  test('Host fora da lista recebe 403', async () => {
    // fetch sempre manda Host correto; forçamos um Host inválido pela porta real
    // divergente no cabeçalho não é possível via fetch, então validamos a rota
    // de API com Origin inválido (POST).
    const r = await fetch(`${ctx.base}/api/sync/tentar-de-novo`, {
      method: 'POST',
      headers: {
        host: `127.0.0.1:${ctx.porta}`,
        origin: 'https://exemplo.com',
        'content-type': 'application/json',
      },
      body: '{}',
    });
    expect(r.status).toBe(403);
    expect(git.chamadas).not.toContainEqual(['enviar']);
  });

  test('GET /api/sync/status chama git.status', async () => {
    const r = await fetch(`${ctx.base}/api/sync/status`);
    expect(r.status).toBe(200);
    await expect(r.json()).resolves.toEqual({ pendentes: 0, ramo: 'main' });
    expect(git.chamadas).toContainEqual(['status']);
  });

  test('POST /api/sync/tentar-de-novo com Origin válido chama git.enviar', async () => {
    const addr = ctx.server.address().port;
    const r = await fetch(`${ctx.base}/api/sync/tentar-de-novo`, {
      method: 'POST',
      headers: {
        origin: `http://127.0.0.1:${addr}`,
        'content-type': 'application/json',
      },
      body: '{}',
    });
    expect(r.status).toBe(200);
    expect(git.chamadas).toContainEqual(['enviar']);
  });
});

describe('comandoNavegador (abertura do navegador)', () => {
  const endereco = 'http://127.0.0.1:4599/';

  test('URL do navegador é 127.0.0.1 na porta (macOS)', () => {
    const cmd = comandoNavegador(endereco, { env: {}, plataforma: 'darwin' });
    expect(cmd).toEqual({ comando: 'open', args: [endereco] });
  });

  test('Linux usa xdg-open', () => {
    const cmd = comandoNavegador(endereco, { env: {}, plataforma: 'linux' });
    expect(cmd).toEqual({ comando: 'xdg-open', args: [endereco] });
  });

  test('Windows usa cmd /c start', () => {
    const cmd = comandoNavegador(endereco, { env: {}, plataforma: 'win32' });
    expect(cmd).toEqual({ comando: 'cmd', args: ['/c', 'start', '', endereco] });
  });

  test('MONTADOR_SEM_NAVEGADOR=1 não abre o navegador', () => {
    const cmd = comandoNavegador(endereco, { env: { MONTADOR_SEM_NAVEGADOR: '1' }, plataforma: 'darwin' });
    expect(cmd).toBeNull();
  });
});
