// Servidor local sob a Casca.
//
// Funções puras para montar o ambiente do processo do Servidor_Local, decidir
// o reinício único no código 75 e esperar o /api/saude responder antes de abrir
// a janela.
//
// Feature: melhoras-domingao (G. Casca) — Requisitos 30.1, 30.2, 30.4, 30.5, 30.9, 31.5.

/** Porta fixa do Servidor_Local sob a Casca (mantém a mesma origem/localStorage). */
export const PORTA = 4599;

/**
 * Monta o `env` do processo do Servidor_Local executado pela Casca.
 *
 * O token NUNCA aparece fora de `ESCALA_GIT_TOKEN`: o git o recebe por
 * `GIT_ASKPASS` + variável de ambiente, nunca em URL, argumento, log ou arquivo
 * do repositório. O gerenciador de credenciais é desligado por variável
 * (`credential.helper` vazio), sem alterar arquivos de configuração.
 *
 * @param {{ porta?: number, mingitDir?: string, askpass?: string, token?: string,
 *           base?: NodeJS.ProcessEnv }} opcoes
 * @returns {Record<string, string>}
 */
export function montarEnvServidor({
  porta = PORTA,
  mingitDir,
  askpass,
  token,
  base = {},
} = {}) {
  const env = {
    ...base,
    MONTADOR_PORT: String(porta),
    MONTADOR_SEM_NAVEGADOR: '1',
    MONTADOR_NA_CASCA: '1',
  };

  if (mingitDir) {
    // MONTADOR_GIT aponta para o git.exe do MinGit embutido.
    env.MONTADOR_GIT = caminhoGitDoMinGit(mingitDir);
  }
  if (askpass) {
    env.GIT_ASKPASS = askpass;
  }
  if (token != null) {
    env.ESCALA_GIT_TOKEN = String(token);
  }

  // Desliga o gerenciador de credenciais do git só por variável de ambiente.
  env.GIT_CONFIG_COUNT = '1';
  env.GIT_CONFIG_KEY_0 = 'credential.helper';
  env.GIT_CONFIG_VALUE_0 = '';

  return env;
}

/**
 * Caminho do executável do git dentro do MinGit embutido.
 *
 * @param {string} mingitDir pasta raiz do MinGit (ex.: <resources>/mingit)
 * @returns {string}
 */
export function caminhoGitDoMinGit(mingitDir) {
  // Barra normal funciona no Windows e evita escapar separadores.
  return `${mingitDir.replace(/[\\/]+$/, '')}/cmd/git.exe`;
}

/**
 * Decide o que fazer quando o Servidor_Local encerra.
 *
 * O código 75 significa "código atualizado pelo pull, preciso reiniciar"
 * (RF 2.13 / 30.5). A Casca reinicia uma única vez; um segundo 75 encerra.
 * Qualquer outro código de saída encerra.
 *
 * @param {number} codigo código de saída do processo do servidor
 * @param {boolean} jaReiniciou se a Casca já reiniciou o servidor uma vez
 * @returns {'reiniciar' | 'encerrar'}
 */
export function decidirReinicio(codigo, jaReiniciou) {
  if (codigo === 75 && !jaReiniciou) return 'reiniciar';
  return 'encerrar';
}

/**
 * Espera `GET /api/saude` responder 200 no endereço do servidor.
 *
 * Tenta repetidamente até o servidor ficar pronto ou o tempo esgotar. Usado
 * pela Casca para abrir a janela só depois que o servidor está de pé (30.2).
 *
 * @param {{ porta?: number, timeoutMs?: number, intervaloMs?: number,
 *           fetch?: typeof globalThis.fetch, agora?: () => number,
 *           esperar?: (ms: number) => Promise<void> }} opcoes
 * @returns {Promise<boolean>} true quando ficou pronto; false no timeout
 */
export async function esperarSaude({
  porta = PORTA,
  timeoutMs = 30000,
  intervaloMs = 250,
  fetch = globalThis.fetch,
  agora = () => Date.now(),
  esperar = (ms) => new Promise((r) => setTimeout(r, ms)),
} = {}) {
  const url = `http://127.0.0.1:${porta}/api/saude`;
  const limite = agora() + timeoutMs;
  while (agora() < limite) {
    try {
      const resp = await fetch(url, { cache: 'no-store' });
      if (resp && resp.status === 200) return true;
    } catch {
      // servidor ainda não respondeu; tenta de novo
    }
    await esperar(intervaloMs);
  }
  return false;
}
