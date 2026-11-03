// Verificação automática do site (Task 32).
//
// Depois do Fechamento, o editor confirma sozinho que a Escala_Online já
// publicou o que foi enviado: busca `atual.json` e `contatos.json` no GitHub
// Pages (com cache-busting e `no-store`) e, quando os dois coincidem com os
// arquivos locais, roda a Conferencia_de_Links (Task 30) sobre o conteúdo
// REMOTO para garantir que cada nome publicado abre o WhatsApp certo.
//
// Estados (Requisito 24):
//  - `pendente_envio`: ainda há Envio_Pendente do Fechamento (não consulta o
//    site; a UI mostra "tentar de novo") (24.5);
//  - `aguardando`: algum dos dois arquivos remotos ainda difere do local
//    (o Pages não atualizou) (24.1, 24.2);
//  - `publicado`: os dois coincidem e a conferência remota não tem erro;
//    devolve a `tabela` "nome na escala → número que o link abre" dos
//    participantes de REGENTE LOUVOR, EQUIPE LOUVOR e MENSAGEM MUSICAL (24.3,
//    24.7);
//  - `erro_conferencia`: os dois coincidem, mas a conferência remota tem erro;
//    devolve `erros` e mantém o botão desabilitado (24.8);
//  - `erro_rede`: a consulta ao site falhou (o editor pode tentar de novo).
//
// A liberação da etapa seguinte é só pela coincidência do conteúdo, sem espera
// fixa de tempo (24.6); a UI é que repete a chamada a cada 15 s por até 10 min
// e depois oferece "continuar verificando" (24.1, 24.4).
//
// Feature: melhoras-domingao (F. Envio) — Task 32; Property 33;
// Requisitos 24.1-24.8.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { ROOT, carregarContexto } from './regras.mjs';
import { conferirLinks } from './conferencia.mjs';

/** Endereços do GitHub Pages lidos pela verificação. */
export const URL_BASE = 'https://natanbudny.github.io/EscalaMusica/';
export const URL_ATUAL = `${URL_BASE}atual.json`;
export const URL_CONTATOS = `${URL_BASE}contatos.json`;

/** Campos de louvor exibidos na tabela "nome → número que o link abre". */
const CAMPOS_TABELA = new Set(['REGENTE LOUVOR', 'EQUIPE LOUVOR', 'MENSAGEM MUSICAL']);

/** Igualdade estrutural profunda (independente da ordem das chaves). */
function iguaisProfundo(a, b) {
  if (a === b) return true;
  if (a === null || b === null) return a === b;
  if (typeof a !== 'object' || typeof b !== 'object') return a === b;

  const aArray = Array.isArray(a);
  const bArray = Array.isArray(b);
  if (aArray !== bArray) return false;

  if (aArray) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (!iguaisProfundo(a[i], b[i])) return false;
    }
    return true;
  }

  const chavesA = Object.keys(a);
  const chavesB = Object.keys(b);
  if (chavesA.length !== chavesB.length) return false;
  for (const chave of chavesA) {
    if (!Object.prototype.hasOwnProperty.call(b, chave)) return false;
    if (!iguaisProfundo(a[chave], b[chave])) return false;
  }
  return true;
}

/**
 * Dois textos coincidem quando ambos são JSON válido e estruturalmente iguais.
 * JSON inválido em qualquer um dos lados → false.
 *
 * @param {string} textoRemoto
 * @param {string} textoLocal
 * @returns {boolean}
 */
export function conteudoCoincide(textoRemoto, textoLocal) {
  let remoto;
  let local;
  try {
    remoto = JSON.parse(textoRemoto);
    local = JSON.parse(textoLocal);
  } catch {
    return false;
  }
  return iguaisProfundo(remoto, local);
}

/** Lê um arquivo local como texto, ou null quando ausente/ilegível. */
function lerTextoLocal(root, nome) {
  const caminho = resolve(root, nome);
  if (!existsSync(caminho)) return null;
  try {
    return readFileSync(caminho, 'utf8');
  } catch {
    return null;
  }
}

/** Busca uma URL com cache-busting e sem cache; devolve o texto ou null. */
async function buscarTexto(fetchFn, url, carimbo) {
  const alvo = `${url}?t=${carimbo}`;
  const resposta = await fetchFn(alvo, { cache: 'no-store' });
  if (!resposta || !resposta.ok) return null;
  return resposta.text();
}

/** Mês ("AAAA-MM") da primeira linha de um atual.json remoto, ou null. */
function mesDoAtual(linhas) {
  for (const linha of Array.isArray(linhas) ? linhas : []) {
    const m = String((linha && linha.DATA) || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (m) return `${m[3]}-${m[2]}`;
  }
  return null;
}

/**
 * Tabela "nome na escala → número que o link abre" só dos participantes de
 * REGENTE LOUVOR, EQUIPE LOUVOR e MENSAGEM MUSICAL (24.7). Reaproveita a tabela
 * de `conferirLinks`, que já cobre os campos de louvor.
 */
function tabelaLouvor(tabela) {
  return (Array.isArray(tabela) ? tabela : []).filter((item) => CAMPOS_TABELA.has(item.campo));
}

/**
 * Confere o estado da publicação no site.
 *
 * @param {{ root?: string, git: object, fetch?: typeof fetch, agora?: () => number }} opcoes
 * @returns {Promise<{ estado: string, url: string, tabela?: object[], erros?: object[], mensagem?: string }>}
 */
export async function conferirSite({
  root = ROOT,
  git,
  fetch: fetchFn = globalThis.fetch,
  agora = Date.now,
} = {}) {
  // 1. Envio pendente: não adianta consultar o site antes de o push concluir.
  const status = git && typeof git.status === 'function' ? await git.status() : { pendentes: 0 };
  if (status && Number(status.pendentes) > 0) {
    return { estado: 'pendente_envio', url: URL_BASE };
  }

  // 2. Arquivos locais enviados.
  const atualLocal = lerTextoLocal(root, 'atual.json');
  const contatosLocal = lerTextoLocal(root, 'contatos.json');
  if (atualLocal == null || contatosLocal == null) {
    return { estado: 'aguardando', url: URL_BASE };
  }

  // 3. Busca os remotos com cache-busting e no-store.
  let atualRemoto;
  let contatosRemoto;
  try {
    const carimbo = agora();
    atualRemoto = await buscarTexto(fetchFn, URL_ATUAL, carimbo);
    contatosRemoto = await buscarTexto(fetchFn, URL_CONTATOS, carimbo);
  } catch (err) {
    return { estado: 'erro_rede', url: URL_BASE, mensagem: err.message };
  }
  if (atualRemoto == null || contatosRemoto == null) {
    return { estado: 'erro_rede', url: URL_BASE };
  }

  // 4. Os dois precisam coincidir com os arquivos enviados.
  if (
    !conteudoCoincide(atualRemoto, atualLocal) ||
    !conteudoCoincide(contatosRemoto, contatosLocal)
  ) {
    return { estado: 'aguardando', url: URL_BASE };
  }

  // 5. Conferência de links sobre o conteúdo REMOTO.
  let linhasRemotas;
  let contatosRemotos;
  try {
    linhasRemotas = JSON.parse(atualRemoto);
    contatosRemotos = JSON.parse(contatosRemoto);
  } catch {
    return { estado: 'aguardando', url: URL_BASE };
  }

  // A conferência usa só o cadastro e os grupos do contexto (independentes do
  // mês); quando o atual.json remoto não traz data válida, usa um mês neutro só
  // para montar o contexto sem quebrar.
  const mes = mesDoAtual(linhasRemotas) || '2000-01';
  const base = carregarContexto(mes, { root });
  const { erros, tabela } = conferirLinks(
    Array.isArray(linhasRemotas) ? linhasRemotas : [],
    contatosRemotos,
    base,
  );

  if (erros.length > 0) {
    return { estado: 'erro_conferencia', url: URL_BASE, erros };
  }
  return { estado: 'publicado', url: URL_BASE, tabela: tabelaLouvor(tabela) };
}
