/**
 * mensagens-whatsapp.js
 *
 * Templates editáveis das mensagens de WhatsApp (tela de regras do editor).
 * O texto das mensagens sai do código e passa a morar em
 * processos/regras/mensagens-whatsapp.json, versionado no histórico de regras.
 *
 * MENSAGENS_PADRAO reproduz exatamente o conteúdo enviado em agosto/2026
 * (escalas/2026/08/links-whatsapp.md). Arquivo ausente ou inválido → padrão +
 * aviso, como em parametros.js.
 *
 * Esta lib é compartilhada por:
 *  - montador/lib/regras-catalogo.mjs (salvarMensagens: validação)
 *  - scripts/lib/links-whatsapp.js + montador/lib/whatsapp.mjs (Task 34)
 *  - scripts/publicacao/gerar-links-publicacao.js
 *
 * Feature: melhoras-domingao (F. Envio) — Property 12; Requisitos 26.1 a 26.8.
 */

import { readFileSync, existsSync } from 'node:fs';

/** Placeholders aceitos nos templates. */
export const PLACEHOLDERS = ['{nome}', '{mes/ano}', '{funções}', '{data}', '{grupo}'];

/** Conteúdo inicial = mensagens de agosto/2026 (escalas/2026/08/links-whatsapp.md). */
export const MENSAGENS_PADRAO = {
  versao: 1,
  templates: {
    pessoa:
      'Olá, {nome}! \n\nVocê está na escala de *{mes/ano}*, como {funções}.\n\n' +
      'Entre na escala e veja os detalhes:\nhttps://natanbudny.github.io/EscalaMusica/\n\n' +
      'Dê um joinha nessa mensagem para confirmar que poderá participar',
    grupo:
      'Olá, {nome}! \n\nSua família está na escala de *{mes/ano}*, como {funções}.\n\n' +
      'Entre na escala e veja os detalhes:\nhttps://natanbudny.github.io/EscalaMusica/\n\n' +
      'Dê um joinha nessa mensagem para confirmar que poderão participar',
    culto_inteiro:
      'Olá, {nome}! \n\nO Ministério Jovem está na escala de *{mes/ano}* no dia {data}, como {funções}.\n\n' +
      'Entre na escala e veja os detalhes:\nhttps://natanbudny.github.io/EscalaMusica/\n\n' +
      'Dê um joinha nessa mensagem para confirmar que poderão participar',
    fixo:
      'Olá, {nome}! \n\nA escala de *{mes/ano}* foi publicada.\n\n' +
      'Entre na escala e veja os detalhes:\nhttps://natanbudny.github.io/EscalaMusica/',
  },
  fixos: [
    { nome: 'ADELAIDE', rotulo: 'Líder da banda' },
    { nome: 'YASSER', rotulo: 'Ancião principal' },
  ],
  grupo_louvor: 'https://chat.whatsapp.com/EsfZwmrdWntG9wxqoSN5zw',
};

/** Templates obrigatórios que o arquivo precisa ter. */
const TEMPLATES_OBRIGATORIOS = ['pessoa', 'grupo', 'culto_inteiro', 'fixo'];

/** Cópia profunda simples dos padrões. */
function clonarPadrao() {
  return JSON.parse(JSON.stringify(MENSAGENS_PADRAO));
}

/**
 * Carrega as mensagens de um caminho. Arquivo ausente ou inválido → padrão +
 * aviso. Sempre devolve um objeto completo.
 *
 * @param {string} caminho
 * @returns {{ mensagens: object, avisos: string[] }}
 */
export function carregarMensagens(caminho) {
  if (!caminho || !existsSync(caminho)) {
    return {
      mensagens: clonarPadrao(),
      avisos: ['mensagens-whatsapp.json ausente — usando o conteúdo inicial.'],
    };
  }
  let obj;
  try {
    obj = JSON.parse(readFileSync(caminho, 'utf8'));
  } catch (e) {
    return {
      mensagens: clonarPadrao(),
      avisos: [`mensagens-whatsapp.json inválido (${e.message}) — usando o conteúdo inicial.`],
    };
  }
  const problemas = validarMensagens(obj);
  if (problemas.length > 0) {
    return {
      mensagens: clonarPadrao(),
      avisos: [`mensagens-whatsapp.json inválido — usando o conteúdo inicial. ${problemas.join('; ')}`],
    };
  }
  return { mensagens: obj, avisos: [] };
}

/** Placeholders usados num texto (na forma `{...}`). */
function placeholdersEm(texto) {
  const achados = String(texto || '').match(/\{[^}]*\}/g) || [];
  return achados;
}

/**
 * Valida a estrutura das mensagens.
 *  - cada template obrigatório presente e não vazio;
 *  - nenhum placeholder fora de PLACEHOLDERS;
 *  - cada contato fixo com nome;
 *  - link do grupo, quando presente, válido (https://chat.whatsapp.com/...).
 *
 * @param {object} obj
 * @returns {string[]} problemas (vazio = ok)
 */
export function validarMensagens(obj) {
  const problemas = [];
  if (!obj || typeof obj !== 'object') {
    problemas.push('mensagens deve ser um objeto.');
    return problemas;
  }
  const templates = obj.templates;
  if (!templates || typeof templates !== 'object') {
    problemas.push('mensagens.templates ausente ou inválido.');
  } else {
    for (const nome of TEMPLATES_OBRIGATORIOS) {
      const texto = templates[nome];
      if (typeof texto !== 'string' || texto.trim() === '') {
        problemas.push(`template "${nome}" vazio ou ausente.`);
        continue;
      }
      for (const ph of placeholdersEm(texto)) {
        if (!PLACEHOLDERS.includes(ph)) {
          problemas.push(`template "${nome}": placeholder desconhecido ${ph}.`);
        }
      }
    }
  }
  if (obj.fixos != null) {
    if (!Array.isArray(obj.fixos)) {
      problemas.push('mensagens.fixos deve ser uma lista.');
    } else {
      obj.fixos.forEach((f, i) => {
        if (!f || typeof f.nome !== 'string' || f.nome.trim() === '') {
          problemas.push(`contato fixo #${i + 1} sem nome.`);
        }
      });
    }
  }
  if (obj.grupo_louvor != null && obj.grupo_louvor !== '') {
    if (
      typeof obj.grupo_louvor !== 'string' ||
      !/^https:\/\/chat\.whatsapp\.com\//.test(obj.grupo_louvor)
    ) {
      problemas.push('grupo_louvor deve ser um link https://chat.whatsapp.com/...');
    }
  }
  return problemas;
}

/** "DANY KALLAS" → "Dany Kallas"; preserva separadores (espaço, hífen). */
function formatoTitulo(nome) {
  return String(nome || '')
    .toLocaleLowerCase('pt-BR')
    .replace(/(^|[\s\-/])([\p{L}])/gu, (_, sep, letra) => sep + letra.toLocaleUpperCase('pt-BR'));
}

/** ["REGENTE LOUVOR", "EQUIPE LOUVOR"] → "*REGENTE LOUVOR* e *EQUIPE LOUVOR*". */
function listaComAsterisco(itens) {
  const arr = (itens || []).map((x) => `*${x}*`);
  return juntarComE(arr);
}

/** ["23/08", "30/08"] → "23/08 e 30/08"; três ou mais usam vírgula + " e ". */
function juntarComE(arr) {
  if (arr.length === 0) return '';
  if (arr.length === 1) return arr[0];
  return `${arr.slice(0, -1).join(', ')} e ${arr[arr.length - 1]}`;
}

/**
 * Preenche um template com os valores da mensagem.
 *
 * @param {string} template
 * @param {{ nome?: string, mesAno?: string, funcoes?: string|string[],
 *           datas?: string|string[], grupo?: string }} valores
 * @returns {string}
 */
export function preencherMensagem(template, { nome, mesAno, funcoes, datas, grupo } = {}) {
  let texto = String(template || '');

  if (nome != null) texto = texto.replaceAll('{nome}', formatoTitulo(nome));
  if (mesAno != null) texto = texto.replaceAll('{mes/ano}', mesAno);
  if (grupo != null) texto = texto.replaceAll('{grupo}', grupo);

  if (funcoes != null) {
    const fnText = Array.isArray(funcoes) ? listaComAsterisco(funcoes) : String(funcoes);
    texto = texto.replaceAll('{funções}', fnText);
  }

  if (datas != null) {
    const dtText = Array.isArray(datas) ? juntarComE(datas) : String(datas);
    texto = texto.replaceAll('{data}', dtText);
  }

  return texto;
}
