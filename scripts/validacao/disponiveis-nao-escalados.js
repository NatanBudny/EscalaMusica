#!/usr/bin/env node
/**
 * disponiveis-nao-escalados.js
 *
 * Lista quem VOTOU na enquete, tem pelo menos um dia disponível (não marcou
 * "mês inteiro" e não bloqueou todos os cultos), é escalável no louvor, e
 * mesmo assim NÃO foi escalado em nenhum culto do mês.
 *
 * Resolução de identidade: nome/alias exato > telefone.
 *
 * Uso: node scripts/validacao/disponiveis-nao-escalados.js
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
const escala = JSON.parse(readFileSync(resolve(ROOT, arg('escala') || 'atual.json'), 'utf8'));
const cad = JSON.parse(readFileSync(resolve(ROOT, 'pessoas.json'), 'utf8')).pessoas;

const porNomeAlias = new Map(); const porTel = new Map();
for (const p of cad) { porNomeAlias.set(norm(p.nome), p); for (const a of p.aliases || []) porNomeAlias.set(norm(a), p); const t = normTel(p.telefone); if (t && !porTel.has(t)) porTel.set(t, p); }
const resolvePessoa = (nm, tel) => porNomeAlias.get(norm(nm)) || porTel.get(normTel(tel)) || null;

// datas de culto (só sábados/domingos têm louvor próprio; quartas são departamento)
const isoDe = (br) => { const m = String(br).match(/^(\d{2})\/(\d{2})\/(\d{4})$/); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };
const cultosDatas = escala.map((c) => isoDe(c.DATA)).filter(Boolean);

// quem está escalado em algum papel de louvor
const PAPEIS = ['REGENTE LOUVOR', 'EQUIPE LOUVOR', 'MENSAGEM MUSICAL'];
const escaladosIds = new Set();
for (const cu of escala) for (const pp of PAPEIS) for (const nm of String(cu[pp] || '').split(',').map((s) => s.trim()).filter(Boolean)) { const p = porNomeAlias.get(norm(nm)); if (p) escaladosIds.add(p.id); }

// parse CSV
const raw = readFileSync(csvPath, 'utf8').replace(/^\uFEFF/, '');
const lines = raw.split(/\r?\n/).filter((l) => l.trim());
const H = parseCSVLine(lines[0]);
const colD = {}; H.forEach((h, i) => { const m = h.match(/(\d{2})\/(\d{2})/); if (m) colD[i] = `2026-${m[2]}-${m[1]}`; });
const idxMes = H.findIndex((h) => /NÃO POSSO|NAO POSSO/i.test(h));

const resultado = [];
for (let i = 1; i < lines.length; i++) {
  const c = parseCSVLine(lines[i]); const nome = (c[0] || '').trim(); const tel = (c[1] || '').trim();
  if (!nome || nome.toUpperCase() === 'TOTAL') continue;
  const p = resolvePessoa(nome, tel);
  if (!p) continue; // não cadastrado
  // escalável?
  const escalavel = p.ativo && !p.afastado && (p.habilitacoes?.regente || p.habilitacoes?.equipe || p.habilitacoes?.mensagem_musical?.es || p.habilitacoes?.mensagem_musical?.culto || p.habilitacoes?.mensagem_musical?.domingo);
  if (!escalavel) continue;
  // mês inteiro?
  const mesInteiro = idxMes >= 0 && String(c[idxMes] || '').trim() !== '';
  // dias bloqueados
  const bloqueados = new Set();
  for (const [idx, iso] of Object.entries(colD)) if (String(c[idx] || '').trim()) bloqueados.add(iso);
  // dias de culto que a pessoa PODE (respeitando dias_permitidos e regra domingo)
  const diasPode = cultosDatas.filter((iso) => {
    if (mesInteiro) return false;
    if (bloqueados.has(iso)) return false;
    const cu = escala.find((x) => isoDe(x.DATA) === iso);
    const dia = norm(cu['DIA SEMANA']).toLowerCase().includes('domingo') ? 'domingo' : norm(cu['DIA SEMANA']).toLowerCase().includes('sab') ? 'sabado' : 'quarta';
    if (dia === 'quarta') return false; // quartas são departamento
    if (p.dias_permitidos && !p.dias_permitidos.includes(dia)) return false;
    const n = norm(p.nome);
    if (dia === 'domingo' && (n === 'CATHERINE' || n === 'ARIADNY')) return false;
    return true;
  });
  const foiEscalado = escaladosIds.has(p.id);
  if (!mesInteiro && diasPode.length > 0 && !foiEscalado) {
    resultado.push({ nome: p.nome, nomeCsv: nome, diasPode: diasPode.map((d) => d.slice(8) + '/' + d.slice(5, 7)) });
  }
}

console.log(`CSV: ${csvPath}\n`);
console.log('VOTARAM, TÊM DIA(S) DISPONÍVEL(IS), MAS NÃO FORAM ESCALADOS:\n');
if (!resultado.length) console.log('  (ninguém — todos os disponíveis que votaram estão na escala)');
resultado.sort((a, b) => b.diasPode.length - a.diasPode.length || a.nome.localeCompare(b.nome));
for (const r of resultado) console.log(`  - ${r.nome.padEnd(20)} pode em: ${r.diasPode.join(', ')}`);
console.log(`\nTotal: ${resultado.length}`);
