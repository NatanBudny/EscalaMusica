// Catálogo de regras e versionamento de texto (tela de regras do editor).
//
// Lê as entradas dos cinco arquivos canônicos de processos/regras/, expõe o
// histórico de versões (somente por acréscimo), edita o texto de uma regra
// (gravando antes o texto original como versão 1) e reverte para uma versão.
//
// Também guarda parametros.json e mensagens-whatsapp.json versionados no mesmo
// historico-versoes.json (alvo 'parametros' / 'mensagens-whatsapp').
//
// Toda gravação devolve a lista de arquivos tocados (pathspec do commit
// seletivo); o commit/push fica a cargo da rota, como no restante do montador.
//
// Feature: melhoras-domingao (C. Regras) — Property 12; Requisitos 9.1 a 9.7, 10.6, 21.4.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT } from './regras.mjs';
import { validarCatalogo as validarCatalogoLib } from '../../scripts/lib/validar-catalogo.js';
import { validarParametros } from '../../scripts/lib/parametros.js';
import { validarMensagens } from '../../scripts/lib/mensagens-whatsapp.js';

const REL = {
  fundamentais: 'processos/regras/fundamentais.json',
  preferencias: 'processos/regras/preferencias.json',
  restricoes_pessoais: 'processos/regras/restricoes-pessoais.json',
  papeis: 'processos/regras/papeis.json',
  glossario: 'processos/regras/glossario.json',
  historico: 'processos/regras/historico-versoes.json',
  parametros: 'processos/regras/parametros.json',
  mensagens: 'processos/regras/mensagens-whatsapp.json',
};

/** Campos de texto editáveis de uma regra (string, exceto `id`). */
const CAMPOS_TEXTO = ['descricao', 'detalhe', 'excecao', 'nota'];

function caminho(root, chave) {
  return resolve(root, REL[chave]);
}

function lerJSON(caminho, fallback) {
  if (!existsSync(caminho)) return fallback;
  try {
    return JSON.parse(readFileSync(caminho, 'utf8'));
  } catch {
    return fallback;
  }
}

function gravarJSON(caminho, dado) {
  writeFileSync(caminho, `${JSON.stringify(dado, null, 2)}\n`, 'utf8');
}

/** Extrai os campos de texto string de uma regra (objeto). */
function textosDaRegra(regra) {
  const textos = {};
  for (const campo of CAMPOS_TEXTO) {
    if (typeof regra[campo] === 'string') textos[campo] = regra[campo];
  }
  return textos;
}

/** Monta as entradas do catálogo a partir dos cinco arquivos canônicos. */
export function listarCatalogo({ root = ROOT } = {}) {
  const entradas = [];

  // 1) fundamentais.json (array)
  const fundamentais = lerJSON(caminho(root, 'fundamentais'), []);
  for (const regra of Array.isArray(fundamentais) ? fundamentais : []) {
    entradas.push({
      id: regra.id,
      categoria: 'fundamentais',
      arquivo: REL.fundamentais,
      textos: textosDaRegra(regra),
      extras: extrasDaRegra(regra),
      parametros: [],
    });
  }

  // 2) preferencias.json (array)
  const preferencias = lerJSON(caminho(root, 'preferencias'), []);
  for (const regra of Array.isArray(preferencias) ? preferencias : []) {
    entradas.push({
      id: regra.id,
      categoria: 'preferencias',
      arquivo: REL.preferencias,
      textos: textosDaRegra(regra),
      extras: extrasDaRegra(regra),
      parametros: [],
    });
  }

  // 3) restricoes-pessoais.json (objeto nome → array)
  const restricoes = lerJSON(caminho(root, 'restricoes_pessoais'), {});
  for (const [nome, arr] of Object.entries(restricoes)) {
    const lista = Array.isArray(arr) ? arr : [arr];
    for (const regra of lista) {
      entradas.push({
        id: regra.id,
        categoria: 'restricoes_pessoais',
        arquivo: REL.restricoes_pessoais,
        pessoa: nome,
        textos: textosDaRegra(regra),
        extras: extrasDaRegra(regra),
        parametros: [],
      });
    }
  }

  // 4) papeis.json (objeto, id = nome do papel)
  const papeis = lerJSON(caminho(root, 'papeis'), {});
  for (const [papel, def] of Object.entries(papeis)) {
    entradas.push({
      id: papel,
      categoria: 'papeis',
      arquivo: REL.papeis,
      textos: typeof def.descricao === 'string' ? { descricao: def.descricao } : {},
      extras: {},
      parametros: [],
    });
  }

  // 5) glossario.json (objeto, id = termo, texto = valor)
  const glossario = lerJSON(caminho(root, 'glossario'), {});
  for (const [termo, valor] of Object.entries(glossario)) {
    entradas.push({
      id: termo,
      categoria: 'glossario',
      arquivo: REL.glossario,
      textos: typeof valor === 'string' ? { valor } : {},
      extras: typeof valor === 'string' ? {} : { valor },
      parametros: [],
    });
  }

  // Associa os parâmetros que referenciam cada regra (via refs).
  anotarParametros(entradas, root);

  return entradas;
}

/** Campos não-texto da regra que a tela pode exibir como contexto. */
function extrasDaRegra(regra) {
  const extras = {};
  for (const [k, v] of Object.entries(regra)) {
    if (k === 'id' || CAMPOS_TEXTO.includes(k)) continue;
    extras[k] = v;
  }
  return extras;
}

/** Preenche `parametros` de cada entrada com as chaves de parametros.json que a referenciam. */
function anotarParametros(entradas, root) {
  const params = lerJSON(caminho(root, 'parametros'), null);
  if (!params || !params.regras) return;
  const porRef = new Map(); // ref (RFxxx/PExxx) → [chaveParametro]
  for (const [chave, def] of Object.entries(params.regras)) {
    for (const ref of def.refs || []) {
      if (!porRef.has(ref)) porRef.set(ref, []);
      porRef.get(ref).push(chave);
    }
  }
  for (const entrada of entradas) {
    const chaves = porRef.get(entrada.id);
    if (chaves) entrada.parametros = [...chaves];
  }
}

/** Localiza uma regra num arquivo canônico. Devolve { arquivoRel, dado, regra, categoria } ou null. */
function localizarRegra(root, id) {
  // fundamentais / preferencias (arrays)
  for (const categoria of ['fundamentais', 'preferencias']) {
    const dado = lerJSON(caminho(root, categoria), []);
    const regra = (Array.isArray(dado) ? dado : []).find((r) => r.id === id);
    if (regra) return { categoria, arquivoRel: REL[categoria], dado, regra };
  }
  // restricoes-pessoais (objeto nome → array)
  const restricoes = lerJSON(caminho(root, 'restricoes_pessoais'), {});
  for (const arr of Object.values(restricoes)) {
    const lista = Array.isArray(arr) ? arr : [arr];
    const regra = lista.find((r) => r.id === id);
    if (regra) {
      return { categoria: 'restricoes_pessoais', arquivoRel: REL.restricoes_pessoais, dado: restricoes, regra };
    }
  }
  // papeis (objeto id = nome)
  const papeis = lerJSON(caminho(root, 'papeis'), {});
  if (papeis[id]) {
    return { categoria: 'papeis', arquivoRel: REL.papeis, dado: papeis, regra: papeis[id] };
  }
  // glossario (objeto termo = valor): embrulha num objeto { valor }
  const glossario = lerJSON(caminho(root, 'glossario'), {});
  if (Object.prototype.hasOwnProperty.call(glossario, id)) {
    return { categoria: 'glossario', arquivoRel: REL.glossario, dado: glossario, regra: null };
  }
  return null;
}

/** Textos vigentes de uma regra (para gravar a versão 1 original). */
function textosVigentes(root, id) {
  const loc = localizarRegra(root, id);
  if (!loc) return null;
  if (loc.categoria === 'glossario') {
    const valor = loc.dado[id];
    return typeof valor === 'string' ? { valor } : {};
  }
  if (loc.categoria === 'papeis') {
    return typeof loc.regra.descricao === 'string' ? { descricao: loc.regra.descricao } : {};
  }
  return textosDaRegra(loc.regra);
}

/** Lê o histórico de versões (objeto { versoes: [...] }). */
function lerHistorico(root) {
  return lerJSON(caminho(root, 'historico'), { versoes: [] });
}

/** Versões de um alvo específico, em ordem de número. */
export function historico(id, { root = ROOT } = {}) {
  const hist = lerHistorico(root);
  return (hist.versoes || [])
    .filter((v) => v.alvo === id)
    .sort((a, b) => a.numero - b.numero);
}

/** Próximo número de versão para um alvo. */
function proximoNumero(versoes, alvo) {
  const n = versoes.filter((v) => v.alvo === alvo).map((v) => v.numero);
  return n.length ? Math.max(...n) + 1 : 1;
}

/** Grava a nova lista de versões no histórico, sempre por acréscimo. */
function gravarHistorico(root, versoes) {
  gravarJSON(caminho(root, 'historico'), { versoes });
}

/**
 * Edita o texto de uma regra. Quando a regra ainda não tem histórico, grava
 * antes o texto original como versão 1 (origem 'original') e depois a edição.
 *
 * @param {string} id
 * @param {Record<string,string>} textos novos textos (campos string)
 * @param {{ autor?: string, root?: string, agora?: Date }} opts
 * @returns {{ versao: number, arquivos: string[] }}
 */
export function editarTexto(id, textos, { autor = 'editor de escala', root = ROOT, agora = new Date() } = {}) {
  const loc = localizarRegra(root, id);
  if (!loc) throw new Error(`Regra "${id}" não encontrada no catálogo.`);

  const hist = lerHistorico(root);
  const versoes = [...(hist.versoes || [])];
  const temHistorico = versoes.some((v) => v.alvo === id);

  // Primeira edição: grava o texto original como versão 1.
  if (!temHistorico) {
    versoes.push({
      alvo: id,
      tipo: 'texto',
      numero: proximoNumero(versoes, id),
      origem: 'original',
      textos: textosVigentes(root, id) || {},
      autor,
      criado_em: agora.toISOString(),
    });
  }

  // Versão da edição.
  const numero = proximoNumero(versoes, id);
  versoes.push({
    alvo: id,
    tipo: 'texto',
    numero,
    origem: 'edicao',
    textos: { ...textos },
    autor,
    criado_em: agora.toISOString(),
  });

  // Aplica os textos no arquivo de origem.
  aplicarTextos(root, loc, id, textos);
  gravarHistorico(root, versoes);

  return { versao: numero, arquivos: [loc.arquivoRel, REL.historico] };
}

/** Escreve os textos no arquivo canônico de origem. */
function aplicarTextos(root, loc, id, textos) {
  if (loc.categoria === 'glossario') {
    const dado = loc.dado;
    if (typeof textos.valor === 'string') dado[id] = textos.valor;
    gravarJSON(caminho(root, 'glossario'), dado);
    return;
  }
  if (loc.categoria === 'papeis') {
    const dado = loc.dado;
    if (typeof textos.descricao === 'string') dado[id].descricao = textos.descricao;
    gravarJSON(caminho(root, 'papeis'), dado);
    return;
  }
  // Arrays (fundamentais/preferencias) e restricoes (objeto): localizarRegra já
  // devolveu a referência viva `loc.regra` dentro de `loc.dado`.
  for (const campo of CAMPOS_TEXTO) {
    if (typeof textos[campo] === 'string') loc.regra[campo] = textos[campo];
  }
  gravarJSON(caminho(root, loc.categoria), loc.dado);
}

/**
 * Reverte uma regra para o texto de uma versão anterior, gravando uma nova
 * versão (origem 'reversao', com `reverte` apontando para o número escolhido).
 *
 * @param {string} id
 * @param {number} numero número da versão a restaurar
 * @param {{ autor?: string, root?: string, agora?: Date }} opts
 * @returns {{ versao: number, arquivos: string[] }}
 */
export function reverter(id, numero, { autor = 'editor de escala', root = ROOT, agora = new Date() } = {}) {
  const loc = localizarRegra(root, id);
  if (!loc) throw new Error(`Regra "${id}" não encontrada no catálogo.`);

  const hist = lerHistorico(root);
  const versoes = [...(hist.versoes || [])];
  const alvo = versoes.find((v) => v.alvo === id && v.numero === numero);
  if (!alvo) throw new Error(`Versão ${numero} de "${id}" não existe.`);

  const novoNumero = proximoNumero(versoes, id);
  versoes.push({
    alvo: id,
    tipo: 'texto',
    numero: novoNumero,
    origem: 'reversao',
    reverte: numero,
    textos: { ...alvo.textos },
    autor,
    criado_em: agora.toISOString(),
  });

  aplicarTextos(root, loc, id, alvo.textos);
  gravarHistorico(root, versoes);

  return { versao: novoNumero, arquivos: [loc.arquivoRel, REL.historico] };
}

/**
 * Salva parametros.json com nova versão no histórico (alvo 'parametros').
 * Recusa se validarParametros devolver erros.
 *
 * @param {object} novo
 * @param {{ autor?: string, root?: string, agora?: Date }} opts
 * @returns {{ versao: number, arquivos: string[] }}
 */
export function salvarParametros(novo, { autor = 'editor de escala', root = ROOT, agora = new Date() } = {}) {
  const problemas = validarParametros(novo);
  if (problemas.length > 0) {
    const erro = new Error(`parametros.json inválido: ${problemas.join('; ')}`);
    erro.problemas = problemas;
    throw erro;
  }

  const hist = lerHistorico(root);
  const versoes = [...(hist.versoes || [])];
  const numero = proximoNumero(versoes, 'parametros');
  versoes.push({
    alvo: 'parametros',
    tipo: 'parametros',
    numero,
    origem: 'edicao',
    conteudo: novo,
    autor,
    criado_em: agora.toISOString(),
  });

  gravarJSON(caminho(root, 'parametros'), novo);
  gravarHistorico(root, versoes);

  return { versao: numero, arquivos: [REL.parametros, REL.historico] };
}

/**
 * Salva mensagens-whatsapp.json com nova versão (alvo 'mensagens-whatsapp').
 * Recusa se validarMensagens devolver erros (validador substituível por teste).
 *
 * @param {object} novo
 * @param {{ autor?: string, root?: string, agora?: Date, validar?: (obj)=>string[] }} opts
 * @returns {{ versao: number, arquivos: string[] }}
 */
export function salvarMensagens(
  novo,
  { autor = 'editor de escala', root = ROOT, agora = new Date(), validar = validarMensagens } = {},
) {
  if (typeof validar === 'function') {
    const problemas = validar(novo);
    if (problemas.length > 0) {
      const erro = new Error(`mensagens-whatsapp.json inválido: ${problemas.join('; ')}`);
      erro.problemas = problemas;
      throw erro;
    }
  }

  const hist = lerHistorico(root);
  const versoes = [...(hist.versoes || [])];
  const numero = proximoNumero(versoes, 'mensagens-whatsapp');
  versoes.push({
    alvo: 'mensagens-whatsapp',
    tipo: 'mensagens',
    numero,
    origem: 'edicao',
    conteudo: novo,
    autor,
    criado_em: agora.toISOString(),
  });

  gravarJSON(caminho(root, 'mensagens'), novo);
  gravarHistorico(root, versoes);

  return { versao: numero, arquivos: [REL.mensagens, REL.historico] };
}

/**
 * Reverte mensagens-whatsapp.json para o conteúdo de uma versão anterior,
 * gravando uma nova versão (origem 'reversao', com `reverte`).
 *
 * @param {number} numero número da versão a restaurar
 * @param {{ autor?: string, root?: string, agora?: Date }} opts
 * @returns {{ versao: number, arquivos: string[] }}
 */
export function reverterMensagens(numero, { autor = 'editor de escala', root = ROOT, agora = new Date() } = {}) {
  const hist = lerHistorico(root);
  const versoes = [...(hist.versoes || [])];
  const alvo = versoes.find((v) => v.alvo === 'mensagens-whatsapp' && v.numero === numero);
  if (!alvo) throw new Error(`Versão ${numero} de mensagens-whatsapp não existe.`);

  const conteudo = JSON.parse(JSON.stringify(alvo.conteudo));
  const novoNumero = proximoNumero(versoes, 'mensagens-whatsapp');
  versoes.push({
    alvo: 'mensagens-whatsapp',
    tipo: 'mensagens',
    numero: novoNumero,
    origem: 'reversao',
    reverte: numero,
    conteudo,
    autor,
    criado_em: agora.toISOString(),
  });

  gravarJSON(caminho(root, 'mensagens'), conteudo);
  gravarHistorico(root, versoes);

  return { versao: novoNumero, arquivos: [REL.mensagens, REL.historico] };
}

/** Validação do catálogo (reusa scripts/lib/validar-catalogo.js). */
export function validarCatalogo({ root = ROOT } = {}) {
  const { erros, avisos } = validarCatalogoLib(root);
  return { erros, avisos };
}

export { REL as ARQUIVOS_REGRAS, CAMPOS_TEXTO };
