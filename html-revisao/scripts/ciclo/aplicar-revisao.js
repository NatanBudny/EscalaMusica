#!/usr/bin/env node
/**
 * aplicar-revisao.js
 *
 * Aplica de forma determinística o resultado da revisão (JSON exportado pela
 * tela revisao/index.html) sobre o rascunho.md: para cada participante
 * reprovado que tenha um substituto escolhido, troca o nome no rascunho.
 * Em seguida audita o resultado (mesmas regras do validar:rascunho).
 *
 * NÃO inventa substitutos: se um reprovado não tem substituto no JSON, apenas
 * reporta como pendência para o diretor decidir (nada é alterado para ele).
 *
 * Uso:
 *   node scripts/ciclo/aplicar-revisao.js --mes=2026-09 --input=CAMINHO.json [--dry]
 *
 * Exit codes:
 *   0 = aplicado (pode haver pendências sem substituto — reportadas)
 *   1 = erro fatal ou auditoria com violação após aplicar
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { carregarPessoas } from '../lib/cadastro.js';
import { auditarEscala, parseRascunho } from '../lib/auditor-escala.js';
import { resolverRevisaoInput } from '../lib/revisao-input.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const RED = '\x1b[31m', GREEN = '\x1b[32m', YELLOW = '\x1b[33m', BOLD = '\x1b[1m', RESET = '\x1b[0m';

function parseArgs(argv) {
  const a = {};
  for (const arg of argv.slice(2)) if (arg.startsWith('--')) { const [k, ...r] = arg.slice(2).split('='); a[k] = r.length ? r.join('=') : true; }
  return a;
}

const args = parseArgs(process.argv);
const m = String(args.mes || '').match(/^(\d{4})-(\d{2})$/);
if (!m) { console.error('Erro: --mes=AAAA-MM obrigatório.'); process.exit(1); }
const [, ano, mes] = m;
const dry = !!args.dry;
const rascunhoPath = resolve(ROOT, `escalas/${ano}/${mes}/rascunho.md`);

// Prioridade do input: --input > mais recente em Downloads > pasta do mês
const inputPath = resolverRevisaoInput({ argInput: args.input, root: ROOT, ano, mes });
if (!args.input) console.log(`(input automático: ${inputPath})`);

if (!existsSync(rascunhoPath)) { console.error(`Erro: rascunho não encontrado: ${rascunhoPath}`); process.exit(1); }
if (!existsSync(inputPath)) { console.error(`Erro: JSON de revisão não encontrado: ${inputPath}. Informe --input ou salve a revisão em Downloads.`); process.exit(1); }

const rev = JSON.parse(readFileSync(inputPath, 'utf8'));
let linhas = readFileSync(rascunhoPath, 'utf8').split(/\r?\n/);

// Índice das linhas de culto por data
const idxPorData = new Map();
linhas.forEach((l, i) => { const mm = l.match(/^\|\s*(\d{2}\/\d{2}\/\d{4})\s*\|/); if (mm) idxPorData.set(mm[1], i); });

const COL = { 'REGENTE LOUVOR': 6, 'EQUIPE LOUVOR': 7, 'MENSAGEM MUSICAL': 8 };
const trocas = [];
const pendencias = [];

for (const culto of rev.cultos || []) {
  const li = idxPorData.get(culto.data);
  if (li == null) continue;
  const cols = linhas[li].split('|').map((x) => x.trim());
  let mudou = false;
  for (const [grupo, arr] of Object.entries(culto.grupos || {})) {
    const ci = COL[grupo]; if (ci == null) continue;
    let membros = cols[ci].split(',').map((s) => s.trim()).filter(Boolean);
    for (const item of arr) {
      if (item.status !== 'reprovado') continue;
      if (!item.substituto) { pendencias.push(`${culto.data} · ${grupo} · ${item.nome} (reprovado, sem substituto)`); continue; }
      const pos = membros.findIndex((n) => n.toUpperCase() === item.nome.toUpperCase());
      if (pos >= 0) { trocas.push(`${culto.data} · ${grupo}: ${membros[pos]} → ${item.substituto}`); membros[pos] = item.substituto; mudou = true; }
    }
    cols[ci] = membros.join(', ');
  }
  if (mudou) {
    // Reconstrói preservando o padrão de tabela markdown "| a | b | c |".
    // cols vem de split('|'): a 1ª e a última posição são as bordas vazias.
    const internas = cols.slice(1, -1).map((c) => c.trim());
    linhas[li] = `| ${internas.join(' | ')} |`;
  }
}

console.log(`\n${BOLD}=== Aplicar Revisão — ${ano}-${mes} ===${RESET}`);
console.log(`Rascunho: ${rascunhoPath}`);
console.log(`Revisão:  ${inputPath}\n`);

if (trocas.length) { console.log(`${BOLD}Trocas aplicadas (${trocas.length}):${RESET}`); for (const t of trocas) console.log(`  ${GREEN}→${RESET} ${t}`); console.log(''); }
else console.log('Nenhuma troca com substituto para aplicar.\n');

if (pendencias.length) { console.log(`${YELLOW}${BOLD}Pendências (reprovados sem substituto — decida manualmente):${RESET}`); for (const p of pendencias) console.log(`  ${YELLOW}?${RESET} ${p}`); console.log(''); }

const novoConteudo = linhas.join('\n');

// Auditoria do resultado (sem gravar ainda)
const cadastro = carregarPessoas();
const vincPath = resolve(ROOT, `escalas/${ano}/${mes}/insumos/indisponibilidade-cantores-vinculada.json`);
const indisponibilidade = existsSync(vincPath) ? JSON.parse(readFileSync(vincPath, 'utf8')) : { datas: [], indisponiveis_mes_inteiro: { nomes: [] } };
const { erros, avisos } = auditarEscala({ pessoas: cadastro.pessoas, indisponibilidade, cultos: parseRascunho(novoConteudo) });

if (erros.length) {
  console.log(`${RED}${BOLD}Auditoria após aplicar — ${erros.length} violação(ões):${RESET}`);
  for (const e of erros) console.log(`  ${RED}✗${RESET} ${e}`);
}
if (avisos.length) { console.log(`${YELLOW}${BOLD}Avisos:${RESET}`); for (const a of avisos) console.log(`  ${YELLOW}⚠${RESET} ${a}`); }

if (dry) { console.log(`\n${BOLD}(dry-run)${RESET} nada foi gravado.`); process.exit(erros.length ? 1 : 0); }

if (erros.length) {
  console.log(`\n${RED}${BOLD}NÃO gravei o rascunho: a revisão gera violações obrigatórias.${RESET} Ajuste os substitutos e rode de novo (ou use --dry para inspecionar).`);
  process.exit(1);
}

writeFileSync(rascunhoPath, novoConteudo, 'utf8');
console.log(`\n${GREEN}${BOLD}✓ Rascunho atualizado e válido.${RESET}`);
if (pendencias.length) console.log(`${YELLOW}Ainda há ${pendencias.length} reprovado(s) sem substituto para você resolver.${RESET}`);
