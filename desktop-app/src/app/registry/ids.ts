// Geracao de identificadores estaveis para novos sujeitos do cadastro.
//
// O id de uma Pessoa_Canonica ou Departamento nunca muda apos a criacao
// (requisitos 3.1 e 3.5). A UI apenas gera o id na criacao e o entrega ao
// RegistryService; nenhuma edicao subsequente o altera.

/**
 * Retorna um UUID v4. Usa `crypto.randomUUID` quando disponivel (navegador,
 * WebView2, WebKit e jsdom moderno) e cai para uma geracao equivalente baseada
 * em `crypto.getRandomValues` quando `randomUUID` nao existir.
 */
export function newUuid(): string {
  const cryptoObj: Crypto | undefined =
    typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;

  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
    return cryptoObj.randomUUID();
  }

  const bytes = new Uint8Array(16);
  if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
    cryptoObj.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  // Versao 4 e variante conforme RFC 4122.
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  const hex: string[] = [];
  for (let i = 0; i < bytes.length; i += 1) {
    hex.push(bytes[i]!.toString(16).padStart(2, '0'));
  }
  return (
    `${hex[0]}${hex[1]}${hex[2]}${hex[3]}-` +
    `${hex[4]}${hex[5]}-` +
    `${hex[6]}${hex[7]}-` +
    `${hex[8]}${hex[9]}-` +
    `${hex[10]}${hex[11]}${hex[12]}${hex[13]}${hex[14]}${hex[15]}`
  );
}

/** Instante UTC RFC 3339 do momento atual, usado em `createdAt`/`updatedAt`. */
export function nowUtc(): string {
  return new Date().toISOString();
}
