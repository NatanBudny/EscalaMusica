#!/usr/bin/env node
/**
 * validar-regras.js
 * Valida a integridade da documentação de regras de negócio do EscalaMusica.
 * Executa: node scripts/validar-regras.js
 *
 * Verifica:
 *  1. JSON válido e sintaticamente correto
 *  2. Seções obrigatórias presentes no JSON
 *  3. IDs de RF no REGRAS.md existem no JSON e vice-versa
 *  4. IDs de PE no REGRAS.md existem no JSON e vice-versa
 *  5. IDs de RP no REGRAS.md existem no JSON e vice-versa
 *  6. Campos obrigatórios em cada regra (id, descricao)
 *  7. Seções obrigatórias presentes no REGRAS.md
 *  8. Glossário presente nos dois arquivos
 *  9. Nenhum ID duplicado
 * 10. Aviso se ultima_atualizacao estiver vazia
 */

import { existsSync, readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const RED    = '\x1b[31m';
const YELLOW = '\x1b[33m';
const GREEN  = '\x1b[32m';
const RESET  = '\x1b[0m';
const BOLD   = '\x1b[1m';

let errors   = [];
let warnings = [];

function erro(msg)   { errors.push(`  ${RED}✗${RESET} ${msg}`); }
function aviso(msg)  { warnings.push(`  ${YELLOW}⚠${RESET}  ${msg}`); }

// ─── 1. Carrega e valida o JSON ───────────────────────────────────────────────
let json;
const jsonNovo = resolve(ROOT, 'processos/regras/regras.snapshot.json');
const jsonLegado = resolve(ROOT, 'docs/regras/regras.json');
const jsonPath = existsSync(jsonNovo) ? jsonNovo : jsonLegado;
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
const mdNovo = resolve(ROOT, 'processos/regras/REGRAS.md');
const mdLegado = resolve(ROOT, 'docs/regras/REGRAS.md');
const mdPath = existsSync(mdNovo) ? mdNovo : mdLegado;
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
);

// ─── 7. Sincronização MD ↔ JSON ──────────────────────────────────────────────
for (const id of idsRfMd) {
  if (!idsRfJson.includes(id)) erro(`${id} está no REGRAS.md mas não no JSON (regras_fundamentais)`);
}
for (const id of idsRfJson) {
  if (!idsRfMd.includes(id)) erro(`${id} está no JSON mas não no REGRAS.md`);
}

for (const id of idsPeMd) {
  if (!idsPeJson.includes(id)) erro(`${id} está no REGRAS.md mas não no JSON (preferencias)`);
}
for (const id of idsPeJson) {
  if (!idsPeMd.includes(id)) erro(`${id} está no JSON mas não no REGRAS.md`);
}

for (const id of idsRpMd) {
  if (!idsRpJson.includes(id)) erro(`${id} está no REGRAS.md mas não no JSON (restricoes_pessoais)`);
}
for (const id of idsRpJson) {
  if (!idsRpMd.includes(id)) erro(`${id} está no JSON mas não no REGRAS.md`);
}

// ─── 8. Campos obrigatórios em cada regra ────────────────────────────────────
const todasRegras = [
  ...(json.regras_fundamentais || []),
  ...(json.preferencias || []),
  ...idsRpJson.map(id => ({ id })),
];
for (const regra of [...(json.regras_fundamentais || []), ...(json.preferencias || [])]) {
  if (!regra.id)       erro(`Regra sem campo "id": ${JSON.stringify(regra).slice(0, 60)}`);
  if (!regra.descricao) erro(`Regra ${regra.id} sem campo "descricao"`);
}

// ─── 9. IDs duplicados ───────────────────────────────────────────────────────
function findDuplicates(arr) {
  return arr.filter((v, i) => arr.indexOf(v) !== i);
}
const dupRf = findDuplicates(idsRfJson);
const dupPe = findDuplicates(idsPeJson);
if (dupRf.length) erro(`IDs duplicados em regras_fundamentais: ${dupRf.join(', ')}`);
if (dupPe.length) erro(`IDs duplicados em preferencias: ${dupPe.join(', ')}`);

// ─── 10. Avisos ──────────────────────────────────────────────────────────────
if (!json.ultima_atualizacao) {
  aviso('"ultima_atualizacao" está vazia no JSON — atualize com a data da última modificação');
}
if ((json.regras_fundamentais || []).length === 0) {
  aviso('Nenhuma RF registrada ainda no JSON');
}
if (!json.glossario || Object.keys(json.glossario).length < 5) {
  aviso('Glossário com menos de 5 termos — pode estar incompleto');
}
if (!md.includes('## Glossário')) {
  aviso('REGRAS.md pode estar sem o cabeçalho "## Glossário"');
}

// ─── Resultado ────────────────────────────────────────────────────────────────
console.log(`\n${BOLD}=== Validação de Regras de Negócio — EscalaMusica ===${RESET}\n`);

if (warnings.length) {
  console.log(`${YELLOW}${BOLD}Avisos (${warnings.length}):${RESET}`);
  warnings.forEach(w => console.log(w));
  console.log('');
}

if (errors.length) {
  console.log(`${RED}${BOLD}Erros (${errors.length}):${RESET}`);
  errors.forEach(e => console.log(e));
  console.log(`\n${RED}${BOLD}✗ Validação FALHOU.${RESET} Corrija os erros antes de continuar.\n`);
  process.exit(1);
} else {
  console.log(`${GREEN}${BOLD}✓ Tudo válido!${RESET} MD e JSON estão sincronizados.`);
  console.log(`  RF: ${idsRfJson.length} | PE: ${idsPeJson.length} | RP: ${idsRpJson.length}\n`);
}
