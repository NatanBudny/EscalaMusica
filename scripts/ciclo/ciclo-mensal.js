#!/usr/bin/env node

/**
 * ciclo-mensal.js
 *
 * Orquestrador do ciclo mensal de geração de escala.
 * Encadeia os scripts na ordem correta e para no ponto adequado.
 *
 * Uso:
 *   node scripts/ciclo-mensal.js --mes=YYYY-MM [--auto] [--publicar]
 *
 * Etapas:
 *   1. vincular-indisponibilidade.js (se insumo existir)
 *   2. sugerir-rascunho.js
 *   3. validar-rascunho.js
 *   4. (STOP se --publicar não fornecido)
 *   5. publicar-escala-mensal.js
 *   6. gerar-links-publicacao.js
 *
 * Exit codes:
 *   0 = sucesso
 *   1 = erro fatal em alguma etapa
 */

import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

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
  console.error('Erro: --mes é obrigatório. Uso: node scripts/ciclo-mensal.js --mes=YYYY-MM [--auto] [--publicar]');
  process.exit(1);
}

const mesMatch = String(args.mes).match(/^(\d{4})-(\d{2})$/);
if (!mesMatch) {
  console.error('Erro: --mes deve estar no formato YYYY-MM (ex: 2026-08)');
  process.exit(1);
}

const [, ano, mes] = mesMatch;
const mesAlvo = `${ano}-${mes}`;
const autoMode = !!args.auto;
const publicar = !!args.publicar;

// --- Utilidades ---

function header(etapa, descricao) {
  console.log('');
  console.log('═'.repeat(60));
  console.log(`  ETAPA ${etapa}: ${descricao}`);
  console.log('═'.repeat(60));
  console.log('');
}

function executar(comando, descricao) {
  try {
    execSync(comando, { stdio: 'inherit', cwd: ROOT });
  } catch (err) {
    console.error(`\n❌ Falha na etapa: ${descricao}`);
    console.error(`   Comando: ${comando}`);
    console.error(`   Exit code: ${err.status || 1}`);
    process.exit(err.status || 1);
  }
}

// --- Main ---

function main() {
  console.log(`\n🔄 Ciclo Mensal — ${mesAlvo}`);
  console.log(`   Modo: ${autoMode ? 'automático' : 'interativo'} | Publicar: ${publicar ? 'sim' : 'não'}`);
  console.log('─'.repeat(60));

  // Etapa 1: Vincular indisponibilidade (se input existir)
  const indisponibilidadePath = resolve(ROOT, `escalas/${ano}/${mes}/insumos/indisponibilidade-cantores.json`);

  if (existsSync(indisponibilidadePath)) {
    header(1, 'Vincular indisponibilidade');
    const autoFlag = autoMode ? ' --auto' : '';
    executar(`node scripts/ciclo/vincular-indisponibilidade.js --mes=${mesAlvo}${autoFlag}`, 'vincular indisponibilidade');
  } else {
    header(1, 'Vincular indisponibilidade (PULADO)');
    console.log(`  ⏭️  Arquivo não encontrado: escalas/${ano}/${mes}/insumos/indisponibilidade-cantores.json`);
    console.log('     Continuando sem indisponibilidade vinculada.');
  }

  // Etapa 2: Sugerir rascunho
  header(2, 'Sugerir rascunho');
  executar(`node scripts/ciclo/sugerir-rascunho.js --mes=${mesAlvo}`, 'sugerir rascunho');

  // Etapa 3: Validar rascunho
  header(3, 'Validar rascunho');
  const rascunhoPath = `escalas/${ano}/${mes}/rascunho.md`;
  executar(`node scripts/validacao/validar-rascunho.js ${rascunhoPath}`, 'validar rascunho');

  // Parar aqui se --publicar não foi fornecido
  if (!publicar) {
    console.log('');
    console.log('─'.repeat(60));
    console.log('✅ Rascunho gerado e validado.');
    console.log('');
    console.log('   Revise manualmente e execute:');
    console.log(`   npm run publicar:fechamento -- --rascunho=escalas/${ano}/${mes}/rascunho.md`);
    console.log('');
    process.exit(0);
  }

  // Etapa 4: Publicar escala mensal
  header(4, 'Publicar escala mensal');
  executar(`node scripts/publicacao/publicar-escala-mensal.js --rascunho=escalas/${ano}/${mes}/rascunho.md`, 'publicar escala mensal');

  // Etapa 5: Gerar links de publicação
  header(5, 'Gerar links de publicação');
  executar(`node scripts/publicacao/gerar-links-publicacao.js`, 'gerar links de publicação');

  // Concluído
  console.log('');
  console.log('─'.repeat(60));
  console.log('✅ Ciclo mensal concluído com sucesso!');
  console.log(`   Escala de ${mesAlvo} publicada e links gerados.`);
  console.log('');
}

main();
