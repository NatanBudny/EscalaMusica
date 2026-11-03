// Leitura, validação e gravação dos insumos do mês: Acionato (Task 15) e
// Sonoplastia (Task 16).
//
// Acionato: formato de processos/templates/insumo-acionato.json acrescido de
// `modelo_louvor` e `extraordinario` por item.
// Sonoplastia: formato de processos/templates/insumo-sonoplastia.json com
// `sonoplastia: [sonoplasta, suporte]` e `ids` (null = texto fora do cadastro).
//
// Toda gravação devolve a lista de caminhos tocados (pathspec do commit).
//
// Feature: melhoras-domingao (D. Mês e insumos) — Tasks 15 e 16;
// Requisitos 12.x e 13.x.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { ROOT } from './regras.mjs';
import { modeloPorDiaSemana } from './contexto.mjs';
import { carregarPessoas } from '../../scripts/lib/cadastro.js';
import { problemasNome } from '../../scripts/lib/texto-publico.js';

const MODELOS_VALIDOS = new Set(['sabado', 'domingo', 'sem_louvor']);

function insumoPath(root, mes, nome) {
  const [ano, mm] = mes.split('-');
  return resolve(root, `escalas/${ano}/${mm}/insumos/${nome}`);
}

function lerJSON(caminho) {
  if (!existsSync(caminho)) return null;
  try {
    return JSON.parse(readFileSync(caminho, 'utf8'));
  } catch {
    return null;
  }
}

function gravarJSON(caminho, dados) {
  mkdirSync(dirname(caminho), { recursive: true });
  writeFileSync(caminho, `${JSON.stringify(dados, null, 2)}\n`, 'utf8');
}

function caminhoRelativo(root, caminho) {
  return caminho.slice(root.length + 1).replace(/\\/g, '/');
}

// ---------------------------------------------------------------------------
// Acionato (Task 15)
// ---------------------------------------------------------------------------

/**
 * Lê o Acionato do mês, normalizando cada item com `modelo_louvor` (padrão pelo
 * dia) e `extraordinario` (padrão false). Devolve { mes, itens } ou null.
 *
 * @param {string} mes - 'AAAA-MM'
 * @param {{ root?: string }} [opts]
 */
export function lerAcionato(mes, { root = ROOT } = {}) {
  const dados = lerJSON(insumoPath(root, mes, 'acionato.json'));
  if (!dados) return null;
  const itens = Array.isArray(dados) ? dados : dados.itens || [];
  const normalizados = itens.map((item) => ({
    data: item.data,
    dia: item.dia || '',
    anciao: item.anciao || item['ANCIÃO'] || '',
    pregador: item.pregador || item.PREGADOR || '',
    observacoes: item.observacoes || '',
    modelo_louvor:
      item.modelo_louvor && MODELOS_VALIDOS.has(item.modelo_louvor)
        ? item.modelo_louvor
        : modeloPorDiaSemana(item.dia),
    extraordinario: item.extraordinario === true,
  }));
  return {
    mes: dados.mes || mes,
    fonte: dados.fonte || 'Escala oficial do acionato',
    atualizado_em: dados.atualizado_em || '',
    itens: normalizados,
  };
}

/**
 * Valida um Acionato para o mês: datas dentro do mês, datas únicas e
 * modelo_louvor válido.
 *
 * @param {string} mes
 * @param {object} acionato - { itens: [...] }
 * @returns {string[]} problemas (vazio = ok)
 */
export function validarAcionato(mes, acionato) {
  const problemas = [];
  const itens = (acionato && acionato.itens) || [];
  const vistas = new Set();
  for (const item of itens) {
    const data = item.data;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(data || ''))) {
      problemas.push(`Data inválida: "${data}".`);
      continue;
    }
    if (!data.startsWith(`${mes}-`)) {
      problemas.push(`Data "${data}" está fora do mês ${mes}.`);
    }
    if (vistas.has(data)) {
      problemas.push(`Data duplicada: "${data}".`);
    }
    vistas.add(data);
    const modelo = item.modelo_louvor || modeloPorDiaSemana(item.dia);
    if (!MODELOS_VALIDOS.has(modelo)) {
      problemas.push(`Modelo de louvor inválido em "${data}": "${modelo}".`);
    }
  }
  return problemas;
}

/**
 * Grava o Acionato do mês (formato do template + modelo_louvor e extraordinario
 * por item). Lança se a validação falhar.
 *
 * @returns {{ arquivos: string[] }}
 */
export function salvarAcionato(mes, acionato, { root = ROOT } = {}) {
  const problemas = validarAcionato(mes, acionato);
  if (problemas.length > 0) {
    throw new Error(problemas.join(' '));
  }
  const caminho = insumoPath(root, mes, 'acionato.json');
  const anterior = lerJSON(caminho) || {};
  const itens = (acionato.itens || [])
    .map((item) => ({
      data: item.data,
      dia: item.dia || '',
      anciao: item.anciao || '',
      pregador: item.pregador || '',
      observacoes: item.observacoes || '',
      modelo_louvor: item.modelo_louvor || modeloPorDiaSemana(item.dia),
      extraordinario: item.extraordinario === true,
    }))
    .sort((a, b) => a.data.localeCompare(b.data));

  const dados = {
    mes,
    fonte: acionato.fonte || anterior.fonte || 'Escala oficial do acionato',
    atualizado_em: new Date().toISOString().slice(0, 10),
    itens,
  };
  if (anterior.contexto) dados.contexto = anterior.contexto;
  gravarJSON(caminho, dados);
  return { arquivos: [caminhoRelativo(root, caminho)] };
}

// ---------------------------------------------------------------------------
// Sonoplastia (Task 16)
// ---------------------------------------------------------------------------

/**
 * Lê a Sonoplastia do mês. Devolve { mes, itens } ou null. Cada item mantém
 * `sonoplastia: [sonoplasta, suporte]`, `ids` (quando presente) e observações.
 */
export function lerSonoplastia(mes, { root = ROOT } = {}) {
  const dados = lerJSON(insumoPath(root, mes, 'sonoplastia.json'));
  if (!dados) return null;
  const itens = Array.isArray(dados) ? dados : dados.itens || [];
  return {
    mes: dados.mes || mes,
    fonte: dados.fonte || 'Editor de escala',
    atualizado_em: dados.atualizado_em || '',
    itens: itens.map((item) => ({
      data: item.data,
      dia: item.dia || '',
      sonoplastia: Array.isArray(item.sonoplastia) ? item.sonoplastia : [],
      ids: Array.isArray(item.ids) ? item.ids : undefined,
      observacoes: item.observacoes || '',
    })),
  };
}

/**
 * Valida a Sonoplastia: cada posição vem do Cadastro (ID existente, pessoa
 * ativa com habilitação sonoplastia) ou é texto livre com problemasNome vazio.
 *
 * @param {string} mes
 * @param {object} sonoplastia - { itens: [...] }
 * @param {object} cadastro - resultado de carregarPessoas ({ porId })
 * @returns {string[]} problemas (vazio = ok)
 */
export function validarSonoplastia(mes, sonoplastia, cadastro) {
  const problemas = [];
  const porId = cadastro && cadastro.porId ? cadastro.porId : new Map();
  const itens = (sonoplastia && sonoplastia.itens) || [];
  for (const item of itens) {
    const nomes = Array.isArray(item.sonoplastia) ? item.sonoplastia : [];
    const ids = Array.isArray(item.ids) ? item.ids : [];
    for (let i = 0; i < nomes.length; i += 1) {
      const nome = nomes[i];
      if (nome == null || String(nome).trim() === '') continue;
      const id = ids[i];
      if (id != null) {
        const pessoa = porId.get(id);
        if (!pessoa) {
          problemas.push(`${item.data}: ID ${id} não existe no cadastro.`);
        } else if (!pessoa.ativo) {
          problemas.push(`${item.data}: ${pessoa.nome} está inativo.`);
        } else if (!pessoa.habilitacoes || pessoa.habilitacoes.sonoplastia !== true) {
          problemas.push(`${item.data}: ${pessoa.nome} não tem habilitação de sonoplastia.`);
        }
      } else {
        // Texto livre: precisa estar nos Caracteres_de_Nome (sem vírgula).
        const probs = problemasNome(String(nome));
        if (probs.length > 0) {
          problemas.push(`${item.data}: texto livre "${nome}" inválido: ${probs.join(' ')}`);
        }
      }
    }
  }
  return problemas;
}

/**
 * Grava a Sonoplastia do mês. Lança se a validação falhar.
 *
 * @returns {{ arquivos: string[] }}
 */
export function salvarSonoplastia(mes, sonoplastia, { root = ROOT } = {}) {
  const cadastro =
    root === ROOT ? carregarPessoas() : carregarPessoas(resolve(root, 'pessoas.json'));
  const problemas = validarSonoplastia(mes, sonoplastia, cadastro);
  if (problemas.length > 0) {
    throw new Error(problemas.join(' '));
  }
  const caminho = insumoPath(root, mes, 'sonoplastia.json');
  const itens = (sonoplastia.itens || [])
    .map((item) => {
      const saida = {
        data: item.data,
        dia: item.dia || '',
        sonoplastia: Array.isArray(item.sonoplastia) ? item.sonoplastia : [],
        ids: Array.isArray(item.ids) ? item.ids : item.sonoplastia.map(() => null),
        observacoes: item.observacoes || '',
      };
      return saida;
    })
    .sort((a, b) => String(a.data).localeCompare(String(b.data)));

  const dados = {
    mes,
    fonte: sonoplastia.fonte || 'Editor de escala',
    atualizado_em: new Date().toISOString().slice(0, 10),
    itens,
  };
  gravarJSON(caminho, dados);
  return { arquivos: [caminhoRelativo(root, caminho)] };
}
