// Testes de baixar-mingit.mjs (Task 42.1): a conferência do SHA-256 recusa o
// download quando o hash difere ou ainda é o placeholder, SEM extrair nada.
//
// Não há acesso à rede: um fetch falso devolve um conteúdo em memória. A
// extração usa um destino em os.tmpdir() e verificamos que nada foi criado
// quando o hash não bate.
//
// Feature: melhoras-domingao (G. Instalador) — Requisitos 30.9, 32.1.
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  sha256Hex,
  conferirSha256,
  lerMingitJson,
  baixarMinGit,
} from '../../editor-windows/scripts/baixar-mingit.mjs';

const PLACEHOLDER = 'PENDENTE_CONFERIR';

/** Cria um fetch falso que devolve sempre o mesmo conteúdo binário. */
function fetchFalso(conteudo, { ok = true, status = 200 } = {}) {
  return async () => ({
    ok,
    status,
    arrayBuffer: async () => Uint8Array.from(conteudo).buffer,
  });
}

/** Monta um mingit.json temporário e devolve o caminho e a pasta temporária. */
function prepararTmp(sha256) {
  const dir = mkdtempSync(join(tmpdir(), 'mingit-test-'));
  const mingitPath = join(dir, 'mingit.json');
  writeFileSync(
    mingitPath,
    JSON.stringify({
      versao: '2.47.1.windows.1',
      url: 'https://exemplo.invalido/MinGit-2.47.1-64-bit.zip',
      sha256,
    }),
  );
  return { dir, mingitPath };
}

describe('conferirSha256', () => {
  test('aceita quando o hash bate e devolve o hash calculado', () => {
    const buffer = Buffer.from('conteudo qualquer');
    const esperado = createHash('sha256').update(buffer).digest('hex');
    expect(conferirSha256(buffer, esperado)).toBe(esperado);
  });

  test('aceita hash em maiúsculas (normaliza)', () => {
    const buffer = Buffer.from('abc');
    const esperado = sha256Hex(buffer);
    expect(conferirSha256(buffer, esperado.toUpperCase())).toBe(esperado);
  });

  test('recusa quando o hash difere', () => {
    const buffer = Buffer.from('conteudo real');
    const hashDiferente = sha256Hex(Buffer.from('outra coisa'));
    expect(() => conferirSha256(buffer, hashDiferente)).toThrow(/não bate/i);
  });

  test('recusa o placeholder PENDENTE_CONFERIR com orientação', () => {
    const buffer = Buffer.from('qualquer');
    expect(() => conferirSha256(buffer, PLACEHOLDER)).toThrow(/PENDENTE_CONFERIR/);
    expect(() => conferirSha256(buffer, PLACEHOLDER)).toThrow(/mingit\.json/);
  });
});

describe('baixarMinGit', () => {
  let tmp;

  afterEach(() => {
    if (tmp?.dir) rmSync(tmp.dir, { recursive: true, force: true });
  });

  test('não extrai quando o hash de mingit.json difere do baixado', async () => {
    const conteudo = Buffer.from('zip-falso-bytes');
    const hashErrado = sha256Hex(Buffer.from('conteudo diferente'));
    tmp = prepararTmp(hashErrado);
    const destino = join(tmp.dir, 'vendor', 'mingit');
    const tmpZip = join(tmp.dir, 'vendor', 'mingit.zip');

    await expect(
      baixarMinGit({
        mingitPath: tmp.mingitPath,
        destino,
        tmpZip,
        fetch: fetchFalso(conteudo),
      }),
    ).rejects.toThrow(/não bate/i);

    expect(existsSync(destino)).toBe(false);
    expect(existsSync(tmpZip)).toBe(false);
  });

  test('não extrai quando mingit.json ainda tem o placeholder', async () => {
    const conteudo = Buffer.from('zip-falso-bytes');
    tmp = prepararTmp(PLACEHOLDER);
    const destino = join(tmp.dir, 'vendor', 'mingit');
    const tmpZip = join(tmp.dir, 'vendor', 'mingit.zip');

    await expect(
      baixarMinGit({
        mingitPath: tmp.mingitPath,
        destino,
        tmpZip,
        fetch: fetchFalso(conteudo),
      }),
    ).rejects.toThrow(/PENDENTE_CONFERIR/);

    expect(existsSync(destino)).toBe(false);
    expect(existsSync(tmpZip)).toBe(false);
  });

  test('falha quando o download não é ok, sem extrair', async () => {
    const conteudo = Buffer.from('x');
    tmp = prepararTmp(sha256Hex(conteudo));
    const destino = join(tmp.dir, 'vendor', 'mingit');

    await expect(
      baixarMinGit({
        mingitPath: tmp.mingitPath,
        destino,
        tmpZip: join(tmp.dir, 'vendor', 'mingit.zip'),
        fetch: fetchFalso(conteudo, { ok: false, status: 404 }),
      }),
    ).rejects.toThrow(/HTTP 404/);

    expect(existsSync(destino)).toBe(false);
  });
});

describe('mingit.json do repositório', () => {
  test('tem versao, url oficial e sha256 (placeholder documentado)', () => {
    const dados = lerMingitJson(
      new URL('../../editor-windows/mingit.json', import.meta.url),
    );
    expect(dados.versao).toBe('2.47.1.windows.1');
    expect(dados.url).toMatch(
      /^https:\/\/github\.com\/git-for-windows\/git\/releases\/download\/v2\.47\.1\.windows\.1\/MinGit-2\.47\.1-64-bit\.zip$/,
    );
    // O hash começa como placeholder; deve ser conferido/atualizado no build.
    expect(typeof dados.sha256).toBe('string');
    expect(dados.sha256.length).toBeGreaterThan(0);
  });
});
