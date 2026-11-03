import { invoke } from '@tauri-apps/api/core';
import type { IpcCommandMap, IpcCommandName } from './contracts';

// Mapa de nomes de comando TypeScript -> nomes de comando Rust (snake_case).
// Centralizar o mapeamento evita strings soltas espalhadas pelo codigo e
// garante que apenas comandos conhecidos sejam invocados.
const RUST_COMMAND_NAMES: Record<IpcCommandName, string> = {
  ping: 'ping',
};

/**
 * Invoca um comando IPC tipado no nucleo Rust.
 *
 * O tipo da carga e do retorno sao derivados do mapa fechado `IpcCommandMap`,
 * de modo que chamadas com nome, payload ou retorno incompativeis nao compilam.
 */
export async function invokeCommand<K extends IpcCommandName>(
  command: K,
  request: IpcCommandMap[K]['request'],
): Promise<IpcCommandMap[K]['response']> {
  const rustName = RUST_COMMAND_NAMES[command];
  // O nucleo Rust recebe a carga sob a chave "request" (ver src-tauri/src/lib.rs).
  return invoke<IpcCommandMap[K]['response']>(rustName, { request });
}
