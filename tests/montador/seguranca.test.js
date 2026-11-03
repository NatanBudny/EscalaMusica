// Testes de segurança das requisições do Servidor_Local (Task 1).

import fc from 'fast-check';
import { PassThrough } from 'node:stream';
import { validarRequisicao, lerCorpoJson, LIMITE_CORPO } from '../../montador/lib/seguranca.mjs';

const PORTA = 4599;

/** Monta uma requisição falsa como stream de corpo. */
function reqFalso(corpo) {
  const stream = new PassThrough();
  process.nextTick(() => {
    if (corpo != null) stream.write(corpo);
    stream.end();
  });
  return stream;
}

describe('validarRequisicao — unidade', () => {
  test('GET do host permitido passa', () => {
    expect(validarRequisicao({ method: 'GET', headers: { host: `127.0.0.1:${PORTA}` } }, PORTA)).toEqual({ ok: true });
    expect(validarRequisicao({ method: 'GET', headers: { host: `localhost:${PORTA}` } }, PORTA)).toEqual({ ok: true });
  });

  test('Host fora da lista → 403', () => {
    const r = validarRequisicao({ method: 'GET', headers: { host: 'exemplo.com' } }, PORTA);
    expect(r.ok).toBe(false);
    expect(r.status).toBe(403);
  });

  test('POST sem Origin permitido → 403', () => {
    const r = validarRequisicao(
      { method: 'POST', headers: { host: `127.0.0.1:${PORTA}`, origin: 'https://exemplo.com', 'content-type': 'application/json', 'content-length': '2' } },
      PORTA,
    );
    expect(r.ok).toBe(false);
    expect(r.status).toBe(403);
  });

  test('POST com Origin permitido e JSON passa', () => {
    const r = validarRequisicao(
      { method: 'POST', headers: { host: `127.0.0.1:${PORTA}`, origin: `http://127.0.0.1:${PORTA}`, 'content-type': 'application/json', 'content-length': '2' } },
      PORTA,
    );
    expect(r).toEqual({ ok: true });
  });

  test('corpo com content-type diferente de JSON → 415', () => {
    const r = validarRequisicao(
      { method: 'POST', headers: { host: `127.0.0.1:${PORTA}`, origin: `http://localhost:${PORTA}`, 'content-type': 'text/plain', 'content-length': '5' } },
      PORTA,
    );
    expect(r.ok).toBe(false);
    expect(r.status).toBe(415);
  });
});

describe('lerCorpoJson — unidade', () => {
  test('corpo vazio devolve {}', async () => {
    await expect(lerCorpoJson(reqFalso(null))).resolves.toEqual({});
  });

  test('JSON válido é interpretado', async () => {
    await expect(lerCorpoJson(reqFalso('{"a":1}'))).resolves.toEqual({ a: 1 });
  });

  test('JSON inválido rejeita com status 400', async () => {
    await expect(lerCorpoJson(reqFalso('{nao-json'))).rejects.toMatchObject({ status: 400 });
  });

  test('corpo acima do limite rejeita com status 413', async () => {
    await expect(lerCorpoJson(reqFalso('abcdef'), 3)).rejects.toMatchObject({ status: 413 });
  });
});

// Feature: melhoras-domingao, Property 38: Segurança das requisições
describe('Property 38: Segurança das requisições', () => {
  const metodoArb = fc.constantFrom('GET', 'POST', 'PUT', 'DELETE');
  const hostArb = fc.constantFrom(
    `127.0.0.1:${PORTA}`,
    `localhost:${PORTA}`,
    'exemplo.com',
    `127.0.0.1:1234`,
    '',
  );
  const originArb = fc.constantFrom(
    `http://127.0.0.1:${PORTA}`,
    `http://localhost:${PORTA}`,
    'https://exemplo.com',
    '',
  );
  const tipoArb = fc.constantFrom('application/json', 'application/json; charset=utf-8', 'text/plain', '');

  test('validarRequisicao aceita sse host, origin e content-type são válidos', () => {
    fc.assert(
      fc.property(metodoArb, hostArb, originArb, tipoArb, fc.integer({ min: 0, max: 10 }), (method, host, origin, tipo, tamanho) => {
        const headers = { host };
        if (origin) headers.origin = origin;
        if (tipo) headers['content-type'] = tipo;
        if (tamanho > 0) headers['content-length'] = String(tamanho);

        const r = validarRequisicao({ method, headers }, PORTA);

        const hostOk = host === `127.0.0.1:${PORTA}` || host === `localhost:${PORTA}`;
        const precisaOrigin = method === 'POST' || method === 'PUT' || method === 'DELETE';
        const originOk = origin === `http://127.0.0.1:${PORTA}` || origin === `http://localhost:${PORTA}`;
        const temCorpo = tamanho > 0;
        const tipoBase = tipo.split(';')[0].trim().toLowerCase();
        const tipoOk = tipoBase === 'application/json';

        if (!hostOk) {
          expect(r).toEqual({ ok: false, status: 403, erro: expect.any(String) });
          return;
        }
        if (precisaOrigin && !originOk) {
          expect(r).toMatchObject({ ok: false, status: 403 });
          return;
        }
        if (temCorpo && !tipoOk) {
          expect(r).toMatchObject({ ok: false, status: 415 });
          return;
        }
        expect(r).toEqual({ ok: true });
      }),
      { numRuns: 300 },
    );
  });

  test('lerCorpoJson respeita o limite de 5 MB (413) e rejeita JSON inválido (400/413)', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: 20 }), fc.integer({ min: 1, max: 10 }), async (tamanho, limite) => {
        const corpo = tamanho > 0 ? 'x'.repeat(tamanho) : null;
        const promessa = lerCorpoJson(reqFalso(corpo), limite);
        if (tamanho > limite) {
          await expect(promessa).rejects.toMatchObject({ status: 413 });
        } else if (tamanho === 0) {
          await expect(promessa).resolves.toEqual({});
        } else {
          // 'xxxx' não é JSON válido → 400 (e não 413, já que cabe no limite).
          await expect(promessa).rejects.toMatchObject({ status: 400 });
        }
      }),
      { numRuns: 100 },
    );
  });

  test('LIMITE_CORPO é 5 MB', () => {
    expect(LIMITE_CORPO).toBe(5 * 1024 * 1024);
  });
});
