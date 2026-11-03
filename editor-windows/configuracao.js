// Lógica da tela de configuração (primeira execução).
//
// Usa só a API segura exposta pelo preload (window.configuracao). Mostra o
// andamento (validando/clonando), as mensagens de erro e o botão "tentar de
// novo" em caso de falha.
//
// Feature: melhoras-domingao (G. Instalador) — Requisitos 31.1, 31.3, 31.8.

const api = window.configuracao || {};

const campoToken = document.getElementById('token');
const botaoEnviar = document.getElementById('enviar');
const botaoTentar = document.getElementById('tentar');
const estado = document.getElementById('estado');

/** Textos amigáveis por código de motivo/estado vindos do main. */
const MENSAGENS = {
  validando: ['progresso', 'Validando o token com o GitHub...'],
  clonando: ['progresso', 'Baixando o repositório da escala...'],
  configurando: ['progresso', 'Ajustando a identidade do git...'],
  pronto: ['ok', 'Tudo certo! Abrindo o editor...'],
  token_invalido: ['erro', 'Token inválido ou sem acesso ao repositório.'],
  sem_push: ['erro', 'Este token não tem permissão para publicar no repositório.'],
  erro_rede: ['erro', 'Não foi possível falar com o GitHub. Verifique a internet.'],
  erro_clone: ['erro', 'O download do repositório falhou. Tente de novo.'],
};

function mostrarEstado(codigo, textoExtra) {
  const [classe, texto] = MENSAGENS[codigo] || ['erro', textoExtra || 'Ocorreu um erro.'];
  estado.className = `estado ${classe}`;
  estado.textContent = textoExtra ? `${texto} ${textoExtra}` : texto;

  const emProgresso = classe === 'progresso';
  const falhou = classe === 'erro';
  botaoEnviar.disabled = emProgresso;
  botaoTentar.classList.toggle('oculto', !falhou);
}

function enviar() {
  const token = campoToken.value.trim();
  if (!token) {
    mostrarEstado('token_invalido');
    return;
  }
  mostrarEstado('validando');
  if (typeof api.enviarToken === 'function') {
    Promise.resolve(api.enviarToken(token)).catch(() =>
      mostrarEstado('erro_rede')
    );
  }
}

botaoEnviar.addEventListener('click', enviar);
botaoTentar.addEventListener('click', () => {
  estado.textContent = '';
  estado.className = 'estado';
  botaoTentar.classList.add('oculto');
  campoToken.focus();
});
campoToken.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter') enviar();
});

// O main empurra os estados do processo (validando, clonando, erro, pronto).
if (typeof api.aoAtualizar === 'function') {
  api.aoAtualizar((atualizacao) => {
    if (typeof atualizacao === 'string') {
      mostrarEstado(atualizacao);
    } else if (atualizacao && typeof atualizacao === 'object') {
      mostrarEstado(atualizacao.codigo, atualizacao.detalhe);
    }
  });
}
