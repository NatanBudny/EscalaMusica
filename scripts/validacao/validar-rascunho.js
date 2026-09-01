#!/usr/bin/env node
/**
 * validar-rascunho.js
 *
 * Validador determinístico e completo do rascunho mensal. Usa o auditor central
 * (scripts/lib/auditor-escala.js), que concentra TODAS as regras. Substitui as
 * checagens manuais que antes eram feitas caso a caso.
 *
 * Uso:
 *   node scripts/validacao/validar-rascunho.js                 # rascunho mais recente
 *   node scripts/validacao/validar-rascunho.js escalas/2026/09/rascunho.md
 *
 * Exit codes:
 *   0 = sem violações obrigatórias (pode haver avisos)
 *   1 = há violações obrigatórias, ou erro fatal
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { carregarPessoas } from '../lib/cadastro.js';
import { auditarEscala, parseRascunho } from '../lib/auditor-escala.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');

const RED = '\x1b[31m', GREEN = '\x1b[32m', YELLOW = '\x1b[33m', BOLD = '\x1b[1m', RESET = '\x1b[0m';

function collectRascunhos(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectRascunhos(full));
    else if (entry.isFile() && entry.name.toLowerCase() === 'rascunho.md') out.push(full);
  }
  return out;
}

function resolveRascunhoPath() {
  const argPath = process.argv[2];
  if (argPath) return resolve(ROOT, argPath);
  const escalasDir = resolve(ROOT, 'escalas');
  if (!existsSync(escalasDir)) throw new Error('Pasta escalas/ não encontrada. Informe o caminho do rascunho.');
  const files = collectRascunhos(escalasDir)
    .map((f) => ({ f, m: statSync(f).mtimeMs }))
    .sort((a, b) => b.m - a.m);
  if (files.length === 0) throw new Error('Nenhum rascunho.md encontrado em escalas/.');
  return files[0].f;
}

function resolveIndisponibilidade(pathRascunho) {
  const candid = resolve(dirname(pathRascunho), 'insumos', 'indisponibilidade-cantores-vinculada.json');
  if (!existsSync(candid)) {
    console.warn(`${YELLOW}AVISO:${RESET} indisponibilidade vinculada não encontrada (${candid}). Checagem de disponibilidade ficará limitada.`);
    return { datas: [], indisponiveis_mes_inteiro: { nomes: [] } };
  }
  return JSON.parse(readFileSync(candid, 'utf8'));
}

function run() {
  const pathRascunho = resolveRascunhoPath();
  const cadastro = carregarPessoas();
  const indisponibilidade = resolveIndisponibilidade(pathRascunho);
  const cultos = parseRascunho(readFileSync(pathRascunho, 'utf8'));

  const { erros, avisos, icr, totalCultos } = auditarEscala({
    pessoas: cadastro.pessoas, indisponibilidade, cultos,
  });

  console.log(`\n${BOLD}=== Validação de Rascunho ===${RESET}`);
  console.log(`Arquivo: ${pathRascunho}`);
  console.log(`Cultos próprios: ${totalCultos}\n`);

  if (erros.length) {
    console.log(`${RED}${BOLD}Violações obrigatórias (${erros.length}):${RESET}`);
    for (const e of erros) console.log(`  ${RED}✗${RESET} ${e}`);
    console.log('');
  } else {
    console.log(`${GREEN}${BOLD}✓ Nenhuma violação obrigatória.${RESET}\n`);
  }

  if (avisos.length) {
    console.log(`${YELLOW}${BOLD}Avisos / preferências (${avisos.length}):${RESET}`);
    for (const a of avisos) console.log(`  ${YELLOW}⚠${RESET} ${a}`);
    console.log('');
  }

  // ICR resumido
  const sobre = icr.filter((l) => l.icr > 2.0);
  const esquecidos = icr.filter((l) => l.esc === 0 && l.disp >= Math.ceil(totalCultos / 2) && !l.incentivo);
  console.log(`${BOLD}ICR (participação):${RESET}`);
  for (const l of icr.filter((l) => l.esc > 0)) console.log(`  ${l.nome.padEnd(18)} esc=${l.esc} disp=${l.disp} ICR=${l.icr.toFixed(2)}`);
  if (sobre.length) console.log(`  ${RED}Sobrecarga:${RESET} ${sobre.map((l) => l.nome).join(', ')}`);
  if (esquecidos.length) console.log(`  ${YELLOW}Esquecidos (disp, sem incentivo):${RESET} ${esquecidos.map((l) => l.nome).join(', ')}`);

  console.log('');
  if (erros.length) {
    console.log(`${RED}${BOLD}FALHOU — corrija as violações obrigatórias.${RESET}`);
    process.exit(1);
  }
  console.log(`${GREEN}${BOLD}OK — rascunho válido.${RESET}`);
}

try { run(); } catch (err) {
  console.error(`${RED}${BOLD}ERRO:${RESET} ${err.message}`);
  process.exit(1);
}
