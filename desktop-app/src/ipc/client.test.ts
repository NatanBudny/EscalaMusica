import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock do nucleo Tauri: o smoke test valida o contrato tipado sem iniciar o
// processo Rust real e sem acessar nenhum arquivo do legado.
const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { invokeCommand } from './client';
import type { PingResponse } from './contracts';

describe('IPC tipado (smoke test)', () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it('invoca o comando "ping" com a carga tipada e devolve a resposta tipada', async () => {
    const fakeResponse: PingResponse = {
      echo: 'ola-nucleo',
      coreVersion: '0.0.0',
      legacyUntouched: true,
    };
    invokeMock.mockResolvedValueOnce(fakeResponse);

    const response = await invokeCommand('ping', { message: 'ola-nucleo' });

    // O comando TypeScript "ping" mapeia para o comando Rust "ping"
    // e a carga viaja sob a chave "request".
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith('ping', {
      request: { message: 'ola-nucleo' },
    });

    // A resposta confirma o trajeto de ida e volta e que o legado nao foi tocado.
    expect(response.echo).toBe('ola-nucleo');
    expect(response.legacyUntouched).toBe(true);
  });

  it('propaga erros do nucleo para o chamador', async () => {
    invokeMock.mockRejectedValueOnce(new Error('falha simulada do nucleo'));

    await expect(invokeCommand('ping', { message: 'x' })).rejects.toThrow(
      'falha simulada do nucleo',
    );
  });
});
