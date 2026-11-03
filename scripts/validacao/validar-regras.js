#!/usr/bin/env node
/**
 * validar-regras.js
 * Valida a integridade da documentação de regras de negócio do EscalaMusica.
 * Executa: node scripts/validacao/validar-regras.js
 *
 * As checagens agora vivem em scripts/lib/validar-catalogo.js (reusadas também
 * pela tela de regras do editor). Este script mantém a mesma saída de antes.
 */

import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { validarSnapshotEMd } from '../lib/validar-catalogo.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');

const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const GREEN = '\x1b[32m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

const { erros, avisos, contagens } = validarSnapshotEMd(ROOT);

<<<<<<< Updated upstream
function erro(msg)   { errors.push(`  ${RED}✗${RESET} ${msg}`); }
function aviso(msg)  { warnings.push(`  ${YELLOW}⚠${RESET}  ${msg}`); }

// ─── 1. Carrega e valida o JSON ───────────────────────────────────────────────
let json;
// Fonte da verdade atual das regras: docs/regras/ (onde as regras são editadas).
// processos/regras/ fica como fallback. TODO: unificar na migração para SQLite.
const jsonPreferido = resolve(ROOT, 'docs/regras/regras.json');
const jsonFallback = resolve(ROOT, 'processos/regras/regras.snapshot.json');
const jsonPath = existsSync(jsonPreferido) ? jsonPreferido : jsonFallback;
try {
  const raw = readFileSync(jsonPath, 'utf8');
  json = JSON.parse(raw);
} catch (e) {
  console.error(`${RED}${BOLD}ERRO CRÍTICO:${RESET} regras.json inválido ou não encontrado`);
  console.error(`  ${e.message}`);
  process.exit(1);
}

// ─── 2. Carrega REGRAS.md ─────────────────────────────────────────────────────
let md;
const mdPreferido = resolve(ROOT, 'docs/regras/REGRAS.md');
const mdFallback = resolve(ROOT, 'processos/regras/REGRAS.md');
const mdPath = existsSync(mdPreferido) ? mdPreferido : mdFallback;
try {
  md = readFileSync(mdPath, 'utf8');
} catch (e) {
  console.error(`${RED}${BOLD}ERRO CRÍTICO:${RESET} REGRAS.md não encontrado`);
  process.exit(1);
}

// ─── 3. Seções obrigatórias no JSON ──────────────────────────────────────────
const secoesObrigatorias = [
  'versao', 'papeis', 'regras_fundamentais',
  'preferencias', 'restricoes_pessoais', 'glossario'
];
for (const secao of secoesObrigatorias) {
  if (!(secao in json)) erro(`JSON: seção obrigatória ausente: "${secao}"`);
}

// ─── 4. Seções obrigatórias no MD ────────────────────────────────────────────
const secoesMd = [
  '## RF — Regras Fundamentais',
  '## RP — Restrições Pessoais',
  '## PE — Preferências de Escala',
  '## TI — Time e Papéis',
  '## Glossário',
];
for (const secao of secoesMd) {
  if (!md.includes(secao)) erro(`REGRAS.md: seção obrigatória ausente: "${secao}"`);
}

// ─── 5. Extrai IDs do MD via regex ───────────────────────────────────────────
const idsRfMd  = [...md.matchAll(/\*\*(RF\d+)\*\*/g)].map(m => m[1]);
const idsPeMd  = [...md.matchAll(/\*\*(PE\d+)\*\*/g)].map(m => m[1]);
const idsRpMd  = [...md.matchAll(/\*\*(RP\d+)\b/g)].map(m => m[1]);

// ─── 6. Extrai IDs do JSON ───────────────────────────────────────────────────
const idsRfJson = (json.regras_fundamentais || []).map(r => r.id);
const idsPeJson = (json.preferencias || []).map(r => r.id);
const idsRpJson = Object.values(json.restricoes_pessoais || {}).flatMap(
  arr => (Array.isArray(arr) ? arr : [arr]).map(r => r.id).filter(Boolean)
=======
// Erro crítico de JSON/MD ausente encerra imediatamente, como antes.
const critico = erros.find(
  (e) => e.includes('regras.json inválido') || e.includes('REGRAS.md não encontrado'),
>>>>>>> Stashed changes
);
if (critico) {
  console.error(`${RED}${BOLD}ERRO CRÍTICO:${RESET} ${critico}`);
  process.exit(1);
}

const errors = erros.map((m) => `  ${RED}✗${RESET} ${m}`);
const warnings = avisos.map((m) => `  ${YELLOW}⚠${RESET}  ${m}`);

console.log(`\n${BOLD}=== Validação de Regras de Negócio — EscalaMusica ===${RESET}\n`);

if (warnings.length) {
  console.log(`${YELLOW}${BOLD}Avisos (${warnings.length}):${RESET}`);
  warnings.forEach((w) => console.log(w));
  console.log('');
}

if (errors.length) {
  console.log(`${RED}${BOLD}Erros (${errors.length}):${RESET}`);
  errors.forEach((e) => console.log(e));
  console.log(`\n${RED}${BOLD}✗ Validação FALHOU.${RESET} Corrija os erros antes de continuar.\n`);
  process.exit(1);
} else {
  console.log(`${GREEN}${BOLD}✓ Tudo válido!${RESET} MD e JSON estão sincronizados.`);
  console.log(`  RF: ${contagens.rf} | PE: ${contagens.pe} | RP: ${contagens.rp}\n`);
}
