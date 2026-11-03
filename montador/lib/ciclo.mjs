// Iniciar ou retomar o mês pelo editor (equivalente a scripts/ciclo/iniciar-mes.js,
// mas gerando o Acionato com o calendário completo: todas as quartas, sábados e
// domingos do mês).
//
// - calendarioBase(mes): ItemAcionato[] com todas as quartas, sábados e domingos.
// - abrirMes(mes, { root }): cria escalas/AAAA/MM/insumos/ e arquivo/, grava o
//   Acionato com o calendário base quando ainda não existe (mês já iniciado não é
//   sobrescrito) e devolve o estado dos insumos.
//
// Feature: melhoras-domingao (D. Mês e insumos) — Task 14; Requisitos 11.1 a 11.4.

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT } from './regras.mjs';

const DIAS_PT = [
  'domingo',
  'segunda-feira',
  'terca-feira',
  'quarta-feira',
  'quinta-feira',
  'sexta-feira',
  'sabado',
];

const MESES_PT = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

/** Modelo de louvor padrão pelo dia da semana (0=domingo ... 6=sábado). */
function modeloPorDow(dow) {
  if (dow === 6) return 'sabado';
  if (dow === 0) return 'domingo';
  return 'sem_louvor'; // quarta
}

/**
 * Gera o calendário base do mês: todas as quartas (dow 3), sábados (dow 6) e
 * domingos (dow 0), em ordem de data. Cada item traz os campos do Acionato,
 * vazios para preenchimento, mais `modelo_louvor` e `extraordinario: false`.
 *
 * @param {string} mes - 'AAAA-MM'
 * @returns {object[]} itens do Acionato
 */
export function calendarioBase(mes) {
  const m = String(mes).match(/^(\d{4})-(\d{2})$/);
  if (!m) throw new Error('Mês inválido (esperado AAAA-MM).');
  const ano = Number(m[1]);
  const mesNum = Number(m[2]);
  const diasNoMes = new Date(ano, mesNum, 0).getDate();

  const itens = [];
  for (let dia = 1; dia <= diasNoMes; dia += 1) {
    const date = new Date(ano, mesNum - 1, dia);
    const dow = date.getDay();
    if (dow !== 0 && dow !== 3 && dow !== 6) continue; // só domingo, quarta e sábado
    const iso = `${m[1]}-${m[2]}-${String(dia).padStart(2, '0')}`;
    itens.push({
      data: iso,
      dia: DIAS_PT[dow],
      anciao: '',
      pregador: '',
      observacoes: '',
      modelo_louvor: modeloPorDow(dow),
      extraordinario: false,
    });
  }
  return itens;
}

/** Caminho de um insumo do mês. */
function insumoPath(root, mes, nome) {
  const [ano, mm] = mes.split('-');
  return resolve(root, `escalas/${ano}/${mm}/insumos/${nome}`);
}

/** 'preenchido' quando o arquivo existe; 'pendente' quando ausente. */
function estadoArquivo(caminho) {
  return existsSync(caminho) ? 'preenchido' : 'pendente';
}

/** atual.json contém o mês informado? */
function mesPublicado(root, mes) {
  const caminho = resolve(root, 'atual.json');
  if (!existsSync(caminho)) return false;
  try {
    const dados = JSON.parse(readFileSync(caminho, 'utf8'));
    if (!Array.isArray(dados)) return false;
    return dados.some((linha) => {
      const data = linha.DATA || linha.data || '';
      return String(data).startsWith(mes);
    });
  } catch {
    return false;
  }
}

/**
 * Inicia ou retoma um mês. Cria as pastas insumos/ e arquivo/, e grava o
 * Acionato com o calendário completo quando ele ainda não existe. Mês já
 * iniciado (acionato.json presente) não é sobrescrito.
 *
 * @param {string} mes - 'AAAA-MM'
 * @param {{ root?: string }} [opts]
 * @returns {{
 *   iniciadoAgora: boolean,
 *   arquivos: string[],
 *   insumos: { acionato: string, sonoplastia: string, enquete: string },
 *   publicado: boolean,
 * }}
 */
export function abrirMes(mes, { root = ROOT } = {}) {
  const m = String(mes).match(/^(\d{4})-(\d{2})$/);
  if (!m) throw new Error('Mês inválido (esperado AAAA-MM).');
  const ano = m[1];
  const mm = m[2];

  const insumosDir = resolve(root, `escalas/${ano}/${mm}/insumos`);
  const arquivoDir = resolve(root, `escalas/${ano}/${mm}/arquivo`);
  const acionatoPath = resolve(insumosDir, 'acionato.json');

  mkdirSync(insumosDir, { recursive: true });
  mkdirSync(arquivoDir, { recursive: true });

  const arquivos = [];
  let iniciadoAgora = false;

  if (!existsSync(acionatoPath)) {
    const mesNome = MESES_PT[Number(mm) - 1] || `Mês ${Number(mm)}`;
    const acionato = {
      mes,
      fonte: 'Escala oficial do acionato',
      atualizado_em: `${ano}-${mm}-01`,
      contexto: `Acionato - ${mesNome} ${ano}`,
      itens: calendarioBase(mes),
    };
    writeFileSync(acionatoPath, `${JSON.stringify(acionato, null, 2)}\n`, 'utf8');
    arquivos.push(`escalas/${ano}/${mm}/insumos/acionato.json`);
    iniciadoAgora = true;
  }

  return {
    iniciadoAgora,
    arquivos,
    insumos: {
      acionato: estadoArquivo(acionatoPath),
      sonoplastia: estadoArquivo(insumoPath(root, mes, 'sonoplastia.json')),
      enquete: estadoArquivo(insumoPath(root, mes, 'indisponibilidade-cantores.json')),
    },
    publicado: mesPublicado(root, mes),
  };
}
