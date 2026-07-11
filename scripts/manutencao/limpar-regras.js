#!/usr/bin/env node
/**
 * limpar-regras.js
 *
 * Remove a seção `restricoes_pessoais` do regras.snapshot.json,
 * mantendo todas as outras seções intactas.
 *
 * Uso:
 *   node scripts/limpar-regras.js [--output=CAMINHO]
 *
 * Sem --output, sobrescreve o arquivo original.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '../..');

const DEFAULT_INPUT = resolve(ROOT, 'processos', 'regras', 'regras.snapshot.json');

function parseArgs(args) {
  let output = null;
  for (const arg of args) {
    if (arg.startsWith('--output=')) {
      output = arg.slice('--output='.length);
    }
  }
  return { output };
}

function main() {
  const { output } = parseArgs(process.argv.slice(2));

  const inputPath = DEFAULT_INPUT;
  const outputPath = output ? resolve(output) : inputPath;

  // Ler arquivo
  let raw;
  try {
    raw = readFileSync(inputPath, 'utf-8');
  } catch (err) {
    console.error(`Erro ao ler ${inputPath}: ${err.message}`);
    process.exit(1);
  }

  let regras;
  try {
    regras = JSON.parse(raw);
  } catch (err) {
    console.error(`Erro ao parsear JSON: ${err.message}`);
    process.exit(1);
  }

  // Verificar se a seção existe
  const tinhaRestricoes = Object.hasOwn(regras, 'restricoes_pessoais');

  // Remover restricoes_pessoais
  delete regras.restricoes_pessoais;

  // Escrever arquivo limpo
  try {
    writeFileSync(outputPath, JSON.stringify(regras, null, 2) + '\n', 'utf-8');
  } catch (err) {
    console.error(`Erro ao escrever ${outputPath}: ${err.message}`);
    process.exit(1);
  }

  // Relatório
  const secoesRestantes = Object.keys(regras);
  console.log('=== Limpeza do regras.snapshot.json ===');
  console.log(`Entrada: ${inputPath}`);
  console.log(`Saída:   ${outputPath}`);
  if (tinhaRestricoes) {
    console.log('✔ Seção "restricoes_pessoais" removida com sucesso.');
  } else {
    console.log('ℹ Seção "restricoes_pessoais" não encontrada (já limpo).');
  }
  console.log(`Seções mantidas: ${secoesRestantes.join(', ')}`);
  console.log('Concluído.');
}

main();
