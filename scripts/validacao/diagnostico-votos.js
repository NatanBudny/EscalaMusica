#!/usr/bin/env node
/**
 * diagnostico-votos.js
 *
 * Lê o CSV da enquete (nome + telefone + votos por dia), resolve cada votante
 * por TELEFONE contra pessoas.json, e cruza com a escala publicada (atual.json).
 *
 * Produz:
 *   1) Tabela de-para: telefone | nome no CSV | nome considerado (cadastro) | via
 *   2) Lista de conflitos: pessoa escalada em louvor num dia que votou que não pode
 *
 * Uso:
 *   node scripts/validacao/diagnostico-votos.js
 *   node scripts/validacao/diagnostico-votos.js --csv=caminho.csv --escala=atual.json
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');

const args = process.argv.slice(2);
const arg = (n) => {
  const p = args.find((a) => a.startsWith(`--${n}=`));
  return p ? p.split('=').slice(1).join('=') : null;
};

const norm = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const normTel = (s) => String(s || '').replace(/\D/g, '');

function parseCSVLine(line) {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else inQ = !inQ;
    } else if (ch === ',' && !inQ) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

// ---- localizar CSV ----
let csvPath = arg('csv');
if (csvPath && !existsSync(csvPath)) csvPath = resolve(ROOT, csvPath);
if (!csvPath) {
  const home = process.env.USERPROFILE || process.env.HOME;
  const dl = home ? resolve(home, 'Downloads') : null;
  if (dl && existsSync(dl)) {
    const cands = readdirSync(dl)
      .filter((f) => /csv$/i.test(f) && /vote|nao.?pode|indispon/i.test(f))
      .map((f) => ({ f, t: statSync(resolve(dl, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    if (cands.length) csvPath = resolve(dl, cands[0].f);
  }
}
if (!csvPath || !existsSync(csvPath)) {
  console.error('ERRO: CSV não encontrado. Use --csv=<caminho>.');
  process.exit(2);
}

const escalaPath = arg('escala') || 'atual.json';
const escala = JSON.parse(readFileSync(resolve(ROOT, escalaPath), 'utf8'));
const cad = JSON.parse(readFileSync(resolve(ROOT, 'pessoas.json'), 'utf8')).pessoas;

// ---- índices de identidade ----
const porTel = new Map();
const porNomeAlias = new Map();
for (const p of cad) {
  const t = normTel(p.telefone);
  if (t && !porTel.has(t)) porTel.set(t, p);
  porNomeAlias.set(norm(p.nome), p);
  for (const a of p.aliases || []) porNomeAlias.set(norm(a), p);
}

// ---- parse CSV ----
const raw = readFileSync(csvPath, 'utf8').replace(/^\uFEFF/, '');
const lines = raw.split(/\r?\n/).filter((l) => l.trim());
const header = parseCSVLine(lines[0]);

// mapear colunas de data (formato "DD/MM ...") para ISO 2026-MM-DD
const colDatas = {}; // idx -> iso
header.forEach((h, idx) => {
  const m = h.match(/(\d{2})\/(\d{2})/);
  if (m) colDatas[idx] = `2026-${m[2]}-${m[1]}`;
});
const idxMesInteiro = header.findIndex((h) => /NÃO POSSO|NAO POSSO/i.test(h));

// ---- escala: ISO -> Map(id -> papel) apenas papéis de louvor ----
const PAPEIS = ['REGENTE LOUVOR', 'EQUIPE LOUVOR', 'MENSAGEM MUSICAL'];
const isoDe = (br) => {
  const m = String(br).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};
const escaladosPorData = new Map();
for (const cu of escala) {
  const iso = isoDe(cu.DATA);
  if (!iso) continue;
  const set = new Map();
  for (const pp of PAPEIS) {
    for (const nm of String(cu[pp] || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)) {
      const p = porNomeAlias.get(norm(nm));
      if (p) set.set(p.id, pp);
    }
  }
  escaladosPorData.set(iso, set);
}

// ---- processar votantes ----
const tabela = [];
const conflitos = [];
for (let i = 1; i < lines.length; i++) {
  const c = parseCSVLine(lines[i]);
  const nomeCsv = (c[0] || '').trim();
  const telCsv = (c[1] || '').trim();
  if (!nomeCsv || nomeCsv.toUpperCase() === 'TOTAL') continue;
  const t = normTel(telCsv);
  // prioriza nome/alias exato (resolve telefones compartilhados corretamente),
  // depois cai para telefone.
  const porNome = porNomeAlias.get(norm(nomeCsv));
  const porTelefone = porTel.get(t);
  const p = porNome || porTelefone || null;
  const jaAlias =
    p && (norm(p.nome) === norm(nomeCsv) || (p.aliases || []).some((a) => norm(a) === norm(nomeCsv)));
  tabela.push({
    tel: t,
    nomeCsv,
    considerado: p ? p.nome : '*** NAO ENCONTRADO ***',
    via: porNome ? 'nome/alias' : porTelefone ? 'telefone' : '-',
    precisaAlias: p && !jaAlias,
  });
  if (!p) continue;

  const votouDia = [];
  for (const [idx, iso] of Object.entries(colDatas)) {
    if (String(c[idx] || '').trim()) votouDia.push(iso);
  }
  const mesInteiro = idxMesInteiro >= 0 && String(c[idxMesInteiro] || '').trim() !== '';
  const datasCheck = mesInteiro ? Object.values(colDatas) : votouDia;
  for (const iso of datasCheck) {
    const esc = escaladosPorData.get(iso);
    if (esc && esc.has(p.id)) {
      conflitos.push({ iso, nome: p.nome, nomeCsv, papel: esc.get(p.id), mesInteiro });
    }
  }
}

// ---- saída ----
console.log(`CSV:    ${csvPath}`);
console.log(`Escala: ${escalaPath}\n`);

console.log('===== TABELA DE-PARA =====');
console.log(
  ['TELEFONE'.padEnd(14), 'NOME NO CSV'.padEnd(34), 'NOME CONSIDERADO'.padEnd(22), 'VIA'.padEnd(9), 'ALIAS?'].join(' | ')
);
console.log('-'.repeat(100));
for (const r of tabela) {
  console.log(
    [
      r.tel.padEnd(14),
      r.nomeCsv.padEnd(34),
      r.considerado.padEnd(22),
      r.via.padEnd(9),
      r.precisaAlias ? 'ADD' : '',
    ].join(' | ')
  );
}

console.log('\n===== CONFLITOS (escalado em dia que votou NAO poder) =====');
if (!conflitos.length) console.log('Nenhum.');
for (const c of conflitos) {
  const [ano, m, d] = c.iso.split('-');
  console.log(`X  ${d}/${m}/${ano}  |  ${c.nome}  (CSV: ${c.nomeCsv})  |  ${c.papel}${c.mesInteiro ? '  | votou MES INTEIRO' : ''}`);
}
console.log('');
