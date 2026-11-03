// Preload da tela de configuração (primeira execução).
//
// Expõe à configuracao.html uma API mínima e segura por contextBridge, sem
// abrir o Node para a página. A página só pode: enviar o token, pedir para
// tentar de novo e ouvir o resultado da validação/clone vindos do main.
//
// A janela usa contextIsolation:true, sandbox:true e sem nodeIntegration; por
// isso a página não acessa `require` nem `ipcRenderer` diretamente — só a API
// `window.configuracao` definida aqui.
//
// Feature: melhoras-domingao (G. Instalador) — Requisitos 31.1, 31.3.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('configuracao', {
  /** Envia o token colado ao main para validar, cifrar e clonar. */
  enviarToken: (token) => ipcRenderer.invoke('configuracao:enviar-token', token),

  /**
   * Registra um ouvinte do estado do processo (ex.: 'validando', 'clonando',
   * 'erro', 'pronto'). Devolve uma função para cancelar a inscrição.
   */
  aoAtualizar: (callback) => {
    const ouvinte = (_evento, estado) => callback(estado);
    ipcRenderer.on('configuracao:estado', ouvinte);
    return () => ipcRenderer.removeListener('configuracao:estado', ouvinte);
  },
});
