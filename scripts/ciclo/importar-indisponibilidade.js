#!/usr/bin/env node
/**
 * importar-indisponibilidade.js
 *
 * Converte o arquivo exportado da enquete do WhatsApp (Polls Exporter) para o
 * formato `indisponibilidade-cantores.json` consumido por vincular-indisponibilidade.
 *
 * Suporta DOIS formatos de exportação:
 *   A) CSV com uma coluna por dia e "✓" (formato antigo, set/2026).
 *   B) TXT/CSV com coluna "Poll Result" contendo os dias escolhidos separados por
 *      vírgula (ex: "03/10 Sábado, 04/10 Domingo") e, opcionalmente, uma opção
 *      "⛔ NÃO posso em <mês>" (formato novo, out/2026). Delimitador "|" ou ",".
 *
 * A enquete pergunta "vote nos dias que NÃO pode": cada dia marcado é uma
 * indisponibilidade; "NÃO posso no mês" = indisponível o mês inteiro.
 *
 * Também confere o telefone de cada votante contra pessoas.json (por telefone,
 * tolerando a variação do 9º dígito do celular) e reporta divergências.
 *
 * Uso:
 *   node scripts/ciclo/importar-indisponibilidade.js --mes=2026-10 [--input=PATH]
 *   (se --input omitido, procura em escalas/AAAA/MM/ um arquivo "vote*"/"indispon*")
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const args = process.argv.slice(2);
const arg = (n) => { const p = args.find((a) => a.startsWith(`--${n}=`)); return p ? p.split('=').slice(1).join('=') : null; };

const mesArg = arg('mes');
const m = String(mesArg || '').match(/^(\d{4})-(\d{2})$/);
if (!m) { console.error('Erro: --mes=AAAA-MM é obrigatório.'); process.exit(1); }
const [, ano, mes] = m;
const mesesNome = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const nomeMes = mesesNome[parseInt(mes, 10) - 1];

const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const normTel = (s) => String(s || '').replace(/\D/g, '');

// --- localizar input ---
let input = arg('input');
const baseDir = resolve(ROOT, `escalas/${ano}/${mes}`);
if (input && !existsSync(input)) input = resolve(ROOT, input);
if (!input) {
  const buscarEm = [baseDir, resolve(baseDir, 'insumos')];
  for (const dir of buscarEm) {
    if (!existsSync(dir)) continue;
    const cands = readdirSync(dir)
      .filter((f) => /\.(csv|txt)$/i.test(f) && /vote|indispon|pode|enquete/i.test(f))
      .map((f) => ({ f: resolve(dir, f), t: statSync(resolve(dir, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    if (cands.length) { input = cands[0].f; break; }
  }
}
if (!input || !existsSync(input)) { console.error('Erro: arquivo de enquete não encontrado. Use --input=<caminho>.'); process.exit(1); }

// --- cadastro p/ conferência de telefone ---
const cad = JSON.parse(readFileSync(resolve(ROOT, 'pessoas.json'), 'utf8')).pessoas;
const porTel = new Map();
const porNomeAlias = new Map();
for (const p of cad) { const t = normTel(p.telefone); if (t) { if (!porTel.has(t)) porTel.set(t, p); } porNomeAlias.set(norm(p.nome), p); for (const a of p.aliases || []) porNomeAlias.set(norm(a), p); }
function variacoesTel(t) { const set = new Set([t]); const mm = t.match(/^55(\d{2})(\d+)$/); if (mm) { const [, ddd, resto] = mm; if (resto.length === 9 && resto[0] === '9') set.add(`55${ddd}${resto.slice(1)}`); if (resto.length === 8) set.add(`55${ddd}9${resto}`); } return set; }
function resolverCadastro(nome, tel) {
  const t = normTel(tel);
  if (porTel.has(t)) return { pessoa: porTel.get(t), via: 'telefone' };
  const n = porNomeAlias.get(norm(nome)); if (n) return { pessoa: n, via: 'nome/alias' };
  for (const v of variacoesTel(t)) if (porTel.has(v)) return { pessoa: porTel.get(v), via: 'telefone~9', telCadastro: normTel(porTel.get(v).telefone) };
  return { pessoa: null, via: '-' };
}

// --- parse do arquivo ---
const raw = readFileSync(input, 'utf8').replace(/^\uFEFF/, '');
const linhas = raw.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith('#'));
const delim = linhas[0].includes('|') ? '|' : ',';
function cols(linha) { return linha.split(delim).map((c) => c.trim()); }
const header = cols(linhas[0]).map((h) => h.toLowerCase());
const idxNome = header.findIndex((h) => /name|nome/.test(h));
const idxTel = header.findIndex((h) => /phone|telefone|number/.test(h));
const idxPoll = header.findIndex((h) => /poll|result|resultado|dias/.test(h));
// colunas de data (formato antigo com uma coluna por dia)
const colDataAntigo = {};
cols(linhas[0]).forEach((h, i) => { const mm2 = h.match(/(\d{2})\/(\d{2})/); if (mm2) colDataAntigo[i] = `${ano}-${mm2[2]}-${mm2[1]}`; });

const porData = new Map(); // iso -> Set(nomeOriginal)
const mesInteiro = [];
const avisosTel = [];
const naoResolvidos = [];

function marcarDia(iso, nome) { if (!porData.has(iso)) porData.set(iso, new Set()); porData.get(iso).add(nome); }

for (let i = 1; i < linhas.length; i++) {
  const c = cols(linhas[i]);
  const nome = (c[idxNome] || '').trim();
  if (!nome || /^total$/i.test(nome)) continue;
  const tel = (c[idxTel] || '').trim();

  // conferência de telefone
  const r = resolverCadastro(nome, tel);
  if (!r.pessoa) naoResolvidos.push(`${nome} (tel ${normTel(tel)})`);
  else if (r.via === 'telefone~9') avisosTel.push(`${nome}: CSV ${normTel(tel)} vs cadastro ${r.telCadastro} (dígito 9 divergente) -> ${r.pessoa.nome}`);

  // formato B: coluna Poll Result
  if (idxPoll >= 0 && c[idxPoll]) {
    const partes = c[idxPoll].split(',').map((s) => s.trim()).filter(Boolean);
    for (const parte of partes) {
      if (/N[ÃA]O\s+posso/i.test(parte)) { mesInteiro.push(nome); continue; }
      const mm3 = parte.match(/(\d{2})\/(\d{2})/);
      if (mm3) marcarDia(`${ano}-${mm3[2]}-${mm3[1]}`, nome);
    }
    continue;
  }
  // formato A: uma coluna por dia com "✓"
  for (const [idx, iso] of Object.entries(colDataAntigo)) {
    if (String(c[idx] || '').trim()) marcarDia(iso, nome);
  }
  const idxMesA = header.findIndex((h) => /não posso|nao posso/.test(h));
  if (idxMesA >= 0 && String(c[idxMesA] || '').trim()) mesInteiro.push(nome);
}

// --- montar JSON de saída ---
function diaSemana(iso) { const d = new Date(iso + 'T12:00:00Z').getUTCDay(); return d === 0 ? 'domingo' : d === 6 ? 'sabado' : ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'][d]; }
const datas = [...porData.keys()].sort().map((iso) => ({
  data_referencia: iso,
  dia_semana: diaSemana(iso),
  indisponiveis: [...porData.get(iso)].sort(),
}));
datas.push({
  data_referencia: 'geral',
  dia_semana: 'todos',
  indisponiveis_tempo_indeterminado: [...new Set(mesInteiro)].sort(),
  observacoes: [`Nomes em indisponiveis_tempo_indeterminado marcaram 'NAO POSSO EM ${nomeMes.toUpperCase()}' na enquete.`],
  disponiveis_para_todos: [''],
});

const saida = {
  contexto: `Indisponibilidade de cantores - ${nomeMes[0].toUpperCase() + nomeMes.slice(1)} ${ano}`,
  origem: 'Enquete do grupo: vote em quais dias voce NAO pode cantar',
  atualizado_em: `${ano}-${mes}-01`,
  datas,
};

const outPath = resolve(baseDir, 'insumos', 'indisponibilidade-cantores.json');
writeFileSync(outPath, JSON.stringify(saida, null, 2) + '\n', 'utf8');

console.log(`Entrada: ${input.replace(ROOT + '\\', '').replace(ROOT + '/', '')}`);
console.log(`Saída:   ${outPath.replace(ROOT + '\\', '').replace(ROOT + '/', '')}`);
console.log(`Dias com voto: ${porData.size} | Mês inteiro: ${new Set(mesInteiro).size}`);
if (avisosTel.length) { console.log(`\n⚠️  Telefones com dígito 9 divergente (confira o cadastro):`); for (const a of avisosTel) console.log('   - ' + a); }
if (naoResolvidos.length) { console.log(`\n⚠️  Votantes NÃO resolvidos no cadastro (${naoResolvidos.length}):`); for (const n of naoResolvidos) console.log('   - ' + n); }
console.log('');
