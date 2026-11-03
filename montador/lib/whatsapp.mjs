// Lista de WhatsApp do mês no servidor (Task 34).
//
// Monta as mensagens por pessoa e por grupo a partir de `atual.json` (escala
// publicada), dos Contatos_Derivados e das Mensagens_WhatsApp editáveis, SEM
// gerar arquivo `.md` (RF025.8). Serve a rota GET /api/whatsapp.
//
// A lógica pura fica em scripts/lib/links-whatsapp.js (compartilhada com o
// script de linha de comando `scripts/publicacao/gerar-links-publicacao.js`).
// Aqui montamos o cadastro (pessoas + grupos com o nome do responsável), os
// contatos derivados e a isenção de cultos `departamental` (tipoDaLinhaAtual).
//
// Feature: melhoras-domingao (F. Envio) — Task 34; Property 34;
// Requisitos 6.18, 25.2, 25.3, 25.4, 25.8, 25.9, 25.10, 26.7.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { ROOT } from './regras.mjs';
import { tipoDaLinhaAtual } from './contexto.mjs';
import { carregarMensagens } from '../../scripts/lib/mensagens-whatsapp.js';
import { derivarContatos } from '../../scripts/lib/contatos.js';
import { montarListaEnvios } from '../../scripts/lib/links-whatsapp.js';

/** Lê um JSON do disco, devolvendo `fallback` em qualquer falha. */
function lerJSON(caminho, fallback) {
  if (!existsSync(caminho)) return fallback;
  try {
    return JSON.parse(readFileSync(caminho, 'utf8'));
  } catch {
    return fallback;
  }
}

/** Filtra as linhas de atual.json de um mês YYYY-MM (ou todas se mes ausente). */
function linhasDoMes(atual, mes) {
  const lista = Array.isArray(atual) ? atual : [];
  if (!mes) return lista;
  return lista.filter((l) => {
    const m = String(l.DATA || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    return m && `${m[3]}-${m[2]}` === mes;
  });
}

/**
 * Enriquece os grupos escaláveis do pessoas.json com o nome do responsável,
 * para que o template use `{nome}` = nome do responsável (não o nome_exibicao).
 *
 * @param {object} arquivoPessoas - conteúdo de pessoas.json
 * @returns {Record<string, object>}
 */
function gruposComResponsavel(arquivoPessoas) {
  const pessoas = Array.isArray(arquivoPessoas?.pessoas) ? arquivoPessoas.pessoas : [];
  const porId = new Map(pessoas.map((p) => [p.id, p]));
  const grupos = {};
  for (const [chave, def] of Object.entries(arquivoPessoas?.grupos || {})) {
    if (!def || def.escalavel !== true) continue;
    const responsavel = porId.get(def.responsavel_id);
    grupos[chave] = {
      ...def,
      nome_responsavel: responsavel ? responsavel.nome : def.nome_exibicao,
    };
  }
  return grupos;
}

/**
 * Lista de envios de WhatsApp do mês. Não grava arquivo.
 *
 * @param {{ mes?: string, root?: string }} [opts]
 * @returns {{ mesAno: string, envios: object[], semContato: object[], avisos: string[] }}
 */
export function listaDoMes({ mes, root = ROOT } = {}) {
  const atual = lerJSON(resolve(root, 'atual.json'), []);
  const linhas = linhasDoMes(atual, mes);

  if (linhas.length === 0) {
    return {
      mesAno: '',
      envios: [],
      semContato: [],
      avisos: ['Nenhum culto encontrado em atual.json para o mês informado.'],
    };
  }

  const arquivoPessoas = lerJSON(resolve(root, 'pessoas.json'), { pessoas: [], grupos: {} });
  const grupos = gruposComResponsavel(arquivoPessoas);
  const contatos = derivarContatos(arquivoPessoas.pessoas || [], arquivoPessoas.grupos || {});

  const { mensagens, avisos: avisosMensagens } = carregarMensagens(
    resolve(root, 'processos/regras/mensagens-whatsapp.json'),
  );

  const resultado = montarListaEnvios(linhas, contatos, {
    mensagens,
    grupos,
    // Isenta só cultos departamentais (RF029.3). Quartas e "sem louvor" já
    // publicam "-" em todos os campos de louvor, então não geram participante.
    ehIsento: (linha) => tipoDaLinhaAtual(linha) === 'departamental',
  });

  return {
    ...resultado,
    avisos: [...avisosMensagens, ...resultado.avisos],
  };
}
