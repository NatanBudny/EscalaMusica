// Controles de rotação do editor de escala (Task 31).
//
// Reaproveita as três funções gerarControle* de
// scripts/controle/controle-rotacao-utils.js (que agora aceitam
// { periodos, saida, root }) para, no fechamento de um mês, regravar os três
// controles de rotação em escalas/AAAA/MM/.
//
// - periodosDaJanela(mes, janelaMeses, { root }) monta a lista de períodos
//   (arquivos old/AAAA/MM-AAAA.json ou old/AAAA/MMAAAA.json dos meses da janela
//   anteriores ao mês publicado, mais atual.json).
// - atualizarControles(mes, { root, parametros }) grava os três controles e
//   devolve { arquivos } (caminhos relativos ao repositório tocados).
//
// Grupo_Escalavel é contado pelo nome_exibicao e Departamentos são ignorados
// (ambos tratados em controle-rotacao-utils.js).
//
// Feature: melhoras-domingao (F. Envio) — Task 31; Property 32;
// Requisitos 6.17, 23.5, 28.4, 29.4.

import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { ROOT } from './regras.mjs';
import {
  gerarControleMensagemMusical,
  gerarControleRegentes,
  gerarControleEquipeLouvor,
} from '../../scripts/controle/controle-rotacao-utils.js';

/** Rótulos curtos dos meses, usados só para o rótulo do período de cada arquivo. */
const ROTULOS_MES = [
  'JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN',
  'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ',
];

/**
 * Subtrai `n` meses de um par { ano, mes } (1-12).
 *
 * @param {number} ano
 * @param {number} mes 1-12
 * @param {number} n
 * @returns {{ ano: number, mes: number }}
 */
function subtrairMeses(ano, mes, n) {
  const totalZeroBased = ano * 12 + (mes - 1) - n;
  return { ano: Math.floor(totalZeroBased / 12), mes: (totalZeroBased % 12) + 1 };
}

/**
 * Caminho relativo de um arquivo mensal em old/, aceitando as duas convenções
 * (`old/AAAA/MM-AAAA.json` ou `old/AAAA/MMAAAA.json`). Devolve o primeiro que
 * existir, ou null.
 */
function arquivoOldDoMes(ano, mes, root) {
  const mm = String(mes).padStart(2, '0');
  const candidatos = [`old/${ano}/${mm}-${ano}.json`, `old/${ano}/${mm}${ano}.json`];
  for (const rel of candidatos) {
    if (existsSync(resolve(root, rel))) return rel;
  }
  return null;
}

/**
 * Monta a lista de períodos considerada pelos controles ao fechar `mes`:
 * os `janelaMeses` meses anteriores (arquivos em old/ que existirem) na ordem
 * cronológica, seguidos de `atual.json` (o mês que está sendo publicado).
 *
 * @param {string} mes - "AAAA-MM"
 * @param {number} [janelaMeses=4]
 * @param {{ root?: string }} [opts]
 * @returns {{ rotulo: string, arquivo: string }[]}
 */
export function periodosDaJanela(mes, janelaMeses = 4, { root = ROOT } = {}) {
  const [anoStr, mesStr] = String(mes).split('-');
  const ano = Number(anoStr);
  const mesNum = Number(mesStr);
  if (!ano || !mesNum) return [{ rotulo: 'ATUAL', arquivo: 'atual.json' }];

  const periodos = [];
  // Meses anteriores ao mês publicado, do mais antigo ao mais recente.
  for (let i = janelaMeses; i >= 1; i -= 1) {
    const { ano: a, mes: m } = subtrairMeses(ano, mesNum, i);
    const arquivo = arquivoOldDoMes(a, m, root);
    if (arquivo) periodos.push({ rotulo: `${ROTULOS_MES[m - 1]}/${a}`, arquivo });
  }
  // O mês sendo publicado está em atual.json.
  periodos.push({ rotulo: `${ROTULOS_MES[mesNum - 1]}/${ano}`, arquivo: 'atual.json' });
  return periodos;
}

/**
 * Regrava os três controles de rotação em escalas/AAAA/MM/ a partir da janela
 * de períodos e devolve a lista de caminhos tocados (para o commit seletivo).
 *
 * @param {string} mes - "AAAA-MM"
 * @param {{ root?: string, parametros?: object }} [opts]
 * @returns {{ arquivos: string[] }}
 */
export function atualizarControles(mes, { root = ROOT, parametros } = {}) {
  const [ano, mm] = String(mes).split('-');
  const janelaMeses =
    (parametros && parametros.historico && parametros.historico.janela_meses) || 4;
  const periodos = periodosDaJanela(mes, janelaMeses, { root });
  const rotuloPeriodoTexto = periodos.length
    ? `${periodos[0].rotulo} a ${periodos[periodos.length - 1].rotulo}`
    : mes;

  const base = `escalas/${ano}/${mm}`;
  // Garante a pasta do mês (controle-rotacao-utils escreve sem criar pastas).
  mkdirSync(resolve(root, base), { recursive: true });
  const saidas = {
    mm: `${base}/controle-mensagem-musical.json`,
    regentes: `${base}/controle-regentes.json`,
    equipe: `${base}/controle-equipe-louvor.json`,
  };

  gerarControleMensagemMusical({ periodos, saida: saidas.mm, root, rotuloPeriodoTexto });
  gerarControleRegentes({ periodos, saida: saidas.regentes, root, rotuloPeriodoTexto });
  gerarControleEquipeLouvor({ periodos, saida: saidas.equipe, root, rotuloPeriodoTexto });

  return { arquivos: [saidas.mm, saidas.regentes, saidas.equipe] };
}
