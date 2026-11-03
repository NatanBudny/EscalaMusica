// Grupos escaláveis do cadastro (família, ministério), gravando em pessoas.json
// e regenerando contatos.json.
//
// Um Grupo_Escalavel é escalado como uma unidade: tem nome_exibicao (nome
// publicado), responsavel_id, membros_ids, modo ('funcao' ou 'culto_inteiro')
// e funcoes permitidas. A entrada do grupo no contatos.json usa o telefone do
// responsável.
//
// Feature: melhoras-domingao (B. Cadastro) — Task 8; Requisitos 6.1 a 6.7.

import { lerArquivo, gravarValidado } from './pessoas.mjs';
import { ROOT } from './regras.mjs';

/** Aplica os padrões de um Grupo_Escalavel (modo, funcoes). */
function comPadroes(chave, def) {
  return {
    chave,
    nome_exibicao: def.nome_exibicao,
    membros_ids: Array.isArray(def.membros_ids) ? def.membros_ids : [],
    responsavel_id: def.responsavel_id,
    modo: def.modo == null ? 'funcao' : def.modo,
    funcoes: Array.isArray(def.funcoes) ? def.funcoes : ['mm'],
    mensagem: def.mensagem == null ? null : def.mensagem,
  };
}

/**
 * Mapa de Grupos_Escalaveis (escalavel: true) com os padrões aplicados.
 *
 * @param {object} arquivo - pessoas.json carregado
 * @returns {Map<string, object>} chave → GrupoEscalavel
 */
export function gruposEscalaveis(arquivo) {
  const mapa = new Map();
  for (const [chave, def] of Object.entries((arquivo && arquivo.grupos) || {})) {
    if (def && def.escalavel === true) mapa.set(chave, comPadroes(chave, def));
  }
  return mapa;
}

/** Ocupante no formato usado em CultoMontagem e Rascunho. */
export function ocupanteDeGrupo(chave) {
  return `grupo:${chave}`;
}

/**
 * Cria ou atualiza um Grupo_Escalavel (por chave), gravando pessoas.json e
 * contatos.json. A validação (carregarPessoas) recusa grupos inválidos.
 *
 * @param {string} chave
 * @param {object} dados - { nome_exibicao, membros_ids, responsavel_id, modo, funcoes, mensagem }
 * @param {{ root?: string }} [opts]
 * @returns {{ grupo: object, arquivos: string[] }}
 */
export function salvarGrupo(chave, dados, { root = ROOT } = {}) {
  const arquivo = lerArquivo(root);
  arquivo.grupos = arquivo.grupos || {};

  const anterior = arquivo.grupos[chave] || {};
  const grupo = {
    // Preserva campos desconhecidos do grupo anterior (ex.: outros metadados).
    ...anterior,
    escalavel: true,
    nome_exibicao: dados.nome_exibicao,
    membros_ids: Array.isArray(dados.membros_ids) ? dados.membros_ids : [],
    responsavel_id: dados.responsavel_id,
    modo: dados.modo == null ? 'funcao' : dados.modo,
    funcoes: Array.isArray(dados.funcoes) ? dados.funcoes : ['mm'],
    mensagem: dados.mensagem == null || dados.mensagem === '' ? null : dados.mensagem,
  };
  arquivo.grupos[chave] = grupo;

  const { arquivos } = gravarValidado(arquivo, root);
  return { grupo, arquivos };
}

/**
 * Remove um grupo (por chave), gravando pessoas.json e contatos.json. O
 * validador recusa a remoção de grupo referenciado por familia_requerida.
 *
 * @param {string} chave
 * @param {{ root?: string }} [opts]
 * @returns {{ arquivos: string[] }}
 */
export function removerGrupo(chave, { root = ROOT } = {}) {
  const arquivo = lerArquivo(root);
  arquivo.grupos = arquivo.grupos || {};
  if (!arquivo.grupos[chave]) {
    throw new Error(`Grupo "${chave}" não encontrado.`);
  }
  delete arquivo.grupos[chave];
  const { arquivos } = gravarValidado(arquivo, root);
  return { arquivos };
}
