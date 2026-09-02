#!/usr/bin/env node
/**
 * estrategias-regente.js
 *
 * Estuda estratégias em cascata para preencher a REGÊNCIA de um dia difícil:
 *   E1) ACÚMULO: um regente já presente na equipe do dia assume a regência
 *       (deixando a equipe com 4 — precisa de +1 para repor).
 *   E2) LIBERAR: tirar um regente que está só na EQUIPE do dia e promovê-lo a
 *       regente, repondo a vaga da equipe com alguém disponível.
 *   E3) PERMUTA ENTRE DIAS: trazer um regente que rege em OUTRO dia para este,
 *       e cobrir a regência do outro dia com um regente disponível naquele outro dia.
 *
 * Disponibilidade vem do CSV (por nome/alias > telefone). Respeita: mês inteiro,
 * voto no dia, dias_permitidos, domingo (Catherine/Ariadny), ativo/afastado,
 * vínculos sempre_junto (casais) e não duplicar pessoa no mesmo culto.
 *
 * Uso: node scripts/validacao/estrategias-regente.js --data=06/09/2026
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
function parseCSVLine(line) { const out = []; let cur = ''; let q = false; for (let i = 0; i < line.length; i++) { const ch = line[i]; if (ch === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; } else if (ch === ',' && !q) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out; }

const dataAlvo = arg('data') || '06/09/2026';
let csvPath = arg('csv');
if (!csvPath) { const home = process.env.USERPROFILE || process.env.HOME; const dl = home ? resolve(home, 'Downloads') : null; if (dl && existsSync(dl)) { const c = readdirSync(dl).filter((f) => /csv$/i.test(f) && /vote|indispon|pode/i.test(f)).map((f) => ({ f, t: statSync(resolve(dl, f)).mtimeMs })).sort((a, b) => b.t - a.t); if (c.length) csvPath = resolve(dl, c[0].f); } }
const escala = JSON.parse(readFileSync(resolve(ROOT, arg('escala') || 'atual.json'), 'utf8'));
const cad = JSON.parse(readFileSync(resolve(ROOT, 'pessoas.json'), 'utf8')).pessoas;

const porNomeAlias = new Map(); const porId = new Map(); const porTel = new Map();
for (const p of cad) { porId.set(p.id, p); porNomeAlias.set(norm(p.nome), p); for (const a of p.aliases || []) porNomeAlias.set(norm(a), p); const t = normTel(p.telefone); if (t && !porTel.has(t)) porTel.set(t, p); }
const resolveP = (nm, tel) => porNomeAlias.get(norm(nm)) || (tel ? porTel.get(normTel(tel)) : null) || null;

// CSV -> votos
const raw = readFileSync(csvPath, 'utf8').replace(/^\uFEFF/, '');
const lines = raw.split(/\r?\n/).filter((l) => l.trim());
const H = parseCSVLine(lines[0]);
const colD = {}; H.forEach((h, i) => { const m = h.match(/(\d{2})\/(\d{2})/); if (m) colD[i] = `2026-${m[2]}-${m[1]}`; });
const idxMes = H.findIndex((h) => /POSSO EM/i.test(h));
const votou = new Set(); const nao = new Map(); const mes = new Set();
for (let i = 1; i < lines.length; i++) { const c = parseCSVLine(lines[i]); const nm = (c[0] || '').trim(); if (!nm || nm.toUpperCase() === 'TOTAL') continue; const p = resolveP(nm, c[1]); if (!p) continue; votou.add(p.id); const s = nao.get(p.id) || new Set(); for (const [idx, iso] of Object.entries(colD)) if (String(c[idx] || '').trim()) s.add(iso); nao.set(p.id, s); if (idxMes >= 0 && String(c[idxMes] || '').trim()) mes.add(p.id); }

const isoDe = (br) => { const m = String(br).match(/^(\d{2})\/(\d{2})\/(\d{4})$/); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };
const diaDe = (cu) => { const d = norm(cu['DIA SEMANA']).toLowerCase(); return d.includes('domingo') ? 'domingo' : d.includes('sab') ? 'sabado' : 'quarta'; };
function podeNoDia(p, iso, dia) { if (!p.ativo || p.afastado) return false; if (mes.has(p.id)) return false; if ((nao.get(p.id) || new Set()).has(iso)) return false; if (p.dias_permitidos && !p.dias_permitidos.includes(dia)) return false; const n = norm(p.nome); if (dia === 'domingo' && (n === 'CATHERINE' || n === 'ARIADNY')) return false; return true; }
function idsNoCulto(cu) { const s = new Set(); for (const pp of ['REGENTE LOUVOR', 'EQUIPE LOUVOR', 'MENSAGEM MUSICAL']) for (const nm of String(cu[pp] || '').split(',').map((x) => x.trim()).filter(Boolean)) { const p = porNomeAlias.get(norm(nm)); if (p) s.add(p.id); } return s; }
function equipeIds(cu) { return String(cu['EQUIPE LOUVOR'] || '').split(',').map((x) => porNomeAlias.get(norm(x.trim()))).filter(Boolean).map((p) => p.id); }
function regenteId(cu) { const p = porNomeAlias.get(norm(cu['REGENTE LOUVOR'] || '')); return p ? p.id : null; }
// verifica vínculo sempre_junto satisfeito dado um conjunto de ids presentes
function vinculoQuebra(p, presentes) { for (const v of p.vinculos || []) if (v.tipo === 'sempre_junto' && !presentes.has(v.com_id)) return porId.get(v.com_id); return null; }

const cuAlvo = escala.find((c) => c.DATA === dataAlvo);
if (!cuAlvo) { console.error('Data não encontrada na escala:', dataAlvo); process.exit(2); }
const isoAlvo = isoDe(dataAlvo); const diaAlvo = diaDe(cuAlvo);
const idsAlvo = idsNoCulto(cuAlvo); const eqAlvo = equipeIds(cuAlvo);

const carga = new Map();
for (const cu of escala) for (const pp of ['REGENTE LOUVOR', 'EQUIPE LOUVOR', 'MENSAGEM MUSICAL']) for (const nm of String(cu[pp] || '').split(',').map((s) => s.trim()).filter(Boolean)) { const p = porNomeAlias.get(norm(nm)); if (p) carga.set(p.id, (carga.get(p.id) || 0) + 1); }
const cInfo = (id) => `carga ${carga.get(id) || 0}`;
const regentesLivres = (iso, dia, excluir) => cad.filter((p) => p.habilitacoes?.regente && !excluir.has(p.id) && podeNoDia(p, iso, dia) && !vinculoQuebra(p, new Set([...eqAlvo, p.id])));
const equipeCand = (iso, dia, excluir) => cad.filter((p) => p.habilitacoes?.equipe && !excluir.has(p.id) && podeNoDia(p, iso, dia));

console.log(`\n===== ESTRATÉGIAS DE REGÊNCIA — ${dataAlvo} (${diaAlvo}) =====`);
console.log(`Regente atual: ${cuAlvo['REGENTE LOUVOR']} | Equipe: ${cuAlvo['EQUIPE LOUVOR']}\n`);

// E1) ACÚMULO: regente que já está na equipe do dia assume regência
console.log('E1) ACÚMULO (alguém da equipe de hoje também rege — equipe fica com 4, repõe +1):');
let e1 = 0;
for (const id of eqAlvo) { const p = porId.get(id); if (!p?.habilitacoes?.regente) continue;
  // repor a vaga que ele deixa na equipe
  const reps = equipeCand(isoAlvo, diaAlvo, new Set([...idsAlvo])).filter((r) => !vinculoQuebra(r, new Set([...eqAlvo.filter((x) => x !== id), r.id])));
  console.log(`   - ${p.nome} rege (${cInfo(id)}); repor vaga na equipe com: ${reps.slice(0, 6).map((r) => r.nome + ' [' + r.genero + ']').join(', ') || '(sem candidato)'}`);
  e1++;
}
if (!e1) console.log('   (nenhum regente na equipe atual)');

// E2/E3) PERMUTA ENTRE DIAS: regente que rege em OUTRO dia vem para cá; cobrir o outro dia
console.log('\nE3) PERMUTA ENTRE DIAS (traz um regente de outro dia; cobre a regência do outro dia):');
let e3 = 0;
for (const cu of escala) {
  if (cu.DATA === dataAlvo) continue; const iso = isoDe(cu.DATA); const dia = diaDe(cu); if (dia === 'quarta') continue;
  const rid = regenteId(cu); if (!rid) continue; const reg = porId.get(rid);
  // esse regente pode vir para o dia-alvo?
  if (!podeNoDia(reg, isoAlvo, diaAlvo)) continue;
  if (idsAlvo.has(reg.id)) continue;
  if (vinculoQuebra(reg, new Set([...eqAlvo, reg.id]))) continue;
  // quem cobre a regência que ele deixou no outro dia?
  const idsOutro = idsNoCulto(cu); const eqOutro = equipeIds(cu);
  const coberturas = cad.filter((p) => p.habilitacoes?.regente && p.id !== reg.id && !idsOutro.has(p.id) && podeNoDia(p, iso, dia) && !vinculoQuebra(p, new Set([...eqOutro, p.id])));
  if (coberturas.length) {
    e3++;
    console.log(`   - Trazer ${reg.nome} (rege ${cu.DATA}) para ${dataAlvo}; cobrir ${cu.DATA} com: ${coberturas.slice(0, 5).map((c) => c.nome).join(', ')}`);
  } else {
    console.log(`   - ${reg.nome} (rege ${cu.DATA}) poderia vir, MAS ninguém cobre a regência de ${cu.DATA}`);
  }
}
if (!e3) console.log('   (nenhuma permuta entre dias viável)');

console.log('');
