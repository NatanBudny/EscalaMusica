const fs = require('fs');

const rasc = fs.readFileSync('escalas/2026/07/rascunho.md', 'utf8');
const raw = JSON.parse(fs.readFileSync('escalas/2026/07/insumos/indisponibilidade-cantores.json', 'utf8'));
const vinc = JSON.parse(fs.readFileSync('escalas/2026/07/insumos/indisponibilidade-cantores-vinculada.json', 'utf8'));
const mapMd = fs.readFileSync('escalas/2026/07/insumos/mapeamento-indisponibilidade-contatos.md', 'utf8');
const fun = JSON.parse(fs.readFileSync('processos/regras/cadastros/funcoes-louvor.json', 'utf8'));

const active = new Set(fun.pessoas.filter((p) => p.ativo).map((p) => p.nome.toUpperCase()));
const dept = new Set(['JOVENS', 'QUARTETO', 'MELHOR IDADE', 'FAMILIA NILSINHO', 'AVENTUREIROS']);

const rows = rasc
  .split(/\r?\n/)
  .filter((l) => /^\|\s\d{2}\/\d{2}\/\d{4}\s\|/.test(l))
  .map((l) => l.split('|').map((s) => s.trim()));

const events = rows.map((c) => ({
  br: c[1],
  iso: c[1].split('/').reverse().join('-'),
  reg: c[6],
  eq: c[7],
  mm: c[8]
}));

const split = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);

const count = new Map();
for (const e of events) {
  for (const n of [e.reg, ...split(e.eq), ...split(e.mm)]) {
    const u = n.toUpperCase();
    if (!u || dept.has(u)) continue;
    count.set(u, (count.get(u) || 0) + 1);
  }
}

const scaledByDate = new Map();
for (const e of events) {
  const set = new Set();
  for (const n of [e.reg, ...split(e.eq), ...split(e.mm)]) {
    const u = n.toUpperCase();
    if (!u || dept.has(u)) continue;
    set.add(u);
  }
  scaledByDate.set(e.iso, set);
}

const indisByDate = new Map(
  (vinc.datas || []).map((d) => [d.data_referencia, new Set((d.indisponiveis_contatos || []).map((x) => String(x).toUpperCase()))])
);

const votersRaw = new Set();
for (const d of raw.datas || []) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d.data_referencia || ''))) continue;
  for (const n of d.indisponiveis || []) votersRaw.add(String(n).trim());
}

const rawToCanon = new Map();
for (const l of mapMd.split(/\r?\n/)) {
  const m = l.match(/^\d+\.\s(.+?)\s->\s(.+)$/);
  if (m) rawToCanon.set(m[1].trim().toUpperCase(), m[2].trim().toUpperCase());
}

const unique = [
  ...new Set(
    [...votersRaw]
      .map((n) => rawToCanon.get(n.toUpperCase()) || n.toUpperCase())
      .filter((n) => active.has(n))
  )
].sort();

const out = [];
for (const person of unique) {
  if ((count.get(person) || 0) !== 0) continue;
  const days = [];
  for (const e of events) {
    const indis = indisByDate.get(e.iso) || new Set();
    const scaled = scaledByDate.get(e.iso) || new Set();
    if (!indis.has(person) && !scaled.has(person)) days.push(e.br);
  }
  if (days.length) out.push({ nome: person, dias });
}

out.sort((a, b) => b.dias.length - a.dias.length || a.nome.localeCompare(b.nome));

if (!out.length) {
  console.log('NENHUM NOME COM 0 PARTICIPACOES E DISPONIBILIDADE');
} else {
  for (const item of out) {
    console.log(item.nome + ': ' + item.dias.join(', '));
  }
}
