#!/usr/bin/env node

import { existsSync, readdirSync, rmSync, statSync, readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

function parseArgs(argv) {
  const args = { dryRun: false, ano: '', mes: '' };

  for (const arg of argv) {
    if (arg === '--dry-run') args.dryRun = true;
    if (arg.startsWith('--ano=')) args.ano = arg.slice('--ano='.length);
    if (arg.startsWith('--mes=')) args.mes = arg.slice('--mes='.length).padStart(2, '0');
  }

  return args;
}

function extrairAnoMesDaEscala() {
  const atualPath = resolve(ROOT, 'atual.json');
  const escala = JSON.parse(readFileSync(atualPath, 'utf8'));

  for (const item of escala) {
    const data = String(item?.DATA || '').trim();
    const match = data.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!match) continue;
    return { mes: match[2], ano: match[3] };
  }

  throw new Error('Nao foi possivel inferir ano/mes a partir de atual.json. Use --ano e --mes.');
}

function listarArquivosInsumos(insumosDir) {
  if (!existsSync(insumosDir)) return [];
  const nomes = readdirSync(insumosDir);
  return nomes
    .map((nome) => resolve(insumosDir, nome))
    .filter((filePath) => existsSync(filePath) && statSync(filePath).isFile());
}

function removerAlvo(filePath, dryRun, removidos) {
  if (!existsSync(filePath)) return;
  if (!dryRun) rmSync(filePath, { force: true });
  removidos.push(filePath.replace(`${ROOT}\\`, '').replaceAll('\\', '/'));
}

function removerPastaVazia(dirPath, dryRun, removidos) {
  if (!existsSync(dirPath)) return;
  const itens = readdirSync(dirPath);
  if (itens.length > 0) return;

  if (!dryRun) rmSync(dirPath, { recursive: true, force: true });
  removidos.push(dirPath.replace(`${ROOT}\\`, '').replaceAll('\\', '/'));
}

const args = parseArgs(process.argv.slice(2));
const inferido = (!args.ano || !args.mes) ? extrairAnoMesDaEscala() : null;
const ano = args.ano || inferido.ano;
const mes = args.mes || inferido.mes;

const pastaMes = resolve(ROOT, 'escalas', ano, mes);
const rascunhoPath = resolve(pastaMes, 'rascunho.md');
const publicadaPath = resolve(pastaMes, 'publicada.md');
const insumosDir = resolve(pastaMes, 'insumos');

const removidos = [];

removerAlvo(rascunhoPath, args.dryRun, removidos);
removerAlvo(publicadaPath, args.dryRun, removidos);

for (const arquivoInsumo of listarArquivosInsumos(insumosDir)) {
  removerAlvo(arquivoInsumo, args.dryRun, removidos);
}

removerPastaVazia(insumosDir, args.dryRun, removidos);

console.log(`Coletor de lixo pos-publicacao (${ano}/${mes})`);
console.log(args.dryRun ? 'Modo: dry-run (sem apagar arquivos)' : 'Modo: execucao real');

if (removidos.length === 0) {
  console.log('Nenhum arquivo temporario encontrado para remocao.');
  process.exit(0);
}

console.log('Arquivos/pastas removidos:');
for (const item of removidos) {
  console.log(`- ${item}`);
}
