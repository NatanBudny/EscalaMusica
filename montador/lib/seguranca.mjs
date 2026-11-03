// Segurança das requisições do Servidor_Local.
//
// O servidor só atende o próprio computador (127.0.0.1). Estas funções protegem
// contra CSRF e DNS rebinding a partir de páginas abertas no navegador:
// conferem Host, Origin e content-type, e limitam o tamanho do corpo.
//
// Feature: melhoras-domingao (A. Fundação) — Requisitos 1.2, 1.3, 1.4, 1.5.

export const LIMITE_CORPO = 5 * 1024 * 1024; // 5 MB

const METODOS_COM_ORIGIN = new Set(['POST', 'PUT', 'DELETE']);

/** Hosts aceitos para a porta: 127.0.0.1:<porta> e localhost:<porta>. */
function hostsPermitidos(porta) {
  return new Set([`127.0.0.1:${porta}`, `localhost:${porta}`]);
}

/** Origins aceitas para a porta: http://127.0.0.1:<porta> e http://localhost:<porta>. */
function originsPermitidas(porta) {
  return new Set([`http://127.0.0.1:${porta}`, `http://localhost:${porta}`]);
}

/**
 * Valida uma requisição recebida.
 *
 * @param {{ method?: string, headers?: Record<string,string|string[]|undefined> }} req
 * @param {number|string} porta
 * @returns {{ ok: true } | { ok: false, status: 403 | 415, erro: string }}
 */
export function validarRequisicao({ method, headers } = {}, porta) {
  const cabecalhos = headers || {};
  const metodo = String(method || 'GET').toUpperCase();

  const host = String(cabecalhos.host || '').toLowerCase();
  if (!hostsPermitidos(porta).has(host)) {
    return {
      ok: false,
      status: 403,
      erro: `Host nao permitido: "${host || '(ausente)'}".`,
    };
  }

  // POST/PUT/DELETE exigem Origin da lista (protege contra CSRF).
  if (METODOS_COM_ORIGIN.has(metodo)) {
    const origin = String(cabecalhos.origin || '');
    if (!originsPermitidas(porta).has(origin)) {
      return {
        ok: false,
        status: 403,
        erro: `Origin nao permitido: "${origin || '(ausente)'}".`,
      };
    }
  }

  // Requisição com corpo deve ter content-type application/json.
  if (temCorpo(cabecalhos)) {
    const tipo = String(cabecalhos['content-type'] || '')
      .split(';')[0]
      .trim()
      .toLowerCase();
    if (tipo !== 'application/json') {
      return {
        ok: false,
        status: 415,
        erro: 'content-type deve ser application/json.',
      };
    }
  }

  return { ok: true };
}

/** Considera que há corpo se há content-length > 0 ou transfer-encoding. */
function temCorpo(cabecalhos) {
  const tamanho = Number(cabecalhos['content-length']);
  if (Number.isFinite(tamanho) && tamanho > 0) return true;
  if (cabecalhos['transfer-encoding']) return true;
  return false;
}

/**
 * Lê o corpo de uma requisição como JSON, com limite de tamanho.
 *
 * @param {import('node:http').IncomingMessage} req
 * @param {number} limite - bytes (padrão 5 MB)
 * @returns {Promise<object>} corpo interpretado ({} quando vazio)
 *   rejeita com um Error que carrega `.status` 413 (muito grande) ou 400 (JSON inválido).
 */
export function lerCorpoJson(req, limite = LIMITE_CORPO) {
  return new Promise((resolver, rejeitar) => {
    const chunks = [];
    let total = 0;
    let excedeu = false;

    const falhar = (status, mensagem) => {
      const erro = new Error(mensagem);
      erro.status = status;
      rejeitar(erro);
    };

    req.on('data', (c) => {
      if (excedeu) return;
      total += c.length;
      if (total > limite) {
        excedeu = true;
        falhar(413, `Corpo excede o limite de ${limite} bytes.`);
        // Interrompe a leitura: o servidor devolve 413 e encerra a resposta.
        req.destroy();
        return;
      }
      chunks.push(c);
    });

    req.on('end', () => {
      if (excedeu) return;
      if (chunks.length === 0) {
        resolver({});
        return;
      }
      try {
        resolver(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        falhar(400, 'Corpo nao e um JSON valido.');
      }
    });

    req.on('error', (err) => {
      if (excedeu) return;
      falhar(400, err.message);
    });
  });
}
