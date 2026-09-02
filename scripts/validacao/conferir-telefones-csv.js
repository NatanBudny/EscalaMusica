#!/usr/bin/env node
/**
 * conferir-telefones-csv.js
 *
 * Para cada votante do CSV que NÃO casa por telefone exato com pessoas.json,
 * tenta um casamento tolerante (variações do 9º dígito do celular) e reporta
 * o provável dono, para permitir corrigir o cadastro com segurança.
 *
 * NÃO altera nada — só diagnóstico.
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const args = process.argv.slice(2);
const arg = (n) => { const p = args.find((a) => a.startsWith(`--${n}=`)); return p ? p.split('=').slice(1).join('=') : null; };
const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const normTel = (s) => String(s || '').replace(/\D/g, '');

function parseCSVLine(line) {
  const out = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) { const ch = line[i];
    if (ch === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
    else if (ch === ',' && !q) { out.push(cur); cur = ''; } else cur += ch; }
  out.push(cur); return out;
}

// gera variações plausíveis de um telefone: com/sem 9 após DDD, com/sem 55
function variacoes(tel) {
  const t = normTel(tel);
  const set = new Set([t]);
  // 55 + DDD(2) + resto
  const m = t.match(/^55(\d{2})(\d+)$/);
  if (m) {
    const [, ddd, resto] = m;
    // remover 9 inicial do resto
    if (resto.length === 9 && resto[0] === '9') set.add(`55${ddd}${resto.slice(1)}`);
    // adicionar 9 inicial
    if (resto.length === 8) set.add(`55${ddd}9${resto}`);
  }
  return set;
}

let csvPath = arg('csv');
if (!csvPath) {
  const home = process.env.USERPROFILE || process.env.HOME;
  const dl = home ? resolve(home, 'Downloads') : null;
  if (dl && existsSync(dl)) {
    const c = readdirSync(dl).filter((f) => /csv$/i.test(f) && /vote|indispon|pode/i.test(f))
      .map((f) => ({ f, t: statSync(resolve(dl, f)).mtimeMs })).sort((a, b) => b.t - a.t);
    if (c.length) csvPath = resolve(dl, c[0].f);
  }
}
const cad = JSON.parse(readFileSync(resolve(ROOT, 'pessoas.json'), 'utf8')).pessoas;
const porTel = new Map(); const porNomeAlias = new Map();
for (const p of cad) { const t = normTel(p.telefone); if (t) { if (!porTel.has(t)) porTel.set(t, []); porTel.get(t).push(p); } porNomeAlias.set(norm(p.nome), p); for (const a of p.aliases || []) porNomeAlias.set(norm(a), p); }

const raw = readFileSync(csvPath, 'utf8').replace(/^\uFEFF/, '');
const lines = raw.split(/\r?\n/).filter((l) => l.trim());
console.log(`CSV: ${csvPath}\n`);
console.log('NÃO casam por telefone exato (provável correção de cadastro):\n');
for (let i = 1; i < lines.length; i++) {
  const c = parseCSVLine(lines[i]); const nome = (c[0] || '').trim(); const tel = (c[1] || '').trim();
  if (!nome || nome.toUpperCase() === 'TOTAL') continue;
  const t = normTel(tel);
  if (porTel.has(t)) continue; // casa exato
  // tenta por nome/alias
  const porNome = porNomeAlias.get(norm(nome));
  // tenta por variação de telefone
  let alvoVar = null;
  for (const v of variacoes(t)) { if (porTel.has(v)) { alvoVar = porTel.get(v); break; } }
  const provavel = alvoVar ? alvoVar.map((p) => `${p.nome} (cad tel ${normTel(p.telefone)})`).join(' / ') : porNome ? `${porNome.nome} (por nome)` : '??? sem candidato';
  console.log(`  CSV "${nome}"  tel ${t}  =>  ${provavel}`);
}
console.log('');
