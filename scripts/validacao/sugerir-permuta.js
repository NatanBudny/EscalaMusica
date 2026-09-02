#!/usr/bin/env node
/**
 * sugerir-permuta.js
 *
 * Para uma pessoa escalada em um dia que ela votou NÃO poder, sugere:
 *  (A) substitutos diretos: quem está disponível nesse dia e habilitado ao papel;
 *  (B) permutas: alguém escalado em OUTRO dia que a pessoa-alvo PODE, de modo que
 *      elas troquem de lugar (a pessoa-alvo cobre o outro dia, o outro cobre este).
 *
 * Determinístico: disponibilidade vem do CSV (por telefone); habilitação do cadastro.
 *
 * Uso:
 *   node scripts/validacao/sugerir-permuta.js --pessoa="MARIA ELOISA"
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

const alvoNome = arg('pessoa');
if (!alvoNome) { console.error('Use --pessoa="NOME"'); process.exit(2); }

// localizar CSV
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

const porTel = new Map(); const porNomeAlias = new Map();
for (const p of cad) { const t = normTel(p.telefone); if (t && !porTel.has(t)) porTel.set(t, p); porNomeAlias.set(norm(p.nome), p); for (const a of p.aliases || []) porNomeAlias.set(norm(a), p); }
const resolvePessoa = (nm) => porNomeAlias.get(norm(nm)) || null;

// disponibilidade por pessoa: Set de ISO em que NÃO pode; e mês inteiro
const raw = readFileSync(csvPath, 'utf8').replace(/^\uFEFF/, '');
const lines = raw.split(/\r?\n/).filter((l) => l.trim());
const header = parseCSVLine(lines[0]);
const colDatas = {}; header.forEach((h, i) => { const m = h.match(/(\d{2})\/(\d{2})/); if (m) colDatas[i] = `2026-${m[2]}-${m[1]}`; });
const idxMes = header.findIndex((h) => /NÃO POSSO|NAO POSSO/i.test(h));

const naoPodePorId = new Map(); // id -> Set(iso)
const mesInteiroIds = new Set();
for (let i = 1; i < lines.length; i++) {
  const c = parseCSVLine(lines[i]); const nome = (c[0] || '').trim(); if (!nome || nome.toUpperCase() === 'TOTAL') continue;
  const t = normTel(c[1]);
  const p = resolvePessoa(nome) || porTel.get(t); if (!p) continue;
  const set = naoPodePorId.get(p.id) || new Set();
  for (const [idx, iso] of Object.entries(colDatas)) if (String(c[idx] || '').trim()) set.add(iso);
  naoPodePorId.set(p.id, set);
  if (idxMes >= 0 && String(c[idxMes] || '').trim()) mesInteiroIds.add(p.id);
}

// alguém votou? se não tem registro no CSV, tratamos como "sem voto" (assume disponível, mas sinaliza)
const votou = new Set([...naoPodePorId.keys()]);
function podeNoDia(p, iso, dia) {
  if (mesInteiroIds.has(p.id)) return false;
  if ((naoPodePorId.get(p.id) || new Set()).has(iso)) return false;
  // regras de dia do cadastro
  if (p.dias_permitidos && !p.dias_permitidos.includes(dia)) return false;
  // regras fixas conhecidas
  const n = norm(p.nome);
  if (dia === 'domingo' && (n === 'CATHERINE' || n === 'ARIADNY')) return false;
  if (!p.ativo || p.afastado) return false;
  return true;
}
const diaSemana = (cu) => norm(cu['DIA SEMANA']).toLowerCase().includes('domingo') ? 'domingo' : norm(cu['DIA SEMANA']).toLowerCase().includes('sab') ? 'sabado' : 'quarta';
const isoDe = (br) => { const m = String(br).match(/^(\d{2})\/(\d{2})\/(\d{4})$/); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };

const alvo = resolvePessoa(alvoNome);
if (!alvo) { console.error(`Pessoa não encontrada: ${alvoNome}`); process.exit(2); }

// dias em que a alvo está escalada em papel próprio (reg/equipe/MM)
const PAPEIS = ['REGENTE LOUVOR', 'EQUIPE LOUVOR', 'MENSAGEM MUSICAL'];
function escaladosNoCulto(cu) { const m = new Map(); for (const pp of PAPEIS) for (const nm of String(cu[pp] || '').split(',').map((s) => s.trim()).filter(Boolean)) { const p = resolvePessoa(nm); if (p) m.set(p.id, { papel: pp, nome: nm }); } return m; }

const habilita = (p, papel) => papel === 'REGENTE LOUVOR' ? !!p.habilitacoes?.regente : papel === 'EQUIPE LOUVOR' ? !!p.habilitacoes?.equipe : true;

console.log(`\n== Permuta/substituição para ${alvo.nome} ==`);
console.log(`CSV: ${csvPath}\n`);

// dias-problema da alvo
const problemas = [];
for (const cu of escala) {
  const iso = isoDe(cu.DATA); if (!iso) continue;
  const dia = diaSemana(cu);
  const esc = escaladosNoCulto(cu);
  if (esc.has(alvo.id) && ((naoPodePorId.get(alvo.id) || new Set()).has(iso) || mesInteiroIds.has(alvo.id))) {
    problemas.push({ cu, iso, dia, papel: esc.get(alvo.id).papel });
  }
}
if (!problemas.length) { console.log('Sem conflitos para essa pessoa.'); process.exit(0); }

// dias em que a alvo PODE (candidatos a receber a permuta)
const diasQueAlvoPode = escala.filter((cu) => { const iso = isoDe(cu.DATA); return iso && podeNoDia(alvo, iso, diaSemana(cu)); }).map((cu) => ({ cu, iso: isoDe(cu.DATA), dia: diaSemana(cu) }));

for (const prob of problemas) {
  console.log(`\n--- ${prob.cu.DATA} (${prob.dia}) — ${alvo.nome} em ${prob.papel} — ELA NÃO PODE ---`);
  const escDia = escaladosNoCulto(prob.cu);
  const jaNoDia = new Set([...escDia.keys()]);

  // (A) substitutos diretos — enquete é "vote nos dias que NÃO pode":
  //     ausência de voto no dia = disponível. Marcamos se a pessoa votou (mais confiável).
  const subs = cad.filter((p) => p.id !== alvo.id && !jaNoDia.has(p.id) && habilita(p, prob.papel) && podeNoDia(p, prob.iso, prob.dia) && (p.perfil_canto || p.habilitacoes?.regente || p.habilitacoes?.equipe));
  console.log(`(A) Substitutos diretos disponíveis para ${prob.papel}:`);
  if (!subs.length) console.log('    (nenhum candidato disponível)');
  for (const s of subs.slice(0, 20)) console.log(`    - ${s.nome}${votou.has(s.id) ? ' [votou disponível]' : ' [não votou — assume disponível]'}`);

  // (B) permutas: pessoa escalada em um dia que a alvo pode, no MESMO papel, e que
  //     essa pessoa possa cobrir o dia-problema
  console.log(`(B) Permutas possíveis (trocar de dia):`);
  let achou = false;
  for (const d of diasQueAlvoPode) {
    if (d.iso === prob.iso) continue;
    const escOutro = escaladosNoCulto(d.cu);
    for (const [id, info] of escOutro) {
      if (id === alvo.id) continue;
      if (info.papel !== prob.papel) continue; // mesmo papel para troca limpa
      const outra = cad.find((p) => p.id === id); if (!outra) continue;
      // a "outra" precisa poder cobrir o dia-problema; a alvo precisa poder cobrir o dia dela (já garantido por diasQueAlvoPode)
      const outraPodeProblema = podeNoDia(outra, prob.iso, prob.dia) && !jaNoDia.has(outra.id);
      const alvoPodeOutro = !escOutro.has(alvo.id); // alvo não pode já estar no outro dia
      if (outraPodeProblema && alvoPodeOutro && habilita(alvo, info.papel)) {
        achou = true;
        console.log(`    - Trocar com ${outra.nome}: ${outra.nome} vai para ${prob.cu.DATA} (${prob.papel}); ${alvo.nome} vai para ${d.cu.DATA} (${info.papel})`);
      }
    }
  }
  if (!achou) console.log('    (nenhuma permuta limpa no mesmo papel; use um substituto direto de (A))');
}
console.log('');
