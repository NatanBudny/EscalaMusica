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

const steps = [
  { label: 'Publicar mes', command: publishCommand },
  { label: 'Validar regras', command: 'npm run validar:regras' },
  { label: 'Validar OBS', command: 'npm run validar:obs' },
  { label: 'Gerar links', command: 'npm run gerar:links-publicacao' },
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
