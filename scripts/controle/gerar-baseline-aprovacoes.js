#!/usr/bin/env node
/**
 * gerar-baseline-aprovacoes.js
 *
 * Gera o baseline de aprovações de uma revisão para o mês, usado pela tela de
 * revisão (revisao/index.html) para reexibir como "aprovado antes" (ícone ↩)
 * os nomes que o diretor já confirmou e que continuam no rascunho atual.
 *
 * Assim, após aplicar as trocas e recarregar a tela, as aprovações anteriores
 * não se perdem — aparecem confirmadas com aparência distinta, editáveis.
 *
 * Entrada:
 *   - Resultado da revisão (JSON exportado pela tela). Por padrão procura em
 *     escalas/AAAA/MM/revisao-resultado-AAAA-MM.json; use --input para outro caminho.
 *   - Rascunho atual: escalas/AAAA/MM/rascunho.md
 *
 * Saída:
 *   - escalas/AAAA/MM/revisao-aprovados.json (só aprovados que ainda estão no rascunho)
 *
 * Uso:
 *   node scripts/controle/gerar-baseline-aprovacoes.js --mes=2026-09
 *   node scripts/controle/gerar-baseline-aprovacoes.js --mes=2026-09 --input="C:/.../revisao-resultado-2026-09.json"
 *
 * Exit codes: 0 = sucesso, 1 = erro fatal
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { resolverRevisaoInput } from '../lib/revisao-input.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');

function parseArgs(argv) {
  const args = {};
  for (const arg of argv.slice(2)) {
    if (arg.startsWith('--')) {
      const [k, ...r] = arg.slice(2).split('=');
      args[k] = r.length ? r.join('=') : true;
    }
  }
  return args;
}

const args = parseArgs(process.argv);
const m = String(args.mes || '').match(/^(\d{4})-(\d{2})$/);
if (!m) {
  console.error('Erro: --mes=YYYY-MM é obrigatório (ex: 2026-09).');
  process.exit(1);
}
const [, ano, mes] = m;
const mesDir = resolve(ROOT, `escalas/${ano}/${mes}`);
const rascunhoPath = resolve(mesDir, 'rascunho.md');
const inputPath = resolverRevisaoInput({ argInput: args.input, root: ROOT, ano, mes });
const outPath = resolve(mesDir, 'revisao-aprovados.json');

if (!existsSync(rascunhoPath)) {
  console.error(`Erro: rascunho não encontrado: ${rascunhoPath}`);
  process.exit(1);
}
if (!existsSync(inputPath)) {
  console.error(`Erro: resultado da revisão não encontrado: ${inputPath}`);
  console.error('Salve o JSON pela tela de revisão e mova para a pasta do mês, ou informe --input.');
  process.exit(1);
}

const split = (r) => (!r ? [] : r.split(',').map((s) => s.trim()).filter(Boolean));

// Mapa do rascunho atual: data -> grupo -> Set(nomes)
const rows = readFileSync(rascunhoPath, 'utf8')
  .split(/\r?\n/)
  .filter((l) => /^\|\s*\d{2}\/\d{2}\/\d{4}\s*\|/.test(l));
const atual = new Map();
for (const l of rows) {
  const c = l.split('|').map((x) => x.trim());
  atual.set(c[1], {
    'REGENTE LOUVOR': new Set(split(c[6])),
    'EQUIPE LOUVOR': new Set(split(c[7])),
    'MENSAGEM MUSICAL': new Set(split(c[8])),
  });
}

const rev = JSON.parse(readFileSync(inputPath, 'utf8'));
const baseline = { mes: `${ano}-${mes}`, gerado_em: new Date().toISOString(), aprovados: [] };

for (const culto of rev.cultos || []) {
  const atualCulto = atual.get(culto.data);
  if (!atualCulto) continue;
  for (const [grupo, arr] of Object.entries(culto.grupos || {})) {
    for (const item of arr) {
      if (item.status === 'aprovado' && atualCulto[grupo]?.has(item.nome)) {
        baseline.aprovados.push({ data: culto.data, grupo, nome: item.nome });
      }
    }
  }
}

writeFileSync(outPath, JSON.stringify(baseline, null, 2) + '\n', 'utf8');
console.log(`✓ Baseline gerado: ${outPath}`);
console.log(`  ${baseline.aprovados.length} aprovação(ões) anterior(es) mantida(s) (continuam no rascunho atual).`);
