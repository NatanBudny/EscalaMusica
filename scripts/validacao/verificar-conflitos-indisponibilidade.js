#!/usr/bin/env node
/**
 * verificar-conflitos-indisponibilidade.js
 *
 * Cruza a ESCALA PUBLICADA (atual.json ou um --escala) contra a
 * INDISPONIBILIDADE ORIGINAL da enquete (indisponibilidade-cantores.json),
 * reportando quem foi escalado em um dia que votou que NÃO pode.
 *
 * Resolução de identidade (determinística):
 *   1) telefone (chave forte) — casa o telefone da enquete com pessoas.json
 *   2) nome/alias normalizado — fallback quando não há telefone
 *
 * Uso:
 *   node scripts/validacao/verificar-conflitos-indisponibilidade.js --mes=2026-09
 *   node scripts/validacao/verificar-conflitos-indisponibilidade.js --escala=atual.json --indisp=escalas/2026/09/insumos/indisponibilidade-cantores.json
 *
 * Saída: lista de conflitos (data, pessoa, papel) + resumo. Exit 1 se houver conflito.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';

// ---- args ----
const args = process.argv.slice(2);
function arg(name) {
  const p = args.find((a) => a.startsWith(`--${name}=`));
  return p ? p.split('=').slice(1).join('=') : null;
}
const mes = arg('mes'); // AAAA-MM
let escalaPath = arg('escala');
let indispPath = arg('indisp');

if (mes) {
  const [ano, mm] = mes.split('-');
  if (!escalaPath) escalaPath = 'atual.json';
  if (!indispPath) indispPath = `escalas/${ano}/${mm}/insumos/indisponibilidade-cantores.json`;
}
if (!escalaPath) escalaPath = 'atual.json';
if (!indispPath) {
  console.error(`${RED}ERRO:${RESET} informe --mes=AAAA-MM ou --indisp=<caminho>.`);
  process.exit(2);
}

// ---- helpers ----
function norm(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function normTel(s) {
  return String(s || '').replace(/\D/g, '');
}
function carregar(p, label) {
  const abs = resolve(ROOT, p);
  if (!existsSync(abs)) {
    console.error(`${RED}ERRO:${RESET} ${label} não encontrado: ${abs}`);
    process.exit(2);
  }
  return JSON.parse(readFileSync(abs, 'utf8'));
}

// ---- carga ----
const escala = carregar(escalaPath, 'Escala');
const indisp = carregar(indispPath, 'Indisponibilidade (enquete original)');
const cadastro = carregar('pessoas.json', 'Cadastro de pessoas');
const pessoas = cadastro.pessoas || [];

// CSV opcional (nome + telefone) para resolução forte por telefone.
// --csv=<caminho> ou auto-detecta o mais recente em ~/Downloads começando por "vote".
function parseCSVLine(line) {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (ch === ',' && !inQ) {
      out.push(cur); cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}
let csvVotos = null; // [{nome, telefone}]
let csvPath = arg('csv');
if (!csvPath) {
  try {
    const home = process.env.USERPROFILE || process.env.HOME;
    if (home) {
      const dl = resolve(home, 'Downloads');
      if (existsSync(dl)) {
        const { readdirSync, statSync } = await import('node:fs');
        const cands = readdirSync(dl)
          .filter((f) => /\.csv$/i.test(f) && /vote|nao.?pode|indispon/i.test(f))
          .map((f) => ({ f, t: statSync(resolve(dl, f)).mtimeMs }))
          .sort((a, b) => b.t - a.t);
        if (cands.length) csvPath = resolve(dl, cands[0].f);
      }
    }
  } catch { /* ignore */ }
}
if (csvPath && existsSync(resolve(ROOT, csvPath) )) csvPath = resolve(ROOT, csvPath);
if (csvPath && existsSync(csvPath)) {
  const raw = readFileSync(csvPath, 'utf8').replace(/^\uFEFF/, '');
  const lines = raw.split(/\r?\n/).filter((l) => l.trim());
  const header = parseCSVLine(lines[0]).map((h) => h.trim());
  const idxNome = header.findIndex((h) => /name|nome/i.test(h));
  const idxTel = header.findIndex((h) => /phone|telefone|number/i.test(h));
  csvVotos = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    const nome = (cols[idxNome] || '').trim();
    const tel = (cols[idxTel] || '').trim();
    if (nome && nome.toUpperCase() !== 'TOTAL') csvVotos.push({ nome, telefone: tel });
  }
}

// Índices de identidade do cadastro
const porTelefone = new Map(); // tel -> pessoa
const porNomeAlias = new Map(); // nome/alias normalizado -> pessoa
for (const p of pessoas) {
  const tel = normTel(p.telefone);
  if (tel && !porTelefone.has(tel)) porTelefone.set(tel, p);
  porNomeAlias.set(norm(p.nome), p);
  for (const a of p.aliases || []) porNomeAlias.set(norm(a), p);
}

// Resolução por telefone da enquete (mapa nome-da-enquete -> telefone), construído
// a partir do CSV quando disponível. Sem telefone, cai para match EXATO de
// nome/alias (nunca heurística de tokens — gera falsos positivos como
// "Dani Kallas" -> "DANI HERREIRA").
const telefonePorNomeEnquete = new Map(); // norm(nomeEnquete) -> tel
if (csvVotos) {
  for (const v of csvVotos) telefonePorNomeEnquete.set(norm(v.nome), normTel(v.telefone));
}

function resolverNomeEnquete(nomeEnquete) {
  const n = norm(nomeEnquete);
  // 1) telefone (chave forte)
  const tel = telefonePorNomeEnquete.get(n);
  if (tel && porTelefone.has(tel)) return porTelefone.get(tel);
  // 2) match exato de nome/alias
  if (porNomeAlias.has(n)) return porNomeAlias.get(n);
  return null;
}

// Monta indisponibilidade por data (IDs) e mês inteiro (IDs)
const indispPorData = new Map(); // dataISO -> Set(id)
const naoResolvidos = new Set();
let mesInteiro = new Set();

for (const d of indisp.datas || []) {
  if (d.data_referencia === 'geral' || d.dia_semana === 'todos') {
    const nomes = d.indisponiveis_tempo_indeterminado || d.indisponiveis || [];
    for (const nm of nomes) {
      if (!nm || !nm.trim()) continue;
      const p = resolverNomeEnquete(nm);
      if (p) mesInteiro.add(p.id);
      else naoResolvidos.add(nm);
    }
    continue;
  }
  const set = new Set();
  for (const nm of d.indisponiveis || []) {
    if (!nm || !nm.trim()) continue;
    const p = resolverNomeEnquete(nm);
    if (p) set.add(p.id);
    else naoResolvidos.add(nm);
  }
  indispPorData.set(d.data_referencia, set);
}

// ---- conversão de data da escala (DD/MM/AAAA) para ISO ----
function dataISO(dataBR) {
  const m = String(dataBR).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

// ---- resolve nomes escalados (papel a papel) para IDs ----
const PAPEIS = ['REGENTE LOUVOR', 'EQUIPE LOUVOR', 'MENSAGEM MUSICAL'];
// AUDIOVISUAL / ANCIÃO / PREGADOR são escala externa — não são cantores da enquete.

function resolverEscalado(nome) {
  const n = norm(nome);
  if (!n) return null;
  if (porNomeAlias.has(n)) return porNomeAlias.get(n);
  return null; // nomes de grupo (JOVENS, DESBRAVADORES, CORAL INFANTIL) não são pessoas escaláveis
}

// ---- cruzamento ----
const conflitos = [];
for (const culto of escala) {
  const iso = dataISO(culto.DATA);
  if (!iso) continue;
  const indispDia = indispPorData.get(iso) || new Set();

  for (const papel of PAPEIS) {
    const raw = culto[papel] || '';
    if (!raw) continue;
    const nomes = raw.split(',').map((s) => s.trim()).filter(Boolean);
    for (const nome of nomes) {
      const p = resolverEscalado(nome);
      if (!p) continue; // grupo/departamento ou não cadastrado
      const bloqueadoDia = indispDia.has(p.id);
      const bloqueadoMes = mesInteiro.has(p.id);
      if (bloqueadoDia || bloqueadoMes) {
        conflitos.push({
          data: culto.DATA,
          iso,
          dia: culto['DIA SEMANA'],
          papel,
          nomeEscala: nome,
          pessoa: p.nome,
          motivo: bloqueadoMes ? 'votou NÃO POSSO EM SETEMBRO (mês inteiro)' : 'votou que não pode neste dia',
        });
      }
    }
  }
}

// ---- relatório ----
console.log(`\n${CYAN}== Verificação de conflitos: escala x indisponibilidade ==${RESET}`);
console.log(`Escala:          ${escalaPath}`);
console.log(`Indisponibilidade: ${indispPath}`);
console.log(`CSV (telefones):   ${csvPath ? csvPath : '(não usado — só match exato de nome/alias)'}`);
console.log(`Cultos analisados: ${escala.length} | Datas com voto: ${indispPorData.size} | Mês inteiro: ${mesInteiro.size}\n`);

if (naoResolvidos.size > 0) {
  console.log(`${YELLOW}Avisos — nomes da enquete não resolvidos no cadastro (${naoResolvidos.size}):${RESET}`);
  for (const nm of naoResolvidos) console.log(`  - ${nm}`);
  console.log('');
}

if (conflitos.length === 0) {
  console.log(`${GREEN}✓ Nenhum conflito: ninguém foi escalado em dia que votou que não pode.${RESET}\n`);
  process.exit(0);
}

console.log(`${RED}✗ ${conflitos.length} conflito(s) encontrado(s):${RESET}\n`);
for (const c of conflitos) {
  console.log(`  ${RED}•${RESET} ${c.data} (${c.dia}) — ${c.pessoa} escalado(a) em ${c.papel} — ${c.motivo}`);
}
console.log('');
process.exit(1);
