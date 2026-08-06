#!/usr/bin/env node
/**
 * validar-rascunho.js
 * Valida regras operacionais no rascunho mensal (markdown).
 *
 * Regras validadas:
 * - Ninguem pode estar em REGENTE LOUVOR e EQUIPE LOUVOR no mesmo culto.
 * - Excecao permitida quando o louvor inteiro e de departamento (RF015),
 *   identificado por PREGADOR = REGENTE = EQUIPE (valor unico, sem virgula).
 *
 * Uso:
 *   node scripts/validar-rascunho.js
 *   node scripts/validar-rascunho.js escalas/2026/06/rascunho.md
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

function collectRascunhos(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectRascunhos(full));
      continue;
    }
    if (entry.isFile() && entry.name.toLowerCase() === 'rascunho.md') {
      out.push(full);
    }
  }
  return out;
}

function resolveRascunhoPath() {
  const argPath = process.argv[2];
  if (argPath) {
    return resolve(ROOT, argPath);
  }

  const escalasDir = resolve(ROOT, 'escalas');
  if (!existsSync(escalasDir)) {
    throw new Error('Pasta escalas/ nao encontrada. Informe o caminho do rascunho manualmente.');
  }

  const files = collectRascunhos(escalasDir)
    .map((filePath) => ({ filePath, mtime: statSync(filePath).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);

  if (files.length === 0) {
    throw new Error('Nenhum rascunho.md encontrado em escalas/.');
  }

  return files[0].filePath;
}

function parseRows(mdContent) {
  return mdContent
    .split(/\r?\n/)
    .filter((line) => /^\|\s\d{2}\/\d{2}\/\d{4}\s\|/.test(line))
    .map((line) => line.split('|').map((part) => part.trim()));
}

function toIsoDate(brDate) {
  const [dd, mm, yyyy] = (brDate || '').split('/');
  if (!dd || !mm || !yyyy) return '';
  return `${yyyy}-${mm}-${dd}`;
}

function resolveIndisponibilidadePath(pathRascunho) {
  const mmDir = dirname(pathRascunho);
  const candid = resolve(mmDir, 'insumos', 'indisponibilidade-cantores-vinculada.json');
  if (!existsSync(candid)) {
    throw new Error(`Arquivo de indisponibilidade nao encontrado para o rascunho: ${candid}`);
  }
  return candid;
}

function splitAllNames(raw) {
  if (!raw) return [];
  return raw
    .split(',')
    .map((name) => name.trim().toUpperCase())
    .filter((name) => Boolean(name) && name !== 'JOVENS');
}

function splitEquipeNames(raw) {
  if (!raw) return [];
  if (raw.toUpperCase() === 'JOVENS') return ['JOVENS'];
  return raw
    .split(',')
    .map((name) => name.trim().toUpperCase())
    .filter(Boolean);
}

function isDepartmentException(regente, equipeRaw, pregador) {
  const reg = (regente || '').trim().toUpperCase();
  const eq = (equipeRaw || '').trim().toUpperCase();
  const preg = (pregador || '').trim().toUpperCase();
  if (!reg || !eq || !preg) return false;
  if (eq.includes(',')) return false;
  return reg === preg && eq === reg;
}

function run() {
  const pathRascunho = resolveRascunhoPath();
  const raw = readFileSync(pathRascunho, 'utf8');
  const rows = parseRows(raw);
  const pathIndisponibilidade = resolveIndisponibilidadePath(pathRascunho);
  const indisponibilidade = JSON.parse(readFileSync(pathIndisponibilidade, 'utf8'));

  const indisponiveisPorData = new Map();
  for (const item of indisponibilidade.datas || []) {
    if (!item?.data_referencia || !/^\d{4}-\d{2}-\d{2}$/.test(item.data_referencia)) continue;
    indisponiveisPorData.set(
      item.data_referencia,
      new Set((item.indisponiveis_contatos || []).map((name) => String(name).toUpperCase()))
    );
  }

  const errosDuplicidade = [];
  const errosIndisponibilidade = [];

  for (const row of rows) {
    const data = row[1];
    const pregador = row[4];
    const regente = row[6];
    const equipeRaw = row[7];
    const mensagemRaw = row[8];
    const equipeNames = splitEquipeNames(equipeRaw);
    const regenteNorm = (regente || '').trim().toUpperCase();
    const isoDate = toIsoDate(data);
    const indisponiveisData = indisponiveisPorData.get(isoDate) || new Set();

    if (!regenteNorm) continue;
    const isDeptException = isDepartmentException(regente, equipeRaw, pregador);
    if (!isDeptException && equipeNames.includes(regenteNorm)) {
      errosDuplicidade.push({
        data,
        regente: regenteNorm,
      });
    }

    const namesNoCulto = [regente, equipeRaw, mensagemRaw].flatMap(splitAllNames);
    for (const nome of namesNoCulto) {
      if (indisponiveisData.has(nome)) {
        errosIndisponibilidade.push({ data, nome });
      }
    }
  }

  console.log(`\n${BOLD}=== Validacao de Rascunho ===${RESET}`);
  console.log(`Arquivo: ${pathRascunho}\n`);

  if (errosDuplicidade.length > 0) {
    console.log(`${RED}${BOLD}Erros graves de duplicidade (${errosDuplicidade.length}):${RESET}`);
    for (const erro of errosDuplicidade) {
      console.log(`  ${RED}x${RESET} ${erro.data}: ${erro.regente} em REGENTE e EQUIPE no mesmo culto`);
    }
  }

  if (errosIndisponibilidade.length > 0) {
    console.log(`${RED}${BOLD}Erros gravissimos de indisponibilidade (${errosIndisponibilidade.length}):${RESET}`);
    for (const erro of errosIndisponibilidade) {
      console.log(`  ${RED}x${RESET} ${erro.data}: ${erro.nome} marcado como indisponivel no insumo vinculado`);
    }
  }

  if (errosDuplicidade.length > 0 || errosIndisponibilidade.length > 0) {
    console.log(`\n${RED}${BOLD}Falhou.${RESET} Corrija antes de seguir.`);
    process.exit(1);
  }

  console.log(`${GREEN}${BOLD}OK:${RESET} sem duplicidade individual entre REGENTE e EQUIPE.`);
  console.log(`${GREEN}${BOLD}OK:${RESET} sem conflitos com indisponibilidade vinculada.`);
}

try {
  run();
} catch (error) {
  console.error(`${RED}${BOLD}ERRO:${RESET} ${error.message}`);
  process.exit(1);
}
