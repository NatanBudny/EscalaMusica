#!/usr/bin/env node
/**
 * balancear-carga.js
 *
 * Lista quem canta 2+ vezes no mês e, para cada aparição em EQUIPE LOUVOR,
 * sugere substitutos vindos da lista de "votaram, têm dia disponível e não
 * foram escalados" — para equilibrar a carga.
 *
 * Respeita: disponibilidade (CSV), habilitação (equipe), dias_permitidos,
 * domingo (Catherine/Ariadny), vínculos sempre_junto, gênero (mantém >=1 homem),
 * não duplicar no culto, e não recolocar quem já está no dia.
 *
 * Uso: node scripts/validacao/balancear-carga.js
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

let csvPath = arg('csv');
if (!csvPath) { const home = process.env.USERPROFILE || process.env.HOME; const dl = home ? resolve(home, 'Downloads') : null; if (dl && existsSync(dl)) { const c = readdirSync(dl).filter((f) => /csv$/i.test(f) && /vote|indispon|pode/i.test(f)).map((f) => ({ f, t: statSync(resolve(dl, f)).mtimeMs })).sort((a, b) => b.t - a.t); if (c.length) csvPath = resolve(dl, c[0].f); } }
const escala = JSON.parse(readFileSync(resolve(ROOT, arg('escala') || 'atual.json'), 'utf8'));
const cad = JSON.parse(readFileSync(resolve(ROOT, 'pessoas.json'), 'utf8')).pessoas;

const porNomeAlias = new Map(); const porId = new Map(); const porTel = new Map();
for (const p of cad) { porId.set(p.id, p); porNomeAlias.set(norm(p.nome), p); for (const a of p.aliases || []) porNomeAlias.set(norm(a), p); const t = normTel(p.telefone); if (t && !porTel.has(t)) porTel.set(t, p); }
const resolveP = (nm, tel) => porNomeAlias.get(norm(nm)) || (tel ? porTel.get(normTel(tel)) : null) || null;

// votos
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
function vinculoQuebra(p, presentes) { for (const v of p.vinculos || []) if (v.tipo === 'sempre_junto' && !presentes.has(v.com_id)) return porId.get(v.com_id); return null; }

// carga por pessoa (papéis próprios)
const carga = new Map(); const apar = new Map(); // id -> [{data, papel, cu}]
for (const cu of escala) for (const pp of ['REGENTE LOUVOR', 'EQUIPE LOUVOR', 'MENSAGEM MUSICAL']) for (const nm of String(cu[pp] || '').split(',').map((s) => s.trim()).filter(Boolean)) { const p = porNomeAlias.get(norm(nm)); if (!p) continue; carga.set(p.id, (carga.get(p.id) || 0) + 1); if (!apar.has(p.id)) apar.set(p.id, []); apar.get(p.id).push({ data: cu.DATA, papel: pp, cu }); }

// lista de "de fora": votaram, têm dia disponível, não escalados, escaláveis
const deFora = cad.filter((p) => votou.has(p.id) && !mes.has(p.id) && (carga.get(p.id) || 0) === 0 && p.ativo && !p.afastado && (p.habilitacoes?.equipe || p.habilitacoes?.regente));

console.log('\n===== BALANCEAMENTO DE CARGA =====');
console.log('Quem canta 2+ vezes e poderia ceder lugar a quem está de fora (equipe):\n');

const sobrecarregados = [...carga.entries()].filter(([, q]) => q >= 2).sort((a, b) => b[1] - a[1]);
if (!sobrecarregados.length) { console.log('Ninguém com carga >= 2.'); process.exit(0); }

for (const [id, q] of sobrecarregados) {
  const p = porId.get(id);
  console.log(`• ${p.nome} — ${q} participações: ${apar.get(id).map((a) => a.data + ' (' + a.papel.replace(' LOUVOR', '').replace('MENSAGEM MUSICAL', 'MM') + ')').join(', ')}`);
  // só faz sentido ceder EQUIPE (regência/MM têm menos gente)
  for (const ap of apar.get(id).filter((x) => x.papel === 'EQUIPE LOUVOR')) {
    const iso = isoDe(ap.data); const dia = diaDe(ap.cu);
    const idsDia = idsNoCulto(ap.cu);
    // remover o sobrecarregado e ver gênero restante
    const equipeSemEle = String(ap.cu['EQUIPE LOUVOR']).split(',').map((s) => porNomeAlias.get(norm(s.trim()))).filter(Boolean).filter((x) => x.id !== id);
    const homensRest = equipeSemEle.filter((x) => x.genero === 'M').length;
    const cands = deFora.filter((f) => f.habilitacoes?.equipe && !idsDia.has(f.id) && podeNoDia(f, iso, dia) && !vinculoQuebra(f, new Set([...equipeSemEle.map((x) => x.id), f.id])));
    // manter >=1 homem: se ao sair 'ele' (homem) a equipe fica sem homem, exigir substituto homem
    const precisaHomem = p.genero === 'M' && homensRest < 1;
    const candsOk = cands.filter((f) => !precisaHomem || f.genero === 'M');
    console.log(`    ${ap.data}: pode ceder a → ${candsOk.map((f) => f.nome + ' [' + f.genero + ']').join(', ') || '(nenhum candidato de fora serve aqui)'}${precisaHomem ? '  (precisa ser homem p/ manter RF001)' : ''}`);
  }
  const soEquipe = apar.get(id).some((x) => x.papel === 'EQUIPE LOUVOR');
  if (!soEquipe) console.log('    (participações são só regência/MM — não recomendável ceder a participantes de equipe)');
}
console.log('\nCandidatos de fora considerados:', deFora.map((p) => p.nome).join(', ') || '(nenhum)');
console.log('');
