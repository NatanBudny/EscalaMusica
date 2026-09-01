#!/usr/bin/env node

import { execSync } from 'child_process';

function getArgValue(name) {
  const prefix = `${name}=`;
  const arg = process.argv.find((item) => item.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : '';
}

function quoteArg(value) {
  return `"${String(value).replaceAll('"', '\\"')}"`;
}

const rascunho = getArgValue('--rascunho');
const acionato = getArgValue('--acionato');
const sonoplastia = getArgValue('--sonoplastia');

let publishCommand = 'npm run publicar:mensal';
const publishArgs = [];
if (rascunho) publishArgs.push(`--rascunho=${quoteArg(rascunho)}`);
if (acionato) publishArgs.push(`--acionato=${quoteArg(acionato)}`);
if (sonoplastia) publishArgs.push(`--sonoplastia=${quoteArg(sonoplastia)}`);
if (publishArgs.length > 0) {
  publishCommand = `${publishCommand} -- ${publishArgs.join(' ')}`;
}

// Validação do rascunho ANTES de promover (aborta o fechamento se houver violação).
const validarRascunhoCmd = rascunho
  ? `npm run validar:rascunho -- ${quoteArg(rascunho)}`
  : 'npm run validar:rascunho';

// Mês alvo (AAAA-MM) inferido do caminho do rascunho, para passar aos controles.
const mesMatch = String(rascunho).match(/escalas[\/\\](\d{4})[\/\\](\d{2})[\/\\]/);
const mesAlvo = mesMatch ? `${mesMatch[1]}-${mesMatch[2]}` : '';
const mesArg = mesAlvo ? ` -- --mes=${mesAlvo}` : '';

const steps = [
  { label: 'Validar rascunho (auditoria completa)', command: validarRascunhoCmd },
  { label: 'Publicar mes', command: publishCommand },
  { label: 'Validar regras', command: 'npm run validar:regras' },
  { label: 'Validar OBS', command: 'npm run validar:obs' },
  { label: 'Gerar links', command: 'npm run gerar:links-publicacao' },
  // Controles de rotação: rodam APÓS publicar, para já incluir o mês recém-publicado no histórico.
  { label: 'Controle Mensagem Musical', command: `npm run controle:mm${mesArg}` },
  { label: 'Controle Regentes', command: `npm run controle:regentes${mesArg}` },
  { label: 'Controle Equipe Louvor', command: `npm run controle:equipe${mesArg}` },
  { label: 'Limpar pos-publicacao', command: 'npm run limpar:pos-publicacao' }
];

const skipLocal = process.argv.includes('--skip-local');

function runStep(label, command) {
  console.log(`\n=== ${label} ===`);
  execSync(command, { stdio: 'inherit' });
}

try {
  for (const step of steps) {
    runStep(step.label, step.command);
  }

  if (!skipLocal) {
    runStep('Subir ambiente local', 'python scripts/local.py');
  } else {
    console.log('\nlocal.py foi ignorado com --skip-local.');
  }
} catch (error) {
  const status = Number.isInteger(error?.status) ? error.status : 1;
  process.exit(status);
}
