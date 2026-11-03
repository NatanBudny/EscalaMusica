// Contratos tipados de IPC entre o frontend React e o nucleo Rust.
//
// A superficie inicial e deliberadamente minima: um unico comando de verificacao
// ("ping") que prova o canal tipado sem acessar nem alterar arquivos do legado
// (atual.json, contatos.json) ou do visualizador vigente.
//
// Qualquer comando novo DEVE ser declarado aqui com nome, payload e resposta
// explicitos, para que a camada de aplicacao nunca chame comandos arbitrarios.

/**
 * Carga enviada ao comando de verificacao de saude do nucleo.
 */
export interface PingRequest {
  /** Mensagem livre ecoada de volta pelo nucleo, usada no smoke test. */
  message: string;
}

/**
 * Resposta do comando de verificacao de saude do nucleo.
 */
export interface PingResponse {
  /** Eco da mensagem enviada, confirmando o trajeto de ida e volta tipado. */
  echo: string;
  /** Versao do nucleo Rust, util para diagnostico. */
  coreVersion: string;
  /**
   * Confirma que o nucleo nao toca no legado. Sempre `true` neste scaffold,
   * pois nenhum comando acessa atual.json, contatos.json ou o visualizador.
   */
  legacyUntouched: boolean;
}

/**
 * Mapa fechado de comandos IPC suportados: nome -> (request, response).
 * Serve como fonte unica de verdade para a tipagem de `invokeCommand`.
 */
export interface IpcCommandMap {
  ping: { request: PingRequest; response: PingResponse };
}

/** Nomes validos de comando derivados do mapa fechado. */
export type IpcCommandName = keyof IpcCommandMap;
