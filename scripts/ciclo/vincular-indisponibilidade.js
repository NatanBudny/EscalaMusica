#!/usr/bin/env node

/**
 * vincular-indisponibilidade.js
 *
 * CLI que resolve nomes informais da enquete WhatsApp para IDs numéricos
 * de pessoas.json via fuzzy match, propaga indisponibilidade entre casais
 * (vínculos sempre_junto), e gera arquivo vinculado por ID.
 *
 * Uso:
 *   node scripts/vincular-indisponibilidade.js --mes=2026-07 [--input=PATH] [--output=PATH] [--threshold=0.6] [--auto] [--verbose]
 *
 * Exit codes:
 *   0 = sucesso
 *   1 = erro fatal
 *   2 = incompleto (nomes não resolvidos)
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { carregarPessoas } from '../lib/cadastro.js';
import { resolverPessoaPorNome } from '../lib/fuzzy-match.js';
import { nomesDaEnquete, montarVinculada } from '../lib/indisponibilidade.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');

// --- CLI argument parsing ---

function parseArgs(argv) {
  const args = {};
  for (const arg of argv.slice(2)) {
    if (arg.startsWith('--')) {
      const [key, ...rest] = arg.slice(2).split('=');
      const value = rest.length > 0 ? rest.join('=') : true;
      args[key] = value;
    }
  }
  return args;
}

const args = parseArgs(process.argv);

if (!args.mes) {
  console.error('Erro: --mes é obrigatório. Uso: --mes=YYYY-MM');
  process.exit(1);
}

const mesMatch = String(args.mes).match(/^(\d{4})-(\d{2})$/);
if (!mesMatch) {
  console.error('Erro: --mes deve estar no formato YYYY-MM (ex: 2026-07)');
  process.exit(1);
}

const [, ano, mes] = mesMatch;
const threshold = args.threshold ? parseFloat(args.threshold) : 0.6;
const verbose = !!args.verbose;
const autoMode = !!args.auto;

const defaultInputPath = resolve(ROOT, `escalas/${ano}/${mes}/insumos/indisponibilidade-cantores.json`);
const defaultOutputPath = resolve(ROOT, `escalas/${ano}/${mes}/insumos/indisponibilidade-cantores-vinculada.json`);

const inputPath = args.input ? resolve(args.input) : defaultInputPath;
const outputPath = args.output ? resolve(args.output) : defaultOutputPath;

// --- Helper functions ---

function log(msg) {
  if (verbose) {
    console.log(`[vincular] ${msg}`);
  }
}

function getDiaSemana(dataISO) {
  const dias = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
  const date = new Date(dataISO + 'T12:00:00Z');
  return dias[date.getUTCDay()];
}

// --- Main execution ---

function main() {
  // 1. Load pessoas.json
  log('Carregando pessoas.json...');
  let cadastro;
  try {
    cadastro = carregarPessoas();
  } catch (err) {
    console.error(`Erro fatal ao carregar cadastro: ${err.message}`);
    process.exit(1);
  }
  const { pessoas, porId, porNome } = cadastro;
  log(`Cadastro carregado: ${pessoas.length} pessoas`);

  // 2. Load input (enquete data)
  log(`Carregando enquete: ${inputPath}`);
  let enquete;
  try {
    const conteudo = readFileSync(inputPath, 'utf8');
    enquete = JSON.parse(conteudo);
  } catch (err) {
    console.error(`Erro fatal ao carregar enquete: ${err.message}`);
    process.exit(1);
  }

  // 3. Process all names from the survey (fuzzy match → Map de mapeamentos)
  const mapeamentos = new Map(); // nome_enquete → { pessoa_id, confianca }
  const nomesNaoResolvidos = [];

  const todosNomes = nomesDaEnquete(enquete);
  log(`Nomes únicos na enquete: ${todosNomes.length}`);

  for (const nomeEnquete of todosNomes) {
    const resultado = resolverPessoaPorNome(nomeEnquete, porNome, threshold);
    if (resultado) {
      mapeamentos.set(nomeEnquete, {
        pessoa_id: resultado.pessoa.id,
        confianca: Math.round(resultado.confianca * 100) / 100,
      });
      log(`  ✓ "${nomeEnquete}" → ${resultado.pessoa.nome} (ID ${resultado.pessoa.id}, confiança ${(resultado.confianca * 100).toFixed(0)}%)`);
    } else {
      nomesNaoResolvidos.push(nomeEnquete);
      log(`  ✗ "${nomeEnquete}" → NÃO RESOLVIDO`);
    }
  }

  if (nomesNaoResolvidos.length > 0) {
    console.warn(`\nAVISO: ${nomesNaoResolvidos.length} nome(s) não resolvido(s):`);
    for (const nome of nomesNaoResolvidos) {
      console.warn(`  - "${nome}"`);
    }
  }

  // 4-8. Monta a saída vinculada (lógica pura compartilhada com o editor).
  const relativeFonte = inputPath.startsWith(ROOT)
    ? inputPath.slice(ROOT.length + 1).replace(/\\/g, '/')
    : inputPath.replace(/\\/g, '/');

  const output = montarVinculada(enquete, cadastro, mapeamentos, {
    fonte: relativeFonte,
    mes: `${ano}-${mes}`,
  });

  const mapeamentosOutput = output.mapeamentos_aplicados;
  const propagacoes = output.propagacoes;
  const datasOutput = output.datas;
  const indisponiveisMesInteiro = output.indisponiveis_mes_inteiro || null;

  // 9. Write output
  try {
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, JSON.stringify(output, null, 2) + '\n', 'utf8');
    console.log(`\n✓ Arquivo vinculado gerado: ${outputPath}`);
    console.log(`  Mapeamentos: ${mapeamentosOutput.length}`);
    console.log(`  Propagações (casais): ${propagacoes.length}`);
    console.log(`  Datas processadas: ${datasOutput.length}`);
    if (indisponiveisMesInteiro) {
      console.log(`  Indisponíveis mês inteiro: ${indisponiveisMesInteiro.ids.length}`);
    }
    if (nomesNaoResolvidos.length > 0) {
      console.log(`  Nomes não resolvidos: ${nomesNaoResolvidos.length}`);
    }
  } catch (err) {
    console.error(`Erro fatal ao escrever saída: ${err.message}`);
    process.exit(1);
  }

  // 10. Exit code
  if (nomesNaoResolvidos.length > 0) {
    process.exit(2); // Incompleto
  }
  process.exit(0); // Sucesso
}

// --- Utilities ---

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function getMesNome(mesNum) {
  const meses = [
    'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
    'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
  ];
  return meses[mesNum - 1] || `mês ${mesNum}`;
}

// --- Run ---

main();
